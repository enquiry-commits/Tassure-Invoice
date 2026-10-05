// lib/client-invoice-model.ts + lib/client-invoice-render.ts — the invoice PDF a
// CLIENT receives (INV-QB-029). Fixtures are real invoice shapes (2026-10-05):
// 1X EXCHANGE TAB #02611112, Advance CF TAC #02680320, Anmed TAC #02680138.
//
// Run: npx tsx test-client-invoice-model.ts
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
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
    check('a character the PDF font has no glyph for is refused (caller sends QuickBooks\' PDF), never dropped', refused);
  }
  console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
