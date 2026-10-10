// AR Reminder COVERAGE — an independent, outcome-based check (no writes, no TeamWork calls).
//
// The 9-seat council (2026-10-10) agreed on one thing: every control we had lived INSIDE the mechanisms that create or hide
// rows, so when a mechanism failed quietly nothing looked at the RESULT. This asks the result question directly:
//
//   "For each active client, TeamWork's next open cycle (master_list.next_agm_due_date, synced nightly from TeamWork)
//    implies a financial year end. Is there a VISIBLE ar_reminder row for that cycle?"
//
// It reads two sources written by different code (Master List's TeamWork-derived dates, and ar_reminder), so it does not
// share a blind spot with generate / catch-up / FYE-correction / Late Filing. It only REPORTS — it never repairs
// (INV-AR-020). Pure functions: the database reads live in scripts/ar-coverage-report.ts.
//
// How the expected cycle is found: an AGM falls due 6 months after FYE (Companies Act s175; TeamWork shows the same),
// later when an extension of time (EOT) was granted. So the date is matched against the company's OWN FYE month:
// FYE(y) + 6 months .. + 130 days. A date that fits no year is a data question (DATE_INCONSISTENT), never a guess.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WINDOW_MONTHS = 6;          // generate creates rows for the current month and the next 5 (generate/route.ts)
export const MAX_EOT_DAYS = 130;         // an AGM extension of time on top of FYE + 6 months (60 days each, possibly twice)
export const STALE_AFTER_MONTHS = 12;    // an open cycle older than this is either an ancient unheld cycle or stale data

export type CovCompany = { id: number; company_name: string; registration_no: string | null; fye_month: string | null; fye_day?: number | null };
export type CovMaster = { roc_no: string | null; company_name: string; next_agm_due_date: string | null; eot_original_due_date?: string | null };
export type CovRow = {
  id: number; entity_name: string; company_id: number | null; uen: string | null; fye_month: string; fye_year: number;
  fye_date: string | null; status: string | null; filling_date: string | null;
};

export type Finding =
  | { kind: 'MISSING'; company: CovCompany; expectedYm: string; due: string; hidden: CovRow[] }
  | { kind: 'WRONG_MONTH'; company: CovCompany; row: CovRow }
  | { kind: 'LABEL_MISMATCH'; row: CovRow }
  | { kind: 'DUPLICATE'; company: CovCompany; ym: string; rows: CovRow[] }
  | { kind: 'STALE_OPEN'; company: CovCompany; row: CovRow; expectedYm: string }
  | { kind: 'DATE_INCONSISTENT'; company: CovCompany; due: string }
  | { kind: 'STALE_MASTER'; company: CovCompany; expectedYm: string; due: string; covered: boolean };

export type CoverageStats = {
  companies: number; checked: number; covered: number; notYetDue: number; noMaster: number; noFye: number; noDue: number; unparseableDue: number;
  missing: number; wrongMonth: number; labelMismatch: number; duplicate: number; staleOpen: number; dateInconsistent: number; staleMaster: number;
};

export const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
export const normalizeUen = (v: string | null | undefined) => String(v ?? '').trim().toUpperCase();
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

/** YYYY-MM-DD plus n months, the day clamped to the target month (31 Mar - 6 months = 30 Sep, never 1 Oct). */
export function addMonthsClamped(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

/**
 * The financial year end (YYYY-MM) whose AGM falls due on `agmDue`, for a company whose FYE month is `fyeMonth`:
 * the year y where FYE(y) + 6 months <= due <= that + MAX_EOT_DAYS (a few days of slack below for end-of-month rounding).
 * null when the date fits no year — the caller reports that as a data question.
 */
export function alignFyeYm(agmDue: string, fyeMonth: string, fyeDay?: number | null): string | null {
  const mi = MONTHS.indexOf(fyeMonth);
  if (mi < 0 || !isIsoDate(agmDue)) return null;
  const dueYear = Number(agmDue.slice(0, 4));
  let best: { ym: string; ext: number } | null = null;
  for (let y = dueYear - 3; y <= dueYear; y++) {
    const last = new Date(Date.UTC(y, mi + 1, 0)).getUTCDate();
    const day = fyeDay && fyeDay >= 1 && fyeDay <= last ? fyeDay : last;
    const fye = `${y}-${String(mi + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const ext = daysBetween(agmDue, addMonthsClamped(fye, 6));
    if (ext >= -3 && ext <= MAX_EOT_DAYS && (!best || ext < best.ext)) best = { ym: fye.slice(0, 7), ext };
  }
  return best?.ym ?? null;
}

/** The YYYY-MM a row stands for: its fye_date, else its month/year label. */
export function rowYm(r: Pick<CovRow, 'fye_date' | 'fye_month' | 'fye_year'>): string | null {
  if (isIsoDate(String(r.fye_date ?? '').slice(0, 10))) return String(r.fye_date).slice(0, 7);
  const i = MONTHS.indexOf(r.fye_month);
  return i < 0 ? null : `${r.fye_year}-${String(i + 1).padStart(2, '0')}`;
}

const ymPlus = (iso: string, n: number) => addMonthsClamped(iso, n).slice(0, 7);

export function reconcileCoverage(input: { companies: readonly CovCompany[]; masters: readonly CovMaster[]; rows: readonly CovRow[]; today?: string; windowMonths?: number }) {
  const { companies, masters, rows } = input;
  const today = input.today && isIsoDate(input.today) ? input.today : new Date().toISOString().slice(0, 10);
  const horizonYm = ymPlus(today, (input.windowMonths ?? WINDOW_MONTHS) - 1);   // rows exist for FYE months up to here
  const staleBeforeYm = ymPlus(today, -STALE_AFTER_MONTHS);
  const stats: CoverageStats = {
    companies: companies.length, checked: 0, covered: 0, notYetDue: 0, noMaster: 0, noFye: 0, noDue: 0, unparseableDue: 0,
    missing: 0, wrongMonth: 0, labelMismatch: 0, duplicate: 0, staleOpen: 0, dateInconsistent: 0, staleMaster: 0,
  };
  const findings: Finding[] = [];

  // Master List rows by UEN; a UEN that appears twice is ambiguous and is skipped rather than guessed
  const mastersByUen = new Map<string, CovMaster[]>();
  for (const m of masters) { const u = normalizeUen(m.roc_no); if (u) (mastersByUen.get(u) ?? mastersByUen.set(u, []).get(u)!).push(m); }

  const rowsByCompany = new Map<number, CovRow[]>();
  const rowsByUen = new Map<string, CovRow[]>();
  for (const r of rows) {
    if (r.company_id != null) (rowsByCompany.get(r.company_id) ?? rowsByCompany.set(r.company_id, []).get(r.company_id)!).push(r);
    const u = normalizeUen(r.uen); if (u) (rowsByUen.get(u) ?? rowsByUen.set(u, []).get(u)!).push(r);
  }

  for (const r of rows) {
    const ym = rowYm(r);
    if (r.fye_date && ym && r.status !== 'Excluded' && MONTHS[Number(ym.slice(5, 7)) - 1] !== r.fye_month) { findings.push({ kind: 'LABEL_MISMATCH', row: r }); stats.labelMismatch++; }
  }

  for (const c of companies) {
    const mine = new Map<number, CovRow>();
    for (const r of rowsByCompany.get(c.id) ?? []) mine.set(r.id, r);
    const uen = normalizeUen(c.registration_no);
    if (uen) for (const r of rowsByUen.get(uen) ?? []) mine.set(r.id, r);
    const visible = [...mine.values()].filter(r => r.status !== 'Excluded');

    // a visible, unfiled row stored under a month that is not the company's current FYE month (BEAUTY #867 / MAPLE GROVE #866)
    if (c.fye_month) for (const r of visible) if (!r.filling_date && r.fye_month !== c.fye_month) { findings.push({ kind: 'WRONG_MONTH', company: c, row: r }); stats.wrongMonth++; }

    // two visible rows for the same cycle
    const byYm = new Map<string, CovRow[]>();
    for (const r of visible) { const ym = rowYm(r); if (ym) (byYm.get(ym) ?? byYm.set(ym, []).get(ym)!).push(r); }
    for (const [ym, list] of byYm) if (list.length > 1) { findings.push({ kind: 'DUPLICATE', company: c, ym, rows: list }); stats.duplicate++; }

    if (!c.fye_month) { stats.noFye++; continue; }
    const ms = uen ? mastersByUen.get(uen) ?? [] : [];
    if (ms.length !== 1) { stats.noMaster++; continue; }
    const due = ms[0].eot_original_due_date && isIsoDate(ms[0].eot_original_due_date) ? ms[0].eot_original_due_date : ms[0].next_agm_due_date;
    if (!due) { stats.noDue++; continue; }
    if (!isIsoDate(due)) { stats.unparseableDue++; continue; }

    const expectedYm = alignFyeYm(due, c.fye_month, c.fye_day);
    if (!expectedYm) { findings.push({ kind: 'DATE_INCONSISTENT', company: c, due }); stats.dateInconsistent++; continue; }
    stats.checked++;
    const covered = visible.some(r => rowYm(r) === expectedYm);

    if (expectedYm < staleBeforeYm) { findings.push({ kind: 'STALE_MASTER', company: c, expectedYm, due, covered }); stats.staleMaster++; continue; }
    if (expectedYm > horizonYm) stats.notYetDue++;                 // the row is not due to exist yet — not a miss
    else if (covered) stats.covered++;
    else { findings.push({ kind: 'MISSING', company: c, expectedYm, due, hidden: [...mine.values()].filter(r => r.status === 'Excluded' && rowYm(r) === expectedYm) }); stats.missing++; }

    // an open, unfiled row OLDER than TeamWork's next open cycle whose own AGM date has already passed: either the filing
    // was never synced to the row, or an earlier cycle is genuinely overdue — a person decides
    for (const r of visible) {
      const ym = rowYm(r);
      if (r.filling_date || !ym || ym >= expectedYm) continue;
      const rowAgmDue = addMonthsClamped(`${ym}-28`, 6);
      if (rowAgmDue < today) { findings.push({ kind: 'STALE_OPEN', company: c, row: r, expectedYm }); stats.staleOpen++; }
    }
  }
  return { findings, stats, horizonYm };
}
