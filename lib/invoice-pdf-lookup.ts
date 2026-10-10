import 'server-only';
import { createAdminClient } from './supabase';
import { ilikeAny } from './postgrest-or';
import { isDeferredItem } from './deferred-pairing';
import type { InvoicePdfItem, InvoicePdfPreview } from './invoice-pdf-card';

// find_invoice_pdf (assistant): the invoices matching an invoice number or a company name, newest first, from the
// synced quickbooks_invoices table (near-real-time, INV-QB-021). Read-only. `split` = the invoice has a Deferred line,
// i.e. accounting has split it (INV-QB-029) — the only case where Original and Latest differ.
const MAX_INVOICES = 8;

// PostgREST's or() filter breaks on these characters inside a value
const cleanTerm = (q: string) => q.replace(/[,()%*\\"']/g, ' ').replace(/\s+/g, ' ').trim();

export async function findInvoicesForPdf(rawQuery: string): Promise<{ found: false; message: string } | { found: true; preview: InvoicePdfPreview }> {
  const q = cleanTerm(rawQuery);
  if (q.length < 3) return { found: false, message: 'Give an invoice number (e.g. 02611132) or at least 3 letters of the company name.' };
  const sb = createAdminClient();
  const { data, error } = await sb.from('quickbooks_invoices')
    .select('qb_company, qb_invoice_id, invoice_no, txn_date, customer_name, total_amt, status')
    .or(ilikeAny(['invoice_no', 'customer_name'], q))
    .order('txn_date', { ascending: false })
    .limit(MAX_INVOICES + 1);
  if (error) return { found: false, message: `Could not search invoices: ${error.message}` };
  const rows = (data ?? []).filter(r => r.qb_company === 'TAB' || r.qb_company === 'TAC' || r.qb_company === 'TAO');
  if (!rows.length) return { found: false, message: `No invoice found for "${rawQuery}" in the synced QuickBooks invoices (TAB / TAC / TAO).` };
  const shown = rows.slice(0, MAX_INVOICES);

  const splitKeys = new Set<string>();
  const { data: items } = await sb.from('quickbooks_invoice_items')
    .select('qb_company, qb_invoice_id, product_service')
    .in('qb_invoice_id', shown.map(r => r.qb_invoice_id))
    .ilike('product_service', '%deferred%');
  for (const it of items ?? []) if (isDeferredItem(it.product_service)) splitKeys.add(`${it.qb_company}|${it.qb_invoice_id}`);

  const invoices: InvoicePdfItem[] = shown.map(r => ({
    book: r.qb_company as InvoicePdfItem['book'],
    qbInvoiceId: r.qb_invoice_id,
    invoiceNo: r.invoice_no ?? r.qb_invoice_id,
    txnDate: r.txn_date,
    customerName: r.customer_name ?? '',
    totalAmt: Number(r.total_amt ?? 0),
    status: r.status ?? 'Open',
    split: splitKeys.has(`${r.qb_company}|${r.qb_invoice_id}`),
  }));
  return { found: true, preview: { query: rawQuery, invoices, truncated: rows.length > MAX_INVOICES } };
}
