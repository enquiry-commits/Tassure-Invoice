import { displayInvoiceNo, invoicePdfFileName } from './invoice-filename';

// Monthly originals export (Vincent, 2026-10-08): "导出当月开过的发票…压缩到一个ZIP内…TAB/TAC/TAO 三个" — Chelsea files the PDFs
// on the file server. Pure rules (no I/O) shared by the page, the API and the guard test (INV-QB-040).
//   - the month is the INVOICE DATE (TxnDate), like QuickBooks' own reports;
//   - voided invoices ARE included, file name marked VOID; credit notes are not invoices and are not included;
//   - only the invoice's ORIGINAL goes in (lib/invoice-versions.ts) — one without a proven original is NOT replaced
//     by a redraw: it is listed in MISSING.csv so Chelsea fetches it from the server herself.

export type ExportBook = 'TAB' | 'TAC' | 'TAO';
export const EXPORT_BOOKS: readonly ExportBook[] = ['TAB', 'TAC', 'TAO'];

// Only these two take the export (Vincent and Chelsea — the boss's request goes to them).
export const ORIGINALS_EXPORT_EMAILS: readonly string[] = ['vincent@tassure.com', 'chelsea@tassure.com'];
export const canExportOriginals = (email: string | null | undefined): boolean =>
  !!email && ORIGINALS_EXPORT_EMAILS.includes(email.trim().toLowerCase());

export const isMonth = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);

/** First and last day (YYYY-MM-DD) of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  if (!isMonth(month)) throw new Error(`"${month}" is not a month (YYYY-MM)`);
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** The month before `today` (YYYY-MM-DD) as YYYY-MM — the one the monthly task asks for. */
export function previousMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export type ExportInvoice = { book: ExportBook; qbInvoiceId: string; invoiceNo: string; txnDate: string | null; customerName: string; totalAmt: number; status: string };
export type ExportOutcome = ExportInvoice & { source: 'quickbooks' | 'attachment' | null; reason: string | null; fileName: string | null };

/** The PDF's name inside the ZIP — the house name (invoice-filename.ts), marked VOID for a voided invoice. */
export function exportFileName(inv: Pick<ExportInvoice, 'book' | 'invoiceNo' | 'customerName' | 'totalAmt' | 'status'>): string {
  const base = invoicePdfFileName(inv.book, inv.invoiceNo, inv.customerName, inv.totalAmt);
  return inv.status === 'Voided' ? base.replace(/\.pdf$/i, '-VOID.pdf') : base;
}

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvLine = (cells: unknown[]) => cells.map(csvCell).join(',');
const SOURCE_LABEL: Record<'quickbooks' | 'attachment', string> = {
  quickbooks: 'QuickBooks PDF (invoice not split = the original)',
  attachment: 'Original attached in QuickBooks',
};

/** manifest.csv: every invoice of the month and where its PDF came from (or why it is not in the ZIP). */
export function buildManifestCsv(outcomes: readonly ExportOutcome[]): string {
  const head = csvLine(['Invoice No', 'Date', 'Customer', 'Total', 'Status', 'File', 'Source']);
  const lines = outcomes.map(o => csvLine([displayInvoiceNo(o.invoiceNo), o.txnDate ?? '', o.customerName, o.totalAmt.toFixed(2), o.status, o.fileName ?? '', o.source ? SOURCE_LABEL[o.source] : `MISSING — ${o.reason ?? 'no original'}`]));
  return '﻿' + [head, ...lines].join('\r\n') + '\r\n';
}

/** MISSING.csv: invoices with no proven original — Chelsea takes these from the file server. */
export function buildMissingCsv(outcomes: readonly ExportOutcome[]): string {
  const head = csvLine(['Invoice No', 'Date', 'Customer', 'Total', 'Status', 'Why no original']);
  const lines = outcomes.filter(o => !o.source).map(o => csvLine([displayInvoiceNo(o.invoiceNo), o.txnDate ?? '', o.customerName, o.totalAmt.toFixed(2), o.status, o.reason ?? 'no original']));
  return '﻿' + [head, ...lines].join('\r\n') + '\r\n';
}

export const zipName = (book: ExportBook, month: string) => `${book}-originals-${month}.zip`;

/** A file name never used twice inside one ZIP (two invoices can print the same name). */
export function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name; }
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} (${n})${ext}`;
    if (!used.has(candidate.toLowerCase())) { used.add(candidate.toLowerCase()); return candidate; }
  }
}
