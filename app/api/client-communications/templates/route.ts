import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { SOA_REMINDER_TEMPLATES } from '@/lib/soa-reminder-progress';

const EDITABLE_FIELDS = new Set(['name', 'subject_template', 'body_template', 'is_default']);
const SOA_TEMPLATE_NAMES = new Set(SOA_REMINDER_TEMPLATES.map(t => t.name));

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');
  const supabase = createAdminClient();
  let q = supabase.from('email_templates').select('*').order('type').order('is_default', { ascending: false });
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Keep old SOA template rows for historical campaign foreign keys, but
  // expose only the real 1st/2nd/3rd sequence in every picker/settings page.
  const visible = (data ?? []).filter(row => row.type !== 'soa' || SOA_TEMPLATE_NAMES.has(row.name));
  visible.sort((a, b) => {
    if (a.type !== 'soa' || b.type !== 'soa') return 0;
    return (soaReminderStageFromName(a.name) ?? 99) - (soaReminderStageFromName(b.name) ?? 99);
  });
  return NextResponse.json({ data: visible });
}

function soaReminderStageFromName(name: string): number | null {
  return SOA_REMINDER_TEMPLATES.find(t => t.name === name)?.stage ?? null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type, name, subject_template, body_template } = body;
  if (!type || !name || !subject_template || !body_template) {
    return NextResponse.json({ error: 'type, name, subject_template and body_template required' }, { status: 400 });
  }
  if (!['letter', 'ar', 'soa'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  if (type === 'soa' && !SOA_TEMPLATE_NAMES.has(name)) {
    return NextResponse.json({ error: 'SOA supports only 1st Reminder, 2nd Reminder and 3rd Reminder.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  if (type === 'soa') {
    const { data: duplicates, error: duplicateError } = await supabase.from('email_templates')
      .select('id').eq('type', 'soa').eq('name', name).limit(1);
    if (duplicateError) return NextResponse.json({ error: duplicateError.message }, { status: 500 });
    if (duplicates?.length) return NextResponse.json({ error: `${name} already exists.` }, { status: 409 });
  }
  const { data, error } = await supabase.from('email_templates')
    .insert({ type, name, subject_template, body_template })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(req: NextRequest) {
  const { id, field, value, previousValue } = await req.json();
  if (!id || !field) return NextResponse.json({ error: 'id and field required' }, { status: 400 });
  if (!EDITABLE_FIELDS.has(field)) return NextResponse.json({ error: 'field not editable' }, { status: 400 });

  const supabase = createAdminClient();
  if (field === 'name') {
    const { data: existing } = await supabase.from('email_templates').select('type, name').eq('id', id).maybeSingle();
    if (existing?.type === 'soa' && value !== existing.name) {
      return NextResponse.json({ error: 'SOA Reminder template names are fixed; edit the subject or body instead.' }, { status: 400 });
    }
  }
  if (field === 'is_default' && value === true) {
    const { data: row } = await supabase.from('email_templates').select('type').eq('id', id).single();
    if (row) await supabase.from('email_templates').update({ is_default: false }).eq('type', row.type).neq('id', id);
  }

  // Optimistic-concurrency check (Vincent: two staff editing the same
  // template field around the same time could otherwise silently overwrite
  // each other) — optional so is_default's own toggle-clear above and any
  // caller that doesn't track a previous value keep working unconditionally.
  let updateQuery = supabase.from('email_templates').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id);
  if (previousValue !== undefined) {
    updateQuery = previousValue === null ? updateQuery.is(field, null) : updateQuery.filter(field, 'eq', previousValue);
  }
  const { data, error } = await updateQuery.select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (previousValue !== undefined && !data?.length) {
    return NextResponse.json({ error: 'conflict' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = createAdminClient();
  const { data: existing } = await supabase.from('email_templates').select('type, name').eq('id', id).maybeSingle();
  if (existing?.type === 'soa' && SOA_TEMPLATE_NAMES.has(existing.name)) {
    return NextResponse.json({ error: 'The 1st/2nd/3rd SOA Reminder templates are required and cannot be deleted.' }, { status: 400 });
  }
  const { error } = await supabase.from('email_templates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
