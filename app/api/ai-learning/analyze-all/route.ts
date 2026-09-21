import { NextRequest, NextResponse } from 'next/server';
import { withAutomationRun } from '@/lib/automation-sync';
import { APPROVED_ACCOUNTS } from '@/lib/approved-accounts';
import { analyzeUserActivity } from '@/lib/ai-learning/candidates';
import { analyzeUserConversations } from '@/lib/ai-learning/conversations';

/**
 * Daily unattended AI Learning pass — Vincent, 2026-09-08: "我希望AI可以
 * 自主学习...最好是在我没有在线的时候，它也能不断的在跑，在分析在研究，
 * 运行". Runs both activity-pattern analysis and saved My Tasks
 * conversation analysis for every approved account, using the same 30-day
 * window and functions as the on-demand "Analyze" button on /ai-learning,
 * so the unattended and manual paths cannot disagree. Their shared
 * auto-approval logic (confidence >= 0.9 AND distinct_days >= 5) is what
 * actually lets this run unattended without needing Vincent to review
 * every result; anything short of that bar still lands in the human
 * queue exactly as before.
 *
 * One account's failure must never stop the rest — collected per-account,
 * not thrown, so a single bad row or model response doesn't silently starve
 * every other person's analysis for the day.
 */
export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return withAutomationRun(req, 'ai_learning', async () => {
    const results: { email: string; detected: number; conversationDetected: number; autoApproved: number; error?: string }[] = [];
    // OpenAI extraction is the slowest part. Process a few accounts at a
    // time so a full staff pass stays within the automation window without
    // producing an unbounded burst of model requests.
    for (let offset = 0; offset < APPROVED_ACCOUNTS.length; offset += 3) {
      const batch = APPROVED_ACCOUNTS.slice(offset, offset + 3);
      const batchResults = await Promise.all(batch.map(async account => {
        try {
          const [activity, conversation] = await Promise.all([
            analyzeUserActivity(account.email, 30),
            analyzeUserConversations(account.email, 30).catch(() => []),
          ]);
          const candidates = [...activity, ...conversation];
          return {
            email: account.email,
            detected: candidates.length,
            conversationDetected: conversation.length,
            autoApproved: candidates.filter(c => c.status === 'approved' && c.reviewed_by === 'system:ai-learning-auto').length,
          };
        } catch (err) {
          return { email: account.email, detected: 0, conversationDetected: 0, autoApproved: 0, error: err instanceof Error ? err.message : String(err) };
        }
      }));
      results.push(...batchResults);
    }
    const failed = results.filter(r => r.error);
    return NextResponse.json({
      ok: failed.length < results.length, // at least one account succeeded
      accountsProcessed: results.length,
      totalDetected: results.reduce((sum, r) => sum + r.detected, 0),
      totalConversationDetected: results.reduce((sum, r) => sum + r.conversationDetected, 0),
      totalAutoApproved: results.reduce((sum, r) => sum + r.autoApproved, 0),
      failedAccounts: failed.map(r => ({ email: r.email, error: r.error })),
    });
  });
}
