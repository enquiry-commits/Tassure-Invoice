import type { SupabaseClient } from '@supabase/supabase-js';
import { manualFyeFromMaster, resolveEffectiveFye, type EffectiveFye, type FyeAudit, type ManualFye } from './ar-fye-resolve';

// Reads which Active Client rows have a Master List FYE that STAFF typed (INV-AR-021), keyed by UEN. The decision itself is the
// pure manualFyeFromMaster(); this only fetches its two inputs (the row, and the latest audit_log entry for its FYE cell).

export type ManualFyeEntry = ManualFye & { masterRowId: number };

const uenKey = (v: string | null | undefined) => String(v ?? '').trim().toUpperCase();

async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }
  return out;
}

/** The latest audit_log entry of each master_list row's FYE cell (row id -> entry). */
export async function loadLatestFyeAudits(supabase: SupabaseClient): Promise<Map<number, FyeAudit>> {
  const rows = await pageAll<{ row_id: number; new_value: string | null; changed_by: string | null; changed_at: string | null }>((from, to) =>
    supabase.from('audit_log').select('row_id, new_value, changed_by, changed_at')
      .eq('table_name', 'master_list').eq('field', 'fye').order('changed_at', { ascending: false }).order('id', { ascending: false }).range(from, to));
  const out = new Map<number, FyeAudit>();
  for (const r of rows) if (!out.has(r.row_id)) out.set(r.row_id, { changedBy: r.changed_by, newValue: r.new_value, changedAt: r.changed_at });
  return out;
}

/**
 * UEN -> the month staff deliberately typed in Master List's FYE column (Active Client rows only). A UEN that has no such
 * edit is absent: it follows TeamWork. Two Active Client rows for one UEN that disagree are skipped, never guessed.
 */
export async function loadManualFyeByUen(supabase: SupabaseClient): Promise<Map<string, ManualFyeEntry>> {
  const masters = await pageAll<{ id: number; roc_no: string | null; fye: string | null; manual_fields: Record<string, unknown> | null }>((from, to) =>
    supabase.from('master_list').select('id, roc_no, fye, manual_fields').eq('list_type', 'active_client').order('id').range(from, to));
  const audits = await loadLatestFyeAudits(supabase);
  const out = new Map<string, ManualFyeEntry>();
  const conflicted = new Set<string>();
  for (const m of masters) {
    const key = uenKey(m.roc_no);
    if (!key) continue;
    const manual = manualFyeFromMaster({ fye: m.fye, manualFields: m.manual_fields, lastAudit: audits.get(m.id) ?? null });
    if (!manual) continue;
    const prev = out.get(key);
    if (prev && prev.month !== manual.month) conflicted.add(key);
    out.set(key, { ...manual, masterRowId: m.id });
  }
  for (const key of conflicted) out.delete(key);
  return out;
}

/** The month AR runs on for one company: its deliberate Master List month, else TeamWork's (gated) month, else what companies.fye_month holds. */
export function effectiveFyeForCompany(
  company: { registration_no?: string | null; fye_month?: string | null },
  manualByUen: ReadonlyMap<string, ManualFyeEntry>,
  derived?: string | null,
): EffectiveFye {
  return resolveEffectiveFye({ stored: company.fye_month, derived: derived ?? null, manual: manualByUen.get(uenKey(company.registration_no)) ?? null });
}
