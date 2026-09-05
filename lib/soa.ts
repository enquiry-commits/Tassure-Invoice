// Statement of Account — aging-bucket math, shared by the SOA list/detail
// API routes. Vincent, 2026-09-05: confirmed via QuickBooks' own live
// AgedReceivables report (same TAB/TAC/TAO connections this whole session
// worked with) that its bucket boundaries are exactly Current/1-30/31-60/
// 61-90/91+, computed off each invoice's real DueDate — which QuickBooks
// itself already derives from TxnDate + the invoice's Net terms (confirmed
// SalesTermRef id '7' = Net 7 on every real sampled invoice, matching
// lib/qb-invoice-conventions.ts's own documented convention). Computed here
// from the already-synced `quickbooks_invoices` table rather than calling
// QuickBooks' live report per page load — same bucket definition, no extra
// external round-trip, and no dependency on a live token just to view the
// list.
const NET_TERMS_DAYS = 7;

export type AgingBucket = 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd91_plus';

export const AGING_BUCKETS: { key: AgingBucket; label: string }[] = [
  { key: 'current',  label: 'Current' },
  { key: 'd1_30',    label: '1-30' },
  { key: 'd31_60',   label: '31-60' },
  { key: 'd61_90',   label: '61-90' },
  { key: 'd91_plus', label: '91+' },
];

export function dueDate(txnDate: string): Date {
  const d = new Date(txnDate);
  d.setDate(d.getDate() + NET_TERMS_DAYS);
  return d;
}

export function agingBucket(txnDate: string, today: Date = new Date()): AgingBucket {
  const due = dueDate(txnDate);
  const daysOverdue = Math.floor((today.getTime() - due.getTime()) / 86400000);
  if (daysOverdue <= 0) return 'current';
  if (daysOverdue <= 30) return 'd1_30';
  if (daysOverdue <= 60) return 'd31_60';
  if (daysOverdue <= 90) return 'd61_90';
  return 'd91_plus';
}

export type AgingTotals = Record<AgingBucket, number>;

export function emptyAgingTotals(): AgingTotals {
  return { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_plus: 0 };
}
