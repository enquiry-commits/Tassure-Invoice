// The "Group" SOA email (Vincent / Chelsea, 2026-10-07): several companies that belong to one group get ONE email —
// every company's SOA + invoices attached, the outstanding invoices summarised per company, the subject written by
// Chelsea. The layout follows the real email she sent (Aquila Education, 8 Aug 2025): a total across the group, then
// "1.Company (S$sub)" sections of "TAB02410930 - S$100" lines.
// Pure (no I/O, no imports) — the browser builds the draft with it, and test-soa-group-email.ts checks it.

export type GroupInvoiceLine = { qbCompany: 'TAB' | 'TAC' | 'TAO'; invoiceNo: string; amount: number };
export type GroupCompany = { companyName: string; lines: GroupInvoiceLine[]; total?: number | null };

/** "S$1,060" — cents only when there are some ("S$1,060.50"); a credit reads "-S$100". */
export function formatShortMoney(n: number): string {
  const abs = Math.abs(n);
  const body = abs.toLocaleString('en-SG', { minimumFractionDigits: Number.isInteger(abs) ? 0 : 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '-' : ''}S$${body}`;
}

/** What the company owes in this email: its own total when given, else the sum of the listed lines. */
export function companySubtotal(c: GroupCompany): number {
  return typeof c.total === 'number' ? c.total : c.lines.reduce((s, l) => s + l.amount, 0);
}

export function groupTotal(companies: readonly GroupCompany[]): number {
  return Math.round(companies.reduce((s, c) => s + companySubtotal(c), 0) * 100) / 100;
}

/** "A", "A and B", "A, B, and C" — the way the real email writes the companies. */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

/** One invoice per line: book + invoice number, then the amount ("TAB02410930 - S$100"). Zero lines are left out. */
export function formatInvoiceLine(l: GroupInvoiceLine): string {
  return `${l.qbCompany}${l.invoiceNo} - ${formatShortMoney(l.amount)}`;
}

export function buildGroupEmailBody(companies: readonly GroupCompany[]): string {
  const names = joinNames(companies.map(c => c.companyName));
  const sections = companies.map((c, i) => {
    const lines = c.lines.filter(l => l.amount !== 0).map(formatInvoiceLine);
    return [`${i + 1}. ${c.companyName} (${formatShortMoney(companySubtotal(c))})`, ...(lines.length ? lines : ['(statement attached)'])].join('\n');
  });
  return [
    'Dear All,',
    'Good day to you.',
    `We would like to bring to your attention that the total overdue amount from ${names} stands at ${formatShortMoney(groupTotal(companies))}.`,
    'For your convenience, please find below a summary of the outstanding invoices. The Statement of Accounts (SOA) and Invoices are also attached for your reference.',
    sections.join('\n\n'),
    'Thank you.',
    'Please do not hesitate to contact me if you have any further questions.',
  ].join('\n\n');
}

/** The union of every company's recipients, de-duplicated; a CC never repeats someone already in To. Lines are newline-separated like the drafts store them. */
export function mergeGroupRecipients(rows: readonly { toEmail: string | null; ccEmail: string | null }[]): { to: string; cc: string } {
  const split = (raw: string | null | undefined) => (raw ?? '').split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(e => e.includes('@'));
  const to = [...new Set(rows.flatMap(r => split(r.toEmail)))];
  const inTo = new Set(to);
  const cc = [...new Set(rows.flatMap(r => split(r.ccEmail)))].filter(e => !inTo.has(e));
  return { to: to.join('\n'), cc: cc.join('\n') };
}
