// Staff upload the ORIGINAL invoice they found for an invoice on the Invoice
// Originals page (Vincent, 2026-10-06; INV-QB-037): the file is checked against
// the LIVE invoice with the same proof the SOA and Email Drafts rely on
// (lib/original-copy.ts), attached to that invoice in QuickBooks, and — only
// then — counts as its original everywhere, because the real PDF path looks
// attachments up exactly like this. Nothing here trusts the person: a wrong
// file is refused and attaches nothing, and a file the proof cannot judge (a
// picture, a regrouped invoice) is refused too — the redraw stays the last
// resort, never a wrong "original".
//
// DECISION logic only (no network, no environment, no token): every branch is
// tested with fakes (test-original-upload.ts), like lib/quickbooks-attachments.ts.
// The wiring is lib/original-upload-live.ts, the route app/api/billing/originals/upload.

import { createHash } from 'node:crypto';
import { looksLikePdf } from './quickbooks-attachments';
import { checkOriginalCopy, MAX_ORIGINAL_BYTES, selectVerifiedOriginal, type AttachmentFile, type ConfirmedOriginal, type InvoiceFacts, type PdfFacts } from './original-copy';
import { hintForReason } from './original-status-core';

export type UploadedBy = { name: string; email: string };

export type OriginalUploadDeps = {
  // The invoice as it is in QuickBooks NOW. facts is null when it no longer
  // carries a Deferred Revenue line (QuickBooks' own PDF is then right).
  loadInvoice(): Promise<{ facts: InvoiceFacts | null } | null>;
  // The files attached to the invoice right now (asked again after the upload).
  list(): Promise<AttachmentFile[]>;
  download(file: AttachmentFile): Promise<Uint8Array>;
  // Throws when the file cannot be read or merged the way the SOA merges it.
  read(bytes: Uint8Array): Promise<PdfFacts>;
  upload(args: { fileName: string; note: string; pdf: Uint8Array }): Promise<{ id: string }>;
  now(): Date;
  // Vincent's decisions for this invoice (lib/original-decisions.ts) — the same ones the SOA's look-up honours.
  confirmed?: readonly ConfirmedOriginal[];
};

export type UploadResult =
  // Attached, and the lookup the SOA uses picked exactly this file.
  | { status: 'attached'; attachableId: string; fileName: string }
  // The invoice already has an original the system accepts: nothing was attached.
  | { status: 'already'; fileName: string }
  // The file is not accepted as this invoice's original: nothing was attached.
  | { status: 'refused'; reason: string; hint: string | null }
  // The invoice carries no Deferred Revenue line any more: no original is needed.
  | { status: 'not-split' }
  // Uploaded, but the lookup did not confirm it (QuickBooks slow, or the file
  // outside the files looked at). The file stays; refresh the page.
  | { status: 'unconfirmed'; attachableId: string; reason: string }
  // Nothing was attached: QuickBooks could not be read, or refused the upload.
  | { status: 'failed'; error: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const refused = (reason: string): UploadResult => ({ status: 'refused', reason, hint: hintForReason(reason) });

export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// What the invoice's attachment list shows for a file staff uploaded: a clean
// name built here, never the name of the file on someone's computer (it can be
// anything, and "Save PDF"-style names are exactly what staff must not mix up).
export function originalFileName(invoiceNo: string, customer: string): string {
  const clean = (s: string) => s.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${clean(invoiceNo)} - ${clean(customer).slice(0, 80).trim()} - original.pdf`;
}

// Never INVOICE_COPY_NOTE: that marks the system's own copy, which the system
// replaces when the invoice is edited (lib/quickbooks-attachments.ts) — a file
// staff found must never be mistaken for it.
export function originalUploadNote(by: UploadedBy, at: Date, sha256: string): string {
  return `Original invoice PDF uploaded on the Invoice Originals page by ${by.name} (${by.email}) on ${at.toISOString().slice(0, 10)}; the system checked it against this invoice (number, date, customer, amounts) before attaching it. sha256 ${sha256}`;
}

export async function placeUploadedOriginal(deps: OriginalUploadDeps, input: { bytes: Uint8Array; by: UploadedBy }): Promise<UploadResult> {
  const { bytes, by } = input;
  if (bytes.length > MAX_ORIGINAL_BYTES) return refused(`the file is larger than ${MAX_ORIGINAL_BYTES / 1024 / 1024} MB — an invoice PDF is 80-260 KB`);
  if (!looksLikePdf(bytes)) return refused('the file is not a PDF');

  let invoice: { facts: InvoiceFacts | null } | null;
  try {
    invoice = await deps.loadInvoice();
  } catch (err) {
    return { status: 'failed', error: `could not read the invoice from QuickBooks (${message(err)})` };
  }
  if (!invoice) return { status: 'failed', error: 'the invoice could not be found in QuickBooks' };
  const { facts } = invoice;
  if (!facts) return { status: 'not-split' };

  // An invoice that already has its original needs nothing: a second file next
  // to it could only confuse accounting, and it is how a double click, or two
  // people working on the same invoice, would otherwise attach it twice.
  let files: AttachmentFile[];
  try {
    files = await deps.list();
  } catch (err) {
    return { status: 'failed', error: `could not read the invoice's attachments (${message(err)})` };
  }
  const existing = await selectVerifiedOriginal({ list: async () => files, download: deps.download, read: deps.read }, facts, deps.confirmed);
  if ('found' in existing) return { status: 'already', fileName: existing.found.fileName };

  // The proof, against the live invoice. Anything it cannot read or does not
  // accept is refused here, before QuickBooks is written to.
  let pdf: PdfFacts;
  try {
    pdf = await deps.read(bytes);
  } catch (err) {
    return refused(`the file could not be read (${message(err)})`);
  }
  const check = checkOriginalCopy(pdf, facts);
  if (!check.ok) return refused(check.reason);

  const fileName = originalFileName(facts.invoiceNo, facts.customer);
  let uploaded: { id: string };
  try {
    uploaded = await deps.upload({ fileName, note: originalUploadNote(by, deps.now(), sha256Hex(bytes)), pdf: bytes });
  } catch (err) {
    return { status: 'failed', error: `the upload to QuickBooks failed (${message(err)})` };
  }

  // Confirmed the way the SOA will read it: the real look-up, on the files as
  // they are now. Never rolled back when it does not confirm — the proof passed,
  // and removing a file from QuickBooks is not this page's job.
  const afterwards = await selectVerifiedOriginal({ list: deps.list, download: deps.download, read: deps.read }, facts, deps.confirmed);
  if ('found' in afterwards) {
    return afterwards.found.attachableId === uploaded.id
      ? { status: 'attached', attachableId: uploaded.id, fileName }
      // Someone else's accepted file is in use (two people at once): the invoice has its original either way.
      : { status: 'already', fileName: afterwards.found.fileName };
  }
  return { status: 'unconfirmed', attachableId: uploaded.id, reason: afterwards.none };
}

// What the route answers with, per outcome.
export function httpStatusFor(result: UploadResult): number {
  switch (result.status) {
    case 'attached': case 'already': case 'unconfirmed': return 200;
    case 'not-split': return 409;
    case 'refused': return 422;
    case 'failed': return 502;
  }
}
