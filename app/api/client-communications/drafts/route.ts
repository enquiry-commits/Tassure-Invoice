import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { todaySGT } from '@/lib/date';

// GET: cross-campaign search/listing — powers Delivery History (and Billing
// Drafts' per-row sent/drafted tint via fyeMonth/fyeYear). Filters: status,
// type (via joined campaign), fyeMonth/fyeYear (ditto), search (company
// name), limit/offset.
export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const { searchParams } = req.nextUrl;
  const status = searchParams.get('status');
  const type = searchParams.get('type');
  const search = searchParams.get('search');
  const fyeMonth = searchParams.get('fyeMonth');
  const fyeYear = searchParams.get('fyeYear');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '200', 10), 500);

  let q = supabase.from('email_drafts')
    .select('*, email_campaigns!inner(id, type, name, fye_month, fye_year, created_at, email_senders(email, display_name))')
    .order('updated_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  if (type) q = q.eq('email_campaigns.type', type);
  if (fyeMonth) q = q.eq('email_campaigns.fye_month', fyeMonth);
  if (fyeYear) q = q.eq('email_campaigns.fye_year', parseInt(fyeYear, 10));
  if (search) q = q.ilike('company_name', `%${search}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

// PATCH: update a draft's lifecycle status or reviewed fields.
// Optimistic-locked on `version`, matching the pattern the AR workflow sync
// uses — two staff reviewing the same campaign can't silently clobber each
// other's "mark as sent".
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, version, patch, sentByEmail, sentByName } = body as {
    id: number; version: number;
    patch: Partial<{
      status: 'pending' | 'opened' | 'sent' | 'skipped';
      subject: string;
      body: string;
      contact_name: string;
      to_email: string;
      cc_email: string;
    }>;
    sentByEmail?: string; sentByName?: string;
  };
  if (!id || version === undefined || !patch) return NextResponse.json({ error: 'id, version and patch required' }, { status: 400 });

  const supabase = createAdminClient();
  const update: Record<string, unknown> = { ...patch, version: version + 1, updated_at: new Date().toISOString() };
  if (patch.status === 'sent') {
    update.sent_at = new Date().toISOString();
    update.sent_by_email = sentByEmail ?? null;
    update.sent_by_name = sentByName ?? null;
  } else if (patch.status === 'opened') {
    update.opened_at = new Date().toISOString();
    update.opened_by_email = sentByEmail ?? null;
    update.opened_by_name = sentByName ?? null;
  }

  const { data, error } = await supabase.from('email_drafts')
    .update(update).eq('id', id).eq('version', version)
    .select('id, company_id, email_campaigns(fye_month, fye_year)');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: 'Someone else already updated this draft. Refresh and try again.' }, { status: 409 });

  // Vincent, 2026-08-27: he used to manually type "18/8 email" (D/M, the day
  // this went out) into Billing Drafts' Remarks after every real send — write
  // it for him instead of waiting for him to type it, whenever a draft's
  // status actually becomes 'sent' through this route: OutlookStyleSendModal's
  // handleSend (a real, system-confirmed Outlook .Send()) and history/page.tsx's
  // manual "Mark as Sent" fallback (staff confirming a send that happened
  // outside the system) both land here, and both mean the email genuinely
  // went out. email_drafts.company_id is companies.id, NOT ar_reminder.id
  // (confirmed live — they collide on plenty of small ids and point at
  // completely unrelated companies) — the actual AR Reminder row for this
  // exact cycle is company_id + the campaign's own fye_month/fye_year (a
  // letter/soa campaign has neither, so there's nothing to write for those).
  // Sets BOTH billing_remarks and accounts_status, matching the existing
  // mirroring PATCH /api/ar-reminder already does between them (they're one
  // idea shown on two pages, never a date in one and something else in the
  // other) — a second AR/reminder round later just overwrites this with
  // that later date, same as Vincent's own manual habit only ever held one
  // value here, not an accumulating log.
  type CycleRef = { fye_month: string | null; fye_year: number | null };
  const sent = data[0] as { company_id: number | null; email_campaigns: CycleRef | CycleRef[] | null };
  const cycle = Array.isArray(sent.email_campaigns) ? sent.email_campaigns[0] : sent.email_campaigns;
  if (patch.status === 'sent' && sent.company_id && cycle?.fye_month && cycle?.fye_year) {
    const [, mm, dd] = todaySGT().split('-');
    const remark = `${parseInt(dd, 10)}/${parseInt(mm, 10)} email`;
    await supabase.from('ar_reminder').update({
      billing_remarks: remark,
      accounts_status: remark,
      updated_by_email: 'system:draft-send',
      updated_by_name: 'Auto (email sent)',
    }).eq('company_id', sent.company_id).eq('fye_month', cycle.fye_month).eq('fye_year', cycle.fye_year);
  }

  return NextResponse.json({ ok: true });
}

// DELETE: remove a duplicate/stray Email Activity record. This only removes
// the local audit row -- it has no effect on Outlook (nothing is ever sent
// from here) or on QuickBooks invoices.
export async function DELETE(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('email_drafts').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
