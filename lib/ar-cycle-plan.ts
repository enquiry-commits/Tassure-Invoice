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
//   reports — things only TeamWork can fix, or that were left alone on purpose.
// A cycle is matched by its EXACT FYE date, never by "the company's latest month" (the mistake that made the Late Filing
// ghost rows #866/#867). Rows under the FYE month are never hidden here, so a bad TeamWork night cannot empty the page.

import { addMonthsClamped } from './ar-coverage';
import { holdsSlot, type Slot } from './ar-fye-restore';
import { MONTHS, isOpenCycle, monthEndIso, monthOfIso, daysBetweenIso, type TwCycle } from './ar-fye-resolve';

export const PLAN_WINDOW_MONTHS = 6;        // generate creates rows for the current month and the next 5
export const PLAN_STALE_AFTER_MONTHS = 12;  // an open cycle older than this is reported, not rebuilt

export type PlanRow = {
  id: number; entity_name: string; company_id: number | null; fye_month: string; fye_year: number;
  fye_date: string | null; status: string | null; filling_date: string | null; agm_held_date: string | null;
};
export type PlanInput = {
  company: { id: number; name: string };
  effectiveMonth: string;                  // the month AR runs on
  teamworkMonth: string | null;            // the month of TeamWork's cycles; differs from effectiveMonth only under a Master List edit
  cycles: readonly TwCycle[];
  suspectDates?: ReadonlySet<string>;      // cycles lib/ar-fye-resolve.ts assessFye refused to believe
  rows: readonly PlanRow[];                // EVERY ar_reminder row of the company, hidden ones too
  today: string;                           // YYYY-MM-DD
  windowMonths?: number;
  staleAfterMonths?: number;
};
export type Wanted = { slot: Slot & { fye_date: string }; cycleFye: string; relabelled: boolean };
export type HideReason = 'phantom' | 'superseded-by-master-list';
export type PlanReport =
  | { kind: 'suspect-cycle'; fyeIso: string }
  | { kind: 'uncertain-cycle'; fyeIso: string }
  | { kind: 'stale-cycle'; fyeIso: string }
  | { kind: 'other-month-cycle'; fyeIso: string; month: string }
  | { kind: 'date-drift'; rowId: number; rowDate: string; slotDate: string }
  | { kind: 'row-without-date'; rowId: number };
export type CompanyPlan = {
  wanted: Wanted[];
  hide: Array<{ row: PlanRow; reason: HideReason }>;
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
  const plan: CompanyPlan = { wanted: [], hide: [], covered: 0, reports: [] };
  if (!(MONTHS as readonly string[]).includes(E)) return plan;

  const horizonEnd = lastDayOfYm(addMonthsClamped(input.today, (input.windowMonths ?? PLAN_WINDOW_MONTHS) - 1).slice(0, 7));
  const staleBefore = addMonthsClamped(input.today, -(input.staleAfterMonths ?? PLAN_STALE_AFTER_MONTHS));
  const visible = input.rows.filter(r => r.status !== 'Excluded');
  const relabelled = new Map<string, Wanted['slot']>();   // cycle date -> the slot a Master List edit moved it to

  for (const c of input.cycles) {
    if (input.suspectDates?.has(c.fyeIso)) { plan.reports.push({ kind: 'suspect-cycle', fyeIso: c.fyeIso }); continue; }
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
      if (rd && rd !== slotDate) plan.reports.push({ kind: 'date-drift', rowId: cover.id, rowDate: rd, slotDate });
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
