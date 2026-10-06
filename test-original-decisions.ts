// Vincent's decisions about the invoices that had no original the proof accepts (2026-10-07, INV-QB-037):
// lib/original-copy.ts (typed refusals; a confirmed file is accepted ONLY for the two refusals that are not about
// whose the file is, only by its sha256, only while the invoice is the version he decided about, never when the
// file prints accounting's split) and lib/original-decisions.ts (the data: 4 originals to use, 19 invoices left as
// they are, Co-Operate Associates in neither). Nothing here touches QuickBooks or the database.
//
// Run: npx tsx test-original-decisions.ts
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { INVOICE_COPY_NOTE } from './lib/quickbooks-attachments';
import {
  checkOriginalCopy, formatMoney, sameInvoiceVersion, printsADeferredTwin, selectVerifiedOriginal, sha256Hex,
  type AttachmentFile, type ConfirmedOriginal, type InvoiceFacts, type PdfFacts,
} from './lib/original-copy';
import { CONFIRMED_ORIGINALS, REDRAW_DECISIONS, REDRAW_REASONS, confirmedOriginalsFor, redrawDecisionFor } from './lib/original-decisions';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

// What a real QuickBooks (Aspose) invoice page says, in the order pdf.js reads it.
const page = (o: { no: string; date: string; customer: string; lines: [string, number][]; total: number; letterhead?: boolean }) => [
  'Accounting Auditing Company Setup Licensing Application Secretary Taxation High Net Worth',
  'TASSURE ASIA BIZSERVICES PTE. LTD.',
  ...(o.letterhead === false ? [] : ['Registration No.: 201325157G']),
  'INVOICE',
  `INVOICE NO. : ${o.no}`,
  'TERMS : Net 7',
  `DATE : ${o.date}`,
  'BILL TO:',
  o.customer,
  'DUE DATE : 07/05/2026',
  'DESCRIPTION AMOUNT (S$)',
  ...o.lines.map(([d, a]) => `${d} ${formatMoney(a)}`),
  'Payment is due seven (7) days from the invoice date.',
  `TOTAL ${formatMoney(o.total)}`,
  'PAYMENT DETAILS: Account Name : TASSURE ASIA BIZSERVICES PTE. LTD.',
].join('\n');
const pdf = (text: string, over: Partial<PdfFacts> = {}): PdfFacts => ({ text, pages: [text], totalPages: 1, producer: 'Aspose.Words for Java 20.11.0', ...over });

// EVOP TAB #02610547 (real shape): the client got 900 + 700 + 200 = 1,800; QuickBooks now holds 585 + 315, and the
// two services each with a Deferred twin.
const L = (amount: number, deferred = false) => ({ amount, deferred });
const FACTS: InvoiceFacts = {
  invoiceNo: 'TAB 02610547', date: '30/04/2026', customer: 'EVOP (Singapore) International Pte. Ltd.', total: 1800,
  lines: [L(585), L(315), L(583.33), L(116.67, true), L(166.67), L(33.33, true)], preferred: [585, 315, 700, 200],
};
const base = { no: FACTS.invoiceNo, date: FACTS.date, customer: FACTS.customer, total: FACTS.total };
const REGROUPED = page({ ...base, lines: [['Being Company Incorporation services', 900], ['Perform secretarial services for one-year', 700], ['Registered and mailing address', 200]] });
const FOLDED = page({ ...base, lines: [['Being Company Incorporation services', 585], ['Reimbursement', 315], ['Perform secretarial services for one-year', 700], ['Registered and mailing address', 200]] });
const SPLIT = page({ ...base, lines: [['Being Company Incorporation services', 900], ['Perform secretarial services', 583.33], ['Deferred Revenue - Corp Sec', 116.67], ['Registered address', 166.67], ['Deferred Revenue - Reg Addr', 33.33]] });
const reason = (r: { ok: boolean }) => ('reason' in r ? String((r as { reason: string }).reason) : '');
const stage = (r: { ok: boolean }) => ('stage' in r ? String((r as { stage: string }).stage) : '');

// A fake attached file: its bytes carry a tag the fake reader knows.
const TEXTS = new Map<string, PdfFacts>();
const bytesOf = (tag: string, text: PdfFacts): Uint8Array => {
  const b = new Uint8Array(new ArrayBuffer(700)).fill(32);
  b.set(new TextEncoder().encode(`%PDF-1.7\n${tag}`), 0);
  TEXTS.set(tag, text);
  return b;
};
const tagOf = (b: Uint8Array) => new TextDecoder().decode(b.slice(9, 9 + 8)).trim();
async function lookup(files: { id: string; bytes: Uint8Array; note?: string | null }[], facts: InvoiceFacts, confirmed?: readonly ConfirmedOriginal[]) {
  const attached: AttachmentFile[] = files.map((f, i) => ({ Id: f.id, FileName: `${f.id}.pdf`, ContentType: 'application/pdf', Size: f.bytes.length, Note: f.note ?? null, CreateTime: `2026-10-0${i + 1}T00:00:00Z`, TempDownloadUri: `https://files.test/${f.id}` }));
  const body = new Map(files.map(f => [f.id, f.bytes]));
  return selectVerifiedOriginal({ list: async () => attached, download: async f => body.get(f.Id)!, read: async b => TEXTS.get(tagOf(b))! }, facts, confirmed);
}
const entryFor = async (bytes: Uint8Array, over: Partial<ConfirmedOriginal> = {}): Promise<ConfirmedOriginal> => ({
  invoiceNo: FACTS.invoiceNo, date: FACTS.date, total: FACTS.total, customer: FACTS.customer,
  sha256: await sha256Hex(bytes), fileName: 'x.pdf', decidedBy: 'Vincent', decidedOn: '2026-10-07', why: 'only the appearance differs', ...over,
});

(async () => {
  console.log('--- every refusal says where it happened ---');
  const stages: [string, ReturnType<typeof checkOriginalCopy>, string][] = [
    ['the system\'s own drawing (Producer Tassure)', checkOriginalCopy(pdf(FOLDED, { producer: 'Tassure' }), FACTS), 'file'],
    ['pages that could not all be read', checkOriginalCopy(pdf(FOLDED, { totalPages: 3 }), FACTS), 'file'],
    ['a page with no text (a picture)', checkOriginalCopy(pdf('', { pages: [''], totalPages: 1 }), FACTS), 'no-text'],
    ['no letterhead as text (the drawing re-saved)', checkOriginalCopy(pdf(page({ ...base, letterhead: false, lines: [['Being Company Incorporation services', 585], ['Reimbursement', 315], ['Perform secretarial services', 700], ['Registered address', 200]] })), FACTS), 'file'],
    ['another invoice number', checkOriginalCopy(pdf(page({ ...base, no: 'TAB 02610999', lines: [['x', 900]] })), FACTS), 'identity'],
    ['another date', checkOriginalCopy(pdf(page({ ...base, date: '01/05/2026', lines: [['x', 900]] })), FACTS), 'identity'],
    ['another customer', checkOriginalCopy(pdf(page({ ...base, customer: 'Other Pte. Ltd.', lines: [['x', 900]] })), FACTS), 'identity'],
    ['another total', checkOriginalCopy(pdf(page({ ...base, total: 1700, lines: [['x', 900]] })), FACTS), 'identity'],
    ['printed lines that are a regrouping (900 for 585 + 315)', checkOriginalCopy(pdf(REGROUPED), FACTS), 'amounts'],
    ['the split version', checkOriginalCopy(pdf(SPLIT), FACTS), 'amounts'],
  ];
  for (const [label, r, want] of stages) check(`${label}: refused at "${want}"`, !r.ok && stage(r) === want, `${stage(r)} / ${reason(r)}`);
  check('a file that is right passes, as before', checkOriginalCopy(pdf(FOLDED), FACTS).ok);

  console.log('\n--- the version of an invoice a decision is about ---');
  check('the same number, date, customer and total (customer compared as QuickBooks prints it, case and spaces aside)', sameInvoiceVersion(FACTS, { ...FACTS, customer: '  evop (SINGAPORE)  International Pte. Ltd. ' }));
  check('any change lapses it: number, date, customer or total', [{ invoiceNo: 'TAB 02610548' }, { date: '01/05/2026' }, { customer: 'EVOP Pte. Ltd.' }, { total: 1801 }].every(o => !sameInvoiceVersion(FACTS, { ...FACTS, ...o })));
  check('a cent counts', !sameInvoiceVersion(FACTS, { ...FACTS, total: 1800.01 }) && sameInvoiceVersion(FACTS, { ...FACTS, total: 1800.000001 }));
  check('sha256 is the real thing (known vector)', await sha256Hex(new TextEncoder().encode('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const b0 = new TextEncoder().encode('some bytes');
  check('…and equals node\'s hash of the same bytes', await sha256Hex(b0) === crypto.createHash('sha256').update(b0).digest('hex'));
  check('a file printing one of accounting\'s Deferred twins prints the split', printsADeferredTwin(pdf(SPLIT), FACTS) && !printsADeferredTwin(pdf(REGROUPED), FACTS) && !printsADeferredTwin(pdf(FOLDED), FACTS));
  check('…and the exchange-rate footer is not counted as an amount', !printsADeferredTwin(pdf(`${FOLDED}\nExchange rate 116.67\nEquivalent to RMB116.67`), FACTS));

  console.log('\n--- a confirmed file is used — and only that file, for that invoice, in that state ---');
  const regrouped = bytesOf('REGRP1', pdf(REGROUPED));
  const entry = await entryFor(regrouped);
  const plain = await lookup([{ id: '10', bytes: regrouped }], FACTS);
  check('without a decision the regrouped original is refused (the proof stands)', 'none' in plain && /amounts are not/.test(plain.none));
  const used = await lookup([{ id: '10', bytes: regrouped }], FACTS, [entry]);
  check('with the decision it is the original used', 'found' in used && used.found.attachableId === '10' && used.found.bytes === regrouped, JSON.stringify('none' in used ? used.none : ''));
  check('…and the record says it was a person\'s decision, whose, when and why', 'found' in used && used.tried[0].outcome === 'used' && /confirmed by Vincent on 2026-10-07 \(only the appearance differs\)/.test(used.tried[0].reason));
  const other = bytesOf('REGRP2', pdf(REGROUPED + '\n(another copy)'));
  const otherFile = await lookup([{ id: '11', bytes: other }], FACTS, [entry]);
  check('another file (other hash) is not covered', 'none' in otherFile);
  check('a decision about another hash never helps', 'none' in await lookup([{ id: '10', bytes: regrouped }], FACTS, [{ ...entry, sha256: '0'.repeat(64) }]));
  for (const [label, over] of [['its total', { total: 1801 }], ['its date', { date: '01/05/2026' }], ['its customer', { customer: 'EVOP Pte. Ltd.' }], ['its number', { invoiceNo: 'TAB 02610548' }]] as const) {
    check(`when accounting changes ${label}, the decision lapses and the proof decides again`, 'none' in await lookup([{ id: '10', bytes: regrouped }], { ...FACTS, ...over }, [entry]));
  }
  check('a decision for another invoice does not apply here', 'none' in await lookup([{ id: '10', bytes: regrouped }], FACTS, [{ ...entry, invoiceNo: 'TAB 02610907' }]));
  check('lines changing again does not lapse it (the file is still what the client holds)', 'found' in await lookup([{ id: '10', bytes: regrouped }], { ...FACTS, lines: [L(900), L(583.33), L(116.67, true), L(166.67), L(33.33, true)] }, [entry]));

  console.log('\n--- what a decision can never cover ---');
  const drawing = bytesOf('DRAWNG', pdf(REGROUPED, { producer: 'Tassure' }));
  check('the system\'s own drawing (refused at "file")', 'none' in await lookup([{ id: '12', bytes: drawing }], FACTS, [await entryFor(drawing)]));
  const wrongNo = bytesOf('WRONGN', pdf(page({ ...base, no: 'TAB 02610999', lines: [['x', 900]] })));
  check('another invoice\'s PDF (refused at "identity")', 'none' in await lookup([{ id: '13', bytes: wrongNo }], FACTS, [await entryFor(wrongNo)]));
  const wrongTotal = bytesOf('WRONGT', pdf(page({ ...base, total: 1700, lines: [['x', 900]] })));
  check('a file with another total (refused at "identity")', 'none' in await lookup([{ id: '14', bytes: wrongTotal }], FACTS, [await entryFor(wrongTotal)]));
  const unread = bytesOf('UNREAD', pdf(REGROUPED, { totalPages: 4 }));
  check('a file whose pages were not all read (refused at "file")', 'none' in await lookup([{ id: '15', bytes: unread }], FACTS, [await entryFor(unread)]));
  const split = bytesOf('SPLIT1', pdf(SPLIT));
  check('the split version, even named by a decision (it prints a Deferred twin)', 'none' in await lookup([{ id: '16', bytes: split }], FACTS, [await entryFor(split)]));
  const notPdf = new Uint8Array(new ArrayBuffer(700)).fill(65);
  check('bytes that are not a PDF', 'none' in await lookup([{ id: '17', bytes: notPdf }], FACTS, [await entryFor(notPdf)]));

  console.log('\n--- a picture (no text to check) ---');
  const picture = bytesOf('PICT01', pdf('', { pages: [''], totalPages: 1 }));
  check('refused without a decision', 'none' in await lookup([{ id: '20', bytes: picture }], FACTS) && /no text/.test((await lookup([{ id: '20', bytes: picture }], FACTS) as { none: string }).none));
  const pictureUsed = await lookup([{ id: '20', bytes: picture }], FACTS, [await entryFor(picture)]);
  check('used when a decision names exactly that file for that invoice', 'found' in pictureUsed && pictureUsed.found.attachableId === '20');
  const picture2 = bytesOf('PICT02', pdf('', { pages: [''], totalPages: 1 }));
  check('another picture is not covered', 'none' in await lookup([{ id: '21', bytes: picture2 }], FACTS, [await entryFor(picture)]));
  check('…nor the same picture once the invoice changed', 'none' in await lookup([{ id: '20', bytes: picture }], { ...FACTS, total: 1999 }, [await entryFor(picture)]));
  const drawnPicture = bytesOf('PICT03', pdf('', { pages: [''], totalPages: 1, producer: 'Tassure' }));
  check('the system\'s own drawing as a picture is never covered', 'none' in await lookup([{ id: '22', bytes: drawnPicture }], FACTS, [await entryFor(drawnPicture)]));

  console.log('\n--- order and company ---');
  const proven = bytesOf('PROVEN', pdf(FOLDED));
  const both = await lookup([{ id: '30', bytes: regrouped }, { id: '31', bytes: proven }], FACTS, [entry]);
  check('a file the proof accepts is still "proved", not "confirmed" (and is tried first when it is the newer)', 'found' in both && both.found.attachableId === '31' && both.tried.filter(t => t.outcome === 'used').length === 1 && both.tried.find(t => t.outcome === 'used')?.reason === 'proved to be the original');
  const system = await lookup([{ id: '32', bytes: proven, note: INVOICE_COPY_NOTE }, { id: '33', bytes: regrouped }], FACTS, [entry]);
  check('the system\'s own copy still goes first', 'found' in system && system.found.attachableId === '32' && system.found.bySystem);

  console.log('\n--- the register ---');
  const hex64 = /^[0-9a-f]{64}$/;
  check('four originals to use, each named by a real sha256 and by the invoice version', CONFIRMED_ORIGINALS.length === 4 && CONFIRMED_ORIGINALS.every(c => hex64.test(c.sha256) && /^TA[BC] \d{8}$/.test(c.invoiceNo) && c.invoiceNo.startsWith(c.book) && /^\d{2}\/\d{2}\/\d{4}$/.test(c.date) && c.total > 0 && c.customer.trim() && /^\d+$/.test(c.invoiceId) && c.decidedBy === 'Vincent' && c.decidedOn === '2026-10-07'));
  check('…each invoice once, each file once', new Set(CONFIRMED_ORIGINALS.map(c => `${c.book}|${c.invoiceId}`)).size === 4 && new Set(CONFIRMED_ORIGINALS.map(c => c.sha256)).size === 4);
  check('the four are EVOP, Nova Golden, Soon & Guan and Minyotech #02610788 — the appearance differences', CONFIRMED_ORIGINALS.map(c => c.invoiceNo).sort().join(',') === 'TAB 02610547,TAB 02610788,TAB 02610907,TAB 02611000');
  check('19 invoices left as they are, each with a reason that exists, each invoice once', REDRAW_DECISIONS.length === 19 && REDRAW_DECISIONS.every(d => d.why in REDRAW_REASONS && /^TA[BC] \d{8}$/.test(d.invoiceNo) && d.invoiceNo.startsWith(d.book) && /^\d+$/.test(d.invoiceId) && d.decidedBy === 'Vincent') && new Set(REDRAW_DECISIONS.map(d => `${d.book}|${d.invoiceId}`)).size === 19);
  const count = (why: string) => REDRAW_DECISIONS.filter(d => d.why === why).length;
  check('12 where the redraw equals the picture, 6 changed after sending, 1 not sent (Sanli)', count('identical-to-original') === 12 && count('changed-after-sending') === 6 && count('not-sent') === 1 && REDRAW_DECISIONS.find(d => d.why === 'not-sent')?.invoiceNo === 'TAB 02511395');
  check('no invoice is in both registers', REDRAW_DECISIONS.every(d => !CONFIRMED_ORIGINALS.some(c => c.book === d.book && c.invoiceId === d.invoiceId)));
  check('Co-Operate Associates TAB #02610167 is in neither — it is the one left on the list (Vincent)', ![...CONFIRMED_ORIGINALS, ...REDRAW_DECISIONS].some(e => e.invoiceNo === 'TAB 02610167'));
  const evop = CONFIRMED_ORIGINALS.find(c => c.invoiceNo === 'TAB 02610547')!;
  check('looked up by book and invoice id: the four, nothing else', confirmedOriginalsFor('TAB', evop.invoiceId).length === 1 && confirmedOriginalsFor('TAC', evop.invoiceId).length === 0 && confirmedOriginalsFor('TAB', '1').length === 0);
  const decided = REDRAW_DECISIONS.find(d => d.invoiceNo === 'TAB 02610680')!;
  const f2 = (o: Partial<InvoiceFacts>): InvoiceFacts => ({ invoiceNo: decided.invoiceNo, date: decided.date, customer: decided.customer, total: decided.total, lines: [], ...o });
  check('a decision to leave an invoice applies while it is the invoice decided about', redrawDecisionFor('TAB', decided.invoiceId, f2({}))?.why === 'identical-to-original');
  check('…and lapses when accounting changes its total, date, customer or number — it is listed again', [{ total: decided.total + 1 }, { date: '01/01/2026' }, { customer: 'Other Pte. Ltd.' }, { invoiceNo: 'TAB 02610681' }].every(o => redrawDecisionFor('TAB', decided.invoiceId, f2(o)) === null));
  check('…and never applies to another book\'s or another invoice\'s id', redrawDecisionFor('TAC', decided.invoiceId, f2({})) === null && redrawDecisionFor('TAB', '999999', f2({})) === null);

  console.log('\n--- who uses it ---');
  const reg = read('lib/original-decisions.ts');
  check('the register is data: it imports nothing that reaches QuickBooks, the database or a server-only module', !/from '\.\/(quickbooks|supabase|client-invoice-pdf|original-status|pdf-text)/.test(reg) && !/server-only/.test(reg));
  check('every look-up honours it — the SOA / Email Drafts / Save PDF path, the queue and the upload', /confirmedOriginalsFor\(company, invoiceId\)/.test(read('lib/quickbooks-original-copy.ts')) && /confirmedOriginalsFor\(book, invoiceId\)/.test(read('lib/original-status.ts')) && /confirmed: confirmedOriginalsFor\(company, invoiceId\)/.test(read('lib/original-upload-live.ts')) && (read('lib/original-upload.ts').match(/, facts, deps\.confirmed\)/g) ?? []).length === 2);
  check('the upload page itself stays proof-only: a file staff upload must pass the proof, a decision is not a way around it', /const check = checkOriginalCopy\(pdf, facts\);\s*\n?\s*if \(!check\.ok\) return refused\(check\.reason\);/.test(read('lib/original-upload.ts')));
  check('the proof module never writes anywhere and has no node-only import (it is bundled in the page)', !/from 'node:|from 'fs'|from 'crypto'/.test(read('lib/original-copy.ts')));

  console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
