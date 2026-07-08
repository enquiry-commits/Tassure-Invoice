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

  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);          // dd/mm/yyyy
  if (m) return fmtParts(+m[3], +m[2] - 1, +m[1]);

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
