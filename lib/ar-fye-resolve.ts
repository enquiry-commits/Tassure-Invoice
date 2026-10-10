// Which FYE month does AR Reminder follow for a company? (INV-AR-021) — pure, no database, no network.
//
// Two inputs, in this order of authority (Vincent, 2026-10-10):
//   1. a month staff DELIBERATELY typed into Master List's FYE column ("TeamWork is the first line, but staff may have to
//      change the system before TeamWork is updated — then AR follows the system and Master List reminds staff that
//      TeamWork shows something else"). Only a value a person edited counts; a value nobody ever edited here, or one
//      automation wrote, still follows TeamWork;
//   2. otherwise the month derived from TeamWork's own AGM/AR history — but never from a date that looks like a keying slip
//      (BEAUTY ASSET PTE LTD, 2026-08: a cycle typed 01/10/2027 instead of 30/09/2027 flipped the company to October four
//      times, and each flip hid its real September row).
//
// companies.fye_month keeps meaning "what TeamWork says" (it feeds billing, e-mails, Company 360 …). Only AR code asks this
// module for the month AR runs on, so a deliberate Master List edit never rewrites a TeamWork-derived column.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** A keying slip is a date within this many days of an anniversary of an earlier cycle, but in the next/previous month. */
export const SLIP_TOLERANCE_DAYS = 3;

/**
 * Statutory due dates of a private company, counted from its financial year end: the AGM within 6 months (Companies Act s175), the
 * annual return within 7 (s197). TeamWork shows the same dates (BEAUTY ASSET: FYE 30 Sep 2026 -> AGM 30 Mar 2027, AR 30 Apr 2027).
 * Vincent, 2026-10-10: Late Filing follows these, not the old FYE + 9 months (INV-TW-006, superseded by INV-AR-021).
 */
export const STATUTORY_AGM_MONTHS = 6;
export const STATUTORY_AR_MONTHS = 7;

// ── dates (strict: a calendar date that does not exist is NOT a date) ────────────────────────────────────────────────
const daysIn = (y: number, m1: number) => new Date(Date.UTC(y, m1, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The first dd/mm/yyyy in `raw` as YYYY-MM-DD, or null when there is none OR it is not a real calendar date.
 * lib/teamwork-agm.ts's parseDmy lets `new Date()` roll an impossible date over (31/09/2026 -> 1 Oct) and returns an
 * Invalid Date for 32/01 — a mistyped cell silently became a different, valid-looking date. Here it stays unreadable.
 */
export function parseDmyStrict(raw: string | null | undefined): string | null {
  const m = String(raw ?? '').replace(/<[^>]+>/g, ' ').match(/(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? realDate(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** Every dd/mm/yyyy in `raw` (a due date that was extended shows both the old and the new one). */
export function allDmyStrict(raw: string | null | undefined): { valid: string[]; invalid: string[] } {
  const out = { valid: [] as string[], invalid: [] as string[] };
  for (const m of String(raw ?? '').replace(/<[^>]+>/g, ' ').matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)) {
    const iso = realDate(Number(m[3]), Number(m[2]), Number(m[1]));
    if (iso) out.valid.push(iso); else out.invalid.push(m[0]);
  }
  return out;
}

export function parseLatestDmyStrict(raw: string | null | undefined): string | null {
  const { valid } = allDmyStrict(raw);
  return valid.length ? valid.reduce((a, b) => (b > a ? b : a)) : null;
}

function realDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > daysIn(y, m)) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

const isoParts = (iso: string) => ({ y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)), d: Number(iso.slice(8, 10)) });
export const monthOfIso = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1];
export const isMonthEndIso = (iso: string) => { const p = isoParts(iso); return p.d === daysIn(p.y, p.m); };
const utc = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const daysBetweenIso = (a: string, b: string) => Math.round((utc(a) - utc(b)) / 86_400_000);
/** `iso` moved by whole years, a 29 Feb clamped to 28 Feb. */
export function addYearsIso(iso: string, n: number): string {
  const p = isoParts(iso);
  const y = p.y + n;
  return `${y}-${pad(p.m)}-${pad(Math.min(p.d, daysIn(y, p.m)))}`;
}
/** Month-end of (monthName, year). */
export function monthEndIso(monthName: string, year: number): string {
  const m = MONTHS.indexOf(monthName as (typeof MONTHS)[number]) + 1;
  return `${year}-${pad(m)}-${pad(daysIn(year, m))}`;
}

// ── a Master List FYE cell → a month name ───────────────────────────────────────────────────────────────────────────
/**
 * 'SEP' | 'Sep' | 'September' | 'SEPT' | '30/09/2026' | '2026-09-30' -> 'September'; anything else (a blank, a word that merely
 * starts like a month such as MAYBE) -> null, so a stray cell can never become an FYE.
 */
export function fyeMonthName(value: string | null | undefined): string | null {
  const t = String(value ?? '').trim();
  if (!t) return null;
  const dm = t.match(/^(\d{1,2})\/(\d{1,2})\/\d{2,4}$/);
  if (dm) { const m = Number(dm[2]); return m >= 1 && m <= 12 ? MONTHS[m - 1] : null; }
  const im = t.match(/^\d{4}-(\d{2})-\d{2}$/);
  if (im) { const m = Number(im[1]); return m >= 1 && m <= 12 ? MONTHS[m - 1] : null; }
  const w = t.toUpperCase().replace(/[^A-Z]/g, '');
  if (w === 'SEPT') return 'September';
  const i = MONTHS.findIndex(name => name.toUpperCase() === w);
  if (i >= 0) return MONTHS[i];
  const a = ABBR.indexOf(w);
  return a >= 0 ? MONTHS[a] : null;
}

// ── TeamWork history → cycles ───────────────────────────────────────────────────────────────────────────────────────
// A row of company_agm/agm_list_ajax: [event, year label, FYE date, ?, due date, held date, filing date, reminder dates].
export type TwCycle = {
  fyeIso: string;                // the cycle's exact FYE date (AGM and AR rows with the same date are one cycle)
  yearLabel: number | null;      // TeamWork's own "Year" cell (NOT always the FYE's calendar year: 14 of 1,656 snapshot rows differ)
  hasAgm: boolean; hasAr: boolean;
  agmDone: boolean; arDone: boolean;   // a held date / a filing date is present
  dueIso: string | null;         // the latest due date shown (an EOT shows the old and the new)
  uncertain: boolean;            // a held/filing cell has text that is not a real date — never decide on this cycle
  extended?: boolean;            // the due date shows a struck-through original: an EOT was applied
  agmEventId?: number | null;    // TeamWork's id of the AGM event (the number in its edit_agm/<id> link) — what a person deletes there
};
export type BadCell = { column: 'fye' | 'due' | 'held' | 'filing'; raw: string; event: string; yearLabel: string };

/** Open = neither the AGM nor the AR row of the cycle shows a held / filing date (the rule generate's catch-up proved on real data). */
export const isOpenCycle = (c: Pick<TwCycle, 'agmDone' | 'arDone' | 'uncertain'>) => !c.uncertain && !c.agmDone && !c.arDone;
export const isDoneCycle = (c: Pick<TwCycle, 'agmDone' | 'arDone'>) => c.agmDone || c.arDone;

const cleanCell = (v: unknown) => String(v ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const hasDateShape = (raw: string) => /\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}/.test(raw);

export function parseTwCycles(rows: readonly (readonly string[])[]): { cycles: TwCycle[]; bad: BadCell[] } {
  const byDate = new Map<string, TwCycle>();
  const bad: BadCell[] = [];
  for (const row of rows ?? []) {
    const event = cleanCell(row?.[0]).toUpperCase();
    if (event !== 'AGM' && event !== 'AR') continue;
    const yearText = cleanCell(row[1]);
    const note = (column: BadCell['column'], raw: string) => bad.push({ column, raw: cleanCell(raw), event, yearLabel: yearText });
    const fyeRaw = String(row[2] ?? '');
    const fyeIso = parseDmyStrict(fyeRaw);
    if (!fyeIso) { if (cleanCell(fyeRaw)) note('fye', fyeRaw); continue; }
    let cycle = byDate.get(fyeIso);
    if (!cycle) {
      const label = Number(yearText);
      cycle = { fyeIso, yearLabel: Number.isInteger(label) && label > 1900 ? label : null, hasAgm: false, hasAr: false, agmDone: false, arDone: false, dueIso: null, uncertain: false };
      byDate.set(fyeIso, cycle);
    }
    // due date: only the latest valid one is used; an unreadable one is reported but does not make the cycle uncertain
    const due = allDmyStrict(String(row[4] ?? ''));
    if (due.invalid.length) note('due', String(row[4] ?? ''));
    const dueIso = due.valid.length ? due.valid.reduce((a, b) => (b > a ? b : a)) : null;
    if (dueIso && (!cycle.dueIso || dueIso > cycle.dueIso)) cycle.dueIso = dueIso;
    // the done cell: held (AGM) or filing (AR)
    const doneRaw = String(event === 'AGM' ? row[5] ?? '' : row[6] ?? '');
    const done = parseDmyStrict(doneRaw);
    if (event === 'AGM') cycle.hasAgm = true; else cycle.hasAr = true;
    if (/<strike|<s>|<del/i.test(String(row[4] ?? ''))) cycle.extended = true;
    if (event === 'AGM') { const id = /edit_agm\/(\d+)/.exec(String(row[8] ?? '')); if (id) cycle.agmEventId = Number(id[1]); }
    if (done) { if (event === 'AGM') cycle.agmDone = true; else cycle.arDone = true; }
    else if (hasDateShape(doneRaw)) { cycle.uncertain = true; note(event === 'AGM' ? 'held' : 'filing', doneRaw); }
  }
  return { cycles: [...byDate.values()].sort((a, b) => a.fyeIso.localeCompare(b.fyeIso)), bad };
}

// ── the FYE month TeamWork implies ──────────────────────────────────────────────────────────────────────────────────
export type SuspectCycle = { fyeIso: string; kind: 'slip' | 'odd-day' | 'agm-only'; note: string };

/**
 * The month of the company's FYE according to its TeamWork cycles: the month of the LATEST cycle, unless that cycle looks like a
 * keying slip, in which case the latest credible one decides. A later cycle in a different month is a genuine FYE change
 * unless ALL of these hold: it is not held/filed (nobody has relied on it yet) and either
 *   - slip: it lands within SLIP_TOLERANCE_DAYS of an anniversary of an earlier cycle but in another month (30 Sep -> 1 Oct), or
 *   - odd-day: it is not a month-end while every earlier cycle is.
 * Never throws; with no cycle at all the month is null (the caller keeps what it has — an empty answer is never a change).
 */
export type FyeAssessment = {
  month: string | null;
  /** The cycle that decided the month — the one whose DAY the company's year end has (pickFyeDay). null when no cycle is credible. */
  chosen: TwCycle | null;
  suspects: SuspectCycle[];
};

export function assessFye(cycles: readonly TwCycle[]): FyeAssessment {
  const sorted = [...cycles].sort((a, b) => a.fyeIso.localeCompare(b.fyeIso));
  const suspects: SuspectCycle[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = sorted[i];
    const older = sorted.slice(0, i);
    const month = monthOfIso(c.fyeIso);
    if (!older.length) return { month, chosen: c, suspects };
    const doneOlder = [...older].reverse().find(isDoneCycle);
    const established = doneOlder ? monthOfIso(doneOlder.fyeIso) : modeMonth(older);
    if (month === established || isDoneCycle(c)) return { month, chosen: c, suspects };
    // An AGM event with no AR event beside it is not a financial period TeamWork can vouch for (a real one carries both; 3,057 of
    // 3,063 live cycles do). It may never MOVE the FYE month — ORBITEZ's leftover June 2025 AGM would otherwise flip a December
    // company to June the day someone deletes the wrong one of the two rows both labelled "2025" (council, 2026-10-10).
    if (c.hasAgm && !c.hasAr) {
      suspects.push({ fyeIso: c.fyeIso, kind: 'agm-only', note: `${c.fyeIso} has an AGM event but no AR event and is in ${month}, not ${established} — it cannot move the FYE month` });
      continue;
    }
    const slipOf = older.find(o => {
      if (monthOfIso(o.fyeIso) === month) return false;
      const years = isoParts(c.fyeIso).y - isoParts(o.fyeIso).y;
      return years >= 1 && Math.abs(daysBetweenIso(c.fyeIso, addYearsIso(o.fyeIso, years))) <= SLIP_TOLERANCE_DAYS;
    });
    if (slipOf) {
      suspects.push({ fyeIso: c.fyeIso, kind: 'slip', note: `${c.fyeIso} is within ${SLIP_TOLERANCE_DAYS} days of the anniversary of ${slipOf.fyeIso} but in ${month}, not ${monthOfIso(slipOf.fyeIso)} — looks like a keying slip (e.g. 01/10 instead of 30/09)` });
      continue;
    }
    if (!isMonthEndIso(c.fyeIso) && older.every(o => isMonthEndIso(o.fyeIso))) {
      suspects.push({ fyeIso: c.fyeIso, kind: 'odd-day', note: `${c.fyeIso} is not a month-end although every earlier FYE of this company is, and it would move the FYE to ${month}` });
      continue;
    }
    return { month, chosen: c, suspects };   // a genuine change of FYE month
  }
  return { month: null, chosen: null, suspects };
}

function modeMonth(cycles: readonly TwCycle[]): string {
  const count = new Map<string, number>();
  for (const c of cycles) count.set(monthOfIso(c.fyeIso), (count.get(monthOfIso(c.fyeIso)) ?? 0) + 1);
  let best = '', n = -1;
  // ties go to the most recent of the tied months (the cycles are in date order)
  for (const c of cycles) { const m = monthOfIso(c.fyeIso); const k = count.get(m)!; if (k >= n) { best = m; n = k; } }
  return best;
}

// ── the DAY the financial year ends on (INV-AR-021 (9)) ─────────────────────────────────────────────────────────────
// companies.fye_month and companies.fye_day are ONE fact — "the year end is 31 December" — and have ONE owner: the cycles TeamWork
// keeps for the company (what is actually filed with ACRA), read by sync-workflow every night. TeamWork's company PROFILE ("dd/mm")
// is only a bootstrap for a company that has no month yet (profileFyePatch): it still holds the year end from before many companies
// changed it (BYTESFORCE: profile 28/02, every AGM/AR cycle 31/12), and mixing the cycles' month with the profile's day built dates
// that never existed (generate wrote "28 Dec 2026" for BYTESFORCE; TeamWork's cycle is 31 Dec 2026 and the exact-date row match then
// never connected the two — Vincent, 2026-10-11).

/** A year-end date a company can really have: a month-end, or a day another credible cycle of the same month also uses. */
export function isUsualFyeDay(cycles: readonly TwCycle[], c: Pick<TwCycle, 'fyeIso'>): boolean {
  if (isMonthEndIso(c.fyeIso)) return true;
  return cycles.some(o => o.fyeIso !== c.fyeIso && !o.uncertain && o.fyeIso.slice(5, 7) === c.fyeIso.slice(5, 7) && o.fyeIso.slice(8, 10) === c.fyeIso.slice(8, 10));
}

export type FyeDayChoice = {
  /** The day of the month the cycles say the year ends on; null = not clear enough to write anywhere. */
  day: number | null;
  basis: 'month-end' | 'habitual' | 'unclear' | 'none';
  fyeIso: string | null;
};

/**
 * The year-end day implied by the cycle assessFye chose. A month-end is taken at once (31 Dec, 30 Sep, 28/29 Feb). A day that is
 * NOT a month-end is taken only when another cycle of the same month used it too (a company whose year end really is the 15th);
 * a lone odd day (a same-month keying slip such as 21/12 for 31/12 — assessFye guards the month, not the day) is "unclear" and
 * written nowhere.
 */
export function pickFyeDay(cycles: readonly TwCycle[], chosen: Pick<TwCycle, 'fyeIso'> | null): FyeDayChoice {
  if (!chosen) return { day: null, basis: 'none', fyeIso: null };
  const day = Number(chosen.fyeIso.slice(8, 10));
  if (isMonthEndIso(chosen.fyeIso)) return { day, basis: 'month-end', fyeIso: chosen.fyeIso };
  if (isUsualFyeDay(cycles, chosen)) return { day, basis: 'habitual', fyeIso: chosen.fyeIso };
  return { day: null, basis: 'unclear', fyeIso: chosen.fyeIso };
}

/** 28 and 29 February are the same year end ("the end of February") in different years. */
export function sameFyeDay(monthName: string | null | undefined, a: number, b: number): boolean {
  return a === b || (monthName === 'February' && a >= 28 && b >= 28);
}

/**
 * The value to write into companies.fye_day, or null when nothing needs writing. An empty stored day already means "the last day of
 * the month" (generate, AR) — it is filled only when the year end is a day that is NOT the month-end. A stored day is replaced when
 * it is not the same year end as the cycles' (28/02 against 31/12, a 31 for June).
 */
export function fyeDayToWrite(stored: number | null | undefined, monthName: string | null | undefined, choice: FyeDayChoice): number | null {
  if (choice.day == null) return null;
  if (stored == null) return choice.basis === 'habitual' ? choice.day : null;
  return sameFyeDay(monthName, stored, choice.day) ? null : choice.day;
}

const MAX_DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
/** A stored year-end day cut to what the month can have (YAN BIN: June 31 -> 30; February 30 -> 29). null for a missing/invalid day. */
export function clampFyeDay(monthName: string | null | undefined, day: number | null | undefined): number | null {
  if (day == null || !Number.isInteger(day) || day < 1) return null;
  const i = MONTHS.indexOf(String(monthName ?? '') as (typeof MONTHS)[number]);
  return i < 0 ? day : Math.min(day, MAX_DAYS_IN_MONTH[i]);
}

/**
 * What teamwork/sync may take from TeamWork's company PROFILE year end (INV-TW-003): only to BOOTSTRAP a company that has no FYE month
 * yet — the month and its day together, because the profile's day belongs to the profile's month. Never to overwrite and never to "fill
 * the day in" later: the day of a stored month is owned by the cycles (sync-workflow). Filling an empty day from the profile would paste
 * the stale 28 back onto a December company (council, 2026-10-11).
 */
export function profileFyePatch(row: { fye_month?: string | null }, profile: { month: string | null; day: number | null }): { fye_month?: string; fye_day?: number } {
  if (row.fye_month || !profile.month) return {};
  return profile.day ? { fye_month: profile.month, fye_day: profile.day } : { fye_month: profile.month };
}

// ── a cycle TeamWork left behind that cannot be real ────────────────────────────────────────────────────────────────
export type LeftoverCycle = {
  fyeIso: string; dueIso: string | null; month: string;
  agmEventId: number | null;            // the AGM event a person deletes in TeamWork
  anchorFye: string; nextFye: string;   // the filed cycle before it and the same-month cycle one year later
  note: string;
};
/** How many companies one run may find with a leftover before the rule is treated as suspect and ignores NONE (the Late Filing sync). */
export const MAX_LEFTOVER_COMPANIES_PER_RUN = 3;

/**
 * An OPEN cycle that cannot be a real financial period, so the system follows the latest cycle instead (Vincent, 2026-10-10:
 * "ORBITEZ 就按照最新的跑，但是可以有一个提醒在系统"). Deliberately NARROW — the 4-seat council (Singapore company secretary,
 * Skeptic, Pragmatist, Operator) rejected the broad "other month + a later cycle" rule because it would drop a genuinely unfiled
 * old-month year. ALL of these must hold:
 *   1. it is open (no AGM held, no AR filed, no unreadable cell) and no EOT was applied to it;
 *   2. it has an AGM event but NO AR event — a real period carries both (3,057 of 3,063 live cycles), and ACRA's AR is what every
 *      later cycle hangs on;
 *   3. its month is not the company's FYE month (assessFye);
 *   4. the latest earlier cycle in the company's month whose AR was FILED (A) exists, and the same-month cycle exactly one year later
 *      (B, within 3 days) exists with both events — so it sits INSIDE a 12-month year that TeamWork itself records, and a
 *      company may change its financial year end only from its current or immediately previous one, never inside a filed year.
 * ORBITEZ: A = 31/12/2024 (AR filed 01/09/2025), B = 31/12/2025, leftover = the AGM for FYE 30/06/2025 (event 8033). Everything
 * else that merely looks odd (an 18-month transition, a first financial year, a held or filed cycle, an LLP, a restored shell) stays
 * counted and is only reported. One definition: Late Filing, Master List's next AGM due, the AR plan and generate's catch-up all call this.
 */
export function findLeftoverCycles(cycles: readonly TwCycle[]): LeftoverCycle[] {
  const sorted = [...cycles].sort((a, b) => a.fyeIso.localeCompare(b.fyeIso));
  const assessed = assessFye(sorted);
  const month = assessed.month;
  if (!month) return [];
  const slipDates = new Set(assessed.suspects.map(s => s.fyeIso));
  const out: LeftoverCycle[] = [];
  for (const c of sorted) {
    if (!isOpenCycle(c) || c.extended || !c.hasAgm || c.hasAr || monthOfIso(c.fyeIso) === month) continue;
    const anchor = [...sorted].reverse().find(p => p.fyeIso < c.fyeIso && monthOfIso(p.fyeIso) === month && p.hasAgm && p.hasAr && p.arDone);
    if (!anchor) continue;
    const oneYear = addYearsIso(anchor.fyeIso, 1);
    const next = sorted.find(n => n.fyeIso > c.fyeIso && monthOfIso(n.fyeIso) === month && n.hasAgm && n.hasAr && !slipDates.has(n.fyeIso) && Math.abs(daysBetweenIso(n.fyeIso, oneYear)) <= SLIP_TOLERANCE_DAYS);
    if (!next) continue;
    out.push({
      fyeIso: c.fyeIso, dueIso: c.dueIso, month: monthOfIso(c.fyeIso), agmEventId: c.agmEventId ?? null, anchorFye: anchor.fyeIso, nextFye: next.fyeIso,
      note: `AGM event${c.agmEventId ? ` ${c.agmEventId}` : ''} for FYE ${c.fyeIso} (${monthOfIso(c.fyeIso)}) has no AR event and sits inside the ${month} year ${anchor.fyeIso} -> ${next.fyeIso}, whose AR was filed — it cannot be a real period`,
    });
  }
  return out;
}

/** The FYE dates (YYYY-MM-DD) of the leftover cycles in a raw TeamWork AGM list, ready to skip their events by date. */
export function leftoverFyeDates(rows: readonly (readonly string[])[]): Set<string> {
  return new Set(findLeftoverCycles(parseTwCycles(rows).cycles).map(l => l.fyeIso));
}

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/**
 * The short reminder that goes into Late Filing's remark — and from it, through the reconciliation pass, into the AR Reminder row's
 * "⚠ LATE FILING" line and its LATE badge tooltip: the places staff actually look (the Dashboard's exception register is Vincent-only).
 * It must never contain "Overdue N days" (lib/late-filing-categorize.ts reads the first one) or "STRIKE OFF".
 */
export function leftoverReminder(l: LeftoverCycle): string {
  const id = l.agmEventId ? `, event ${l.agmEventId}` : '';
  return `TeamWork has an extra AGM for FYE ${ddmmyyyy(l.fyeIso)}${id} that cannot exist - ignored, delete it in TeamWork / TeamWork 里多了一条不存在的 AGM（FYE ${ddmmyyyy(l.fyeIso)}），已忽略，请删除`;
}

/** The full message for Vincent's exception register (Chinese first, then English). */
export function leftoverExceptionMessage(company: string, l: LeftoverCycle): string {
  const id = l.agmEventId ? `，事件号 ${l.agmEventId}` : '';
  const due = l.dueIso ? `，到期 ${ddmmyyyy(l.dueIso)}` : '';
  return `TeamWork 里 ${company} 多了一条不存在的 AGM（FYE ${ddmmyyyy(l.fyeIso)}${due}，没有对应的 AR${id}）。这家公司 ${ddmmyyyy(l.anchorFye)} 那一年的 AR 已经递交，下一年度是 ${ddmmyyyy(l.nextFye)}，一个已递交的年度中间不可能再有 ${Number(l.fyeIso.slice(5, 7))} 月年结。系统已忽略这一条，按最新的 FYE ${ddmmyyyy(l.nextFye)} 跟进（Late Filing 和 Master List 的 Next AGM Due 都不再用它）。请在 TeamWork 把它删掉：只删 FYE ${ddmmyyyy(l.fyeIso)} 那条，不要动 ${ddmmyyyy(l.nextFye)}，也不要填假的开会日期；删掉后这条提醒会自动消失。`
    + ` / TeamWork lists an AGM for FYE ${ddmmyyyy(l.fyeIso)} with no AR event inside ${company}'s filed year ${ddmmyyyy(l.anchorFye)} -> ${ddmmyyyy(l.nextFye)}; it cannot be a real period. The system ignores it and follows FYE ${ddmmyyyy(l.nextFye)}. Delete only that AGM event in TeamWork (leave ${ddmmyyyy(l.nextFye)} alone; never key a fake held date). This reminder clears itself.`;
}

// ── what staff typed in Master List ─────────────────────────────────────────────────────────────────────────────────
export type ManualFye = { month: string; by: string | null; at: string | null; basis: 'audit' | 'flag' };
export type FyeAudit = { changedBy: string | null; newValue: string | null; changedAt: string | null };

/** A person (an e-mail address), not 'system:…' automation and not 'unknown'. */
export const isPersonActor = (changedBy: string | null | undefined) => /@/.test(String(changedBy ?? '')) && !/^system:/i.test(String(changedBy));

/**
 * Was the CURRENT Master List FYE typed by a person?  Evidence, strongest first:
 *   audit — the latest audit_log entry for this cell was made by a person and wrote the value that is there now;
 *   flag  — master_list.manual_fields.fye is set (the PATCH handler sets it on every deliberate edit, and old rows from the
 *           time FYE was auto-synced carry it too).
 * If the latest audit entry was written by automation and holds the current value, automation wrote it last: not deliberate.
 * A cell that was never edited here (imported with the sheet) has neither, so it follows TeamWork.
 */
export function manualFyeFromMaster(input: { fye: string | null | undefined; manualFields?: Record<string, unknown> | null; lastAudit?: FyeAudit | null }): ManualFye | null {
  const month = fyeMonthName(input.fye);
  if (!month) return null;
  const a = input.lastAudit ?? null;
  const auditMonth = a ? fyeMonthName(a.newValue) : null;
  if (a && auditMonth === month) {
    if (isPersonActor(a.changedBy)) return { month, by: a.changedBy, at: a.changedAt, basis: 'audit' };
    return null;
  }
  if (input.manualFields && input.manualFields.fye === true) return { month, by: null, at: null, basis: 'flag' };
  return null;
}

export type EffectiveFye = {
  effective: string | null;
  source: 'master-list' | 'teamwork' | 'stored' | 'none';
  teamworkMonth: string | null;     // what TeamWork implies (derived, else what companies.fye_month holds)
  differs: boolean;                 // a deliberate Master List month that TeamWork does not show
};

/** The month AR runs on. stored = companies.fye_month, derived = assessFye(...).month. */
export function resolveEffectiveFye(input: { stored: string | null | undefined; derived: string | null | undefined; manual: ManualFye | null }): EffectiveFye {
  const stored = input.stored && (MONTHS as readonly string[]).includes(input.stored) ? input.stored : null;
  const derived = input.derived && (MONTHS as readonly string[]).includes(input.derived) ? input.derived : null;
  const teamworkMonth = derived ?? stored;
  if (input.manual) return { effective: input.manual.month, source: 'master-list', teamworkMonth, differs: input.manual.month !== teamworkMonth };
  if (derived) return { effective: derived, source: 'teamwork', teamworkMonth, differs: false };
  if (stored) return { effective: stored, source: 'stored', teamworkMonth, differs: false };
  return { effective: null, source: 'none', teamworkMonth: null, differs: false };
}
