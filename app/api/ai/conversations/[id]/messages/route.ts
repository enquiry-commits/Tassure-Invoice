import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { getConversationOwner, listMessages } from '@/lib/ai-conversations';

// GET this conversation's own message history, ownership-checked — loaded
// when My Tasks' new sidebar switches to a previously-saved thread.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = parseInt(idParam, 10);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  const owner = await getConversationOwner(id);
  if (!owner) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  if (owner !== account.email) return NextResponse.json({ error: 'Not your conversation' }, { status: 403 });

  try {
    const messages = await listMessages(id);
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
