// Source-level guard for the two paging rules in docs/INVARIANTS.md INV-DATA-066
// (unordered offset paging silently duplicates/drops rows) and INV-DATA-006
// (an unpaginated read silently stops at PostgREST's 1,000-row cap):
//
//   1. Every hand-written `.range(` outside lib/page-all.ts must be ordered in
//      the same query chain (pageAll() adds its own unique ordering).
//   2. Every server-side table read must go through lib/supabase.ts's
//      createAdminClient() — the ONLY place that installs the cap-completing
//      fetch (lib/supabase-auto-page.ts). A second createClient() from
//      '@supabase/supabase-js' anywhere else would silently bypass it.
//   3. createAdminClient() must actually install that fetch.
//
// Run: npx tsx test-paging-guard.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = process.cwd();
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', 'scripts', 'public'].includes(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}
const files = ['app', 'lib', 'components'].flatMap(d => walk(join(ROOT, d)));
const rel = (p: string) => relative(ROOT, p).replace(/\\/g, '/');

console.log('--- rule 1: every .range( outside page-all.ts is ordered ---');
const unordered: string[] = [];
let rangeSites = 0;
for (const file of files) {
  if (rel(file) === 'lib/page-all.ts') continue;
  const src = readFileSync(file, 'utf8');
  const re = /\.range\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    rangeSites++;
    // the query chain that leads to this .range(: look back to the previous
    // statement boundary (';' only — a '{' can be the object literal inside
    // .order('id', { ascending: true }) itself)
    const before = src.slice(Math.max(0, m.index - 500), m.index);
    const chain = before.slice(before.lastIndexOf(';') + 1);
    if (!/\.order\(/.test(chain)) unordered.push(`${rel(file)}:${src.slice(0, m.index).split('\n').length}`);
  }
}
check(`all ${rangeSites} hand-written .range( sites carry an .order( in their chain`, unordered.length === 0, `unordered: ${unordered.join(', ')}`);

console.log('\n--- rule 2: no Supabase client is built outside lib/supabase.ts ---');
const strayClients: string[] = [];
for (const file of files) {
  if (rel(file) === 'lib/supabase.ts') continue;
  const src = readFileSync(file, 'utf8');
  if (/from\s+['"]@supabase\/supabase-js['"]/.test(src) && /\bcreateClient\s*\(/.test(src)) strayClients.push(rel(file));
}
check('createClient() from @supabase/supabase-js appears only in lib/supabase.ts', strayClients.length === 0, `also in: ${strayClients.join(', ')}`);

console.log('\n--- rule 3: the admin client installs the cap-completing fetch ---');
const supa = readFileSync(join(ROOT, 'lib/supabase.ts'), 'utf8');
check('createAdminClient() passes global.fetch = the auto-paginating fetch', /createAdminClient[\s\S]*global:\s*\{\s*fetch:\s*autoPaginatingFetch\s*\}/.test(supa));
check('lib/supabase.ts builds it with makeAutoPaginatingFetch()', /autoPaginatingFetch\s*=\s*makeAutoPaginatingFetch\(\)/.test(supa));

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
