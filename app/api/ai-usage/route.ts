import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { getRequestAccount } from '@/lib/request-account';
import { APPROVED_ACCOUNTS } from '@/lib/approved-accounts';
import { isMonthKey, monthRangeSgt, monthsWithData, sgtMonthKey, summarizeUsage, usageWindowStarts, type UsageEventRow } from '@/lib/ai/usage-report';

// GET /api/ai-usage — Admin › AI Usage's numbers (docs/INVARIANTS.md
// INV-AI-010): every person's AI token usage and estimated USD for today,
// the last 7 days and this month (Singapore time), per feature, plus the
// latest calls. Read straight from ai_usage_events on every request — the
// page polls it, so a call made a few seconds ago is already here.
// Vincent only ("只有我"): APIs are not gated by department, so the check
// lives here as well as in proxy.ts's page rule.
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

// Safety cap on one month's call list sent to the page (a month is far below this today).
const MAX_MONTH_ROWS = 5000;

const COLUMNS = 'id, created_at, actor_email, subject_email, feature, trigger, step, turn_key, provider, model, input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, web_search_requests, cost_usd';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewAiUsage) return NextResponse.json({ error: 'Your account cannot view AI usage.' }, { status: 403 });

  const supabase = createAdminClient();
  // An explicit probe first: a missing table must say so, not look like "no usage yet".
  const probe = await supabase.from('ai_usage_events').select('id', { count: 'exact', head: true });
  if (probe.error) {
    if (probe.error.code === 'PGRST205' || probe.error.code === '42P01') {
      return NextResponse.json({ tableMissing: true, error: 'The AI usage table has not been created yet — run scripts/add-ai-usage-events.sql in the Supabase SQL editor.' });
    }
    return NextResponse.json({ error: probe.error.message }, { status: 500 });
  }

  const now = new Date();
  const starts = usageWindowStarts(now);
  const since = new Date(Math.min(starts.week.getTime(), starts.month.getTime())).toISOString();
  // The call list is read by month ("2026 - Sep"); default = the current Singapore month.
  const requested = req.nextUrl.searchParams.get('month');
  const month = isMonthKey(requested) ? requested : sgtMonthKey(now);
  const range = monthRangeSgt(month)!;
  try {
    const [rows, monthCalls, first] = await Promise.all([
      pageAll(() => supabase.from('ai_usage_events').select(COLUMNS).gte('created_at', since).order('id', { ascending: true })) as Promise<UsageEventRow[]>,
      pageAll(() => supabase.from('ai_usage_events').select(COLUMNS).gte('created_at', range.start.toISOString()).lt('created_at', range.end.toISOString()).order('id', { ascending: true })) as Promise<UsageEventRow[]>,
      supabase.from('ai_usage_events').select('created_at').order('id', { ascending: true }).limit(1),
    ]);
    if (first.error) throw new Error(first.error.message);
    const firstRecordedAt = first.data?.[0]?.created_at ?? null;
    return NextResponse.json({
      generatedAt: now.toISOString(),
      totalRows: probe.count ?? 0,
      firstRecordedAt,
      summary: summarizeUsage(rows, now),
      month,
      months: monthsWithData(firstRecordedAt, now),
      monthCalls: monthCalls.slice(-MAX_MONTH_ROWS),
      monthCallsTruncated: monthCalls.length > MAX_MONTH_ROWS,
      names: Object.fromEntries(APPROVED_ACCOUNTS.map(a => [a.email.toLowerCase(), a.name])),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
