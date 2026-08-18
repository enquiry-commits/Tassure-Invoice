import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getApprovedAccount } from '@/lib/approved-accounts';

// POST: called by the local Tassure Draft Helper the moment it observes an
// Outlook ItemSend event for a MailItem it created (see draft-helper/app.py's
// OnItemSend listener) — this is the ONLY automatic path to status 'sent';
// everywhere else in the app it's still a human clicking "Mark as Sent".
// Unauthenticated like the sibling PATCH route above it (a local background
// service, not a browser session) and idempotent by design: already-final
// drafts (sent/skipped) are left alone rather than overwritten, since a
// human confirmation or an intentional skip should never be silently undone
// by a same-item duplicate/late ItemSend report.
export async function POST(req: NextRequest) {
  const { id, senderEmail } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: current, error: fetchError } = await supabase
    .from('email_drafts')
    .select('id, version, status')
    .eq('id', id)
    .maybeSingle();
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
  if (current.status === 'sent' || current.status === 'skipped') {
    return NextResponse.json({ ok: true, alreadyFinal: true });
  }

  const account = getApprovedAccount(senderEmail);
  const { data, error } = await supabase
    .from('email_drafts')
    .update({
      status: 'sent',
      sent_at: new Date().toISOString(),
      sent_by_email: senderEmail ?? null,
      sent_by_name: account?.name ?? null,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('version', current.version)
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // A concurrent update (e.g. a human clicked "Mark as Sent" at the same
  // instant) lost the race — that's fine, the row already reflects sent.
  if (!data?.length) return NextResponse.json({ ok: true, raced: true });
  return NextResponse.json({ ok: true });
}
