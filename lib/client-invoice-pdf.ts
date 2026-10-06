import 'server-only';

import fs from 'fs/promises';
import path from 'path';
import { qbQuery, type QbCompany } from './quickbooks';
import { fetchQuickBooksInvoicePdf } from './quickbooks-invoice-pdf';
import { findOriginalInvoiceCopy } from './quickbooks-original-copy';
import { invoiceFacts } from './original-copy';
import { buildClientInvoiceModel, type QbInvoiceJson } from './client-invoice-model';
import { renderClientInvoicePdf, ClientInvoiceRenderError, type ClientInvoiceAssets } from './client-invoice-render';
import { loadChineseFont } from './pdf-chinese-text';

// The invoice PDF a CLIENT receives (docs/INVARIANTS.md INV-QB-029): when the
// invoice carries accounting's Deferred Revenue twins, the ORIGINAL invoice
// the client first got if one is attached to it in QuickBooks and provably
// is that original (INV-QB-037) — drawable by the system or not — else the
// system's own drawing (each service once, full amount) or, when that is not
// possible, QuickBooks' own PDF; QuickBooks' own PDF otherwise. Vincent's
// order: the original in QuickBooks (staff attach it there, from the file
// server if need be), and the redraw LAST. Used by every client-facing path:
// Email Drafts attachments and Billing Drafts' Save PDF (via
// /api/billing/client-invoice-pdf) and the SOA PDF. Staff-only views (invoice
// chips) keep opening QuickBooks' original.

// Per-book switch — 'off' sends QuickBooks' own PDF exactly as before.
// TAB and TAC turned on 2026-10-05 after Vincent compared real samples side
// by side ("打开"); TAO has no split invoices and isn't redrawn.
export const CLIENT_INVOICE_PDF_MODE: Record<QbCompany, 'off' | 'live'> = { TAB: 'live', TAC: 'live', TAO: 'off' };

export type ClientInvoicePdf = {
  bytes: Uint8Array;
  // 'attachment': the original PDF attached to the invoice in QuickBooks.
  source: 'system' | 'quickbooks' | 'attachment';
  // Set only when the invoice HAS a deferred split but QuickBooks' own PDF
  // (which prints it) is being sent anyway — staff are told why.
  fallbackReason: string | null;
};

// QuickBooks' own PDF now lives in lib/quickbooks-invoice-pdf.ts (shared with
// the invoice copy attached in QuickBooks); re-exported so callers keep working.
export { fetchQuickBooksInvoicePdf };

const TEMPLATE_DIR = path.join(process.cwd(), 'templates', 'client-invoice');

const assetCache = new Map<string, ClientInvoiceAssets>();
async function loadAssets(book: 'TAB' | 'TAC'): Promise<ClientInvoiceAssets> {
  const hit = assetCache.get(book);
  if (hit) return hit;
  const read = (kind: string) => fs.readFile(path.join(TEMPLATE_DIR, `${book.toLowerCase()}-${kind}.png`)).then(b => new Uint8Array(b));
  const [header, footer, qr] = await Promise.all([read('header'), read('footer'), read('qr')]);
  // The Chinese font (10.6 MB) is read once, and only when an invoice needs it.
  const assets = { header, footer, qr, cjkFont: loadChineseFont };
  assetCache.set(book, assets);
  return assets;
}

async function termName(company: QbCompany, termId: unknown): Promise<string | null> {
  const id = String(termId ?? '');
  if (!/^\d+$/.test(id)) return null;
  const result = await qbQuery(`SELECT * FROM Term WHERE Id = '${id}'`, company);
  const name = result?.rows?.[0]?.Name;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

// The live invoice, what the system would send for it, and what an attached
// original of it must match (lib/original-copy.ts). ONE copy of this, used by
// getClientInvoicePdf and by the status page (lib/original-status.ts), so the
// page can never say something the real PDF path would not do.
export type LiveInvoice = QbInvoiceJson & { SalesTermRef?: { value?: string } };

// The decision and the facts for an invoice ALREADY read from QuickBooks
// (terms: the name of its payment terms). The one place they are derived, so
// reading invoices one at a time (here) or many at once (the Invoice Originals
// queue, lib/original-status.ts) can never disagree.
export function prepareInvoiceForClient(company: QbCompany, invoice: LiveInvoice, terms: string | null) {
  const decision = buildClientInvoiceModel(invoice, company, terms);
  // facts is null when nothing is split (QuickBooks' own PDF is then right).
  const facts = invoiceFacts(invoice, company, decision.kind === 'system' ? decision.model.rows.map(r => r.amount) : undefined);
  return { invoice, decision, facts };
}

export async function loadInvoiceForClient(company: QbCompany, invoiceId: string) {
  const result = await qbQuery(`SELECT * FROM Invoice WHERE Id = '${invoiceId}'`, company);
  const invoice = result?.rows?.[0] as LiveInvoice | undefined;
  if (!invoice) return null;
  return prepareInvoiceForClient(company, invoice, invoice.SalesTermRef?.value ? await termName(company, invoice.SalesTermRef.value) : null);
}

export async function getClientInvoicePdf(company: QbCompany, invoiceId: string): Promise<ClientInvoicePdf> {
  const original = async (fallbackReason: string | null): Promise<ClientInvoicePdf> => ({
    bytes: await fetchQuickBooksInvoicePdf(company, invoiceId), source: 'quickbooks', fallbackReason,
  });
  if (CLIENT_INVOICE_PDF_MODE[company] !== 'live') return original(null);

  const loaded = await loadInvoiceForClient(company, invoiceId);
  if (!loaded) return original('the invoice could not be read from QuickBooks');
  const { decision, facts } = loaded;
  // Accounting has split this invoice, so QuickBooks prints the split version.
  // The copy attached to it in QuickBooks (made by the system, INV-QB-036, or
  // by hand from the file server) is what the client first received — used
  // when the PDF itself proves it is that, before anything else: before the
  // redraw below AND before QuickBooks' split PDF for an invoice the system
  // cannot draw.
  if (facts) {
    const attached = await findOriginalInvoiceCopy(company, invoiceId, facts);
    if ('found' in attached) return { bytes: attached.found.bytes, source: 'attachment', fallbackReason: null };
  }
  if (decision.kind === 'quickbooks') return original(decision.reason);
  try {
    const bytes = await renderClientInvoicePdf(decision.model, await loadAssets(decision.model.book));
    return { bytes, source: 'system', fallbackReason: null };
  } catch (err) {
    const why = err instanceof ClientInvoiceRenderError ? err.message : `the system's PDF could not be drawn (${err instanceof Error ? err.message : String(err)})`;
    return original(why);
  }
}
