const SGT = 'Asia/Singapore';

/** Returns today's date in Singapore timezone as YYYY-MM-DD */
export function todaySGT(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: SGT });
}

/** Returns current year in Singapore timezone */
export function thisYearSGT(): number {
  return parseInt(new Date().toLocaleDateString('en-CA', { timeZone: SGT }).slice(0, 4), 10);
}

// ── Unified date display: "D MMM YYYY" (e.g. 1 Jan 2013, 3 Sep 2025) ──────────
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_INDEX: Record<string, number> = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11,
  january:0, february:1, march:2, april:3, june:5, july:6, august:7,
  september:8, october:9, november:10, december:11,
};

function fmtParts(y: number, mIdx: number, d: number): string {
  return `${String(d).padStart(2, '0')} ${MONTHS[mIdx]} ${y}`;
}

function validDateParts(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return false;
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Convert an accepted date value to the database-safe YYYY-MM-DD form.
 * The UI can keep showing `03 Apr 2026`, while comparisons and concurrent
 * updates use one unambiguous canonical value.
 */
export function toIsoDateValue(input: string | null | undefined): string | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;

  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (match) {
    const year = +match[1], month = +match[2], day = +match[3];
    return validDateParts(year, month, day)
      ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      : null;
  }

  match = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/);
  if (match) {
    const monthIndex = MONTH_INDEX[match[2].toLowerCase()];
    const year = +match[3], day = +match[1];
    if (monthIndex === undefined || !validDateParts(year, monthIndex + 1, day)) return null;
    return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  match = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (!match) return null;
  const first = +match[1], second = +match[2];
  let year = +match[3];
  if (match[3].length <= 2) year = year < 70 ? 2000 + year : 1900 + year;
  let day: number;
  let month: number;
  if (first > 12 && second <= 12) { day = first; month = second; }
  else if (second > 12 && first <= 12) { month = first; day = second; }
  else if (first > 12 && second > 12) return null;
  else if (match[3].length === 4) { day = first; month = second; }
  else { month = first; day = second; }
  if (!validDateParts(year, month, day)) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Parse many date shapes (ISO yyyy-mm-dd, "D MMM YYYY"/"DD Sept YYYY",
 * dd/mm/yyyy) and return the unified "D MMM YYYY" string. Returns null when
 * the input is not a recognizable date so callers can keep the original text
 * (e.g. free-text notes in a shared status field). Timezone-safe: uses the
 * literal date parts, never a locale conversion.
 */
export function toDisplayDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = String(input).trim();
  if (!s) return null;

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);            // ISO (date or timestamp)
  if (m) return fmtParts(+m[1], +m[2] - 1, +m[3]);

  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\.?,?\s+(\d{4})$/); // "3 Sep 2025" / "30 Sept 2025"
  if (m && MONTH_INDEX[m[2].toLowerCase()] !== undefined) return fmtParts(+m[3], MONTH_INDEX[m[2].toLowerCase()], +m[1]);

  // Numeric a/b/y with / . or - separators, 2- or 4-digit year.
  // Disambiguation, calibrated to this dataset's mixed source conventions:
  //   - a > 12  → a is the day (day-first, e.g. 25.08.2020, 26/12/2019)
  //   - b > 12  → b is the day (month-first, e.g. 8/31/19, 4/10/19)
  //   - both ≤ 12 (ambiguous) → 4-digit year = day-first (dd/mm/yyyy),
  //     2-digit year = month-first (m/d/yy) — the two conventions actually
  //     used, verified by the same date stored both ways (4/10/19 == 10/04/2019).
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    let y = +m[3];
    if (m[3].length <= 2) y = y < 70 ? 2000 + y : 1900 + y;
    let day: number, mon: number;
    if (a > 12 && b <= 12) { day = a; mon = b; }
    else if (b > 12 && a <= 12) { mon = a; day = b; }
    else if (a > 12 && b > 12) return null;
    else if (m[3].length === 4) { day = a; mon = b; }
    else { mon = a; day = b; }
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    return fmtParts(y, mon - 1, day);
  }

  return null;
}

/** Format an ISO string or Date as "D MMM YYYY"; "—" when empty/invalid. */
export function fmtDate(input: string | Date | null | undefined): string {
  if (!input) return '—';
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return '—';
    return fmtParts(input.getFullYear(), input.getMonth(), input.getDate());
  }
  return toDisplayDate(input) ?? '—';
}

/** Format an ISO string or Date as "MMM YYYY" (month + year only). */
export function fmtMonth(input: string | Date | null | undefined): string {
  if (!input) return '—';
  const d = input instanceof Date
    ? input
    : new Date(String(input).length <= 10 ? `${input}T00:00:00` : String(input));
  if (isNaN(d.getTime())) return '—';
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
