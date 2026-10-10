import type { SupabaseClient } from '@supabase/supabase-js';
import { logFieldChange } from './audit-log';
import { nearestYearOf, type PlanRow } from './ar-cycle-plan';
import { PLAN_HIDER, PLAN_HIDE_NAMES } from './ar-plan-apply';
import { newRestoreBudget, restoreFyeExcludedRows, slotKey, type Slot } from './ar-fye-restore';
import { MONTHS, fyeMonthName, manualFyeFromMaster, monthEndIso, type FyeAudit } from './ar-fye-resolve';
import { isTeamworkActiveCompany } from './company-lifecycle';
import { loadCarriedForwardPics } from './pic-sync';
import { resolveTeamworkPic } from './teamwork-pic';
import { addMonths, toDateStr } from './date';

// Staff changed (or cleared) the FYE in Master List: AR Reminder must follow AT ONCE, not at the next nightly run (Vincent,
// 2026-10-10: "如果员工把 FYE 突然改成了 SEP，那么系统已经立刻把 AR 换成 SEP 的"). This moves the company's pending rows from the month AR
// used to run on to the month it runs on now — from what the database already knows (no TeamWork call in a web request). The
// nightly plan (lib/ar-cycle-plan.ts) is the backstop that makes it exact against TeamWork's own cycles.
//
// Order matters: the row under the NEW month is made sure of first (restored from the system's own earlier exclusion, else
// inserted) and only then the old one is hidden — so a failure leaves the company visible under the old month, never invisible.

export const MAX_REANCHOR_ROWS = 6;
export const REANCHOR_HIDE_REASON = 'superseded-by-master-list' as const;

export type ReanchorPlan = {
  moves: Array<{ row: PlanRow; target: Slot & { fye_date: string } }>;
  skipped: string[];     // why nothing (or not everything) was moved
};

/**
 * Pure. `rows` = every ar_reminder row of the company, hidden ones too. Only visible, unfiled rows under `oldMonth` move; a row that
 * is filed or held is history. The target is the nearest occurrence of the new month to the row's own date.
 */
export function planReanchor(input: {
  company: { id: number; name: string }; oldMonth: string | null; newMonth: string | null; rows: readonly PlanRow[];
}): ReanchorPlan {
  const plan: ReanchorPlan = { moves: [], skipped: [] };
  const { company, oldMonth, newMonth } = input;
  if (!newMonth) { plan.skipped.push('no month to move to'); return plan; }
  if (!oldMonth || oldMonth === newMonth) { plan.skipped.push('the month AR runs on did not change'); return plan; }
  const taken = new Set<string>();
  for (const r of input.rows) {
    if (r.status === 'Excluded' || r.filling_date || r.agm_held_date || r.fye_month !== oldMonth) continue;
    if (!r.fye_date) { plan.skipped.push(`row #${r.id} has no date`); continue; }
    const year = nearestYearOf(newMonth, r.fye_date);
    const target = { entity_name: company.name, fye_month: newMonth, fye_year: year, fye_date: monthEndIso(newMonth, year), company_id: company.id };
    const key = slotKey(target);
    if (taken.has(key)) { plan.skipped.push(`row #${r.id} maps to a slot another row already maps to (${newMonth} ${year})`); continue; }
    taken.add(key);
    plan.moves.push({ row: r, target });
  }
  if (plan.moves.length > MAX_REANCHOR_ROWS) {
    plan.skipped.push(`${plan.moves.length} rows would move (limit ${MAX_REANCHOR_ROWS}) — left for the nightly plan`);
    plan.moves = [];
  }
  return plan;
}

export type ReanchorOutcome = {
  moved: Array<{ from: string; to: string; how: 'restored' | 'inserted' | 'already-there' }>;
  failed: string[];
  skipped: string[];
};

/** Carries the plan out. Never throws for a single row; a read failure of the company's rows throws (the caller reports it). */
export async function applyReanchor(
  supabase: SupabaseClient,
  plan: ReanchorPlan,
  buildInsert: (slot: Slot & { fye_date: string }) => Record<string, unknown>,
): Promise<ReanchorOutcome> {
  const out: ReanchorOutcome = { moved: [], failed: [], skipped: [...plan.skipped] };
  if (!plan.moves.length) return out;
  // restore matches on the slot's month/year (no date): the hidden row keeps TeamWork's exact date, the typed month is month-end
  const restore = await restoreFyeExcludedRows(supabase, plan.moves.map(m => ({ ...m.target, fye_date: undefined })), newRestoreBudget(MAX_REANCHOR_ROWS), { apply: true });
  const restoredKeys = new Set(restore.restored.map(v => slotKey(v.row)));
  for (const f of restore.failed) out.failed.push(`restore of #${f.verdict.row.id}: ${f.error}`);

  for (const { row, target } of plan.moves) {
    const label = (x: { fye_month: string; fye_year: number }) => `${x.fye_month} ${x.fye_year}`;
    let how: 'restored' | 'inserted' | 'already-there' | null = null;
    if (restoredKeys.has(slotKey(target))) how = 'restored';
    else if (restore.handled.has(slotKey(target))) { out.failed.push(`${label(target)}: a hidden row holds it and was not restored (${restore.blocked.map(b => (b.restore ? '' : b.reason)).filter(Boolean).join(', ') || 'see the log'})`); continue; }
    else {
      const { data, error } = await supabase.from('ar_reminder').insert(buildInsert(target)).select('id');
      if (error && (error as { code?: string }).code === '23505') how = 'already-there';
      else if (error || (data?.length ?? 0) !== 1) { out.failed.push(`${label(target)}: ${error?.message ?? 'no row was inserted'}`); continue; }
      else how = 'inserted';
    }
    const { data: hid, error: hideErr } = await supabase.from('ar_reminder')
      .update({ status: 'Excluded', updated_by_email: PLAN_HIDER, updated_by_name: PLAN_HIDE_NAMES[REANCHOR_HIDE_REASON] })
      .eq('id', row.id).is('filling_date', null).is('agm_held_date', null).or('status.is.null,status.neq.Excluded').select('id');
    if (hideErr || (hid?.length ?? 0) !== 1) { out.failed.push(`#${row.id} ${label(row)} could not be hidden: ${hideErr?.message ?? 'it changed under us'}`); continue; }
    await logFieldChange(supabase, { tableName: 'ar_reminder', rowId: row.id, field: 'status', oldValue: row.status, newValue: 'Excluded', changedBy: 'system:master-list-fye' });
    out.moved.push({ from: label(row), to: label(target), how });
  }
  return out;
}

// ── the Master List edit → AR, in one call ───────────────────────────────────────────────────────────────────────────

export type MasterListFyeEdit = {
  masterRow: { id: number; roc_no: string | null; list_type: string | null; manual_fields: Record<string, unknown> | null };
  previousValue: string | null;     // the cell before the edit (as stored)
  newValue: string | null;          // the cell after the edit (as stored; null = cleared)
  preAudit: FyeAudit | null;        // the latest audit entry of this cell BEFORE this edit
};
export type MasterListFyeResult = { applied: boolean; reason?: string; oldMonth: string | null; newMonth: string | null; outcome?: ReanchorOutcome };

/**
 * Called by the Master List PATCH handler after an FYE edit was saved. Works out the month AR ran on before and after the edit
 * (a deliberate Master List month, else TeamWork's), and moves the company's pending rows. Applies only to Active Client rows whose
 * UEN matches ONE active company; anything else is reported, not guessed. Throws only on a database read failure.
 */
export async function reanchorAfterMasterListFyeEdit(supabase: SupabaseClient, edit: MasterListFyeEdit): Promise<MasterListFyeResult> {
  const none = (reason: string): MasterListFyeResult => ({ applied: false, reason, oldMonth: null, newMonth: null });
  if (edit.masterRow.list_type !== 'active_client') return none('not an Active Client row');
  const uen = String(edit.masterRow.roc_no ?? '').trim();
  if (!uen) return none('the row has no UEN');
  const { data: companies, error } = await supabase.from('companies')
    .select('id, company_name, registration_no, fye_month, pic, sec_pic, is_active, tw_status').ilike('registration_no', uen);
  if (error) throw new Error(error.message);
  const live = (companies ?? []).filter(c => String(c.registration_no ?? '').trim().toUpperCase() === uen.toUpperCase() && isTeamworkActiveCompany(c));
  if (live.length !== 1) return none(live.length ? 'more than one active company has this UEN' : 'no active company has this UEN');
  const company = live[0];
  const twMonth = company.fye_month && (MONTHS as readonly string[]).includes(company.fye_month) ? company.fye_month as string : null;

  const oldManual = manualFyeFromMaster({ fye: edit.previousValue, manualFields: edit.masterRow.manual_fields, lastAudit: edit.preAudit });
  const newMonthTyped = fyeMonthName(edit.newValue);          // a person just typed it
  const oldMonth = oldManual?.month ?? twMonth;
  const newMonth = newMonthTyped ?? twMonth;
  if (!oldMonth || !newMonth || oldMonth === newMonth) return { applied: false, reason: 'the month AR runs on did not change', oldMonth, newMonth };

  const [byId, byName] = await Promise.all([
    supabase.from('ar_reminder').select('id, entity_name, company_id, fye_month, fye_year, fye_date, status, filling_date, agm_held_date').eq('company_id', company.id),
    supabase.from('ar_reminder').select('id, entity_name, company_id, fye_month, fye_year, fye_date, status, filling_date, agm_held_date').eq('entity_name', company.company_name as string),
  ]);
  if (byId.error) throw new Error(byId.error.message);
  if (byName.error) throw new Error(byName.error.message);
  const rows = new Map<number, PlanRow>();
  for (const r of [...(byId.data ?? []), ...(byName.data ?? [])]) rows.set(r.id as number, r as PlanRow);

  const plan = planReanchor({ company: { id: company.id as number, name: company.company_name as string }, oldMonth, newMonth, rows: [...rows.values()] });
  const { accFor, taxFor } = await loadCarriedForwardPics(supabase);
  const outcome = await applyReanchor(supabase, plan, slot => ({
    entity_name: slot.entity_name,
    company_id: company.id,
    uen: company.registration_no || '',
    fye_month: slot.fye_month,
    fye_year: slot.fye_year,
    fye_date: slot.fye_date,
    due_date: toDateStr(addMonths(new Date(`${slot.fye_date}T00:00:00Z`), 7)),
    pic: resolveTeamworkPic((company.sec_pic as string | null) ?? (company.pic as string | null) ?? null),
    acc_pic: accFor(company.id as number, (company.registration_no as string | null) ?? null),
    tax_pic: taxFor(company.id as number, (company.registration_no as string | null) ?? null),
    acc_pic_manual: false,
    tax_pic_manual: false,
    status: 'Pending',
  }));
  return { applied: outcome.moved.length > 0, oldMonth, newMonth, outcome };
}
