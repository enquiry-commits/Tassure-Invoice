import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('email_senders').select('*').order('is_default', { ascending: false }).order('email');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, display_name } = body;
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.from('email_senders')
    .insert({ email, display_name: display_name || null })
    .select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data });
}

export async function PATCH(req: NextRequest) {
  const { id, field, value } = await req.json();
  if (!id || !field) return NextResponse.json({ error: 'id and field required' }, { status: 400 });
  if (!['email', 'display_name', 'is_default'].includes(field)) {
    return NextResponse.json({ error: 'field not editable' }, { status: 400 });
  }

  const supabase = createAdminClient();
  // Only one default sender at a time — clear the others first.
  if (field === 'is_default' && value === true) {
    await supabase.from('email_senders').update({ is_default: false }).neq('id', id);
  }
  const { error } = await supabase.from('email_senders').update({ [field]: value }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const supabase = createAdminClient();
  const { error } = await supabase.from('email_senders').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
