import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { normalize } from './company-name';

export type SoaRemarksByCompany = Map<string, string | null>;

export function isMissingSoaRemarksStorage(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === '42P01'
    || error?.code === 'PGRST205'
    || /soa_remarks.*(?:does not exist|schema cache)/i.test(error?.message ?? '');
}

// Safe deployment order: the web build can land before the SQL migration.
// Reads degrade to blank remarks until the table exists; writes return a
// clear migration-needed error from the API instead of breaking Outstanding.
export async function loadSoaRemarks(supabase: SupabaseClient): Promise<SoaRemarksByCompany> {
  const { data, error } = await supabase
    .from('soa_remarks')
    .select('customer_name_norm, remarks');
  if (error) {
    if (isMissingSoaRemarksStorage(error)) return new Map();
    throw error;
  }
  return new Map((data ?? []).map(row => [String(row.customer_name_norm), row.remarks ? String(row.remarks) : null]));
}

export function soaRemarksForCompany(remarks: SoaRemarksByCompany, companyName: string) {
  return remarks.get(normalize(companyName)) ?? null;
}
