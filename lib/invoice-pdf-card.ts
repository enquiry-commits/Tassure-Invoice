// The assistant's "invoice PDF" card payload (find_invoice_pdf, Vincent 2026-10-08): the invoices that matched, each
// with what the card needs to offer Original / Latest. Pure types — shared by the assistant route and ChatCards.
export type InvoicePdfItem = {
  book: 'TAB' | 'TAC' | 'TAO';
  qbInvoiceId: string;
  invoiceNo: string;
  txnDate: string | null;
  customerName: string;
  totalAmt: number;
  status: string; // Open | Paid | Voided …
  // accounting has split it — only then do Original and Latest differ (two buttons); otherwise one Download.
  split: boolean;
};
export type InvoicePdfPreview = { query: string; invoices: InvoicePdfItem[]; truncated: boolean };
