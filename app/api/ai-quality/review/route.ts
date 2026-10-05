import { NextRequest, NextResponse } from 'next/server';
import { withAutomationRun } from '@/lib/automation-sync';
import { runQualityReviewBatch } from '@/lib/ai-quality/review';
import { scheduledJobUsage } from '@/lib/ai/job-usage';
import { getRequestAccount } from '@/lib/request-account';

/**
 * Daily unattended AI quality spot-check — item 6 of Vincent's "AI Agent/My
 * Tasks 少一些东西" review (2026-09-22). Samples up to 20 recent real
 * assistant replies staff never asked to have reviewed, has Claude judge
 * each against a fixed rubric (see lib/ai-quality/review.ts's own honest
 * scope note), and writes every verdict — pass or flag — to
 * ai_quality_reviews for the /ai-quality review page. Same
 * withAutomationRun wrapper as every other cron source, so a stuck/failing
 * run shows up on the Automation Health dashboard like any other source
 * rather than failing silently off-screen.
 */
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  // proxy.ts lets ANY signed-in account reach an API route, and every run
  // spends real money (one Claude call per reply), so the browser case is
  // gated here like app/api/sg-news/sync/route.ts (INV-CRON-018): the exact
  // CRON_SECRET for the nightly cron, otherwise an admin account — the
  // "立即抽查" button lives on /ai-quality, itself admin-only.
  const secret = process.env.CRON_SECRET;
  const isCron = !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
  if (!isCron) {
    const account = await getRequestAccount(req);
    if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
    if (!account.admin) return NextResponse.json({ error: 'System administrator access required' }, { status: 403 });
  }
  const usage = await scheduledJobUsage(req, 'ai_quality_review');
  return withAutomationRun(req, 'ai_quality_review', async () => {
    const result = await runQualityReviewBatch(20, usage);
    // "Failed" only means every candidate this run actually tried to judge
    // errored out — zero candidates found (nothing recent to review) or no
    // API key configured are both a normal, successful no-op, not a failure.
    const ok = result.skippedNoKey || result.reviewed > 0 || result.errors === 0;
    // A failed run says why: withAutomationRun records `error` as the run's
    // failure message on Automation Health.
    return NextResponse.json({ ok, ...result, ...(ok ? {} : { error: result.errorSamples[0] ?? 'Every judge call failed.' }) });
  });
}
