import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { listConversations, createConversation } from '@/lib/ai-conversations';

// GET: this account's own chat threads, pinned-first (app/my-tasks/page.tsx's
// new sidebar). POST: start a new one — Vincent: "可以New Chat".
export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  try {
    const conversations = await listConversations(account.email);
    return NextResponse.json({ conversations });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  try {
    const conversation = await createConversation(account.email);
    return NextResponse.json({ conversation });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
