// Staff upload the original invoice they found (Invoice Originals page, INV-QB-037):
// lib/original-upload.ts — what is attached, what is refused and why, what is never
// touched. Every branch runs against fakes of QuickBooks (the invoice, its attachment
// list, the downloads, the PDF reader and the upload), so nothing here reaches
// QuickBooks, the database or a real PDF. The proof itself (which file IS the
// original) is test-original-copy.ts; the page and routes are test-original-status.ts.
//
// Run: npx tsx test-original-upload.ts
import { INVOICE_COPY_NOTE } from './lib/quickbooks-attachments';
import { MAX_ORIGINAL_BYTES, formatMoney, sha256Hex, type AttachmentFile, type ConfirmedOriginal, type InvoiceFacts, type PdfFacts } from './lib/original-copy';
import { httpStatusFor, originalFileName, originalUploadNote, placeUploadedOriginal, type OriginalUploadDeps, type UploadResult } from './lib/original-upload';

let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};

// What a real QuickBooks (Aspose) invoice page says, in the order pdf.js reads it.
const page = (o: { no?: string; lines: [string, number][]; total: number; letterhead?: boolean }) => [
  'Accounting Auditing Company Setup Licensing Application Secretary Taxation High Net Worth',
  'TASSURE ASIA BIZSERVICES PTE. LTD.',
  ...(o.letterhead === false ? [] : ['Registration No.: 201325157G']),
  'INVOICE',
  `INVOICE NO. : ${o.no ?? 'TAB 02611112'}`,
  'TERMS : Net 7',
  'DATE : 01/10/2026',
  'BILL TO:',
  '1X Exchange Pte. Ltd.',
  'DUE DATE : 08/10/2026',
  'DESCRIPTION AMOUNT (S$)',
  ...o.lines.map(([d, a]) => `${d} ${formatMoney(a)}`),
  'Payment is due seven (7) days from the invoice date.',
  `TOTAL ${formatMoney(o.total)}`,
  'PAYMENT DETAILS: Account Name : TASSURE ASIA BIZSERVICES PTE. LTD.',
].join('\n');
const facts = (text: string, over: Partial<PdfFacts> = {}): PdfFacts => ({ text, pages: [text], totalPages: 1, producer: 'Aspose.Words for Java 20.11.0', ...over });

const L1 = (n: number, d = false) => ({ amount: n, deferred: d });
const FACTS: InvoiceFacts = { invoiceNo: 'TAB 02611112', date: '01/10/2026', customer: '1X Exchange Pte. Ltd.', total: 1360, lines: [L1(175), L1(525, true), L1(60), L1(600)], preferred: [700, 60, 600] };
const LINES: [string, number][] = [['Corporate Secretarial Services', 700], ['Government fee for filing Annual Return [FYE 31.12.2026]', 60], ['XBRL for the year (FYE 31.12.2026)', 600]];
const ORIGINAL = page({ lines: LINES, total: 1360 });
const SPLIT = page({ lines: [['Corporate Secretarial Services', 175], ['Deferred Revenue - Corp Sec', 525], ['Government fee for filing Annual Return [FYE 31.12.2026]', 60], ['XBRL for the year (FYE 31.12.2026)', 600]], total: 1360 });

// A file whose text the fake reader knows by its tag.
const TEXTS = new Map<string, PdfFacts>();
const fakePdf = (tag: string, text: PdfFacts | null): Uint8Array => {
  const bytes = new Uint8Array(new ArrayBuffer(700)).fill(32);
  bytes.set(new TextEncoder().encode(`%PDF-1.7\n${tag}`), 0);
  if (text) TEXTS.set(tag, text);
  return bytes;
};
const tagOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes.slice(9, 9 + 8)).trim();

type Opts = {
  invoice?: { facts: InvoiceFacts | null } | null | 'throws';
  files?: AttachmentFile[];
  listFails?: boolean;
  uploadFails?: boolean;
  // the new file never shows up in the list (QuickBooks slow)
  invisible?: boolean;
  // a second accepted file appears next to the upload (two people at once)
  rival?: boolean;
};
function world(opts: Opts = {}) {
  const calls = { loadInvoice: 0, list: 0, download: 0, read: 0, upload: 0 };
  const files: AttachmentFile[] = [...(opts.files ?? [])];
  const bodies = new Map<string, Uint8Array>();
  const uploads: { fileName: string; note: string; pdf: Uint8Array }[] = [];
  let nextId = 900;
  const deps: OriginalUploadDeps = {
    loadInvoice: async () => {
      calls.loadInvoice++;
      if (opts.invoice === 'throws') throw new Error('HTTP 500');
      return opts.invoice === undefined ? { facts: FACTS } : opts.invoice;
    },
    list: async () => { calls.list++; if (opts.listFails) throw new Error('HTTP 503'); return [...files]; },
    download: async f => { calls.download++; const b = bodies.get(f.Id); if (!b) throw new Error('no body'); return b; },
    read: async bytes => {
      calls.read++;
      const text = TEXTS.get(tagOf(bytes));
      if (!text) throw new Error('Input document to `PDFDocument.load` is encrypted.');
      return text;
    },
    upload: async args => {
      calls.upload++;
      if (opts.uploadFails) throw new Error('HTTP 400 file refused');
      uploads.push(args);
      const id = String(nextId++);
      bodies.set(id, args.pdf);
      if (!opts.invisible) files.push({ Id: id, FileName: args.fileName, ContentType: 'application/pdf', Size: args.pdf.length, Note: args.note, CreateTime: '2026-10-07T01:02:03Z', TempDownloadUri: `https://files.test/${id}` });
      if (opts.rival) {
        const rivalId = String(nextId++);
        const rivalPdf = fakePdf('RIVAL', facts(ORIGINAL));
        bodies.set(rivalId, rivalPdf);
        files.push({ Id: rivalId, FileName: 'rival.pdf', ContentType: 'application/pdf', Size: rivalPdf.length, Note: INVOICE_COPY_NOTE, CreateTime: '2026-10-07T01:02:04Z', TempDownloadUri: `https://files.test/${rivalId}` });
      }
      return { id };
    },
    now: () => new Date('2026-10-07T01:02:03Z'),
  };
  // an attached file with a known body
  const attach = (id: string, pdf: Uint8Array, extra: Partial<AttachmentFile> = {}) => {
    bodies.set(id, pdf);
    files.push({ Id: id, FileName: `${id}.pdf`, ContentType: 'application/pdf', Size: pdf.length, Note: null, CreateTime: '2026-10-01T00:00:00Z', TempDownloadUri: `https://files.test/${id}`, ...extra });
  };
  return { deps, calls, files, uploads, attach };
}
const BY = { name: 'Chelsea Tan', email: 'chelsea@tassure.example' };
const run = (w: ReturnType<typeof world>, bytes: Uint8Array): Promise<UploadResult> => placeUploadedOriginal(w.deps, { bytes, by: BY });
const refusedWith = (r: UploadResult, re: RegExp) => r.status === 'refused' && re.test(r.reason);

(async () => {
  console.log('--- a file that is not even a PDF, or too big: refused before QuickBooks is asked ---');
  {
    const w = world();
    const big = new Uint8Array(new ArrayBuffer(MAX_ORIGINAL_BYTES + 1)); big.set(new TextEncoder().encode('%PDF-1.7'), 0);
    const r1 = await run(w, big);
    check('over 1 MB: refused with the reason and a hint', refusedWith(r1, /larger than 1 MB/) && r1.status === 'refused' && /well under 1 MB/.test(r1.hint ?? ''));
    const r2 = await run(w, new Uint8Array(new ArrayBuffer(900)).fill(65));
    check('not a PDF (no %PDF- header): refused', refusedWith(r2, /not a PDF/));
    const r3 = await run(w, new TextEncoder().encode('%PDF-1.4 tiny'));
    check('a few bytes with a PDF header: refused', r3.status === 'refused');
    check('none of them touched QuickBooks', w.calls.loadInvoice === 0 && w.calls.list === 0 && w.calls.upload === 0);
  }

  console.log('\n--- the invoice cannot be judged ---');
  {
    const w1 = world({ invoice: 'throws' });
    const a = await run(w1, fakePdf('GOOD01', facts(ORIGINAL)));
    check('QuickBooks fails reading the invoice: failed, nothing attached', a.status === 'failed' && /could not read the invoice from QuickBooks \(HTTP 500\)/.test(a.error) && w1.calls.upload === 0 && w1.calls.list === 0);
    const w2 = world({ invoice: null });
    const b = await run(w2, fakePdf('GOOD01', facts(ORIGINAL)));
    check('the invoice is not found: failed, nothing attached', b.status === 'failed' && /could not be found/.test(b.error) && w2.calls.upload === 0);
    const w3 = world({ invoice: { facts: null } });
    const c = await run(w3, fakePdf('GOOD01', facts(ORIGINAL)));
    check('no Deferred Revenue line any more: "not-split", nothing attached (QuickBooks\' own PDF is right)', c.status === 'not-split' && w3.calls.upload === 0 && w3.calls.list === 0);
    const w4 = world({ listFails: true });
    const d = await run(w4, fakePdf('GOOD01', facts(ORIGINAL)));
    check('the attachment list cannot be read: failed, nothing attached', d.status === 'failed' && /attachments/.test(d.error) && w4.calls.upload === 0);
  }

  console.log('\n--- an invoice that already has its original ---');
  {
    const w = world();
    w.attach('700', fakePdf('HAVE01', facts(ORIGINAL)), { FileName: 'TAB 02611112 original.pdf' });
    const r = await run(w, fakePdf('GOOD01', facts(ORIGINAL)));
    check('"already": nothing attached, the file in use is named', r.status === 'already' && r.fileName === 'TAB 02611112 original.pdf' && w.calls.upload === 0);
    check('…and it answers 200 (not an error: the work is done)', httpStatusFor(r) === 200);
    const w2 = world();
    w2.attach('701', fakePdf('SYS001', facts(ORIGINAL)), { Note: INVOICE_COPY_NOTE });
    const r2 = await run(w2, fakePdf('GOOD01', facts(ORIGINAL)));
    check('the system\'s own copy, when it is the original, counts the same', r2.status === 'already' && w2.calls.upload === 0);
    const w3 = world();
    w3.attach('702', fakePdf('SPLT01', facts(SPLIT)));
    const r3 = await run(w3, fakePdf('GOOD01', facts(ORIGINAL)));
    check('a split-version PDF already attached is not an original: the upload goes ahead', r3.status === 'attached' && w3.calls.upload === 1);
  }

  console.log('\n--- a wrong file is refused, with why, and attaches nothing ---');
  {
    const cases: [string, Uint8Array, RegExp, RegExp][] = [
      ['another invoice\'s PDF (wrong number)', fakePdf('OTHER1', facts(page({ no: 'TAB 02611999', lines: LINES, total: 1360 }))), /INVOICE NO/, /not the PDF of this invoice/],
      ['the split version (what QuickBooks prints now)', fakePdf('SPLT02', facts(SPLIT)), /amounts are not/, /split version/],
      ['the system\'s own drawing (Save PDF)', fakePdf('SAVEPD', facts(ORIGINAL, { producer: 'Tassure' })), /system's own drawing/, /Save PDF/],
      ['the Save PDF drawing saved again by another program (no letterhead as text)', fakePdf('RESAVE', facts(page({ lines: LINES, total: 1360, letterhead: false }), { producer: 'Microsoft: Print To PDF' })), /company letterhead/, /not printed by QuickBooks/],
      ['a scan or picture (no text on the page)', fakePdf('SCAN01', facts('', { pages: [''], totalPages: 1 })), /no text|has no text/, /not a scan/],
      ['a PDF the reader cannot open (password / damaged)', fakePdf('LOCKED', null), /could not be read/, /without a password/],
    ];
    for (const [label, bytes, why, hint] of cases) {
      const w = world();
      const r = await run(w, bytes);
      check(`${label}: refused (${r.status === 'refused' ? r.reason.slice(0, 60) : r.status}…)`, refusedWith(r, why) && r.status === 'refused' && hint.test(r.hint ?? '') && w.calls.upload === 0 && httpStatusFor(r) === 422, JSON.stringify(r));
    }
    const w = world();
    const pagesMissing = await run(w, fakePdf('PAGES1', facts(ORIGINAL, { totalPages: 3, pages: [ORIGINAL] })));
    check('several invoices in one file (pages that could not all be read): refused', pagesMissing.status === 'refused' && w.calls.upload === 0);
  }

  console.log('\n--- a right file is attached, once, and confirmed the way the SOA reads it ---');
  {
    const w = world();
    w.attach('710', fakePdf('JUNK01', facts(SPLIT)));
    w.attach('711', fakePdf('JUNK02', facts(page({ no: 'TAB 02611000', lines: LINES, total: 1360 }))));
    const bytes = fakePdf('GOOD02', facts(ORIGINAL));
    const r = await run(w, bytes);
    check('attached, and the look-up now picks exactly this file', r.status === 'attached' && r.attachableId === '900' && w.calls.upload === 1, JSON.stringify(r));
    check('…even with other, wrong files already on the invoice (they were opened and refused first)', r.status === 'attached' && w.calls.download >= 3, `downloads ${w.calls.download}`);
    const up = w.uploads[0];
    check('the file in QuickBooks is the very bytes uploaded', up.pdf === bytes && await sha256Hex(up.pdf) === await sha256Hex(bytes));
    check('its name is built here, from the invoice, never from the person\'s file', up.fileName === 'TAB 02611112 - 1X Exchange Pte. Ltd. - original.pdf' && r.status === 'attached' && r.fileName === up.fileName);
    check('its note says who, when and the sha256 — and is never the system\'s own copy note', up.note === originalUploadNote(BY, new Date('2026-10-07T01:02:03Z'), await sha256Hex(bytes)) && up.note.includes('Chelsea Tan') && up.note.includes('chelsea@tassure.example') && up.note.includes('2026-10-07') && up.note.includes(await sha256Hex(bytes)) && up.note !== INVOICE_COPY_NOTE);
    check('a second upload of the same file is "already" (a double click attaches nothing twice)', (await run(w, fakePdf('GOOD02', facts(ORIGINAL)))).status === 'already' && w.calls.upload === 1);
    check('…and "attached" answers 200', httpStatusFor(r) === 200);
  }
  {
    const w = world();
    const r = await run(w, fakePdf('GOOD03', facts(ORIGINAL)));
    check('an invoice with nothing attached: attached', r.status === 'attached' && w.files.length === 1);
    const w2 = world();
    w2.attach('720', fakePdf('PNG001', null), { ContentType: 'image/png', FileName: 'scan.png' });
    const r2 = await run(w2, fakePdf('GOOD03', facts(ORIGINAL)));
    check('a picture attached before does not stand in the way', r2.status === 'attached');
  }

  console.log('\n--- the exact file a decision of Vincent\'s names (lib/original-decisions.ts) ---');
  {
    // The client got one 760 line; QuickBooks now holds 700 + 60: the proof refuses it (stage "amounts"), a decision can cover it.
    const REGROUPED = page({ lines: [['Corporate Secretarial Services and the government fee', 760], ['XBRL for the year (FYE 31.12.2026)', 600]], total: 1360 });
    const regrouped = fakePdf('REGRP1', facts(REGROUPED));
    const entry: ConfirmedOriginal = { invoiceNo: FACTS.invoiceNo, date: FACTS.date, total: FACTS.total, customer: FACTS.customer, sha256: await sha256Hex(regrouped), fileName: 'x.pdf', decidedBy: 'Vincent', decidedOn: '2026-10-07', why: 'only the appearance differs' };
    const w0 = world();
    const r0 = await run(w0, regrouped);
    check('without a decision the upload refuses the regrouped original (the proof stands)', refusedWith(r0, /amounts are not/) && w0.calls.upload === 0);
    const w1 = world();
    w1.deps.confirmed = [entry];
    const r1 = await run(w1, regrouped);
    check('the EXACT file a decision names can be put back: attached, and the look-up that honours the decision picks it', r1.status === 'attached' && w1.calls.upload === 1, JSON.stringify(r1));
    check('…and its note says it is the decided file, not that the proof checked it', w1.uploads[0].note.includes('Vincent decided on 2026-10-07') && !w1.uploads[0].note.includes('the system checked it') && w1.uploads[0].note.includes(await sha256Hex(regrouped)));
    const w2 = world();
    w2.deps.confirmed = [entry];
    const r2 = await run(w2, fakePdf('REGRP2', facts(REGROUPED + '\n(a different copy)')));
    check('any other file with the same defect is still refused', refusedWith(r2, /amounts are not/) && w2.calls.upload === 0);
    const w3 = world();
    w3.deps.confirmed = [entry];
    w3.attach('700', regrouped);
    const r3 = await run(w3, fakePdf('GOOD07', facts(ORIGINAL)));
    check('an invoice whose decided original is already attached is "already" — the decision counts there too', r3.status === 'already' && w3.calls.upload === 0, JSON.stringify(r3));
    const w3b = world();
    w3b.attach('700', regrouped);
    const r3b = await run(w3b, fakePdf('GOOD07', facts(ORIGINAL)));
    check('…and without the decision that attached file is no original: the upload goes ahead', r3b.status === 'attached' && w3b.calls.upload === 1);
    const split = fakePdf('SPLT09', facts(SPLIT));
    const w5 = world();
    w5.deps.confirmed = [{ ...entry, sha256: await sha256Hex(split) }];
    check('the split version is never covered, even if a decision named it', refusedWith(await run(w5, split), /amounts are not/) && w5.calls.upload === 0);
    const w6 = world({ invoice: { facts: { ...FACTS, customer: '1X Exchange' } } });
    w6.deps.confirmed = [entry];
    check('once the invoice changed (customer renamed) the decision no longer covers the file', (await run(w6, regrouped)).status === 'refused' && w6.calls.upload === 0);
  }

  console.log('\n--- when QuickBooks does not cooperate ---');
  {
    const w = world({ uploadFails: true });
    const r = await run(w, fakePdf('GOOD04', facts(ORIGINAL)));
    check('the upload is refused by QuickBooks: failed with its message, nothing else done', r.status === 'failed' && /upload to QuickBooks failed \(HTTP 400 file refused\)/.test(r.error) && httpStatusFor(r) === 502);
    const w2 = world({ invisible: true });
    const r2 = await run(w2, fakePdf('GOOD04', facts(ORIGINAL)));
    check('uploaded but not yet listed: "unconfirmed" (not an error, not rolled back — nothing is ever removed)', r2.status === 'unconfirmed' && r2.attachableId === '900' && w2.calls.upload === 1 && httpStatusFor(r2) === 200, JSON.stringify(r2));
    const w3 = world({ rival: true });
    const r3 = await run(w3, fakePdf('GOOD04', facts(ORIGINAL)));
    check('two people at once: the invoice has its original either way — "already", naming the file in use', r3.status === 'already' && r3.fileName === 'rival.pdf', JSON.stringify(r3));
  }

  console.log('\n--- the answers, as the route sends them ---');
  const code = (r: UploadResult) => httpStatusFor(r);
  check('attached / already / unconfirmed 200, refused 422, not-split 409, failed 502', code({ status: 'attached', attachableId: '1', fileName: 'x' }) === 200 && code({ status: 'already', fileName: 'x' }) === 200 && code({ status: 'unconfirmed', attachableId: '1', reason: 'r' }) === 200 && code({ status: 'refused', reason: 'r', hint: null }) === 422 && code({ status: 'not-split' }) === 409 && code({ status: 'failed', error: 'e' }) === 502);
  check('a file name never carries characters a file system or header dislikes', originalFileName('TAB 026\\1/1:2*', 'A "B" <C>|D\u0007 Pte. Ltd.') === 'TAB 026 1 1 2 - A B C D Pte. Ltd. - original.pdf', originalFileName('TAB 026\\1/1:2*', 'A "B" <C>|D\u0007 Pte. Ltd.'));
  check('a very long customer name is cut', originalFileName('TAB 1', 'X'.repeat(300)).length < 120);

  console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
  process.exit(fail === 0 ? 0 : 1);
})();
