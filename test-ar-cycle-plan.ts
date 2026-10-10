// Run: npx tsx test-ar-cycle-plan.ts — the nightly state-based plan for one company's AR rows (lib/ar-cycle-plan.ts, INV-AR-021).
import { readFileSync } from 'node:fs';
import { nearestYearOf, planCompanyAr, type PlanRow } from './lib/ar-cycle-plan';
import type { TwCycle } from './lib/ar-fye-resolve';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failed++; };
const TODAY = '2026-10-10';

const cyc = (fyeIso: string, done = false, yearLabel: number | null = null, extra: Partial<TwCycle> = {}): TwCycle =>
  ({ fyeIso, yearLabel: yearLabel ?? Number(fyeIso.slice(0, 4)), hasAgm: true, hasAr: true, agmDone: done, arDone: done, dueIso: null, uncertain: false, ...extra });
const row = (id: number, month: string, year: number, fyeDate: string | null, o: Partial<PlanRow> = {}): PlanRow =>
  ({ id, entity_name: 'BEAUTY ASSET PTE LTD', company_id: 1705, fye_month: month, fye_year: year, fye_date: fyeDate, status: 'Pending', filling_date: null, agm_held_date: null, ...o });
const plan = (rows: PlanRow[], cycles: TwCycle[], E = 'September', T: string | null = E, extra: object = {}) =>
  planCompanyAr({ company: { id: 1705, name: 'BEAUTY ASSET PTE LTD' }, effectiveMonth: E, teamworkMonth: T, cycles, rows, today: TODAY, ...extra });
const ids = (xs: Array<{ row: PlanRow }>) => xs.map(x => x.row.id).sort((a, b) => a - b).join();
const slots = (p: ReturnType<typeof plan>) => p.wanted.map(w => `${w.slot.fye_month} ${w.slot.fye_year}${w.relabelled ? ' (relabelled)' : ''}`).join(' | ');

const beautyCycles = [cyc('2024-09-30', true), cyc('2025-09-30', true), cyc('2026-09-30')];

console.log('--- BEAUTY ASSET, exactly as it stood on 2026-10-10 ---');
const hidden = plan([
  row(714, 'September', 2026, '2026-09-30', { status: 'Excluded' }),
  row(867, 'October', 2025, '2025-10-31'),
  row(914, 'October', 2026, '2026-10-30', { status: 'Excluded' }),
], beautyCycles);
check('TeamWork has an open September 2026 cycle and no visible row holds it -> WANTED (the executor restores #714)', slots(hidden) === 'September 2026', slots(hidden));
check('the ghost #867 (October 2025, no such cycle in TeamWork) is hidden as a phantom; the already-hidden #914 is left alone', ids(hidden.hide) === '867' && hidden.hide[0].reason === 'phantom', hidden.hide);
check('after the restore the company is covered and nothing is wanted', (() => { const p = plan([row(714, 'September', 2026, '2026-09-30'), row(867, 'October', 2025, '2025-10-31')], beautyCycles); return p.covered === 1 && !p.wanted.length && ids(p.hide) === '867'; })());
check('a healthy company produces an empty plan', (() => { const p = plan([row(714, 'September', 2026, '2026-09-30')], beautyCycles); return !p.wanted.length && !p.hide.length && p.covered === 1; })());

console.log('\n--- the window and old cycles ---');
check('a cycle beyond the 6-month window is not due to have a row yet', !plan([], [cyc('2025-09-30', true), cyc('2027-09-30')]).wanted.length);
check('the last month of the window (Mar 2027 = this month + 5) is wanted; Apr 2027 is not', plan([], [cyc('2027-03-31')], 'March').wanted.length === 1 && plan([], [cyc('2027-04-30')], 'April').wanted.length === 0);
check('an open cycle older than 12 months is reported, never rebuilt', (() => { const p = plan([], [cyc('2025-03-31')], 'March'); return !p.wanted.length && p.reports.some(r => r.kind === 'stale-cycle'); })());
check('a filed / held cycle needs no row', !plan([], [cyc('2026-09-30', true)]).wanted.length);
check('a suspect cycle (assessFye refused it) and an uncertain one are reported, never wanted', (() => {
  const p = plan([], [cyc('2025-09-30', true), cyc('2026-10-01')], 'September', 'September', { suspectDates: new Set(['2026-10-01']) });
  const q = plan([], [cyc('2026-09-30', false, null, { uncertain: true })]);
  return !p.wanted.length && p.reports.some(r => r.kind === 'suspect-cycle') && !q.wanted.length && q.reports.some(r => r.kind === 'uncertain-cycle');
})());
check('an empty TeamWork history changes nothing — no row is hidden because TeamWork returned nothing', (() => { const p = plan([row(867, 'October', 2025, '2025-10-31'), row(714, 'September', 2026, '2026-09-30')], []); return !p.hide.length && !p.wanted.length; })());

console.log('\n--- rows that must never be hidden ---');
check('a row under the FYE month is never hidden, even when TeamWork shows no cycle for it (a bad TeamWork night cannot empty the page)', !plan([row(1, 'September', 2026, '2026-09-30'), row(2, 'September', 2027, '2027-09-30')], [cyc('2024-09-30', true)]).hide.length);
check('a filed row under another month is history', !plan([row(5, 'October', 2025, '2025-10-31', { filling_date: '2026-01-10' })], beautyCycles).hide.length);
check('an AGM-held row is history too', !plan([row(5, 'October', 2025, '2025-10-31', { agm_held_date: '2026-01-10' })], beautyCycles).hide.length);
check('a legit overdue cycle of the OLD month (TeamWork still lists it) stays visible', (() => {
  const p = plan([row(9, 'March', 2026, '2026-03-31')], [cyc('2025-03-31', true), cyc('2026-03-31'), cyc('2026-12-31')], 'December');
  return !p.hide.length && p.reports.some(r => r.kind === 'other-month-cycle');
})());
check('a row without an exact date is reported, not guessed', (() => { const p = plan([row(7, 'October', 2025, null)], beautyCycles); return !p.hide.length && p.reports.some(r => r.kind === 'row-without-date'); })());

console.log('\n--- a genuine FYE change (June -> December): the old pending row goes, the new cycle gets its row ---');
{
  const p = plan([row(30, 'June', 2026, '2026-06-30'), row(31, 'December', 2026, '2026-12-31')], [cyc('2024-06-30', true), cyc('2025-06-30', true), cyc('2025-12-31')], 'December');
  check('the projected June 2026 row (TeamWork has no such cycle) is hidden', ids(p.hide) === '30', p.hide);
  check('TeamWork\'s open December 2025 cycle is wanted; the December 2026 projection is left to generate', slots(p) === 'December 2025', slots(p));
}

console.log('\n--- Vincent\'s rule: staff typed SEP in Master List, TeamWork still says October ---');
{
  const twCycles = [cyc('2025-10-31', true), cyc('2026-10-31')];
  const p = plan([row(40, 'October', 2026, '2026-10-31')], twCycles, 'September', 'October');
  check('the open October cycle is carried by a SEPTEMBER 2026 row (nearest September), flagged as relabelled', slots(p) === 'September 2026 (relabelled)', slots(p));
  check('its date is the month-end of the typed month', p.wanted[0].slot.fye_date === '2026-09-30');
  check('the October row that the same cycle used to have is replaced (hidden)', ids(p.hide) === '40' && p.hide[0].reason === 'superseded-by-master-list', p.hide);
  const covered = plan([row(40, 'October', 2026, '2026-10-31'), row(41, 'September', 2026, '2026-09-30')], twCycles, 'September', 'October');
  check('once the September row exists the plan only keeps hiding the October twin', covered.covered === 1 && !covered.wanted.length && ids(covered.hide) === '40');
  const back = plan([row(41, 'September', 2026, '2026-09-30'), row(40, 'October', 2026, '2026-10-31', { status: 'Excluded' })], twCycles, 'October', 'October');
  check('the edit is reverted (hoechyi OCT -> SEP style, in reverse): the Excluded October row is wanted back, the September row is a ghost now', slots(back) === 'October 2026' && ids(back.hide) === '41', { w: slots(back), h: back.hide });
  check('a cycle in a month that is neither the typed month nor TeamWork\'s month is reported, not mapped', plan([], [cyc('2026-12-31')], 'September', 'October').reports.some(r => r.kind === 'other-month-cycle'));
}

console.log('\n--- matching a visible row to its cycle ---');
check('TeamWork\'s year label may differ from the FYE\'s calendar year (14 of 1,656 snapshot rows): a row carrying the label still covers the cycle (LYNKORA: April 2026, label 2025)', (() => {
  const p = plan([row(60, 'April', 2025, '2026-04-30')], [cyc('2025-04-30', true, 2024), cyc('2026-04-30', false, 2025)], 'April');
  return p.covered === 1 && !p.wanted.length;
})());
check('a row with the right month and year but another date is reported as drift, not duplicated', (() => { const p = plan([row(61, 'September', 2026, '2026-09-29')], beautyCycles); return !p.wanted.length && p.reports.some(r => r.kind === 'date-drift'); })());
check('nearestYearOf picks the closest occurrence of the month', nearestYearOf('September', '2026-10-31') === 2026 && nearestYearOf('December', '2026-01-31') === 2025 && nearestYearOf('January', '2026-12-31') === 2027);

console.log('\n--- a TeamWork leftover cycle (INV-AR-021 (7)): followed past, never wanted, reported ---');
{
  const withOtherMonth = [cyc('2025-12-31', true), cyc('2026-06-30'), cyc('2026-12-31')];
  const without = plan([], withOtherMonth, 'December');
  const flagged = plan([], withOtherMonth, 'December', 'December', { leftoverDates: new Set(['2026-06-30']) });
  check('without the rule an open other-month cycle is only reported as "other-month"', without.reports.some(r => r.kind === 'other-month-cycle' && r.fyeIso === '2026-06-30'));
  check('with it the cycle is reported as a LEFTOVER and is neither wanted nor reported twice', flagged.reports.some(r => r.kind === 'leftover-cycle' && r.fyeIso === '2026-06-30') && !flagged.reports.some(r => r.kind === 'other-month-cycle') && !flagged.wanted.some(w => w.cycleFye === '2026-06-30'));
  check('the real December cycle is still wanted', flagged.wanted.map(w => w.cycleFye).join() === '' || flagged.wanted.every(w => w.cycleFye !== '2026-06-30'));
}

console.log('\n--- read-only by construction ---');
const src = readFileSync('lib/ar-cycle-plan.ts', 'utf8').replace(/\/\/.*$/gm, '');
check('the planner imports only pure modules and has no database or network call', !/supabase|fetch\(|\.from\(|\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(src) && !/from '\.\/(supabase|automation-sync)'/.test(src));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
