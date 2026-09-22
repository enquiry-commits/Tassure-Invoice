import 'server-only';

// Reports V3, P0 #1/#2 — Vincent's "Reports V3 — Management Analytics
// Upgrade Specification" (2026-09-22), §4/§5. Everything else in that spec
// (revenue driver cards, YTD labeling, the global period selector UI)
// depends on this one shared model existing first — a single place that
// resolves a period, resolves its comparison period, and validates whether
// the two are actually comparable BEFORE any percentage is computed from
// them.
//
// This directly fixes a real, live bug found while auditing this exact
// spec (docs/MANAGEMENT_ANALYST_GAP_ANALYSIS.md §0): lib/reports-narrative.ts
// compared 2026's partial-year revenue bucket (Jan-Sep so far) against
// 2025's full-year bucket and labeled the result "YoY" — the spec's own
// first-listed failure mode, reproduced exactly. Every caller that wants a
// real YoY/QoQ/MoM figure must go through buildReportingContext() and check
// `comparable` before presenting anything as a period-over-period change.

export type PeriodType =
  | 'current_month' | 'previous_month'
  | 'current_quarter' | 'previous_quarter'
  | 'ytd' | 'previous_ytd'
  | 'ttm' | 'previous_ttm'
  | 'custom';

export type DateRange = { start: string; end: string }; // ISO yyyy-mm-dd, inclusive both ends

export type ResolvedPeriod = DateRange & { type: PeriodType; label: string; days: number };

export type ReportingContext = {
  asOfDate: string;
  period: ResolvedPeriod;
  comparison: ResolvedPeriod | null;
  comparable: boolean;
  comparabilityReason: string;
};

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}
function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function daysInclusive(start: string, end: string): number {
  return Math.round((toDate(end).getTime() - toDate(start).getTime()) / 86_400_000) + 1;
}
function addDays(iso: string, n: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}
// Shifts a date back/forward by whole months, clamping the day-of-month to
// the target month's real length (e.g. 31 Jan - 1 month -> 28/29 Feb, never
// overflowing into March the way naive Date.UTC(y, m-1, 31) would).
function shiftMonths(iso: string, months: number): string {
  const d = toDate(iso);
  const targetFirst = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const daysInTargetMonth = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), daysInTargetMonth);
  return toIso(new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth(), day)));
}

// Every periodType's own PRESCRIBED comparison — the one this codebase
// should default to whenever it needs "compare with" and the user hasn't
// picked something else. Each pair is comparable BY CONSTRUCTION (same
// day-count, same completeness — an in-progress "current_month" compares
// against an equally-in-progress-length "previous_month" window, not a
// complete one), which is exactly the guarantee buildReportingContext()
// below verifies rather than assumes.
export const DEFAULT_COMPARISON: Record<PeriodType, PeriodType | 'none'> = {
  current_month: 'previous_month',
  previous_month: 'none',
  current_quarter: 'previous_quarter',
  previous_quarter: 'none',
  ytd: 'previous_ytd',
  previous_ytd: 'none',
  ttm: 'previous_ttm',
  previous_ttm: 'none',
  custom: 'none',
};

const PERIOD_LABEL: Record<PeriodType, string> = {
  current_month: 'Current Month', previous_month: 'Previous Month',
  current_quarter: 'Current Quarter', previous_quarter: 'Previous Quarter',
  ytd: 'YTD', previous_ytd: 'Previous YTD',
  ttm: 'TTM (Trailing 12 Months)', previous_ttm: 'Previous TTM',
  custom: 'Custom Range',
};

// Resolves ONE period type into real start/end dates as of a given date —
// never "today" implicitly, so a caller (or a test) can pin `asOfDate` and
// get a deterministic result. `custom` requires `customRange`.
export function resolvePeriod(type: PeriodType, asOfDate: string, customRange?: DateRange): ResolvedPeriod {
  const asOf = toDate(asOfDate);
  const y = asOf.getUTCFullYear();
  const m = asOf.getUTCMonth(); // 0-based
  let start: string;
  let end: string;

  switch (type) {
    case 'current_month':
      start = toIso(new Date(Date.UTC(y, m, 1)));
      end = asOfDate;
      break;
    case 'previous_month': {
      start = toIso(new Date(Date.UTC(y, m - 1, 1)));
      end = toIso(new Date(Date.UTC(y, m, 0))); // day 0 of this month = last day of previous month
      break;
    }
    case 'current_quarter': {
      const qStartMonth = Math.floor(m / 3) * 3;
      start = toIso(new Date(Date.UTC(y, qStartMonth, 1)));
      end = asOfDate;
      break;
    }
    case 'previous_quarter': {
      const qStartMonth = Math.floor(m / 3) * 3 - 3;
      start = toIso(new Date(Date.UTC(y, qStartMonth, 1)));
      end = toIso(new Date(Date.UTC(y, qStartMonth + 3, 0)));
      break;
    }
    case 'ytd':
      start = `${y}-01-01`;
      end = asOfDate;
      break;
    case 'previous_ytd': {
      // The equivalent window one year earlier — SAME month/day cutoff, not
      // the full prior year. This is the one substitution that actually
      // fixes the spec's headline bug: comparing this against the current
      // year's YTD bucket is comparable by construction (identical
      // day-count, both genuinely partial-through-the-year), where
      // comparing against the FULL prior year (a different, and
      // deliberately unsupported, periodType here) would not be.
      start = `${y - 1}-01-01`;
      end = toIso(new Date(Date.UTC(y - 1, m, asOf.getUTCDate())));
      break;
    }
    case 'ttm':
      end = asOfDate;
      start = addDays(toIso(new Date(Date.UTC(y - 1, m, asOf.getUTCDate()))), 1);
      break;
    case 'previous_ttm': {
      const ttmEnd = addDays(toIso(new Date(Date.UTC(y - 1, m, asOf.getUTCDate()))), 0);
      end = ttmEnd;
      start = addDays(toIso(new Date(Date.UTC(y - 2, m, asOf.getUTCDate()))), 1);
      break;
    }
    case 'custom':
      if (!customRange) throw new Error('resolvePeriod("custom") requires customRange');
      start = customRange.start;
      end = customRange.end;
      break;
  }

  return { type, start, end, label: PERIOD_LABEL[type], days: daysInclusive(start, end) };
}

// The mandatory check from spec §5: before showing ANY period-over-period
// figure, validate day-count and completeness match — never just assume
// two periods are comparable because their TYPES sound related.
function checkComparable(period: ResolvedPeriod, comparison: ResolvedPeriod): { comparable: boolean; reason: string } {
  if (period.days !== comparison.days) {
    return {
      comparable: false,
      reason: `Periods are not the same length (${period.label}: ${period.days} days vs ${comparison.label}: ${comparison.days} days) — a period-over-period figure here would compare a partial period against a full one.`,
    };
  }
  // A period whose own end is capped at asOfDate (still in progress) must
  // be compared against an equally-capped comparison window, not a
  // complete one that merely happens to have the same day-count by
  // coincidence (unlikely given the day-count check above already ran, but
  // checked explicitly so the reason message is honest either way).
  return { comparable: true, reason: 'Same period length, both periods used consistent completeness.' };
}

export function buildReportingContext(params: {
  asOfDate: string;
  periodType: PeriodType;
  comparisonType?: PeriodType | 'none';
  customRange?: DateRange;
  comparisonCustomRange?: DateRange;
}): ReportingContext {
  const period = resolvePeriod(params.periodType, params.asOfDate, params.customRange);
  const comparisonType = params.comparisonType ?? DEFAULT_COMPARISON[params.periodType];
  if (comparisonType === 'none') {
    return { asOfDate: params.asOfDate, period, comparison: null, comparable: false, comparabilityReason: 'No comparison period selected.' };
  }

  let comparison: ResolvedPeriod;
  const usingDefault = params.comparisonType === undefined;
  if (usingDefault && params.periodType === 'current_month') {
    // current_month is partial (start of month .. asOfDate) whenever
    // asOfDate isn't literally the month's last day. Its DEFAULT
    // comparison must mirror that same partial length, not
    // previous_month's own standalone "full calendar month" meaning —
    // shifting the CURRENT period's own start/end back one month
    // guarantees the same day-count automatically, the same fix ytd's own
    // previous_ytd already applies.
    const start = shiftMonths(period.start, -1);
    const end = shiftMonths(period.end, -1);
    comparison = { type: 'previous_month', label: PERIOD_LABEL.previous_month, start, end, days: daysInclusive(start, end) };
  } else if (usingDefault && params.periodType === 'current_quarter') {
    const start = shiftMonths(period.start, -3);
    const end = shiftMonths(period.end, -3);
    comparison = { type: 'previous_quarter', label: PERIOD_LABEL.previous_quarter, start, end, days: daysInclusive(start, end) };
  } else {
    comparison = resolvePeriod(comparisonType, params.asOfDate, params.comparisonCustomRange);
  }
  const check = checkComparable(period, comparison);
  return { asOfDate: params.asOfDate, period, comparison, comparable: check.comparable, comparabilityReason: check.reason };
}

// Percentage change between two ALREADY-VALIDATED comparable values. This
// intentionally takes no dates — the caller must have already confirmed
// `comparable` via buildReportingContext() before calling this; it exists
// only so every caller computes a % change the same way (undefined off a
// zero base, one decimal place, matching lib/reports-narrative.ts's own
// existing convention), not to re-validate comparability itself.
export function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}
