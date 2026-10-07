// Run: npx tsx test-quotation-reviews.ts
// Quotation "Completed" + Remarks rules (lib/quotation-reviews.ts).
import { applyReviews, canComplete, cleanRemarks, purgeCutoffIso, windowStart12Months, type ReviewRecord } from './lib/quotation-reviews';
import type { QuotationRow, QuotationTrace } from './lib/quotation-trace';

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`);
  if (!ok) failed++;
}

const liveTrace = { status: 'matched', invoices: [{ invoiceNo: 'LIVE-1' }, { invoiceNo: 'LIVE-2-NEW' }], tracedTotal: 3000, sumMatchesTotal: false } as unknown as QuotationTrace;
const frozenTrace = { status: 'matched', invoices: [{ invoiceNo: 'LIVE-1' }], tracedTotal: 1600, sumMatchesTotal: true } as unknown as QuotationTrace;
const row = (over: Partial<QuotationRow>): QuotationRow => ({ source: 'TAB', qbEstimateId: '100', docNumber: 'PI260092', statusGroup: 'closed', trace: liveTrace, ...over } as QuotationRow);

const rows = [row({}), row({ qbEstimateId: '101', docNumber: 'PI260091' }), row({ qbEstimateId: '102', statusGroup: 'open' }), row({ source: 'TAC', qbEstimateId: '100' })];
const records: ReviewRecord[] = [
  { qb_company: 'TAB', qb_estimate_id: '100', remarks: 'checked 7 Oct', completed_at: '2026-10-07T01:00:00Z', completed_by_email: 'a@tassure.com', completed_trace: frozenTrace },
  { qb_company: 'TAB', qb_estimate_id: '101', remarks: 'waiting for client', completed_at: null, completed_by_email: null, completed_trace: null },
];
const view = applyReviews(rows, records);

check('a completed PI keeps its FROZEN trace — the invoice that matched later is not added', view[0].trace === frozenTrace && view[0].trace.invoices.length === 1);
check('...and is flagged completed, with who and when', view[0].review.completed && view[0].review.completedBy === 'a@tassure.com' && view[0].review.completedAt === '2026-10-07T01:00:00Z');
check('a PI with only a remark stays live and not completed', !view[1].review.completed && view[1].trace === liveTrace && view[1].review.remarks === 'waiting for client');
check('a PI with no record is untouched', !view[2].review.completed && view[2].review.remarks === null && view[2].trace === liveTrace);
check('the key is book + estimate id: TAC #100 is not TAB #100', !view[3].review.completed && view[3].trace === liveTrace);
check('a completed record without a snapshot falls back to the live trace (never a blank)', applyReviews([row({})], [{ ...records[0], completed_trace: null }])[0].trace === liveTrace);
check('applying reviews does not change the quotation itself (amount, status stay live)', view[0].docNumber === 'PI260092' && view[0].statusGroup === 'closed');

check('only a Closed quotation can be completed', canComplete({ statusGroup: 'closed' }) && !canComplete({ statusGroup: 'open' }) && !canComplete({ statusGroup: 'rejected' }));

check('the list window is exactly 12 months back', windowStart12Months('2026-10-07') === '2025-10-07' && windowStart12Months('2026-01-31') === '2025-01-31');
check('29 Feb rolls to 28 Feb a year earlier', windowStart12Months('2028-02-29') === '2027-02-28');
check('records completed over a year ago are purged; the cutoff is 365 days back', purgeCutoffIso(new Date('2026-10-07T00:00:00Z')) === '2025-10-07T00:00:00.000Z');
// the "cannot come back" argument: a PI is completed on/after its own date, so its record is purged on/after date + 1 year,
// and by then its date is no longer inside the 12-month window
const piDate = '2025-11-01', completedOn = '2025-11-10';
const purgedOn = purgeCutoffIso(new Date('2026-11-10T00:00:00Z')); // first day the 365-day cutoff passes completedOn
check('a purged PI is already older than the window (it cannot reappear in the main list)', purgedOn.slice(0, 10) >= completedOn && windowStart12Months('2026-11-10') > piDate, [purgedOn, windowStart12Months('2026-11-10')]);

check('remarks are trimmed; empty means none', cleanRemarks('  hello  ') === 'hello' && cleanRemarks('   ') === null && cleanRemarks(null) === null);
check('over-long remarks are refused', (() => { try { cleanRemarks('x'.repeat(1001)); return false; } catch { return true; } })());
check('a non-text remark is refused', (() => { try { cleanRemarks(5); return false; } catch { return true; } })());

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
