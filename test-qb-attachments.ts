// The invoice copy attached to the invoice in QuickBooks (INV-QB-036):
// lib/quickbooks-attachments.ts (decisions + wire formats),
// lib/quickbooks-attachments-http.ts (the HTTP side, against a fake fetch),
// and that the invoice routes really call it. Nothing here touches
// QuickBooks — the real upload was checked separately on a real invoice.
//
// Run: npx tsx test-qb-attachments.ts
import fs from 'fs';
import path from 'path';
import { INVOICE_COPY_NOTE, asciiFileName, buildUploadRequest, looksLikePdf, placeInvoiceCopy, readUploadResponse, type QbAttachable, type QbAttachmentApi } from './lib/quickbooks-attachments';
import { createHttpAttachmentApi } from './lib/quickbooks-attachments-http';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};

// A plausible PDF: starts "%PDF-", longer than the 500-byte sanity floor.
const PDF = new Uint8Array(2048).map((_, i) => (i < 5 ? '%PDF-'.charCodeAt(i) : i % 251));

const ours = (Id: string): QbAttachable => ({ Id, SyncToken: '0', FileName: 'INV02611137-X-S$1.pdf', Note: INVOICE_COPY_NOTE });
const byHand = (Id: string): QbAttachable => ({ Id, SyncToken: '3', FileName: 'Invoice 02611138.pdf', Note: null });

function fakeApi(existing: QbAttachable[], opts: { failList?: boolean; failPdf?: boolean; badPdf?: boolean; failUpload?: boolean; failRemoveIds?: string[] } = {}) {
  const calls: string[] = [];
  const api: QbAttachmentApi = {
    async listForInvoice(id) { calls.push(`list:${id}`); if (opts.failList) throw new Error('HTTP 500'); return existing; },
    async pdf() { calls.push('pdf'); if (opts.failPdf) throw new Error('QuickBooks PDF request failed'); return opts.badPdf ? new Uint8Array([1, 2, 3]) : PDF; },
    async upload(a) { calls.push(`upload:${a.fileName}|${a.note}`); if (opts.failUpload) throw new Error('Fault: ValidationFault'); return { id: 'NEW1' }; },
    async remove(a) { calls.push(`remove:${a.Id}@${a.SyncToken}`); if (opts.failRemoveIds?.includes(a.Id)) throw new Error('HTTP 400'); },
  };
  return { api, calls };
}
const run = (existing: QbAttachable[], mode: 'create' | 'refresh', opts?: Parameters<typeof fakeApi>[1]) => {
  const f = fakeApi(existing, opts);
  return placeInvoiceCopy(f.api, { invoiceId: '25898', fileName: 'INV02611099-Acme Pte. Ltd.-S$700.pdf', mode }).then(result => ({ result, calls: f.calls }));
};

(async () => {
  console.log('--- creating: attach once, never twice, never next to a hand-attached file ---');
  let r = await run([], 'create');
  check('a new invoice gets its copy', r.result.status === 'attached' && r.result.replaced === 0 && r.calls.join(' ') === `list:25898 pdf upload:INV02611099-Acme Pte. Ltd.-S$700.pdf|${INVOICE_COPY_NOTE}`, r.calls.join(' '));
  r = await run([ours('1')], 'create');
  check('already has the system copy: nothing is uploaded (a retry or replay is harmless)', r.result.status === 'skipped' && r.calls.join(' ') === 'list:25898');
  r = await run([byHand('2')], 'create');
  check('a file attached by hand is respected: no second copy', r.result.status === 'skipped' && /by hand/.test((r.result as { reason: string }).reason) && !r.calls.some(c => c.startsWith('upload')));

  console.log('\n--- editing: replace only the system\'s own copy ---');
  r = await run([ours('10'), byHand('11'), ours('12')], 'refresh');
  check('the new copy goes in, then BOTH system copies are removed, the hand-attached file never', r.result.status === 'attached' && r.result.replaced === 2 && r.calls.filter(c => c.startsWith('remove')).join(' ') === 'remove:10@0 remove:12@0' && !r.calls.some(c => c.includes('remove:11')), r.calls.join(' '));
  const uploadAt = r.calls.findIndex(c => c.startsWith('upload'));
  const firstRemoveAt = r.calls.findIndex(c => c.startsWith('remove'));
  check('upload comes BEFORE any removal (the invoice is never left without a copy)', uploadAt > -1 && firstRemoveAt > uploadAt, r.calls.join(' '));
  r = await run([byHand('2')], 'refresh');
  check('edited invoice with only a hand-attached file: left alone', r.result.status === 'skipped' && !r.calls.some(c => c.startsWith('upload') || c.startsWith('remove')));
  r = await run([], 'refresh');
  check('edited invoice with no copy at all (create had failed): a copy is attached', r.result.status === 'attached');

  console.log('\n--- failures are reported, never thrown, and never lose the old copy ---');
  r = await run([ours('1')], 'refresh', { failUpload: true });
  check('a failed upload keeps the old copy (nothing removed)', r.result.status === 'failed' && !r.calls.some(c => c.startsWith('remove')) && /upload/.test((r.result as { error: string }).error));
  r = await run([ours('1'), ours('2')], 'refresh', { failRemoveIds: ['1'] });
  check('an old copy that cannot be removed: attached, with a warning, the other still removed', r.result.status === 'attached' && /previous copy could not be removed/.test((r.result as { warning?: string }).warning ?? '') && r.calls.includes('remove:2@0'), JSON.stringify(r.result));
  r = await run([], 'create', { failList: true });
  check('cannot list: failed, nothing fetched or uploaded', r.result.status === 'failed' && r.calls.join(' ') === 'list:25898');
  r = await run([], 'create', { failPdf: true });
  check('cannot get the PDF: failed, nothing uploaded', r.result.status === 'failed' && !r.calls.some(c => c.startsWith('upload')));
  r = await run([], 'create', { badPdf: true });
  check('not a PDF: refused, nothing uploaded', r.result.status === 'failed' && /not return a PDF/.test((r.result as { error: string }).error) && !r.calls.some(c => c.startsWith('upload')));
  r = await run([{ Id: '9', Note: INVOICE_COPY_NOTE }], 'refresh');
  check('an old copy without a SyncToken is reported, not guessed at', r.result.status === 'attached' && /no SyncToken/.test((r.result as { warning?: string }).warning ?? ''));
  check('looksLikePdf: needs the %PDF- header and a real length', looksLikePdf(PDF) && !looksLikePdf(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])) && !looksLikePdf(new Uint8Array(900)));

  console.log('\n--- the upload request QuickBooks receives ---');
  const meta = (name: string) => buildUploadRequest({ invoiceId: '25898', fileName: name, note: INVOICE_COPY_NOTE, pdf: PDF, boundary: 'BOUND' });
  const req = meta('INV02611099-Acme Pte. Ltd.-S$700.pdf');
  const text = Buffer.from(req.body).toString('latin1');
  check('content type names the boundary', req.contentType === 'multipart/form-data; boundary=BOUND');
  check('the body opens with the metadata part and closes with the end boundary', text.startsWith('--BOUND\r\nContent-Disposition: form-data; name="file_metadata_01"\r\nContent-Type: application/json') && text.endsWith('\r\n--BOUND--\r\n'));
  const json = JSON.parse(text.slice(text.indexOf('{'), text.indexOf('}}') + 2 > 0 ? text.indexOf('\r\n--BOUND\r\n', text.indexOf('{')) : undefined));
  check('metadata links the file to THE invoice, as a PDF, not for QuickBooks to email', json.AttachableRef?.[0]?.EntityRef?.type === 'Invoice' && json.AttachableRef[0].EntityRef.value === '25898' && json.AttachableRef[0].IncludeOnSend === false && json.ContentType === 'application/pdf', JSON.stringify(json));
  check('metadata carries the file name and the system\'s marker note', json.FileName === 'INV02611099-Acme Pte. Ltd.-S$700.pdf' && json.Note === INVOICE_COPY_NOTE);
  const headEnd = text.indexOf('name="file_content_01"');
  check('the file part is named file_content_01 with a PDF content type', headEnd > 0 && /name="file_content_01"; filename="INV02611099-Acme Pte\. Ltd\.-S\$700\.pdf"\r\nContent-Type: application\/pdf\r\n/.test(text.slice(headEnd - 40, headEnd + 200)));
  const marker = 'Content-Transfer-Encoding: binary\r\n\r\n';
  const start = text.indexOf(marker, headEnd) + marker.length;
  const sent = req.body.slice(start, start + PDF.length);
  check('the PDF bytes arrive untouched', sent.length === PDF.length && sent.every((b, i) => b === PDF[i]));
  const nasty = new Uint8Array(900).map((_, i) => [0x25, 0x50, 0x44, 0x46, 0x2d, 0x0d, 0x0a, 0x2d, 0x2d, 0x00, 0xff][i % 11]);
  const rn = buildUploadRequest({ invoiceId: '1', fileName: 'x.pdf', note: 'n', pdf: nasty, boundary: 'BOUND' });
  const rnText = Buffer.from(rn.body).toString('latin1');
  const rnStart = rnText.indexOf(marker) + marker.length;
  check('binary content with CR/LF, dashes, NUL and 0xFF survives', rn.body.slice(rnStart, rnStart + nasty.length).every((b, i) => b === nasty[i]));
  const cn = meta('INV02611099-思店科技(杭州)有限公司-S$1060.pdf');
  const cnText = Buffer.from(cn.body).toString('latin1');
  const cnHeaders = cnText.slice(cnText.indexOf('name="file_content_01"'), cnText.indexOf(marker));
  check('a Chinese name: the multipart header stays ASCII, the real name travels in the UTF-8 metadata', /^[\x20-\x7e\r\n]+$/.test(cnHeaders) && Buffer.from(cn.body).toString('utf8').includes('"FileName":"INV02611099-思店科技(杭州)有限公司-S$1060.pdf"'), cnHeaders);
  check('asciiFileName keeps ordinary names and never returns an empty one', asciiFileName('INV1-X-S$5.pdf') === 'INV1-X-S$5.pdf' && asciiFileName('思店') === '_' && asciiFileName('a"b') === "a'b");
  const unique = new Set([buildUploadRequest({ invoiceId: '1', fileName: 'x.pdf', note: 'n', pdf: PDF }).contentType, buildUploadRequest({ invoiceId: '1', fileName: 'x.pdf', note: 'n', pdf: PDF }).contentType]);
  check('each request gets its own boundary', unique.size === 2);

  console.log('\n--- reading QuickBooks\' answer ---');
  check('an attachment id means success', JSON.stringify(readUploadResponse({ AttachableResponse: [{ Attachable: { Id: '1000001461', FileName: 'x.pdf' } }], time: 'now' })) === '{"id":"1000001461"}');
  check('a numeric id is accepted', JSON.stringify(readUploadResponse({ AttachableResponse: [{ Attachable: { Id: 77 } }] })) === '{"id":"77"}');
  const faulted = readUploadResponse({ AttachableResponse: [{ Fault: { Error: [{ Message: 'Invalid reference', Detail: 'Invoice 999 not found' }] } }] });
  check('an HTTP-200 Fault is a failure with its message', 'error' in faulted && /Invalid reference: Invoice 999 not found/.test(faulted.error));
  check('a root-level Fault is a failure too', 'error' in readUploadResponse({ Fault: { Error: [{ Message: 'Authentication failed' }] } }));
  check('an answer with nothing in it is a failure, not a success', 'error' in readUploadResponse({}) && 'error' in readUploadResponse(null) && 'error' in readUploadResponse({ AttachableResponse: [] }));

  console.log('\n--- the HTTP side against a fake fetch ---');
  const seen: { url: string; init?: RequestInit }[] = [];
  const fakeFetch = (responder: (url: string, init?: RequestInit) => { status?: number; body: unknown }) => (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, init });
    const { status = 200, body } = responder(url, init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as typeof fetch;
  const http = (responder: Parameters<typeof fakeFetch>[0]) => createHttpAttachmentApi({ base: 'https://qb.test', realmId: '123', accessToken: 'SECRET-TOKEN', fetchPdf: async () => PDF, fetchImpl: fakeFetch(responder) });

  let api = http(() => ({ body: { QueryResponse: { Attachable: [{ Id: '5', SyncToken: '1', FileName: 'a.pdf', Note: INVOICE_COPY_NOTE }, { Id: 6, FileName: 'b.pdf' }] } } }));
  const listed = await api.listForInvoice('25898');
  const listUrl = decodeURIComponent(seen[0].url);
  check('list: asks for the attachables of THIS invoice only', /^https:\/\/qb\.test\/v3\/company\/123\/query\?query=SELECT \* FROM Attachable WHERE AttachableRef\.EntityRef\.Type = 'Invoice' AND AttachableRef\.EntityRef\.value = '25898'&minorversion=75$/.test(listUrl), listUrl);
  check('list: sends the token as a Bearer header', (seen[0].init?.headers as Record<string, string>).Authorization === 'Bearer SECRET-TOKEN');
  check('list: ids and tokens come back as strings, notes preserved', listed.length === 2 && listed[0].Id === '5' && listed[0].SyncToken === '1' && listed[0].Note === INVOICE_COPY_NOTE && listed[1].Id === '6' && listed[1].Note === null);
  api = http(() => ({ body: {} }));
  check('list: an invoice with no attachments is an empty list', (await api.listForInvoice('1')).length === 0);
  let threw = '';
  try { await api.listForInvoice("1' OR '1'='1"); } catch (e) { threw = (e as Error).message; }
  check('list: a non-numeric id is refused before any request (no query injection)', /not a QuickBooks id/.test(threw));
  api = http(() => ({ status: 401, body: 'unauthorized' }));
  threw = '';
  try { await api.listForInvoice('1'); } catch (e) { threw = (e as Error).message; }
  check('list: an HTTP error is thrown with its status', /HTTP 401/.test(threw));

  seen.length = 0;
  api = http(() => ({ body: { AttachableResponse: [{ Attachable: { Id: '900' } }] } }));
  const up = await api.upload({ invoiceId: '25898', fileName: 'x.pdf', note: INVOICE_COPY_NOTE, pdf: PDF });
  const upReq = seen[0];
  check('upload: POSTs to /upload as multipart and returns the new id', up.id === '900' && upReq.url === 'https://qb.test/v3/company/123/upload?minorversion=75' && upReq.init?.method === 'POST' && /^multipart\/form-data; boundary=/.test((upReq.init?.headers as Record<string, string>)['Content-Type']));
  check('upload: the body is the multipart request, as bytes', upReq.init?.body instanceof Uint8Array && Buffer.from(upReq.init.body as Uint8Array).toString('latin1').includes('name="file_metadata_01"'));
  api = http(() => ({ body: { AttachableResponse: [{ Fault: { Error: [{ Message: 'Business Validation Error' }] } }] } }));
  threw = '';
  try { await api.upload({ invoiceId: '1', fileName: 'x.pdf', note: 'n', pdf: PDF }); } catch (e) { threw = (e as Error).message; }
  check('upload: an HTTP-200 Fault becomes an error (QuickBooks says no with a 200)', /Business Validation Error/.test(threw));
  api = http(() => ({ body: 'plain text, not json' }));
  threw = '';
  try { await api.upload({ invoiceId: '1', fileName: 'x.pdf', note: 'n', pdf: PDF }); } catch (e) { threw = (e as Error).message; }
  check('upload: a non-JSON answer is an error', /not JSON/.test(threw));

  seen.length = 0;
  api = http(() => ({ body: { Attachable: { status: 'Deleted', Id: '5' } } }));
  await api.remove({ Id: '5', SyncToken: '1' });
  check('remove: POSTs the id and SyncToken to the attachable delete operation', seen[0].url === 'https://qb.test/v3/company/123/attachable?operation=delete&minorversion=75' && seen[0].init?.body === '{"Id":"5","SyncToken":"1"}');
  api = http(() => ({ body: { Fault: { Error: [{ Message: 'Stale Object Error' }] } } }));
  threw = '';
  try { await api.remove({ Id: '5', SyncToken: '0' }); } catch (e) { threw = (e as Error).message; }
  check('remove: a Fault is an error', /Stale Object/.test(threw));
  check('the token is never part of a URL or a body', seen.every(s => !s.url.includes('SECRET-TOKEN') && !String(s.init?.body ?? '').includes('SECRET-TOKEN')));

  console.log('\n--- the routes use it ---');
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
  const wiring = read('lib/quickbooks-invoice-copy.ts');
  check('all three books are switched on', /INVOICE_COPY_ATTACHMENT_MODE[^=]*= \{ TAB: 'live', TAC: 'live', TAO: 'live' \}/.test(wiring));
  check('the file is named the way "Save PDF" names it', /invoicePdfFileName\(company, docNumber, customerName,/.test(wiring));
  check('create-invoice attaches in create mode', /attachInvoiceCopyToQuickBooks\(\{[\s\S]*?mode: 'create'/.test(read('app/api/quickbooks/create-invoice/route.ts')));
  check('update-invoice attaches in refresh mode', /attachInvoiceCopyToQuickBooks\(\{[\s\S]*?mode: 'refresh'/.test(read('app/api/quickbooks/update-invoice/route.ts')));
  check('QuickBooks\' own PDF is the copy (not the redrawn client version)', /fetchQuickBooksInvoicePdf\(company, invoiceId\)/.test(wiring) && !/getClientInvoicePdf/.test(wiring));

  console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
