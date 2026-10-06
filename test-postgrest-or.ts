// lib/postgrest-or.ts — typed search text in a PostgREST `.or()` filter.
// A comma in the text ("Han Kun, LLP", or the real client "500 DURIANS II,
// L.P") ended the condition early and PostgREST answered 'failed to parse
// logic tree' — a 500 from the Companies, Master List and AR Reminder search
// boxes (council review 2026-10-06). Checked against the live PostgREST
// separately (same rows as the unquoted form for ordinary terms; every hard
// term accepted); this file pins the string and guards the call sites.
//
// Run: npx tsx test-postgrest-or.ts
import fs from 'fs';
import path from 'path';
import { ilikeAny } from './lib/postgrest-or';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};

console.log('--- the filter string ---');
check('an ordinary term keeps the old meaning, in quotes', ilikeAny(['company_name', 'uen'], 'Pte') === 'company_name.ilike."%Pte%",uen.ilike."%Pte%"');
check('a comma stays inside the quoted value', ilikeAny(['company_name'], 'Han Kun, LLP') === 'company_name.ilike."%Han Kun, LLP%"');
check('a double quote and a backslash are escaped', ilikeAny(['a'], 'say "hi" a\\b') === 'a.ilike."%say \\"hi\\" a\\\\b%"');
check('brackets and Chinese pass through untouched', ilikeAny(['a', 'b'], '思店科技(杭州)') === 'a.ilike."%思店科技(杭州)%",b.ilike."%思店科技(杭州)%"');
check('LIKE wildcards stay wildcards (as before)', ilikeAny(['a'], '100%_x') === 'a.ilike."%100%_x%"');
check('a single column has no stray comma', !ilikeAny(['a'], 'x').includes('",'));

console.log('\n--- no search route builds an .or() from typed text by hand ---');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(p);
  return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
});
const files = ['app', 'components', 'lib'].flatMap(d => walk(path.join(process.cwd(), d)));
const raw = files.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
  .filter(({ line }) => /\.or\(`[^`]*\$\{/.test(line) && /ilike\./.test(line));
check('no .or(`…ilike.…${text}…`) outside ilikeAny', raw.length === 0, raw.map(r => `${path.relative(process.cwd(), r.f)}:${r.i + 1}`).join(', '));
for (const [file, cols] of [['app/api/companies/route.ts', "['company_name', 'registration_no']"], ['app/api/master-list/route.ts', "['company_name', 'roc_no']"], ['app/api/ar-reminder/search/route.ts', "['entity_name', 'uen']"]] as const) {
  check(`${file} searches through ilikeAny`, fs.readFileSync(path.join(process.cwd(), file), 'utf8').includes(`ilikeAny(${cols}`));
}

console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
process.exit(fail === 0 ? 0 : 1);
