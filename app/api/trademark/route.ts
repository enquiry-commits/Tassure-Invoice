import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { logFieldChange } from '@/lib/audit-log';

const CATEGORIES = new Set(['master', 'in_progress']);

// Master Records fields vs In Progress fields overlap on sn/company_name
// only — see scripts/create-trademark-records.sql for why the rest is
// category-specific rather than one shared shape.
const EDITABLE_FIELDS = new Set([
  'sn', 'company_name', 'application_number', 'application_date', 'mark_expired_date',
  'logo_classes', 'status_text', 'updates_note',
]);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get('category') ?? 'master';
  if (!CATEGORIES.has(category)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('trademark_records')
    .select('*')
    .eq('category', category)
    .order('row_order', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ category, data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { category, company_name } = body;
  if (!CATEGORIES.has(category)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 });
  if (!company_name) return NextResponse.json({ error: 'company_name required' }, { status: 400 });

  const supabase = createAdminClient();
  const account = await getRequestAccount(req);

  const { data: maxRow } = await supabase
    .from('trademark_records')
    .select('row_order')
    .eq('category', category)
    .order('row_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextOrder = (maxRow?.row_order ?? 0) + 1;

  const record: Record<string, unknown> = {
    category, row_order: nextOrder,
    updated_by_email: account?.email ?? null, updated_by_name: account?.name ?? null,
  };
  for (const field of EDITABLE_FIELDS) {
    if (body[field] !== undefined) record[field] = body[field] || null;
  }

  const { data, error } = await supabase.from('trademark_records').insert(record).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('trademark_records').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, field, value } = body;
  if (!id || !field) return NextResponse.json({ error: 'id and field required' }, { status: 400 });
  if (!EDITABLE_FIELDS.has(field)) return NextResponse.json({ error: 'Field not editable' }, { status: 400 });
  if (!Object.prototype.hasOwnProperty.call(body, 'previousValue')) {
    return NextResponse.json({ error: 'previousValue is required for conflict-safe updates' }, { status: 428 });
  }

  const supabase = createAdminClient();
  const account = await getRequestAccount(req);
  // sn is the only integer column among EDITABLE_FIELDS — coerce it so an
  // update always sends a number, never the raw string the input gave us.
  const coerce = (v: unknown) => (field === 'sn' ? (v ? parseInt(String(v), 10) || null : null) : (v || null));
  const stored = coerce(value);
  const prevStored = coerce(body.previousValue);
  const updatedAt = new Date().toISOString();

  // Same compare-and-swap pattern as master_list/ar_reminder's own PATCH —
  // two staff editing the same cell around the same time shouldn't silently
  // overwrite each other.
  let updateQuery = supabase
    .from('trademark_records')
    .update({ [field]: stored, updated_at: updatedAt, updated_by_email: account?.email ?? null, updated_by_name: account?.name ?? null })
    .eq('id', id);
  updateQuery = prevStored === null ? updateQuery.is(field, null) : updateQuery.filter(field, 'eq', prevStored as string | number);

  const { data, error } = await updateQuery.select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!data) {
    const { data: current, error: currentError } = await supabase.from('trademark_records').select('*').eq('id', id).maybeSingle();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    if (!current) return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    return NextResponse.json({
      error: 'conflict',
      currentValue: (current as Record<string, unknown>)[field] ?? null,
    }, { status: 409 });
  }

  await logFieldChange(supabase, {
    tableName: 'trademark_records', rowId: id, field,
    oldValue: prevStored, newValue: stored, changedBy: account?.email ?? 'unknown',
  });

  return NextResponse.json({ ok: true, updatedAt, updatedByName: account?.name ?? null });
}
