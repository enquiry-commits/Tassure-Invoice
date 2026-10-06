import 'server-only';

import { getValidToken, type QbCompany } from './quickbooks';
import { createHttpAttachmentReader } from './quickbooks-attachments-http';
import { MAX_ORIGINAL_BYTES, selectVerifiedOriginal, type OriginalCopyResult } from './original-copy';
import { extractPdfText } from './pdf-text';
import type { ClientInvoiceModel } from './client-invoice-model';

// Finds, among the files attached to an invoice in QuickBooks, the ORIGINAL
// (unsplit) invoice the client was sent — INV-QB-037. Used by
// lib/client-invoice-pdf.ts only for an invoice accounting has split
// (INV-QB-029): the system's own redraw is the fallback, so every doubt here
// (no attachment, not provably the original, QuickBooks slow or unreachable)
// is simply "none" and never an error the caller has to handle.
//
// Read-only: it lists attachments and downloads files; it never uploads,
// changes or deletes anything in QuickBooks, and it never touches any other
// system (the company file server included).

// Per-book switch — 'off' always redraws, as before. TAB and TAC are the
// books whose split invoices the system redraws; TAO has none.
export const ORIGINAL_COPY_LOOKUP_MODE: Record<QbCompany, 'off' | 'live'> = { TAB: 'live', TAC: 'live', TAO: 'off' };

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

// The whole look-up (list, download, read) for one invoice. The SOA walks its
// invoices one by one, so a slow answer must cost seconds, not the request.
const TIME_LIMIT_MS = 25_000;

export async function findOriginalInvoiceCopy(company: QbCompany, invoiceId: string, model: ClientInvoiceModel): Promise<OriginalCopyResult> {
  if (ORIGINAL_COPY_LOOKUP_MODE[company] !== 'live') return { none: `${company} originals are not looked up` };
  if (!/^\d+$/.test(invoiceId)) return { none: `"${invoiceId}" is not a QuickBooks invoice id` };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await getValidToken(company);
    if (!token) return { none: `QuickBooks ${company} is not connected` };
    const reader = createHttpAttachmentReader({ base: QB_BASE, realmId: token.realm_id, accessToken: token.access_token });
    const result = await Promise.race([
      selectVerifiedOriginal(
        { list: () => reader.list(invoiceId), download: file => reader.download(file, MAX_ORIGINAL_BYTES), text: extractPdfText },
        { docNumber: model.docNumber, amounts: model.rows.map(r => r.amount), total: model.total },
      ),
      new Promise<OriginalCopyResult>(resolve => { timer = setTimeout(() => resolve({ none: `QuickBooks did not answer within ${TIME_LIMIT_MS / 1000} seconds` }), TIME_LIMIT_MS); }),
    ]);
    // "No PDF attached" is the normal state of most split invoices today —
    // not worth a log line. Anything else is a file somebody attached that
    // the system could not accept, which is worth finding in the logs.
    if ('none' in result && result.none !== 'no PDF attached') console.warn(`Attached original not used (${company} #${model.docNumber}): ${result.none}`);
    return result;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn(`Attached original not used (${company} #${model.docNumber}): ${why}`);
    return { none: why };
  } finally {
    clearTimeout(timer);
  }
}
