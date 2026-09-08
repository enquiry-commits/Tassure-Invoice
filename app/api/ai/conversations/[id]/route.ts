import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { getConversationOwner, renameConversation, setConversationPinned, deleteConversation } from '@/lib/ai-conversations';

// PATCH { title? , pinned? }: rename and/or toggle pin — Vincent: "可以
// Pin/ Pinned". DELETE: remove a thread (its messages cascade). Both
// ownership-checked against the real session — never trust the id alone.
async function assertOwner(req: NextRequest, id: number) {
  const account = await getRequestAccount(req);
  if (!account) return { error: NextResponse.json({ error: 'Approved login account required' }, { status: 401 }) };
  const owner = await getConversationOwner(id);
  if (!owner) return { error: NextResponse.json({ error: 'Conversation not found' }, { status: 404 }) };
  if (owner !== account.email) return { error: NextResponse.json({ error: 'Not your conversation' }, { status: 403 }) };
  return { account };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const check = await assertOwner(req, id);
  if (check.error) return check.error;

  const body = await req.json().catch(() => ({})) as { title?: string; pinned?: boolean };
  try {
    if (typeof body.title === 'string' && body.title.trim()) await renameConversation(id, body.title.trim().slice(0, 200));
    if (typeof body.pinned === 'boolean') await setConversationPinned(id, body.pinned);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const check = await assertOwner(req, id);
  if (check.error) return check.error;

  try {
    await deleteConversation(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
