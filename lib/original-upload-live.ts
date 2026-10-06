import 'server-only';

import { getValidToken, type QbCompany } from './quickbooks';
import { createHttpAttachmentApi, createHttpAttachmentReader } from './quickbooks-attachments-http';
import { loadInvoiceForClient } from './client-invoice-pdf';
import { ORIGINAL_COPY_LOOKUP_MODE } from './quickbooks-original-copy';
import { MAX_ORIGINAL_BYTES } from './original-copy';
import { readPdf } from './pdf-text';
import { placeUploadedOriginal, type UploadedBy, type UploadResult } from './original-upload';
import { confirmedOriginalsFor } from './original-decisions';

// The wiring of lib/original-upload.ts to the real QuickBooks book (INV-QB-037):
// the SAME invoice read (loadInvoiceForClient) and the SAME proof reader
// (readPdf) the SOA uses, so a file this accepts is exactly a file the SOA will
// use. This is the only place the Invoice Originals page writes to QuickBooks —
// it adds one attachment to one invoice, and removes or changes nothing.

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export async function uploadOriginalToQuickBooks(company: QbCompany, invoiceId: string, bytes: Uint8Array, by: UploadedBy): Promise<UploadResult> {
  if (ORIGINAL_COPY_LOOKUP_MODE[company] !== 'live') return { status: 'failed', error: `${company} originals are not used by the system` };
  if (!/^\d+$/.test(invoiceId)) return { status: 'failed', error: `"${invoiceId}" is not a QuickBooks invoice id` };
  let token;
  try {
    token = await getValidToken(company);
  } catch (err) {
    return { status: 'failed', error: `QuickBooks ${company} could not be reached (${err instanceof Error ? err.message : String(err)})` };
  }
  if (!token) return { status: 'failed', error: `QuickBooks ${company} is not connected` };
  const cfg = { base: QB_BASE, realmId: token.realm_id, accessToken: token.access_token, timeoutMs: 30_000 };
  const reader = createHttpAttachmentReader(cfg);
  // The attachment API also carries QuickBooks' own PDF of an invoice (for the
  // system's invoice copy); an upload of an original never asks for it.
  const api = createHttpAttachmentApi({ ...cfg, fetchPdf: () => Promise.reject(new Error('not used: uploading an original')) });
  return placeUploadedOriginal({
    loadInvoice: async () => {
      const loaded = await loadInvoiceForClient(company, invoiceId);
      if (!loaded) throw new Error('QuickBooks did not return the invoice');
      return { facts: loaded.facts };
    },
    list: () => reader.list(invoiceId),
    download: file => reader.download(file, MAX_ORIGINAL_BYTES),
    read: readPdf,
    upload: ({ fileName, note, pdf }) => api.upload({ invoiceId, fileName, note, pdf }),
    now: () => new Date(),
    confirmed: confirmedOriginalsFor(company, invoiceId),
  }, { bytes, by });
}
