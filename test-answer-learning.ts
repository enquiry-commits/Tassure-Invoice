// Pins the AI answer-quality learning loop's foundation (docs/INVARIANTS.md
// INV-AI-012) without a database: which learned rules may reach the
// assistant's prompt, what that block says, how reply evidence is kept small,
// and the wiring guards — a failed evidence write must never cost a reply its
// agent_run_id, the master switch fails closed, evidence goes after 30 days,
// and the database can only hold behaviour rules.
//
// Run: npx tsx test-answer-learning.ts
import { readFileSync } from 'fs';
import {
  compactEvidence, EVIDENCE_RETENTION_DAYS, GUIDANCE_CATEGORIES, GUIDANCE_MAX_CHARS, GUIDANCE_MAX_RULES,
  guidanceBlock, pickActiveGuidance, type GuidanceRule,
} from './lib/ai/answer-learning';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};
const now = new Date('2026-10-05T12:00:00Z');
const rule = (id: number, over: Partial<GuidanceRule> = {}): GuidanceRule => ({
  id,
  rule_text: `rule ${id}`,
  category: 'tool_routing',
  status: 'active',
  expires_at: '2026-11-01T00:00:00Z',
  created_at: new Date(Date.UTC(2026, 9, 1, 0, id)).toISOString(),
  ...over,
});

console.log('--- rule 1: only active, unexpired behaviour rules reach the prompt ---');
check('the categories are exactly the four behaviour ones', JSON.stringify(GUIDANCE_CATEGORIES) === JSON.stringify(['tool_routing', 'ask_first', 'caveat', 'format_language']));
const mixed = [
  rule(1),
  rule(2, { status: 'retired' }),
  rule(3, { expires_at: '2026-10-05T11:59:00Z' }),
  rule(4, { category: 'pricing' }),
  rule(5, { rule_text: 'x'.repeat(GUIDANCE_MAX_CHARS + 1) }),
  rule(6, { rule_text: '   ' }),
  rule(7, { category: 'ask_first' }),
];
check('retired, expired, non-behaviour, over-long and blank rules are dropped', pickActiveGuidance(mixed, now).map(r => r.id).join(',') === '1,7');
const ten = Array.from({ length: 10 }, (_, i) => rule(10 - i));
const picked = pickActiveGuidance(ten, now);
check(`at most ${GUIDANCE_MAX_RULES}, oldest first (a stable order keeps the prompt cache warm)`, picked.length === GUIDANCE_MAX_RULES && picked.map(r => r.id).join(',') === '1,2,3,4,5,6,7,8');

console.log('\n--- rule 2: the prompt block ---');
check('no rules, no block (an empty text block is an API error)', guidanceBlock([]) === '');
const block = guidanceBlock(picked);
check('one line per rule', block.split('\n').filter(l => l.startsWith('- ')).length === picked.length);
check('says it never overrides tool results or live data', /never overrides tool results/.test(block) && /live system data/.test(block));

console.log('\n--- rule 3: evidence is kept small ---');
const items = Array.from({ length: 15 }, (_, i) => ({ name: `tool_${i}`, input: { q: i }, result: `result ${i}` }));
check('at most 12 tool calls kept', compactEvidence(items).length === 12);
const big = compactEvidence([{ name: 'big', input: { q: 'x'.repeat(2000) }, result: 'y'.repeat(10_000) }])[0];
check('a long result is cut to 4,000 characters and marked', big.result.length === 4000 && big.truncated === true);
check('a long input is kept as cut text, never half a JSON object', typeof big.input === 'string' && big.input.length === 1000);
const small = compactEvidence([{ name: 'small', input: { q: 1 }, result: 'ok' }])[0];
check('a small call is kept as is', small.result === 'ok' && JSON.stringify(small.input) === '{"q":1}' && !('truncated' in small));
check('evidence is kept 30 days (Vincent: 存 30 天)', EVIDENCE_RETENTION_DAYS === 30);

console.log('\n--- rule 4: wiring (source-level) ---');
const route = readFileSync('app/api/assistant/route.ts', 'utf8');
check('the guidance block is sent only when there is one', /\.\.\.\(learned \? \[\{ type: 'text', text: learned/.test(route));
check('evidence is written only once the run has an id', /if \(runId && account\) trackTurnEvidence\(/.test(route));
const agentRuns = readFileSync('lib/ai/agent-runs.ts', 'utf8');
check('the ai_agent_runs insert carries no evidence (a failed insert drops the run id)', !/tool_evidence|guidance/.test(agentRuns));
const store = readFileSync('lib/ai/answer-learning-store.ts', 'utf8');
check('the master switch fails closed', /switchRes\.data\?\.enabled === true/.test(store));
const reviewRoute = readFileSync('app/api/ai-quality/review/route.ts', 'utf8');
check('the nightly run purges old evidence, after the reviews are saved', reviewRoute.indexOf('purgeOldTurnEvidence()') > reviewRoute.indexOf('runQualityReviewBatch('));
const review = readFileSync('lib/ai-quality/review.ts', 'utf8');
check('the judge gives up on a reply after 3 failed attempts', /const JUDGE_MAX_ATTEMPTS = 3;/.test(review) && /noteFailedAttempt\(/.test(review));
const sql = readFileSync('scripts/add-ai-answer-learning.sql', 'utf8');
const tables = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map(m => m[1]);
check(`every new table turns RLS on (${tables.length} tables)`, tables.length === 4 && tables.every(t => sql.includes(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`)));
const sqlCategories = /category text NOT NULL CHECK \(category IN \(([^)]*)\)\)/.exec(sql)?.[1].match(/'([a-z_]+)'/g)?.map(s => s.slice(1, -1)) ?? [];
check('the database allows exactly the code\'s behaviour categories', JSON.stringify(sqlCategories) === JSON.stringify([...GUIDANCE_CATEGORIES]));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
