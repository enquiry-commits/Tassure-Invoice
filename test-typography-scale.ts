// Run: npx tsx test-typography-scale.ts
// INV-UI-002: font sizes in app/ and components/ come from one small scale; weights are 400/500/600/700.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SCALE = new Set([9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28]);
const WEIGHTS = new Set([400, 500, 600, 700]);
const files: string[] = ['app/globals.css'];
const walk = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) { if (n !== 'node_modules') walk(p); } else if (/\.tsx?$/.test(n)) files.push(p); } };
walk('app'); walk('components');

const bad: string[] = [];
const re: [RegExp, 'size' | 'weight'][] = [
  [/fontSize: *(\d+(?:\.\d+)?)\b(?![\w.%])/g, 'size'], [/font-size: *(\d+(?:\.\d+)?)px/g, 'size'],
  [/fontWeight: *(\d+)\b/g, 'weight'], [/font-weight: *(\d{3})\b/g, 'weight'],
];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const [r, kind] of re) for (const m of text.matchAll(r)) {
    const v = Number(m[1]);
    if (!(kind === 'size' ? SCALE : WEIGHTS).has(v)) bad.push(`${f}: ${kind} ${v} (${text.slice(0, m.index).split('\n').length})`);
  }
}
if (bad.length) { console.log(bad.join('\n')); console.log(`\n${bad.length} off-scale value(s)`); process.exit(1); }
console.log(`OK  ${files.length} files: every font size is on the scale ${[...SCALE].join('/')}, weights 400-700\n\nALL OK`);
