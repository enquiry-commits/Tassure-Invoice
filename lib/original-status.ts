import 'server-only';

import { createAdminClient } from './supabase';
import { pageAll } from './page-all';
import { getValidToken, type QbCompany } from './quickbooks';
import { createHttpAttachmentReader } from './quickbooks-attachments-http';
import { loadInvoiceForClient } from './client-invoice-pdf';
import { findOriginalInvoiceCopy } from './quickbooks-original-copy';
import { rowKey, scanState, splitInvoiceRows, summarizeFile, verdictFromResult, type FileSummary, type OriginalStatusRow, type OriginalVerdict } from './original-status-core';

// What the "Invoice originals" page reads (INV-QB-037): the open invoices
// accounting has split (from the synced rows — no QuickBooks call), the files
// attached to them in QuickBooks (one paged read per book), and, for one
// invoice at a time, what the real PDF path would do with those files. READ
// ONLY: nothing here writes to QuickBooks or to any table.

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export async function loadOpenSplitInvoices(): Promise<OriginalStatusRow[]> {
  const sb = createAdminClient();
  const [items, invoices] = await Promise.all([
    pageAll<{ qb_company: string; qb_invoice_id: string; product_service: string | null }>(() => sb.from('quickbooks_invoice_items').select('qb_company, qb_invoice_id, product_service').ilike('product_service', '%deferred%')),
    pageAll<{ qb_company: string; qb_invoice_id: string; invoice_no: string | null; customer_name: string | null; txn_date: string | null; total_amt: number | null; balance: number | null }>(() => sb.from('quickbooks_invoices').select('qb_company, qb_invoice_id, invoice_no, customer_name, txn_date, total_amt, balance').gt('balance', 0)),
  ]);
  return splitInvoiceRows(items, invoices);
}

export type ScanResult = {
  // rowKey -> the files attached to that invoice (only the books that could be read)
  files: Record<string, FileSummary[]>;
  states: Record<string, 'nothing' | 'no-pdf' | 'has-pdf'>;
  errors: Partial<Record<QbCompany, string>>;
};

export async function scanAttachments(rows: readonly OriginalStatusRow[]): Promise<ScanResult> {
  const out: ScanResult = { files: {}, states: {}, errors: {} };
  const books = [...new Set(rows.map(r => r.company))];
  await Promise.all(books.map(async book => {
    try {
      const token = await getValidToken(book);
      if (!token) throw new Error(`QuickBooks ${book} is not connected`);
      const all = await createHttpAttachmentReader({ base: QB_BASE, realmId: token.realm_id, accessToken: token.access_token, timeoutMs: 30_000 }).listAllForInvoices();
      for (const row of rows.filter(r => r.company === book)) {
        const files = (all.get(row.qbInvoiceId) ?? []).map(summarizeFile);
        out.files[rowKey(row)] = files;
        out.states[rowKey(row)] = scanState(files);
      }
    } catch (err) {
      out.errors[book] = err instanceof Error ? err.message : String(err);
    }
  }));
  return out;
}

// What getClientInvoicePdf would do for this invoice: the SAME invoice read, the
// SAME facts, the SAME look-up (lib/client-invoice-pdf.ts loadInvoiceForClient +
// lib/quickbooks-original-copy.ts), so the page never says something the real
// path would not do.
export async function checkInvoiceOriginal(company: QbCompany, invoiceId: string): Promise<OriginalVerdict> {
  const loaded = await loadInvoiceForClient(company, invoiceId);
  if (!loaded) return { verdict: 'unavailable', summary: 'The invoice could not be read from QuickBooks.', files: [] };
  if (!loaded.facts) {
    return { verdict: 'not-split', summary: 'This invoice no longer carries a Deferred Revenue line (or lacks a number, date or customer), so QuickBooks\' own PDF is used for it.', files: [] };
  }
  return verdictFromResult(await findOriginalInvoiceCopy(company, invoiceId, loaded.facts));
}
