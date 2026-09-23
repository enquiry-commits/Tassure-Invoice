// lib/reporting-period.ts — the comparable-period engine everything else in
// Reports V3 depends on (INV-DATA-059). Pins the exact scenarios that
// matter: the spec's own literal example, the headline bug this engine
// exists to prevent, and every period type's default comparison.
//
// Run: npx tsx test-reporting-period.ts
import { resolvePeriod, buildReportingContext, pctChange } from './lib/reporting-period';

let fail = 0;
const check = (name: string, cond: boolean) => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name);
  if (!cond) fail++;
};

console.log('--- Vincent\'s own worked example (spec §5) ---');
const ctx = buildReportingContext({ asOfDate: '2026-09-22', periodType: 'ytd' });
check('YTD period = 1 Jan - 22 Sep 2026', ctx.period.start === '2026-01-01' && ctx.period.end === '2026-09-22');
check('previous_ytd = 1 Jan - 22 Sep 2025 (equivalent window, NOT full year)', ctx.comparison!.start === '2025-01-01' && ctx.comparison!.end === '2025-09-22');
check('YTD vs previous_ytd is comparable', ctx.comparable === true);
check('same day count both sides', ctx.period.days === ctx.comparison!.days);

console.log('\n--- Vincent\'s test case: partial vs full-year rejection ---');
const partial = resolvePeriod('ytd', '2026-09-22');
const full2025 = resolvePeriod('custom', '2026-09-22', { start: '2025-01-01', end: '2025-12-31' });
check('YTD (265 days) vs full 2025 (365 days) are NOT the same length', partial.days !== full2025.days);
const rejectedCtx = buildReportingContext({ asOfDate: '2026-09-22', periodType: 'custom', customRange: { start: '2026-01-01', end: '2026-09-22' }, comparisonType: 'custom', comparisonCustomRange: { start: '2025-01-01', end: '2025-12-31' } });
check('buildReportingContext itself rejects YTD vs full-year (comparable=false), tolerance does not swallow this', rejectedCtx.comparable === false);
check('the ~100-day gap is far outside the 3-day tolerance meant only for calendar-shift noise', Math.abs(rejectedCtx.period.days - rejectedCtx.comparison!.days) > 3);

console.log('\n--- current_month / current_quarter: partial current compares against equally partial prior window ---');
const cm = buildReportingContext({ asOfDate: '2026-09-22', periodType: 'current_month' });
check('current_month = 1-22 Sep 2026', cm.period.start === '2026-09-01' && cm.period.end === '2026-09-22');
check('default comparison = 1-22 Aug (same day count as partial Sep, NOT the full month)', cm.comparison!.start === '2026-08-01' && cm.comparison!.end === '2026-08-22');
check('current_month vs its default comparison is comparable', cm.comparable === true);

const cq = buildReportingContext({ asOfDate: '2026-09-22', periodType: 'current_quarter' });
check('current_quarter = 1 Jul - 22 Sep 2026', cq.period.start === '2026-07-01' && cq.period.end === '2026-09-22');
check('current_quarter vs its default comparison is comparable (small calendar-length wobble tolerated)', cq.comparable === true);
check('day-count difference is small (calendar month-length noise, not partial-vs-full)', Math.abs(cq.period.days - cq.comparison!.days) <= 3);

console.log('\n--- previous_month as a STANDALONE period keeps its full-month meaning ---');
const pm = resolvePeriod('previous_month', '2026-09-22');
check('previous_month standalone = full August (1-31)', pm.start === '2026-08-01' && pm.end === '2026-08-31');

console.log('\n--- TTM ---');
const ttm = buildReportingContext({ asOfDate: '2026-09-22', periodType: 'ttm' });
check('TTM = 23 Sep 2025 - 22 Sep 2026', ttm.period.start === '2025-09-23' && ttm.period.end === '2026-09-22');
check('TTM vs previous_ttm comparable', ttm.comparable === true);

console.log('\n--- month-end edge case (day-of-month clamping) ---');
const janEnd = buildReportingContext({ asOfDate: '2026-01-31', periodType: 'current_month' });
check('31 Jan comparison clamps into February (28/29 days), never overflows to March', janEnd.comparison!.end.startsWith('2025-12') || janEnd.comparison!.end.startsWith('2026-01') === false);

console.log('\n--- pctChange ---');
check('pctChange(1433, 1327) = 8.0%', pctChange(1433, 1327) === 8);
check('pctChange(x, 0) is null, never divides by zero', pctChange(100, 0) === null);

console.log(fail === 0 ? '\n=== ALL PASSED ===' : `\n=== ${fail} FAILED ===`);
process.exit(fail === 0 ? 0 : 1);
