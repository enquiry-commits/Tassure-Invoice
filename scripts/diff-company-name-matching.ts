// READ-ONLY impact check for ANY change to lib/company-name.ts (docs/INVARIANTS.md INV-DATA-076,
// docs/REGRESSION_CHECKLIST.md REG-013). Compares the working-tree matcher with the one in git
// (default HEAD, or pass another revision) over REAL names and prints every decision that moved:
//   (0) normalize() output — it is STORED (soa_owners / soa_remarks.customer_name_norm) and used as
//       exact Map keys, so it must differ for 0 names unless a data migration is intended;
//   (A) every company name x every distinct name in every table column that holds a company /
//       customer name: pairs whose >=70, >=85 or exact(100) decision changed;
//   (B) findUniqueBestMatch(>=70) per company per name source: pick or ambiguity changed.
// Each changed pair must be judged right or wrong by a person (same company? sibling? renamed?).
// No writes anywhere. Needs .env.local (service key) — run on a dev machine:
//   npx tsx scripts/diff-company-name-matching.ts [git-revision]
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const rev = process.argv[2] ?? 'HEAD';
// 70: billing / SOA / AR matching; 85: Company 360 and recipients; 90: contact-report fill-in.
const THRESHOLDS = [70, 85, 90];

(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'company-name-old-'));
  const oldFile = join(dir, 'company-name.ts');
  writeFileSync(oldFile, execSync(`git show ${rev}:lib/company-name.ts`, { encoding: 'utf8', maxBuffer: 1 << 24 }));
  const OLD = await import(pathToFileURL(oldFile).href);
  const NEW = await import(pathToFileURL(join(process.cwd(), 'lib/company-name.ts')).href);
  console.log(`comparing the working tree with lib/company-name.ts at ${rev}`);

  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/`;
  const headers = { apikey: process.env.SUPABASE_SECRET_KEY!, Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}` };
  const all = async (path: string) => {
    const rows: Array<Record<string, unknown>> = [];
    for (let off = 0; ; off += 1000) {
      const r = await (await fetch(base + path, { headers: { ...headers, Range: `${off}-${off + 999}` } })).json();
      if (!Array.isArray(r) || !r.length) break;
      rows.push(...r);
      if (r.length < 1000) break;
    }
    return rows;
  };
  const spec = await (await fetch(base, { headers })).json() as { definitions: Record<string, { properties: Record<string, unknown> }> };
  const sources = new Map<string, Set<string>>();
  for (const [table, def] of Object.entries(spec.definitions)) {
    for (const col of ['company_name', 'customer_name', 'entity_name', 'shareholder_name']) {
      if (!(col in def.properties) || table === 'companies') continue;
      sources.set(`${table}.${col}`, new Set((await all(`${table}?select=${col}&order=${col}.asc`)).map(r => String(r[col] ?? '')).filter(Boolean)));
    }
  }
  const companies = [...new Set((await all('companies?select=company_name&order=id.asc')).map(r => String(r.company_name)))];
  const names = new Set<string>(companies);
  for (const set of sources.values()) for (const n of set) names.add(n);
  console.log(`${companies.length} companies | ${sources.size} name columns | ${names.size} distinct names`);

  let keyDiffs = 0;
  for (const n of names) if (OLD.normalize(n) !== NEW.normalize(n)) keyDiffs++;
  console.log(`(0) normalize() output differs for ${keyDiffs} names${keyDiffs ? '  <-- STORED KEYS WOULD BE ORPHANED unless a migration is intended' : ' (good: stored keys stay valid)'}`);

  const moved = (o: number, w: number) => o !== w && (THRESHOLDS.some(t => (o >= t) !== (w >= t)) || (o === 100) !== (w === 100));
  // Every pair whose SCORE moved at all (a decision may not): a lowered score is a regression until
  // proven otherwise, and the set of values scores were raised TO shows what the change really does.
  let lowered = 0, raised = 0; const raisedTo = new Set<number>(); const loweredEx: string[] = [];
  const tally = (c: string, n: string, o: number, w: number) => {
    if (w < o) { lowered++; if (loweredEx.length < 10) loweredEx.push(`${o} -> ${w} | ${c}  ~  ${n}`); }
    else if (w > o) { raised++; raisedTo.add(w); }
  };
  const seen = new Set<string>(); const flips: string[] = []; let pairs = 0;
  for (const c of companies) for (const n of names) {
    if (c === n) continue;
    pairs++;
    const o = OLD.matchScore(c, n), w = NEW.matchScore(c, n);
    if (o !== w) tally(c, n, o, w);
    if (!moved(o, w)) continue;
    const key = [c, n].sort().join('||');
    if (seen.has(key)) continue;
    seen.add(key);
    flips.push(`${String(o).padStart(3)} -> ${String(w).padStart(3)} | ${c}  ~  ${n}`);
  }
  console.log(`(A) ${pairs} company x name pairs | decisions changed: ${flips.length}`);
  for (const f of flips.slice(0, 60)) console.log('    ', f);
  if (flips.length > 60) console.log(`     ... and ${flips.length - 60} more`);

  // (A2) pairs that involve no company name at all (a QuickBooks customer vs a Master List or
  // invoice name, ...): the app only ever compares names that share a search word, so group every
  // distinct name by its significantWord() and compare all pairs inside each group.
  const groups = new Map<string, string[]>();
  for (const n of names) {
    const w = NEW.significantWord(n);
    if (!w) continue;
    const list = groups.get(w) ?? groups.set(w, []).get(w)!;
    list.push(n);
  }
  let pairs2 = 0; const flips2: string[] = [];
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      pairs2++;
      const o = OLD.matchScore(list[i], list[j]), w = NEW.matchScore(list[i], list[j]);
      if (o !== w) tally(list[i], list[j], o, w);
      if (!moved(o, w)) continue;
      const key = [list[i], list[j]].sort().join('||');
      if (seen.has(key)) continue;
      seen.add(key);
      flips2.push(`${String(o).padStart(3)} -> ${String(w).padStart(3)} | ${list[i]}  ~  ${list[j]}`);
    }
  }
  console.log(`(A2) ${pairs2} name x name pairs inside the same search-word group | decisions changed (not already listed): ${flips2.length}`);
  for (const f of flips2.slice(0, 60)) console.log('    ', f);
  if (flips2.length > 60) console.log(`     ... and ${flips2.length - 60} more`);

  console.log(`(A+A2) pairs whose score moved at all: raised ${raised} (to: ${[...raisedTo].sort((a, b) => a - b).join(', ') || '-'}) | LOWERED ${lowered}${lowered ? '  <-- a lowered score can drop an existing match; judge each one' : ' (good: nothing got worse)'}`);
  for (const e of loweredEx) console.log('     lowered:', e);

  let picks = 0, ambiguity = 0; const rowsB: string[] = [];
  for (const [src, set] of sources) {
    const list = [...set];
    for (const c of companies) {
      const o = OLD.findUniqueBestMatch(c, list, (x: string) => x, 70), w = NEW.findUniqueBestMatch(c, list, (x: string) => x, 70);
      if (o.value === w.value && o.ambiguous === w.ambiguous) continue;
      if (o.value !== w.value) picks++;
      if (o.ambiguous !== w.ambiguous) ambiguity++;
      rowsB.push(`[${src}] ${c}  |  ${o.value ?? 'none'} (${o.score}${o.ambiguous ? ', ambiguous' : ''})  ->  ${w.value ?? 'none'} (${w.score}${w.ambiguous ? ', ambiguous' : ''})`);
    }
  }
  console.log(`(B) findUniqueBestMatch(>=70) over ${companies.length} companies x ${sources.size} columns: best pick changed ${picks} | ambiguity changed ${ambiguity}`);
  for (const r of rowsB.slice(0, 60)) console.log('    ', r);
  if (rowsB.length > 60) console.log(`     ... and ${rowsB.length - 60} more`);
})().catch(error => { console.error('FAILED:', error instanceof Error ? error.stack : error); process.exit(1); });
