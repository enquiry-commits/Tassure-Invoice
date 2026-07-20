import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

// GET: cross-campaign search/listing — powers Delivery History. Filters:
// status, type (via joined campaign), search (company name), limit/offset.
export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status');
  const type = searchParams.get('type');
  const search = searchParams.get('search');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '200', 10), 500);

  let q = supabase.from('email_drafts')
    .select('*, email_campaigns!inner(id, type, name, fye_month, fye_year, created_at)')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('email_campaigns.type', type);
  if (search) q = q.ilike('company_name', `%${search}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// PATCH: update a draft's status (sent/skipped) or edited body/subject.
// Optimistic-locked on `version`, matching the pattern the AR workflow sync
// uses — two staff reviewing the same campaign can't silently clobber each
// other's "mark as sent".
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, version, patch, sentByEmail, sentByName } = body as {
    id: number; version: number;
    patch: Partial<{ status: 'pending' | 'sent' | 'skipped'; subject: string; body: string; to_email: string; cc_email: string }>;
    sentByEmail?: string; sentByName?: string;
  };
  if (!id || version === undefined || !patch) return NextResponse.json({ error: 'id, version and patch required' }, { status: 400 });

  const supabase = createAdminClient();
  const update: Record<string, unknown> = { ...patch, version: version + 1, updated_at: new Date().toISOString() };
  if (patch.status === 'sent') {
    update.sent_at = new Date().toISOString();
    update.sent_by_email = sentByEmail ?? null;
    update.sent_by_name = sentByName ?? null;
  }

  const { data, error } = await supabase.from('email_drafts')
    .update(update).eq('id', id).eq('version', version).select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Someone else already updated this draft. Refresh and try again.' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
