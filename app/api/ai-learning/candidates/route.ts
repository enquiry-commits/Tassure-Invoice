import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { APPROVED_ACCOUNTS, getApprovedAccount } from '@/lib/approved-accounts';
import { analyzeUserActivity, listLearningCandidates } from '@/lib/ai-learning/candidates';
import type { CandidateStatus } from '@/lib/ai-learning/patterns';

const STATUSES = new Set<CandidateStatus>(['observing', 'ready_for_review', 'approved', 'rejected', 'dismissed']);
const STAFF_DIRECTORY = APPROVED_ACCOUNTS.map(({ email, name }) => ({ email, name }));

function resolveTargetEmail(req: NextRequest, account: NonNullable<Awaited<ReturnType<typeof getRequestAccount>>>) {
  const requested = req.nextUrl.searchParams.get('email')?.trim().toLowerCase();
  if (!requested || requested === account.email) return { ok: true as const, email: account.email };
  if (!account.canViewActivityInsights) return { ok: false as const, status: 403, error: 'Your account cannot view another person’s learning candidates.' };
  if (!getApprovedAccount(requested)) return { ok: false as const, status: 404, error: 'No approved account matches that email.' };
  return { ok: true as const, email: requested };
}

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  const target = resolveTargetEmail(req, account);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });
  const requestedStatus = req.nextUrl.searchParams.get('status') as CandidateStatus | null;
  const status = requestedStatus && STATUSES.has(requestedStatus) ? requestedStatus : undefined;
  try {
    const candidates = await listLearningCandidates(target.email, status);
    return NextResponse.json({
      mode: 'controlled', accountEmail: target.email, candidates,
      staffDirectory: account.canViewActivityInsights ? STAFF_DIRECTORY : [],
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  const target = resolveTargetEmail(req, account);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });
  const body = await req.json().catch(() => null) as { days?: number } | null;
  const days = Math.min(Math.max(Number(body?.days) || 30, 7), 180);
  try {
    const candidates = await analyzeUserActivity(target.email, days);
    return NextResponse.json({
      mode: 'controlled', accountEmail: target.email, analyzedDays: days, detected: candidates.length, candidates,
      staffDirectory: account.canViewActivityInsights ? STAFF_DIRECTORY : [],
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 503 });
  }
}
