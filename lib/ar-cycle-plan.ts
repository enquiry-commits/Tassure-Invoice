// The nightly, STATE-BASED plan for one company's AR Reminder rows (INV-AR-021) — pure, no database, no network.
//
// Until now AR rows were only corrected at the moment something changed: the FYE correction hid a company's old-month rows
// once, when fye_month flipped, and nothing ever compared the rows with TeamWork again. A wrong night therefore survived
// every later right night (BEAUTY ASSET PTE LTD: September row hidden 11 Aug, TeamWork fixed 18 Aug, row still hidden on
// 9 Oct). Vincent, 2026-10-10: "the AR rows must be recomputed from the current state every night".
//
// Given the month AR runs on (lib/ar-fye-resolve.ts), TeamWork's cycles for the company and ALL its ar_reminder rows
// (hidden ones too), this says what the visible rows must look like and what differs:
//   wanted  — an OPEN cycle that is due to have a row (inside the window) has none visible: restore a row the system hid,
//             else insert one; a row a person hid is never touched (the executor reports it);
//   hide    — a visible, unfiled row under another month than the FYE month for which TeamWork has no cycle at that exact
//             date (a ghost), or which the same cycle now relabelled by a Master List FYE edit replaces;
//   align   — a visible, unfiled row under the FYE month whose date is not TeamWork's date for the cycle of that SAME calendar month
//             (generate forecasts a row's date itself, months ahead — BYTESFORCE got 28 Dec 2026, TeamWork's cycle is 31 Dec 2026):
//             set the row's date to TeamWork's, so the exact-date row sync can finally connect the row with its cycle (INV-AR-021 (9));
//   reports — things only TeamWork can fix, or that were left alone on purpose.
// A cycle is matched by its EXACT FYE date, never by "the company's latest month" (the mistake that made the Late Filing
// ghost rows #866/#867). Rows under the FYE month are never hidden here, so a bad TeamWork night cannot empty the page.

import { addMonthsClamped } from './ar-coverage';
import { holdsSlot, type Slot } from './ar-fye-restore';
import { MONTHS, isOpenCycle, isUsualFyeDay, monthEndIso, monthOfIso, daysBetweenIso, type TwCycle } from './ar-fye-resolve';

export const PLAN_WINDOW_MONTHS = 6;        // generate creates rows for the current month and the next 5
export const PLAN_STALE_AFTER_MONTHS = 12;  // an open cycle older than this is reported, not rebuilt

export type PlanRow = {
  id: number; entity_name: string; company_id: number | null; fye_month: string; fye_year: number;
  fye_date: string | null; status: string | null; filling_date: string | null; agm_held_date: string | null;
  due_date?: string | null;                // only read to move a still-untouched computed due date along with an aligned FYE date
};
export type PlanInput = {
  company: { id: number; name: string };
  effectiveMonth: string;                  // the month AR runs on
  teamworkMonth: string | null;            // the month of TeamWork's cycles; differs from effectiveMonth only under a Master List edit
  cycles: readonly TwCycle[];
  suspectDates?: ReadonlySet<string>;      // cycles lib/ar-fye-resolve.ts assessFye refused to believe
  leftoverDates?: ReadonlySet<string>;     // cycles findLeftoverCycles says cannot be real (a TeamWork leftover): followed past, never wanted
  rows: readonly PlanRow[];                // EVERY ar_reminder row of the company, hidden ones too
  today: string;                           // YYYY-MM-DD
  windowMonths?: number;
  staleAfterMonths?: number;
};
export type Wanted = { slot: Slot & { fye_date: string }; cycleFye: string; relabelled: boolean };
export type HideReason = 'phantom' | 'superseded-by-master-list';
export type PlanReport =
  | { kind: 'suspect-cycle'; fyeIso: string }
  | { kind: 'leftover-cycle'; fyeIso: string }
  | { kind: 'uncertain-cycle'; fyeIso: string }
  | { kind: 'stale-cycle'; fyeIso: string }
  | { kind: 'other-month-cycle'; fyeIso: string; month: string }
  | { kind: 'date-drift'; rowId: number; rowDate: string; slotDate: string }
  | { kind: 'row-without-date'; rowId: number };
export type PlanAlign = {
  row: PlanRow;
  from: string; to: string;                // the row's FYE date now / TeamWork's date for that cycle (same calendar month)
  cycleFye: string;
  dueFrom: string | null; dueTo: string | null;   // set only when the row's due date is still exactly the computed FYE + 7 months of `from`
};
export type CompanyPlan = {
  wanted: Wanted[];
  hide: Array<{ row: PlanRow; reason: HideReason }>;
  align: PlanAlign[];
  covered: number;                         // open, in-window cycles that already have a visible row
  reports: PlanReport[];
};

const day = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null);
const lastDayOfYm = (ym: string) => monthEndIso(MONTHS[Number(ym.slice(5, 7)) - 1], Number(ym.slice(0, 4)));

/** The year in which `monthName`'s month-end is nearest to `iso` (ties go to the earlier year). */
export function nearestYearOf(monthName: string, iso: string): number {
  const y = Number(iso.slice(0, 4));
  let best = y, bestGap = Infinity;
  for (const cand of [y - 1, y, y + 1]) {
    const gap = Math.abs(daysBetweenIso(monthEndIso(monthName, cand), iso));
    if (gap < bestGap) { best = cand; bestGap = gap; }
  }
  return best;
}

export function planCompanyAr(input: PlanInput): CompanyPlan {
  const E = input.effectiveMonth;
  const T = input.teamworkMonth ?? E;
  const override = T !== E;
  const plan: CompanyPlan = { wanted: [], hide: [], align: [], covered: 0, reports: [] };
  if (!(MONTHS as readonly string[]).includes(E)) return plan;

  const horizonEnd = lastDayOfYm(addMonthsClamped(input.today, (input.windowMonths ?? PLAN_WINDOW_MONTHS) - 1).slice(0, 7));
  const staleBefore = addMonthsClamped(input.today, -(input.staleAfterMonths ?? PLAN_STALE_AFTER_MONTHS));
  const visible = input.rows.filter(r => r.status !== 'Excluded');
  const relabelled = new Map<string, Wanted['slot']>();   // cycle date -> the slot a Master List edit moved it to

  // Dates (INV-AR-021 (9)). A visible, unfiled row under the FYE month is matched to TeamWork's cycle of the SAME calendar month
  // (never by a year label, never within "a few days" — the month is the match). When the dates differ the row is realigned to the
  // cycle's date, but only when that date is one the company can really have (a month-end, or a day its other cycles use) and
  // TeamWork is sure about the cycle: a lone odd date, a keying slip, a leftover or an unreadable cycle is reported, not copied.
  // Open and finished cycles alike — a finished cycle is exactly where the exact-date row sync must reach the row to mark it filed.
  // Under a Master List override the rows carry the typed month, TeamWork's cycles another one: nothing to compare.
  const dateHandled = new Set<number>();
  if (!override) {
    for (const r of visible) {
      if (r.fye_month !== E || r.filling_date || r.agm_held_date) continue;
      const d = day(r.fye_date);
      if (!d || monthOfIso(d) !== E || r.fye_year !== Number(d.slice(0, 4))) continue;   // a row whose own labels disagree with its date is not guessed at
      const same = input.cycles.filter(c => c.fyeIso.slice(0, 7) === d.slice(0, 7));
      if (same.length === 0 || (same.length === 1 && same[0].fyeIso === d)) continue;
      dateHandled.add(r.id);
      const c = same.length === 1 ? same[0] : null;
      const sure = c && !c.uncertain && !input.suspectDates?.has(c.fyeIso) && !input.leftoverDates?.has(c.fyeIso) && isUsualFyeDay(input.cycles, c);
      if (!c || !sure) { plan.reports.push({ kind: 'date-drift', rowId: r.id, rowDate: d, slotDate: c?.fyeIso ?? same[0].fyeIso }); continue; }
      const rowDue = day(r.due_date);
      const computedDue = addMonthsClamped(d, 7);
      plan.align.push({ row: r, from: d, to: c.fyeIso, cycleFye: c.fyeIso, dueFrom: rowDue === computedDue ? rowDue : null, dueTo: rowDue === computedDue ? addMonthsClamped(c.fyeIso, 7) : null });
    }
  }

  for (const c of input.cycles) {
    if (input.suspectDates?.has(c.fyeIso)) { plan.reports.push({ kind: 'suspect-cycle', fyeIso: c.fyeIso }); continue; }
    if (input.leftoverDates?.has(c.fyeIso)) { plan.reports.push({ kind: 'leftover-cycle', fyeIso: c.fyeIso }); continue; }
    if (c.uncertain) { plan.reports.push({ kind: 'uncertain-cycle', fyeIso: c.fyeIso }); continue; }
    if (!isOpenCycle(c)) continue;
    const m = monthOfIso(c.fyeIso);
    if (c.fyeIso < staleBefore) { plan.reports.push({ kind: 'stale-cycle', fyeIso: c.fyeIso }); continue; }
    if (c.fyeIso > horizonEnd) continue;                  // not due to have a row yet

    let slotYear: number, slotDate: string, moved = false;
    if (m === E) { slotYear = Number(c.fyeIso.slice(0, 4)); slotDate = c.fyeIso; }
    else if (override && m === T) { slotYear = nearestYearOf(E, c.fyeIso); slotDate = monthEndIso(E, slotYear); moved = true; }
    else { plan.reports.push({ kind: 'other-month-cycle', fyeIso: c.fyeIso, month: m }); continue; }

    const slot = { entity_name: input.company.name, fye_month: E, fye_year: slotYear, fye_date: slotDate, company_id: input.company.id };
    if (moved) relabelled.set(c.fyeIso, slot);
    // a visible row under the slot's month that carries the slot's year, TeamWork's own year label, or the same date
    const cover = visible.find(r => holdsSlot(r, slot) || (r.fye_month === E && (r.fye_year === c.yearLabel || day(r.fye_date) === slotDate)));
    if (cover) {
      plan.covered++;
      const rd = day(cover.fye_date);
      if (rd && rd !== slotDate && !dateHandled.has(cover.id)) plan.reports.push({ kind: 'date-drift', rowId: cover.id, rowDate: rd, slotDate });
      continue;
    }
    plan.wanted.push({ slot, cycleFye: c.fyeIso, relabelled: moved });
  }

  // Ghosts and replaced rows: visible, unfiled, under another month than the FYE month. Rows under the FYE month are never hidden here.
  for (const r of visible) {
    if (r.filling_date || r.agm_held_date || r.fye_month === E) continue;
    const d = day(r.fye_date);
    if (!d) { plan.reports.push({ kind: 'row-without-date', rowId: r.id }); continue; }
    const cyc = input.cycles.find(c => c.fyeIso === d);
    if (cyc) {
      // the cycle exists in TeamWork: a real cycle of the old month stays; only a Master List edit that moved it replaces its row
      if (override && r.fye_month === T && relabelled.has(d)) plan.hide.push({ row: r, reason: 'superseded-by-master-list' });
    } else if (input.cycles.length > 0) {
      plan.hide.push({ row: r, reason: 'phantom' });       // TeamWork has no cycle at this exact date
    }
  }
  return plan;
}
