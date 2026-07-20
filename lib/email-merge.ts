// Shared merge-field engine for Client Communications templates.
// Templates use {{fieldName}} placeholders; unresolved fields are left as-is
// (visible in the draft preview) rather than silently blanked, so a missing
// merge field is obvious to the reviewer before anything is sent.

export type MergeFields = {
  companyName: string;
  contactName: string;
  toEmail: string;
  ccEmail: string;
  totalAmount: string;
  invoiceList: string;
  dueDate: string;
  fyeMonth: string;
  fyeYear: string;
};

export function mergeTemplate(template: string, fields: Partial<MergeFields>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = (fields as Record<string, string | undefined>)[key];
    return value !== undefined && value !== null && value !== '' ? value : match;
  });
}

export type InvoiceRef = { qbCompany: 'TAB' | 'TAC' | 'TAO'; invoiceNo: string; amount: number };

// Renders the invoice list the same way the Excel's <INV>/<Invoice TAB 1>
// columns did — one line per invoice, company-prefixed.
export function formatInvoiceList(refs: InvoiceRef[]): string {
  if (!refs.length) return '(no invoices)';
  return refs.map(r => `${r.qbCompany} #${r.invoiceNo} - S$${r.amount.toLocaleString()}`).join('\n');
}

export function formatAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
