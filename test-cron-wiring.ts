// Source-level guard for the cron wiring chain (docs/INVARIANTS.md
// INV-CRON-011). Each rule is a miss that already shipped:
//
//   1. Every path scheduled in vercel.json must be in proxy.ts's CRON_PATHS.
//      Vercel's cron request carries only `Bearer $CRON_SECRET`, no session,
//      so a path missing from the set is answered 401 by the proxy every
//      night: the route never runs and no automation_sync_runs row is ever
//      written. Shipped twice — /api/teamwork/sync-secretary (2026-08-06)
//      and /api/ai-quality/review (scheduled 2026-09-22, found 2026-09-24,
//      left out on purpose to keep a paid job off, fixed 2026-10-05).
//      Leaving a path out of CRON_PATHS is not an off switch: it looks
//      exactly like this bug. Pause a job by removing its vercel.json entry
//      or by gating the route itself.
//      And the reverse: a CRON_PATHS entry no schedule uses is a bypass
//      nothing needs (keep one only with a written reason, UNSCHEDULED_OK).
//   2. Every scheduled path has a route file with a GET handler — Vercel's
//      cron calls GET, and the proxy's bypass only lets GET through.
//   3. Every AutomationSource (lib/automation-sync.ts) is listed in the
//      Automation Health panel's SOURCES (app/api/automation/health/route.ts),
//      except 'teamwork_nd' (manual full-roster runs only, never scheduled).
//      That array does not follow the union by itself; teamwork_secretary,
//      ai_learning and ai_quality_review were each missing from it once.
//
// Run: npx tsx test-cron-wiring.ts
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
// The comments inside these lists contain apostrophes ("automation-sync.ts's"),
// so drop line comments before pulling out the quoted strings.
const stripComments = (src: string) => src.replace(/\/\/.*$/gm, '');
const quoted = (text: string) => [...text.matchAll(/'([^'\n]+)'/g)].map(m => m[1]);
function between(src: string, start: RegExp, end: string, what: string): string {
  const m = start.exec(src);
  if (!m) throw new Error(`cannot find ${what}`);
  const from = m.index + m[0].length;
  const to = src.indexOf(end, from);
  if (to < 0) throw new Error(`cannot find the end of ${what}`);
  return src.slice(from, to);
}

const cronPaths = new Set(quoted(between(stripComments(read('proxy.ts')), /const CRON_PATHS = new Set\(\[/, ']', "proxy.ts's CRON_PATHS")));
const vercel = JSON.parse(read('vercel.json')) as { crons?: { path: string }[] };
// The proxy compares the pathname only, so drop any query string.
const scheduled = [...new Set((vercel.crons ?? []).map(c => c.path.split('?')[0]))];

console.log('--- rule 1: vercel.json crons and proxy.ts CRON_PATHS match ---');
check(`vercel.json schedules ${scheduled.length} distinct paths`, scheduled.length > 0);
const unlisted = scheduled.filter(path => !cronPaths.has(path));
check(
  `all ${scheduled.length} are in CRON_PATHS (${cronPaths.size} entries)`,
  unlisted.length === 0,
  `answered 401 every night, never run: ${unlisted.join(', ')} — add to CRON_PATHS; to pause a job, remove its vercel.json entry instead`,
);
const UNSCHEDULED_OK: Record<string, string> = {};
const unscheduled = [...cronPaths].filter(path => !scheduled.includes(path) && !(path in UNSCHEDULED_OK));
check(
  `every CRON_PATHS entry is scheduled in vercel.json`,
  unscheduled.length === 0,
  `no schedule uses: ${unscheduled.join(', ')} — remove from CRON_PATHS, or add to UNSCHEDULED_OK with the reason it stays`,
);

console.log('\n--- rule 2: every scheduled path has a route with a GET handler ---');
const noGet = scheduled.filter(path => {
  const file = `app${path}/route.ts`;
  return !existsSync(join(ROOT, file)) || !/export\s+(async\s+)?function\s+GET\b|export\s+const\s+GET\b|export\s*\{[^}]*\bGET\b/.test(read(file));
});
check(`all ${scheduled.length} scheduled routes export GET`, noGet.length === 0, `no app/<path>/route.ts exporting GET: ${noGet.join(', ')}`);

console.log('\n--- rule 3: every AutomationSource is on the Automation Health panel ---');
const NOT_ON_PANEL = new Set(['teamwork_nd']);
const sources = quoted(between(stripComments(read('lib/automation-sync.ts')), /export type AutomationSource\s*=/, ';', 'the AutomationSource union'));
const panel = new Set(quoted(between(stripComments(read('app/api/automation/health/route.ts')), /const SOURCES = \[/, ']', "the health route's SOURCES")));
check(`AutomationSource has ${sources.length} values`, sources.length > 0);
const hidden = sources.filter(source => !panel.has(source) && !NOT_ON_PANEL.has(source));
check(`all except ${[...NOT_ON_PANEL].join(', ')} are in health SOURCES (${panel.size} entries)`, hidden.length === 0, `never shown on Automation Health: ${hidden.join(', ')}`);
const stray = [...panel].filter(source => !sources.includes(source));
check('health SOURCES lists nothing outside AutomationSource', stray.length === 0, `not an AutomationSource: ${stray.join(', ')}`);

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
