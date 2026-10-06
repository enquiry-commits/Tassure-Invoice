import 'server-only';

import { getValidToken, type QbCompany } from './quickbooks';

// QuickBooks' OWN PDF of an invoice, exactly as QuickBooks prints it right
// now. Shared by the client-facing invoice PDF (lib/client-invoice-pdf.ts,
// which sends it untouched unless the invoice carries accounting's Deferred
// split) and the copy attached to the invoice in QuickBooks
// (lib/quickbooks-invoice-copy.ts).

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export async function fetchQuickBooksInvoicePdf(company: QbCompany, invoiceId: string): Promise<Uint8Array> {
  const token = await getValidToken(company);
  if (!token) throw new Error(`QuickBooks ${company} not connected`);
  const res = await fetch(`${QB_BASE}/v3/company/${token.realm_id}/invoice/${invoiceId}/pdf?minorversion=65`, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/pdf' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`QuickBooks ${company} PDF request failed for invoice ${invoiceId}`);
  return new Uint8Array(await res.arrayBuffer());
}
