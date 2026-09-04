// House naming convention for invoice PDFs, shared between Billing Draft's
// "save PDF" flow and Client Communications' "download to attach" flow so a
// file downloaded from either place has the same name.
// TAB: "INV<no>-<company>-S$<amt>.pdf", TAC: "TAC<no>-<company>-S$<amt>.pdf",
// TAO: "TAO<no>-<company>-S$<amt>.pdf" (no spaces around the dashes).
//
// TAO added 2026-09-04 (connect-only phase — see PROJECT_STATUS.md). This
// is purely a downloaded-file label for an invoice that already exists in
// QuickBooks, not a billing-critical numbering decision (unlike the
// DocNumber series digit in lib/qb-invoice-conventions.ts, which Vincent
// explicitly deferred) — was a real bug before this fix: the old
// `company === 'TAB' ? 'INV' : 'TAC'` binary ternary would have silently
// labeled a downloaded TAO PDF as "TAC...".

export function displayInvoiceNo(invoiceNo: string | null | undefined): string {
  const value = String(invoiceNo ?? '').trim();
  return value.replace(/^(?:TAB|TAC|TAO)(?=\d|[\s#:_-])[\s#:_-]*/i, '');
}

export function invoicePdfFileName(company: 'TAB' | 'TAC' | 'TAO', invoiceNo: string, companyName: string, total: number): string {
  const prefix = company === 'TAB' ? 'INV' : company;
  const safeCompany = companyName.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
  const amount = Number.isInteger(total) ? String(total) : total.toFixed(2);
  return `${prefix}${displayInvoiceNo(invoiceNo)}-${safeCompany}-S$${amount}.pdf`;
}
