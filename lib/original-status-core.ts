// The "Invoice originals" status page (app/billing/soa/originals/page.tsx):
// which open invoices accounting has split already have their ORIGINAL attached
// in QuickBooks and in use, which have a file the system refused (and why), and
// which have nothing yet. Vincent's order is the original in QuickBooks first,
// then staff fetch it from the file server and attach it, and the redraw last
// (INV-QB-037) — this page is the work queue for that. Pure (no I/O); the
// reading is lib/original-status.ts. The page only READS: it never attaches,
// moves or deletes anything in QuickBooks.

import { isDeferredItem } from './deferred-pairing';
import { INVOICE_COPY_NOTE } from './quickbooks-attachments';
import { isPdfFile, type AttachmentFile, type OriginalCopyResult, type TriedAttachment } from './original-copy';

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

// From the overview (no file opened yet): nothing attached / attached but no PDF
// / at least one PDF, which has to be opened to know whether it is the original.
export type ScanState = 'nothing' | 'no-pdf' | 'has-pdf';
export function scanState(files: readonly FileSummary[]): ScanState {
  if (!files.length) return 'nothing';
  return files.some(f => f.pdf) ? 'has-pdf' : 'no-pdf';
}

// What the page shows for one row, from what is known so far: the overview
// (no file opened), the answer of opening the files, or neither yet.
export type RowStatus = 'scanning' | 'nothing' | 'no-pdf' | 'to-check' | 'checking' | 'using' | 'refused' | 'unavailable' | 'not-split' | 'failed';

export function rowStatus(known: { scanLoaded: boolean; scanError?: string; scan?: ScanState; verdict?: OriginalVerdict | 'checking' | { failed: string } }): RowStatus {
  const v = known.verdict;
  if (v === 'checking') return 'checking';
  if (v && 'failed' in v) return 'failed';
  if (v) return v.verdict;
  if (!known.scanLoaded) return 'scanning';
  if (known.scanError || !known.scan) return 'unavailable';
  return known.scan === 'has-pdf' ? 'to-check' : known.scan;
}

// What to do about a refused file, in words staff can act on — the reasons come
// from lib/original-copy.ts (exact, but written for the logs and the tests).
export function hintForReason(reason: string): string | null {
  if (/system's own drawing/.test(reason)) return 'Do not use the Save PDF file. Attach the PDF the way QuickBooks printed it when the invoice was sent.';
  if (/amounts are not/.test(reason)) return 'This looks like the split version, or another version of the invoice. Attach the PDF the client first received.';
  if (/pages and only|has no text/.test(reason)) return 'Attach one normal PDF of this invoice only — not a scan, a picture or several invoices in one file.';
  if (/encrypted|password|could not be read|is not a PDF|not a PDF/i.test(reason)) return 'Attach a normal PDF without a password.';
  if (/INVOICE NO|is not dated|is not billed to|does not say "TOTAL/.test(reason)) return 'This is not the PDF of this invoice — check its invoice number, date, customer and total.';
  if (/larger than/.test(reason)) return 'An invoice PDF is well under 1 MB — attach the PDF QuickBooks printed, not a scan.';
  return null;
}

// The answer of opening the files (what getClientInvoicePdf would do).
export type OriginalVerdict = {
  verdict: 'using' | 'refused' | 'nothing' | 'unavailable' | 'not-split';
  summary: string;
  files: TriedAttachment[];
};

export function verdictFromResult(result: OriginalCopyResult): OriginalVerdict {
  if ('found' in result) {
    const used = result.tried.find(t => t.outcome === 'used');
    return {
      verdict: 'using',
      summary: `Using the attached original${used ? ` (${used.bySystem ? 'attached by the system' : 'attached by hand'})` : ''}.`,
      files: result.tried,
    };
  }
  if (result.trouble) return { verdict: 'unavailable', summary: `QuickBooks could not be asked: ${result.none}`, files: result.tried };
  if (!result.tried.length) {
    // The look-up is switched off for the book, or the invoice could not be asked about.
    return /not looked up|not connected|not a QuickBooks invoice id/.test(result.none)
      ? { verdict: 'unavailable', summary: result.none, files: [] }
      : { verdict: 'nothing', summary: 'Nothing is attached to this invoice in QuickBooks.', files: [] };
  }
  return {
    verdict: 'refused',
    summary: 'Files are attached, but none is accepted as the original — the system redraws this invoice.',
    files: result.tried,
  };
}
