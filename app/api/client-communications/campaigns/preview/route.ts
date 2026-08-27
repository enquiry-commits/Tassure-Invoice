import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { normalize } from '@/lib/company-name';
import {
  loadCompanies, loadInvoicesByCompany, loadAutoTargetNames, loadAlreadySent, loadArPicByCompany, buildRow, makeCompanyFinder,
  type CompanyRow,
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
  // loadCompanies alone measured ~850ms (906 active companies, several JSON/
  // array columns) — it used to run before this Promise.all even started,
  // adding its full cost on top instead of overlapping it. Nothing here
  // reads companyList/findCompany until the loop below, well after all of
  // these have resolved either way, so there's no ordering reason to keep
  // it sequential.
  const [companyList, invoicesByCompany, targetNames, alreadySent, arPicByCompany] = await Promise.all([
    loadCompanies(supabase),
    loadInvoicesByCompany(supabase, type, fyeMonth, fyeYear),
    loadAutoTargetNames(supabase, type, fyeMonth, fyeYear, companyNames),
    onlyUnsent ? loadAlreadySent(supabase, type, fyeMonth, fyeYear) : Promise.resolve(new Set<string>()),
    type === 'ar' ? loadArPicByCompany(supabase, fyeMonth, fyeYear) : Promise.resolve(new Map<string, { acc_pic: string | null; tax_pic: string | null }>()),
  ]);
  const findCompany = makeCompanyFinder(companyList);

  const seen = new Set<string>();
  const rows = [];
  for (const rawName of targetNames) {
    if (!rawName) continue;
    const key = normalize(rawName);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(buildRow(rawName, findCompany, invoicesByCompany, alreadySent, type, arPicByCompany));
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

  // Fast path: this route's other caller (Billing Drafts' Email Drafts
  // popover) always passes back a company_name it already got FROM this
  // same companies table, byte-for-byte — an indexed exact match is a single
  // cheap row lookup, versus unconditionally fetching all ~900 active
  // companies (~850ms measured) just to fuzzy-scan for what's actually an
  // exact hit (Vincent, 2026-08-27: "点击DRAFT...至少要2秒"). Only Campaign
  // Centre's "add a company" control types a genuinely approximate name —
  // that still falls through to the exact same full fuzzy match as before,
  // completely unchanged, just no longer paid by the common exact-match case.
  // Run the attempt alongside the other three queries (none of them depend
  // on which company this resolves to) rather than before them, so the
  // common case costs one round trip, not two.
  const [exactMatch, invoicesByCompany, alreadySent, arPicByCompany] = await Promise.all([
    supabase.from('companies')
      .select('id, company_name, best_email, primary_contact, tw_to_emails, tw_cc_emails, tw_recipient_source, tw_recipient_synced_at, pic')
      .eq('is_active', true).eq('company_name', lookup).maybeSingle()
      .then(r => r.data as CompanyRow | null),
    loadInvoicesByCompany(supabase, type, fyeMonth, fyeYear),
    loadAlreadySent(supabase, type, fyeMonth, fyeYear),
    type === 'ar' ? loadArPicByCompany(supabase, fyeMonth, fyeYear) : Promise.resolve(new Map<string, { acc_pic: string | null; tax_pic: string | null }>()),
  ]);

  let company: CompanyRow | null = exactMatch;
  let findCompany: (name: string) => CompanyRow | null = () => company;
  if (!company) {
    const companyList = await loadCompanies(supabase);
    findCompany = makeCompanyFinder(companyList);
    company = findCompany(lookup);
  }
  if (!company) return NextResponse.json({ error: `No matching company found for "${lookup}".` }, { status: 404 });

  const row = buildRow(company.company_name, findCompany, invoicesByCompany, alreadySent, type, arPicByCompany);
  return NextResponse.json({ row });
}
