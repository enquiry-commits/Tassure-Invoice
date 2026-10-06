// Is a PDF attached to an invoice in QuickBooks really the ORIGINAL (unsplit)
// invoice the client was sent?
//
// Why this exists (Vincent, 2026-10-06): accounting splits an invoice's lines
// AFTER it has gone to the client (INV-QB-029), so QuickBooks only prints the
// split version — and the system redraws it for the SOA / emails (~27% of
// open invoices). The copy attached to the invoice in QuickBooks
// (INV-QB-036) is the real original. Using it needs one safe answer: is THIS
// file that original, and not the split version, an older figure, another
// invoice, or something else staff attached? Whatever is not provably the
// original is never used — the caller falls back to the redraw.
//
// The proof is what the PDF PRINTS. The original shows each service once at
// its full amount (700.00); QuickBooks' split version prints the halves
// (175.00 and 525.00). So the money printed on the page must be exactly the
// merged line amounts plus the invoice total, no more, no less. Checked on
// real files, 2026-10-06: 8 of 8 attached copies of unsplit invoices equal
// "lines + total", and 12 of 12 current QuickBooks PDFs of split invoices
// print the split amounts and none looks like the merged original.
//
// Pure: no I/O. The caller supplies the text (lib/pdf-text.ts) and the
// attachments (lib/quickbooks-attachments-http.ts).

import { INVOICE_COPY_NOTE, looksLikePdf } from './quickbooks-attachments';

export const formatMoney = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Money as QuickBooks prints it. A date such as 31.08.2026 is not an amount
// (its "31.08" is followed by another dot).
const MONEY_TOKEN = /(?<![\d.,])\d{1,3}(?:,\d{3})*\.\d{2}(?![\d.])/g;

export function printedAmounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of text.match(MONEY_TOKEN) ?? []) counts.set(token, (counts.get(token) ?? 0) + 1);
  return counts;
}

export type OriginalCheck = { ok: true } | { ok: false; reason: string };

// text: what the attached PDF says. amounts: the invoice's lines as the
// client first saw them (each service merged with its Deferred twin); total:
// the invoice total. Both come from QuickBooks' live invoice. Signs are not
// compared (a discount prints as -50.00 or (50.00), the digits are what count).
export function checkOriginalCopy(text: string, args: { docNumber: string; amounts: number[]; total: number }): OriginalCheck {
  if (!args.docNumber || !text.includes(args.docNumber)) return { ok: false, reason: `the invoice number ${args.docNumber} is not on it` };
  const expected = new Map<string, number>();
  for (const a of [...args.amounts, args.total]) {
    const key = formatMoney(Math.abs(a));
    expected.set(key, (expected.get(key) ?? 0) + 1);
  }
  const printed = printedAmounts(text);
  const missing: string[] = [];
  const unexpected: string[] = [];
  for (const key of new Set([...expected.keys(), ...printed.keys()])) {
    const want = expected.get(key) ?? 0;
    const got = printed.get(key) ?? 0;
    if (got < want) missing.push(key);
    if (got > want) unexpected.push(key);
  }
  if (!missing.length && !unexpected.length) return { ok: true };
  return { ok: false, reason: `its amounts are not the unsplit invoice's (${missing.length ? `missing ${missing.join(', ')}` : ''}${missing.length && unexpected.length ? '; ' : ''}${unexpected.length ? `unexpected ${unexpected.join(', ')}` : ''})` };
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
  text(bytes: Uint8Array): Promise<string>;
};

export type OriginalCopyResult =
  | { found: { bytes: Uint8Array; fileName: string; attachableId: string; bySystem: boolean } }
  | { none: string };

// An invoice PDF is ~160 KB; anything near this size is not one (a scan or a
// bundle somebody attached), and is neither downloaded nor parsed.
export const MAX_ORIGINAL_BYTES = 5 * 1024 * 1024;
const MAX_CANDIDATES = 4;

// The first attached PDF that is provably the original — the system's own
// copy first (made before any split, INV-QB-036), then files staff attached,
// newest first. Every failure of one candidate (download, parse, mismatch)
// just moves on to the next; nothing here throws.
export async function selectVerifiedOriginal(
  deps: OriginalCopyDeps,
  args: { docNumber: string; amounts: number[]; total: number },
): Promise<OriginalCopyResult> {
  let files: AttachmentFile[];
  try {
    files = await deps.list();
  } catch (err) {
    return { none: `could not list the invoice's attachments (${err instanceof Error ? err.message : String(err)})` };
  }
  const pdfs = files
    .filter(f => (f.ContentType === 'application/pdf' || /\.pdf$/i.test(f.FileName ?? '')) && !!f.TempDownloadUri && (f.Size === undefined || f.Size <= MAX_ORIGINAL_BYTES))
    .sort((a, b) => Number(b.Note === INVOICE_COPY_NOTE) - Number(a.Note === INVOICE_COPY_NOTE) || String(b.CreateTime ?? '').localeCompare(String(a.CreateTime ?? '')))
    .slice(0, MAX_CANDIDATES);
  if (!pdfs.length) return { none: 'no PDF attached' };

  const why: string[] = [];
  for (const file of pdfs) {
    const label = file.FileName || `#${file.Id}`;
    try {
      const bytes = await deps.download(file);
      if (!looksLikePdf(bytes)) { why.push(`${label}: not a PDF`); continue; }
      const check = checkOriginalCopy(await deps.text(bytes), args);
      if (check.ok) return { found: { bytes, fileName: file.FileName ?? `${file.Id}.pdf`, attachableId: file.Id, bySystem: file.Note === INVOICE_COPY_NOTE } };
      why.push(`${label}: ${check.reason}`);
    } catch (err) {
      why.push(`${label}: could not be read (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  return { none: why.join(' | ') };
}
