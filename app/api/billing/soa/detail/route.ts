import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import type { QbCompany } from '@/lib/quickbooks';
import { agingBucket, dueDate, type AgingBucket } from '@/lib/soa';

const QB_COMPANIES: QbCompany[] = ['TAB', 'TAC', 'TAO'];

// GET /api/billing/soa/detail?companyName=...&company=TAB|TAC|TAO — every
// real unpaid invoice for one company IN ONE QuickBooks system, each tagged
// with its own aging bucket. Backs the SOA detail modal (the line-item list
// shown before generating the merged PDF) so ACC/Chelsea can see exactly
// what's being combined before sending it. Scoped by `company` (2026-09-07)
// so a TAB/TAC/TAO statement never crosses into another system's invoices —
// see app/api/billing/soa/route.ts's own comment for why.
export interface SoaInvoiceDetail {
  qbCompany: string;
  qbInvoiceId: string;
  invoiceNo: string;
  txnDate: string;
  dueDate: string;
  balance: number;
  totalAmt: number;
  bucket: AgingBucket;
}

export async function GET(req: NextRequest) {
  const companyName = req.nextUrl.searchParams.get('companyName')?.trim();
  if (!companyName) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  if (!company || !QB_COMPANIES.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const target = normalize(companyName);

  const invoices = await pageAll(() => supabase
    .from('quickbooks_invoices')
    .select('customer_name, qb_company, qb_invoice_id, invoice_no, txn_date, balance, total_amt')
    .eq('qb_company', company)
    .gt('balance', 0)) as Array<{
      customer_name: string; qb_company: string; qb_invoice_id: string; invoice_no: string;
      txn_date: string | null; balance: number | null; total_amt: number | null;
    }>;

  const byName = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const key = normalize(inv.customer_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(inv);
  }

  let matched = byName.get(target);
  if (!matched) {
    const match = findUniqueBestMatch(companyName, [...byName.entries()], entry => entry[0], 70);
    matched = match.value?.[1];
  }
  if (!matched) return NextResponse.json({ invoices: [] });

  const today = new Date();
  const result: SoaInvoiceDetail[] = matched
    .filter(inv => inv.txn_date && inv.balance)
    .map(inv => ({
      qbCompany: inv.qb_company,
      qbInvoiceId: inv.qb_invoice_id,
      invoiceNo: inv.invoice_no,
      txnDate: inv.txn_date!,
      dueDate: dueDate(inv.txn_date!).toISOString().slice(0, 10),
      balance: inv.balance!,
      totalAmt: inv.total_amt ?? inv.balance!,
      bucket: agingBucket(inv.txn_date!, today),
    }))
    .sort((a, b) => a.txnDate.localeCompare(b.txnDate));

  return NextResponse.json({ invoices: result });
}
