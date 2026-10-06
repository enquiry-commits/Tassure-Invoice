// The "Invoice Originals" page (app/billing/soa/originals/page.tsx): the work
// queue of the open invoices accounting has split that still have NO original
// the system accepts. Vincent's order is the original attached in QuickBooks,
// then staff find it (Outlook Sent Items, the file server) and attach it, and
// the redraw last (INV-QB-037) — an invoice whose original is already in use
// is finished work and is not listed (Vincent, 2026-10-06: "已经拿到原装发票的
// 其实就已经不需要在 Invoice Originals 页面内了"). Staff upload the original
// they found on the page itself (lib/original-upload.ts).
//
// Pure (no I/O); the reading is lib/original-status.ts.

import { isDeferredItem } from './deferred-pairing';
import { INVOICE_COPY_NOTE } from './quickbooks-attachments';
import { isPdfFile, type AttachmentFile, type InvoiceFacts, type OriginalCopyResult, type TriedAttachment } from './original-copy';

export type OriginalStatusRow = {
  company: 'TAB' | 'TAC' | 'TAO';
  qbInvoiceId: string;
  invoiceNo: string;
  customerName: string;
  txnDate: string | null;
  totalAmt: number;
  balance: number;
};

export const rowKey = (r: { company: string; qbInvoiceId: string }): string => `${r.company}|${r.qbInvoiceId}`;

type ItemRow = { qb_company: string; qb_invoice_id: string | number; product_service: string | null };
type InvoiceRow = {
  qb_company: string; qb_invoice_id: string | number; invoice_no: string | null; customer_name: string | null;
  txn_date: string | null; total_amt: number | string | null; balance: number | string | null;
};

// The open invoices that carry a Deferred Revenue line (accounting's split), newest first.
export function splitInvoiceRows(items: readonly ItemRow[], invoices: readonly InvoiceRow[]): OriginalStatusRow[] {
  const split = new Set(items.filter(i => isDeferredItem(i.product_service)).map(i => `${i.qb_company}|${i.qb_invoice_id}`));
  return invoices
    .filter(inv => Number(inv.balance) > 0 && split.has(`${inv.qb_company}|${inv.qb_invoice_id}`) && ['TAB', 'TAC', 'TAO'].includes(inv.qb_company))
    .map(inv => ({
      company: inv.qb_company as OriginalStatusRow['company'],
      qbInvoiceId: String(inv.qb_invoice_id),
      invoiceNo: String(inv.invoice_no ?? ''),
      customerName: String(inv.customer_name ?? ''),
      txnDate: inv.txn_date ? String(inv.txn_date).slice(0, 10) : null,
      totalAmt: Number(inv.total_amt ?? 0),
      balance: Number(inv.balance ?? 0),
    }))
    .sort((a, b) => String(b.txnDate ?? '').localeCompare(String(a.txnDate ?? '')) || b.invoiceNo.localeCompare(a.invoiceNo));
}

// What the browser is told about an attached file (no download link: it is a
// signed link to a client's invoice, and the page has no use for it).
export type FileSummary = { id: string; fileName: string; contentType: string | null; size: number | null; bySystem: boolean; createdAt: string | null; pdf: boolean };

export function summarizeFile(f: AttachmentFile): FileSummary {
  return {
    id: f.Id,
    fileName: f.FileName ?? `#${f.Id}`,
    contentType: f.ContentType ?? null,
    size: f.Size ?? null,
    bySystem: f.Note === INVOICE_COPY_NOTE,
    createdAt: f.CreateTime ?? null,
    pdf: isPdfFile(f),
  };
}

// ── the queue ────────────────────────────────────────────────────────────

// Why an invoice is still waiting: nothing is attached, only files that are not
// PDFs are, or PDFs are attached and the proof did not accept any of them.
export type QueueState = 'nothing' | 'no-pdf' | 'refused';

export type QueueRow = OriginalStatusRow & {
  state: QueueState;
  // Every file attached to the invoice and what the look-up did with it, with the
  // reason (lib/original-copy.ts) — a file that is not a PDF included.
  tried: TriedAttachment[];
  // What the client gets while there is no original: the system's redraw, or — when the
  // system cannot draw the invoice — QuickBooks' own PDF with accounting's lines showing.
  fallback: string;
};

// The queue entry for one invoice, or null when its original is in use (done).
// `result` is the answer of the SAME look-up the SOA uses (selectVerifiedOriginal).
export function queueRowFor(row: OriginalStatusRow, files: readonly AttachmentFile[], result: OriginalCopyResult, fallback: string): QueueRow | null {
  if ('found' in result) return null;
  const state: QueueState = !files.length ? 'nothing' : files.some(isPdfFile) ? 'refused' : 'no-pdf';
  return { ...row, state, tried: result.tried, fallback };
}

// What one open split invoice is, from everything known about it NOW (no I/O): paid, voided, deleted or no longer
// split since the last sync -> 'closed'; its original is in use -> 'done' (this wins over a decision); Vincent decided
// to leave it as it is, and it is still the invoice he decided about -> 'decided'; otherwise it is waiting for an
// original (a QueueRow, with the LIVE figures and not the synced ones).
export type QueueOutcome = QueueRow | 'closed' | 'done' | 'decided';
export function queueOutcome(input: {
  row: OriginalStatusRow;
  live: { balance: number; totalAmt?: number; txnDate?: string } | null;
  split: boolean;
  files: readonly AttachmentFile[];
  answer: OriginalCopyResult | { found: true } | null;
  decided: boolean;
  fallback: string;
}): QueueOutcome {
  const { row, live, answer } = input;
  if (!live || !(live.balance > 0) || !input.split || !answer) return 'closed';
  if ('found' in answer) return 'done';
  if (input.decided) return 'decided';
  return queueRowFor({ ...row, balance: live.balance, totalAmt: live.totalAmt ?? row.totalAmt, txnDate: live.txnDate ?? row.txnDate }, input.files, answer, input.fallback) ?? 'done';
}

// What goes out for an invoice with no original: from the system's own decision for it (lib/client-invoice-model.ts).
export function fallbackWording(decision: { kind: 'system' } | { kind: 'quickbooks'; reason: string | null }): string {
  return decision.kind === 'system'
    ? 'The system redraws this invoice (each service once, at its full amount).'
    : `QuickBooks' own PDF is sent, with accounting's Deferred Revenue lines showing — the system cannot draw this invoice: ${decision.reason ?? 'nothing to fold'}.`;
}

export type QueueResult = {
  rows: QueueRow[];
  // Open split invoices whose original is in use (not listed).
  done: number;
  // Open split invoices Vincent decided to leave as they are (lib/original-decisions.ts) — not listed either.
  decided: number;
  // Invoices of a book QuickBooks could not be read for — not known either way, so not listed.
  unknown: number;
  errors: Partial<Record<'TAB' | 'TAC' | 'TAO', string>>;
  generatedAt: string;
};

// Ids for one batched QuickBooks read (SELECT … WHERE Id IN (…)): numeric only,
// so nothing but digits ever reaches the query text.
export function invoicesByIdQuery(ids: readonly string[]): string {
  if (!ids.length) throw new Error('no invoice ids to read');
  for (const id of ids) if (!/^\d+$/.test(id)) throw new Error(`"${id}" is not a QuickBooks id`);
  return `SELECT * FROM Invoice WHERE Id IN (${ids.map(id => `'${id}'`).join(',')}) MAXRESULTS 1000`;
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Runs fn over items with at most `limit` in flight; the results keep the order of the items.
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// What a look-up's answer depends on: the invoice as it is NOW and the files
// attached to it. The same key means the same answer, so an answer is reused
// until either changes (an edited invoice or a new file gets a new key).
export function verdictKey(company: string, invoiceId: string, facts: InvoiceFacts, files: readonly AttachmentFile[]): string {
  const filesPart = [...files].map(f => `${f.Id}:${f.Size ?? ''}:${f.CreateTime ?? ''}:${f.FileName ?? ''}`).sort().join(',');
  return `${company}|${invoiceId}|${JSON.stringify(facts)}|${filesPart}`;
}

// What to do about a refused file, in words staff can act on — the reasons come
// from lib/original-copy.ts (exact, but written for the logs and the tests).
export function hintForReason(reason: string): string | null {
  if (/company letterhead/.test(reason)) return 'This file was not printed by QuickBooks (it may be the Save PDF file saved again). Find the PDF QuickBooks printed when the invoice was sent.';
  if (/system's own drawing/.test(reason)) return 'This is the Save PDF file, not the original. Find the PDF QuickBooks printed when the invoice was sent.';
  if (/amounts are not/.test(reason)) return 'This looks like the split version, or another version of the invoice. Find the PDF the client first received.';
  if (/pages and only|has no text/.test(reason)) return 'Use one normal PDF of this invoice only — not a scan, a picture or several invoices in one file. A scanned or photographed copy cannot be checked.';
  if (/not a PDF/.test(reason)) return 'Only a PDF file is used — upload the invoice as a PDF, not a picture or another kind of file.';
  if (/encrypted|password|could not be read/i.test(reason)) return 'Use a normal PDF without a password.';
  if (/is not dated|does not say "TOTAL/.test(reason)) return 'The invoice was changed after this PDF was made (its date or total no longer matches). Find out which version the client received before using any file.';
  if (/INVOICE NO|is not billed to/.test(reason)) return 'This is not the PDF of this invoice — check its invoice number and customer.';
  if (/larger than/.test(reason)) return 'An invoice PDF is well under 1 MB — use the PDF QuickBooks printed, not a scan.';
  return null;
}
