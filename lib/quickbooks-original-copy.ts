import 'server-only';

import { getValidToken, type QbCompany } from './quickbooks';
import { createHttpAttachmentReader } from './quickbooks-attachments-http';
import { MAX_ORIGINAL_BYTES, selectVerifiedOriginal, type InvoiceFacts, type OriginalCopyResult } from './original-copy';
import { readPdf } from './pdf-text';
import { confirmedOriginalsFor } from './original-decisions';

// Finds, among the files attached to an invoice in QuickBooks, the ORIGINAL
// (unsplit) invoice the client was sent — INV-QB-037. Used by
// lib/client-invoice-pdf.ts for an invoice accounting has split (INV-QB-029):
// Vincent's order is the original attached in QuickBooks first, then (staff
// fetch it from the file server and attach it) and only then the redraw, so
// every doubt here (no attachment, not provably the original, QuickBooks slow
// or unreachable) is simply "none" and never an error the caller has to
// handle — the caller redraws.
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
const TIME_LIMIT_MS = 15_000;
// After QuickBooks itself fails or times out, stop asking for a while: the
// next invoices of the same request would only wait the same time again
// (a customer with 15 split invoices x 15 s would pass the route's limit).
const PAUSE_MS = 120_000;
const pausedUntil: Partial<Record<QbCompany, number>> = {};

export async function findOriginalInvoiceCopy(company: QbCompany, invoiceId: string, facts: InvoiceFacts): Promise<OriginalCopyResult> {
  if (ORIGINAL_COPY_LOOKUP_MODE[company] !== 'live') return { none: `${company} originals are not looked up`, tried: [] };
  if (!/^\d+$/.test(invoiceId)) return { none: `"${invoiceId}" is not a QuickBooks invoice id`, tried: [] };
  if (Date.now() < (pausedUntil[company] ?? 0)) return { none: `not asking QuickBooks ${company} again for a minute or two after a problem`, trouble: true, tried: [] };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: OriginalCopyResult;
  try {
    const token = await getValidToken(company);
    if (!token) return { none: `QuickBooks ${company} is not connected`, tried: [] };
    const reader = createHttpAttachmentReader({ base: QB_BASE, realmId: token.realm_id, accessToken: token.access_token, signal: controller.signal });
    result = await Promise.race([
      selectVerifiedOriginal(
        { list: () => reader.list(invoiceId), download: file => reader.download(file, MAX_ORIGINAL_BYTES), read: readPdf },
        facts,
        // Vincent's decisions (lib/original-decisions.ts): a handful of files the proof alone would refuse.
        confirmedOriginalsFor(company, invoiceId),
      ),
      new Promise<OriginalCopyResult>(resolve => {
        timer = setTimeout(() => { controller.abort(); resolve({ none: `QuickBooks did not answer within ${TIME_LIMIT_MS / 1000} seconds`, trouble: true, tried: [] }); }, TIME_LIMIT_MS);
      }),
    ]);
  } catch (err) {
    result = { none: err instanceof Error ? err.message : String(err), trouble: true, tried: [] };
  } finally {
    clearTimeout(timer);
  }
  if ('none' in result) {
    if (result.trouble) pausedUntil[company] = Date.now() + PAUSE_MS;
    // "No PDF attached" is the normal state of most split invoices today —
    // not worth a log line. Anything else is a file somebody attached that the
    // system could not accept, or a QuickBooks problem: worth finding in the logs.
    if (result.none !== 'no PDF attached') console.warn(`Attached original not used (${facts.invoiceNo}): ${result.none}`);
  }
  return result;
}
