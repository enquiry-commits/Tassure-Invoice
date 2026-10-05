// lib/statement-pdf.ts + lib/pdf-chinese-text.ts — the SOA PDF cover page a
// client receives prints a Chinese-registered client's QuickBooks name and
// full-width （）【】 with the embedded Chinese font (INV-DOC-011; before
// 2026-10-05 safeText() turned 思店科技(杭州)有限公司 into "()"), and falls
// back to safeText() — never fails — when the font is off, can't load, or
// lacks a character too.
//
// Run: npx tsx test-statement-cover-chinese.ts
import fs from 'fs';
import path from 'path';
import fontkit from '@pdf-lib/fontkit';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { drawStatementCoverPage, type StatementRow } from './lib/statement-pdf';
import { emptyAgingTotals } from './lib/soa';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};

const ttf = new Uint8Array(fs.readFileSync(path.join(process.cwd(), 'templates', 'client-invoice', 'NotoSansSC-Regular.ttf')));
const fontFile = async () => ttf;
const row = (name: string): StatementRow => ({
  companyName: name,
  aging: { ...emptyAgingTotals(), current: 4060 },
  totalOutstanding: 4060,
  lineItems: [
    { docNumber: '02610965', dueDate: '2026-08-27', txnDate: '2026-08-20', txnType: 'Invoice', amount: 1060, bucket: 'current' },
    { docNumber: '02680270', dueDate: '2026-08-27', txnDate: '2026-08-20', txnType: 'Invoice', amount: 3000, bucket: 'current' },
  ],
});
// The real descriptions of 思店科技's two open invoices, 2026-10-05.
const details = new Map([
  ['2610965', { invoiceNo: '02610965', description: '[Lzs Travel Pte. Ltd.]\nPerform secretarial services for one-year [from Mar 2026 - Feb 2027]' }],
  ['2680270', { invoiceNo: '02680270', description: '【Lzs Travel Pte. Ltd.】\nNominee director for one year (Mar 2026 - Feb 2027)' }],
]);

const englishDetails = new Map([
  ['2610965', { invoiceNo: '02610965', description: 'Perform secretarial services for one-year (Mar 2026 - Feb 2027)' }],
  ['2680270', { invoiceNo: '02680270', description: 'Nominee director for one year (Mar 2026 - Feb 2027)' }],
]);

type Shown = { font: string; text: string; mode2: boolean };
async function cover(name: string, loadFont: (() => Promise<Uint8Array>) | null, opts: { companyName?: string | null; billAddr?: string[]; details?: typeof details } = {}) {
  const pdf = await PDFDocument.create();
  await drawStatementCoverPage(pdf, 'Tassure Group', row(name), name, opts.companyName ?? null, opts.billAddr ?? [], opts.details ?? details, loadFont);
  const doc = await PDFDocument.load(await pdf.save());
  const contents = doc.getPage(0).node.Contents();
  const content = (contents instanceof PDFArray ? contents.asArray().map(r => doc.context.lookup(r)) : [contents]).map(s => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
  let subset: ReturnType<typeof fontkit.create> | null = null;
  let toUnicode = '';
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFDict)) continue;
    const file = obj.get(PDFName.of('FontFile2'));
    if (file) subset = fontkit.create(decodePDFRawStream(doc.context.lookup(file) as PDFRawStream).decode());
    const map = String(obj.get(PDFName.of('BaseFont')) ?? '').includes('NotoSansSC') ? obj.get(PDFName.of('ToUnicode')) : undefined;
    if (map) toUnicode = new TextDecoder().decode(decodePDFRawStream(doc.context.lookup(map) as PDFRawStream).decode());
  }
  const cjkByGid = new Map([...toUnicode.matchAll(/^<([0-9a-f]{4})> <([0-9a-f]+)>$/gim)].map(m => [m[1].toUpperCase(), String.fromCharCode(...m[2].match(/.{4}/g)!.map(h => parseInt(h, 16)))]));
  // Every text-showing operator, decoded: Helvetica strings are WinAnsi hex,
  // the Chinese font's are 4-hex glyph ids mapped back through ToUnicode.
  const shown: Shown[] = [];
  let mode2 = false;
  for (const m of content.matchAll(/(\d) Tr|\/(\S+?)-\d+ [\d.]+ Tf[\s\S]*?<([0-9A-F]+)> Tj|\bQ\b/g)) {
    if (m[1]) { mode2 = m[1] === '2'; continue; }
    if (!m[2]) { mode2 = false; continue; }
    const hex = m[3];
    const text = m[2].startsWith('NotoSansSC') ? (hex.match(/.{4}/g) ?? []).map(g => cjkByGid.get(g) ?? '?').join('') : Buffer.from(hex, 'hex').toString('latin1');
    shown.push({ font: m[2], text, mode2 });
  }
  return { shown, glyphChars: [...cjkByGid.values()], subset };
}
const line = (s: Shown[], from: number) => s.slice(from).map(x => x.text).join('');

(async () => {
  console.log('--- a Chinese-registered client (思店科技(杭州)有限公司, TAB+TAC) ---');
  const sidian = await cover('思店科技(杭州)有限公司', fontFile);
  const nameAt = sidian.shown.findIndex(s => s.text === '思店科技');
  check('the TO line prints the full Chinese name, not "()"', nameAt >= 0 && line(sidian.shown, nameAt).startsWith('思店科技(杭州)有限公司'), JSON.stringify(sidian.shown.slice(Math.max(0, nameAt), nameAt + 5)));
  check('its ASCII brackets stay Helvetica-Bold; only the Chinese characters use the Chinese font', sidian.shown.some(s => s.font === 'Helvetica-Bold' && s.text === '(') && !sidian.glyphChars.includes('('));
  const nameRuns = sidian.shown.filter(s => s.font.startsWith('NotoSansSC') && /[一-鿿]/.test(s.text));
  check('the bold TO name draws its Chinese characters faux-bold (fill + outline)', nameRuns.length > 0 && nameRuns.every(s => s.mode2));
  check('the full-width 【】 in a description print (were dropped), in regular weight', sidian.shown.some(s => s.text === '【' && !s.mode2) && sidian.shown.some(s => s.text === '】' && !s.mode2));
  const wanted = [...new Set('思店科技杭州有限公司【】')].sort().join('');
  check('the Chinese font carries exactly the Chinese characters drawn', [...sidian.glyphChars].sort().join('') === wanted, [...sidian.glyphChars].sort().join(''));
  const original = fontkit.create(ttf);
  const corrupted = [...sidian.glyphChars.entries()].filter(([i, ch]) => { try { return sidian.subset!.getGlyph(i + 1).path.toSVG() !== original.glyphForCodePoint(ch.codePointAt(0)!).path.toSVG(); } catch { return true; } });
  check('every embedded character has its original outline (none corrupted)', !!sidian.subset && corrupted.length === 0, corrupted.map(([, ch]) => ch).join(''));

  console.log('\n--- a Chinese CompanyName and address line too ---');
  const full = await cover('江苏日月照明电器有限公司', fontFile, { companyName: '江苏日月照明电器有限公司', billAddr: ['中国江苏省 Some Road 88号'] });
  check('the QuickBooks CompanyName prints in Chinese', full.shown.filter(s => s.text.includes('江苏日月照明电器有限公司')).length === 2);
  check('a mixed Chinese/English address line prints whole', full.shown.some(s => s.text === '中国江苏省') && full.shown.some(s => s.text === ' Some Road 88') && full.shown.some(s => s.text === '号'));

  console.log('\n--- English-only clients are untouched ---');
  const english = await cover('1V Capital Pte. Ltd.', fontFile, { companyName: '1V Capital Pte. Ltd.', details: englishDetails });
  check('no Chinese font is embedded when nothing needs it', !english.subset && english.shown.every(s => s.font.startsWith('Helvetica')));
  check('the name prints as before', english.shown.some(s => s.font === 'Helvetica-Bold' && s.text === '1V Capital Pte. Ltd.'));

  console.log('\n--- fallbacks never break the Statement (INV-DOC-011) ---');
  const noFont = await cover('思店科技(杭州)有限公司', null);
  check('without the font: safeText() as before ("()")', noFont.shown.some(s => s.text === '()') && !noFont.subset);
  const failing = await cover('思店科技(杭州)有限公司', async () => { throw new Error('ENOENT'); });
  check('a font that fails to load: safeText() as before, no error', failing.shown.some(s => s.text === '()') && !failing.subset);
  const thai = await cover('ภาษาไทย Co., Ltd.', fontFile);
  check('a character neither font has: safeText() as before, no error', thai.shown.some(s => s.font === 'Helvetica-Bold' && s.text === 'Co., Ltd.'));

  console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
