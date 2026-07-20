import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { normalize } from '@/lib/company-name';
import {
  loadCompanies, loadInvoicesByCompany, loadAutoTargetNames, loadAlreadySent, buildRow, makeCompanyFinder,
} from '@/lib/client-comms-resolve';

// Preview-before-generate: resolves the same candidate set Campaign Centre
// would generate, WITHOUT writing anything, so a reviewer can check/uncheck
// or hand-add companies before any drafts are created.
//
// POST = bulk auto-resolve (the AR cycle / unpaid-SOA / typed letter list).
// GET  = single ad-hoc lookup for the "add a company" control, which is
// allowed to resolve a company outside the auto target list on purpose.

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type, fyeMonth, fyeYear, companyNames, onlyUnsent = true } = body as {
    type: 'letter' | 'ar' | 'soa'; fyeMonth?: string; fyeYear?: number;
    companyNames?: string[]; onlyUnsent?: boolean;
  };
  if (!type || !['letter', 'ar', 'soa'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  if (type === 'ar' && (!fyeMonth || !fyeYear)) return NextResponse.json({ error: 'fyeMonth and fyeYear required for type=ar' }, { status: 400 });

  const supabase = createAdminClient();
  const companyList = await loadCompanies(supabase);
  const findCompany = makeCompanyFinder(companyList);
  const [invoicesByCompany, targetNames, alreadySent] = await Promise.all([
    loadInvoicesByCompany(supabase, type, fyeMonth, fyeYear),
    loadAutoTargetNames(supabase, type, fyeMonth, fyeYear, companyNames),
    onlyUnsent ? loadAlreadySent(supabase, type, fyeMonth, fyeYear) : Promise.resolve(new Set<string>()),
  ]);

  const seen = new Set<string>();
  const rows = [];
  for (const rawName of targetNames) {
    if (!rawName) continue;
    const key = normalize(rawName);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(buildRow(rawName, findCompany, invoicesByCompany, alreadySent, type));
  }
  rows.sort((a, b) => a.companyName.localeCompare(b.companyName));

  return NextResponse.json({ rows });
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lookup = sp.get('lookup');
  const type = sp.get('type') as 'letter' | 'ar' | 'soa' | null;
  const fyeMonth = sp.get('fyeMonth') ?? undefined;
  const fyeYear = sp.get('fyeYear') ? Number(sp.get('fyeYear')) : undefined;
  if (!lookup || !type) return NextResponse.json({ error: 'lookup and type are required' }, { status: 400 });
  if (!['letter', 'ar', 'soa'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });

  const supabase = createAdminClient();
  const companyList = await loadCompanies(supabase);
  const findCompany = makeCompanyFinder(companyList);
  const company = findCompany(lookup);
  if (!company) return NextResponse.json({ error: `No matching company found for "${lookup}".` }, { status: 404 });

  const [invoicesByCompany, alreadySent] = await Promise.all([
    loadInvoicesByCompany(supabase, type, fyeMonth, fyeYear),
    loadAlreadySent(supabase, type, fyeMonth, fyeYear),
  ]);
  const row = buildRow(company.company_name, findCompany, invoicesByCompany, alreadySent, type);
  return NextResponse.json({ row });
}
