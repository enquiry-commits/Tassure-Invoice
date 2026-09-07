import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { formatStaffNameList } from '@/lib/staff-directory';
import { getApprovedAccount, type ApprovedAccount } from '@/lib/approved-accounts';
import type { QbCompany } from '@/lib/quickbooks';
import { agingBucket, emptyAgingTotals, type AgingTotals } from '@/lib/soa';
import { computeSuggestedOwner, type OwnerInvoiceSignal } from '@/lib/soa-owner';

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
export interface SoaCompanyRow {
  companyName: string;
  companyId: number | null;
  pic: string | null;
  // Every individual person decomposed out of `pic` (see
  // lib/staff-directory.ts's formatStaffNameList) — `pic` can legitimately
  // list 2+ co-assigned people ("Chin Kah Ye, Ang Shi Ming"), and this backs
  // the dropdown Chelsea uses to say which ONE of them actually owns
  // chasing THIS company's outstanding balance.
  picOptions: string[];
  // Chelsea's manual pick, from soa_owners (keyed by normalized customer
  // name, NOT companies.id — see that table's own migration comment: 18%
  // of real customers with a balance have no matching `companies` row at
  // all — some are individuals, some are genuine companies never onboarded
  // via TeamWork, and bulk-matching the rest risked merging two genuinely
  // different real companies that just share a naming pattern).
  soaPic: string | null;
  // Chelsea's real rule, computed automatically from THIS company's own
  // unpaid invoices — line Class first, that invoice's own Location as
  // fallback (see lib/soa-owner.ts) — so a default no longer has to wait on
  // manual Google Sheet backfill. null only when no unpaid invoice here has
  // a resolvable Class or Location at all.
  suggestedOwner: string | null;
  invoiceCount: number;
  totalOutstanding: number;
  aging: AgingTotals;
}

type UnpaidInvoice = {
  customer_name: string; qb_company: string; qb_invoice_id: string; invoice_no: string;
  txn_date: string | null; balance: number | null; location_name: string | null;
};

export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  if (!company || !QB_COMPANIES.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const [invoices, companiesRes, ownersRes] = await Promise.all([
    pageAll(() => supabase
      .from('quickbooks_invoices')
      .select('customer_name, qb_company, qb_invoice_id, invoice_no, txn_date, balance, location_name')
      .eq('qb_company', company)
      .gt('balance', 0)) as Promise<UnpaidInvoice[]>,
    supabase.from('companies').select('id, company_name, pic'),
    supabase.from('soa_owners').select('customer_name_norm, soa_pic'),
  ]);
  if (companiesRes.error) return NextResponse.json({ error: companiesRes.error.message }, { status: 503 });
  if (ownersRes.error) return NextResponse.json({ error: ownersRes.error.message }, { status: 503 });

  // Class is per LINE, not per invoice (Chelsea's primary signal — see
  // lib/soa-owner.ts) — a second, narrower query against just these same
  // unpaid invoices' own items, not the whole quickbooks_invoice_items
  // table (which also holds years of paid/irrelevant history).
  const unpaidInvoiceIds = [...new Set(invoices.map(inv => inv.qb_invoice_id).filter(Boolean))];
  const classNamesByInvoice = new Map<string, string[]>();
  if (unpaidInvoiceIds.length) {
    const { data: items, error: itemsError } = await supabase
      .from('quickbooks_invoice_items')
      .select('qb_invoice_id, class_name')
      .eq('qb_company', company)
      .in('qb_invoice_id', unpaidInvoiceIds)
      .not('class_name', 'is', null);
    if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 503 });
    for (const item of items ?? []) {
      if (!item.class_name) continue;
      const list = classNamesByInvoice.get(item.qb_invoice_id) ?? [];
      list.push(item.class_name);
      classNamesByInvoice.set(item.qb_invoice_id, list);
    }
  }

  const companies = companiesRes.data ?? [];
  const companyByNormName = new Map(companies.map(c => [normalize(c.company_name), c]));
  const wordMatch = (name: string) => {
    const exact = companyByNormName.get(name);
    if (exact) return exact;
    const match = findUniqueBestMatch(name, [...companyByNormName.entries()], entry => entry[0], 70);
    return match.value?.[1] ?? null;
  };
  const ownerByNormName = new Map((ownersRes.data ?? []).map(o => [o.customer_name_norm, o.soa_pic]));

  const today = new Date();
  const byCompany = new Map<string, {
    displayName: string; invoiceCount: number; total: number; aging: AgingTotals; signals: OwnerInvoiceSignal[];
  }>();
  for (const inv of invoices) {
    if (!inv.txn_date || !inv.balance) continue;
    const key = normalize(inv.customer_name);
    if (!key) continue;
    if (!byCompany.has(key)) byCompany.set(key, { displayName: inv.customer_name, invoiceCount: 0, total: 0, aging: emptyAgingTotals(), signals: [] });
    const entry = byCompany.get(key)!;
    entry.invoiceCount += 1;
    entry.total += inv.balance;
    entry.aging[agingBucket(inv.txn_date, today)] += inv.balance;
    entry.signals.push({ qbInvoiceId: inv.qb_invoice_id, txnDate: inv.txn_date, locationName: inv.location_name });
  }

  const rows: SoaCompanyRow[] = [...byCompany.entries()].map(([key, entry]) => {
    const companyMatch = companyByNormName.get(key) ?? wordMatch(key);
    return {
      companyName: companyMatch?.company_name ?? entry.displayName,
      companyId: companyMatch?.id ?? null,
      pic: companyMatch?.pic ?? null,
      picOptions: formatStaffNameList(companyMatch?.pic ?? null),
      soaPic: ownerByNormName.get(key) ?? null,
      suggestedOwner: computeSuggestedOwner(entry.signals, classNamesByInvoice),
      invoiceCount: entry.invoiceCount,
      totalOutstanding: Math.round(entry.total * 100) / 100,
      aging: entry.aging,
    };
  }).sort((a, b) => b.totalOutstanding - a.totalOutstanding);

  return NextResponse.json({ companies: rows });
}

// PATCH /api/billing/soa — Chelsea's manual pick of who owns chasing one
// customer's outstanding balance. Keyed by name (via soa_owners), not
// companies.id — works identically whether or not this customer has a real
// `companies` row.
export async function PATCH(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account: ApprovedAccount | null = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { companyName, soaPic } = await req.json().catch(() => ({})) as { companyName?: string; soaPic?: string | null };
  const name = companyName?.trim();
  if (!name) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('soa_owners').upsert({
    customer_name_norm: normalize(name),
    customer_name: name,
    soa_pic: soaPic?.trim() || null,
    updated_at: new Date().toISOString(),
    updated_by_email: account.email,
  }, { onConflict: 'customer_name_norm' });
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });
  return NextResponse.json({ ok: true });
}
