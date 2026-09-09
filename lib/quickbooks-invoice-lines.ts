import 'server-only';

import { qbQuery, getValidToken, type QbCompany } from './quickbooks';
import { classify } from './quickbooks-invoice-incremental';

export type LiveInvoiceLine = {
  service: string;
  productService: string;
  description: string;
  qty: number;
  rate: number;
};

export type LiveInvoice = {
  syncToken: string;
  docNumber: string;
  txnDate: string;
  total: number;
  lines: LiveInvoiceLine[];
};

// Extracted 2026-09-09 (copied verbatim from the real source, not
// retyped) from app/api/quickbooks/invoice-lines/route.ts's own GET
// handler, so the assistant chat's invoice-edit preview
// (lib/invoice-edit-lookup.ts) can reuse the exact same live QuickBooks
// read instead of re-deriving it. That route now just calls this.
// Throws (rather than returning an HTTP response) on "not connected" —
// callers decide how to surface that; returns null for "not found",
// distinct from a thrown connection error.
export async function getLiveInvoice(company: QbCompany, id: string): Promise<LiveInvoice | null> {
  const tokenRow = await getValidToken(company);
  if (!tokenRow) throw new Error(`QuickBooks ${company} not connected`);

  const result = await qbQuery(`SELECT * FROM Invoice WHERE Id = '${id}'`, company);
  const invoice = result?.rows?.[0];
  if (!invoice) return null;

  const rawLines = (invoice.Line as Record<string, unknown>[] | undefined) ?? [];
  const lines: LiveInvoiceLine[] = rawLines
    .filter(line => line.DetailType === 'SalesItemLineDetail')
    .map(line => {
      const detail = (line.SalesItemLineDetail as Record<string, unknown>) ?? {};
      const itemRef = (detail.ItemRef as Record<string, unknown>) ?? {};
      const product = String(itemRef.name ?? '');
      const description = String(line.Description ?? '');
      const { type: service } = classify(description, product);
      return {
        service,
        productService: product,
        description,
        qty: Number(detail.Qty ?? 1),
        rate: Number(detail.UnitPrice ?? 0),
      };
    });

  return {
    syncToken: String(invoice.SyncToken ?? ''),
    docNumber: String(invoice.DocNumber ?? ''),
    txnDate: String(invoice.TxnDate ?? ''),
    total: Number(invoice.TotalAmt ?? 0),
    lines,
  };
}
