import type { SupabaseClient } from '@supabase/supabase-js';

// Shared across every table that wants field-level history (starts with
// master_list, per Vincent: table_name/row_id keeps this reusable rather
// than a one-off Master-List-only schema). Fails open — a logging hiccup
// must never block the save that already succeeded.
export async function logFieldChange(
  supabase: SupabaseClient,
  params: { tableName: string; rowId: number; field: string; oldValue: unknown; newValue: unknown; changedBy: string },
): Promise<void> {
  const { tableName, rowId, field, oldValue, newValue, changedBy } = params;
  const oldStr = oldValue === null || oldValue === undefined ? null : String(oldValue);
  const newStr = newValue === null || newValue === undefined ? null : String(newValue);
  if (oldStr === newStr) return; // no-op edit (e.g. blur without a real change) — nothing to log

  try {
    await supabase.from('audit_log').insert({
      table_name: tableName, row_id: rowId, field,
      old_value: oldStr, new_value: newStr,
      changed_by: changedBy,
    });
  } catch {
    // best-effort only
  }
}
