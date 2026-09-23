import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { withAutomationRun } from '@/lib/automation-sync';
import { computeReportsData } from '@/app/api/reports/route';
import { generateReportsNarrative, ACTIVE_NARRATIVE_MODEL } from '@/lib/reports-narrative';

// GET /api/reports/narrative-cron — the ONLY thing that ever calls
// generateReportsNarrative() now. Cron-only for the scheduled run (see
// proxy.ts's CRON_PATHS + vercel.json's weekly schedule), same
// withAutomationRun wrapper every other scheduled job in this app uses —
// PLUS a manual trigger reachable from the Reports page's own refresh
// button, Vincent-only (see the auth check below).
//
// Added 2026-09-23 per Vincent: "为了不要浪费Token，这个AI Analysis，一周
// 只做一次更新描述，不能refresh, 并且这个更新是按照每星期一早上6点更新" (to
// avoid wasting tokens, update once a week only, no manual refresh, every
// Monday 6am SGT). His own immediate follow-up softened "no manual refresh"
// to "no manual refresh for anyone but me": "这样有一点不方便，这样我觉得
// 保留那个 refresh 按钮给我，但是其他人是看不到的...只有Vincent可以选择
// 强制 refresh". app/api/reports/narrative/route.ts — the page's own read
// endpoint — stays a PURE cache read with zero generation path; this route
// remains the only writer to reports_narrative_cache, whether triggered by
// the cron or by Vincent's own click — each run INSERTS a new row rather
// than updating one in place, so whatever's currently cached stays exactly
// as-is (Vincent: "生成出来的内容就不变了，直到下次更新显示") until the
// next run, cron or manual, actually completes. vercel.json's schedule is
// "0 22 * * 0" (22:00 UTC Sunday = 06:00 SGT Monday, the same UTC+8
// conversion every other cron in that file already uses).
export const maxDuration = 120;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

async function runReportsNarrativeCron(): Promise<NextResponse> {
  const data = await computeReportsData();
  const narrative = await generateReportsNarrative(data);
  const now = new Date().toISOString();
  const supabase = createAdminClient();
  const { error: insertErr } = await supabase
    .from('reports_narrative_cache')
    .insert({ narrative: JSON.stringify(narrative), model: ACTIVE_NARRATIVE_MODEL, generated_at: now });
  if (insertErr) return NextResponse.json({ ok: false, error: insertErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, generatedAt: now, insightCount: narrative.insights.length });
}

export async function GET(req: NextRequest) {
  // Cron requests carry the CRON_SECRET bearer token (proxy.ts already lets
  // these through before any session check); anything else must be a real
  // logged-in session AND specifically Vincent — same hardcoded-to-Vincent
  // check app/api/automation/health/route.ts already uses, not a generic
  // `account.admin` flag, since Vincent asked for himself specifically
  // ("只有Vincent可以选择强制 refresh"), not "any admin."
  const isCron = req.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`;
  if (!isCron) {
    const account = await getRequestAccount(req);
    if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
    if (account.email.toLowerCase() !== 'vincent@tassure.com') {
      return NextResponse.json({ error: 'Only Vincent can manually regenerate this.' }, { status: 403 });
    }
  }
  return withAutomationRun(req, 'reports_narrative', () => runReportsNarrativeCron());
}
