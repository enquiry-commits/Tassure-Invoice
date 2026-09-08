import { NextRequest, NextResponse } from 'next/server';
import { withAutomationRun } from '@/lib/automation-sync';
import { APPROVED_ACCOUNTS } from '@/lib/approved-accounts';
import { analyzeUserActivity } from '@/lib/ai-learning/candidates';

/**
 * Daily unattended AI Learning pass — Vincent, 2026-09-08: "我希望AI可以
 * 自主学习...最好是在我没有在线的时候，它也能不断的在跑，在分析在研究，
 * 运行". Runs analyzeUserActivity() (lib/ai-learning/candidates.ts) for
 * every approved account, same 30-day window the on-demand "Analyze"
 * button on /ai-learning uses — same function, so this can never disagree
 * with what a manual click would produce. That function's own
 * auto-approval logic (confidence >= 0.9 AND distinct_days >= 5) is what
 * actually lets this run unattended without needing Vincent to review
 * every result; anything short of that bar still lands in the human
 * queue exactly as before.
 *
 * One account's failure must never stop the rest — collected per-account,
 * not thrown, so a single bad row of activity data doesn't silently
 * starve every other person's analysis for the day.
 */
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'ai_learning', async () => {
    const results: { email: string; detected: number; autoApproved: number; error?: string }[] = [];
    for (const account of APPROVED_ACCOUNTS) {
      try {
        const candidates = await analyzeUserActivity(account.email, 30);
        results.push({
          email: account.email,
          detected: candidates.length,
          autoApproved: candidates.filter(c => c.status === 'approved' && c.reviewed_by === 'system:ai-learning-auto').length,
        });
      } catch (err) {
        results.push({ email: account.email, detected: 0, autoApproved: 0, error: err instanceof Error ? err.message : String(err) });
      }
    }
    const failed = results.filter(r => r.error);
    return NextResponse.json({
      ok: failed.length < results.length, // at least one account succeeded
      accountsProcessed: results.length,
      totalDetected: results.reduce((sum, r) => sum + r.detected, 0),
      totalAutoApproved: results.reduce((sum, r) => sum + r.autoApproved, 0),
      failedAccounts: failed.map(r => ({ email: r.email, error: r.error })),
    });
  });
}
