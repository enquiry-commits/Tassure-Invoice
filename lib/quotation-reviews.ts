import type { QbCompany } from './quickbooks';
import type { QuotationRow, QuotationTrace } from './quotation-trace';

// "Completed" + Remarks on the Quotation page (Vincent, 2026-10-07; table: scripts/add-quotation-reviews.sql).
// Pure (no I/O) so the rules can be tested on their own.
//
//   - A PI that is Closed can be marked Completed by the person in charge. From then on it is NOT re-matched
//     against invoices: its trace is the snapshot taken at that moment, and it leaves the main list.
//   - Remarks can be written on any PI at any time.
//   - A completed PI's record is deleted one year after it was completed. The page only lists quotations dated in
//     the last 12 months, and a PI is always completed AFTER its own date, so by the time its record is deleted the
//     PI is older than the window and cannot come back into the main list.

export type QuotationReview = {
  remarks: string | null;
  completed: boolean;
  completedAt: string | null;
  completedBy: string | null;
};

export type ReviewRecord = {
  qb_company: string;
  qb_estimate_id: string;
  remarks: string | null;
  completed_at: string | null;
  completed_by_email: string | null;
  completed_trace: QuotationTrace | null;
};

export type QuotationRowView = QuotationRow & { review: QuotationReview };

export const EMPTY_REVIEW: QuotationReview = { remarks: null, completed: false, completedAt: null, completedBy: null };
export const MAX_REMARKS_CHARS = 1000;
export const RETENTION_DAYS_AFTER_COMPLETED = 365;

export const reviewKey = (book: QbCompany | string, estimateId: string) => `${book}|${estimateId}`;

/** Only a Closed quotation can be completed (the person checks the invoices it was traced to). */
export function canComplete(row: Pick<QuotationRow, 'statusGroup'>): boolean {
  return row.statusGroup === 'closed';
}

/** The page lists quotations dated from this day on: exactly 12 months before `today` (YYYY-MM-DD). */
export function windowStart12Months(today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate(); // days in that month a year ago (29 Feb -> 28 Feb)
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

/** Completed records older than this instant are deleted. */
export function purgeCutoffIso(now: Date): string {
  return new Date(now.getTime() - RETENTION_DAYS_AFTER_COMPLETED * 86_400_000).toISOString();
}

export function cleanRemarks(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw new Error('remarks must be text');
  const text = raw.trim();
  if (text.length > MAX_REMARKS_CHARS) throw new Error(`remarks are too long (max ${MAX_REMARKS_CHARS} characters)`);
  return text || null;
}

/**
 * Attach each quotation's review. A completed one keeps its FROZEN trace (never the live re-match); everything
 * else on the row stays live (status, amount, lines).
 */
export type LiveInvoiceState = { balance: number; status: string };

/**
 * A frozen trace keeps WHICH invoices matched and their amounts, but whether each is paid keeps moving after the PI
 * is completed (Vincent, 2026-10-08: the paid tick must still work): overlay the invoice's live balance + status.
 */
export function withLivePaidState(trace: QuotationTrace, live: ReadonlyMap<string, LiveInvoiceState>): QuotationTrace {
  return { ...trace, invoices: trace.invoices.map(inv => { const l = live.get(reviewKey(inv.source, inv.qbInvoiceId)); return l ? { ...inv, balance: l.balance, status: l.status } : inv; }) };
}

export function applyReviews(rows: readonly QuotationRow[], records: readonly ReviewRecord[], live: ReadonlyMap<string, LiveInvoiceState> = new Map()): QuotationRowView[] {
  const byKey = new Map(records.map(r => [reviewKey(r.qb_company, r.qb_estimate_id), r]));
  return rows.map(row => {
    const rec = byKey.get(reviewKey(row.source, row.qbEstimateId));
    if (!rec) return { ...row, review: EMPTY_REVIEW };
    const completed = !!rec.completed_at;
    return {
      ...row,
      trace: completed && rec.completed_trace ? withLivePaidState(rec.completed_trace, live) : row.trace,
      review: { remarks: rec.remarks, completed, completedAt: rec.completed_at, completedBy: rec.completed_by_email },
    };
  });
}
