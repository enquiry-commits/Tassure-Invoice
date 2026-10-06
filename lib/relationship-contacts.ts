// Shared people/party list behind Company 360's "Referred by" and "RM"
// pickers (companies.referrer_contact_id / rm_contact_id →
// relationship_contacts, see scripts/add-relationship-contacts.sql).
//
// Internal staff come from lib/staff-directory.ts and are mirrored into the
// table on demand (ensureInternalContacts) so a company can point at them by
// id like any external partner. External partners are added by staff from the
// picker itself. Every name is stored title-cased (lib/text-case.ts) and
// de-duplicated on lower(name) — "samuell ng" and "Samuell Ng" are one row.
import type { SupabaseClient } from '@supabase/supabase-js';
import { staffByTeam } from './staff-directory';
import { titleCase } from './text-case';

export type RelationshipContact = {
  id: number;
  name: string;
  kind: 'internal' | 'external';
};

export function contactNameKey(name: string): string {
  return titleCase(name).toLowerCase();
}

export async function ensureInternalContacts(supabase: SupabaseClient): Promise<void> {
  const rows = staffByTeam().flatMap(g => g.members).map(m => ({
    name: titleCase(m.name),
    name_key: contactNameKey(m.name),
    kind: 'internal' as const,
    email: m.email.toLowerCase(),
  }));
  // ignoreDuplicates: an external partner who happens to share a staff
  // member's name keeps its own row rather than being silently overwritten.
  const { error } = await supabase.from('relationship_contacts').upsert(rows, { onConflict: 'name_key', ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export async function listContacts(supabase: SupabaseClient): Promise<RelationshipContact[]> {
  const { data, error } = await supabase
    .from('relationship_contacts')
    .select('id, name, kind')
    .eq('is_active', true)
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as RelationshipContact[];
}

// Returns the existing row when the (case-insensitive) name is already in the
// list, so "Add new" on a name that exists just selects it.
export async function createExternalContact(supabase: SupabaseClient, rawName: string, createdByEmail: string | null): Promise<RelationshipContact> {
  const name = titleCase(rawName);
  if (!name) throw new Error('Name is required');
  const nameKey = contactNameKey(name);

  const existing = await supabase.from('relationship_contacts').select('id, name, kind').eq('name_key', nameKey).maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as RelationshipContact;

  const { data, error } = await supabase
    .from('relationship_contacts')
    .insert({ name, name_key: nameKey, kind: 'external', created_by_email: createdByEmail })
    .select('id, name, kind')
    .single();
  if (error) throw new Error(error.message);
  return data as RelationshipContact;
}

// Every contact's name by id — the Reports roster resolves referrer/RM names
// from one small table read rather than a per-company join.
export async function allContactNames(supabase: SupabaseClient): Promise<Map<number, string>> {
  const { data, error } = await supabase.from('relationship_contacts').select('id, name');
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map(r => [r.id as number, r.name as string]));
}

export async function contactNamesById(supabase: SupabaseClient, ids: (number | null | undefined)[]): Promise<Map<number, string>> {
  const wanted = [...new Set(ids.filter((v): v is number => typeof v === 'number'))];
  const out = new Map<number, string>();
  if (wanted.length === 0) return out;
  const { data, error } = await supabase.from('relationship_contacts').select('id, name').in('id', wanted);
  if (error) throw new Error(error.message);
  for (const r of data ?? []) out.set(r.id as number, r.name as string);
  return out;
}
