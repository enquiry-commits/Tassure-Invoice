import { NextRequest, NextResponse } from 'next/server';
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
    supabase.from('sg_news_daily_reports').select('report_date, new_items_count').order('report_date', { ascending: false }).limit(30),
    supabase.from('sg_news_sync_state').select('*').order('source', { ascending: true }),
  ]);

  return NextResponse.json({
    today: todaySGT(),
    report: report ?? null,
    history: history ?? [],
    syncState: syncState ?? [],
  });
}
