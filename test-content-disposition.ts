// lib/content-disposition.ts — download names in HTTP headers (INV-DOC-022).
// A Chinese client name in Content-Disposition made `new Response()` throw
// (header values must be Latin-1), so the SOA PDF of 思店科技(杭州)有限公司
// 500'd and its download badge turned red. Also guards every route and
// downloader against going back to hand-built headers.
//
// Run: npx tsx test-content-disposition.ts
import fs from 'fs';
import path from 'path';
import { attachmentDisposition, filenameFromDisposition, headerDetail, wellFormed } from './lib/content-disposition';
import { safeFileLabel } from './lib/invoice-filename';

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

check('an accent falls back to "e_" in the plain name (the UTF-8 name keeps it)', /filename="Cafe_\.zip"/.test(attachmentDisposition('Café.zip')) && filenameFromDisposition(attachmentDisposition('Café.zip')) === 'Café.zip');

console.log('\n--- half of a character pair never crashes a header (council 2026-10-06) ---');
const emoji = '\u{1F600}';
const half = emoji.slice(0, 1); // a lone high surrogate, e.g. a string cut mid-emoji
check('wellFormed turns a lone surrogate into U+FFFD and leaves whole pairs alone', wellFormed(`a${half}b`) === 'a�b' && wellFormed(`a${emoji}b`) === `a${emoji}b`);
check('attachmentDisposition does not throw on a lone surrogate', (() => { try { return filenameFromDisposition(attachmentDisposition(`x${half}.pdf`)) === 'x�.pdf'; } catch { return false; } })());
const cutMidEmoji = 'a'.repeat(1499) + emoji + 'b'.repeat(10); // the emoji straddles UTF-16 index 1500
let detail = '';
let threw = false;
try { detail = headerDetail(cutMidEmoji); } catch { threw = true; }
check('headerDetail cuts by whole characters: the old slice(0,1500) threw URIError here', !threw && decodeURIComponent(detail) === 'a'.repeat(1499) + emoji, threw ? 'threw' : decodeURIComponent(detail).slice(-3));
check('headerDetail survives a lone surrogate in the text itself', (() => { try { return decodeURIComponent(headerDetail(`a${half}`)) === 'a�'; } catch { return false; } })());
const chineseDetail = headerDetail('思店科技(杭州)有限公司 — '.repeat(300));
check('headerDetail bounds the encoded size (a Chinese character encodes to 9) and reads back as a prefix', chineseDetail.length <= 6000 && '思店科技(杭州)有限公司 — '.repeat(300).startsWith(decodeURIComponent(chineseDetail)), String(chineseDetail.length));
check('headerDetail leaves ordinary short messages exactly as before', headerDetail('TAB #02610965: x y') === encodeURIComponent('TAB #02610965: x y'));
check('a header built from it is a valid Latin-1 value', (() => { try { new Response('x', { headers: { 'X-Soa-Merge-Error-Detail': headerDetail('思店科技 ' + emoji) } }); return true; } catch { return false; } })());

console.log('\n--- SOA email attachment names (Draft Helper cuts a name at "/") ---');
check('"S/B" in a company name no longer looks like a folder', safeFileLabel('ABC S/B Sdn Bhd') === 'ABC S B Sdn Bhd');
check('every Windows-forbidden character becomes a space, once', safeFileLabel('A<B>:"C"|D?*  E\\F') === 'A B C D E F', safeFileLabel('A<B>:"C"|D?*  E\\F'));
check('Chinese names and brackets are left alone', safeFileLabel('思店科技(杭州)有限公司') === '思店科技(杭州)有限公司');
check('the SOA attachment File is named through it', /new File\(\[blob\], `SOA \(\$\{book\}\) - \$\{safeFileLabel\(companyName\)\}\.pdf`/.test(fs.readFileSync(path.join(process.cwd(), 'lib', 'soa-actions-client.ts'), 'utf8')));

console.log('\n--- every route and downloader uses the helpers ---');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  const p = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walk(p);
  return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
});
const files = ['app', 'components', 'lib'].flatMap(d => walk(path.join(process.cwd(), d)));
const handBuilt = files.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
  .filter(({ line }) => /['"]Content-Disposition['"]\s*[:,]/i.test(line) && !/attachmentDisposition\(|filenameFromDisposition\(|headers\.get\(/i.test(line));
check('no route builds Content-Disposition by hand (any letter case)', handBuilt.length === 0, handBuilt.map(h => `${path.relative(process.cwd(), h.f)}:${h.i + 1}`).join(', '));
// Free text in a custom header must go through headerDetail(): a bare
// encodeURIComponent(x.slice(...)) throws URIError when the cut splits a pair.
const bareDetail = files.flatMap(f => fs.readFileSync(f, 'utf8').split('\n').map((line, i) => ({ f, i, line })))
  .filter(({ line }) => /['"]X-[A-Za-z0-9-]+['"]\s*:.*encodeURIComponent\(/.test(line));
check('no custom X-* header encodes free text by hand', bareDetail.length === 0, bareDetail.map(h => `${path.relative(process.cwd(), h.f)}:${h.i + 1}`).join(', '));
const oldParsers = files.filter(f => /filename="\(\[\^"\]\+\)"/.test(fs.readFileSync(f, 'utf8')));
check('no downloader parses only the ASCII filename', oldParsers.length === 0, oldParsers.map(f => path.relative(process.cwd(), f)).join(', '));

console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
process.exit(fail === 0 ? 0 : 1);
