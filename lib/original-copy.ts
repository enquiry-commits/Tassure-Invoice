// Is a PDF attached to an invoice in QuickBooks really the ORIGINAL (unsplit)
// invoice the client was sent?
//
// Why this exists (Vincent, 2026-10-06): accounting splits an invoice's lines
// AFTER it has gone to the client (INV-QB-029), so QuickBooks only prints the
// split version — and the system redraws it for the SOA / emails (~27% of
// open invoices). The copy attached to the invoice in QuickBooks
// (INV-QB-036), or one staff attach by hand (from the file server when it
// cannot be found otherwise), is the real original. Vincent's order of
// preference: the original attached in QuickBooks, then the one fetched from
// the server and attached, and ONLY THEN the redraw — "准确度和失误率才是最优".
// So the question is one safe answer: is THIS file that original — not the
// split version, the system's own drawing, an older figure, another invoice or
// another client's? Whatever is not provably the original is never used.
//
// The proof (council review of the first version, 2026-10-06, found that the
// amounts alone were not enough — 7 wrong files got through):
//  1. what the file IS — not the system's own drawing (PDF producer
//     "Tassure": what Save PDF gives, which staff attach out of habit), every
//     page read (a page that was never read is still sent to the client),
//     and text on every page (a scan or picture is not checked at all);
//  2. whose it is — the page says "INVOICE NO. : <book> <number>", "DATE :
//     <the invoice date>", is billed to the customer, and has "TOTAL
//     <amount>";
//  3. what it prints — the money on the page, as a multiset, equals the
//     invoice's line amounts regrouped the way the original had them, plus
//     the total. The original prints a service once at its full amount
//     (700.00); the split version prints the parts (175.00, 525.00), so it can
//     never pass. A twin accounting labelled with the wrong service (TAB
//     #02611114's second "Deferred Revenue - Corp Sec" sits under Registered
//     Address: the original was 600 + 200, the label pairing gives 650 + 150)
//     is why EVERY way of folding each twin into one other line is accepted,
//     not only the label pairing.
// Checked on 20 real files saved from QuickBooks on 2026-10-06 (see
// test-original-copy.ts and docs/INVARIANTS.md INV-QB-037).
//
// Pure: no I/O. The caller supplies what the file says (lib/pdf-text.ts) and
// the attachments (lib/quickbooks-attachments-http.ts).

import { INVOICE_COPY_NOTE, looksLikePdf } from './quickbooks-attachments';
import { isDeferredItem } from './deferred-pairing';
import type { QbInvoiceJson } from './client-invoice-model';

export const formatMoney = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Money as QuickBooks prints it. A date such as 31.08.2026 is not an amount
// (its "31.08" is followed by another dot).
const MONEY_TOKEN = /(?<![\d.,])\d{1,3}(?:,\d{3})*\.\d{2}(?![\d.])/g;

export function printedAmounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of text.match(MONEY_TOKEN) ?? []) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

// What the invoice says in QuickBooks right now — what its original must match.
export type InvoiceFacts = {
  invoiceNo: string;   // as QuickBooks prints it after "INVOICE NO. :" — "TAB 02611112"
  date: string;        // dd/mm/yyyy, as printed after "DATE :"
  customer: string;    // the customer's name, printed under BILL TO
  total: number;
  lines: { amount: number; deferred: boolean }[];   // the item lines as they are in QuickBooks now
  // The merged line amounts the system's own label pairing gives (when it can
  // pair); always acceptable, even when the regrouping below is too large to list.
  preferred?: number[];
};

// What reading a PDF gives (lib/pdf-text.ts).
export type PdfFacts = {
  text: string;            // all the pages read, joined
  pages: string[];         // the text of each page read
  totalPages: number;      // pages in the file; more than pages.length means some were not read
  producer: string | null; // the PDF's Producer exactly as written ("Aspose.Words for Java …", "Tassure")
};

const cents = (n: number) => Math.round(n * 100);
const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const MIN_PAGE_CHARS = 20;       // the real second page (letterhead + "Paynow (QR)") has ~146
const MAX_REGROUPINGS = 20_000;

// The facts of an invoice that accounting has split; null when nothing is split
// (QuickBooks' own PDF is then the right one) or the invoice lacks what the
// proof needs.
export function invoiceFacts(invoice: QbInvoiceJson, book: string, preferred?: number[]): InvoiceFacts | null {
  const items = (invoice.Line ?? []).filter(l => l.DetailType === 'SalesItemLineDetail');
  const lines = items.map(l => ({ amount: Number(l.Amount ?? 0), deferred: isDeferredItem(l.SalesItemLineDetail?.ItemRef?.name) }));
  if (!lines.some(l => l.deferred)) return null;
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(invoice.TxnDate ?? '');
  const total = Number(invoice.TotalAmt);
  const customer = (invoice.CustomerRef?.name ?? '').trim();
  if (!invoice.DocNumber || !date || !customer || !Number.isFinite(total)) return null;
  return { invoiceNo: `${book} ${invoice.DocNumber}`, date: `${date[3]}/${date[2]}/${date[1]}`, customer, total, lines, preferred };
}

// Every set of line amounts the original could have printed: each deferred
// twin folded into exactly ONE of the other lines (so a twin under the wrong
// service is still found), never left on its own — the split version, which
// keeps them separate, is not on the list. `preferred` is always included.
export function acceptableLineSets(facts: Pick<InvoiceFacts, 'lines' | 'preferred'>): number[][] {
  const sets = new Map<string, number[]>();
  const add = (amounts: number[]) => {
    const key = amounts.map(a => Math.abs(cents(a))).sort((a, b) => a - b).join(',');
    if (!sets.has(key)) sets.set(key, amounts);
  };
  if (facts.preferred) add(facts.preferred);
  const base = facts.lines.filter(l => !l.deferred).map(l => cents(l.amount));
  const twins = facts.lines.filter(l => l.deferred).map(l => cents(l.amount));
  if (!twins.length) { add(base.map(c => c / 100)); return [...sets.values()]; }
  if (!base.length || base.length ** twins.length > MAX_REGROUPINGS) return [...sets.values()];
  const fold = (i: number, acc: number[]) => {
    if (i === twins.length) { add(acc.map(c => c / 100)); return; }
    for (let j = 0; j < acc.length; j++) { acc[j] += twins[i]; fold(i + 1, acc); acc[j] -= twins[i]; }
  };
  fold(0, [...base]);
  return [...sets.values()];
}

export type OriginalCheck = { ok: true } | { ok: false; reason: string };
const refuse = (reason: string): OriginalCheck => ({ ok: false, reason });

export function checkOriginalCopy(pdf: PdfFacts, facts: InvoiceFacts): OriginalCheck {
  // 1. What the file is.
  if (/tassure/i.test(pdf.producer ?? '')) return refuse("it is the system's own drawing (what Save PDF gives), not QuickBooks' invoice");
  if (pdf.totalPages > pdf.pages.length) return refuse(`it has ${pdf.totalPages} pages and only ${pdf.pages.length} could be read`);
  const blank = pdf.pages.findIndex(p => p.replace(/\s/g, '').length < MIN_PAGE_CHARS);
  if (blank >= 0) return refuse(`page ${blank + 1} has no text (a scan or a picture?)`);

  // 2. Whose it is.
  const text = pdf.text;
  const invoiceNo = new RegExp(`INVOICE\\s+NO\\.?\\s*:\\s*${facts.invoiceNo.trim().split(/\s+/).map(escapeRe).join('\\s+')}(?![\\w-])`, 'i');
  if (!invoiceNo.test(text)) return refuse(`it does not say "INVOICE NO. : ${facts.invoiceNo}"`);
  if (!facts.date || !new RegExp(`(?<!DUE\\s)DATE\\s*:\\s*${escapeRe(facts.date)}(?!\\d)`, 'i').test(text)) return refuse(`it is not dated ${facts.date}`);
  if (!facts.customer.trim() || !squash(text).includes(squash(facts.customer))) return refuse(`it is not billed to ${facts.customer}`);
  const total = formatMoney(Math.abs(facts.total));
  if (!new RegExp(`TOTAL\\s+${escapeRe(total)}(?![\\d])`, 'i').test(text)) return refuse(`it does not say "TOTAL ${total}"`);

  // 3. What it prints.
  const printed = printedAmounts(text);
  let closest: { missing: string[]; unexpected: string[] } | null = null;
  for (const lineSet of acceptableLineSets(facts)) {
    const expected = new Map<string, number>();
    for (const a of [...lineSet, facts.total]) {
      const key = formatMoney(Math.abs(a));
      expected.set(key, (expected.get(key) ?? 0) + 1);
    }
    const missing: string[] = [];
    const unexpected: string[] = [];
    for (const key of new Set([...expected.keys(), ...printed.keys()])) {
      const want = expected.get(key) ?? 0;
      const got = printed.get(key) ?? 0;
      if (got < want) missing.push(key);
      if (got > want) unexpected.push(key);
    }
    if (!missing.length && !unexpected.length) return { ok: true };
    if (!closest || missing.length + unexpected.length < closest.missing.length + closest.unexpected.length) closest = { missing, unexpected };
  }
  const c = closest ?? { missing: [], unexpected: [] };
  return refuse(`its amounts are not the unsplit invoice's (${c.missing.length ? `missing ${c.missing.join(', ')}` : ''}${c.missing.length && c.unexpected.length ? '; ' : ''}${c.unexpected.length ? `unexpected ${c.unexpected.join(', ')}` : ''})`);
}

export type AttachmentFile = {
  Id: string;
  FileName?: string;
  ContentType?: string;
  Size?: number;
  Note?: string | null;
  TempDownloadUri?: string;
  CreateTime?: string;
};

export type OriginalCopyDeps = {
  list(): Promise<AttachmentFile[]>;
  download(file: AttachmentFile): Promise<Uint8Array>;
  // Throws when the file cannot be read or cannot be merged the way the SOA merges it.
  read(bytes: Uint8Array): Promise<PdfFacts>;
};

// trouble: QuickBooks itself failed (not "nothing attached") — the caller
// stops asking for a while instead of waiting on it for every invoice.
export type OriginalCopyResult =
  | { found: { bytes: Uint8Array; fileName: string; attachableId: string; bySystem: boolean } }
  | { none: string; trouble?: boolean };

// A real invoice PDF is 80-260 KB; the SOA response is limited to 4.5 MB.
export const MAX_ORIGINAL_BYTES = 1024 * 1024;
const MAX_CANDIDATES = 4;

// The first attached PDF that is provably the original — the system's own
// copy first (made before any split, INV-QB-036), then files staff attached,
// newest first. Every failure of one candidate (download, parse, mismatch)
// just moves on to the next; nothing here throws. Reasons name the attachment
// by Id, never by file name (file names carry client names and end up in logs).
export async function selectVerifiedOriginal(deps: OriginalCopyDeps, facts: InvoiceFacts): Promise<OriginalCopyResult> {
  let files: AttachmentFile[];
  try {
    files = await deps.list();
  } catch (err) {
    return { none: `could not list the invoice's attachments (${err instanceof Error ? err.message : String(err)})`, trouble: true };
  }
  const pdfs = files
    .filter(f => (f.ContentType === 'application/pdf' || /\.pdf$/i.test(f.FileName ?? '')) && !!f.TempDownloadUri && (f.Size === undefined || f.Size <= MAX_ORIGINAL_BYTES))
    .sort((a, b) => Number(b.Note === INVOICE_COPY_NOTE) - Number(a.Note === INVOICE_COPY_NOTE) || String(b.CreateTime ?? '').localeCompare(String(a.CreateTime ?? '')))
    .slice(0, MAX_CANDIDATES);
  if (!pdfs.length) return { none: 'no PDF attached' };

  const why: string[] = [];
  for (const file of pdfs) {
    const label = `attachment #${file.Id}`;
    try {
      const bytes = await deps.download(file);
      if (!looksLikePdf(bytes)) { why.push(`${label}: not a PDF`); continue; }
      const check = checkOriginalCopy(await deps.read(bytes), facts);
      if (check.ok) return { found: { bytes, fileName: file.FileName ?? `${file.Id}.pdf`, attachableId: file.Id, bySystem: file.Note === INVOICE_COPY_NOTE } };
      why.push(`${label}: ${check.reason}`);
    } catch (err) {
      why.push(`${label}: could not be read (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return { none: why.join(' | ') };
}
