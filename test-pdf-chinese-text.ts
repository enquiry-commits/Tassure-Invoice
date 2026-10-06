// lib/pdf-chinese-text.ts wrapText() — what the council found on 2026-10-06:
// breaking an over-long word one character at a time took 4 s for 300
// unspaced Chinese characters, and cut through a surrogate pair so a rare
// character the font HAS (U+20087) was refused as "U+D840". The bisecting,
// whole-character version must wrap ordinary text EXACTLY as before.
//
// Run: npx tsx test-pdf-chinese-text.ts
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { prepareChineseText, wrapText, loadChineseFont } from './lib/pdf-chinese-text';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};

// The algorithm as it was before 2026-10-06 (code-unit slices, linear search),
// kept here as the reference for text without astral characters.
function oldWrap(text: string, widthOf: (s: string) => number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').replace(/\t/g, ' ').split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) out.push(line);
      let rest = word;
      while (widthOf(rest) > maxWidth) {
        let n = rest.length - 1;
        while (n > 1 && widthOf(rest.slice(0, n)) > maxWidth) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

(async () => {
  console.log('--- the same lines as before for ordinary text ---');
  const width = (s: string) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) < 128 ? 5.3 : 10), 0);
  const sentence = 'Perform secretarial services for one-year (Aug 2026 - Jul 2027)';
  const cases: [string, string, number][] = [
    ['an English sentence', sentence, 200],
    ['two paragraphs with a blank line', `${sentence}\n\n- Safe custody of statutory records i.e. keeping minute files and statutory registers`, 250],
    ['one word wider than the column', 'Supercalifragilisticexpialidocious'.repeat(3), 120],
    ['an address jammed into one line (TAC #02680202)', 'No.999,Guangming Road ,Economic Development Zone ,Jianhu ,Yancheng city ,Jiangsu Province ,China  zip code:224700', 355],
    ['unspaced Chinese', '思店科技杭州有限公司'.repeat(12), 200],
    ['Chinese mixed with English', '【Lzs Travel Pte. Ltd.】 秘书服务 Nominee director for one year （Mar 2026 - Feb 2027）', 180],
    ['a double space and trailing newline', 'China  zip code:224700\n', 90],
    ['an empty string', '', 100],
  ];
  for (const [label, text, max] of cases) {
    const a = oldWrap(text, width, max);
    const b = wrapText(text, width, max);
    check(label, JSON.stringify(a) === JSON.stringify(b), JSON.stringify({ old: a, now: b }).slice(0, 300));
  }

  console.log('\n--- speed and rare characters (real Chinese font) ---');
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const sample = '思店科技杭州有限公司';
  const long = sample.repeat(30); // 300 unspaced Chinese characters
  const rare = '\u{20087}'; // CJK Extension B, in the font
  const astral = rare.repeat(70);
  const chinese = await prepareChineseText(doc, helv, [long, astral], loadChineseFont);
  const t0 = performance.now();
  const lines = wrapText(long, s => chinese.widthOf(s, helv, 10), 405);
  const ms = performance.now() - t0;
  check('300 unspaced Chinese characters wrap in well under a second (the old search took ~4 s)', ms < 1000 && lines.length > 5 && lines.join('') === long, `${ms.toFixed(0)} ms, ${lines.length} lines`);
  check('every wrapped line fits the column', lines.every(l => chinese.widthOf(l, helv, 10) <= 405));
  let astralLines: string[] = [];
  let astralError = '';
  try { astralLines = wrapText(astral, s => chinese.widthOf(s, helv, 10), 405); } catch (err) { astralError = (err as Error).message; }
  check('a rare character the font has is wrapped whole, never refused as half a pair (was "U+D840")', !astralError && astralLines.join('') === astral && astralLines.every(l => !/[\uD800-\uDBFF]$/.test(l) && !/^[\uDC00-\uDFFF]/.test(l)), astralError);

  console.log('\n--- error messages cut by whole characters ---');
  let message = '';
  try { chinese.widthOf('a'.repeat(39) + rare + 'ภ' + 'b', helv, 10); } catch (err) { message = (err as Error).message; }
  check('a refused character is named and the quoted start is well-formed', /U\+0E20/.test(message) && !/[\uD800-\uDFFF]/.test(message.replace(/\u{20087}/gu, '')), message);

  console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
