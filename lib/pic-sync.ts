import type { SupabaseClient } from '@supabase/supabase-js';
import { logFieldChange } from './audit-log';

// Two-way "last edit wins" sync for ACC/TAX PIC between AR Reminder
// (ar_reminder.acc_pic/tax_pic) and Active Client (master_list's
// acc_pic_override/tax_pic_override, joined by UEN — see the accByUen/
// taxByUen logic in app/api/master-list/route.ts's GET). Per Vincent:
// whichever page a PIC was most recently typed into should win and be
// mirrored onto the other, rather than the override always shadowing
// AR Reminder's synced value one-directionally like before.

export type PicField = 'acc_pic' | 'tax_pic';

function normalizeUen(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

// AR Reminder's acc_pic/tax_pic was just edited -> mirror it onto the
// matching Active Client row's override field. master_list has no DB-level
// audit trigger (unlike ar_reminder), so this logs through the shared
// audit_log table itself.
export async function syncPicToActiveClient(
  supabase: SupabaseClient,
  uen: string | null | undefined,
  field: PicField,
  value: string | null,
  changedBy: string,
): Promise<void> {
  const normalized = normalizeUen(uen);
  if (!normalized) return;
  const overrideField = field === 'acc_pic' ? 'acc_pic_override' : 'tax_pic_override';

  const { data: rows } = await supabase
    .from('master_list')
    .select(`id, roc_no, ${overrideField}`)
    .eq('list_type', 'active_client');

  for (const row of (rows ?? []) as Record<string, unknown>[]) {
    if (normalizeUen(row.roc_no as string | null) !== normalized) continue;
    const oldValue = (row[overrideField] as string | null) ?? null;
    if ((oldValue ?? '').trim() === (value ?? '').trim()) continue;
    const { error } = await supabase
      .from('master_list')
      .update({ [overrideField]: value, updated_at: new Date().toISOString() })
      .eq('id', row.id as number);
    if (error) continue;
    await logFieldChange(supabase, {
      tableName: 'master_list', rowId: row.id as number, field: overrideField,
      oldValue, newValue: value, changedBy,
    });
  }
}

// Active Client's acc_pic_override/tax_pic_override was just edited -> mirror
// it onto every ar_reminder row for that company (across all FYE cycles —
// the same person typically handles all of them, and there's no per-cycle
// PIC concept on the Active Client side to disambiguate). ar_reminder
// already has its own BEFORE/AFTER UPDATE triggers (see
// scripts/add-ar-collaboration.sql) that auto-manage updated_at/version and
// write to ar_reminder_audit on any change — no manual logFieldChange call
// needed here, just set who made the change so that trigger attributes it
// correctly.
export async function syncPicToArReminder(
  supabase: SupabaseClient,
  uen: string | null | undefined,
  field: PicField,
  value: string | null,
  changedByEmail: string,
  changedByName: string,
): Promise<void> {
  const normalized = normalizeUen(uen);
  if (!normalized) return;

  const { data: rows } = await supabase.from('ar_reminder').select(`id, uen, ${field}`);

  for (const row of (rows ?? []) as Record<string, unknown>[]) {
    if (normalizeUen(row.uen as string | null) !== normalized) continue;
    const oldValue = (row[field] as string | null) ?? null;
    if ((oldValue ?? '').trim() === (value ?? '').trim()) continue;
    await supabase
      .from('ar_reminder')
      .update({ [field]: value, updated_by_email: changedByEmail, updated_by_name: changedByName })
      .eq('id', row.id as number);
  }
}
