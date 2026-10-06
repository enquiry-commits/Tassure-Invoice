import 'server-only';

import { getValidToken, type QbCompany } from './quickbooks';
import { fetchQuickBooksInvoicePdf } from './quickbooks-invoice-pdf';
import { placeInvoiceCopy, type InvoiceCopyResult } from './quickbooks-attachments';
import { createHttpAttachmentApi } from './quickbooks-attachments-http';
import { invoicePdfFileName } from './invoice-filename';

// Attaches QuickBooks' own PDF of an invoice to that invoice in QuickBooks
// (INV-QB-036). Called by /api/quickbooks/create-invoice right after an
// invoice is made ('create') and by /api/quickbooks/update-invoice after an
// edit is saved ('refresh'). Best effort by design: the invoice already
// exists, so a problem here is REPORTED (the caller shows it) and never
// undoes or blocks anything.

// Per-book switch — 'off' attaches nothing. All three books live from the
// start (Vincent, 2026-10-06: "TAB、TAC、TAO 全部").
export const INVOICE_COPY_ATTACHMENT_MODE: Record<QbCompany, 'off' | 'live'> = { TAB: 'live', TAC: 'live', TAO: 'live' };

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

const TIME_LIMIT_MS = 45_000;

export async function attachInvoiceCopyToQuickBooks(args: {
  company: QbCompany;
  invoiceId: string;
  docNumber: string;
  customerName: string;
  total: number | null | undefined;
  mode: 'create' | 'refresh';
}): Promise<InvoiceCopyResult> {
  const { company, invoiceId, docNumber, customerName, total, mode } = args;
  if (INVOICE_COPY_ATTACHMENT_MODE[company] !== 'live') return { status: 'skipped', reason: `${company} invoice copies are switched off` };
  if (!/^\d+$/.test(invoiceId)) return { status: 'failed', error: `"${invoiceId}" is not a QuickBooks invoice id` };
  try {
    const token = await getValidToken(company);
    if (!token) return { status: 'failed', error: `QuickBooks ${company} is not connected` };
    const api = createHttpAttachmentApi({
      base: QB_BASE,
      realmId: token.realm_id,
      accessToken: token.access_token,
      fetchPdf: () => fetchQuickBooksInvoicePdf(company, invoiceId),
    });
    // The same file name "Save PDF" gives, which is how staff were naming the
    // copies they attached by hand.
    const fileName = invoicePdfFileName(company, docNumber, customerName, Number(total ?? 0));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([
      placeInvoiceCopy(api, { invoiceId, fileName, mode }),
      new Promise<InvoiceCopyResult>(resolve => { timer = setTimeout(() => resolve({ status: 'failed', error: `QuickBooks did not finish within ${TIME_LIMIT_MS / 1000} seconds` }), TIME_LIMIT_MS); }),
    ]).finally(() => clearTimeout(timer));
    if (result.status === 'failed') console.error(`Invoice copy not attached (${company} #${docNumber}, id ${invoiceId}, ${mode}): ${result.error}`);
    else if (result.status === 'attached' && result.warning) console.error(`Invoice copy attached with a warning (${company} #${docNumber}): ${result.warning}`);
    return result;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`Invoice copy not attached (${company} #${docNumber}, id ${invoiceId}, ${mode}): ${error}`);
    return { status: 'failed', error };
  }
}

// One line a person can read: the warning to show next to the invoice, or
// null when there is nothing to warn about (attached, or deliberately skipped).
export function invoiceCopyWarning(company: QbCompany, result: InvoiceCopyResult | undefined): string | null {
  if (!result || result.status === 'skipped') return null;
  if (result.status === 'failed') return `${company}: the invoice copy could not be attached to the invoice in QuickBooks — ${result.error}. Attach it by hand.`;
  return result.warning ? `${company}: invoice copy attached, but ${result.warning}.` : null;
}
