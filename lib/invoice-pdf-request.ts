// Which request an invoice chip (components/billing/BillingInvoiceReference.tsx) sends to open an invoice's PDF — pure, so the
// rule can be pinned by a test (`npx tsx test-soa-invoice-chip.ts`).
//
//  'quickbooks' (the default — every chip that existed before 2026-10-07): QuickBooks' own PDF, accounting's split lines included
//     (/api/quickbooks/invoice-pdf; a credit note is its own document type there).
//  'client': the copy the CLIENT receives (/api/billing/client-invoice-pdf, INV-QB-029: each service once at its full amount, the
//     original when one is attached) — what the SOA detail shows, because a statement is a client document. It exists only for
//     an INVOICE whose QuickBooks Id is known (the route takes an Id, not a number); a credit note, or a chip given only a
//     number, falls back to QuickBooks' own PDF exactly as before — never to a wrong document.
//  'original' (2026-10-09, the assistant's invoice card): the invoice as the client FIRST received it
//     (/api/billing/invoice-original, lib/invoice-versions.ts, INV-QB-040) — 404 with the reason when a split invoice has no proven
//     original. Needs the QuickBooks Id and an invoice; otherwise it falls back like 'client'.
import type { QbCompany } from './quickbooks';

export type InvoiceChipView = 'quickbooks' | 'client' | 'original';

export function invoicePdfRequest(o: {
  company: QbCompany; id?: string | null; lookupNo?: string | null; docType: 'invoice' | 'credit'; view: InvoiceChipView;
}): { client: boolean; url: string } {
  if (o.view === 'original' && o.docType === 'invoice' && o.id) {
    return { client: false, url: `/api/billing/invoice-original?${new URLSearchParams({ company: o.company, id: o.id }).toString()}` };
  }
  const client = o.view === 'client' && o.docType === 'invoice' && !!o.id;
  const params = new URLSearchParams({ company: o.company });
  if (client) {
    params.set('id', o.id as string);
  } else {
    if (o.id) params.set('id', o.id); else params.set('invoiceNo', o.lookupNo ?? '');
    if (o.docType === 'credit') params.set('docType', 'creditmemo');
  }
  return { client, url: `${client ? '/api/billing/client-invoice-pdf' : '/api/quickbooks/invoice-pdf'}?${params.toString()}` };
}
