// lib/client-invoice-model.ts + lib/client-invoice-render.ts — the invoice PDF a
// CLIENT receives (INV-QB-029). Fixtures are real invoice shapes (2026-10-05):
// 1X EXCHANGE TAB #02611112, Advance CF TAC #02680320, Anmed TAC #02680138.
//
// Run: npx tsx test-client-invoice-model.ts
import fs from 'fs';
import path from 'path';
import { PDFArray, PDFDocument, PDFDict, PDFName, PDFRawStream, StandardFonts, decodePDFRawStream } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { buildClientInvoiceModel, billToLines, type QbInvoiceJson } from './lib/client-invoice-model';
import { renderClientInvoicePdf, ClientInvoiceRenderError } from './lib/client-invoice-render';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};
type Line = NonNullable<QbInvoiceJson['Line']>[number];
const item = (name: string, amount: number, description = '', qty = 1): Line => ({ DetailType: 'SalesItemLineDetail', Amount: amount, Description: description, SalesItemLineDetail: { ItemRef: { name }, Qty: qty, UnitPrice: amount / qty } });
const sub = (amount: number): Line => ({ DetailType: 'SubTotalLineDetail', Amount: amount });
const oneX: QbInvoiceJson = {
  DocNumber: '02611112', TxnDate: '2026-10-01', DueDate: '2026-10-08', TotalAmt: 1360, CurrencyRef: { value: 'SGD' },
  CustomerRef: { name: '1X Exchange Pte. Ltd.' },
  BillAddr: { Id: '10685', Line1: '140 ROBINSON ROAD', City: '#17-04 TAHIR BUILDING', PostalCode: 'SINGAPORE 068907' },
  Line: [
    item('Secretary:Corporate Secretarial Services', 175, 'Perform secretarial services for one-year [from Oct 2026 - Sep 2027]'),
    item('Deferred Revenue - Corp Sec', 525),
    item('Disbursement:Government fee for filing Annual Return', 60, '- Government fee for ACRA filing of Annual Return [FYE 31.12.2026]'),
    item('Secretary:Company XBRL Services', 600, 'XBRL for the year (FYE 31.12.2026)'),
    sub(1360),
  ],
};

console.log('--- which PDF a client gets ---');
const d1 = buildClientInvoiceModel(oneX, 'TAB', 'Net 7');
check('1X EXCHANGE: drawn by the system', d1.kind === 'system');
if (d1.kind === 'system') {
  check('1X: Secretary once at 700, then 60 and 600', JSON.stringify(d1.model.rows.map(r => r.amount)) === '[700,60,600]');
  check('1X: total 1,360 = QuickBooks TotalAmt', d1.model.total === 1360);
  check('1X: invoice no. printed as "TAB 02611112"', d1.model.invoiceNo === 'TAB 02611112');
  check('1X: dates as dd/mm/yyyy', d1.model.date === '01/10/2026' && d1.model.dueDate === '08/10/2026');
  check('1X: BILL TO = name + street + building + postcode', JSON.stringify(d1.model.billTo) === JSON.stringify(['1X Exchange Pte. Ltd.', '140 ROBINSON ROAD', '#17-04 TAHIR BUILDING', 'SINGAPORE 068907']));
}
const plain: QbInvoiceJson = { ...oneX, TotalAmt: 1435, Line: [item('Secretary:Corporate Secretarial Services', 775, 'sec'), item('Secretary:Company XBRL Services', 660, 'xbrl'), sub(1435)] };
check('an invoice with no Deferred line keeps QuickBooks\' own PDF, no warning', JSON.stringify(buildClientInvoiceModel(plain, 'TAB', 'Net 7')) === JSON.stringify({ kind: 'quickbooks', reason: null }));
const anmed: QbInvoiceJson = {
  DocNumber: '02680138', TxnDate: '2026-04-30', DueDate: '2026-05-07', TotalAmt: 6000, CurrencyRef: { value: 'SGD' }, CustomerRef: { name: 'Anmed Technologies Pte. Ltd' },
  BillAddr: { Line1: 'Anmed Technologies Pte. Ltd', Line2: '10 Anson Road #12-08  International Plaza  Singapore 079903' },
  Line: [item('Secretary:Nominee Director Fees - NKH', 2250, 'Nominee director service one year [Apr 2026 - Dec 2026]'), item('Deferred - ND Fees - NKH', 750, 'Nominee director service one year [Jan 2027 - Mar 2027]'), item('Secretary:Nominee Director Deposit', 3000, 'Nominee Director Deposit'), sub(6000)],
};
const dA = buildClientInvoiceModel(anmed, 'TAC', 'Net 7');
check('Anmed (twin describes another period): QuickBooks\' PDF WITH a reason for staff', dA.kind === 'quickbooks' && !!dA.reason);
const withDiscount: QbInvoiceJson = { ...oneX, Line: [...oneX.Line!, { DetailType: 'DiscountLineDetail', Amount: 50 }] };
check('a QuickBooks discount line → QuickBooks\' PDF with a reason', (() => { const d = buildClientInvoiceModel(withDiscount, 'TAB', 'Net 7'); return d.kind === 'quickbooks' && /DiscountLineDetail/.test(d.reason ?? ''); })());
check('USD invoice → QuickBooks\' PDF with a reason', (() => { const d = buildClientInvoiceModel({ ...oneX, CurrencyRef: { value: 'USD' } }, 'TAB', 'Net 7'); return d.kind === 'quickbooks' && !!d.reason; })());
check('tax on the invoice → QuickBooks\' PDF with a reason', (() => { const d = buildClientInvoiceModel({ ...oneX, TxnTaxDetail: { TotalTax: 10 } }, 'TAB', 'Net 7'); return d.kind === 'quickbooks' && !!d.reason; })());
check('terms unreadable → QuickBooks\' PDF with a reason', (() => { const d = buildClientInvoiceModel(oneX, 'TAB', null); return d.kind === 'quickbooks' && !!d.reason; })());
check('lines not adding up to TotalAmt → QuickBooks\' PDF with a reason', (() => { const d = buildClientInvoiceModel({ ...oneX, TotalAmt: 1361 }, 'TAB', 'Net 7'); return d.kind === 'quickbooks' && /add up/.test(d.reason ?? ''); })());
check('TAO split invoice → QuickBooks\' PDF with a reason (TAO not redrawn)', (() => { const d = buildClientInvoiceModel(oneX, 'TAO', 'Net 7'); return d.kind === 'quickbooks' && !!d.reason; })());

console.log('\n--- BILL TO as QuickBooks prints it ---');
check('address repeating the name prints the name once (Anmed)', JSON.stringify(billToLines('Anmed Technologies Pte. Ltd', anmed.BillAddr)) === JSON.stringify(['Anmed Technologies Pte. Ltd', '10 Anson Road #12-08  International Plaza  Singapore 079903']));
check('no address → the name only (Advance CF)', JSON.stringify(billToLines('Advance CF Technology Pte. Ltd.', { Id: '2018' })) === JSON.stringify(['Advance CF Technology Pte. Ltd.']));

console.log('\n--- drawing ---');
(async () => {
  const dir = path.join(process.cwd(), 'templates', 'client-invoice');
  const asset = (book: string, kind: string) => new Uint8Array(fs.readFileSync(path.join(dir, `${book}-${kind}.png`)));
  if (d1.kind === 'system') {
    const bytes = await renderClientInvoicePdf(d1.model, { header: asset('tab', 'header'), footer: asset('tab', 'footer'), qr: asset('tab', 'qr') });
    const doc = await PDFDocument.load(bytes);
    check('1X renders to a one-page US Letter PDF', doc.getPageCount() === 1 && Math.round(doc.getPage(0).getWidth()) === 612 && Math.round(doc.getPage(0).getHeight()) === 792);
    const longRows = { ...d1.model, rows: Array.from({ length: 30 }, (_, i) => ({ description: `Service ${i + 1}\n- detail line one\n- detail line two`, amount: 10 })), total: 300 };
    const long = await PDFDocument.load(await renderClientInvoicePdf(longRows, { header: asset('tab', 'header'), footer: asset('tab', 'footer'), qr: asset('tab', 'qr') }));
    check('a long invoice flows onto more pages instead of overlapping the footer', long.getPageCount() >= 2);
    let refused = false;
    try { await renderClientInvoicePdf({ ...d1.model, billTo: ['吉木锌国际贸易（上海）有限公司'] }, { header: asset('tab', 'header'), footer: asset('tab', 'footer'), qr: asset('tab', 'qr') }); } catch (err) { refused = err instanceof ClientInvoiceRenderError; }
    check('without the Chinese font, Chinese text is refused (caller sends QuickBooks\' PDF), never dropped', refused);
    const ttf = new Uint8Array(fs.readFileSync(path.join(dir, 'NotoSansSC-Regular.ttf')));
    const chineseModel = { ...d1.model, billTo: ['吉木锌国际贸易（上海）有限公司', '10 Anson Road'], rows: [{ description: '秘书服务【2026年】 Corporate Secretarial Services (01/10/2026 - 30/09/2027)', amount: 700 }, ...d1.model.rows.slice(1)] };
    const chinese = await renderClientInvoicePdf(chineseModel, { header: asset('tab', 'header'), footer: asset('tab', 'footer'), qr: asset('tab', 'qr'), cjkFont: async () => ttf });
    const chineseDoc = await PDFDocument.load(chinese);
    check('with the Chinese font, a Chinese client name and line draw on one page', chineseDoc.getPageCount() === 1);
    check('only the glyphs used are embedded (the PDF stays small)', chinese.length < 600_000, `${chinese.length} bytes`);
    // pdf-lib's subsetter writes halved (short) glyph offsets, so a font with
    // odd-length glyph data embeds corrupted outlines while the page still
    // "renders" — compare each embedded glyph with the original outline of
    // the character the PDF's ToUnicode map says it is.
    const original = fontkit.create(ttf);
    let subset: ReturnType<typeof fontkit.create> | null = null;
    let toUnicode = '';
    for (const [, obj] of chineseDoc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const file = obj.get(PDFName.of('FontFile2'));
      if (file) subset = fontkit.create(decodePDFRawStream(chineseDoc.context.lookup(file) as PDFRawStream).decode());
      const map = String(obj.get(PDFName.of('BaseFont')) ?? '').includes('NotoSansSC') ? obj.get(PDFName.of('ToUnicode')) : undefined;
      if (map) toUnicode = new TextDecoder().decode(decodePDFRawStream(chineseDoc.context.lookup(map) as PDFRawStream).decode());
    }
    const glyphChars = [...toUnicode.matchAll(/^<([0-9a-f]{4})> <([0-9a-f]+)>$/gim)].map(m => [parseInt(m[1], 16), String.fromCharCode(...m[2].match(/.{4}/g)!.map(h => parseInt(h, 16)))] as const);
    const corrupted = glyphChars.filter(([gid, ch]) => { try { return subset!.getGlyph(gid).path.toSVG() !== original.glyphForCodePoint(ch.codePointAt(0)!).path.toSVG(); } catch { return true; } });
    check('every character embedded from the Chinese font has its own original outline (none corrupted)', !!subset && glyphChars.length > 15 && glyphChars.length === subset.numGlyphs - 1 && corrupted.length === 0, `${glyphChars.length} characters mapped, ${subset ? subset.numGlyphs - 1 : 0} glyphs embedded, corrupted: ${corrupted.map(([, ch]) => ch).join('')}`);
    const chineseChars = [...new Set([...chineseModel.billTo, ...chineseModel.rows.map(r => r.description)].join('').match(/[　-鿿＀-￯]/g))].sort().join('');
    const fromCjkFont = glyphChars.map(([, ch]) => ch).sort().join('');
    check('only the Chinese characters use the Chinese font — English on the same line stays Helvetica', fromCjkFont === chineseChars, `Chinese font drew "${fromCjkFont}"`);
    let thai = '';
    try { await renderClientInvoicePdf({ ...chineseModel, billTo: ['ภาษาไทย Co., Ltd.'] }, { header: asset('tab', 'header'), footer: asset('tab', 'footer'), qr: asset('tab', 'qr'), cjkFont: async () => ttf }); } catch (err) { thai = err instanceof ClientInvoiceRenderError ? err.message : `other error: ${String(err)}`; }
    check('a character neither font has is refused even with the Chinese font (never an empty box)', /U\+0E20/.test(thai), thai);
    // pdf-lib's Helvetica width subtracts kerning that drawText never applies,
    // so the 】 after "Lzs Travel Pte. Ltd." once started ~3pt inside the text.
    const latinText = 'Lzs Travel Pte. Ltd.';
    const mixed = await PDFDocument.load(await renderClientInvoicePdf({ ...chineseModel, billTo: [`${latinText}】`] }, { header: asset('tab', 'header'), footer: asset('tab', 'footer'), qr: asset('tab', 'qr'), cjkFont: async () => ttf }));
    const contents = mixed.getPage(0).node.Contents();
    const content = (contents instanceof PDFArray ? contents.asArray().map(r => mixed.context.lookup(r)) : [contents]).map(s => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString('latin1')).join('\n');
    const shows = [...content.matchAll(/\/(\S+?)-\d+ [\d.]+ Tf\s+[\d.]+ TL\s+1 0 0 1 ([\d.]+) ([\d.]+) Tm\s+<([0-9A-F]+)> Tj/g)].map(m => ({ font: m[1], x: Number(m[2]), y: Number(m[3]), hex: m[4] }));
    const latin = shows.find(s => s.font === 'Helvetica' && s.hex === Buffer.from(latinText, 'latin1').toString('hex').toUpperCase());
    const bracket = latin && shows.find(s => s.font.startsWith('NotoSansSC') && Math.abs(s.y - latin.y) < 0.01);
    const helvetica = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const viewerWidth = [...latinText].reduce((w, ch) => w + helvetica.widthOfTextAtSize(ch, 10), 0);
    check('the Chinese character after English text starts where a viewer ends that text (no overlap)', !!latin && !!bracket && viewerWidth - helvetica.widthOfTextAtSize(latinText, 10) > 1 && Math.abs(bracket.x - latin.x - viewerWidth) < 0.01, latin && bracket ? `gap ${(bracket.x - latin.x).toFixed(2)} vs text ${viewerWidth.toFixed(2)}` : 'runs not found');
  }
  console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
