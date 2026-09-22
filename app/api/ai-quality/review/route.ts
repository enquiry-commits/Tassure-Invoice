import { NextRequest, NextResponse } from 'next/server';
import { withAutomationRun } from '@/lib/automation-sync';
import { runQualityReviewBatch } from '@/lib/ai-quality/review';

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
  return withAutomationRun(req, 'ai_quality_review', async () => {
    const result = await runQualityReviewBatch(20);
    // "Failed" only means every candidate this run actually tried to judge
    // errored out — zero candidates found (nothing recent to review) or no
    // API key configured are both a normal, successful no-op, not a failure.
    const ok = result.skippedNoKey || result.reviewed > 0 || result.errors === 0;
    return NextResponse.json({ ok, ...result });
  });
}
