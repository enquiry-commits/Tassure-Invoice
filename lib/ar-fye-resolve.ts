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
    if (done) { if (event === 'AGM') cycle.agmDone = true; else cycle.arDone = true; }
    else if (hasDateShape(doneRaw)) { cycle.uncertain = true; note(event === 'AGM' ? 'held' : 'filing', doneRaw); }
  }
  return { cycles: [...byDate.values()].sort((a, b) => a.fyeIso.localeCompare(b.fyeIso)), bad };
}

// ── the FYE month TeamWork implies ──────────────────────────────────────────────────────────────────────────────────
export type SuspectCycle = { fyeIso: string; kind: 'slip' | 'odd-day'; note: string };

/**
 * The month of the company's FYE according to its TeamWork cycles: the month of the LATEST cycle, unless that cycle looks like a
 * keying slip, in which case the latest credible one decides. A later cycle in a different month is a genuine FYE change
 * unless ALL of these hold: it is not held/filed (nobody has relied on it yet) and either
 *   - slip: it lands within SLIP_TOLERANCE_DAYS of an anniversary of an earlier cycle but in another month (30 Sep -> 1 Oct), or
 *   - odd-day: it is not a month-end while every earlier cycle is.
 * Never throws; with no cycle at all the month is null (the caller keeps what it has — an empty answer is never a change).
 */
export function assessFye(cycles: readonly TwCycle[]): { month: string | null; suspects: SuspectCycle[] } {
  const sorted = [...cycles].sort((a, b) => a.fyeIso.localeCompare(b.fyeIso));
  const suspects: SuspectCycle[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = sorted[i];
    const older = sorted.slice(0, i);
    const month = monthOfIso(c.fyeIso);
    if (!older.length) return { month, suspects };
    const doneOlder = [...older].reverse().find(isDoneCycle);
    const established = doneOlder ? monthOfIso(doneOlder.fyeIso) : modeMonth(older);
    if (month === established || isDoneCycle(c)) return { month, suspects };
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
    return { month, suspects };   // a genuine change of FYE month
  }
  return { month: null, suspects };
}

function modeMonth(cycles: readonly TwCycle[]): string {
  const count = new Map<string, number>();
  for (const c of cycles) count.set(monthOfIso(c.fyeIso), (count.get(monthOfIso(c.fyeIso)) ?? 0) + 1);
  let best = '', n = -1;
  // ties go to the most recent of the tied months (the cycles are in date order)
  for (const c of cycles) { const m = monthOfIso(c.fyeIso); const k = count.get(m)!; if (k >= n) { best = m; n = k; } }
  return best;
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
