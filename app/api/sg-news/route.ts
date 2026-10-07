import { NextRequest, NextResponse } from 'next/server';
import { findSourceByLabel } from '@/lib/sg-news-sources';
import { normalizeNewsTitle } from '@/lib/sg-news-links';
import { pageAll } from '@/lib/page-all';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { todaySGT } from '@/lib/date';

// GET /api/sg-news — backs app/sg-news/page.tsx. Gated on canViewSgNews,
// same pattern app/api/reports/route.ts uses for canViewReports — this is
// the real permission boundary (proxy.ts's own middleware block on the
// PAGE path is the other half, for direct URL navigation).
//
// ?date=YYYY-MM-DD reads one specific day's report (for the history list);
// no param reads the most recent report on file, which may not be today's
// if the cron hasn't run yet today.
//
// The history list (the page's row of date tabs) covers only the latest
// HISTORY_DAYS calendar days, today included — Vincent, 2026-10-05: "这边只
// 保留最新7天的记录就好". Older reports stay in sg_news_daily_reports (nothing
// is deleted); they are just no longer listed.
const HISTORY_DAYS = 7;

function historyStartDate(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (HISTORY_DAYS - 1));
  return d.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewSgNews) return NextResponse.json({ error: 'Your account cannot view SG Latest News.' }, { status: 403 });

  const supabase = createAdminClient();
  const dateParam = req.nextUrl.searchParams.get('date');

  const reportQuery = supabase.from('sg_news_daily_reports').select('*');
  const { data: report, error: reportErr } = await (dateParam
    ? reportQuery.eq('report_date', dateParam).maybeSingle()
    : reportQuery.order('report_date', { ascending: false }).limit(1).maybeSingle());
  if (reportErr) {
    const hint = /sg_news_daily_reports/.test(reportErr.message) ? ' — run scripts/add-sg-news-monitor.sql in the Supabase SQL editor first' : '';
    return NextResponse.json({ error: reportErr.message + hint }, { status: 503 });
  }

  const [{ data: history }, { data: syncState }] = await Promise.all([
    supabase.from('sg_news_daily_reports').select('report_date, new_items_count').gte('report_date', historyStartDate(todaySGT())).order('report_date', { ascending: false }).limit(HISTORY_DAYS),
    supabase.from('sg_news_sync_state').select('*').order('source', { ascending: true }),
  ]);

  // Older reports were generated before links were collected: resolve each item's url from the
  // stored item (same source + normalised title) and always give the source's listing page as
  // a fallback, so every card has something real to open. Paged: the table grows by dozens of
  // rows a day and a plain select stops at 1000 rows (docs/INVARIANTS.md INV-DATA-066), which would
  // silently drop links. The card's source text is the model's own wording, so it is looked up
  // tolerantly (findSourceByLabel), not by exact name.
  let enriched = report ?? null;
  if (enriched?.report) {
    // A failed read must not take the report down with it: the cards then fall back to their source page,
    // exactly as they did before the links existed.
    let stored: { source: string; item_hash: string; url: string }[] = [];
    try {
      stored = await pageAll(() => supabase.from('sg_news_items').select('source, item_hash, url').not('url', 'is', null)) as { source: string; item_hash: string; url: string }[];
    } catch (err) {
      console.error('GET /api/sg-news: stored article links unavailable —', err);
    }
    const urlByKey = new Map(stored.map(r => [`${r.source}|${r.item_hash}`, r.url]));
    const withLinks = (it: { source: string; title: string; url: string | null }) => {
      const src = findSourceByLabel(it.source);
      return { ...it, url: it.url ?? (src ? urlByKey.get(`${src.key}|${normalizeNewsTitle(it.title)}`) ?? null : null), sourcePageUrl: src?.url ?? null };
    };
    enriched = { ...enriched, report: { ...enriched.report, policyItems: (enriched.report.policyItems ?? []).map(withLinks), newsItems: (enriched.report.newsItems ?? []).map(withLinks) } };
  }

  return NextResponse.json({
    today: todaySGT(),
    report: enriched,
    history: history ?? [],
    syncState: syncState ?? [],
  });
}
