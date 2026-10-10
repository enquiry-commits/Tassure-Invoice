// Run: npx tsx test-ar-fye-restore.ts — restoring a row the system itself hid for an FYE correction (INV-AR-019).
import { readFileSync } from 'node:fs';
import {
  holdsSlot, isSystemFyeExclusion, newRestoreBudget, planFyeRestores, slotKey, MAX_FYE_RESTORES_PER_RUN,
  type HeldRow, type LastExclusion, type Slot,
} from './lib/ar-fye-restore';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failed++; };

const held = (o: Partial<HeldRow> = {}): HeldRow => ({
  id: 714, entity_name: 'BEAUTY ASSET PTE LTD', fye_month: 'September', fye_year: 2026, fye_date: '2026-09-30', company_id: 1705,
  status: 'Excluded', filling_date: null, agm_held_date: null, ...o,
});
const slot = (o: Partial<Slot> = {}): Slot => ({ entity_name: 'BEAUTY ASSET PTE LTD', fye_month: 'September', fye_year: 2026, fye_date: '2026-09-30', company_id: 1705, ...o });
const sys: LastExclusion = { by: 'system:teamwork', byName: 'TeamWork Sync (FYE corrected, one-time backfill)', statusBefore: 'Pending', at: '2026-08-11T13:34:00Z' };
const plan = (rows: HeldRow[], last: Record<number, LastExclusion>, wanted: Slot[] = [slot()], budget = newRestoreBudget()) =>
  planFyeRestores(wanted, rows, new Map(Object.entries(last).map(([k, v]) => [Number(k), v])), budget);

console.log('--- the real case: BEAUTY ASSET #714 ---');
const real = plan([held()], { 714: sys });
check('hidden by the FYE correction, never filed, same date -> restored to its earlier status', real.verdicts.length === 1 && real.verdicts[0].restore === true && (real.verdicts[0] as { restoreTo: string }).restoreTo === 'Pending');
check('the slot is marked handled (the caller must not insert into it)', real.handled.has(slotKey(slot())));

console.log('\n--- who hid it is read from the AUDIT, never from the row (F1) ---');
check('the planner takes no updated_by_email at all: HeldRow has no such field', !('updated_by_email' in held()));
check('a person\'s exclusion is blocked', plan([held()], { 714: { ...sys, by: 'chelsea@tassure.com', byName: 'Chelsea Ang' } }).verdicts[0].restore === false);
check('the late-filing system exclusion is not this one', (plan([held()], { 714: { ...sys, by: 'system:late-filing', byName: 'Late Filing Sync' } }).verdicts[0] as { reason: string }).reason === 'hidden-by-someone-else');
check('system:teamwork WITHOUT the FYE-correction name does not qualify (an ordinary date-sync stamp)', !isSystemFyeExclusion({ ...sys, byName: 'TeamWork Sync' }));
check('no audit trail at all -> blocked, never guessed', (plan([held()], {}).verdicts[0] as { reason: string }).reason === 'no-audit-trail');
check('the statusBefore of the transition is what comes back; Excluded/blank fall back to Pending', (plan([held()], { 714: { ...sys, statusBefore: 'Overdue' } }).verdicts[0] as { restoreTo: string }).restoreTo === 'Overdue' && (plan([held()], { 714: { ...sys, statusBefore: null } }).verdicts[0] as { restoreTo: string }).restoreTo === 'Pending');

console.log('\n--- never resurrect history or a shifted row ---');
check('a filed row is never restored', (plan([held({ filling_date: '2026-01-22' })], { 714: sys }).verdicts[0] as { reason: string }).reason === 'filed');
check('a row with an AGM held date is never restored', (plan([held({ agm_held_date: '2026-01-12' })], { 714: sys }).verdicts[0] as { reason: string }).reason === 'filed');
check('a hidden row whose fye_date is NOT the wanted date is reported, not resurrected (#914 shape)', (plan([held({ fye_date: '2026-10-30' })], { 714: sys }).verdicts[0] as { reason: string }).reason === 'date-mismatch');
check('a missing date on either side does not block (nothing to compare)', plan([held({ fye_date: null })], { 714: sys }).verdicts[0].restore === true && plan([held()], { 714: sys }, [slot({ fye_date: null })]).verdicts[0].restore === true);

console.log('\n--- both unique keys (F2) ---');
check('held under the NAME key', holdsSlot(held(), slot()));
check('held under the company key although the stored name differs (renamed company)', holdsSlot(held({ entity_name: 'BEAUTY ASSET (OLD NAME) PTE LTD' }), slot()));
check('the name key ignores case and spacing', holdsSlot(held({ entity_name: ' beauty asset pte ltd ' }), slot({ company_id: null })));
check('a different month or year never holds the slot', !holdsSlot(held({ fye_month: 'October' }), slot()) && !holdsSlot(held({ fye_year: 2025 }), slot()));
check('a visible (non-Excluded) row is never touched by the planner', plan([held({ status: 'Pending' })], { 714: sys }).verdicts.length === 0);

console.log('\n--- circuit breaker is one budget for the WHOLE run (F3) ---');
const budget = newRestoreBudget();
const rows = Array.from({ length: MAX_FYE_RESTORES_PER_RUN + 3 }, (_, i) => held({ id: 100 + i, entity_name: `CO ${i} PTE LTD`, company_id: 2000 + i }));
const wanted = rows.map(r => slot({ entity_name: r.entity_name, company_id: r.company_id }));
const lastAll = Object.fromEntries(rows.map(r => [r.id, sys]));
// sync-workflow calls once PER COMPANY: the budget must carry across calls
const results = wanted.map((w, i) => plan([rows[i]], { [rows[i].id]: sys }, [w], budget).verdicts[0]);
check(`the first ${MAX_FYE_RESTORES_PER_RUN} calls restore, the rest are blocked by the breaker`, results.slice(0, MAX_FYE_RESTORES_PER_RUN).every(v => v.restore) && results.slice(MAX_FYE_RESTORES_PER_RUN).every(v => !v.restore && (v as { reason: string }).reason === 'breaker'), results.map(v => (v.restore ? 'R' : 'B')).join(''));
check('a breaker-blocked slot is still handled (never silently inserted into)', plan([rows[0]], { [rows[0].id]: sys }, [wanted[0]], newRestoreBudget(0)).handled.size === 1);
void lastAll;

console.log('\n--- the slot key ---');
check('ignores name case and spacing', slotKey({ entity_name: ' beauty asset pte ltd ', fye_month: 'September', fye_year: 2026 }) === slotKey(slot()));

console.log('\n--- source guards (the closed-loop rules must stay in the code) ---');
const src = readFileSync('lib/ar-fye-restore.ts', 'utf8').replace(/\/\/.*$/gm, '');
check('the actor is read from ar_reminder_audit, not from the row', /ar_reminder_audit/.test(src) && !/\.updated_by_email\s*===|row\.updated_by_email/.test(src));
check('a restore counts only when the UPDATE changed exactly one row', /\.select\('id'\)/.test(src) && /data\?\.length \?\? 0\) !== 1/.test(src));
check('the update is guarded by status = Excluded (a concurrent change is not overwritten)', /\.eq\('status', 'Excluded'\)\.select/.test(src));
const gen = readFileSync('app/api/ar-reminder/generate/route.ts', 'utf8');
check('the catch-up fails open (a problem in the restore check never costs the night\'s other inserts)', /FYE restore check failed/.test(gen));
check('the catch-up counts the rows really inserted (.select), not the rows it tried to insert', /upsert\(toInsert, \{ onConflict: 'entity_name,fye_month,fye_year', ignoreDuplicates: true \}\)\.select\('id'\)/.test(gen));
check('the forward loop counts the rows really inserted too', /insertedNow/.test(gen));
check('blocked slots are raised as an Automation Health exception, resolved only when the catch-up was not cut short', /catch_up_blocked_by_excluded/.test(gen) && /!catchUpDeadlineHit/.test(gen));

if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
console.log('\nALL OK');
