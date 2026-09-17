// Shared merge-field engine for Client Communications templates.
// Templates use {{fieldName}} placeholders; unresolved fields are left as-is
// (visible in the draft preview) rather than silently blanked, so a missing
// merge field is obvious to the reviewer before anything is sent.
import { titleCase } from './text-case';

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
  // Added 2026-09-17 for SOA's 1st/2nd/3rd escalating reminder templates
  // (Vincent supplied the real wording as 3 Word docs — "Auto_1st/2nd/3rd
  // reminder"). Both are auto-computed server-side (app/api/client-
  // communications/campaigns/route.ts and .../drafts/refresh-amounts/
  // route.ts), never typed by a user — Vincent: "新增自动计算的合并字段".
  // daysOverdue: days since the OLDEST unpaid invoice's due date (empty
  // string when no due date is known — the legacy pre-AgedReceivableDetail
  // fallback path has no due_date column, see lib/client-comms-resolve.ts).
  daysOverdue: string;
  // lastReminderDate: when a PRIOR 'soa'-type reminder was last actually
  // SENT to this exact company (empty string on a company's first-ever SOA
  // reminder) — not this draft's own date.
  lastReminderDate: string;
  // sendMonth (added 2026-09-17, lib/date.ts's currentMonthUpperSGT()):
  // "SEP 2026" style, computed at draft-creation/refresh time — Vincent:
  // "那个月发就发那个月的" (whichever month it's actually sent). Same
  // refresh-only-alongside-an-amount-change caveat as daysOverdue/
  // lastReminderDate above — see app/api/client-communications/drafts/
  // refresh-amounts/route.ts's own comment.
  sendMonth: string;
};

export function mergeTemplate(template: string, fields: Partial<MergeFields>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const value = (fields as Record<string, string | undefined>)[key];
    return value !== undefined && value !== null && value !== '' ? value : match;
  });
}

// qbInvoiceId is the internal QuickBooks invoice Id (not the human DocNumber
// in invoiceNo) — present when the source invoice record has one, which is
// what lets Draft Review offer a "download this invoice PDF" button so staff
// can attach the real invoice before sending (mailto: links cannot carry
// attachments — see app/client-communications/drafts/page.tsx).
// dueDate (added 2026-09-17, daysOverdue's source): only ever populated from
// the AgedReceivableDetail snapshot path (lib/soa-data.ts's
// loadArAgingSnapshot()) — quickbooks_invoices (the legacy fallback source)
// has no due_date column, so a company scoped to that fallback path simply
// carries no due date here, same "known gap, not a guess" reasoning as
// dueDate always being '' in the merge fields today.
export type InvoiceRef = { qbCompany: 'TAB' | 'TAC' | 'TAO'; invoiceNo: string; amount: number; qbInvoiceId?: string | null; dueDate?: string | null };

// Renders the invoice list the same way the Excel's <INV>/<Invoice TAB 1>
// columns did — one line per invoice, company-prefixed.
export function formatInvoiceList(refs: InvoiceRef[]): string {
  if (!refs.length) return '(no invoices)';
  return refs.map(r => `${r.qbCompany} ${r.invoiceNo} - S$${r.amount.toLocaleString()}`).join('\n');
}

export function formatAmount(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Shared by the two places a draft's body gets (re)merged — campaign
// creation (which already has a single pre-resolved oldest due date from
// lib/client-comms-resolve.ts's buildRow()) and refresh-amounts (which only
// has the raw invoice_refs array) — so "how overdue" is computed identically
// both times, not two independently-typed copies. Clamped to 0 rather than
// showing a nonsensical negative day count for a not-yet-due invoice.
export function daysOverdueFromDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  return String(Math.max(0, days));
}

// Only positive-amount refs (real debt, not a credit/adjustment line) with a
// real dueDate count toward "oldest unpaid".
export function computeDaysOverdue(refs: InvoiceRef[]): string {
  const dueDates = refs.filter(r => r.amount > 0 && r.dueDate).map(r => r.dueDate as string).sort();
  return daysOverdueFromDate(dueDates[0]);
}

// Greeting-name casing rule for "Dear {{contactName}}" -- see lib/text-case.ts.
export const formatContactName = titleCase;
