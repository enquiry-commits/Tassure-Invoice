import type { SupabaseClient } from '@supabase/supabase-js';
import { logFieldChange } from './audit-log';
import { FYE_EXCLUDER, FYE_EXCLUDER_NAME_PREFIX, newRestoreBudget, restoreFyeExcludedRows, slotKey, type RestoreBudget } from './ar-fye-restore';
import type { CompanyPlan, HideReason, PlanReport, Wanted } from './ar-cycle-plan';

// Carries out (or, in shadow mode, only describes) what lib/ar-cycle-plan.ts decided for every company in one nightly run
// (INV-AR-021). Everything here is fail-safe in the same ways the FYE restore is (INV-AR-019):
//   - a person's exclusion is never touched; the system's own is restored only when its audit trail says so;
//   - every write is guarded by the row's current state and counts only when exactly ONE row changed;
//   - small per-run budgets, and if the plan as a whole asks for more than MAX_PLAN_CHANGES_PER_RUN changes it is treated as
//     suspect (a bad TeamWork night, a parsing change) and NOTHING is applied that night — it is reported instead.

export const PLAN_HIDER = FYE_EXCLUDER;                                   // 'system:teamwork' — recognised by isSystemFyeExclusion, so the row is restorable
export const PLAN_HIDE_NAMES: Record<HideReason, string> = {
  'phantom': `${FYE_EXCLUDER_NAME_PREFIX}, no cycle at this date in TeamWork)`,
  'superseded-by-master-list': `${FYE_EXCLUDER_NAME_PREFIX}, replaced by the Master List FYE)`,
};
export const MAX_PLAN_INSERTS_PER_RUN = 10;
export const MAX_PLAN_HIDES_PER_RUN = 15;
export const MAX_PLAN_CHANGES_PER_RUN = 60;

export type PlanItem = { company: { id: number; name: string }; plan: CompanyPlan };
export type PlanOutcome = {
  mode: 'shadow' | 'apply';
  tripped: boolean;                          // the plan asked for too much: nothing was applied
  exceedsLimit: boolean;                     // wanted + hide is above MAX_PLAN_CHANGES_PER_RUN (in shadow mode this is what WOULD trip)
  companies: number;                         // companies planned
  wanted: number; covered: number;
  restored: Array<{ id: number; company: string; slot: string }>;   // really restored (apply) / would be (shadow)
  inserted: Array<{ company: string; slot: string }>;               // really inserted (apply) / would be (shadow)
  hidden: Array<{ id: number; company: string; slot: string; reason: HideReason }>;
  blocked: Array<{ id: number; company: string; slot: string; why: string; by: string | null }>;   // left as they are, a person decides
  failed: Array<{ what: string; company: string; error: string }>;
  reports: Record<string, number>;           // by kind: suspect-cycle, stale-cycle, other-month-cycle, date-drift, …
};

const slotText = (s: { fye_month: string; fye_year: number }) => `${s.fye_month} ${s.fye_year}`;

export function emptyOutcome(mode: 'shadow' | 'apply'): PlanOutcome {
  return { mode, tripped: false, exceedsLimit: false, companies: 0, wanted: 0, covered: 0, restored: [], inserted: [], hidden: [], blocked: [], failed: [], reports: {} };
}

export function tallyReports(reports: readonly PlanReport[], into: Record<string, number>) {
  for (const r of reports) into[r.kind] = (into[r.kind] ?? 0) + 1;
}

export async function executeArPlans(
  supabase: SupabaseClient,
  items: readonly PlanItem[],
  opts: { apply: boolean; restoreBudget?: RestoreBudget; buildInsert: (companyId: number, w: Wanted) => Record<string, unknown> },
): Promise<PlanOutcome> {
  const out = emptyOutcome(opts.apply ? 'apply' : 'shadow');
  const wantedAll: Array<{ company: PlanItem['company']; w: Wanted }> = [];
  const hideAll: Array<{ company: PlanItem['company']; row: CompanyPlan['hide'][number]['row']; reason: HideReason }> = [];
  for (const it of items) {
    out.companies++;
    out.covered += it.plan.covered;
    tallyReports(it.plan.reports, out.reports);
    for (const w of it.plan.wanted) wantedAll.push({ company: it.company, w });
    for (const h of it.plan.hide) hideAll.push({ company: it.company, row: h.row, reason: h.reason });
  }
  out.wanted = wantedAll.length;

  let apply = opts.apply;
  out.exceedsLimit = wantedAll.length + hideAll.length > MAX_PLAN_CHANGES_PER_RUN;
  if (apply && out.exceedsLimit) { out.tripped = true; apply = false; }

  // 1. what the system itself hid and TeamWork still wants: restore (or, in shadow, report what would be)
  const budget = apply ? (opts.restoreBudget ?? newRestoreBudget()) : newRestoreBudget(1_000_000);
  const restore = await restoreFyeExcludedRows(supabase, wantedAll.map(x => x.w.slot), budget, { apply });
  for (const v of restore.restored) out.restored.push({ id: v.row.id, company: v.row.entity_name, slot: slotText(v.row) });
  for (const v of restore.blocked) out.blocked.push({ id: v.row.id, company: v.row.entity_name, slot: slotText(v.row), why: v.restore ? 'restore-failed' : v.reason, by: v.last?.by ?? null });
  for (const f of restore.failed) out.failed.push({ what: 'restore', company: f.verdict.row.entity_name, error: f.error });

  // 2. wanted and nothing holds the slot: insert (a slot held by an Excluded row was handled above and must NOT be inserted into)
  let insertsLeft = MAX_PLAN_INSERTS_PER_RUN;
  for (const { company, w } of wantedAll) {
    if (restore.handled.has(slotKey(w.slot))) continue;
    if (!apply) { out.inserted.push({ company: company.name, slot: slotText(w.slot) }); continue; }
    if (insertsLeft <= 0) { out.failed.push({ what: 'insert', company: company.name, error: `per-run insert budget (${MAX_PLAN_INSERTS_PER_RUN}) used up` }); continue; }
    const { data, error } = await supabase.from('ar_reminder').insert(opts.buildInsert(company.id, w)).select('id');
    if (error && (error as { code?: string }).code === '23505') continue;   // the slot appeared meanwhile (generate, a person): nothing to do
    if (error || (data?.length ?? 0) !== 1) { out.failed.push({ what: 'insert', company: company.name, error: error?.message ?? 'no row was inserted' }); continue; }
    insertsLeft--;
    out.inserted.push({ company: company.name, slot: slotText(w.slot) });
  }

  // 3. ghosts and replaced rows: hide (reversible — the same Excluded status the delete button uses)
  let hidesLeft = MAX_PLAN_HIDES_PER_RUN;
  for (const { company, row, reason } of hideAll) {
    if (!apply) { out.hidden.push({ id: row.id, company: company.name, slot: slotText(row), reason }); continue; }
    if (hidesLeft <= 0) { out.failed.push({ what: 'hide', company: company.name, error: `per-run hide budget (${MAX_PLAN_HIDES_PER_RUN}) used up` }); continue; }
    const { data, error } = await supabase.from('ar_reminder')
      .update({ status: 'Excluded', updated_by_email: PLAN_HIDER, updated_by_name: PLAN_HIDE_NAMES[reason] })
      .eq('id', row.id).is('filling_date', null).is('agm_held_date', null).or('status.is.null,status.neq.Excluded').select('id');
    if (error || (data?.length ?? 0) !== 1) { out.failed.push({ what: 'hide', company: company.name, error: error?.message ?? 'no row was updated (it changed under us)' }); continue; }
    hidesLeft--;
    out.hidden.push({ id: row.id, company: company.name, slot: slotText(row), reason });
    await logFieldChange(supabase, { tableName: 'ar_reminder', rowId: row.id, field: 'status', oldValue: row.status, newValue: 'Excluded', changedBy: 'system:teamwork-agm-history' });
  }
  return out;
}
