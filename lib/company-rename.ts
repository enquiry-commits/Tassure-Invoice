import type { SupabaseClient } from '@supabase/supabase-js';

// Change Co Name's own row IS the single source of truth for a rename — every
// other page (Companies, the other Master List views) reads it live by UEN
// rather than a "renamed" note being copied onto each matching row by hand,
// so there is never a second copy of the fact that can fall out of sync.

export type RenameInfo = { oldName: string; newName: string };

export function normalizeUen(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

export async function loadRenameMap(supabase: SupabaseClient): Promise<Map<string, RenameInfo>> {
  const { data } = await supabase
    .from('master_list')
    .select('roc_no, company_name, new_company_name')
    .eq('list_type', 'name_change')
    .not('roc_no', 'is', null)
    .not('new_company_name', 'is', null);

  const map = new Map<string, RenameInfo>();
  for (const row of data ?? []) {
    const uen = normalizeUen(row.roc_no);
    const newName = (row.new_company_name ?? '').trim();
    if (!uen || !newName) continue;
    map.set(uen, { oldName: row.company_name ?? '', newName });
  }
  return map;
}
