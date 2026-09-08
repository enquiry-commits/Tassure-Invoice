import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { logActivityEvent } from '@/lib/activity-data';

// Fire-and-forget behavioral-tracking sink — components/AppShell.tsx posts
// here on every route change (event_type: 'page_view'), and a handful of
// pages post a named key action here too (lib/activity-client.ts's own
// logActivity() helper — see its call sites for the current list).
//
// Deliberately tolerant of everything: an unauthenticated/expired session,
// a malformed body, or a DB error all resolve 200 rather than surfacing an
// error to the caller — a tracking call must never interrupt or fail the
// actual user-facing action it's attached to (e.g. Generate Invoice still
// has to succeed even if this logging call has a problem). This is the one
// deliberate exception in this codebase to "never swallow an error
// silently" — tracking is observability, not business logic, and its own
// failure has no correctness consequence for anything else.
export async function POST(req: NextRequest) {
  try {
    const account = await getRequestAccount(req);
    if (!account) return NextResponse.json({ ok: true });

    const body = await req.json().catch(() => null) as { eventType?: string; pathname?: string; detail?: Record<string, unknown> } | null;
    if (!body?.eventType || !body?.pathname) return NextResponse.json({ ok: true });

    await logActivityEvent(account.email, body.pathname, body.eventType, body.detail ?? null);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
