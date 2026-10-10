import type { SupabaseClient } from '@supabase/supabase-js';

// When a company's FYE month flips and then returns (BEAUTY ASSET PTE LTD: September → October → September, 2026-08), the
// FYE-correction pass (app/api/ar-reminder/sync-workflow) hides the old month's still-PENDING rows as Excluded (INV-AR-001).
// Nothing ever brought the September row back: the nightly catch-up's upsert (ignoreDuplicates) and the correction's own
// insert both hit a unique key held by that very row and were silently dropped, while the run still counted the row as
// inserted (INV-AR-019). Vincent, 2026-10-09: restore ONLY what the system itself hid for an FYE correction — a person's
// exclusion is never touched.
//
// Hardened after the 9-seat council review (2026-10-10), all points verified against the code:
//  - WHO hid a row is read from ar_reminder_audit (the actor of the LATEST transition to 'Excluded'), never from the row's
//    own updated_by_email: syncPicToArReminder (lib/pic-sync.ts) stamps updated_by_email on EVERY row of a company,
//    hidden ones included, and the date sync stamps 'system:teamwork' on ordinary updates — same rule as INV-AR-017;
//  - the slot is held under TWO unique keys — (entity_name, fye_month, fye_year) and (company_id, fye_year, fye_month,
//    scripts/harden-automation.sql) — both are looked up;
//  - the hidden row's fye_date must equal the date the run wants (a date-shifted row is reported, never resurrected);
//  - a restore only counts when the UPDATE really changed one row; a failed one is reported, never counted;
//  - the per-run circuit breaker is a budget shared by every call in a run (sync-workflow calls once per company).

export const FYE_EXCLUDER = 'system:teamwork';
// The FYE-correction pass and its one-time backfill both name themselves like this (the only writers of
// Excluded under system:teamwork) — checked in addition to the actor so an unrelated system:teamwork write never qualifies.
export const FYE_EXCLUDER_NAME_PREFIX = 'TeamWork Sync (FYE corrected';
export const FYE_RESTORER = 'system:fye-restore';
export const FYE_RESTORER_NAME = 'AR Generate (FYE returned — restored its own exclusion)';
export const MAX_FYE_RESTORES_PER_RUN = 10;

export type Slot = { entity_name: string; fye_month: string; fye_year: number; fye_date?: string | null; company_id?: number | null };
export type HeldRow = {
  id: number; entity_name: string; fye_month: string; fye_year: number; fye_date: string | null; company_id: number | null;
  status: string | null; filling_date: string | null; agm_held_date: string | null;
};
export type LastExclusion = { by: string | null; byName: string | null; statusBefore: string | null; at: string };
export type RestoreBudget = { left: number };
export const newRestoreBudget = (max = MAX_FYE_RESTORES_PER_RUN): RestoreBudget => ({ left: max });

export type BlockReason = 'filed' | 'no-audit-trail' | 'hidden-by-someone-else' | 'date-mismatch' | 'breaker';
export type Verdict = { row: HeldRow; last: LastExclusion | null } & ({ restore: true; restoreTo: string } | { restore: false; reason: BlockReason });

export const slotKey = (s: Pick<Slot, 'entity_name' | 'fye_month' | 'fye_year'>) => `${s.entity_name.trim().toUpperCase()}|${s.fye_month}|${s.fye_year}`;
const day = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null);

/** True when `row` holds the wanted slot under either unique key. */
export function holdsSlot(row: Pick<HeldRow, 'entity_name' | 'fye_month' | 'fye_year' | 'company_id'>, slot: Slot): boolean {
  if (row.fye_month !== slot.fye_month || row.fye_year !== slot.fye_year) return false;
  if (row.entity_name.trim().toUpperCase() === slot.entity_name.trim().toUpperCase()) return true;
  return slot.company_id != null && row.company_id === slot.company_id;
}

/** The latest transition to Excluded was made by the FYE-correction pass (actor AND its own name). */
export function isSystemFyeExclusion(last: LastExclusion | null): boolean {
  return !!last && last.by === FYE_EXCLUDER && (last.byName ?? '').startsWith(FYE_EXCLUDER_NAME_PREFIX);
}

/**
 * Pure planner. For every wanted slot that is already held by an Excluded row: restore it only if the system's FYE
 * correction hid it, it was never filed, and its date is the wanted date; otherwise leave it hidden and say why.
 * `handled` = every wanted slot an Excluded row holds — the caller must NOT insert into those (the unique key would
 * swallow it silently).
 */
export function planFyeRestores(wanted: readonly Slot[], held: readonly HeldRow[], lastById: ReadonlyMap<number, LastExclusion>, budget: RestoreBudget) {
  const verdicts: Verdict[] = [];
  const handled = new Set<string>();
  const seen = new Set<number>();
  for (const slot of wanted) {
    for (const row of held) {
      if (row.status !== 'Excluded' || !holdsSlot(row, slot)) continue;
      handled.add(slotKey(slot));
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      const last = lastById.get(row.id) ?? null;
      const block = (reason: BlockReason) => verdicts.push({ row, last, restore: false, reason });
      if (row.filling_date || row.agm_held_date) { block('filed'); continue; }
      if (!last) { block('no-audit-trail'); continue; }
      if (!isSystemFyeExclusion(last)) { block('hidden-by-someone-else'); continue; }
      const wantedDate = day(slot.fye_date), rowDate = day(row.fye_date);
      if (wantedDate && rowDate && wantedDate !== rowDate) { block('date-mismatch'); continue; }
      if (budget.left <= 0) { block('breaker'); continue; }
      budget.left--;
      verdicts.push({ row, last, restore: true, restoreTo: last.statusBefore && last.statusBefore !== 'Excluded' ? last.statusBefore : 'Pending' });
    }
  }
  return { verdicts, handled };
}

/** The LATEST transition to 'Excluded' of each row, from ar_reminder_audit (a DB trigger writes it on every update). */
export async function loadLastExclusions(supabase: SupabaseClient, ids: readonly number[]): Promise<Map<number, LastExclusion>> {
  const out = new Map<number, LastExclusion>();
  for (let i = 0; i < ids.length; i += 200) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from('ar_reminder_audit')
        .select('id, ar_reminder_id, old_value, changed_by_email, changed_by_name, changed_at')
        .in('ar_reminder_id', ids.slice(i, i + 200)).eq('field_name', 'status').eq('new_value', 'Excluded')
        .order('id').range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const t of data ?? []) {
        const prev = out.get(t.ar_reminder_id as number);
        if (!prev || String(t.changed_at) > prev.at) out.set(t.ar_reminder_id as number, { by: t.changed_by_email as string | null, byName: t.changed_by_name as string | null, statusBefore: t.old_value as string | null, at: String(t.changed_at) });
      }
      if ((data?.length ?? 0) < 1000) break;
    }
  }
  return out;
}

export type RestoreOutcome = {
  verdicts: Verdict[];
  restored: Verdict[];            // really restored (or, with apply:false, WOULD be restored)
  blocked: Verdict[];             // left hidden, with the reason
  failed: Array<{ verdict: Verdict; error: string }>; // wanted to restore, the UPDATE did not change exactly one row
  handled: Set<string>;           // slots held by an Excluded row — do not insert into them
};

/**
 * For the rows a run is about to insert: restore the system's own FYE exclusions that hold the same slot and report
 * the rest. `apply: false` is the read-only dry run (what scripts and shadow runs use). Throws on a read error — the
 * caller decides how to fail (the catch-up fails open to its plain insert).
 */
export async function restoreFyeExcludedRows(supabase: SupabaseClient, wanted: readonly Slot[], budget: RestoreBudget, opts: { apply?: boolean } = {}): Promise<RestoreOutcome> {
  const apply = opts.apply !== false;
  const out: RestoreOutcome = { verdicts: [], restored: [], blocked: [], failed: [], handled: new Set<string>() };
  if (!wanted.length) return out;
  const cols = 'id, entity_name, fye_month, fye_year, fye_date, company_id, status, filling_date, agm_held_date';
  const held = new Map<number, HeldRow>();
  const names = [...new Set(wanted.map(w => w.entity_name))];
  const companyIds = [...new Set(wanted.map(w => w.company_id).filter((x): x is number => typeof x === 'number'))];
  for (let i = 0; i < names.length; i += 100) {
    const { data, error } = await supabase.from('ar_reminder').select(cols).eq('status', 'Excluded').in('entity_name', names.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) held.set(r.id as number, r as HeldRow);
  }
  for (let i = 0; i < companyIds.length; i += 100) {
    const { data, error } = await supabase.from('ar_reminder').select(cols).eq('status', 'Excluded').in('company_id', companyIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const r of data ?? []) held.set(r.id as number, r as HeldRow);
  }
  if (!held.size) return out;

  const { verdicts, handled } = planFyeRestores(wanted, [...held.values()], await loadLastExclusions(supabase, [...held.keys()]), budget);
  out.verdicts = verdicts;
  out.handled = handled;
  for (const v of verdicts) {
    if (!v.restore) { out.blocked.push(v); continue; }
    if (!apply) { out.restored.push(v); continue; }
    const { data, error } = await supabase.from('ar_reminder')
      .update({ status: v.restoreTo, updated_by_email: FYE_RESTORER, updated_by_name: FYE_RESTORER_NAME })
      .eq('id', v.row.id).eq('status', 'Excluded').select('id');
    if (error || (data?.length ?? 0) !== 1) out.failed.push({ verdict: v, error: error?.message ?? 'no row was updated (it changed under us)' });
    else out.restored.push(v);
  }
  return out;
}
