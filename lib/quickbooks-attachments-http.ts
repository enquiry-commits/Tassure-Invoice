// QuickBooks' attachment endpoints over HTTP — the I/O half of
// lib/quickbooks-attachments.ts. It never obtains or refreshes a token (the
// caller hands one in) and never reads the environment, so a script can use
// it with an existing token and a test can use it with a fake fetch.

import { buildUploadRequest, readUploadResponse, type QbAttachable, type QbAttachmentApi } from './quickbooks-attachments';

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
