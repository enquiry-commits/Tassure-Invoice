// The invoice copy kept in QuickBooks as an attachment of the invoice itself.
// Accounting's rule (2026-10-06, written on the invoice edit screen): "From
// now onwards, kindly attached the invoice copy as attachment here." —
// because Chelsea splits the lines AFTER the invoice has gone to the client
// (INV-QB-029), after which QuickBooks only prints the split version; the
// copy attached at creation is the one the client first received. Staff had
// started doing it by hand, naming the file the way "Save PDF" does. The
// system now attaches QuickBooks' own PDF of the invoice automatically when
// it creates one, and replaces its own copy when the invoice is edited
// before sending (INV-QB-036).
//
// This file is the DECISION logic and the wire formats — no network, no
// tokens — so every branch is tested with fakes (test-qb-attachments.ts).
// The HTTP side is lib/quickbooks-attachments-http.ts, the wiring (token,
// switch, file name) lib/quickbooks-invoice-copy.ts.

// How the system recognises its own attachment, so a refresh replaces only
// that and never a file someone attached by hand.
export const INVOICE_COPY_NOTE = 'Invoice copy attached automatically by the Tassure system';

export type QbAttachable = { Id: string; SyncToken?: string; FileName?: string; Note?: string | null };

export interface QbAttachmentApi {
  // Every attachable linked to this invoice.
  listForInvoice(invoiceId: string): Promise<QbAttachable[]>;
  // QuickBooks' own PDF of the invoice, as it is right now.
  pdf(): Promise<Uint8Array>;
  upload(args: { invoiceId: string; fileName: string; note: string; pdf: Uint8Array }): Promise<{ id: string }>;
  remove(args: { Id: string; SyncToken: string }): Promise<void>;
}

export type InvoiceCopyResult =
  | { status: 'attached'; attachableId: string; replaced: number; warning?: string }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; error: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length > 500 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d; // "%PDF-"
}

// mode 'create': the invoice was just made — attach once, never twice.
// mode 'refresh': the invoice was edited — replace the system's own copy.
// In both modes a file somebody attached by hand is left alone, and the
// system adds none next to it (two "copies" would only confuse accounting).
// splitByAccounting: the invoice already carries accounting's Deferred
// Revenue split — QuickBooks now prints the SPLIT version, which is exactly
// what the copy exists to avoid (INV-QB-029), so nothing is attached or
// replaced: the copy made before the split stays the original.
export async function placeInvoiceCopy(
  api: QbAttachmentApi,
  opts: { invoiceId: string; fileName: string; mode: 'create' | 'refresh'; splitByAccounting?: boolean },
): Promise<InvoiceCopyResult> {
  if (opts.splitByAccounting) {
    return { status: 'skipped', reason: 'accounting has already split this invoice — QuickBooks would print the split version, so the copy made before the split is kept' };
  }
  let existing: QbAttachable[];
  try {
    existing = await api.listForInvoice(opts.invoiceId);
  } catch (err) {
    return { status: 'failed', error: `could not read the invoice's attachments (${message(err)})` };
  }
  const ours = existing.filter(a => a.Note === INVOICE_COPY_NOTE);
  const byHand = existing.length - ours.length;
  if (opts.mode === 'create' && ours.length) return { status: 'skipped', reason: 'the system already attached its copy' };
  if (!ours.length && byHand) return { status: 'skipped', reason: 'the invoice already has a file attached by hand — no second copy was added' };

  let pdf: Uint8Array;
  try {
    pdf = await api.pdf();
  } catch (err) {
    return { status: 'failed', error: `could not get the invoice PDF from QuickBooks (${message(err)})` };
  }
  if (!looksLikePdf(pdf)) return { status: 'failed', error: 'QuickBooks did not return a PDF for this invoice' };

  let uploaded: { id: string };
  try {
    uploaded = await api.upload({ invoiceId: opts.invoiceId, fileName: opts.fileName, note: INVOICE_COPY_NOTE, pdf });
  } catch (err) {
    return { status: 'failed', error: `the upload to QuickBooks failed (${message(err)})` };
  }

  // The previous system copy goes only AFTER the new one is safely in, so a
  // failure never leaves the invoice without a copy.
  let replaced = 0;
  const problems: string[] = [];
  for (const old of ours) {
    if (!old.SyncToken) { problems.push(`#${old.Id} has no SyncToken`); continue; }
    try {
      await api.remove({ Id: old.Id, SyncToken: old.SyncToken });
      replaced++;
    } catch (err) {
      problems.push(`#${old.Id}: ${message(err)}`);
    }
  }
  return { status: 'attached', attachableId: uploaded.id, replaced, ...(problems.length ? { warning: `the previous copy could not be removed (${problems.join('; ')})` } : {}) };
}

// ── wire formats ─────────────────────────────────────────────────────────

// A file name safe inside a multipart header (the real, possibly Chinese,
// name travels in the JSON metadata, which is UTF-8).
export function asciiFileName(name: string): string {
  return name.normalize('NFKD').replace(/[^\x20-\x7e]+/g, '_').replace(/["\\]/g, "'").trim() || 'invoice.pdf';
}

const encoder = new TextEncoder();

// multipart/form-data as QuickBooks' /upload expects it: one JSON part named
// file_metadata_01 (which invoice, the file name, the note) and one file
// part named file_content_01. IncludeOnSend stays false — the copy is for
// accounting's record, not something QuickBooks should mail to the client.
export function buildUploadRequest(args: { invoiceId: string; fileName: string; note: string; pdf: Uint8Array; boundary?: string }): { body: Uint8Array<ArrayBuffer>; contentType: string } {
  const boundary = args.boundary ?? `----TassureInvoiceCopy${Date.now().toString(16)}${Math.random().toString(16).slice(2, 10)}`;
  const metadata = JSON.stringify({
    AttachableRef: [{ EntityRef: { type: 'Invoice', value: args.invoiceId }, IncludeOnSend: false }],
    FileName: args.fileName,
    ContentType: 'application/pdf',
    Note: args.note,
  });
  const head = encoder.encode(
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="file_metadata_01"\r\n' +
    'Content-Type: application/json; charset=UTF-8\r\n' +
    'Content-Transfer-Encoding: 8bit\r\n\r\n' +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file_content_01"; filename="${asciiFileName(args.fileName)}"\r\n` +
    'Content-Type: application/pdf\r\n' +
    'Content-Transfer-Encoding: binary\r\n\r\n',
  );
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(new ArrayBuffer(head.length + args.pdf.length + tail.length));
  body.set(head, 0);
  body.set(args.pdf, head.length);
  body.set(tail, head.length + args.pdf.length);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

// QuickBooks answers an upload with HTTP 200 even when it refused the file
// (the refusal is a Fault inside AttachableResponse), so success is only
// "an Attachable with an Id came back".
export function readUploadResponse(json: unknown): { id: string } | { error: string } {
  const root = (json ?? {}) as { AttachableResponse?: { Attachable?: { Id?: string | number }; Fault?: { Error?: { Message?: string; Detail?: string }[] } }[]; Fault?: { Error?: { Message?: string; Detail?: string }[] } };
  const item = root.AttachableResponse?.[0];
  const id = item?.Attachable?.Id;
  if (id !== undefined && id !== null && String(id) !== '') return { id: String(id) };
  const fault = item?.Fault ?? root.Fault;
  const first = fault?.Error?.[0];
  if (first) return { error: [first.Message, first.Detail].filter(Boolean).join(': ') || 'QuickBooks refused the file' };
  return { error: 'QuickBooks answered without an attachment id' };
}
