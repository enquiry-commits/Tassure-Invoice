import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { withAutomationRun, replaceAutomationExceptions, type AutomationRun } from '@/lib/automation-sync';
import { getRequestAccount } from '@/lib/request-account';
import { SG_NEWS_SOURCES } from '@/lib/sg-news-sources';
import { fetchAndExtractSource } from '@/lib/sg-news-fetch';
import { generateDailyDigest } from '@/lib/sg-news-digest';
import { runSgNewsSync } from '@/lib/sg-news-run';
import { todaySGT } from '@/lib/date';
import { scheduledJobUsage } from '@/lib/ai/job-usage';
import type { AiUsageTag } from '@/lib/ai/usage';

// GET /api/sg-news/sync — the daily "SG Latest News" job (Vincent,
// 2026-09-23: "每天早上走一轮...每天要写出一份报告出来给我"). Cron-only in
// practice (see proxy.ts's CRON_PATHS + vercel.json), same
// withAutomationRun wrapper every other daily job in this app uses.
//
// The work itself — fetch each source, decide what is new, write the day's report, THEN store the new
// items, raise silent sources — is lib/sg-news-run.ts, so its order and its failure paths are tested
// with fakes (test-sg-news.ts). This file only wires in the real collaborators.
//
// Real work budget: 9 sources x (Playwright render + 1 Claude extraction
// call) + 1 Claude digest call. Each Playwright fetch alone can take
// 10-20s with the render-settle wait (lib/sg-news-fetch.ts), so this
// genuinely needs Vercel's full ceiling, not the 60s soa_owners/audit gets
// by with — run sequentially, not in parallel, deliberately: 9 concurrent
// Chromium launches on one Vercel invocation is exactly the kind of thing
// docs/INVARIANTS.md INV-CRON-013 already burned this app on once (shared
// /tmp exhaustion) — sequential is slower but the proven-safe shape.
export const maxDuration = 280;
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

async function syncSgNews(run: AutomationRun, usage: AiUsageTag): Promise<NextResponse> {
  const result = await runSgNewsSync({
    db: createAdminClient(),
    sources: SG_NEWS_SOURCES,
    today: todaySGT(),
    now: Date.now,
    heartbeat: () => run.heartbeat(),
    fetchSource: source => fetchAndExtractSource(source, usage),
    digest: items => generateDailyDigest(items, usage),
    raiseExceptions: (type, items) => replaceAutomationExceptions('sg_news_sync', type, items),
  });
  return NextResponse.json(result.body, { status: result.status });
}

// proxy.ts lets a request with the exact CRON_SECRET bearer straight through
// and otherwise only checks "signed in as ANY approved account" — it never
// guards API routes by permission. So the manual "手动运行一次" trigger must be
// gated here: without this, any signed-in staff account could start a full
// run (9 Playwright fetches + Claude calls) by opening this URL, despite the
// page itself being Vincent-only. Compared against the real secret, not just
// "has a Bearer header" (automationTrigger()'s test), so a made-up
// Authorization header cannot skip the account check.
function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isCronRequest(req)) {
    const account = await getRequestAccount(req);
    if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
    if (!account.canViewSgNews) return NextResponse.json({ error: 'Your account cannot run SG Latest News.' }, { status: 403 });
  }
  const usage = await scheduledJobUsage(req, 'sg_news');
  return withAutomationRun(req, 'sg_news_sync', run => syncSgNews(run, usage), 15);
}
