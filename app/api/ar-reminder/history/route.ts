import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';

const RESTORABLE_FIELDS = new Set([
  'reminder_note', 'prepared_date', 'date_of_agm', 'agm_held_date',
  'sent_date', 'received_date', 'filling_date', 'ar_status', 'xbrl',
  'software_update', 'dpo', 'ond_ron', 'pic', 'acc_pic', 'tax_pic', 'remarks',
  'accounts_status', 'fin_stmt_status', 'audited_fs', 'agm_documents', 'dormant',
]);

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Valid id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('ar_reminder_audit')
    .select('id, ar_reminder_id, field_name, old_value, new_value, changed_by_name, changed_by_email, changed_at, version')
    .eq('ar_reminder_id', id)
    .in('field_name', [...RESTORABLE_FIELDS])
    .order('changed_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ history: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { auditId } = await req.json();
  if (!auditId) return NextResponse.json({ error: 'auditId required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: audit, error: auditError } = await supabase
    .from('ar_reminder_audit')
    .select('*')
    .eq('id', auditId)
    .maybeSingle();
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 500 });
  if (!audit) return NextResponse.json({ error: 'History entry not found' }, { status: 404 });
  if (!RESTORABLE_FIELDS.has(audit.field_name)) {
    return NextResponse.json({ error: 'This field cannot be restored here' }, { status: 400 });
  }

  let query = supabase
    .from('ar_reminder')
    .update({
      [audit.field_name]: audit.old_value,
      updated_by_email: account.email,
      updated_by_name: account.name,
    })
    .eq('id', audit.ar_reminder_id);
  query = audit.new_value == null
    ? query.is(audit.field_name, null)
    : query.filter(audit.field_name, 'eq', audit.new_value);

  const { data, error } = await query.select('*').maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) {
    return NextResponse.json({
      error: 'conflict',
      message: 'A newer change exists. Refresh the history before restoring.',
    }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    id: audit.ar_reminder_id,
    field: audit.field_name,
    value: data[audit.field_name] ?? null,
    updatedAt: data.updated_at ?? null,
    version: data.version ?? null,
  });
}
