import { fetchQuickBooksInvoicePdf, loadInvoiceForClient } from './client-invoice-pdf';
import { findOriginalInvoiceCopy } from './quickbooks-original-copy';
import type { QbCompany } from './quickbooks';

// "Original" vs "Latest" of ONE invoice (Vincent, 2026-10-08) — the assistant's invoice card and the monthly
// originals ZIP both ask THIS function what the client first received, so the two can never disagree.
//
//   Latest   = QuickBooks' own PDF now (what accounting's split looks like) — /api/quickbooks/invoice-pdf.
//   Original = the invoice as the client first received it:
//     - NOT split by accounting: QuickBooks' current PDF IS the original;
//     - split: only the PDF attached in QuickBooks that PROVES it is the original (INV-QB-037) — the system's
//       copy made at billing time (INV-QB-036) or a hand-attached one. NEVER the system's redraw: a redraw is not
//       an original, and the files go to the file server as originals. No proven attachment = `missing`, with why.
// Read-only toward QuickBooks (accounting's entries are never touched).

export type OriginalInvoicePdf =
  | { ok: true; bytes: Uint8Array; source: 'quickbooks' | 'attachment'; split: boolean }
  // transient = QuickBooks itself failed or timed out (not "no original on file") — worth trying again later.
  | { ok: false; split: boolean | null; reason: string; transient: boolean };

export async function getOriginalInvoicePdf(company: QbCompany, invoiceId: string): Promise<OriginalInvoicePdf> {
  if (!/^\d+$/.test(invoiceId)) return { ok: false, split: null, reason: `"${invoiceId}" is not a QuickBooks invoice id`, transient: false };
  const loaded = await loadInvoiceForClient(company, invoiceId);
  if (!loaded) return { ok: false, split: null, reason: 'the invoice could not be read from QuickBooks', transient: true };
  if (!loaded.facts) return { ok: true, bytes: await fetchQuickBooksInvoicePdf(company, invoiceId), source: 'quickbooks', split: false };
  const attached = await findOriginalInvoiceCopy(company, invoiceId, loaded.facts);
  if ('found' in attached) return { ok: true, bytes: attached.found.bytes, source: 'attachment', split: true };
  return { ok: false, split: true, reason: attached.none, transient: 'trouble' in attached && !!attached.trouble };
}
