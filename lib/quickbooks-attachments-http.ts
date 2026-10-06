// QuickBooks' attachment endpoints over HTTP — the I/O half of
// lib/quickbooks-attachments.ts (writing the invoice copy) and
// lib/original-copy.ts (reading attached files back). It never obtains or
// refreshes a token (the caller hands one in) and never reads the
// environment, so a script can use it with an existing token and a test can
// use it with a fake fetch.

import { buildUploadRequest, readUploadResponse, type QbAttachable, type QbAttachmentApi } from './quickbooks-attachments';
import type { AttachmentFile } from './original-copy';

type Config = {
  base: string;
  realmId: string;
  accessToken: string;
  // QuickBooks' own PDF of the invoice, fetched by the caller.
  fetchPdf: () => Promise<Uint8Array>;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const assertId = (id: string) => {
  if (!/^\d+$/.test(id)) throw new Error(`"${id}" is not a QuickBooks id`);
};

// ── reading attached files back ──────────────────────────────────────────

type ReaderConfig = { base: string; realmId: string; accessToken: string; fetchImpl?: typeof fetch; timeoutMs?: number };

export interface AttachmentReader {
  // Every file attached to this invoice, with what is needed to download it.
  list(invoiceId: string): Promise<AttachmentFile[]>;
  // The file's bytes; refuses anything bigger than maxBytes (never buffers it).
  download(file: AttachmentFile, maxBytes: number): Promise<Uint8Array>;
}

// Reads a response body, stopping at maxBytes instead of buffering whatever
// arrives.
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const tooBig = () => new Error(`the file is larger than ${Math.round(maxBytes / 1024)} KB`);
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) { await res.body?.cancel(); throw tooBig(); }
  const reader = res.body?.getReader();
  if (!reader) {
    const whole = new Uint8Array(await res.arrayBuffer());
    if (whole.length > maxBytes) throw tooBig();
    return whole;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel(); throw tooBig(); }
    chunks.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length; }
  return out;
}

export function createHttpAttachmentReader(cfg: ReaderConfig): AttachmentReader {
  const doFetch = cfg.fetchImpl ?? fetch;
  const signal = () => AbortSignal.timeout(cfg.timeoutMs ?? 15_000);
  const company = `${cfg.base}/v3/company/${cfg.realmId}`;

  return {
    async list(invoiceId) {
      assertId(invoiceId);
      const query = `SELECT * FROM Attachable WHERE AttachableRef.EntityRef.Type = 'Invoice' AND AttachableRef.EntityRef.value = '${invoiceId}'`;
      const res = await doFetch(`${company}/query?query=${encodeURIComponent(query)}&minorversion=75`, {
        headers: { Authorization: `Bearer ${cfg.accessToken}`, Accept: 'application/json' },
        cache: 'no-store',
        signal: signal(),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`listing attachments: HTTP ${res.status} ${text.slice(0, 200)}`);
      let json: { QueryResponse?: { Attachable?: (QbAttachable & { ContentType?: string; Size?: number | string; TempDownloadUri?: string; MetaData?: { CreateTime?: string } })[] } };
      try { json = JSON.parse(text); } catch { throw new Error('listing attachments: QuickBooks answered with something that is not JSON'); }
      return (json.QueryResponse?.Attachable ?? []).map(a => {
        const size = Number(a.Size);
        return {
          Id: String(a.Id),
          FileName: a.FileName,
          ContentType: a.ContentType,
          Size: a.Size === undefined || !Number.isFinite(size) ? undefined : size,
          Note: a.Note ?? null,
          TempDownloadUri: a.TempDownloadUri,
          CreateTime: a.MetaData?.CreateTime,
        };
      });
    },

    // TempDownloadUri is a signed, short-lived link on QuickBooks' file
    // storage. It is fetched WITHOUT the QuickBooks token: the signature is
    // the credential, and the token must never go to another host.
    async download(file, maxBytes) {
      const uri = file.TempDownloadUri;
      if (!uri) throw new Error('QuickBooks gave no download link for the file');
      if (new URL(uri).protocol !== 'https:') throw new Error('the download link is not https');
      const res = await doFetch(uri, { cache: 'no-store', signal: signal() });
      if (!res.ok) throw new Error(`downloading the file: HTTP ${res.status}`);
      return readCapped(res, maxBytes);
    },
  };
}

export function createHttpAttachmentApi(cfg: Config): QbAttachmentApi {
  const doFetch = cfg.fetchImpl ?? fetch;
  const signal = () => AbortSignal.timeout(cfg.timeoutMs ?? 30_000);
  const auth = { Authorization: `Bearer ${cfg.accessToken}` };
  const company = `${cfg.base}/v3/company/${cfg.realmId}`;

  const readJson = async (res: Response, what: string) => {
    const text = await res.text();
    if (!res.ok) throw new Error(`${what}: HTTP ${res.status} ${text.slice(0, 200)}`);
    try { return JSON.parse(text) as Record<string, unknown>; } catch { throw new Error(`${what}: QuickBooks answered with something that is not JSON`); }
  };

  return {
    async listForInvoice(invoiceId) {
      assertId(invoiceId);
      const query = `SELECT * FROM Attachable WHERE AttachableRef.EntityRef.Type = 'Invoice' AND AttachableRef.EntityRef.value = '${invoiceId}'`;
      const res = await doFetch(`${company}/query?query=${encodeURIComponent(query)}&minorversion=75`, { headers: { ...auth, Accept: 'application/json' }, signal: signal() });
      const json = await readJson(res, 'listing attachments') as { QueryResponse?: { Attachable?: QbAttachable[] } };
      return (json.QueryResponse?.Attachable ?? []).map(a => ({ Id: String(a.Id), SyncToken: a.SyncToken === undefined ? undefined : String(a.SyncToken), FileName: a.FileName, Note: a.Note ?? null }));
    },

    pdf: cfg.fetchPdf,

    async upload({ invoiceId, fileName, note, pdf }) {
      assertId(invoiceId);
      const { body, contentType } = buildUploadRequest({ invoiceId, fileName, note, pdf });
      const res = await doFetch(`${company}/upload?minorversion=75`, {
        method: 'POST',
        headers: { ...auth, Accept: 'application/json', 'Content-Type': contentType },
        body,
        signal: signal(),
      });
      const json = await readJson(res, 'upload');
      const read = readUploadResponse(json);
      if ('error' in read) throw new Error(read.error);
      return read;
    },

    async remove({ Id, SyncToken }) {
      assertId(Id);
      const res = await doFetch(`${company}/attachable?operation=delete&minorversion=75`, {
        method: 'POST',
        headers: { ...auth, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ Id, SyncToken }),
        signal: signal(),
      });
      const json = await readJson(res, 'delete') as { Fault?: { Error?: { Message?: string; Detail?: string }[] }; Attachable?: { status?: string } };
      if (json.Fault) throw new Error(json.Fault.Error?.[0]?.Message ?? 'QuickBooks refused the delete');
      if (json.Attachable?.status && json.Attachable.status !== 'Deleted') throw new Error(`QuickBooks answered "${json.Attachable.status}"`);
    },
  };
}
