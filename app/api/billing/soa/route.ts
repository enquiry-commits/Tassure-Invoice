import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase';
import { normalize } from '@/lib/company-name';
import { getApprovedAccount, type ApprovedAccount } from '@/lib/approved-accounts';
import type { QbCompany } from '@/lib/quickbooks';
import { computeSoaRows } from '@/lib/soa-data';

const QB_COMPANIES: QbCompany[] = ['TAB', 'TAC', 'TAO'];

// GET /api/billing/soa?company=TAB|TAC|TAO — every company with a real
// outstanding balance in THAT ONE QuickBooks system, aged into the same
// Current/1-30/31-60/61-90/91+ buckets as QuickBooks' own AgedReceivables
// report and Vincent's real collections spreadsheet ("Individual outstanding
// billing"). This is the automation target for the manual PDF-merge step
// Chelsea does today — see app/api/billing/soa/pdf/route.ts for the actual
// merge.
//
// Vincent, 2026-09-07: "把 SOA 放成一个单独的2级标题,然后把 TAB/TAC/TAO分成3
// 个不同的3级标题,数据分开" — TAB/TAC/TAO used to be pooled into one row per
// customer (a company owing on two systems showed one combined total).
// Split into 3 separate sidebar entries, each hitting this route with its
// own `company` — a TAB statement never includes a TAC or TAO balance and
// vice versa, so the invoices query itself is scoped by qb_company, not
// filtered after the fact.
//
// The actual row-computation lives in lib/soa-data.ts (computeSoaRows),
// shared with GET /api/billing/soa/export so the on-screen list and the
// Excel download can never silently drift into different numbers.
export type { SoaCompanyRow } from '@/lib/soa-data';

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  if (!company || !QB_COMPANIES.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO' }, { status: 400 });
  }
  try {
    const rows = await computeSoaRows(company);
    return NextResponse.json({ companies: rows });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}

// PATCH /api/billing/soa — Chelsea's manual pick of who owns chasing one
// customer's outstanding balance ON ONE QuickBooks system. Keyed by
// name + qb_company (via soa_owners), not companies.id — works identically
// whether or not this customer has a real `companies` row, and keeps a
// pick made on the TAB page from silently also applying to that same
// customer's TAC/TAO page (see soa_owners' own migration comment).
export async function PATCH(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account: ApprovedAccount | null = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { companyName, soaPic, company } = await req.json().catch(() => ({})) as {
    companyName?: string; soaPic?: string | null; company?: QbCompany;
  };
  const name = companyName?.trim();
  if (!name) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });
  if (!company || !QB_COMPANIES.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await supabase.from('soa_owners').upsert({
    customer_name_norm: normalize(name),
    customer_name: name,
    qb_company: company,
    soa_pic: soaPic?.trim() || null,
    updated_at: new Date().toISOString(),
    updated_by_email: account.email,
  }, { onConflict: 'customer_name_norm,qb_company' });
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({ ok: true });
}
