import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

// Generic reader for lib/audit-log.ts's shared audit_log table. ar_reminder
// is NOT read through here — it has its own, more capable history+restore
// system already (app/api/ar-reminder/history/route.ts, reading directly
// from the DB-trigger-populated ar_reminder_audit table), surfaced via the
// "History" button in ARDetailModal. Whitelisted rather than accepting any
// string, since this becomes a query filter.
const AUDITED_TABLES = new Set(['master_list']);

export async function GET(req: NextRequest) {
  const table = req.nextUrl.searchParams.get('table');
  const id = req.nextUrl.searchParams.get('id');
  if (!table || !AUDITED_TABLES.has(table)) return NextResponse.json({ error: 'Unknown or missing table' }, { status: 400 });
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
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
