// The "Invoice Originals" to-do page (INV-QB-037): lib/original-status-core.ts
// (which open invoices are listed, who is still waiting for an original, what
// is said about each), that the queue only READS and reads exactly what the
// real client-PDF path reads, that the upload is the one place that writes and
// is gated, and the page/route/menu wiring. Nothing here touches QuickBooks or
// the database; the upload's own decisions are test-original-upload.ts.
//
// Run: npx tsx test-original-status.ts
import fs from 'fs';
import path from 'path';
import { INVOICE_COPY_NOTE } from './lib/quickbooks-attachments';
import type { AttachmentFile, InvoiceFacts, OriginalCopyResult, TriedAttachment } from './lib/original-copy';
import { chunk, fallbackWording, hintForReason, invoicesByIdQuery, mapLimit, queueOutcome, queueRowFor, rowKey, splitInvoiceRows, summarizeFile, verdictKey } from './lib/original-status-core';
import { NAV_TREE, navLeaves } from './lib/nav-tree';
import { pageRuleFor } from './lib/workspaces';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};

console.log('--- which invoices are listed ---');
const item = (qb_company: string, qb_invoice_id: string | number, product_service: string | null) => ({ qb_company, qb_invoice_id, product_service });
const inv = (qb_company: string, qb_invoice_id: string | number, invoice_no: string, balance: number | null, txn_date: string | null = '2026-10-01', customer_name: string | null = 'Client Pte. Ltd.', total_amt: number | string | null = 1360) => ({ qb_company, qb_invoice_id, invoice_no, customer_name, txn_date, total_amt, balance });
const rows = splitInvoiceRows(
  [
    item('TAB', 1, 'Secretary:Corporate Secretarial Services'), item('TAB', 1, 'Deferred Revenue - Corp Sec'),
    item('TAB', 2, 'Secretary:Corporate Secretarial Services'),                                   // nothing split
    item('TAC', 3, 'Secretary:Nominee Director Fees - WYD'), item('TAC', 3, 'Deferred - ND Fees - WYD'),
    item('TAB', 4, 'Deferred Revenue - Reg Addr'),                                                 // paid
    item('TAB', 5, 'Deferred Revenue - Corp Sec'),                                                 // newer
    item('TAO', 6, null), item('XYZ', 7, 'Deferred Revenue - Corp Sec'),                           // not a deferred line / unknown book
    item('TAC', 1, 'Deferred Revenue - Corp Sec'),                                                 // same id, OTHER book
  ],
  [
    inv('TAB', 1, '02611112', 1360, '2026-10-01'), inv('TAB', 2, '02611113', 460), inv('TAC', 3, '02680320', 3000, '2026-09-29'),
    inv('TAB', 4, '02611100', 0), inv('TAB', 5, '02611140', 760, '2026-10-06'), inv('TAO', 6, 'T1', 50), inv('XYZ', 7, 'X1', 50),
    inv('TAB', 8, '02611199', 100), // no item rows at all
  ],
);
check('only OPEN invoices that carry a Deferred line, of the three books', rows.map(r => `${r.company}#${r.invoiceNo}`).join(' ') === 'TAB#02611140 TAB#02611112 TAC#02680320', rows.map(r => `${r.company}#${r.invoiceNo}`).join(' '));
check('newest first', rows[0].txnDate === '2026-10-06' && rows[2].txnDate === '2026-09-29');
check('the same Id in another book is another invoice (TAC 1 has a twin but no invoice row)', !rows.some(r => r.company === 'TAC' && r.qbInvoiceId === '1'));
check('amounts and ids come out as numbers and strings', rows[1].qbInvoiceId === '1' && rows[1].balance === 1360 && rows[1].totalAmt === 1360 && rowKey(rows[1]) === 'TAB|1');
check('a missing date or name does not break the list', splitInvoiceRows([item('TAB', 9, 'Deferred Revenue - Corp Sec')], [inv('TAB', 9, '1', 5, null, null, null)]).length === 1);


console.log('\n--- what the browser is told about a file ---');
const raw = { Id: '1000001421', FileName: 'INV02611130-X.pdf', ContentType: 'application/pdf', Size: 160342, Note: INVOICE_COPY_NOTE, CreateTime: '2026-10-06T07:54:00+08:00', TempDownloadUri: 'https://files.test/signed?sig=SECRET' };
const sum = summarizeFile(raw);
check('the summary carries the name, size, who attached it and when', sum.id === '1000001421' && sum.fileName === 'INV02611130-X.pdf' && sum.size === 160342 && sum.bySystem && sum.pdf && sum.createdAt === '2026-10-06T07:54:00+08:00');
check('…and never the signed download link', !JSON.stringify(sum).includes('SECRET') && !('TempDownloadUri' in sum));
check('a picture is not a PDF; a PDF is recognised by its name when the type is blank', !summarizeFile({ Id: '2', ContentType: 'image/png', FileName: 'scan.png' }).pdf && summarizeFile({ Id: '3', FileName: 'A.PDF' }).pdf);

console.log('\n--- what staff are told to do about a refused file ---');
const hint = (reason: string) => hintForReason(reason) ?? '';
check('Save PDF output: do not use it', /Save PDF/.test(hint("it is the system's own drawing (what Save PDF gives), not QuickBooks' invoice")));
check('the split version / another version: attach what the client first received', /split version/.test(hint("its amounts are not the unsplit invoice's (missing 700.00; unexpected 175.00, 525.00)")));
check('a scan, a picture, a bundle: one normal PDF', /not a scan/.test(hint('it has 8 pages and only 6 could be read')) && /not a scan/.test(hint('page 2 has no text (a scan or a picture?)')));
check('a password-protected or unreadable file: a normal PDF without a password', /without a password/.test(hint('could not be read (Input document to `PDFDocument.load` is encrypted.)')) && /without a password/.test(hint('the file could not be read (Invalid PDF structure.)')));
check('a file that is not a PDF at all: only a PDF is used (not a talk of passwords)', ['the file is not a PDF', 'not a PDF (a picture or another kind of file)'].every(r => /Only a PDF file is used/.test(hint(r)) && !/password/.test(hint(r))));
check('another invoice or customer: it is not the PDF of this invoice', ['it does not say "INVOICE NO. : TAB 02611112"', 'it is not billed to 1X Exchange Pte. Ltd.'].every(r => /not the PDF of this invoice — check its invoice number and customer/.test(hint(r))));
check('a date or total that no longer matches: the invoice CHANGED after the PDF was made (not "wrong invoice")', ['it is not dated 01/10/2026', 'it does not say "TOTAL 1,360.00"'].every(r => /changed after this PDF was made/.test(hint(r)) && !/not the PDF of this invoice/.test(hint(r))));
check('a file without the letterhead as text: not printed by QuickBooks (the Save PDF file saved again)', /not printed by QuickBooks/.test(hint("it does not carry the company letterhead as text — QuickBooks' own invoice does; the system's own drawing re-saved by another program does not")));
check('an oversized file: attach what QuickBooks printed', /well under 1 MB/.test(hint('larger than 1 MB — an invoice PDF is 80-260 KB')));
check('a reason with nothing to add gets no hint', hintForReason('not needed — an earlier file was accepted') === null && hintForReason('proved to be the original') === null);


console.log('\n--- who is still waiting (the queue) ---');
const row = { company: 'TAB' as const, qbInvoiceId: '1', invoiceNo: 'TAB 02611112', customerName: 'Client Pte. Ltd.', txnDate: '2026-10-01', totalAmt: 1360, balance: 1360 };
const tried = (...t: Partial<TriedAttachment>[]): TriedAttachment[] => t.map((x, i) => ({ id: String(i + 1), fileName: `f${i + 1}.pdf`, bySystem: false, createdAt: null, outcome: 'refused', reason: 'r', ...x }));
const pdfFile = (id: string): AttachmentFile => ({ Id: id, FileName: `f${id}.pdf`, ContentType: 'application/pdf', Size: 100000, CreateTime: '2026-10-01T00:00:00Z', TempDownloadUri: 'https://files.test/x' });
const found: OriginalCopyResult = { found: { bytes: new Uint8Array(1), fileName: 'f1.pdf', attachableId: '1', bySystem: false }, tried: tried({ outcome: 'used' }) };
check('an invoice whose original is in use is NOT listed (Vincent: it is finished work)', queueRowFor(row, [pdfFile('1')], found, 'x') === null);
const none = queueRowFor(row, [], { none: 'no PDF attached', tried: [] }, 'The system redraws this invoice.');
check('nothing attached: listed as "nothing"', none?.state === 'nothing' && none.tried.length === 0 && none.invoiceNo === 'TAB 02611112' && none.balance === 1360);
const pictures = queueRowFor(row, [{ Id: '2', FileName: 'scan.png', ContentType: 'image/png' }], { none: 'no PDF attached', tried: tried({ outcome: 'skipped', reason: 'not a PDF (a picture or another kind of file)' }) }, 'x');
check('only a picture attached: "no-pdf", the file and why it is not used', pictures?.state === 'no-pdf' && pictures.tried.length === 1 && /not a PDF/.test(pictures.tried[0].reason));
const rejected = queueRowFor(row, [pdfFile('3')], { none: 'attachment #3: it is the system\'s own drawing', tried: tried({ reason: "it is the system's own drawing" }) }, 'x');
check('a PDF the proof refused: "refused", with the reason per file', rejected?.state === 'refused' && rejected.tried[0].reason === "it is the system's own drawing");
const noTerms = fallbackWording({ kind: 'quickbooks', reason: 'its payment terms could not be read from QuickBooks' });
check('every queue row says what the client gets meanwhile: the redraw, or QuickBooks\' own PDF with its Deferred lines when the system cannot draw it',
  none?.fallback === 'The system redraws this invoice.' && /redraws this invoice/.test(fallbackWording({ kind: 'system' }))
  && /QuickBooks' own PDF is sent, with accounting's Deferred Revenue lines showing/.test(noTerms) && /payment terms could not be read/.test(noTerms));
check('the queue row never carries a file\'s bytes or download link', !JSON.stringify(rejected).includes('files.test') && !('bytes' in (rejected ?? {})));

console.log('\n--- one invoice: closed, done, decided or waiting ---');
const waitingAnswer: OriginalCopyResult = { none: 'no PDF attached', tried: [] };
const one = { row, live: { balance: 1360, totalAmt: 1360, txnDate: '2026-10-01' } as { balance: number; totalAmt?: number; txnDate?: string } | null, split: true, files: [] as AttachmentFile[], answer: waitingAnswer as OriginalCopyResult | { found: true } | null, decided: false, fallback: 'F' };
const live = (() => { const o = queueOutcome({ ...one, live: { balance: 900, totalAmt: 1000, txnDate: '2026-10-02' } }); return typeof o === 'object' && o.balance === 900 && o.totalAmt === 1000 && o.txnDate === '2026-10-02' && o.fallback === 'F' && o.state === 'nothing'; })();
check('an invoice nothing is known to be wrong with is waiting, with the LIVE figures and what the client gets meanwhile', live);
check('not found in QuickBooks, paid or voided (balance 0), no longer split, or nothing to judge: closed — whatever else is known',
  [queueOutcome({ ...one, live: null }), queueOutcome({ ...one, live: { balance: 0 } }), queueOutcome({ ...one, split: false }), queueOutcome({ ...one, answer: null }), queueOutcome({ ...one, live: { balance: 0 }, decided: true, answer: found }), queueOutcome({ ...one, live: null, decided: true })].every(o => o === 'closed'));
check('its original in use: done — and that wins over a decision', queueOutcome({ ...one, answer: found }) === 'done' && queueOutcome({ ...one, answer: found, decided: true }) === 'done' && queueOutcome({ ...one, answer: { found: true } }) === 'done');
check('left as it is by Vincent and still the invoice he decided about: decided, not listed', queueOutcome({ ...one, decided: true }) === 'decided');
check('a decision never turns a paid invoice into a counted one', queueOutcome({ ...one, live: { balance: 0 }, decided: true }) === 'closed');
check('an invoice with a refused file is waiting as "refused" and keeps the reasons', (() => { const o = queueOutcome({ ...one, files: [pdfFile('3')], answer: { none: 'x', tried: tried({ reason: 'r3' }) } }); return typeof o === 'object' && o.state === 'refused' && o.tried[0].reason === 'r3'; })());

console.log('\n--- reading many invoices at once ---');
check('the batched read names the ids it is given, quoted, nothing else', invoicesByIdQuery(['12', '345']) === "SELECT * FROM Invoice WHERE Id IN ('12','345') MAXRESULTS 1000");
check('an id that is not digits never reaches the query', ["1' OR '1'='1", '12 ', 'abc', ''].every(id => { try { invoicesByIdQuery(['5', id]); return false; } catch { return true; } }));
check('no ids: refused rather than an unfiltered read', (() => { try { invoicesByIdQuery([]); return false; } catch { return true; } })());
check('chunks keep every item once and in order', JSON.stringify(chunk([1, 2, 3, 4, 5], 2)) === '[[1,2],[3,4],[5]]' && chunk([], 3).length === 0);
(async () => {
  let running = 0; let peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async n => { running++; peak = Math.max(peak, running); await new Promise(r => setTimeout(r, 5)); running--; return n * 2; });
  check('mapLimit: results in the order of the items, never more than the limit at once', JSON.stringify(out) === '[2,4,6,8,10,12,14,16]' && peak === 3 && peak <= 3, `peak ${peak}`);
  check('mapLimit: an empty list is fine', (await mapLimit([], 4, async n => n)).length === 0);
  let failed = '';
  try { await mapLimit([1, 2, 3], 2, async n => { if (n === 2) throw new Error('boom'); return n; }); } catch (e) { failed = (e as Error).message; }
  check('mapLimit: a failure is not swallowed', failed === 'boom');

  console.log('\n--- when a remembered answer may be reused ---');
  const facts: InvoiceFacts = { invoiceNo: 'TAB 02611112', date: '01/10/2026', customer: 'Client Pte. Ltd.', total: 1360, lines: [{ amount: 700, deferred: false }, { amount: 660, deferred: true }], preferred: [1360] };
  const files = [pdfFile('1'), pdfFile('2')];
  const key = verdictKey('TAB', '1', facts, files);
  check('the same invoice and files: the same key, whatever order the files come in', key === verdictKey('TAB', '1', facts, [...files].reverse()));
  check('an edited invoice (total, a line, the date, the customer) is another key', [{ ...facts, total: 1361 }, { ...facts, lines: [{ amount: 700, deferred: false }, { amount: 660, deferred: false }] }, { ...facts, date: '02/10/2026' }, { ...facts, customer: 'Other Pte. Ltd.' }].every(x => verdictKey('TAB', '1', x, files) !== key));
  check('a new file, a replaced file (size) or another invoice or book is another key', [verdictKey('TAB', '1', facts, [...files, pdfFile('3')]), verdictKey('TAB', '1', facts, [pdfFile('1'), { ...pdfFile('2'), Size: 5 }]), verdictKey('TAB', '2', facts, files), verdictKey('TAC', '1', facts, files)].every(k => k !== key));

  const status = read('lib/original-status.ts');
  console.log('\n--- the queue only reads, and reads what the real PDF path reads ---');
  check('nothing writes to the database from the queue (the only .delete( is the in-memory answer cache)', !/\.(insert|update|upsert)\(/.test(status) && !/(?<!remembered)\.delete\(/.test(status));
  check('nothing is uploaded to or removed from QuickBooks from the queue', !/\.upload\(|\.remove\(|createHttpAttachmentApi|method: 'POST'|method: 'DELETE'/.test(status));
  check('the proof is the SOA\'s own look-up (selectVerifiedOriginal) with the SOA\'s own reader (readPdf) and size cap', /selectVerifiedOriginal\(/.test(status) && /read: readPdf/.test(status) && /MAX_ORIGINAL_BYTES/.test(status));
  const pdfLib = read('lib/client-invoice-pdf.ts');
  check('the invoice facts come from ONE function for the queue, the upload and the SOA (prepareInvoiceForClient)', /prepareInvoiceForClient\(book, live,/.test(status) && /export function prepareInvoiceForClient/.test(pdfLib) && (pdfLib.match(/prepareInvoiceForClient\(/g) ?? []).length >= 2 && !/buildClientInvoiceModel\(|invoiceFacts\(/.test(status));
  check('Vincent\'s decisions count in the queue as in the SOA: a confirmed original is looked up with the file, a decided invoice is not listed but counted, and the classification is the tested pure function',
    /confirmedOriginalsFor\(book, invoiceId\)/.test(status) && /decided: !!facts && !!redrawDecisionFor\(book, row\.qbInvoiceId, facts\)/.test(status) && /return queueOutcome\(\{/.test(status) && /out\.decided \+= rows\.filter\(r => r === 'decided'\)\.length/.test(status));
  check('only the books the system looks up are listed (TAO has none to redraw)', /ORIGINAL_COPY_LOOKUP_MODE\[b\] === 'live'/.test(status));
  check('invoices are read in batches, not one request per invoice; the files in one paged read per book', /invoicesByIdQuery\(part\)/.test(status) && /chunk\(ids, INVOICES_PER_QUERY\)/.test(status) && /listAllForInvoices\(\)/.test(status) && !/loadInvoiceForClient\(/.test(status));
  check('an invoice paid, voided or no longer split since the last sync is not listed (the live invoice decides): only an invoice still open is prepared, and queueOutcome closes the rest', /live && Number\(live\.Balance\) > 0 \? prepareInvoiceForClient\(/.test(status) && /split: !!facts/.test(status) && /!\(live\.balance > 0\) \|\| !input\.split/.test(read('lib/original-status-core.ts')));
  check('a book that cannot be read is reported, never shown as "nothing to do" for its invoices', /out\.errors\[book\]/.test(status) && /out\.unknown \+= mine\.length/.test(status));
  check('a failed download or read is asked again next time (only the proof\'s own answers are remembered)', /could not be read \\\(/.test(status) && /worthKeeping\(result\)/.test(status));
  check('two people opening the page share one reading', /inFlight \?\?=/.test(status));
  check('one invoice that cannot be judged does not hide the others: it is counted as not checked and reported', /failures\.push\(/.test(status) && /out\.unknown \+= failures\.length/.test(status));

  console.log('\n--- the routes ---');
  const queueRoute = read('app/api/billing/originals/route.ts');
  const uploadRoute = read('app/api/billing/originals/upload/route.ts');
  check('the queue route is GET only', /export async function GET\(/.test(queueRoute) && !/export async function (POST|PUT|PATCH|DELETE)\(/.test(queueRoute));
  check('the upload route is POST only', /export async function POST\(/.test(uploadRoute) && !/export async function (GET|PUT|PATCH|DELETE)\(/.test(uploadRoute));
  for (const [name, src] of [['queue', queueRoute], ['upload', uploadRoute]] as const) {
    check(`the ${name} route needs an approved account that may open the page (the proxy only checks sign-in on /api)`, /getRequestAccount\(req\)/.test(src) && /canAccountOpen\(account, '\/billing\/soa\/originals'/.test(src) && /status: 401/.test(src) && /status: 403/.test(src));
  }
  check('the upload route takes TAB or TAC only, a numeric id, a file, and refuses one over 1 MB before reading it', /new Set<QbCompany>\(\['TAB', 'TAC'\]\)/.test(uploadRoute) && /\^\\d\+\$/.test(uploadRoute) && /file instanceof File/.test(uploadRoute) && /file\.size > MAX_ORIGINAL_BYTES/.test(uploadRoute));
  check('the upload route logs ids and the outcome, never a file name', /console\.info\(`\[originals\/upload\] \$\{company\} \$\{id\} \$\{result\.status\}/.test(uploadRoute) && !/fileName|file\.name/.test(uploadRoute.replace(/\/\/.*$/gm, '')));
  check('the two earlier read routes (scan, check) are gone', !fs.existsSync(path.join(process.cwd(), 'app/api/billing/originals/scan/route.ts')) && !fs.existsSync(path.join(process.cwd(), 'app/api/billing/originals/check/route.ts')));
  const live = read('lib/original-upload-live.ts');
  check('the upload reads the invoice and the PDF exactly as the SOA does (loadInvoiceForClient, readPdf, the same size cap) and writes one attachment', /loadInvoiceForClient\(company, invoiceId\)/.test(live) && /read: readPdf/.test(live) && /MAX_ORIGINAL_BYTES/.test(live) && (live.match(/api\.upload\(/g) ?? []).length === 1 && !/api\.remove\(/.test(live));
  const decision = read('lib/original-upload.ts');
  check('the upload logic never removes or changes anything in QuickBooks', !/remove\(|\.delete\(|operation=delete/.test(decision));
  check('only the upload wiring writes to QuickBooks from this feature', ['lib/original-status.ts', 'lib/original-status-core.ts', 'app/billing/soa/originals/page.tsx', 'app/api/billing/originals/route.ts'].every(f => !/createHttpAttachmentApi|\.upload\(/.test(read(f))));

  console.log('\n--- the page ---');
  const page = read('app/billing/soa/originals/page.tsx');
  check('the page reads the queue with GET and uploads with POST to the upload route', /fetch\('\/api\/billing\/originals'\)/.test(page) && /fetch\('\/api\/billing\/originals\/upload', \{ method: 'POST', body: form \}\)/.test(page));
  check('an invoice with its original in use is not part of the page at all (no such status, no "Open the files")', !/Original in use|Open the files|to-check|'using'/.test(page));
  check('a file over 1 MB is stopped before it is sent; a refused file is shown with its reason and attaches nothing', /file\.size > MAX_BYTES/.test(page) && /case 'refused'/.test(page) && /Nothing was attached/.test(page));
  check('a finished row leaves the list at once; an unconfirmed upload stays, with what to do', /\.filter\(r => !doneKeys\.has\(rowKey\(r\)\)\)/.test(page) && /case 'unconfirmed': say\(\{ tone: 'warn'/.test(page));
  check('the explanation tells staff what to upload and what not to', /Do not upload/.test(page) && /Save PDF/.test(page) && /upload it on its row/.test(page));
  check('an empty list says nothing is left only when no book failed', /Every open split invoice has its original/.test(page) && /failedBooks\.length === 0/.test(page));

  console.log('\n--- where it lives ---');
  const leaf = navLeaves(NAV_TREE).find(l => l.node.href === '/billing/soa/originals');
  check('a menu entry under Billing System', !!leaf && leaf.trail.join(' > ') === 'Billing System' && leaf.node.label === 'Invoice Originals', JSON.stringify(leaf?.trail));
  check('the page is covered by the existing Outstanding access rule (no new rule, same departments)', pageRuleFor('/billing/soa/originals', new URLSearchParams())?.key === 'outstanding');
  const next = read('next.config.ts');
  const block = (route: string) => next.slice(next.indexOf(`'${route}'`), next.indexOf(']', next.indexOf(`'${route}'`)));
  check('both routes that open PDFs ship pdf-parse and pdfjs-dist', ['/api/billing/originals', '/api/billing/originals/upload'].every(r => next.includes(`'${r}'`) && block(r).includes('./node_modules/pdf-parse/**') && block(r).includes('./node_modules/pdfjs-dist/**')));
  check('the removed check route is not left in the tracing config', !next.includes('/api/billing/originals/check'));

  console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
