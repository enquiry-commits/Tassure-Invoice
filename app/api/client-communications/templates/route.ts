import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

const EDITABLE_FIELDS = new Set(['name', 'subject_template', 'body_template', 'is_default']);

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type');
  const supabase = createAdminClient();
  let q = supabase.from('email_templates').select('*').order('type').order('is_default', { ascending: false });
  if (type) q = q.eq('type', type);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { type, name, subject_template, body_template } = body;
  if (!type || !name || !subject_template || !body_template) {
    return NextResponse.json({ error: 'type, name, subject_template and body_template required' }, { status: 400 });
  }
  if (!['letter', 'ar', 'soa'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.from('email_templates')
    .insert({ type, name, subject_template, body_template })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(req: NextRequest) {
  const { id, field, value } = await req.json();
  if (!id || !field) return NextResponse.json({ error: 'id and field required' }, { status: 400 });
  if (!EDITABLE_FIELDS.has(field)) return NextResponse.json({ error: 'field not editable' }, { status: 400 });

  const supabase = createAdminClient();
  if (field === 'is_default' && value === true) {
    const { data: row } = await supabase.from('email_templates').select('type').eq('id', id).single();
    if (row) await supabase.from('email_templates').update({ is_default: false }).eq('type', row.type).neq('id', id);
  }
  const { error } = await supabase.from('email_templates').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = createAdminClient();
  const { error } = await supabase.from('email_templates').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
