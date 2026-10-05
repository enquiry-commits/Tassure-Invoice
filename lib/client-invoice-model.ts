// The invoice a CLIENT receives shows each service once at its full amount
// (docs/INVARIANTS.md INV-QB-029): accounting's "Deferred Revenue" twins stay
// in QuickBooks, folded into their service here with the same rule Billing
// Drafts' editor uses (lib/deferred-pairing.ts). This module turns one live
// QuickBooks invoice into what lib/client-invoice-render.ts draws — or says
// why QuickBooks' own PDF must be sent instead. Pure (no I/O); tested by
// test-client-invoice-model.ts against real invoices.
//
// QuickBooks' own PDF is kept whenever there is nothing to fold (no deferred
// line — most invoices) and whenever anything is not exactly representable:
// an unpaired twin, a line type the system doesn't draw, tax, a non-SGD
// currency, or amounts that don't add up to QuickBooks' own total to the cent.
// Vincent, 2026-10-05: in doubt, send QuickBooks' version and tell staff why.

import { isDeferredItem, mergeDeferredForDisplay, type PairableLine } from './deferred-pairing';

export type ClientBook = 'TAB' | 'TAC';

export type ClientInvoiceModel = {
  book: ClientBook;
  invoiceNo: string;        // as QuickBooks prints it: "TAB 02611112"
  docNumber: string;
  date: string;             // dd/mm/yyyy
  dueDate: string;
  terms: string;
  billTo: string[];         // customer name, then the address lines
  rows: { description: string; amount: number }[];
  total: number;
};

export type ClientInvoiceDecision =
  | { kind: 'system'; model: ClientInvoiceModel }
  // reason null: nothing to fold, QuickBooks' PDF is already right.
  | { kind: 'quickbooks'; reason: string | null };

// The subset of QuickBooks' Invoice JSON this reads.
export type QbInvoiceJson = {
  DocNumber?: string;
  TxnDate?: string;
  DueDate?: string;
  TotalAmt?: number;
  CurrencyRef?: { value?: string };
  CustomerRef?: { name?: string };
  BillAddr?: Record<string, unknown>;
  TxnTaxDetail?: { TotalTax?: number };
  Line?: Array<{
    DetailType?: string;
    Amount?: number;
    Description?: string;
    SalesItemLineDetail?: { ItemRef?: { name?: string }; Qty?: number; UnitPrice?: number };
  }>;
};

const cents = (n: number) => Math.round(n * 100);
const ddmmyyyy = (iso: string | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};
const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

// What QuickBooks prints under BILL TO: the customer's name, then the address
// lines in order — the name only once when the address repeats it (Anmed TAC
// #02680138: Line1 is the company name) and nothing more when there is no
// address (Advance CF TAC #02680320). Checked against three real PDFs.
export function billToLines(customerName: string, billAddr: Record<string, unknown> | undefined): string[] {
  const keys = ['Line1', 'Line2', 'Line3', 'Line4', 'Line5', 'City', 'CountrySubDivisionCode', 'PostalCode', 'Country'];
  const address = keys
    .map(k => billAddr?.[k])
    .filter((v): v is string => typeof v === 'string' && v.trim() !== '')
    .map(v => v.trim());
  if (address.length && squash(address[0]) === squash(customerName)) address.shift();
  return [customerName.trim(), ...address].filter(Boolean);
}

export function buildClientInvoiceModel(invoice: QbInvoiceJson, book: string, terms: string | null): ClientInvoiceDecision {
  const lines = invoice.Line ?? [];
  const itemLines = lines.filter(l => l.DetailType === 'SalesItemLineDetail');
  if (!itemLines.some(l => isDeferredItem(l.SalesItemLineDetail?.ItemRef?.name))) return { kind: 'quickbooks', reason: null };

  if (book !== 'TAB' && book !== 'TAC') return { kind: 'quickbooks', reason: `${book} invoices are not redrawn by the system yet` };
  const other = [...new Set(lines.map(l => l.DetailType ?? 'unknown').filter(t => t !== 'SalesItemLineDetail' && t !== 'SubTotalLineDetail'))];
  if (other.length) return { kind: 'quickbooks', reason: `it has a ${other.join(', ')} line the system does not draw` };
  if ((invoice.CurrencyRef?.value ?? 'SGD') !== 'SGD') return { kind: 'quickbooks', reason: `it is in ${invoice.CurrencyRef?.value}, not SGD` };
  if (Number(invoice.TxnTaxDetail?.TotalTax ?? 0) !== 0) return { kind: 'quickbooks', reason: 'it carries tax, which the system does not draw' };
  if (!invoice.DocNumber) return { kind: 'quickbooks', reason: 'it has no invoice number' };
  if (!terms) return { kind: 'quickbooks', reason: "its payment terms could not be read from QuickBooks" };

  const pairable: PairableLine[] = itemLines.map(l => {
    const qty = Number(l.SalesItemLineDetail?.Qty ?? 1) || 1;
    const amount = Number(l.Amount ?? 0);
    const unit = l.SalesItemLineDetail?.UnitPrice;
    return {
      productService: l.SalesItemLineDetail?.ItemRef?.name ?? '',
      description: l.Description ?? '',
      qty,
      // QuickBooks' own line Amount is the truth; a unit price that doesn't
      // reproduce it (rounding) must not shift a cent.
      rate: typeof unit === 'number' && cents(unit * qty) === cents(amount) ? unit : amount / qty,
    };
  });
  const folded = mergeDeferredForDisplay(pairable);
  if (!folded.ok) return { kind: 'quickbooks', reason: folded.reasons.join('; ') };

  const rows = folded.lines.map(x => ({ description: x.line.description, amount: x.amount }));
  const total = Number(invoice.TotalAmt ?? NaN);
  const rowCents = rows.reduce((s, r) => s + cents(r.amount), 0);
  if (!Number.isFinite(total) || rowCents !== cents(total)) {
    return { kind: 'quickbooks', reason: `its lines add up to ${(rowCents / 100).toFixed(2)}, not QuickBooks' total ${Number.isFinite(total) ? total.toFixed(2) : '?'}` };
  }

  return {
    kind: 'system',
    model: {
      book,
      invoiceNo: `${book} ${invoice.DocNumber}`,
      docNumber: invoice.DocNumber,
      date: ddmmyyyy(invoice.TxnDate),
      dueDate: ddmmyyyy(invoice.DueDate),
      terms,
      billTo: billToLines(invoice.CustomerRef?.name ?? '', invoice.BillAddr),
      rows,
      total,
    },
  };
}
