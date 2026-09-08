import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { resolveViewAsAccount } from '@/lib/approved-accounts';
import { listConversations, createConversation } from '@/lib/ai-conversations';

// GET: the EFFECTIVE account's chat threads, pinned-first (app/my-tasks/
// page.tsx's sidebar) — normally the caller's own, but see ?viewAs= below.
// POST: start a new one — Vincent: "可以New Chat".
//
// 2026-09-08: both now accept ?viewAs=<email>, extending "View As" (until
// now Tasks-tab-only) to chat — Vincent: "不只是还原，而且我作为最大的
// ADMIN 甚至是要可以带入到那个员工的身份，去开一个NEW CHAT 在她的记录...
// 通过View as". This is full identity substitution, not a read-only
// preview: a POST with ?viewAs= creates a conversation OWNED by the
// target, which becomes part of their real history — gated on the same
// canViewAsOthers permission the Tasks-tab picker already uses (see
// lib/approved-accounts.ts's resolveViewAsAccount), enforced server-side
// here regardless of what the frontend picker currently shows.
export async function GET(req: NextRequest) {
  const realAccount = await getRequestAccount(req);
  if (!realAccount) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  const resolution = resolveViewAsAccount(realAccount, req.nextUrl.searchParams.get('viewAs'));
  if (!resolution.ok) return NextResponse.json({ error: resolution.message }, { status: resolution.status });
  try {
    const conversations = await listConversations(resolution.account.email);
    return NextResponse.json({
      conversations,
      viewingAs: resolution.viewingAs ? { email: resolution.account.email, name: resolution.account.name } : null,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const realAccount = await getRequestAccount(req);
  if (!realAccount) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  const resolution = resolveViewAsAccount(realAccount, req.nextUrl.searchParams.get('viewAs'));
  if (!resolution.ok) return NextResponse.json({ error: resolution.message }, { status: resolution.status });
  try {
    const conversation = await createConversation(resolution.account.email);
    return NextResponse.json({ conversation });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
