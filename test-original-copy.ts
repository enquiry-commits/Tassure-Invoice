// The original invoice attached to an invoice in QuickBooks (INV-QB-037):
// lib/original-copy.ts (is THIS PDF the unsplit original, and which attached
// file to use), lib/pdf-text.ts (reading a real PDF's text),
// lib/quickbooks-attachments-http.ts's reader (against a fake fetch), and that
// the client invoice PDF really consults it. Nothing here touches QuickBooks —
// the same check was run on real attached files separately (8 of 8 copies of
// unsplit invoices accepted, 12 of 12 current QuickBooks PDFs of split
// invoices refused).
//
// Run: npx tsx test-original-copy.ts
import fs from 'fs';
import path from 'path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { INVOICE_COPY_NOTE } from './lib/quickbooks-attachments';
import { MAX_ORIGINAL_BYTES, checkOriginalCopy, formatMoney, printedAmounts, selectVerifiedOriginal, type AttachmentFile } from './lib/original-copy';
import { extractPdfText } from './lib/pdf-text';
import { createHttpAttachmentReader } from './lib/quickbooks-attachments-http';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};
const bytesOf = (n: number, fill = 7) => new Uint8Array(new ArrayBuffer(n)).fill(fill);

// 1X EXCHANGE TAB #02611112 (real shape): the service was 700.00 when the
// client got it; accounting later split it into 175.00 + 525.00.
const ORIGINAL = 'INVOICE TAB 02611112 DATE 01/10/2026 Corporate Secretarial Services 700.00 Government fee for filing Annual Return [FYE 31.12.2026] 60.00 XBRL for the year (FYE 31.12.2026) 600.00 TOTAL 1,360.00 Due 08.10.2026';
const SPLIT = 'INVOICE TAB 02611112 DATE 01/10/2026 Corporate Secretarial Services 175.00 Deferred Revenue - Corp Sec 525.00 Government fee for filing Annual Return [FYE 31.12.2026] 60.00 XBRL for the year (FYE 31.12.2026) 600.00 TOTAL 1,360.00 Due 08.10.2026';
const ARGS = { docNumber: '02611112', amounts: [700, 60, 600], total: 1360 };

(async () => {
  console.log('--- what a PDF prints ---');
  const p = printedAmounts('Total 1,360.00 due 31.08.2026 on 175.00 and 525.00; ref 6221.1234 call 6221 1234; 12,345,678.90');
  check('money is found, with thousands separators', p.get('1,360.00') === 1 && p.get('175.00') === 1 && p.get('525.00') === 1 && p.get('12,345,678.90') === 1, JSON.stringify([...p]));
  check('a date such as 31.08.2026 is not an amount', ![...p.keys()].some(k => k.startsWith('31.')) && !p.has('08.20'));
  check('a reference such as 6221.1234 is not an amount', !p.has('6221.12') && !p.has('21.12'));
  check('the same amount twice counts twice', printedAmounts('3,000.00 3,000.00').get('3,000.00') === 2);
  check('amounts are written the way QuickBooks writes them', formatMoney(133.3) === '133.30' && formatMoney(1360) === '1,360.00' && formatMoney(5.5) === '5.50' && formatMoney(400.00000000000006) === '400.00');

  console.log('\n--- is it the original? ---');
  check('the original invoice passes', checkOriginalCopy(ORIGINAL, ARGS).ok);
  const split = checkOriginalCopy(SPLIT, ARGS);
  check('the SPLIT version (QuickBooks prints it today) is refused', !split.ok && /missing 700\.00/.test((split as { reason: string }).reason) && /unexpected 175\.00, 525\.00/.test((split as { reason: string }).reason), JSON.stringify(split));
  check('another invoice\'s number is refused even with the same amounts', !checkOriginalCopy(ORIGINAL.replace('02611112', '02611113'), ARGS).ok);
  check('no invoice number to look for: refused', !checkOriginalCopy(ORIGINAL, { ...ARGS, docNumber: '' }).ok);
  check('an older figure (the amount was changed afterwards) is refused', !checkOriginalCopy(ORIGINAL.replace('700.00', '650.00').replace('1,360.00', '1,310.00'), ARGS).ok);
  check('a missing total is refused', !checkOriginalCopy(ORIGINAL.replace('TOTAL 1,360.00', ''), ARGS).ok);
  check('an extra amount somebody added is refused', !checkOriginalCopy(ORIGINAL + ' Late fee 25.00', ARGS).ok);
  check('dates and the invoice number never count as amounts', checkOriginalCopy(ORIGINAL + ' Printed 06.10.2026 page 1', ARGS).ok);
  const one = { docNumber: '02680320', amounts: [3000], total: 3000 };
  check('one service, same amount as the total: the amount must print twice', checkOriginalCopy('TAC 02680320 Nominee Director Fees 3,000.00 TOTAL 3,000.00', one).ok && !checkOriginalCopy('TAC 02680320 Nominee Director Fees 3,000.00', one).ok);
  check('the split version of that one is refused', !checkOriginalCopy('TAC 02680320 Nominee Director Fees 500.00 Deferred - ND Fees 2,500.00 TOTAL 3,000.00', one).ok);
  const twin = { docNumber: '1', amounts: [350, 350], total: 700 };
  check('two services at the same amount: counted per line', checkOriginalCopy('1 350.00 350.00 TOTAL 700.00', twin).ok && !checkOriginalCopy('1 350.00 TOTAL 700.00', twin).ok);
  check('a discount line matches however the sign is written', checkOriginalCopy('02611112 700.00 -50.00 60.00 TOTAL 710.00', { docNumber: '02611112', amounts: [700, -50, 60], total: 710 }).ok && checkOriginalCopy('02611112 700.00 (50.00) 60.00 TOTAL 710.00', { docNumber: '02611112', amounts: [700, -50, 60], total: 710 }).ok);

  console.log('\n--- which attached file is used ---');
  const file = (Id: string, extra: Partial<AttachmentFile> = {}): AttachmentFile => ({ Id, FileName: `INV02611112-${Id}.pdf`, ContentType: 'application/pdf', Size: 160_000, Note: null, TempDownloadUri: `https://files.test/${Id}`, CreateTime: '2026-10-01T00:00:00Z', ...extra });
  // A file's text is chosen by byte 10 of its content, so each fake file says what it "prints".
  const MARK = { original: 1, split: 2, other: 3, broken: 4, html: 5 };
  const bytesFor = (m: number) => { const b = bytesOf(2048); '%PDF-'.split('').forEach((c, i) => { b[i] = c.charCodeAt(0); }); b[10] = m; return b; };
  const TEXTS: Record<number, string | Error> = { 1: ORIGINAL, 2: SPLIT, 3: ORIGINAL.replace('02611112', '02611999'), 4: new Error('Invalid PDF structure') };
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
      async text(b) { const t = TEXTS[b[10]]; if (t instanceof Error) throw t; return t; },
    }, ARGS).then(result => ({ result, log }));
  };

  let r = await run([file('1', { Note: INVOICE_COPY_NOTE }), file('2', { CreateTime: '2026-10-05T00:00:00Z' })], { 1: MARK.original, 2: MARK.original });
  check('the system\'s own copy is tried first, even next to a newer hand-attached original', 'found' in r.result && r.result.found.attachableId === '1' && r.result.found.bySystem && r.log.join(' ') === 'list dl:1', r.log.join(' '));
  r = await run([file('1', { Note: INVOICE_COPY_NOTE }), file('2')], { 1: MARK.split, 2: MARK.original });
  check('the system copy turns out to be a split version: the hand-attached original is used', 'found' in r.result && r.result.found.attachableId === '2' && !r.result.found.bySystem && r.log.join(' ') === 'list dl:1 dl:2', r.log.join(' '));
  r = await run([file('1', { CreateTime: '2026-09-01T00:00:00Z' }), file('2', { CreateTime: '2026-10-02T00:00:00Z' })], { 1: MARK.original, 2: MARK.original });
  check('among hand-attached files the newest goes first', 'found' in r.result && r.result.found.attachableId === '2');
  check('what comes back is the file\'s own bytes and name', 'found' in r.result && r.result.found.bytes[10] === MARK.original && r.result.found.fileName === 'INV02611112-2.pdf');
  r = await run([file('1')], { 1: MARK.split });
  check('only the split version attached: nothing is used, and it says why', 'none' in r.result && /INV02611112-1\.pdf: its amounts are not the unsplit invoice's/.test(r.result.none), JSON.stringify(r.result));
  r = await run([file('1')], { 1: MARK.other });
  check('a file for another invoice number is never used', 'none' in r.result && /invoice number 02611112 is not on it/.test(r.result.none));
  r = await run([], {});
  check('nothing attached', 'none' in r.result && r.result.none === 'no PDF attached' && r.log.join(' ') === 'list');
  r = await run([file('1', { ContentType: 'image/png', FileName: 'scan.png' }), file('2', { TempDownloadUri: undefined })], {});
  check('pictures and files without a download link are not even downloaded', 'none' in r.result && r.result.none === 'no PDF attached' && r.log.join(' ') === 'list');
  r = await run([file('1', { Size: MAX_ORIGINAL_BYTES + 1 })], {});
  check('an oversized file is never downloaded', 'none' in r.result && r.log.join(' ') === 'list');
  r = await run([file('1', { ContentType: undefined, FileName: 'INV02611112.PDF' })], { 1: MARK.original });
  check('a PDF whose content type QuickBooks left blank is still recognised by its name', 'found' in r.result);
  r = await run(new Error('HTTP 401'), {});
  check('QuickBooks refusing the list: nothing is used (the caller redraws)', 'none' in r.result && /could not list the invoice's attachments \(HTTP 401\)/.test(r.result.none));
  r = await run([file('1'), file('2')], { 1: new Error('HTTP 403'), 2: MARK.original });
  check('a download that fails moves on to the next file', 'found' in r.result && r.result.found.attachableId === '2');
  r = await run([file('1'), file('2')], { 1: MARK.broken, 2: MARK.original });
  check('a PDF that cannot be read moves on to the next file', 'found' in r.result && r.result.found.attachableId === '2');
  r = await run([file('1')], { 1: 'html' });
  check('something that is not a PDF at all (an error page) is refused', 'none' in r.result && /not a PDF/.test(r.result.none));
  const many = ['1', '2', '3', '4', '5'].map((id, i) => file(id, { CreateTime: `2026-10-0${5 - i}T00:00:00Z` }));
  r = await run(many, { 1: MARK.split, 2: MARK.split, 3: MARK.split, 4: MARK.split, 5: MARK.original });
  check('at most four files are tried per invoice', 'none' in r.result && r.log.join(' ') === 'list dl:1 dl:2 dl:3 dl:4', r.log.join(' '));

  console.log('\n--- reading a real PDF ---');
  const draw = async (pages: string[][]) => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const lines of pages) {
      const page = doc.addPage([595, 842]);
      lines.forEach((line, i) => {
        const [left, right] = line.split('|');
        page.drawText(left, { x: 50, y: 780 - i * 22, size: 11, font });
        if (right) page.drawText(right, { x: 480, y: 780 - i * 22, size: 11, font });
      });
    }
    return new Uint8Array(await doc.save());
  };
  const originalPdf = await draw([['INVOICE', 'TAB 02611112', 'Date 01/10/2026   Due 08.10.2026', 'Corporate Secretarial Services|700.00', 'Government fee for filing Annual Return|60.00', 'XBRL for the year|600.00', 'TOTAL|1,360.00']]);
  const splitPdf = await draw([['INVOICE', 'TAB 02611112', 'Date 01/10/2026   Due 08.10.2026', 'Corporate Secretarial Services|175.00', 'Deferred Revenue - Corp Sec|525.00', 'Government fee for filing Annual Return|60.00', 'XBRL for the year|600.00', 'TOTAL|1,360.00']]);
  const text = await extractPdfText(originalPdf);
  check('the text of a real PDF is read', /02611112/.test(text) && /Corporate Secretarial Services/.test(text), text.slice(0, 200));
  check('its amounts are read exactly', JSON.stringify([...printedAmounts(text)].sort()) === JSON.stringify([['1,360.00', 1], ['60.00', 1], ['600.00', 1], ['700.00', 1]].sort()), JSON.stringify([...printedAmounts(text)]));
  check('a real original PDF passes end to end', checkOriginalCopy(text, ARGS).ok);
  check('a real SPLIT PDF is refused end to end', !checkOriginalCopy(await extractPdfText(splitPdf), ARGS).ok);
  const twoPages = await draw([['TAB 02611112', 'Corporate Secretarial Services|700.00', 'Government fee|60.00'], ['XBRL for the year|600.00', 'TOTAL|1,360.00']]);
  check('an invoice that runs over two pages is read in full', checkOriginalCopy(await extractPdfText(twoPages), ARGS).ok);
  let threw = '';
  try { await extractPdfText(new Uint8Array([...new TextEncoder().encode('%PDF-1.4\n'), ...bytesOf(900)])); } catch (e) { threw = (e as Error).message; }
  check('a file that is not really a PDF is an error, not a hang', threw !== '', threw);

  console.log('\n--- the QuickBooks reader ---');
  type Seen = { url: string; init?: RequestInit };
  const seen: Seen[] = [];
  const fakeFetch = (respond: (url: string) => Response) => (async (url: string | URL | Request, init?: RequestInit) => { seen.push({ url: String(url), init }); return respond(String(url)); }) as typeof fetch;
  const reader = (respond: (url: string) => Response) => createHttpAttachmentReader({ base: 'https://qb.test', realmId: '123', accessToken: 'SECRET-TOKEN', fetchImpl: fakeFetch(respond) });
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

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
  const body = bytesFor(MARK.original);
  api = reader(() => new Response(body, { headers: { 'content-length': String(body.length) } }));
  const got = await api.download(file('1', { TempDownloadUri: 'https://files.test/a?sig=1' }), 5_000_000);
  check('download: returns the file\'s bytes', got.length === body.length && got[10] === MARK.original);
  check('download: the QuickBooks token is NOT sent to the file link (the signed link is the credential)', seen[0].url === 'https://files.test/a?sig=1' && !JSON.stringify(seen[0].init?.headers ?? {}).includes('SECRET-TOKEN') && !('Authorization' in ((seen[0].init?.headers as Record<string, string>) ?? {})));
  threw = '';
  try { await api.download(file('1', { TempDownloadUri: 'http://files.test/a' }), 5_000_000); } catch (e) { threw = (e as Error).message; }
  check('download: a link that is not https is refused', /not https/.test(threw));
  threw = '';
  try { await api.download(file('1', { TempDownloadUri: undefined }), 5_000_000); } catch (e) { threw = (e as Error).message; }
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
  api = reader(() => new Response('forbidden', { status: 403 }));
  threw = '';
  try { await api.download(file('1', { TempDownloadUri: 'https://files.test/a' }), 5_000_000); } catch (e) { threw = (e as Error).message; }
  check('download: an HTTP error is an error', /HTTP 403/.test(threw));

  console.log('\n--- the client invoice PDF uses it ---');
  const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const pdfLib = read('lib/client-invoice-pdf.ts');
  const quickbooksEarlyReturn = pdfLib.indexOf("decision.kind === 'quickbooks') return original(decision.reason)");
  const lookup = pdfLib.indexOf('findOriginalInvoiceCopy(company, invoiceId, decision.model)');
  const redraw = pdfLib.indexOf('renderClientInvoicePdf(decision.model');
  check('only an invoice accounting has split looks for its original (after the "nothing to fold" return)', quickbooksEarlyReturn > -1 && lookup > quickbooksEarlyReturn);
  check('the original is looked for BEFORE the system redraws', lookup > -1 && redraw > lookup);
  check('a verified original is returned as source "attachment"', /'found' in attached\) return \{ bytes: attached\.found\.bytes, source: 'attachment'/.test(pdfLib) && /source: 'system' \| 'quickbooks' \| 'attachment'/.test(pdfLib));
  const finder = read('lib/quickbooks-original-copy.ts');
  check('TAB and TAC look for originals, TAO (nothing to redraw) does not', /ORIGINAL_COPY_LOOKUP_MODE[^=]*= \{ TAB: 'live', TAC: 'live', TAO: 'off' \}/.test(finder));
  check('the look-up only reads: no upload, no delete, no POST', !/\.upload\(|\.remove\(|method: 'POST'|createHttpAttachmentApi/.test(finder));
  check('it never gives up the redraw by throwing (every failure is "none")', /catch \(err\)[\s\S]*return \{ none: why \}/.test(finder) && /Promise\.race/.test(finder));
  const nextConfig = read('next.config.ts');
  for (const route of ['/api/billing/client-invoice-pdf', '/api/billing/soa/pdf']) {
    const block = nextConfig.slice(nextConfig.indexOf(`'${route}'`), nextConfig.indexOf(']', nextConfig.indexOf(`'${route}'`)));
    check(`${route} ships pdf-parse and pdfjs-dist (its worker file is found at run time)`, block.includes('./node_modules/pdf-parse/**') && block.includes('./node_modules/pdfjs-dist/**'));
  }
  check('both routes have room for the extra QuickBooks calls', /export const maxDuration = \d+/.test(read('app/api/billing/client-invoice-pdf/route.ts')) && /export const maxDuration = \d+/.test(read('app/api/billing/soa/pdf/route.ts')));
  const pure = read('lib/original-copy.ts');
  check('the "is it the original" decision is pure (no network, no files)', !/\bfetch\(|from 'fs|from 'path'|server-only|process\.env/.test(pure));

  console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => { console.error(err); process.exit(1); });
