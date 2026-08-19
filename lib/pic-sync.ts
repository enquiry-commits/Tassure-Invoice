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

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type CarryForwardLookup = (companyId: number | null | undefined, uen: string | null | undefined) => string | null;

// A brand-new ar_reminder row (new FYE cycle) starts with acc_pic/tax_pic
// null — unlike Secretary PIC (sourced from TeamWork via companies.pic), NO
// upstream system tracks who does a company's accounts/tax (confirmed:
// companies.acc_pic/tax_pic are 100% empty — TeamWork simply never captured
// this). The best available signal is the SAME company's own most recent
// prior cycle: accounts/tax staff assignments are normally sticky year to
// year. This is only ever a starting SUGGESTION written at row-creation
// time — staff can freely overwrite it exactly like any other field, same
// as they already do for the fully-manual value today; it's never enforced
// or re-applied afterwards.
export async function loadCarriedForwardPics(
  supabase: SupabaseClient,
): Promise<{ accFor: CarryForwardLookup; taxFor: CarryForwardLookup }> {
  const { data } = await supabase
    .from('ar_reminder')
    .select('company_id, uen, acc_pic, tax_pic, fye_year, fye_month')
    .or('acc_pic.not.is.null,tax_pic.not.is.null');

  const cycleKey = (year: number, month: string) => year * 12 + MONTH_NAMES.indexOf(month);
  const byCompanyId = { acc: new Map<number, { key: number; value: string }>(), tax: new Map<number, { key: number; value: string }>() };
  const byUen = { acc: new Map<string, { key: number; value: string }>(), tax: new Map<string, { key: number; value: string }>() };

  const consider = (field: 'acc' | 'tax', companyId: number | null, uen: string, key: number, value: string | null) => {
    if (!value) return;
    if (companyId) {
      const cur = byCompanyId[field].get(companyId);
      if (!cur || key > cur.key) byCompanyId[field].set(companyId, { key, value });
    }
    if (uen) {
      const cur = byUen[field].get(uen);
      if (!cur || key > cur.key) byUen[field].set(uen, { key, value });
    }
  };

  for (const row of (data ?? []) as { company_id: number | null; uen: string | null; acc_pic: string | null; tax_pic: string | null; fye_year: number; fye_month: string }[]) {
    const key = cycleKey(row.fye_year, row.fye_month);
    const uen = normalizeUen(row.uen);
    consider('acc', row.company_id, uen, key, row.acc_pic);
    consider('tax', row.company_id, uen, key, row.tax_pic);
  }

  const lookup = (field: 'acc' | 'tax'): CarryForwardLookup => (companyId, uen) => {
    const u = normalizeUen(uen);
    return (companyId ? byCompanyId[field].get(companyId)?.value : undefined) ?? byUen[field].get(u)?.value ?? null;
  };

  return { accFor: lookup('acc'), taxFor: lookup('tax') };
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
