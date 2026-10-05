// The AI usage page's numbers (app/ai-usage, docs/INVARIANTS.md INV-AI-010):
// per person and per feature for today / the last 7 days / this month, in
// Singapore time, from ai_usage_events rows. Pure and client-safe, so the
// page can use the labels and test-ai-usage.ts can check the arithmetic.

export type UsageEventRow = {
  id: number;
  created_at: string;
  actor_email: string | null;
  subject_email: string | null;
  feature: string;
  trigger: string;
  step: string | null;
  turn_key: string | null;
  provider: string;
  model: string | null;
  input_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  output_tokens: number;
  web_search_requests: number;
  cost_usd: number | string | null;
};

export type UsageWindow = 'today' | 'week' | 'month';
export const USAGE_WINDOWS: readonly UsageWindow[] = ['today', 'week', 'month'];

export type UsageTotals = {
  calls: number;
  /** All four buckets — input, cache writes, cache reads, output. */
  tokens: number;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  webSearches: number;
  /** Sum of the rows' cost snapshots; rows without a price add nothing here. */
  costUsd: number;
  /** Calls whose model had no confirmed price — their cost is missing from costUsd. */
  unpricedCalls: number;
};

export type PersonUsage = {
  key: string;
  /** person = a signed-in actor; system = a scheduled job; unidentified = a call with no actor that wasn't a cron run. */
  kind: 'person' | 'system' | 'unidentified';
  email: string | null;
  windows: Record<UsageWindow, UsageTotals>;
  /** This month's calls that happened automatically because of this person (My Tasks brief, post-chat learning). */
  autoMonth: UsageTotals;
};

export type FeatureUsage = { feature: string; windows: Record<UsageWindow, UsageTotals> };

export type UsageSummary = {
  windows: Record<UsageWindow, UsageTotals>;
  people: PersonUsage[];
  features: FeatureUsage[];
  /** ISO start of each window (Singapore midnight). */
  starts: Record<UsageWindow, string>;
};

export const FEATURE_LABEL: Record<string, string> = {
  assistant: 'AI 助手（聊天）',
  ai_learning: '对话学习',
  turnover_ai: 'Turnover AI 读单据',
  my_tasks_brief: 'My Tasks 今日提醒',
  reports_narrative: 'Reports AI 分析',
  ai_quality_review: 'AI 质量抽查',
  sg_news: 'SG Latest News',
};

export const TRIGGER_LABEL: Record<string, string> = {
  chat: '提问',
  upload: '上传',
  manual: '手动',
  auto: '自动',
  cron: '定时任务',
};

const SGT_OFFSET_MS = 8 * 3600_000; // Singapore has no daylight saving

/** Singapore midnight today, 6 days before that (7 days incl. today), and the 1st of this month. */
export function usageWindowStarts(now: Date): Record<UsageWindow, Date> {
  const sgt = new Date(now.getTime() + SGT_OFFSET_MS);
  const today = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate()) - SGT_OFFSET_MS;
  const month = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), 1) - SGT_OFFSET_MS;
  return { today: new Date(today), week: new Date(today - 6 * 86_400_000), month: new Date(month) };
}

export function emptyTotals(): UsageTotals {
  return { calls: 0, tokens: 0, inputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0, webSearches: 0, costUsd: 0, unpricedCalls: 0 };
}

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

function add(t: UsageTotals, r: UsageEventRow) {
  const input = n(r.input_tokens), write = n(r.cache_write_tokens), read = n(r.cache_read_tokens), output = n(r.output_tokens);
  t.calls += 1;
  t.inputTokens += input;
  t.cacheWriteTokens += write;
  t.cacheReadTokens += read;
  t.outputTokens += output;
  t.tokens += input + write + read + output;
  t.webSearches += n(r.web_search_requests);
  if (r.cost_usd === null || r.cost_usd === undefined || r.cost_usd === '') t.unpricedCalls += 1;
  else t.costUsd = Math.round((t.costUsd + n(r.cost_usd)) * 1_000_000) / 1_000_000;
}

function windowsOf(): Record<UsageWindow, UsageTotals> {
  return { today: emptyTotals(), week: emptyTotals(), month: emptyTotals() };
}

export function personKey(r: Pick<UsageEventRow, 'actor_email' | 'trigger'>): { key: string; kind: PersonUsage['kind']; email: string | null } {
  if (r.actor_email) return { key: r.actor_email.toLowerCase(), kind: 'person', email: r.actor_email.toLowerCase() };
  if (r.trigger === 'cron') return { key: '(system)', kind: 'system', email: null };
  return { key: '(unidentified)', kind: 'unidentified', email: null };
}

export function summarizeUsage(rows: readonly UsageEventRow[], now: Date): UsageSummary {
  const starts = usageWindowStarts(now);
  const total = windowsOf();
  const people = new Map<string, PersonUsage>();
  const features = new Map<string, FeatureUsage>();
  for (const r of rows) {
    const at = new Date(r.created_at).getTime();
    const inWindow = USAGE_WINDOWS.filter(w => at >= starts[w].getTime() && at <= now.getTime());
    if (!inWindow.length) continue;
    const who = personKey(r);
    const person = people.get(who.key) ?? { ...who, windows: windowsOf(), autoMonth: emptyTotals() };
    const feature = features.get(r.feature) ?? { feature: r.feature, windows: windowsOf() };
    for (const w of inWindow) {
      add(total[w], r);
      add(person.windows[w], r);
      add(feature.windows[w], r);
    }
    if (r.trigger === 'auto' && inWindow.includes('month')) add(person.autoMonth, r);
    people.set(who.key, person);
    features.set(r.feature, feature);
  }
  const kindOrder = { person: 0, unidentified: 1, system: 2 } as const;
  return {
    windows: total,
    people: [...people.values()].sort((a, b) => kindOrder[a.kind] - kindOrder[b.kind] || b.windows.month.costUsd - a.windows.month.costUsd || b.windows.month.tokens - a.windows.month.tokens || a.key.localeCompare(b.key)),
    features: [...features.values()].sort((a, b) => b.windows.month.costUsd - a.windows.month.costUsd || b.windows.month.calls - a.windows.month.calls),
    starts: { today: starts.today.toISOString(), week: starts.week.toISOString(), month: starts.month.toISOString() },
  };
}
