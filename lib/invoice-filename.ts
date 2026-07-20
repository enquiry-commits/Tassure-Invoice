// House naming convention for invoice PDFs, shared between Billing Draft's
// "save PDF" flow and Client Communications' "download to attach" flow so a
// file downloaded from either place has the same name.
// TAB: "INV<no>-<company>-S$<amt>.pdf", TAC: "TAC<no>-<company>-S$<amt>.pdf"
// (no spaces around the dashes).

export function displayInvoiceNo(invoiceNo: string | null | undefined): string {
  const value = String(invoiceNo ?? '').trim();
  return value.replace(/^(?:TAB|TAC)(?=\d|[\s#:_-])[\s#:_-]*/i, '');
}

export function invoicePdfFileName(company: 'TAB' | 'TAC', invoiceNo: string, companyName: string, total: number): string {
  const prefix = company === 'TAB' ? 'INV' : 'TAC';
  const safeCompany = companyName.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
  const amount = Number.isInteger(total) ? String(total) : total.toFixed(2);
  return `${prefix}${displayInvoiceNo(invoiceNo)}-${safeCompany}-S$${amount}.pdf`;
}
