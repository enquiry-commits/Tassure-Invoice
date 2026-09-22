import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { recordHumanVerdict } from '@/lib/ai-quality/review';

const VERDICTS = new Set(['confirmed_issue', 'false_positive']);

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.admin) return NextResponse.json({ error: 'System administrator access required' }, { status: 403 });
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: 'Invalid review id' }, { status: 400 });
  const body = await req.json().catch(() => null) as { verdict?: string; note?: string } | null;
  if (!body?.verdict || !VERDICTS.has(body.verdict)) return NextResponse.json({ error: 'Invalid human verdict' }, { status: 400 });
  try {
    const review = await recordHumanVerdict({
      id, actorEmail: account.email,
      verdict: body.verdict as 'confirmed_issue' | 'false_positive',
      note: body.note,
    });
    return NextResponse.json({ review });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
