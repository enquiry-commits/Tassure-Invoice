// Run: npx tsx test-ar-plan-apply.ts — what carries the nightly AR plan out, and the "Master List FYE edit moves AR at once" path
// (lib/ar-plan-apply.ts, lib/ar-fye-reanchor.ts, INV-AR-021). A small in-memory fake of the Supabase query builder records every
// write, so we can assert on exactly what would reach the database — including that shadow mode writes NOTHING.
import { readFileSync } from 'node:fs';
import { MAX_PLAN_CHANGES_PER_RUN, MAX_PLAN_HIDES_PER_RUN, MAX_PLAN_INSERTS_PER_RUN, executeArPlans, type PlanItem } from './lib/ar-plan-apply';
import { planCompanyAr, type PlanRow } from './lib/ar-cycle-plan';
import { applyReanchor, planReanchor, reanchorAfterMasterListFyeEdit } from './lib/ar-fye-reanchor';
import { FYE_EXCLUDER, FYE_EXCLUDER_NAME_PREFIX, isSystemFyeExclusion } from './lib/ar-fye-restore';
import type { TwCycle } from './lib/ar-fye-resolve';

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : ` — ${JSON.stringify(detail)}`}`); if (!ok) failed++; };

// ── a fake Supabase client ───────────────────────────────────────────────────────────────────────────────────────────
type Op = { table: string; kind: 'select' | 'insert' | 'update'; payload?: Record<string, unknown>; filters: Array<[string, string, unknown]> };
class Fake {
  ops: Op[] = [];
  rows: Array<Record<string, unknown>>;
  audit: Array<Record<string, unknown>>;
  insertError: { code?: string; message: string } | null = null;
  updateMatches = 1;   // how many rows an UPDATE reports as changed
  companies: Array<Record<string, unknown>> = [];
  constructor(rows: Array<Record<string, unknown>>, audit: Array<Record<string, unknown>> = []) { this.rows = rows; this.audit = audit; }
  from(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const op: Op = { table, kind: 'select', filters: [] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    let cached: Promise<{ data: unknown[] | null; error: { code?: string; message: string } | null }> | null = null;
    const run = () => { if (!cached) { self.ops.push(op); cached = Promise.resolve(self.resolve(op)); } return cached; };
    const chain = (name: string) => (...args: unknown[]) => { op.filters.push([name, String(args[0]), args[1]]); return b; };
    for (const f of ['eq', 'is', 'or', 'in', 'neq', 'ilike', 'order', 'range', 'limit']) b[f] = chain(f);
    b.select = () => b;
    b.insert = (payload: Record<string, unknown>) => { op.kind = 'insert'; op.payload = payload; return b; };
    b.update = (payload: Record<string, unknown>) => { op.kind = 'update'; op.payload = payload; return b; };
    b.maybeSingle = () => run().then(r => ({ data: (r.data as unknown[] | null)?.[0] ?? null, error: r.error }));
    b.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => run().then(res, rej);
    return b;
  }
  resolve(op: Op): { data: unknown[] | null; error: { code?: string; message: string } | null } {
    if (op.table === 'audit_log') return { data: null, error: null };
    if (op.table === 'ar_reminder_audit') {
      const ids = op.filters.find(f => f[0] === 'in')?.[2] as number[] | undefined;
      return { data: this.audit.filter(a => ids?.includes(a.ar_reminder_id as number)), error: null };
    }
    if (op.kind === 'insert') {
      if (this.insertError) return { data: null, error: this.insertError };
      const row = { id: 9000 + this.rows.length, ...op.payload };
      this.rows.push(row);
      return { data: [row], error: null };
    }
    if (op.kind === 'update') {
      const id = op.filters.find(f => f[0] === 'eq' && f[1] === 'id')?.[2];
      const hit = this.rows.find(r => r.id === id);
      if (!hit || !this.updateMatches) return { data: [], error: null };
      Object.assign(hit, op.payload);
      return { data: [{ id }], error: null };
    }
    // plain selects: every eq / in filter is applied to the rows that have that column; ilike (no wildcard) = case-insensitive equality
    const table = op.table === 'companies' ? this.companies : this.rows;
    let out = table.filter(r => op.filters.every(([name, col, val]) => {
      if (name === 'eq' && col in r) return r[col] === val;
      if (name === 'in' && col in r) return (val as unknown[]).includes(r[col]);
      if (name === 'ilike' && col in r) return String(r[col] ?? '').toLowerCase() === String(val).replace(/%/g, '').toLowerCase();
      return true;
    }));
    if (op.table === 'master_list') out = [];
    return { data: out, error: null };
  }
}
const asClient = (f: Fake) => f as unknown as Parameters<typeof executeArPlans>[0];
const writes = (f: Fake) => f.ops.filter(o => o.table === 'ar_reminder' && o.kind !== 'select');

const cyc = (fyeIso: string, done = false): TwCycle => ({ fyeIso, yearLabel: Number(fyeIso.slice(0, 4)), hasAgm: true, hasAr: true, agmDone: done, arDone: done, dueIso: null, uncertain: false });
const rowOf = (id: number, month: string, year: number, fyeDate: string, o: Record<string, unknown> = {}) =>
  ({ id, entity_name: 'BEAUTY ASSET PTE LTD', company_id: 1705, fye_month: month, fye_year: year, fye_date: fyeDate, status: 'Pending', filling_date: null, agm_held_date: null, ...o });
const beautyCycles = [cyc('2024-09-30', true), cyc('2025-09-30', true), cyc('2026-09-30')];
const itemFor = (rows: PlanRow[], cycles = beautyCycles): PlanItem => ({
  company: { id: 1705, name: 'BEAUTY ASSET PTE LTD' },
  plan: planCompanyAr({ company: { id: 1705, name: 'BEAUTY ASSET PTE LTD' }, effectiveMonth: 'September', teamworkMonth: 'September', cycles, rows, today: '2026-10-10' }),
});
const SYSTEM_HID = (id: number) => ({ id: 1, ar_reminder_id: id, old_value: 'Pending', changed_by_email: FYE_EXCLUDER, changed_by_name: `${FYE_EXCLUDER_NAME_PREFIX}, one-time backfill)`, changed_at: '2026-08-11T13:34:00Z' });
const PERSON_HID = (id: number) => ({ id: 2, ar_reminder_id: id, old_value: 'Pending', changed_by_email: 'hoechyi@tassure.com', changed_by_name: 'Hoe Chyi', changed_at: '2026-09-01T00:00:00Z' });
const beautyRows = () => [rowOf(714, 'September', 2026, '2026-09-30', { status: 'Excluded' }), rowOf(867, 'October', 2025, '2025-10-31')];
const buildInsert = (_c: number, w: { slot: { fye_month: string; fye_year: number; fye_date: string } }) => ({ fye_month: w.slot.fye_month, fye_year: w.slot.fye_year, fye_date: w.slot.fye_date, status: 'Pending' });

(async () => {
  console.log('--- shadow mode: describes, writes NOTHING ---');
  {
    const db = new Fake(beautyRows(), [SYSTEM_HID(714)]);
    const out = await executeArPlans(asClient(db), [itemFor(beautyRows() as PlanRow[])], { apply: false, buildInsert });
    check('it says what WOULD be restored and hidden', out.mode === 'shadow' && out.restored.map(r => r.id).join() === '714' && out.hidden.map(h => h.id).join() === '867', out);
    check('and not one UPDATE / INSERT reached the database', writes(db).length === 0, writes(db));
  }

  console.log('\n--- apply mode: BEAUTY ASSET as it stood on 2026-10-10 ---');
  {
    const db = new Fake(beautyRows(), [SYSTEM_HID(714)]);
    const out = await executeArPlans(asClient(db), [itemFor(beautyRows() as PlanRow[])], { apply: true, buildInsert });
    check('the September row hidden by the system\'s own FYE correction is restored to Pending', db.rows.find(r => r.id === 714)?.status === 'Pending' && out.restored.length === 1, db.rows);
    check('the ghost #867 is hidden by an actor the restore logic recognises as the system\'s own (so it stays restorable)', (() => {
      const g = db.rows.find(r => r.id === 867)!;
      return g.status === 'Excluded' && isSystemFyeExclusion({ by: g.updated_by_email as string, byName: g.updated_by_name as string, statusBefore: 'Pending', at: '' });
    })(), db.rows.find(r => r.id === 867));
    check('nothing was inserted (the slot was held by the hidden row — inserting would have been silently swallowed)', !db.ops.some(o => o.table === 'ar_reminder' && o.kind === 'insert'));
  }

  console.log('\n--- a person\'s exclusion is never touched ---');
  {
    const db = new Fake([rowOf(714, 'September', 2026, '2026-09-30', { status: 'Excluded' })], [PERSON_HID(714)]);
    const out = await executeArPlans(asClient(db), [itemFor([rowOf(714, 'September', 2026, '2026-09-30', { status: 'Excluded' }) as PlanRow])], { apply: true, buildInsert });
    check('left Excluded and reported as hidden by someone else', db.rows[0].status === 'Excluded' && out.blocked.length === 1 && out.blocked[0].why === 'hidden-by-someone-else', out.blocked);
    check('no insert was attempted into the slot it holds', !db.ops.some(o => o.table === 'ar_reminder' && o.kind === 'insert'));
  }
  {
    const db = new Fake([rowOf(714, 'September', 2026, '2026-09-30', { status: 'Excluded' })], []);
    const out = await executeArPlans(asClient(db), [itemFor([rowOf(714, 'September', 2026, '2026-09-30', { status: 'Excluded' }) as PlanRow])], { apply: true, buildInsert });
    check('a hidden row with NO audit trail is also left alone', db.rows[0].status === 'Excluded' && out.blocked[0]?.why === 'no-audit-trail', out.blocked);
  }

  console.log('\n--- nothing holds the slot: insert ---');
  {
    const db = new Fake([], []);
    const out = await executeArPlans(asClient(db), [itemFor([])], { apply: true, buildInsert });
    check('a missing row for an open in-window cycle is inserted', out.inserted.length === 1 && db.rows.length === 1 && db.rows[0].fye_month === 'September' && db.rows[0].fye_year === 2026, db.rows);
    const dup = new Fake([], []); dup.insertError = { code: '23505', message: 'duplicate key' };
    const o2 = await executeArPlans(asClient(dup), [itemFor([])], { apply: true, buildInsert });
    check('a unique-key collision (the row appeared meanwhile) is not an error and not counted as inserted', !o2.failed.length && !o2.inserted.length, o2);
    const bad = new Fake([], []); bad.insertError = { message: 'connection reset' };
    const o3 = await executeArPlans(asClient(bad), [itemFor([])], { apply: true, buildInsert });
    check('any other insert error is reported as failed, not counted', o3.failed.length === 1 && !o3.inserted.length, o3);
  }

  console.log('\n--- guards and breakers ---');
  {
    const db = new Fake(beautyRows(), [SYSTEM_HID(714)]); db.updateMatches = 0;
    const out = await executeArPlans(asClient(db), [itemFor(beautyRows() as PlanRow[])], { apply: true, buildInsert });
    check('an UPDATE that changed no row (the row moved under us) is reported failed, never counted as done', out.failed.length >= 1 && !out.hidden.length && !out.restored.length, out);
  }
  {
    const rows = Array.from({ length: MAX_PLAN_HIDES_PER_RUN + 3 }, (_, i) => rowOf(100 + i, 'October', 2025, '2025-10-31', { entity_name: `GHOST ${i}`, company_id: 2000 + i }));
    const items = rows.map((r, i) => ({ company: { id: 2000 + i, name: `GHOST ${i}` }, plan: planCompanyAr({ company: { id: 2000 + i, name: `GHOST ${i}` }, effectiveMonth: 'September', teamworkMonth: 'September', cycles: [cyc('2025-09-30', true)], rows: [r as PlanRow], today: '2026-10-10' }) }));
    const db = new Fake(rows);
    const out = await executeArPlans(asClient(db), items, { apply: true, buildInsert });
    check(`at most ${MAX_PLAN_HIDES_PER_RUN} hides per run; the rest are reported`, out.hidden.length === MAX_PLAN_HIDES_PER_RUN && out.failed.length === 3, { hidden: out.hidden.length, failed: out.failed.length });
  }
  {
    const n = MAX_PLAN_CHANGES_PER_RUN + 5;
    const rows = Array.from({ length: n }, (_, i) => rowOf(300 + i, 'October', 2025, '2025-10-31', { entity_name: `MASS ${i}`, company_id: 3000 + i }));
    const items = rows.map((r, i) => ({ company: { id: 3000 + i, name: `MASS ${i}` }, plan: planCompanyAr({ company: { id: 3000 + i, name: `MASS ${i}` }, effectiveMonth: 'September', teamworkMonth: 'September', cycles: [cyc('2025-09-30', true)], rows: [r as PlanRow], today: '2026-10-10' }) }));
    const db = new Fake(rows);
    const out = await executeArPlans(asClient(db), items, { apply: true, buildInsert });
    check(`more than ${MAX_PLAN_CHANGES_PER_RUN} planned changes in one night means the PLAN is suspect: nothing is applied, it is reported`, out.tripped && out.exceedsLimit && writes(db).length === 0 && out.hidden.length === n, { tripped: out.tripped, writes: writes(db).length });
  }
  check('the per-run insert limit exists and is small', MAX_PLAN_INSERTS_PER_RUN <= 10);

  console.log('\n--- Master List FYE edit: AR moves at once ---');
  const company = { id: 1705, name: 'BEAUTY ASSET PTE LTD' };
  const mkOct = () => rowOf(40, 'October', 2026, '2026-10-31') as PlanRow;   // a FRESH object per test: the fake client mutates what it is given
const octRow = mkOct();
  check('nothing moves when the month AR runs on did not change', planReanchor({ company, oldMonth: 'September', newMonth: 'September', rows: [octRow] }).moves.length === 0);
  check('nothing moves with no new month', planReanchor({ company, oldMonth: 'October', newMonth: null, rows: [octRow] }).moves.length === 0);
  {
    const p = planReanchor({ company, oldMonth: 'October', newMonth: 'September', rows: [octRow, rowOf(41, 'October', 2025, '2025-10-31', { filling_date: '2026-01-10' }) as PlanRow, rowOf(42, 'October', 2027, '2027-10-31', { status: 'Excluded' }) as PlanRow, rowOf(43, 'March', 2027, '2027-03-31') as PlanRow] });
    check('only the visible, unfiled rows under the OLD month move (a filed row is history, a hidden one stays, another month is untouched)', p.moves.map(m => m.row.id).join() === '40', p.moves.map(m => m.row.id));
    check('the October 2026 cycle lands on September 2026 (the nearest September), dated month-end', p.moves[0].target.fye_year === 2026 && p.moves[0].target.fye_date === '2026-09-30', p.moves[0].target);
  }
  check('more rows than the limit are left to the nightly plan, not half-moved', (() => {
    const rows = Array.from({ length: 8 }, (_, i) => rowOf(50 + i, 'October', 2010 + i, `${2010 + i}-10-31`) as PlanRow);
    const p = planReanchor({ company, oldMonth: 'October', newMonth: 'September', rows });
    return p.moves.length === 0 && p.skipped.some(s => s.includes('left for the nightly plan'));
  })());
  {
    const mine = mkOct();
    const db = new Fake([mine as unknown as Record<string, unknown>], []);
    const p = planReanchor({ company, oldMonth: 'October', newMonth: 'September', rows: [mine] });
    const out = await applyReanchor(asClient(db), p, slot => ({ fye_month: slot.fye_month, fye_year: slot.fye_year, fye_date: slot.fye_date, status: 'Pending' }));
    check('the September row is created FIRST and the October one hidden after it', out.moved.length === 1 && out.moved[0].how === 'inserted' && db.rows.some(r => r.fye_month === 'September' && r.status === 'Pending') && db.rows.find(r => r.id === 40)?.status === 'Excluded', { out, rows: db.rows });
    const order = writes(db).map(o => o.kind).join();
    check('...in that order (insert, then update)', order === 'insert,update', order);
  }
  {
    const mine = mkOct();
    const db = new Fake([mine as unknown as Record<string, unknown>], []); db.insertError = { message: 'boom' };
    const p = planReanchor({ company, oldMonth: 'October', newMonth: 'September', rows: [mine] });
    const out = await applyReanchor(asClient(db), p, slot => ({ fye_month: slot.fye_month, status: 'Pending' }));
    check('if the new row cannot be created the old one stays visible — the company never disappears', db.rows.find(r => r.id === 40)?.status === 'Pending' && out.failed.length === 1 && !out.moved.length, { rows: db.rows, out });
  }
  {
    // staff change the cell back: the October row the system hid earlier is restored, the September one hidden
    const rows = [rowOf(41, 'September', 2026, '2026-09-30'), rowOf(40, 'October', 2026, '2026-10-31', { status: 'Excluded' })];
    const db = new Fake(rows, [{ id: 3, ar_reminder_id: 40, old_value: 'Pending', changed_by_email: FYE_EXCLUDER, changed_by_name: `${FYE_EXCLUDER_NAME_PREFIX}, replaced by the Master List FYE)`, changed_at: '2026-10-10T00:00:00Z' }]);
    const p = planReanchor({ company, oldMonth: 'September', newMonth: 'October', rows: rows as PlanRow[] });
    const out = await applyReanchor(asClient(db), p, slot => ({ fye_month: slot.fye_month, fye_year: slot.fye_year, status: 'Pending' }));
    check('reverting: the hidden October row (exact TeamWork date 31 Oct kept) comes back and September goes', out.moved.length === 1 && out.moved[0].how === 'restored' && db.rows.find(r => r.id === 40)?.status === 'Pending' && db.rows.find(r => r.id === 41)?.status === 'Excluded', { out, rows: db.rows });
  }

  console.log('\n--- the Master List PATCH glue: which month AR ran on before / runs on after ---');
  const COMPANY = { id: 1705, company_name: 'BEAUTY ASSET PTE LTD', registration_no: '200718949M', fye_month: 'September', pic: null, sec_pic: null, is_active: true, tw_status: 'Active' };
  const master = (o: Record<string, unknown> = {}) => ({ id: 77, roc_no: '200718949m', list_type: 'active_client', manual_fields: {}, ...o });
  const glue = async (db: Fake, edit: Parameters<typeof reanchorAfterMasterListFyeEdit>[1]) => reanchorAfterMasterListFyeEdit(asClient(db), edit);
  {
    // staff type OCT while TeamWork (companies.fye_month) says September, the old cell (SEP) was never edited by anyone
    const db = new Fake([rowOf(714, 'September', 2026, '2026-09-30')], []); db.companies = [{ ...COMPANY }];
    const r = await glue(db, { masterRow: master(), previousValue: 'SEP', newValue: 'OCT', preAudit: null });
    check('TeamWork says September, staff type OCT: AR moves September -> October at once', r.applied && r.oldMonth === 'September' && r.newMonth === 'October' && r.outcome?.moved[0]?.to === 'October 2026'
      && db.rows.some(x => x.fye_month === 'October' && x.status === 'Pending') && db.rows.find(x => x.id === 714)?.status === 'Excluded', { r, rows: db.rows });
  }
  {
    // the cell was a deliberate OCT (hoechyi-style edit) and is now cleared: AR goes back to TeamWork's September
    const db = new Fake([rowOf(714, 'September', 2026, '2026-09-30', { status: 'Excluded' }), rowOf(40, 'October', 2026, '2026-10-31')],
      [{ id: 3, ar_reminder_id: 714, old_value: 'Pending', changed_by_email: FYE_EXCLUDER, changed_by_name: `${FYE_EXCLUDER_NAME_PREFIX}, replaced by the Master List FYE)`, changed_at: '2026-10-01T00:00:00Z' }]);
    db.companies = [{ ...COMPANY }];
    const r = await glue(db, { masterRow: master(), previousValue: 'OCT', newValue: null, preAudit: { changedBy: 'vincent@tassure.com', newValue: 'OCT', changedAt: '2026-10-01T00:00:00Z' } });
    check('clearing a deliberate OCT hands AR back to TeamWork: the hidden September row is restored, the October one goes', r.applied && r.oldMonth === 'October' && r.newMonth === 'September' && db.rows.find(x => x.id === 714)?.status === 'Pending' && db.rows.find(x => x.id === 40)?.status === 'Excluded', { r, rows: db.rows });
  }
  {
    // an edit that only re-types what TeamWork already shows changes nothing
    const db = new Fake([rowOf(714, 'September', 2026, '2026-09-30')], []); db.companies = [{ ...COMPANY }];
    const r = await glue(db, { masterRow: master(), previousValue: 'JUN', newValue: 'SEP', preAudit: null });
    check('typing the month TeamWork already shows (and the old cell was never deliberate) moves nothing', !r.applied && writes(db).length === 0, r);
  }
  {
    const db = new Fake([rowOf(714, 'September', 2026, '2026-09-30')], []); db.companies = [{ ...COMPANY }];
    const r1 = await glue(db, { masterRow: master({ list_type: 'strike_off' }), previousValue: 'SEP', newValue: 'OCT', preAudit: null });
    check('only Active Client rows touch AR', !r1.applied && /Active Client/.test(r1.reason ?? '') && writes(db).length === 0, r1);
    db.companies = [];
    const r2 = await glue(db, { masterRow: master(), previousValue: 'SEP', newValue: 'OCT', preAudit: null });
    check('a UEN with no active company is reported, never guessed', !r2.applied && /no active company/.test(r2.reason ?? '') && writes(db).length === 0, r2);
    db.companies = [{ ...COMPANY }, { ...COMPANY, id: 1706 }];
    const r3 = await glue(db, { masterRow: master(), previousValue: 'SEP', newValue: 'OCT', preAudit: null });
    check('two active companies with one UEN: nothing is moved', !r3.applied && /more than one/.test(r3.reason ?? '') && writes(db).length === 0, r3);
    db.companies = [{ ...COMPANY, is_active: false, tw_status: 'Terminated' }];
    const r4 = await glue(db, { masterRow: master(), previousValue: 'SEP', newValue: 'OCT', preAudit: null });
    check('a terminated company gets no rows', !r4.applied && writes(db).length === 0, r4);
  }

  console.log('\n--- the module boundaries ---');
  const applySrc = readFileSync('lib/ar-plan-apply.ts', 'utf8').replace(/\/\/.*$/gm, '');
  check('the executor never inserts into a slot that an Excluded row holds (it consults the restore result first)', /restore\.handled\.has\(slotKey/.test(applySrc));
  check('every UPDATE the executor makes is guarded by the row\'s current state (filed rows and already-hidden rows cannot match)', /\.is\('filling_date', null\)\.is\('agm_held_date', null\)\.or\('status\.is\.null,status\.neq\.Excluded'\)/.test(applySrc));

  if (failed) { console.log(`\n${failed} FAILED`); process.exit(1); }
  console.log('\nALL OK');
})().catch(e => { console.error(e); process.exit(1); });
