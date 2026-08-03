import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

// Generic reader for lib/audit-log.ts's shared audit_log table — every table
// that logs field changes (master_list, ar_reminder, ...) reads its history
// through this one route rather than a table-specific copy. Whitelisted
// rather than accepting any string, since this becomes a query filter.
const AUDITED_TABLES = new Set(['master_list', 'ar_reminder']);

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get('table');
  const id = req.nextUrl.searchParams.get('id');
  if (!table || !AUDITED_TABLES.has(table)) return NextResponse.json({ error: 'Unknown or missing table' }, { status: 400 });
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();

  // ar_reminder already has its own DB-trigger-based audit trail
  // (ar_reminder_audit, see scripts/add-ar-collaboration.sql) that fires on
  // EVERY update to the row regardless of which code path wrote it — read
  // from that instead of the generic audit_log table, so a PIC value
  // written by the Active Client sync (lib/pic-sync.ts) shows up here too,
  // not just edits made directly on this page.
  if (table === 'ar_reminder') {
    const { data, error } = await supabase
      .from('ar_reminder_audit')
      .select('id, field_name, old_value, new_value, changed_by_name, changed_by_email, changed_at')
      .eq('ar_reminder_id', id)
      .order('changed_at', { ascending: false })
      .limit(200);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const mapped = (data ?? []).map(row => ({
      id: row.id,
      field: row.field_name,
      old_value: row.old_value,
      new_value: row.new_value,
      changed_by: row.changed_by_name || row.changed_by_email || 'unknown',
      changed_at: row.changed_at,
    }));
    return NextResponse.json({ data: mapped });
  }

  const { data, error } = await supabase
    .from('audit_log')
    .select('id, field, old_value, new_value, changed_by, changed_at')
    .eq('table_name', table)
    .eq('row_id', id)
    .order('changed_at', { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}
