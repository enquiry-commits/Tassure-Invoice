// Run: npx tsx test-ar-coverage.ts — the independent AR coverage check (lib/ar-coverage.ts, INV-AR-020).
import { readFileSync } from 'node:fs';
import { addMonthsClamped, alignFyeYm, reconcileCoverage, rowYm, type CovCompany, type CovMaster, type CovRow } from './lib/ar-coverage';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failed++; };
const TODAY = '2026-10-09';

console.log('--- month arithmetic (the clamp matters) ---');
check('31 Mar - 6 months = 30 Sep, NOT 1 Oct', addMonthsClamped('2027-03-31', -6) === '2026-09-30');
check('30 Apr - 6 months = 30 Oct; 29 Feb 2028 - 6 = 29 Aug 2027', addMonthsClamped('2028-04-30', -6) === '2027-10-30' && addMonthsClamped('2028-02-29', -6) === '2027-08-29');
check('a row stands for its fye_date, else its label', rowYm({ fye_date: '2026-09-30', fye_month: 'October', fye_year: 1999 }) === '2026-09' && rowYm({ fye_date: null, fye_month: 'March', fye_year: 2027 }) === '2027-03');

console.log('\n--- matching a TeamWork AGM due date to the company\'s OWN FYE month (EOT-aware) ---');
check('BEAUTY ASSET: FYE September (day 30), AGM due 30 Mar 2027 -> FYE 2026-09', alignFyeYm('2027-03-30', 'September', 30) === '2026-09');
check('end-of-month rounding (due 31 Mar for a 30 Sep FYE) still fits', alignFyeYm('2027-03-31', 'September', 30) === '2026-09');
check('an EOT of 60 days: FYE Feb, due 27 Oct 2026 -> FYE 2026-02 (DYNESS)', alignFyeYm('2026-10-27', 'February', 28) === '2026-02');
check('an EOT of 60 days: FYE Dec, due 29 Aug 2026 -> FYE 2025-12 (EASYBOOK, FOMO)', alignFyeYm('2026-08-29', 'December') === '2025-12');
check('a date that fits NO year of the company\'s FYE month is null, not a guess (ORBITEZ: FYE Dec, due 30 Dec 2025)', alignFyeYm('2025-12-30', 'December') === null);
check('an extension longer than the allowance does not fit', alignFyeYm('2027-01-30', 'September', 30) === null);
check('an ancient date still aligns (so it can be called STALE, not lost)', alignFyeYm('2018-06-30', 'December') === '2017-12');

const co = (o: Partial<CovCompany> = {}): CovCompany => ({ id: 1705, company_name: 'BEAUTY ASSET PTE LTD', registration_no: '200718949M', fye_month: 'September', fye_day: 30, ...o });
const ms = (o: Partial<CovMaster> = {}): CovMaster => ({ roc_no: '200718949M', company_name: 'BEAUTY ASSET PTE. LTD.', next_agm_due_date: '2027-03-30', ...o });
const row = (o: Partial<CovRow> = {}): CovRow => ({ id: 1, entity_name: 'BEAUTY ASSET PTE LTD', company_id: 1705, uen: '200718949M', fye_month: 'September', fye_year: 2026, fye_date: '2026-09-30', status: 'Pending', filling_date: null, ...o });
const run = (rows: CovRow[], c = co(), m = ms()) => reconcileCoverage({ companies: [c], masters: [m], rows, today: TODAY });

console.log('\n--- the BEAUTY ASSET case, exactly as it stood on 2026-10-09 ---');
const beauty = run([
  row({ id: 714, status: 'Excluded' }),
  row({ id: 867, fye_month: 'October', fye_year: 2025, fye_date: '2025-10-31' }),
  row({ id: 914, fye_month: 'October', fye_year: 2026, fye_date: '2026-10-30', status: 'Excluded' }),
]);
const kinds = beauty.findings.map(f => f.kind).sort().join();
check('MISSING for September 2026, and #714 is named as the hidden row holding the slot', beauty.findings.some(f => f.kind === 'MISSING' && f.expectedYm === '2026-09' && f.hidden.map(h => h.id).join() === '714'));
check('the ghost #867 (visible, unfiled, stored under October while the company is September)', beauty.findings.some(f => f.kind === 'WRONG_MONTH' && f.row.id === 867));
check('#867 is also an overdue-looking older open row', beauty.findings.some(f => f.kind === 'STALE_OPEN' && f.row.id === 867));
check('exact finding set for the case', kinds === 'MISSING,STALE_OPEN,WRONG_MONTH', kinds);
check('after the fix the same company is clean', (() => { const r = run([row({ id: 714 }), row({ id: 914, fye_month: 'October', fye_year: 2026, fye_date: '2026-10-30', status: 'Excluded' })]); return r.stats.covered === 1 && r.stats.missing === 0 && r.findings.length === 0; })());

console.log('\n--- not a miss ---');
check('the open cycle is beyond the 6-month window: no row is due yet (A PLUS MANPOWER: FYE June, due 30 Dec 2027)', (() => { const r = run([], co({ fye_month: 'June', fye_day: 30 }), ms({ next_agm_due_date: '2027-12-30' })); return r.stats.notYetDue === 1 && r.stats.missing === 0 && r.findings.length === 0; })());
check('the window edge: the 5th month ahead is still expected, the 6th is not', run([], co({ fye_month: 'March', fye_day: 31 }), ms({ next_agm_due_date: '2027-09-30' })).stats.missing === 1 && run([], co({ fye_month: 'April', fye_day: 30 }), ms({ next_agm_due_date: '2027-10-30' })).stats.notYetDue === 1);
check('an EOT-extended date is matched to the right cycle and found covered (DYNESS)', (() => { const r = run([row({ id: 752, fye_month: 'February', fye_year: 2026, fye_date: '2026-02-28' })], co({ fye_month: 'February', fye_day: 28 }), ms({ next_agm_due_date: '2026-10-27' })); return r.stats.covered === 1 && r.findings.length === 0; })());
check('an EOT date with the ORIGINAL stored uses the original', run([row()], co(), ms({ next_agm_due_date: '2027-05-29', eot_original_due_date: '2027-03-30' })).stats.covered === 1);
check('a filed older cycle is history, not STALE_OPEN', !run([row({ id: 9, fye_month: 'September', fye_year: 2025, fye_date: '2025-09-30', filling_date: '2026-01-22' }), row({ id: 1 })]).findings.some(f => f.kind === 'STALE_OPEN'));
check('an older unfiled row whose own AGM is not yet due is NOT stale (WHIMIND: row Dec 2026, TeamWork says Dec 2027)', run([row({ id: 731, fye_month: 'December', fye_year: 2026, fye_date: '2026-12-31' })], co({ fye_month: 'December', fye_day: 31 }), ms({ next_agm_due_date: '2028-06-30' })).findings.length === 0);

console.log('\n--- reported for a person to look at ---');
check('no row at all for a cycle inside the window -> MISSING with nothing hidden', (() => { const f = run([]).findings[0]; return f?.kind === 'MISSING' && f.hidden.length === 0; })());
check('a later cycle row does not cover the open one', run([row({ id: 5, fye_month: 'September', fye_year: 2027, fye_date: '2027-09-30' })]).stats.missing === 1);
check('two visible rows for one cycle -> DUPLICATE', run([row({ id: 1 }), row({ id: 2 })]).findings.some(f => f.kind === 'DUPLICATE'));
check('a label that disagrees with its own fye_date -> LABEL_MISMATCH', run([row({ id: 3, fye_month: 'October', fye_date: '2026-09-30' })]).findings.some(f => f.kind === 'LABEL_MISMATCH'));
check('an older unfiled row whose AGM date has passed while TeamWork is already on a later cycle -> STALE_OPEN (SHOU HANG shape)', run([row({ id: 1021, fye_month: 'December', fye_year: 2025, fye_date: '2025-12-31' })], co({ fye_month: 'December', fye_day: 31 }), ms({ next_agm_due_date: '2027-06-30' })).findings.some(f => f.kind === 'STALE_OPEN'));
check('a date that fits none of the company\'s FYE years -> DATE_INCONSISTENT (data question, never MISSING)', (() => { const r = run([], co({ fye_month: 'December', fye_day: 31 }), ms({ next_agm_due_date: '2025-12-30' })); return r.stats.dateInconsistent === 1 && r.stats.missing === 0; })());
check('an open cycle older than 12 months -> STALE_MASTER (an ancient unheld cycle or stale data; LAVARA 2017)', (() => { const r = run([], co({ fye_month: 'December', fye_day: 31 }), ms({ next_agm_due_date: '2018-06-30' })); return r.stats.staleMaster === 1 && r.stats.missing === 0; })());
check('rows are found by UEN even when company_id is missing (legacy rows)', run([row({ company_id: null })]).stats.covered === 1);

console.log('\n--- never guess ---');
check('no FYE month -> not evaluated', run([], co({ fye_month: null })).stats.noFye === 1 && run([], co({ fye_month: null })).stats.checked === 0);
check('Master List row missing or duplicated for the UEN -> not evaluated', run([], co(), ms({ roc_no: 'OTHER' })).stats.noMaster === 1 && reconcileCoverage({ companies: [co()], masters: [ms(), ms()], rows: [], today: TODAY }).stats.noMaster === 1);
check('a legacy date text (11/30/19) or NA -> counted as unparseable, never a finding', run([], co(), ms({ next_agm_due_date: '11/30/19' })).stats.unparseableDue === 1 && run([], co(), ms({ next_agm_due_date: 'NA' })).findings.length === 0);
check('no due date -> not evaluated', run([], co(), ms({ next_agm_due_date: null })).stats.noDue === 1);

console.log('\n--- read-only by construction ---');
const src = readFileSync('lib/ar-coverage.ts', 'utf8').replace(/\/\/.*$/gm, '');
check('the module imports nothing and has no database or network call', !/^import /m.test(src) && !/supabase|fetch\(|\.from\(|\.update\(|\.insert\(|\.upsert\(|\.delete\(/.test(src));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
