import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import type { QbCompany } from '@/lib/quickbooks';
import { agingBucket, dueDate, type AgingBucket } from '@/lib/soa';
import { loadArAgingSnapshot } from '@/lib/soa-data';

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
  qbInvoiceId: string | null;
  invoiceNo: string;
  txnDate: string;
  dueDate: string;
  balance: number;
  totalAmt: number;
  bucket: AgingBucket;
  // 'invoice'/'credit' cover the two document types Chelsea can actually
  // open an official PDF for; 'other' (Payment/Journal Entry/Deposit/
  // anything QuickBooks' own AgedReceivableDetail report enumerates that
  // isn't one of those two) has no such document — see rawType for what it
  // actually is. Before 2026-09-15 this list only ever showed Invoice/
  // CreditMemo rows, so a customer whose balance was driven by e.g. a
  // Journal Entry (see docs/INVARIANTS.md INV-QB-017 — the Cyber Quantum
  // Pte Ltd example) showed nothing for that portion at all.
  type: 'invoice' | 'credit' | 'other';
  rawType: string;
}

export async function GET(req: NextRequest) {
  const companyName = req.nextUrl.searchParams.get('companyName')?.trim();
  if (!companyName) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  if (!company || !QB_COMPANIES.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO' }, { status: 400 });
  }

  const target = normalize(companyName);
  const snapshot = await loadArAgingSnapshot(company, companyName);

  if (snapshot.fresh) {
    const byName = new Map<string, typeof snapshot.rows>();
    for (const row of snapshot.rows) {
      const key = normalize(row.customerName);
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key)!.push(row);
    }
    let matched = byName.get(target);
    if (!matched) {
      const match = findUniqueBestMatch(companyName, [...byName.entries()], entry => entry[0], 70);
      matched = match.value?.[1];
    }
    const result: SoaInvoiceDetail[] = (matched ?? [])
      .filter(row => row.txnDate)
      .map(row => {
        const isInvoice = /invoice/i.test(row.txnType);
        const isCredit = /credit/i.test(row.txnType);
        return {
          qbCompany: company,
          qbInvoiceId: row.qbTxnId,
          invoiceNo: row.docNumber ?? row.qbTxnId ?? '—',
          txnDate: row.txnDate!,
          dueDate: row.dueDate ?? row.txnDate!,
          balance: row.openBalance,
          totalAmt: row.amount ?? row.openBalance,
          bucket: row.agingBucket,
          type: isInvoice ? 'invoice' as const : isCredit ? 'credit' as const : 'other' as const,
          rawType: row.txnType,
        };
      })
      .sort((a, b) => a.txnDate.localeCompare(b.txnDate));
    return NextResponse.json({ invoices: result });
  }

  // Fallback — report snapshot missing/stale for this company. Today's
  // pre-report Invoice+CreditMemo query, kept verbatim as the degraded-mode
  // behavior (see lib/soa-data.ts's legacyComputeSoaRows() for the same
  // pattern applied to the on-screen list/total).
  const supabase = createAdminClient();

  const [invoices, creditMemos] = await Promise.all([
    pageAll(() => supabase
      .from('quickbooks_invoices')
      .select('customer_name, qb_company, qb_invoice_id, invoice_no, txn_date, balance, total_amt')
      .eq('qb_company', company)
      .gt('balance', 0)) as Promise<Array<{
        customer_name: string; qb_company: string; qb_invoice_id: string; invoice_no: string;
        txn_date: string | null; balance: number | null; total_amt: number | null;
      }>>,
    pageAll(() => supabase
      .from('quickbooks_credit_memos')
      .select('customer_name, qb_company, qb_credit_memo_id, doc_number, txn_date, balance, total_amt')
      .eq('qb_company', company)
      .gt('balance', 0)) as Promise<Array<{
        customer_name: string; qb_company: string; qb_credit_memo_id: string; doc_number: string | null;
        txn_date: string | null; balance: number | null; total_amt: number | null;
      }>>,
  ]);

  const byName = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const key = normalize(inv.customer_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(inv);
  }
  const creditByName = new Map<string, typeof creditMemos>();
  for (const cm of creditMemos) {
    const key = normalize(cm.customer_name);
    if (!key) continue;
    if (!creditByName.has(key)) creditByName.set(key, []);
    creditByName.get(key)!.push(cm);
  }

  let matched = byName.get(target);
  if (!matched) {
    const match = findUniqueBestMatch(companyName, [...byName.entries()], entry => entry[0], 70);
    matched = match.value?.[1];
  }
  let matchedCredits = creditByName.get(target);
  if (!matchedCredits) {
    const match = findUniqueBestMatch(companyName, [...creditByName.entries()], entry => entry[0], 70);
    matchedCredits = match.value?.[1];
  }
  if (!matched && !matchedCredits) return NextResponse.json({ invoices: [] });

  const today = new Date();
  const invoiceRows: SoaInvoiceDetail[] = (matched ?? [])
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
      type: 'invoice' as const,
      rawType: 'Invoice',
    }));
  const creditRows: SoaInvoiceDetail[] = (matchedCredits ?? [])
    .filter(cm => cm.txn_date && cm.balance)
    .map(cm => ({
      qbCompany: cm.qb_company,
      qbInvoiceId: cm.qb_credit_memo_id,
      invoiceNo: cm.doc_number ?? cm.qb_credit_memo_id,
      txnDate: cm.txn_date!,
      dueDate: dueDate(cm.txn_date!).toISOString().slice(0, 10),
      balance: -cm.balance!,
      totalAmt: -(cm.total_amt ?? cm.balance!),
      bucket: agingBucket(cm.txn_date!, today),
      type: 'credit' as const,
      rawType: 'Credit Note',
    }));

  const result = [...invoiceRows, ...creditRows].sort((a, b) => a.txnDate.localeCompare(b.txnDate));

  return NextResponse.json({ invoices: result });
}
