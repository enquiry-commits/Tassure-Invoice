import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import {
  getLearningCandidate,
  reviewLearningCandidate,
  type ReviewDecision,
} from '@/lib/ai-learning/candidates';

const DECISIONS = new Set<ReviewDecision>(['approve', 'reject', 'dismiss', 'reopen']);

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid candidate id' }, { status: 400 });
  const body = await req.json().catch(() => null) as { decision?: ReviewDecision; content?: string; note?: string } | null;
  if (!body?.decision || !DECISIONS.has(body.decision)) return NextResponse.json({ error: 'Invalid review decision' }, { status: 400 });

  try {
    const candidate = await getLearningCandidate(id);
    if (!candidate) return NextResponse.json({ error: 'Learning candidate not found' }, { status: 404 });
    // Personal inferred memory belongs to the user. Other managers may inspect
    // activity, but only the owner or Vincent's explicit system-admin account
    // may approve/reject something that could later influence that user.
    if (candidate.account_email !== account.email && !account.admin) {
      return NextResponse.json({ error: 'Only the candidate owner or system administrator may review it.' }, { status: 403 });
    }
    const updated = await reviewLearningCandidate({
      candidate,
      actorEmail: account.email,
      decision: body.decision,
      content: body.content,
      note: body.note,
    });
    return NextResponse.json({ mode: 'shadow', candidate: updated });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
