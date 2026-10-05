// The AI usage ledger (docs/INVARIANTS.md INV-AI-010): every paid
// Claude/OpenAI call becomes one ai_usage_events row, with both providers'
// token counts in the same four buckets, the person who actually caused it,
// and a cost snapshot at the published price. Prices checked against the
// providers' own pages on 2026-10-05 (see lib/ai/pricing.ts).
//
// Run: npx tsx test-ai-usage.ts
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { normalizeUsage, usageRow, type AiUsageTag } from './lib/ai/usage-ledger';
import { estimateCostUsd, priceFor } from './lib/ai/pricing';
import { summarizeUsage, usageWindowStarts, type UsageEventRow } from './lib/ai/usage-report';
import { APPROVED_ACCOUNTS, canAccountOpen } from './lib/approved-accounts';
import { PAGE_RULES } from './lib/workspaces';
import { NAV_TREE, navLeaves } from './lib/nav-tree';

const ROOT = process.env.AI_USAGE_GUARD_ROOT ?? process.cwd();
let fail = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  console.log((ok ? 'OK   ' : 'FAIL ') + name + (ok || detail === undefined ? '' : `\n       got ${JSON.stringify(detail)}`));
  if (!ok) fail++;
};
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-9;

// Shaped like the assistant's real Claude replies: round 1 writes the ~19K
// cached system prompt + tools, round 2 reads it back.
const round1 = { id: 'msg_01A', model: 'claude-sonnet-5', usage: { input_tokens: 412, cache_creation_input_tokens: 18950, cache_read_input_tokens: 0, output_tokens: 523, cache_creation: { ephemeral_5m_input_tokens: 18950, ephemeral_1h_input_tokens: 0 }, server_tool_use: { web_search_requests: 2 } } };
const round2 = { id: 'msg_01B', model: 'claude-sonnet-5', usage: { input_tokens: 1310, cache_creation_input_tokens: 0, cache_read_input_tokens: 18950, output_tokens: 288 } };
// OpenAI Responses: input_tokens INCLUDES cached tokens, output INCLUDES reasoning.
const synthesis = { id: 'resp_1', model: 'gpt-5.6-terra-2026-08-01', usage: { input_tokens: 5000, input_tokens_details: { cached_tokens: 3000 }, output_tokens: 800, output_tokens_details: { reasoning_tokens: 300 } }, output: [{ type: 'web_search_call' }, { type: 'web_search_call' }, { type: 'message' }] };
const router = { id: 'resp_2', model: 'gpt-5.6-luna', usage: { input_tokens: 1500, output_tokens: 40 } };

console.log('--- the same four buckets for both providers ---');
{
  const a = normalizeUsage('anthropic', round1)!;
  check('Claude: input excludes the cache; the cache write and searches are their own', a.inputTokens === 412 && a.cacheWrite5mTokens === 18950 && a.cacheWrite1hTokens === 0 && a.cacheReadTokens === 0 && a.outputTokens === 523 && a.webSearchRequests === 2, a);
  const b = normalizeUsage('anthropic', round2)!;
  check('Claude: a cache read is counted, not dropped', b.inputTokens === 1310 && b.cacheReadTokens === 18950 && b.outputTokens === 288, b);
  const c = normalizeUsage('anthropic', { model: 'claude-sonnet-5', usage: { input_tokens: 10, cache_creation_input_tokens: 500, output_tokens: 5 } })!;
  check('Claude: no 5m/1h split reported → the write is the default 5-minute cache', c.cacheWrite5mTokens === 500 && c.cacheWrite1hTokens === 0, c);
  const o = normalizeUsage('openai', synthesis)!;
  check('OpenAI: cached tokens are taken OUT of input (no double count)', o.inputTokens === 2000 && o.cacheReadTokens === 3000, o);
  check('OpenAI: output keeps reasoning inside it; web searches come from the output items', o.outputTokens === 800 && o.reasoningTokens === 300 && o.webSearchRequests === 2, o);
  const bare = normalizeUsage('openai', { model: 'gpt-5.6-luna', usage: { input_tokens: 7 } })!;
  check('missing fields are 0, never NaN', [bare.inputTokens, bare.cacheReadTokens, bare.outputTokens, bare.reasoningTokens, bare.webSearchRequests].join() === '7,0,0,0,0', bare);
  check('a reply without a usage block records nothing', normalizeUsage('anthropic', { content: [] }) === null && normalizeUsage('openai', null) === null);
  check('no prompt or reply text is kept — only the provider\'s usage block', JSON.stringify(normalizeUsage('anthropic', { ...round2, content: [{ type: 'text', text: 'SECRET REPLY' }] })).indexOf('SECRET') === -1);
}

console.log('\n--- estimated cost at the published price (USD) ---');
{
  check('Sonnet 5 round 1: 412×$2 + 18,950×$2.50 (cache write) + 523×$10 per M, + 2 searches × $0.01 = $0.073429',
    near(estimateCostUsd('anthropic', normalizeUsage('anthropic', round1)!), 0.073429), estimateCostUsd('anthropic', normalizeUsage('anthropic', round1)!));
  check('Sonnet 5 round 2: the cached prompt read back at $0.20/M — $0.00929, not the $0.04 it would be uncached',
    near(estimateCostUsd('anthropic', normalizeUsage('anthropic', round2)!), 0.00929), estimateCostUsd('anthropic', normalizeUsage('anthropic', round2)!));
  check('a 1-hour cache write is priced at $4/M',
    near(estimateCostUsd('anthropic', normalizeUsage('anthropic', { model: 'claude-sonnet-5', usage: { input_tokens: 100, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 } } })!), 0.0042));
  check('gpt-5.6-terra: 2,000×$2 + 3,000 cached×$0.20 + 800×$12 per M, + 2 searches = $0.0342',
    near(estimateCostUsd('openai', normalizeUsage('openai', synthesis)!), 0.0342), estimateCostUsd('openai', normalizeUsage('openai', synthesis)!));
  check('gpt-5.6-luna router: 1,500×$0.20 + 40×$1.20 per M = $0.000348',
    near(estimateCostUsd('openai', normalizeUsage('openai', router)!), 0.000348), estimateCostUsd('openai', normalizeUsage('openai', router)!));
  check('a dated model id still finds its price', priceFor('anthropic', 'claude-sonnet-5-20260115')?.output === 10 && priceFor('openai', 'gpt-5.6-terra-2026-08-01')?.output === 12);
  check('a model not in the price table gets NO cost — never a guess', estimateCostUsd('anthropic', { ...normalizeUsage('anthropic', round2)!, model: 'claude-opus-9' }) === null && estimateCostUsd('anthropic', { ...normalizeUsage('anthropic', round2)!, model: null }) === null);
  check('OpenAI input over 272K (a different price tier) gets no cost', estimateCostUsd('openai', normalizeUsage('openai', { model: 'gpt-5.6-terra', usage: { input_tokens: 300_000, output_tokens: 10 } })!) === null);
}

console.log('\n--- the row: who it counts under ---');
{
  const tag: AiUsageTag = { feature: 'assistant', trigger: 'chat', actorEmail: 'Vincent@Tassure.com', subjectEmail: 'chelsea@tassure.com', step: 'round_1', turnKey: 't-1' };
  const row = usageRow(tag, 'anthropic', normalizeUsage('anthropic', round1)!);
  check('View As: the person who pressed send is the actor, the viewed account is noted beside', row.actor_email === 'vincent@tassure.com' && row.subject_email === 'chelsea@tassure.com', row);
  check('no View As (subject = actor) → no subject', usageRow({ ...tag, subjectEmail: 'vincent@tassure.com' }, 'anthropic', normalizeUsage('anthropic', round1)!).subject_email === null);
  check('the row carries the cost snapshot and its price version', near(row.cost_usd, 0.073429) && row.price_version === '2026-10-05' && row.cache_write_tokens === 18950 && row.step === 'round_1' && row.turn_key === 't-1', row);
  const unpriced = usageRow({ feature: 'sg_news', trigger: 'cron', actorEmail: null }, 'anthropic', { ...normalizeUsage('anthropic', round2)!, model: 'claude-opus-9' });
  check('a scheduled job has no actor; an unpriced model has no cost and no price version', unpriced.actor_email === null && unpriced.cost_usd === null && unpriced.price_version === null, unpriced);
  check('the row has exactly the table\'s columns (scripts/add-ai-usage-events.sql)', Object.keys(row).sort().join() === ['actor_email', 'subject_email', 'feature', 'trigger', 'step', 'turn_key', 'provider', 'model', 'request_id', 'input_tokens', 'cache_write_tokens', 'cache_read_tokens', 'output_tokens', 'reasoning_tokens', 'web_search_requests', 'cost_usd', 'price_version', 'raw_usage'].sort().join(), Object.keys(row));
}

console.log('\n--- the usage page: Singapore-time windows, who each call counts under ---');
{
  const now = new Date('2026-10-05T03:00:00Z'); // 11:00 SGT, Monday 5 Oct
  const s = usageWindowStarts(now);
  check('today / 7 days / this month start at Singapore midnight', s.today.toISOString() === '2026-10-04T16:00:00.000Z' && s.week.toISOString() === '2026-09-28T16:00:00.000Z' && s.month.toISOString() === '2026-09-30T16:00:00.000Z', s);
  const row = (id: number, created_at: string, actor: string | null, trigger: string, feature: string, cost: number | null, tokensIn = 1000): UsageEventRow => ({
    id, created_at, actor_email: actor, subject_email: null, feature, trigger, step: null, turn_key: null, provider: 'anthropic', model: 'claude-sonnet-5',
    input_tokens: tokensIn, cache_write_tokens: 0, cache_read_tokens: 500, output_tokens: 100, web_search_requests: 0, cost_usd: cost,
  });
  const rows = [
    row(1, '2026-10-05T02:00:00Z', 'vincent@tassure.com', 'chat', 'assistant', 0.05),          // today
    row(2, '2026-10-04T15:59:59Z', 'vincent@tassure.com', 'auto', 'my_tasks_brief', 0.001),    // 23:59:59 SGT yesterday
    row(3, '2026-09-30T15:59:59Z', null, 'cron', 'sg_news', 0.03),                             // last day of September (SGT)
    row(4, '2026-10-05T01:00:00Z', null, 'chat', 'assistant', null),                           // unidentified, unpriced model
    row(5, '2026-10-05T02:30:00Z', 'minquan@tassure.com', 'chat', 'assistant', 0.02),
    row(6, '2026-09-01T02:00:00Z', 'vincent@tassure.com', 'chat', 'assistant', 9),             // outside every window
  ];
  const sum = summarizeUsage(rows, now);
  check('today counts only since Singapore midnight (1 second before it is yesterday)', sum.windows.today.calls === 3 && near(sum.windows.today.costUsd, 0.07) && sum.windows.today.unpricedCalls === 1, sum.windows.today);
  check('this month starts on the 1st in Singapore (30 Sep 23:59 SGT is last month)', sum.windows.month.calls === 4 && near(sum.windows.month.costUsd, 0.071), sum.windows.month);
  check('the last 7 days reach back over the month boundary', sum.windows.week.calls === 5, sum.windows.week);
  const vincent = sum.people.find(p => p.email === 'vincent@tassure.com')!;
  check('a person\'s month includes their automatic calls, also shown on their own', near(vincent.windows.month.costUsd, 0.051) && vincent.autoMonth.calls === 1 && near(vincent.autoMonth.costUsd, 0.001), vincent);
  check('token total = input + cache writes + cache reads + output', vincent.windows.today.tokens === 1600, vincent.windows.today);
  check('people first (most cost first), then unidentified calls, then the system', sum.people.map(p => p.key).join() === 'vincent@tassure.com,minquan@tassure.com,(unidentified),(system)', sum.people.map(p => p.key));
  check('a scheduled job is the system\'s, never a person\'s', sum.people.find(p => p.kind === 'system')?.windows.week.calls === 1 && sum.people.find(p => p.kind === 'system')?.windows.month.calls === 0);
  check('an unpriced call adds no money but is counted as unpriced', sum.people.find(p => p.kind === 'unidentified')?.windows.today.unpricedCalls === 1 && sum.people.find(p => p.kind === 'unidentified')?.windows.today.costUsd === 0);
}

console.log('\n--- who can open the usage page (Vincent: "只有我") ---');
{
  const viewers = APPROVED_ACCOUNTS.filter(a => a.canViewAiUsage).map(a => a.email);
  check('only Vincent has the AI usage flag', viewers.join() === 'vincent@tassure.com', viewers);
  check('/ai-usage is its own gated page rule', PAGE_RULES.some(r => r.key === 'ai-usage' && r.patterns.includes('/ai-usage') && r.gate === 'canViewAiUsage'));
  const openers = APPROVED_ACCOUNTS.filter(a => canAccountOpen(a, '/ai-usage', new URLSearchParams())).map(a => a.email);
  check('only Vincent can open /ai-usage (not management, not other admins-to-be)', openers.join() === 'vincent@tassure.com', openers);
  check('it sits in the Admin menu', navLeaves(NAV_TREE).some(({ node, trail }) => node.href === '/ai-usage' && trail.join() === 'Admin'));
}

console.log('\n--- source guards ---');
{
  const read = (p: string) => (existsSync(join(ROOT, p)) ? readFileSync(join(ROOT, p), 'utf8') : '');
  const walk = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap(name => {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) return walk(rel);
    return /\.(ts|tsx)$/.test(name) ? [rel] : [];
  });
  const runtime = [...walk('app'), ...walk('lib'), ...walk('components'), 'proxy.ts'];
  const direct = runtime.filter(f => !/^lib[\\/]ai[\\/](anthropic|openai)\.ts$/.test(relative('.', f)) && /api\.anthropic\.com|api\.openai\.com/.test(read(f)));
  check('no file outside lib/ai/anthropic.ts and lib/ai/openai.ts calls an AI API directly (a direct call would be unrecorded)', direct.length === 0, direct);

  const anthropic = read('lib/ai/anthropic.ts');
  check('every Claude call records its usage from a clone, before the caller reads the body', /if \(res\.ok\) trackAiUsage\(tag, 'anthropic', res\.clone\(\)\.json\(\)\);\s*return res;/.test(anthropic));
  const openai = read('lib/ai/openai.ts');
  check('every OpenAI call records its usage, and both helpers REQUIRE a tag', /trackAiUsage\(usage, 'openai', payload\);/.test(openai) && (openai.match(/\n  usage: AiUsageTag;/g) ?? []).length === 2);
  const usage = read('lib/ai/usage.ts');
  check('the write starts at once and is handed to after(); a failure never throws; a missing table is skipped', /after\(work\)/.test(usage) && /catch \(error\)/.test(usage) && /PGRST205/.test(usage));

  const assistant = read('app/api/assistant/route.ts');
  check('assistant: the chat counts under the real signed-in person, the View-As account beside it', /actorEmail: realAccount\?\.email \?\? null,/.test(assistant) && /subjectEmail: account && account\.email !== realAccount\?\.email \? account\.email : null,/.test(assistant));
  check('assistant: each Claude round is its own row', /claudeMessages\(\{ \.\.\.usage, step: `round_\$\{turn \+ 1\}` \}/.test(assistant));
  check('assistant: the learning pass after a chat counts under the chatter, as automatic', /feature: 'ai_learning', trigger: 'auto', actorEmail: chatUsage\.actorEmail/.test(assistant));
  check('My Tasks: the brief counts under the person who opened the page, as automatic', /feature: 'my_tasks_brief', trigger: 'auto', actorEmail: realAccount\.email, subjectEmail: viewingAs\?\.email \?\? null/.test(read('app/api/my-tasks/route.ts')));
  check('Turnover AI: a file read counts under the uploader', /usage: \{ feature: 'turnover_ai', trigger: 'upload', actorEmail: account\.email \}/.test(read('app/api/turnover-ai/extract/route.ts')));
  const jobs: [string, string][] = [['app/api/ai-learning/analyze-all/route.ts', 'ai_learning'], ['app/api/reports/narrative-cron/route.ts', 'reports_narrative'], ['app/api/ai-quality/review/route.ts', 'ai_quality_review'], ['app/api/sg-news/sync/route.ts', 'sg_news']];
  const missing = jobs.filter(([file, feature]) => !read(file).includes(`scheduledJobUsage(req, '${feature}')`));
  check('scheduled jobs: the cron run is the system\'s, a manual run counts under the person', missing.length === 0, missing);
  check('a cron run is recognised by the real CRON_SECRET, not just any Bearer header', /req\.headers\.get\('authorization'\) === `Bearer \$\{secret\}`/.test(read('lib/ai/job-usage.ts')));
  check('the usage API checks the flag itself (APIs are not gated by department)', /if \(!account\.canViewAiUsage\) return NextResponse\.json\(\{ error: 'Your account cannot view AI usage\.' \}, \{ status: 403 \}\);/.test(read('app/api/ai-usage/route.ts')));
  const sql = read('scripts/add-ai-usage-events.sql').split('\n').filter(line => !line.trim().startsWith('--')).join('\n');
  check('the table has no CHECK constraint that could make a new feature\'s insert fail', /CREATE TABLE IF NOT EXISTS ai_usage_events/.test(sql) && !/CHECK\s*\(/i.test(sql));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
