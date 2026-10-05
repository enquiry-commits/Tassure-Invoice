// lib/content-disposition.ts — download names in HTTP headers (INV-DOC-022).
// A Chinese client name in Content-Disposition made `new Response()` throw
// (header values must be Latin-1), so the SOA PDF of 思店科技(杭州)有限公司
// 500'd and its download badge turned red. Also guards every route and
// downloader against going back to hand-built headers.
//
// Run: npx tsx test-content-disposition.ts
import fs from 'fs';
import path from 'path';
import { attachmentDisposition, filenameFromDisposition } from './lib/content-disposition';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};

console.log('--- names survive the header ---');
const names = [
  'SOA - 思店科技(杭州)有限公司 - 2026-10-05.pdf',
  'SOA - 江苏日月照明电器有限公司 - 2026-10-05.pdf',
  'Turnover - 吉木锌国际贸易（上海）有限公司 【FY2025】 - 2026-10-05.xlsx',
  `O'Brien "Quoted" (Pte) Ltd* - Café.zip`,
  'TAB A-R Ageing - 2026-10-05.xlsx',
];
for (const name of names) {
  const header = attachmentDisposition(name);
  let built = true;
  try { new Response('x', { headers: { 'Content-Disposition': header } }); } catch { built = false; }
  check(`a response can carry it: ${name}`, built, header);
  check(`  and the download name reads back exactly`, filenameFromDisposition(header) === name, String(filenameFromDisposition(header)));
  const ascii = /filename="([^"]*)"/.exec(header)?.[1] ?? '';
  check('  with a plain-ASCII fallback name', /^[\x20-\x7e]+$/.test(ascii) && !ascii.includes('"'), ascii);
}
const fallback = /filename="([^"]*)"/.exec(attachmentDisposition(names[2]))?.[1];
check('the fallback keeps full-width brackets as ASCII ones', fallback === 'Turnover - _(_)_ _FY2025_ - 2026-10-05.xlsx', fallback);
check('an old-style header still reads', filenameFromDisposition('attachment; filename="Tassure-Reports-2026-10-05.xlsx"') === 'Tassure-Reports-2026-10-05.xlsx');
check('no header → no name', filenameFromDisposition(null) === null && filenameFromDisposition('attachment') === null);

console.log('\n--- every route and downloader uses the helpers ---');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(p);
  return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
});
const files = ['app', 'components', 'lib'].flatMap(d => walk(path.join(process.cwd(), d)));
const handBuilt = files.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
  .filter(({ line }) => /['"]Content-Disposition['"]\s*[:,]/.test(line) && !/attachmentDisposition\(|filenameFromDisposition\(|headers\.get\(/.test(line));
check('no route builds Content-Disposition by hand', handBuilt.length === 0, handBuilt.map(h => `${path.relative(process.cwd(), h.f)}:${h.i + 1}`).join(', '));
const oldParsers = files.filter(f => /filename="\(\[\^"\]\+\)"/.test(fs.readFileSync(f, 'utf8')));
check('no downloader parses only the ASCII filename', oldParsers.length === 0, oldParsers.map(f => path.relative(process.cwd(), f)).join(', '));

console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
process.exit(fail === 0 ? 0 : 1);
