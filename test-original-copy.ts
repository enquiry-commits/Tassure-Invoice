// The original invoice attached to an invoice in QuickBooks (INV-QB-037):
// lib/original-copy.ts (is THIS PDF the unsplit original — and whose, and which
// attached file to use), lib/pdf-text.ts (reading a real PDF: text per page,
// producer, and that the SOA can merge it), lib/quickbooks-attachments-http.ts's
// reader (against a fake fetch), and that the client invoice PDF consults it
// before it redraws. Nothing here touches QuickBooks.
//
// The council that reviewed the first version (2026-10-06) got 7 wrong files
// past the amounts-only check; every one of them is a test below. The same
// proof was also run on 20 real files saved from QuickBooks: every attached
// copy of an unsplit TAB invoice accepted, every current QuickBooks PDF of a
// split invoice refused.
//
// Run: npx tsx test-original-copy.ts
import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { INVOICE_COPY_NOTE } from './lib/quickbooks-attachments';
import {
  MAX_ORIGINAL_BYTES, acceptableLineSets, checkOriginalCopy, formatMoney, invoiceFacts, printedAmounts, selectVerifiedOriginal,
  type AttachmentFile, type InvoiceFacts, type PdfFacts,
} from './lib/original-copy';
import { readPdf } from './lib/pdf-text';
import { createHttpAttachmentReader } from './lib/quickbooks-attachments-http';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};
const bytesOf = (n: number, fill = 7) => new Uint8Array(new ArrayBuffer(n)).fill(fill);

// An owner-password-only PDF (made with PyMuPDF): pdf.js reads it, pdf-lib refuses it.
const ENCRYPTED_PDF_B64 = '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RrESle9C/HIckzz4Y52Jje3C75tHD7pwXwplbmRzdHJlYW0KZW5kb2JqCgoxNCAwIG9iago8PC9MZW5ndGggMTEyL0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQp+rK+X6dKxPlGSRJ38VCEPmFPSXLXIhroM5Ht9qijsOHEuhGTGRfikomz6yZxINxniGcDaKexCJUvU3lApSLgqk/NbQziTtDozdy2ztJSTBHBkGaKT7O6sBgLCsqJyYVqP7DsGS9VmRxYv/KFVhnrZCmVuZHN0cmVhbQplbmRvYmoKCjE1IDAgb2JqCjw8L0xlbmd0aCA5Nj4+CnN0cmVhbQoNWe0AiPlQBQEFtAbmS5yWcWGWdIZXPVoumehQyo90gh/GSR4Homf23EoWGN3wGe+Lc/v/E+GSOTpnrgofEVpnXYqhMRT6GSSfUP/qwszwma+8o2sIs+n9yJna4vKQTh8KZW5kc3RyZWFtCmVuZG9iagoKMTYgMCBvYmoKPDwvUHJvZHVjZXI8NjUzNzlFNjNGQjk2RkZDOTlCNzZFOTgxNzcyQTRCNzY2NkQ2Q0ZBMkZERkUwMjA2MDI2OUE1MzA5MzY0MjRCQTk5QUQxMjQ0MTA0ODMyQzgxNjM4RTc4NTNCRDc5RjQ2Pj4+CmVuZG9iagoKeHJlZgowIDE3CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA0MiAwMDAwMCBuIAowMDAwMDAwMTcyIDAwMDAwIG4gCjAwMDAwMDAyMjQgMDAwMDAgbiAKMDAwMDAwMDI2NSAwMDAwMCBuIAowMDAwMDAwNDMyIDAwMDAwIG4gCjAwMDAwMDA1MjEgMDAwMDAgbiAKMDAwMDAwMDY1MCAwMDAwMCBuIAowMDAwMDAwODMxIDAwMDAwIG4gCjAwMDAwMDA5OTMgMDAwMDAgbiAKMDAwMDAwMTEzOCAwMDAwMCBuIAowMDAwMDAxMzAxIDAwMDAwIG4gCjAwMDAwMDE0ODMgMDAwMDAgbiAKMDAwMDAwMTY4MSAwMDAwMCBuIAowMDAwMDAxODQ0IDAwMDAwIG4gCjAwMDAwMDIwMjYgMDAwMDAgbiAKMDAwMDAwMjE3MiAwMDAwMCBuIAoKdHJhaWxlcgo8PC9TaXplIDE3L0luZm8gMTYgMCBSL1Jvb3QgMSAwIFIvSURbPDVDMTZDMkE4QzM5N0MyOUVDMkE4QzNBNzU0NjhDMzhBPjxGMTU3RTZEQkEwRUYyN0EzNjgxMzM4NUE3MTFGNDkwND5dL0VuY3J5cHQ8PC9GaWx0ZXIvU3RhbmRhcmQvUiA0L1YgNC9MZW5ndGggMTI4L1AgLTM5MDAvRW5jcnlwdE1ldGFkYXRhIHRydWUvU3RtRi9TdGRDRi9TdHJGL1N0ZENGL0NGPDwvU3RkQ0Y8PC9BdXRoRXZlbnQvRG9jT3Blbi9DRk0vQUVTVjIvTGVuZ3RoIDE2Pj4+Pi9PPDkxM0IwNzNGNUI2NTk1NEM4QjZEQTIyMTY5OTcxQTE3N0I3RTZEOTRBMTA2RkY3NUMwQzE2Mjk2QkMxNTQxMkU+L1U8QjZEQjVGOEY3OEM3RUUzRTk4Q0M0MTE2M0VBN0NEN0YyOEJGNEU1RTRFNzU4QTQxNjQwMDRFNTZGRkZBMDEwOD4+Pj4+CnN0YXJ0eHJlZgoyMzAxCiUlRU9GCg==';

// What a real QuickBooks (Aspose) invoice page says, in the order pdf.js reads it.
const page = (o: { no?: string; date?: string; due?: string; customer?: string; lines: [string, number][]; total: number; totalLabel?: string; head?: string }) => [
  'Accounting Auditing Company Setup Licensing Application Secretary Taxation High Net Worth',
  'TASSURE ASIA BIZSERVICES PTE. LTD.',
  'Registration No.: 201325157G',
  o.head ?? 'INVOICE',
  `INVOICE NO. : ${o.no ?? 'TAB 02611112'}`,
  'TERMS : Net 7',
  `DATE : ${o.date ?? '01/10/2026'}`,
  'BILL TO:',
  o.customer ?? '1X Exchange Pte. Ltd.',
  `DUE DATE : ${o.due ?? '08/10/2026'}`,
  'DESCRIPTION AMOUNT (S$)',
  ...o.lines.map(([d, a]) => `${d} ${formatMoney(a)}`),
  'Payment is due seven (7) days from the invoice date.',
  `${o.totalLabel ?? 'TOTAL'} ${formatMoney(o.total)}`,
  'PAYMENT DETAILS: Account Name : TASSURE ASIA BIZSERVICES PTE. LTD.',
].join('\n');
const pdf = (text: string, over: Partial<PdfFacts> = {}): PdfFacts => ({ text, pages: [text], totalPages: 1, producer: 'Aspose.Words for Java 20.11.0', ...over });

// 1X EXCHANGE TAB #02611112 (real shape): the service was 700.00 when the
// client got it; accounting later split it into 175.00 + 525.00.
const L1 = (n: number, d = false) => ({ amount: n, deferred: d });
const FACTS: InvoiceFacts = { invoiceNo: 'TAB 02611112', date: '01/10/2026', customer: '1X Exchange Pte. Ltd.', total: 1360, lines: [L1(175), L1(525, true), L1(60), L1(600)], preferred: [700, 60, 600] };
const ORIGINAL = page({ lines: [['Corporate Secretarial Services', 700], ['Government fee for filing Annual Return [FYE 31.12.2026]', 60], ['XBRL for the year (FYE 31.12.2026)', 600]], total: 1360 });
const SPLIT = page({ lines: [['Corporate Secretarial Services', 175], ['Deferred Revenue - Corp Sec', 525], ['Government fee for filing Annual Return [FYE 31.12.2026]', 60], ['XBRL for the year (FYE 31.12.2026)', 600]], total: 1360 });
const reasonOf = (r: { ok: boolean }) => ('reason' in r ? String((r as { reason: string }).reason) : '');

(async () => {
  console.log('--- what a PDF prints ---');
  const p = printedAmounts('Total 1,360.00 due 31.08.2026 on 175.00 and 525.00; ref 6221.1234 call 6221 1234; 12,345,678.90');
  check('money is found, with thousands separators', p.get('1,360.00') === 1 && p.get('175.00') === 1 && p.get('525.00') === 1 && p.get('12,345,678.90') === 1, JSON.stringify([...p]));
  check('a date such as 31.08.2026 is not an amount', ![...p.keys()].some(k => k.startsWith('31.')) && !p.has('08.20'));
  check('a reference such as 6221.1234 is not an amount', !p.has('6221.12') && !p.has('21.12'));
  check('the same amount twice counts twice', printedAmounts('3,000.00 3,000.00').get('3,000.00') === 2);
  check('amounts are written the way QuickBooks writes them', formatMoney(133.3) === '133.30' && formatMoney(1360) === '1,360.00' && formatMoney(5.5) === '5.50' && formatMoney(400.00000000000006) === '400.00');

  console.log('\n--- what the system needs to know about the invoice ---');
  type Inv = Parameters<typeof invoiceFacts>[0];
  const line = (name: string, amount: number): NonNullable<Inv['Line']>[number] => ({ DetailType: 'SalesItemLineDetail', Amount: amount, SalesItemLineDetail: { ItemRef: { name } } });
  const inv: Inv = { DocNumber: '02611112', TxnDate: '2026-10-01', TotalAmt: 1360, CustomerRef: { name: ' 1X Exchange Pte. Ltd. ' }, Line: [line('Secretary:Corporate Secretarial Services', 175), line('Deferred Revenue - Corp Sec', 525), line('Disbursement:Government fee', 60), line('Secretary:Company XBRL Services', 600), { DetailType: 'SubTotalLineDetail', Amount: 1360 }] };
  const f = invoiceFacts(inv, 'TAB', [700, 60, 600]);
  check('a split invoice gives its facts as QuickBooks prints them', !!f && f.invoiceNo === 'TAB 02611112' && f.date === '01/10/2026' && f.customer === '1X Exchange Pte. Ltd.' && f.total === 1360 && JSON.stringify(f.lines.map(l => [l.amount, l.deferred])) === '[[175,false],[525,true],[60,false],[600,false]]' && JSON.stringify(f.preferred) === '[700,60,600]', JSON.stringify(f));
  check('an invoice nothing is split on gives none (QuickBooks\' own PDF is right)', invoiceFacts({ ...inv, Line: [line('Secretary:Corporate Secretarial Services', 700)] }, 'TAB') === null);
  check('no invoice number, date, customer or total: none (nothing to anchor on)', [{ ...inv, DocNumber: '' }, { ...inv, TxnDate: '' }, { ...inv, CustomerRef: { name: '  ' } }, { ...inv, TotalAmt: undefined }].every(i => invoiceFacts(i, 'TAB') === null));

  console.log('\n--- which line amounts the original could have printed ---');
  const sets = (a: number[][]) => JSON.stringify(a.map(s => [...s].sort((x, y) => x - y)).sort());
  check('one twin, two other lines: it joined either of them (the split version is NOT on the list)', sets(acceptableLineSets({ lines: [L1(450), L1(150, true), L1(150)] })) === sets([[600, 150], [450, 300]]), sets(acceptableLineSets({ lines: [L1(450), L1(150, true), L1(150)] })));
  const hong = { lines: [L1(450), L1(150, true), L1(150), L1(50, true), L1(60)], preferred: [650, 150, 60] };
  const hongSets = acceptableLineSets(hong);
  check('Hong Ming TAB #02611114: the label pairing (650/150/60) AND what accounting meant (600/200/60) are both acceptable', hongSets.some(s => sets([s]) === sets([[650, 150, 60]])) && hongSets.some(s => sets([s]) === sets([[600, 200, 60]])) && hongSets.length === 9 /* 2 twins x 3 lines to join = 9 ways, all different */, String(hongSets.length));
  check('the split version (all five lines separate) is never acceptable', !hongSets.some(s => s.length === 5));
  check('nothing to regroup: the lines as they are', sets(acceptableLineSets({ lines: [L1(700), L1(60)] })) === sets([[700, 60]]));
  const huge = { lines: [...Array.from({ length: 12 }, () => L1(10)), ...Array.from({ length: 12 }, () => L1(5, true))], preferred: [1, 2, 3] };
  check('a huge regrouping is not listed (only the label pairing is kept)', JSON.stringify(acceptableLineSets(huge)) === '[[1,2,3]]');
  check('only twins and nowhere to put them: only the label pairing', JSON.stringify(acceptableLineSets({ lines: [L1(5, true)], preferred: [5] })) === '[[5]]');

  console.log('\n--- is it the original? (the amounts) ---');
  check('the original invoice passes', checkOriginalCopy(pdf(ORIGINAL), FACTS).ok);
  const splitCheck = checkOriginalCopy(pdf(SPLIT), FACTS);
  check('the SPLIT version (QuickBooks prints it today) is refused, and says what differs', !splitCheck.ok && /missing 700\.00/.test(reasonOf(splitCheck)) && /unexpected 175\.00, 525\.00/.test(reasonOf(splitCheck)), reasonOf(splitCheck));
  check('an older figure (the amount was changed afterwards) is refused', !checkOriginalCopy(pdf(page({ lines: [['Corporate Secretarial Services', 650], ['Government fee', 60], ['XBRL', 600]], total: 1310 })), FACTS).ok);
  check('an extra amount somebody added is refused', !checkOriginalCopy(pdf(ORIGINAL + '\nLate fee 25.00'), FACTS).ok);
  check('dates, the invoice number and a bank account never count as amounts', checkOriginalCopy(pdf(ORIGINAL + '\nPrinted 06.10.2026 page 1 Account Number (SGD) : 374-310-831-9'), FACTS).ok);
  const hongFacts: InvoiceFacts = { invoiceNo: 'TAB 02611114', date: '01/10/2026', customer: 'Hong Ming Development Pte. Ltd.', total: 860, ...hong };
  const hongPage = (a: [string, number][]) => page({ no: 'TAB 02611114', customer: 'Hong Ming Development Pte. Ltd.', lines: a, total: 860 });
  check('an original whose twin accounting labelled with the wrong service (600/200/60) is accepted', checkOriginalCopy(pdf(hongPage([['Corporate Secretarial Services', 600], ['Registered Address Services', 200], ['Government fee', 60]])), hongFacts).ok);
  check('…and so is the label pairing (650/150/60)', checkOriginalCopy(pdf(hongPage([['Corporate Secretarial Services', 650], ['Registered Address Services', 150], ['Government fee', 60]])), hongFacts).ok);
  check('…but the split print of it is refused', !checkOriginalCopy(pdf(hongPage([['Corporate Secretarial Services', 450], ['Deferred Revenue - Corp Sec', 150], ['Registered Address Services', 150], ['Deferred Revenue - Corp Sec', 50], ['Government fee', 60]])), hongFacts).ok);
  check('…and amounts that fit no regrouping are refused', !checkOriginalCopy(pdf(hongPage([['Corporate Secretarial Services', 700], ['Registered Address Services', 100], ['Government fee', 60]])), hongFacts).ok);
  const one: InvoiceFacts = { invoiceNo: 'TAC 02680320', date: '29/09/2026', customer: 'Advance CF Technology Pte. Ltd.', total: 3000, lines: [L1(500), L1(2500, true)], preferred: [3000] };
  const onePage = (lines: [string, number][]) => page({ no: 'TAC 02680320', date: '29/09/2026', customer: 'Advance CF Technology Pte. Ltd.', lines, total: 3000 });
  check('one service with the same amount as the total: the amount must print twice', checkOriginalCopy(pdf(onePage([['Nominee Director for one year', 3000]])), one).ok && !checkOriginalCopy(pdf('INVOICE NO. : TAC 02680320\nDATE : 29/09/2026\nAdvance CF Technology Pte. Ltd.\nTOTAL 3,000.00 and some more words to be a page'), one).ok);
  check('the split version of that one is refused', !checkOriginalCopy(pdf(onePage([['Nominee Director for one year', 500], ['Deferred', 2500]])), one).ok);
  const disc: InvoiceFacts = { ...FACTS, total: 710, lines: [L1(700), L1(-50), L1(60), L1(5, true)], preferred: [705, -50, 60] };
  check('a discount line matches however the sign is written', checkOriginalCopy(pdf(page({ lines: [['Service', 705], ['Discount Given', -50], ['Fee', 60]], total: 710 }).replace('-50.00', '(50.00)')), disc).ok && checkOriginalCopy(pdf(page({ lines: [['Service', 705], ['Discount Given', -50], ['Fee', 60]], total: 710 })), disc).ok);

  console.log('\n--- is it the original? (what the file IS) ---');
  const tassure = checkOriginalCopy(pdf(ORIGINAL, { producer: 'Tassure' }), FACTS);
  check('the system\'s own drawing (Save PDF output, Producer "Tassure") is refused even though every number is right', !tassure.ok && /system's own drawing/.test(reasonOf(tassure)), reasonOf(tassure));
  check('a PDF with no producer is judged on its content', checkOriginalCopy(pdf(ORIGINAL, { producer: null }), FACTS).ok);
  const longer = checkOriginalCopy(pdf(ORIGINAL, { totalPages: 8 }), FACTS);
  check('a file with pages that were never read is refused (the SOA would still send them)', !longer.ok && /8 pages and only 1 could be read/.test(reasonOf(longer)), reasonOf(longer));
  const blank = checkOriginalCopy({ text: ORIGINAL, pages: [ORIGINAL, '   '], totalPages: 2, producer: 'Aspose' }, FACTS);
  check('a page with no text (a picture or a scan) is refused', !blank.ok && /page 2 has no text/.test(reasonOf(blank)), reasonOf(blank));
  check('a real second page (letterhead + "Paynow (QR) :") is fine', checkOriginalCopy({ text: ORIGINAL + '\nAccounting Auditing Company Setup Licensing\nPaynow (QR) :', pages: [ORIGINAL, 'Accounting Auditing Company Setup Licensing\nPaynow (QR) :'], totalPages: 2, producer: 'Aspose' }, FACTS).ok);

  console.log('\n--- is it the original? (whose it is) ---');
  check('another invoice\'s number is refused even with the same amounts', !checkOriginalCopy(pdf(page({ no: 'TAB 02611113', lines: [['Service', 700], ['Fee', 60], ['XBRL', 600]], total: 1360 })), FACTS).ok);
  check('another book\'s invoice with the same number is refused', !checkOriginalCopy(pdf(page({ no: 'TAC 02611112', lines: [['Service', 700], ['Fee', 60], ['XBRL', 600]], total: 1360 })), FACTS).ok);
  check('the number inside a longer one is refused (DN26-18 is not DN26-182)', !checkOriginalCopy(pdf(ORIGINAL.replace('TAB 02611112', 'TAB 026111120')), FACTS).ok && !checkOriginalCopy(pdf(ORIGINAL.replace('TAB 02611112', 'TAB 02611112-A')), FACTS).ok);
  check('a credit note or payment advice that merely quotes the number is refused', !checkOriginalCopy(pdf(ORIGINAL.replace('INVOICE NO. :', 'CREDIT NOTE NO. : CN1 Re invoice').replace('INVOICE', 'CREDIT NOTE')), FACTS).ok);
  check('a stale copy with another date is refused', !checkOriginalCopy(pdf(ORIGINAL.replace('DATE : 01/10/2026', 'DATE : 15/09/2026')), FACTS).ok);
  check('the due date is not the invoice date', !checkOriginalCopy(pdf(ORIGINAL.replace('DATE : 01/10/2026', 'DATE : 02/10/2026').replace('DUE DATE : 08/10/2026', 'DUE DATE : 01/10/2026')), FACTS).ok);
  check('…but a due date equal to the invoice date is fine', checkOriginalCopy(pdf(ORIGINAL.replace('DUE DATE : 08/10/2026', 'DUE DATE : 01/10/2026')), FACTS).ok);
  check('a file billed to another client is refused (an invoice moved to another customer)', !checkOriginalCopy(pdf(ORIGINAL.replace('1X Exchange Pte. Ltd.', 'Nucon Pte. Ltd.')), FACTS).ok);
  check('the customer\'s name may wrap or differ in case', checkOriginalCopy(pdf(ORIGINAL.replace('1X Exchange Pte. Ltd.', '1X EXCHANGE Pte.\nLtd.')), FACTS).ok);
  check('"TOTAL" must be on the page with the invoice total', !checkOriginalCopy(pdf(ORIGINAL.replace('TOTAL 1,360.00', 'BALANCE 1,360.00')), FACTS).ok);

  console.log('\n--- which attached file is used ---');
  const file = (Id: string, extra: Partial<AttachmentFile> = {}): AttachmentFile => ({ Id, FileName: `INV02611112-Client Name Pte Ltd-${Id}.pdf`, ContentType: 'application/pdf', Size: 160_000, Note: null, TempDownloadUri: `https://files.test/${Id}`, CreateTime: '2026-10-01T00:00:00Z', ...extra });
  // A file's content is chosen by byte 10, so each fake file says what it "prints".
  const MARK = { original: 1, split: 2, other: 3, broken: 4 };
  const bytesFor = (m: number) => { const b = bytesOf(2048); '%PDF-'.split('').forEach((c, i) => { b[i] = c.charCodeAt(0); }); b[10] = m; return b; };
  const READ: Record<number, PdfFacts | Error> = {
    1: pdf(ORIGINAL), 2: pdf(SPLIT), 3: pdf(ORIGINAL.replace('TAB 02611112', 'TAB 02611999')), 4: new Error('Input document is encrypted'),
  };
  const run = (files: AttachmentFile[] | Error, content: Record<string, number | Error | 'html'>) => {
    const log: string[] = [];
    return selectVerifiedOriginal({
      async list() { log.push('list'); if (files instanceof Error) throw files; return files; },
      async download(f) {
        log.push(`dl:${f.Id}`);
        const c = content[f.Id];
        if (c instanceof Error) throw c;
        if (c === 'html') return new TextEncoder().encode('<html>' + 'x'.repeat(900) + '</html>');
        return bytesFor(c);
      },
      async read(b) { const t = READ[b[10]]; if (t instanceof Error) throw t; return t; },
    }, FACTS).then(result => ({ result, log }));
  };

  let r = await run([file('1', { Note: INVOICE_COPY_NOTE }), file('2', { CreateTime: '2026-10-05T00:00:00Z' })], { 1: MARK.original, 2: MARK.original });
  check('the system\'s own copy is tried first, even next to a newer hand-attached original', 'found' in r.result && r.result.found.attachableId === '1' && r.result.found.bySystem && r.log.join(' ') === 'list dl:1', r.log.join(' '));
  r = await run([file('1', { Note: INVOICE_COPY_NOTE }), file('2')], { 1: MARK.split, 2: MARK.original });
  check('the system copy turns out to be a split version: the hand-attached original is used', 'found' in r.result && r.result.found.attachableId === '2' && !r.result.found.bySystem && r.log.join(' ') === 'list dl:1 dl:2', r.log.join(' '));
  r = await run([file('1', { CreateTime: '2026-09-01T00:00:00Z' }), file('2', { CreateTime: '2026-10-02T00:00:00Z' })], { 1: MARK.original, 2: MARK.original });
  check('among hand-attached files the newest goes first', 'found' in r.result && r.result.found.attachableId === '2');
  check('what comes back is the file\'s own bytes and name', 'found' in r.result && r.result.found.bytes[10] === MARK.original && r.result.found.fileName === 'INV02611112-Client Name Pte Ltd-2.pdf');
  r = await run([file('1')], { 1: MARK.split });
  check('only the split version attached: nothing is used, and it says why', 'none' in r.result && /attachment #1: its amounts are not the unsplit invoice's/.test(r.result.none), JSON.stringify(r.result));
  check('the reasons name the attachment by Id, never by file name (file names carry client names into the logs)', 'none' in r.result && !/Client Name|\.pdf/.test(r.result.none), JSON.stringify(r.result));
  r = await run([file('1')], { 1: MARK.other });
  check('a file for another invoice number is never used', 'none' in r.result && /does not say "INVOICE NO\. : TAB 02611112"/.test(r.result.none));
  r = await run([], {});
  check('nothing attached', 'none' in r.result && r.result.none === 'no PDF attached' && !r.result.trouble && r.log.join(' ') === 'list');
  r = await run([file('1', { ContentType: 'image/png', FileName: 'scan.png' }), file('2', { TempDownloadUri: undefined })], {});
  check('pictures and files without a download link are not even downloaded', 'none' in r.result && r.result.none === 'no PDF attached' && r.log.join(' ') === 'list');
  r = await run([file('1', { Size: MAX_ORIGINAL_BYTES + 1 })], {});
  check('an oversized file is never downloaded (the limit is 1 MB; real invoices are 80-260 KB)', MAX_ORIGINAL_BYTES === 1024 * 1024 && 'none' in r.result && r.log.join(' ') === 'list');
  r = await run([file('1', { ContentType: undefined, FileName: 'INV02611112.PDF' })], { 1: MARK.original });
  check('a PDF whose content type QuickBooks left blank is still recognised by its name', 'found' in r.result);
  r = await run(new Error('HTTP 401'), {});
  check('QuickBooks refusing the list: nothing is used, and it is flagged as a QuickBooks problem', 'none' in r.result && /could not list the invoice's attachments \(HTTP 401\)/.test(r.result.none) && r.result.trouble === true);
  r = await run([file('1'), file('2')], { 1: new Error('HTTP 403'), 2: MARK.original });
  check('a download that fails moves on to the next file', 'found' in r.result && r.result.found.attachableId === '2');
  r = await run([file('1'), file('2')], { 1: MARK.broken, 2: MARK.original });
  check('a PDF that cannot be read or merged (encrypted) moves on to the next file', 'found' in r.result && r.result.found.attachableId === '2');
  r = await run([file('1')], { 1: 'html' });
  check('something that is not a PDF at all (an error page) is refused', 'none' in r.result && /not a PDF/.test(r.result.none));
  const many = ['1', '2', '3', '4', '5'].map((id, i) => file(id, { CreateTime: `2026-10-0${5 - i}T00:00:00Z` }));
  r = await run(many, { 1: MARK.split, 2: MARK.split, 3: MARK.split, 4: MARK.split, 5: MARK.original });
  check('at most four files are tried per invoice', 'none' in r.result && r.log.join(' ') === 'list dl:1 dl:2 dl:3 dl:4', r.log.join(' '));

  console.log('\n--- what is said about each attached file (the Invoice Originals page) ---');
  r = await run([file('1', { Note: INVOICE_COPY_NOTE }), file('2'), file('3')], { 1: MARK.original, 2: MARK.original, 3: MARK.original });
  check('an accepted file is "used"; the files after it were not needed', r.result.tried.map(t => `${t.id}:${t.outcome}`).join(' ') === '1:used 2:skipped 3:skipped' && r.result.tried[0].bySystem && !r.result.tried[1].bySystem && /not needed/.test(r.result.tried[1].reason), JSON.stringify(r.result.tried));
  r = await run([file('1'), file('2', { ContentType: 'image/png', FileName: 'scan.png' }), file('3', { TempDownloadUri: undefined }), file('4', { Size: MAX_ORIGINAL_BYTES + 1 })], { 1: MARK.split });
  check('a refused file says why; a picture, a file without a link and an oversized file are skipped with their reason', r.result.tried.find(t => t.id === '1')?.outcome === 'refused' && /unsplit invoice's/.test(r.result.tried.find(t => t.id === '1')?.reason ?? '') && /not a PDF/.test(r.result.tried.find(t => t.id === '2')?.reason ?? '') && /no download link/.test(r.result.tried.find(t => t.id === '3')?.reason ?? '') && /larger than 1 MB/.test(r.result.tried.find(t => t.id === '4')?.reason ?? ''), JSON.stringify(r.result.tried));
  r = await run(many, { 1: MARK.split, 2: MARK.split, 3: MARK.split, 4: MARK.split, 5: MARK.original });
  check('a fifth PDF is listed as not checked (only the 4 newest are)', r.result.tried.find(t => t.id === '5')?.outcome === 'skipped' && /only the 4 newest/.test(r.result.tried.find(t => t.id === '5')?.reason ?? ''));
  r = await run(new Error('HTTP 401'), {});
  check('no list, no files to report', r.result.tried.length === 0);

  console.log('\n--- reading a real PDF ---');
  const draw = async (pages: (string[] | 'picture')[], producer: string | null) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const lines of pages) {
      const pg = doc.addPage([595, 842]);
      if (lines === 'picture') { pg.drawRectangle({ x: 100, y: 300, width: 300, height: 300, color: rgb(0.2, 0.2, 0.2) }); continue; }
      lines.forEach((ln, i) => {
        const [left, right] = ln.split('|');
        pg.drawText(left, { x: 50, y: 780 - i * 20, size: 10, font });
        if (right) pg.drawText(right, { x: 480, y: 780 - i * 20, size: 10, font });
      });
    }
    if (producer) doc.setProducer(producer);
    return new Uint8Array(await doc.save());
  };
  const body = (no = 'TAB 02611112', amounts: [string, string][] = [['Corporate Secretarial Services', '700.00'], ['Government fee for filing Annual Return', '60.00'], ['XBRL for the year', '600.00']], total = '1,360.00') => [
    'TASSURE ASIA BIZSERVICES PTE. LTD.', 'INVOICE', `INVOICE NO. : ${no}`, 'TERMS : Net 7', 'DATE : 01/10/2026', 'BILL TO:', '1X Exchange Pte. Ltd.', 'DUE DATE : 08/10/2026',
    'DESCRIPTION|AMOUNT (S$)', ...amounts.map(([d, a]) => `${d}|${a}`), `TOTAL|${total}`.replace('|', ' '),
  ];
  const second = ['Accounting Auditing Company Setup Licensing Application', 'Paynow (QR) :'];
  const asAspose = await readPdf(await draw([body(), second], 'Aspose.Words for Java 20.11.0'));
  check('the text of each page, the page count and the PRODUCER AS WRITTEN are read (pdf-lib alone would overwrite it)', asAspose.totalPages === 2 && asAspose.pages.length === 2 && /02611112/.test(asAspose.pages[0]) && /Paynow/.test(asAspose.pages[1]) && asAspose.producer === 'Aspose.Words for Java 20.11.0', JSON.stringify({ t: asAspose.totalPages, p: asAspose.producer }));
  check('a real two-page original passes end to end', checkOriginalCopy(asAspose, FACTS).ok, reasonOf(checkOriginalCopy(asAspose, FACTS)));
  const asTassure = await readPdf(await draw([body()], 'Tassure'));
  check('a PDF the system drew (Producer "Tassure") is recognised as such', asTassure.producer === 'Tassure' && !checkOriginalCopy(asTassure, FACTS).ok);
  const splitPdf = await readPdf(await draw([body('TAB 02611112', [['Corporate Secretarial Services', '175.00'], ['Deferred Revenue - Corp Sec', '525.00'], ['Government fee', '60.00'], ['XBRL for the year', '600.00']]), second], 'Aspose.Words for Java 20.11.0'));
  check('a real SPLIT PDF is refused end to end', !checkOriginalCopy(splitPdf, FACTS).ok);
  const eight = await readPdf(await draw([body(), ...Array.from({ length: 7 }, (_, i) => [`Another client's invoice page ${i + 2}`, 'INVOICE NO. : TAB 02611999', 'TOTAL 1,000.00'])], 'Aspose.Words for Java 20.11.0'));
  check('an 8-page file: only 6 pages are read, so it is refused (the SOA would send all 8)', eight.totalPages === 8 && eight.pages.length === 6 && !checkOriginalCopy(eight, FACTS).ok);
  const withPicture = await readPdf(await draw([body(), 'picture'], 'Aspose.Words for Java 20.11.0'));
  check('a page that is only a picture (another client\'s invoice scanned in) is refused', withPicture.totalPages === 2 && /page 2 has no text/.test(reasonOf(checkOriginalCopy(withPicture, FACTS))), reasonOf(checkOriginalCopy(withPicture, FACTS)));
  let threw = '';
  try { await readPdf(new Uint8Array(Buffer.from(ENCRYPTED_PDF_B64, 'base64'))); } catch (e) { threw = (e as Error).message; }
  check('an owner-password PDF (pdf.js reads it, pdf-lib cannot merge it) is an error, not a candidate', /encrypted/i.test(threw), threw);
  threw = '';
  try { await readPdf(new Uint8Array([...new TextEncoder().encode('%PDF-1.4\n'), ...bytesOf(900)])); } catch (e) { threw = (e as Error).message; }
  check('a file that is not really a PDF is an error, not a hang', threw !== '', threw);

  console.log('\n--- the QuickBooks reader ---');
  type Seen = { url: string; init?: RequestInit };
  const seen: Seen[] = [];
  const fakeFetch = (respond: (url: string) => Response) => (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), init }); return respond(String(url)); }) as typeof fetch;
  const reader = (respond: (url: string) => Response, signal?: AbortSignal) => createHttpAttachmentReader({ base: 'https://qb.test', realmId: '123', accessToken: 'SECRET-TOKEN', fetchImpl: fakeFetch(respond), signal });
  const json = (body2: unknown, status = 200) => new Response(JSON.stringify(body2), { status });

  let api = reader(() => json({ QueryResponse: { Attachable: [
    { Id: '1000001421', SyncToken: '0', FileName: 'INV02611130-X.pdf', ContentType: 'application/pdf', Size: 160342, Note: INVOICE_COPY_NOTE, TempDownloadUri: 'https://files.test/a?sig=1', MetaData: { CreateTime: '2026-10-06T07:54:00+08:00' } },
    { Id: '1000001422', FileName: 'scan.pdf', ContentType: 'application/pdf', Size: '2048', Note: null },
  ] } }));
  const listed = await api.list('25898');
  check('list: asks QuickBooks for the attachments of that invoice, with the token', seen[0].url.startsWith('https://qb.test/v3/company/123/query?query=') && decodeURIComponent(seen[0].url).includes("AttachableRef.EntityRef.value = '25898'") && (seen[0].init?.headers as Record<string, string>).Authorization === 'Bearer SECRET-TOKEN');
  check('list: keeps what is needed to download and rank each file', listed.length === 2 && listed[0].Id === '1000001421' && listed[0].Size === 160342 && listed[0].Note === INVOICE_COPY_NOTE && listed[0].TempDownloadUri === 'https://files.test/a?sig=1' && listed[0].CreateTime === '2026-10-06T07:54:00+08:00' && listed[1].Size === 2048 && listed[1].Note === null && listed[1].CreateTime === undefined, JSON.stringify(listed));
  api = reader(() => json({ QueryResponse: {} }));
  check('list: an invoice with nothing attached is an empty list', (await api.list('1')).length === 0);
  seen.length = 0;
  threw = '';
  try { await api.list("1' OR '1'='1"); } catch (e) { threw = (e as Error).message; }
  check('list: an id that is not a QuickBooks id is refused before anything is sent', /not a QuickBooks id/.test(threw) && seen.length === 0);
  api = reader(() => json({ Fault: { Error: [{ Message: 'AuthenticationFailed' }] } }, 401));
  threw = '';
  try { await api.list('1'); } catch (e) { threw = (e as Error).message; }
  check('list: an HTTP error is an error', /HTTP 401/.test(threw));
  api = reader(() => new Response('<html>nope</html>'));
  threw = '';
  try { await api.list('1'); } catch (e) { threw = (e as Error).message; }
  check('list: a non-JSON answer is an error', /not JSON/.test(threw));
  seen.length = 0;
  const abort = new AbortController();
  api = reader(() => json({ QueryResponse: {} }), abort.signal);
  await api.list('1');
  const sentSignal = seen[0].init?.signal as AbortSignal;
  abort.abort();
  check('the caller\'s deadline cancels the request still in flight', !!sentSignal && sentSignal.aborted === true);

  seen.length = 0;
  const raw = (id: number, refs: { type: string; value: string }[], extra: object = {}) => ({ Id: String(id), FileName: `f${id}.pdf`, ContentType: 'application/pdf', Size: 1000, TempDownloadUri: `https://files.test/${id}`, AttachableRef: refs.map(r => ({ EntityRef: r })), ...extra });
  const page1 = Array.from({ length: 500 }, (_, i) => raw(i + 1, [{ type: 'Invoice', value: String(100 + (i % 2)) }]));
  const page2 = [raw(501, [{ type: 'Invoice', value: '100' }, { type: 'Invoice', value: '102' }]), raw(502, [{ type: 'Customer', value: '100' }]), raw(503, [])];
  api = reader(url => json({ QueryResponse: { Attachable: decodeURIComponent(url).includes('STARTPOSITION 1 ') ? page1 : page2 } }));
  const all = await api.listAllForInvoices();
  check('bulk: reads the pages of 500 until a short one, one query each', seen.length === 2 && decodeURIComponent(seen[0].url).includes('STARTPOSITION 1 MAXRESULTS 500') && decodeURIComponent(seen[1].url).includes('STARTPOSITION 501 MAXRESULTS 500'), seen.map(s2 => decodeURIComponent(s2.url).slice(-60)).join(' | '));
  check('bulk: groups the files by the invoice they are attached to', all.get('100')!.length === 251 && all.get('101')!.length === 250 && all.get('102')!.length === 1, [...all].map(([k, v]) => `${k}:${v.length}`).join(' '));
  check('bulk: a file linked to two invoices is under both; a file of a customer or an unlinked one is under none', all.get('102')![0].Id === '501' && ![...all.values()].flat().some(f => f.Id === '502' || f.Id === '503'));
  check('bulk: keeps what the page needs', all.get('102')![0].TempDownloadUri === 'https://files.test/501' && all.get('102')![0].Size === 1000);
  api = reader(() => json({ Fault: { Error: [{ Message: 'Throttled' }] } }, 429));
  threw = '';
  try { await api.listAllForInvoices(); } catch (e) { threw = (e as Error).message; }
  check('bulk: an HTTP error is an error', /HTTP 429/.test(threw));

  seen.length = 0;
  const content = bytesFor(MARK.original);
  api = reader(() => new Response(content, { headers: { 'content-length': String(content.length) } }));
  const got = await api.download(file('1', { TempDownloadUri: 'https://files.test/a?sig=1' }), MAX_ORIGINAL_BYTES);
  check('download: returns the file\'s bytes', got.length === content.length && got[10] === MARK.original);
  check('download: the QuickBooks token is NOT sent to the file link (the signed link is the credential)', seen[0].url === 'https://files.test/a?sig=1' && !JSON.stringify(seen[0].init?.headers ?? {}).includes('SECRET-TOKEN') && !('Authorization' in ((seen[0].init?.headers as Record<string, string>) ?? {})));
  threw = '';
  try { await api.download(file('1', { TempDownloadUri: 'http://files.test/a' }), MAX_ORIGINAL_BYTES); } catch (e) { threw = (e as Error).message; }
  check('download: a link that is not https is refused', /not https/.test(threw));
  threw = '';
  try { await api.download(file('1', { TempDownloadUri: undefined }), MAX_ORIGINAL_BYTES); } catch (e) { threw = (e as Error).message; }
  check('download: no link, no download', /no download link/.test(threw));
  threw = '';
  try { await api.download(file('1', { TempDownloadUri: 'https://files.test/a' }), 1000); } catch (e) { threw = (e as Error).message; }
  check('download: a file bigger than the limit is refused (by its declared size)', /larger than/.test(threw));
  let cancelled = false;
  api = reader(() => new Response(new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(bytesOf(600)); c.enqueue(bytesOf(600)); c.enqueue(bytesOf(600)); },
    cancel() { cancelled = true; },
  })));
  threw = '';
  try { await api.download(file('1', { TempDownloadUri: 'https://files.test/a' }), 1000); } catch (e) { threw = (e as Error).message; }
  check('download: with no declared size it stops reading once past the limit', /larger than/.test(threw) && cancelled);
  api = reader(() => { const res = new Response(bytesOf(2048)); Object.defineProperty(res, 'url', { value: 'http://elsewhere.test/a' }); return res; });
  threw = '';
  try { await api.download(file('1', { TempDownloadUri: 'https://files.test/a' }), MAX_ORIGINAL_BYTES); } catch (e) { threw = (e as Error).message; }
  check('download: a redirect that ends off https is refused', /redirected away from https/.test(threw), threw);
  api = reader(() => new Response('forbidden', { status: 403 }));
  threw = '';
  try { await api.download(file('1', { TempDownloadUri: 'https://files.test/a' }), MAX_ORIGINAL_BYTES); } catch (e) { threw = (e as Error).message; }
  check('download: an HTTP error is an error', /HTTP 403/.test(threw));

  console.log('\n--- the client invoice PDF uses it ---');
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const pdfLib = read('lib/client-invoice-pdf.ts');
  const lookup = pdfLib.indexOf('findOriginalInvoiceCopy(company, invoiceId, facts)');
  const quickbooksReturn = pdfLib.indexOf("decision.kind === 'quickbooks') return original(decision.reason)");
  const redraw = pdfLib.indexOf('renderClientInvoicePdf(decision.model');
  check('the original is looked for BEFORE QuickBooks\' split PDF is returned for an invoice the system cannot draw', lookup > -1 && quickbooksReturn > lookup);
  check('…and BEFORE the system redraws', redraw > lookup);
  check('the facts carry the system\'s own label pairing as the preferred amounts, and none when it cannot pair', /invoiceFacts\(invoice, company, decision\.kind === 'system' \? decision\.model\.rows\.map\(r => r\.amount\) : undefined\)/.test(pdfLib));
  check('an invoice with nothing split is not looked up (QuickBooks\' own PDF is right)', /if \(facts\) \{/.test(pdfLib));
  check('a verified original is returned as source "attachment"', /'found' in attached\) return \{ bytes: attached\.found\.bytes, source: 'attachment'/.test(pdfLib) && /source: 'system' \| 'quickbooks' \| 'attachment'/.test(pdfLib));
  const finder = read('lib/quickbooks-original-copy.ts');
  check('TAB and TAC look for originals, TAO (nothing to redraw) does not', /ORIGINAL_COPY_LOOKUP_MODE[^=]*= \{ TAB: 'live', TAC: 'live', TAO: 'off' \}/.test(finder));
  check('the look-up only reads: no upload, no delete, no POST', !/\.upload\(|\.remove\(|method: 'POST'|createHttpAttachmentApi/.test(finder));
  check('every failure is "none" (never an exception), the wait is capped and cancels the requests', /catch \(err\)[\s\S]*trouble: true/.test(finder) && /Promise\.race/.test(finder) && /controller\.abort\(\)/.test(finder) && /signal: controller\.signal/.test(finder));
  check('after a QuickBooks problem it stops asking for a while instead of waiting for every invoice', /pausedUntil\[company\] = Date\.now\(\) \+ PAUSE_MS/.test(finder) && /Date\.now\(\) < \(pausedUntil\[company\] \?\? 0\)/.test(finder));
  check('the file is read with the same loader the SOA merges with, without letting it rewrite the Producer', /PDFDocument\.load\(bytes, \{ updateMetadata: false \}\)/.test(read('lib/pdf-text.ts')));
  const nextConfig = read('next.config.ts');
  for (const route of ['/api/billing/client-invoice-pdf', '/api/billing/soa/pdf']) {
    const block = nextConfig.slice(nextConfig.indexOf(`'${route}'`), nextConfig.indexOf(']', nextConfig.indexOf(`'${route}'`)));
    check(`${route} ships pdf-parse and pdfjs-dist (its worker file is found at run time)`, block.includes('./node_modules/pdf-parse/**') && block.includes('./node_modules/pdfjs-dist/**'));
  }
  check('both routes have room for the extra QuickBooks calls', /export const maxDuration = \d+/.test(read('app/api/billing/client-invoice-pdf/route.ts')) && /export const maxDuration = \d+/.test(read('app/api/billing/soa/pdf/route.ts')));
  check('the "is it the original" decision is pure (no network, no files)', !/\bfetch\(|from 'fs|from 'path'|server-only|process\.env/.test(read('lib/original-copy.ts')));

  console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
