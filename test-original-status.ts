// The "Invoice Originals" status page (INV-QB-037): lib/original-status-core.ts
// (which open invoices are listed, what is said about each, how a status is
// derived) and that the page, its routes and its reading only READ — and read
// exactly what the real client-PDF path reads. Nothing here touches QuickBooks
// or the database.
//
// Run: npx tsx test-original-status.ts
import fs from 'fs';
import path from 'path';
import { INVOICE_COPY_NOTE } from './lib/quickbooks-attachments';
import type { OriginalCopyResult, TriedAttachment } from './lib/original-copy';
import { hintForReason, rowKey, rowStatus, scanState, splitInvoiceRows, summarizeFile, verdictFromResult, type FileSummary } from './lib/original-status-core';
import { NAV_TREE, navLeaves } from './lib/nav-tree';
import { pageRuleFor } from './lib/workspaces';

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
const f = (id: string, pdf: boolean): FileSummary => ({ id, fileName: `f${id}`, contentType: null, size: null, bySystem: false, createdAt: null, pdf });
check('overview: nothing / only pictures / a PDF to open', scanState([]) === 'nothing' && scanState([f('1', false)]) === 'no-pdf' && scanState([f('1', false), f('2', true)]) === 'has-pdf');

console.log('\n--- what is said once the files are opened ---');
const tried = (...t: Partial<TriedAttachment>[]): TriedAttachment[] => t.map((x, i) => ({ id: String(i + 1), fileName: `f${i + 1}.pdf`, bySystem: false, createdAt: null, outcome: 'refused', reason: 'r', ...x }));
const used: OriginalCopyResult = { found: { bytes: new Uint8Array(1), fileName: 'f1.pdf', attachableId: '1', bySystem: true }, tried: tried({ outcome: 'used', bySystem: true }) };
check('an accepted file: "using", and by whom it was attached', verdictFromResult(used).verdict === 'using' && /attached by the system/.test(verdictFromResult(used).summary) && verdictFromResult(used).files.length === 1);
check('by hand says by hand', /attached by hand/.test(verdictFromResult({ ...used, tried: tried({ outcome: 'used', bySystem: false }) }).summary));
const refused = verdictFromResult({ none: 'x', tried: tried({ reason: "it is the system's own drawing" }, { outcome: 'skipped', reason: 'not a PDF' }) });
check('files attached but none accepted: "refused", every file with its reason, and the system redraws', refused.verdict === 'refused' && refused.files.length === 2 && /redraws/.test(refused.summary) && refused.files[0].reason === "it is the system's own drawing");
check('nothing attached: "nothing"', verdictFromResult({ none: 'no PDF attached', tried: [] }).verdict === 'nothing');
check('QuickBooks failing is "unavailable", never "nothing attached"', verdictFromResult({ none: 'could not list the invoice\'s attachments (HTTP 500)', trouble: true, tried: [] }).verdict === 'unavailable');
check('a book that is not looked up, or not connected, is "unavailable" too', verdictFromResult({ none: 'TAO originals are not looked up', tried: [] }).verdict === 'unavailable' && verdictFromResult({ none: 'QuickBooks TAB is not connected', tried: [] }).verdict === 'unavailable');

console.log('\n--- what staff are told to do about a refused file ---');
const hint = (reason: string) => hintForReason(reason) ?? '';
check('Save PDF output: do not use it', /Save PDF/.test(hint("it is the system's own drawing (what Save PDF gives), not QuickBooks' invoice")));
check('the split version / another version: attach what the client first received', /split version/.test(hint("its amounts are not the unsplit invoice's (missing 700.00; unexpected 175.00, 525.00)")));
check('a scan, a picture, a bundle: one normal PDF', /not a scan/.test(hint('it has 8 pages and only 6 could be read')) && /not a scan/.test(hint('page 2 has no text (a scan or a picture?)')));
check('a password-protected or unreadable file: a normal PDF without a password', /without a password/.test(hint('could not be read (Input document to `PDFDocument.load` is encrypted.)')) && /without a password/.test(hint('the file is not a PDF')));
check('another invoice or customer: it is not the PDF of this invoice', ['it does not say "INVOICE NO. : TAB 02611112"', 'it is not billed to 1X Exchange Pte. Ltd.'].every(r => /not the PDF of this invoice — check its invoice number and customer/.test(hint(r))));
check('a date or total that no longer matches: the invoice CHANGED after the PDF was made (not "wrong invoice")', ['it is not dated 01/10/2026', 'it does not say "TOTAL 1,360.00"'].every(r => /changed after this PDF was made/.test(hint(r)) && !/not the PDF of this invoice/.test(hint(r))));
check('a file without the letterhead as text: not printed by QuickBooks (the Save PDF file saved again)', /not printed by QuickBooks/.test(hint("it does not carry the company letterhead as text — QuickBooks' own invoice does; the system's own drawing re-saved by another program does not")));
check('an oversized file: attach what QuickBooks printed', /well under 1 MB/.test(hint('larger than 1 MB — an invoice PDF is 80-260 KB')));
check('a reason with nothing to add gets no hint', hintForReason('not needed — an earlier file was accepted') === null && hintForReason('proved to be the original') === null);

console.log('\n--- the status shown for a row ---');
const using = verdictFromResult(used);
check('before the overview arrives: reading', rowStatus({ scanLoaded: false }) === 'scanning');
check('overview: nothing / no PDF / a PDF not opened yet', rowStatus({ scanLoaded: true, scan: 'nothing' }) === 'nothing' && rowStatus({ scanLoaded: true, scan: 'no-pdf' }) === 'no-pdf' && rowStatus({ scanLoaded: true, scan: 'has-pdf' }) === 'to-check');
check('a book QuickBooks could not be read for is "unavailable", not "nothing attached"', rowStatus({ scanLoaded: true, scanError: 'HTTP 401' }) === 'unavailable' && rowStatus({ scanLoaded: true }) === 'unavailable');
check('opening a file: working, then its verdict; a failed opening is "failed"', rowStatus({ scanLoaded: true, scan: 'has-pdf', verdict: 'checking' }) === 'checking' && rowStatus({ scanLoaded: true, scan: 'has-pdf', verdict: using }) === 'using' && rowStatus({ scanLoaded: true, scan: 'has-pdf', verdict: refused }) === 'refused' && rowStatus({ scanLoaded: true, scan: 'has-pdf', verdict: { failed: 'x' } }) === 'failed');

console.log('\n--- the page only reads, and reads what the real PDF path reads ---');
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const status = read('lib/original-status.ts');
check('nothing writes to the database from the status reading', !/\.(insert|update|upsert|delete)\(/.test(status));
check('nothing is uploaded to or removed from QuickBooks from the status reading', !/\.upload\(|\.remove\(|createHttpAttachmentApi|method: 'POST'|method: 'DELETE'/.test(status));
for (const route of ['app/api/billing/originals/route.ts', 'app/api/billing/originals/scan/route.ts', 'app/api/billing/originals/check/route.ts']) {
  const src = read(route);
  check(`${route} is GET only`, /export async function GET\(/.test(src) && !/export async function (POST|PUT|PATCH|DELETE)\(/.test(src));
}
const page = read('app/billing/soa/originals/page.tsx');
check('the page calls only the three read routes, with GET', ['/api/billing/originals', '/api/billing/originals/scan', '/api/billing/originals/check?'].every(u => page.includes(u)) && !/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(page));
check('the single-invoice answer uses the SAME invoice read as getClientInvoicePdf (loadInvoiceForClient) and the SAME look-up', /loadInvoiceForClient\(company, invoiceId\)/.test(status) && /findOriginalInvoiceCopy\(company, invoiceId, loaded\.facts\)/.test(status) && /await loadInvoiceForClient\(company, invoiceId\)/.test(read('lib/client-invoice-pdf.ts')));
check('opening files is one invoice at a time, only on request', /for \(const \[i, r\] of todo\.entries\(\)\)/.test(page) && /await check\(r\)/.test(page) && !/useEffect\([^)]*check\(/.test(page));
check('the overview is one paged read per book, not one query per invoice', /listAllForInvoices\(\)/.test(status));

console.log('\n--- where it lives ---');
const leaf = navLeaves(NAV_TREE).find(l => l.node.href === '/billing/soa/originals');
check('a menu entry under Billing System', !!leaf && leaf.trail.join(' > ') === 'Billing System' && leaf.node.label === 'Invoice Originals', JSON.stringify(leaf?.trail));
check('the page is covered by the existing Outstanding access rule (no new rule, same departments)', pageRuleFor('/billing/soa/originals', new URLSearchParams())?.key === 'outstanding');
const next = read('next.config.ts');
const block = next.slice(next.indexOf("'/api/billing/originals/check'"), next.indexOf(']', next.indexOf("'/api/billing/originals/check'")));
check('the route that opens PDFs ships pdf-parse and pdfjs-dist', block.includes('./node_modules/pdf-parse/**') && block.includes('./node_modules/pdfjs-dist/**'));

console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
process.exit(fail === 0 ? 0 : 1);
