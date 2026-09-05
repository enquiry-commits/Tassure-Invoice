import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { agingBucket, emptyAgingTotals, type AgingTotals } from '@/lib/soa';

// GET /api/billing/soa — every company with a real outstanding QuickBooks
// balance (any of TAB/TAC/TAO), aged into the same Current/1-30/31-60/
// 61-90/91+ buckets as QuickBooks' own AgedReceivables report and Vincent's
// real collections spreadsheet ("Individual outstanding billing"). This is
// the automation target for the manual PDF-merge step Chelsea does today —
// see app/billing/soa/pdf/route.ts for the actual merge.
export interface SoaCompanyRow {
  companyName: string;
  companyId: number | null;
  pic: string | null;
  invoiceCount: number;
  totalOutstanding: number;
  aging: AgingTotals;
}

type UnpaidInvoice = { customer_name: string; qb_company: string; invoice_no: string; txn_date: string | null; balance: number | null };

export async function GET() {
  const supabase = createAdminClient();

  const [invoices, companiesRes] = await Promise.all([
    pageAll(() => supabase
      .from('quickbooks_invoices')
      .select('customer_name, qb_company, invoice_no, txn_date, balance')
      .gt('balance', 0)) as Promise<UnpaidInvoice[]>,
    supabase.from('companies').select('id, company_name, pic'),
  ]);
  if (companiesRes.error) return NextResponse.json({ error: companiesRes.error.message }, { status: 503 });

  const companies = companiesRes.data ?? [];
  const companyByNormName = new Map(companies.map(c => [normalize(c.company_name), c]));
  const wordMatch = (name: string) => {
    const exact = companyByNormName.get(name);
    if (exact) return exact;
    const match = findUniqueBestMatch(name, [...companyByNormName.entries()], entry => entry[0], 70);
    return match.value?.[1] ?? null;
  };

  const today = new Date();
  const byCompany = new Map<string, { displayName: string; invoiceCount: number; total: number; aging: AgingTotals }>();
  for (const inv of invoices) {
    if (!inv.txn_date || !inv.balance) continue;
    const key = normalize(inv.customer_name);
    if (!key) continue;
    if (!byCompany.has(key)) byCompany.set(key, { displayName: inv.customer_name, invoiceCount: 0, total: 0, aging: emptyAgingTotals() });
    const entry = byCompany.get(key)!;
    entry.invoiceCount += 1;
    entry.total += inv.balance;
    entry.aging[agingBucket(inv.txn_date, today)] += inv.balance;
  }

  const rows: SoaCompanyRow[] = [...byCompany.entries()].map(([key, entry]) => {
    const companyMatch = companyByNormName.get(key) ?? wordMatch(key);
    return {
      companyName: companyMatch?.company_name ?? entry.displayName,
      companyId: companyMatch?.id ?? null,
      pic: companyMatch?.pic ?? null,
      invoiceCount: entry.invoiceCount,
      totalOutstanding: Math.round(entry.total * 100) / 100,
      aging: entry.aging,
    };
  }).sort((a, b) => b.totalOutstanding - a.totalOutstanding);

  return NextResponse.json({ companies: rows });
}
