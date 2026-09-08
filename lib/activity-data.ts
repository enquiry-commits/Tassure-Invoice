import 'server-only';

import { createAdminClient } from './supabase';
import { pageAll } from './page-all';

// Real behavioral tracking — Vincent, 2026-09-08: "现在每个用户进入系统后
// 的点击操作路径...为什么这个用户每天会打开这个页面，为什么会时常在这个
// 页面操作，为什么每次关注某些特定的更新". Reads/writes user_activity_events
// (scripts/add-user-activity-events.sql) — a table that starts EMPTY and
// only accumulates from the moment it's deployed. Every function here is
// honest about that: a fresh deployment has zero rows, so summaries will
// legitimately be empty until real usage accumulates — never fabricate a
// pattern from no data.
export type ActivityEvent = {
  account_email: string;
  pathname: string;
  event_type: string;
  detail: Record<string, unknown> | null;
  created_at: string;
};

export async function logActivityEvent(account_email: string, pathname: string, eventType: string, detail: Record<string, unknown> | null): Promise<void> {
  const supabase = createAdminClient();
  // Best-effort — a tracking write must never surface as a user-facing
  // error (see app/api/activity/log/route.ts's own comment on this).
  await supabase.from('user_activity_events').insert({
    account_email, pathname: pathname.slice(0, 500), event_type: eventType.slice(0, 100), detail,
  });
}

export type PageVisitStat = { pathname: string; visits: number; lastVisitedAt: string };
export type ActionStat = { eventType: string; count: number; lastAt: string; sampleDetails: (Record<string, unknown> | null)[] };

export type PersonActivitySummary = {
  email: string;
  rangeDays: number;
  totalEvents: number;
  topPages: PageVisitStat[];
  topActions: ActionStat[];
  // Hour-of-day (0-23, Singapore time) distribution of page_view events —
  // enough to answer "does this person mostly work mornings vs afternoons",
  // without over-claiming a reconstructed click sequence from raw rows
  // (this table records discrete events, not a true session/sequence log).
  hourOfDayDistribution: number[];
};

function summarize(events: ActivityEvent[]): { topPages: PageVisitStat[]; topActions: ActionStat[]; hourOfDayDistribution: number[] } {
  const pageCounts = new Map<string, { visits: number; lastVisitedAt: string }>();
  const actionCounts = new Map<string, { count: number; lastAt: string; sampleDetails: (Record<string, unknown> | null)[] }>();
  const hourOfDayDistribution = new Array(24).fill(0);

  for (const e of events) {
    if (e.event_type === 'page_view') {
      const cur = pageCounts.get(e.pathname) ?? { visits: 0, lastVisitedAt: e.created_at };
      cur.visits += 1;
      if (e.created_at > cur.lastVisitedAt) cur.lastVisitedAt = e.created_at;
      pageCounts.set(e.pathname, cur);
      const hour = new Date(e.created_at).toLocaleString('en-US', { timeZone: 'Asia/Singapore', hour: 'numeric', hour12: false });
      const hourNum = parseInt(hour, 10) % 24;
      if (!Number.isNaN(hourNum)) hourOfDayDistribution[hourNum] += 1;
    } else {
      const cur = actionCounts.get(e.event_type) ?? { count: 0, lastAt: e.created_at, sampleDetails: [] };
      cur.count += 1;
      if (e.created_at > cur.lastAt) cur.lastAt = e.created_at;
      if (cur.sampleDetails.length < 5) cur.sampleDetails.push(e.detail);
      actionCounts.set(e.event_type, cur);
    }
  }

  const topPages = [...pageCounts.entries()]
    .map(([pathname, v]) => ({ pathname, ...v }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 10);
  const topActions = [...actionCounts.entries()]
    .map(([eventType, v]) => ({ eventType, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return { topPages, topActions, hourOfDayDistribution };
}

export async function getPersonActivitySummary(email: string, rangeDays = 30): Promise<PersonActivitySummary> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - rangeDays * 86_400_000).toISOString();
  const events = await pageAll<ActivityEvent>(() => supabase
    .from('user_activity_events')
    .select('account_email, pathname, event_type, detail, created_at')
    .eq('account_email', email)
    .gte('created_at', since));
  const { topPages, topActions, hourOfDayDistribution } = summarize(events);
  return { email, rangeDays, totalEvents: events.length, topPages, topActions, hourOfDayDistribution };
}

export type CompanyActivitySummary = {
  rangeDays: number;
  totalEvents: number;
  topPages: PageVisitStat[];
  topActions: ActionStat[];
  byPerson: { email: string; totalEvents: number; topPage: string | null }[];
};

export async function getCompanyActivitySummary(rangeDays = 30): Promise<CompanyActivitySummary> {
  const supabase = createAdminClient();
  const since = new Date(Date.now() - rangeDays * 86_400_000).toISOString();
  const events = await pageAll<ActivityEvent>(() => supabase
    .from('user_activity_events')
    .select('account_email, pathname, event_type, detail, created_at')
    .gte('created_at', since));
  const { topPages, topActions } = summarize(events);

  const byPersonMap = new Map<string, { totalEvents: number; pageCounts: Map<string, number> }>();
  for (const e of events) {
    const entry = byPersonMap.get(e.account_email) ?? { totalEvents: 0, pageCounts: new Map<string, number>() };
    entry.totalEvents += 1;
    if (e.event_type === 'page_view') entry.pageCounts.set(e.pathname, (entry.pageCounts.get(e.pathname) ?? 0) + 1);
    byPersonMap.set(e.account_email, entry);
  }
  const byPerson = [...byPersonMap.entries()]
    .map(([email, v]) => {
      const top = [...v.pageCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      return { email, totalEvents: v.totalEvents, topPage: top ? top[0] : null };
    })
    .sort((a, b) => b.totalEvents - a.totalEvents);

  return { rangeDays, totalEvents: events.length, topPages, topActions, byPerson };
}
