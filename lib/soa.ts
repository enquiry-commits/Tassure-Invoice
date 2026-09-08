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

// The single most-overdue bucket a company's outstanding balance actually
// touches — Vincent, 2026-09-08, on Company 360's Outstanding section:
// "欠下多久了...主要显示是最久的是欠了多久时间，比如最久的是 91+，就放
// 91+" (show how long overdue — specifically the OLDEST/most-overdue
// bucket; if the oldest is 91+, show 91+). AGING_BUCKETS is already
// ordered least-to-most overdue, so scanning it in reverse and returning
// the first non-zero bucket is exactly "the oldest one this balance is
// still sitting in" — a company with some Current AND some 91+ invoices
// shows 91+, not Current, matching his framing that the oldest wins.
// Returns null only when every bucket is genuinely zero (shouldn't happen
// for a row that has a real totalOutstanding > 0, but this is a domain
// fact worth asserting via a null case rather than silently defaulting to
// "Current").
export function oldestAgingBucket(aging: AgingTotals): AgingBucket | null {
  for (let i = AGING_BUCKETS.length - 1; i >= 0; i--) {
    const bucket = AGING_BUCKETS[i];
    if (aging[bucket.key] > 0) return bucket.key;
  }
  return null;
}
