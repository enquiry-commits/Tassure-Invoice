// Pins the AI quality judge (docs/INVARIANTS.md INV-AI-006) without a paid
// call: the request it sends, how a reply becomes a verdict, and the guards
// around the nightly run.
//
//   1. The request leaves room for Sonnet 5's default thinking (max_tokens
//      covers thinking + answer, so the original 800 could cut the verdict
//      off) and sends nothing Sonnet 5 rejects (temperature/top_p/top_k,
//      budget_tokens).
//   2. A cut-off, refused or JSON-less reply throws — never a guessed verdict.
//   3. The run route gates the browser case (the exact CRON_SECRET, else an
//      admin account — INV-CRON-018) before any run is recorded, and the
//      batch stops before paying when it can't read ai_quality_reviews.
//
// Run: npx tsx test-ai-quality-judge.ts
import { readFileSync } from 'fs';
import { JUDGE_MAX_TOKENS, judgeRequestBody, parseJudgeResponse } from './lib/ai-quality/judge';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};
const throwsWith = (fn: () => unknown, pattern: RegExp) => {
  try {
    fn();
    return false;
  } catch (error) {
    return pattern.test(error instanceof Error ? error.message : String(error));
  }
};
const text = (t: string) => [{ type: 'text', text: t }];

console.log('--- rule 1: the request ---');
const body = judgeRequestBody('claude-sonnet-5', 'RUBRIC', 'INPUT') as Record<string, unknown>;
check('model passed through', body.model === 'claude-sonnet-5');
check(`max_tokens leaves room for thinking (${JUDGE_MAX_TOKENS})`, typeof body.max_tokens === 'number' && body.max_tokens >= 4000, `got ${String(body.max_tokens)}`);
check('thinking stays adaptive', JSON.stringify(body.thinking) === JSON.stringify({ type: 'adaptive' }));
check('effort is low', (body.output_config as { effort?: string } | undefined)?.effort === 'low');
check('nothing Sonnet 5 rejects', !['temperature', 'top_p', 'top_k'].some(k => k in body) && !JSON.stringify(body).includes('budget_tokens'));
check('system prompt + exactly one user message', body.system === 'RUBRIC' && Array.isArray(body.messages) && (body.messages as unknown[]).length === 1);

console.log('\n--- rule 2: the reply ---');
const flagged = parseJudgeResponse({
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', text: '' }, ...text('{"verdict":"flag","issues":[{"category":"capability_denial","description":"says it cannot"},{"bad":1}]}')],
});
check('thinking block skipped; flag with the 1 well-formed issue', flagged.verdict === 'flag' && flagged.issues.length === 1 && flagged.issues[0].category === 'capability_denial');
const prose = parseJudgeResponse({ stop_reason: 'end_turn', content: text('Verdict: {"verdict":"pass","issues":[]} — done') });
check('JSON inside prose is parsed', prose.verdict === 'pass' && prose.issues.length === 0);
const many = parseJudgeResponse({
  stop_reason: 'end_turn',
  content: text(JSON.stringify({ verdict: 'flag', issues: Array.from({ length: 12 }, (_, i) => ({ category: 'other', description: String(i) })) })),
});
check('at most 8 issues kept', many.issues.length === 8);
check('missing verdict means pass', parseJudgeResponse({ stop_reason: 'end_turn', content: text('{"issues":[]}') }).verdict === 'pass');
check('cut off at max_tokens throws', throwsWith(() => parseJudgeResponse({ stop_reason: 'max_tokens', content: text('{"verdict":"fl') }), /cut off at max_tokens/));
check('cut off throws even if the partial text parses', throwsWith(() => parseJudgeResponse({ stop_reason: 'max_tokens', content: text('{"verdict":"pass","issues":[]}') }), /cut off/));
check('refusal throws', throwsWith(() => parseJudgeResponse({ stop_reason: 'refusal', content: [] }), /refusal/));
check('no JSON throws', throwsWith(() => parseJudgeResponse({ stop_reason: 'end_turn', content: text('Looks fine to me.') }), /no parseable JSON/));

console.log('\n--- rule 3: route gate and batch guards (source-level) ---');
const route = readFileSync('app/api/ai-quality/review/route.ts', 'utf8');
const secretAt = route.search(/!!secret\s*&&\s*req\.headers\.get\('authorization'\)\s*===\s*`Bearer \$\{secret\}`/);
const adminAt = route.search(/!account\.admin/);
const runAt = route.indexOf('withAutomationRun(req');
check('route tests the exact secret, with a truthiness check', secretAt >= 0);
check('route otherwise requires an admin account', adminAt >= 0);
check('both checks come before withAutomationRun records a run', secretAt >= 0 && adminAt >= 0 && runAt > secretAt && runAt > adminAt);
check('route does not use automationTrigger() (any Bearer header passes it)', !/automationTrigger\(/.test(route));
const review = readFileSync('lib/ai-quality/review.ts', 'utf8');
check('batch stops before any judge call when it cannot read ai_quality_reviews', /if \(reviewedError\) throw/.test(review));
check('judge request built by judgeRequestBody (no inline max_tokens)', /judgeRequestBody\(/.test(review) && !/max_tokens:\s*\d/.test(review));
check('batch has a time budget below the route limit', /TIME_BUDGET_MS = 90_000/.test(review) && /export const maxDuration = 120;/.test(route));
check('rubric has the over_caution counterweight (a defects-only judge pushes toward hedging)', /over_caution/.test(review));
check('generic fallback menus (intent_fallback) are skipped before sampling', /route !== 'intent_fallback'/.test(review) && /skippedFallback/.test(review));
check('a failed ai_agent_runs read stops the batch (else every reply looks tool-less)', /if \(runsError\) throw/.test(review));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
