// Browser client for the local Tassure Draft Helper. The helper is bound to
// localhost. Two modes: openDraftsInOutlook (.Display() only — a human
// reviews and sends manually in Outlook) and sendDraftsInOutlook (.Save()
// then .Send() directly — used by the web app's own Outlook-style review
// screen, where the human already reviewed and clicked Send there; the
// synchronous HTTP response is the only "did it send" signal needed, no
// separate detection step).
import { invoicePdfFileName } from './invoice-filename';

export const DRAFT_HELPER_URL = 'http://127.0.0.1:51820';

// Bump alongside tassure-draft-helper/app.py's own VERSION whenever a new
// exe is built and copied to public/downloads/TassureDraftHelper.exe — this
// is what lets the web app tell staff their locally-installed Helper is
// stale instead of silently running old behaviour with no signal at all.
export const LATEST_HELPER_VERSION = '1.7.1';

export interface HelperHealth {
  ok: boolean;
  version: string;
  outlookPath?: string | null;
  isClassicOutlook?: boolean;
}

function versionIsOlder(current: string, latest: string): boolean {
  const a = current.split('.').map(Number);
  const b = latest.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0, y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

// null = unreachable (not running / network error), distinct from "running
// but outdated" — callers that only care about "is it usable right now"
// should keep using checkHelperHealth(); this is for surfacing version drift.
export async function getHelperHealth(timeoutMs = 800): Promise<HelperHealth | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${DRAFT_HELPER_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export function isHelperOutdated(health: HelperHealth | null): boolean {
  if (!health?.version) return false;
  return versionIsOlder(health.version, LATEST_HELPER_VERSION);
}

interface DraftInvoiceRef {
  qbCompany: string;
  invoiceNo: string;
  amount: number;
  qbInvoiceId?: string | null;
}

export interface DraftLike {
  id?: number;
  version?: number;
  company_name: string;
  sender_email?: string | null;
  to_email: string | null;
  cc_email: string | null;
  // Not backed by a database column anywhere today (email_drafts has no
  // bcc_email) — purely a local, per-send value staff can optionally type
  // into the Outlook-style review screen's Bcc row before sending, passed
  // straight through to Draft Helper. openDraftsInOutlook never reads this
  // (its /drafts/open payload builder maps named fields one by one, not an
  // object spread, so adding this field here has zero effect on that path).
  bcc_email?: string | null;
  subject: string;
  body: string;
  invoice_refs: DraftInvoiceRef[];
  additional_attachments?: File[];
  // Draft Helper always attaches STANDING_ATTACHMENTS (the company-wide
  // bank details PDF) from its own bundled assets — this is the one way to
  // opt a single send out of it, for the rare case someone removes it in
  // the review screen. Only meaningful to sendDraftsInOutlook.
  skip_standing_attachments?: boolean;
}

export interface DraftOpenResult {
  ok: boolean;
  error?: string;
  amountCorrected?: boolean;
  previousTotal?: number;
  newTotal?: number;
}

function normalizeRecipients(raw: string): string {
  return raw.split(/[;,\n\r]+/).map(s => s.trim()).filter(Boolean).join(',');
}

export function buildMailtoLink(d: Pick<DraftLike, 'to_email' | 'cc_email' | 'subject' | 'body'>): string {
  const to = normalizeRecipients(d.to_email ?? '');
  const cc = normalizeRecipients(d.cc_email ?? '');
  let body = d.body;
  const params = new URLSearchParams();
  if (cc) params.set('cc', cc);
  params.set('subject', d.subject);
  const base = `mailto:${encodeURIComponent(to)}?${params.toString()}`;
  const budget = 1900 - base.length;
  if (body.length > budget) body = body.slice(0, Math.max(0, budget - 40)) + '\n\n[Truncated — open the full draft in the system]';
  return `${base}&body=${encodeURIComponent(body)}`;
}

export async function checkHelperHealth(timeoutMs = 800): Promise<boolean> {
  return (await getHelperHealth(timeoutMs)) !== null;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export interface PreparedAttachment {
  fileName: string;
  base64: string;
  byteSize: number;
}

async function fileToAttachment(file: File): Promise<PreparedAttachment> {
  const buf = await file.arrayBuffer();
  return { fileName: file.name, base64: arrayBufferToBase64(buf), byteSize: buf.byteLength };
}

// System attachments only — the invoice PDF(s) resolved live from
// QuickBooks. Manual/additional attachments never need "preparing": a
// File's size is already known instantly in the browser, nothing to fetch.
async function fetchSystemAttachments(d: DraftLike): Promise<PreparedAttachment[]> {
  const downloadableRefs = (d.invoice_refs ?? []).filter(
    r => r.qbInvoiceId && (r.qbCompany === 'TAB' || r.qbCompany === 'TAC'),
  );
  return Promise.all(downloadableRefs.map(async r => {
    const res = await fetch(`/api/quickbooks/invoice-pdf?company=${r.qbCompany}&id=${encodeURIComponent(r.qbInvoiceId!)}`);
    if (!res.ok) throw new Error(`Unable to download ${r.qbCompany} ${r.invoiceNo}.`);
    const buf = await res.arrayBuffer();
    return {
      fileName: invoicePdfFileName(
        r.qbCompany as 'TAB' | 'TAC',
        r.invoiceNo,
        d.company_name,
        r.amount,
      ),
      base64: arrayBufferToBase64(buf),
      byteSize: buf.byteLength,
    };
  }));
}

// Right before a draft opens/sends, re-verify its invoice amount(s) against
// live QuickBooks data — catches the case where an invoice was corrected
// directly in QuickBooks after the draft text was prepared here, so the
// email body never shows a stale total while the attached PDF (always
// fetched live) shows the corrected one. Fails open: any error here just
// keeps the draft as originally passed in, never blocks it.
async function refreshAmount(draft: DraftLike): Promise<{ draft: DraftLike; corrected: boolean; previousTotal?: number; newTotal?: number }> {
  if (!draft.id) return { draft, corrected: false };
  try {
    const res = await fetch('/api/client-communications/drafts/refresh-amounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: draft.id }),
    });
    if (!res.ok) return { draft, corrected: false };
    const json = await res.json();
    if (!json.changed || !json.draft) return { draft, corrected: false };
    return {
      draft: {
        ...draft,
        subject: json.draft.subject,
        body: json.draft.body,
        invoice_refs: json.draft.invoice_refs,
        version: json.draft.version,
      },
      corrected: true,
      previousTotal: json.oldTotal,
      newTotal: json.newTotal,
    };
  } catch {
    return { draft, corrected: false };
  }
}

export interface PreparedDraft {
  draft: DraftLike;
  systemAttachments: PreparedAttachment[];
  amountCorrected: boolean;
  previousTotal?: number;
  newTotal?: number;
}

// Shared prep step for both open and send: refresh the amount, then fetch
// whatever the (possibly amount-corrected) draft's own system attachments
// are. Exported so a review screen can call this once, show the result,
// and hand the same PreparedDraft to sendDraftsInOutlook when the user
// actually clicks Send — never re-fetching/re-verifying a second time
// right after the first, which would be slower and reopens (however
// narrowly) the chance of what's sent silently differing from what was
// reviewed.
export async function prepareDraftForSend(draft: DraftLike): Promise<PreparedDraft> {
  const refreshed = await refreshAmount(draft);
  const systemAttachments = await fetchSystemAttachments(refreshed.draft);
  return {
    draft: refreshed.draft,
    systemAttachments,
    amountCorrected: refreshed.corrected,
    previousTotal: refreshed.previousTotal,
    newTotal: refreshed.newTotal,
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

// Prepares invoice PDFs with bounded concurrency, then sends the helper small
// batches so a 40-company run does not create one very large localhost request.
export async function openDraftsInOutlook(
  drafts: DraftLike[],
  commonAttachments: File[] = [],
): Promise<DraftOpenResult[]> {
  const results: DraftOpenResult[] = new Array(drafts.length);
  const corrections = new Array<{ corrected: boolean; previousTotal?: number; newTotal?: number }>(drafts.length);
  const common = await Promise.all(commonAttachments.map(fileToAttachment));
  const prepared = await mapWithConcurrency(drafts, 4, async (draft, index) => {
    try {
      const result = await prepareDraftForSend(draft);
      const manualAttachments = await Promise.all((draft.additional_attachments ?? []).map(fileToAttachment));
      corrections[index] = {
        corrected: result.amountCorrected,
        previousTotal: result.previousTotal,
        newTotal: result.newTotal,
      };
      return { index, draft: result.draft, attachments: [...result.systemAttachments, ...manualAttachments] };
    } catch (e: unknown) {
      results[index] = {
        ok: false,
        error: e instanceof Error ? e.message : 'Unable to prepare attachments.',
      };
      return null;
    }
  });

  const payload: {
    senderEmail: string;
    to: string;
    cc: string;
    subject: string;
    body: string;
    attachments: PreparedAttachment[];
  }[] = [];
  const payloadIndex: number[] = [];

  for (const item of prepared) {
    if (!item) continue;
    const draft = item.draft;
    payload.push({
      senderEmail: draft.sender_email ?? '',
      to: draft.to_email ?? '',
      cc: draft.cc_email ?? '',
      subject: draft.subject,
      body: draft.body,
      attachments: [...item.attachments, ...common],
    });
    payloadIndex.push(item.index);
  }

  for (let start = 0; start < payload.length; start += 10) {
    const payloadChunk = payload.slice(start, start + 10);
    const indexChunk = payloadIndex.slice(start, start + 10);
    try {
      const res = await fetch(`${DRAFT_HELPER_URL}/drafts/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ drafts: payloadChunk }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const message = j.error ?? `Helper returned HTTP ${res.status}`;
        for (const idx of indexChunk) results[idx] = { ok: false, error: message };
      } else {
        const j = await res.json();
        const helperResults: DraftOpenResult[] = j.results ?? [];
        indexChunk.forEach((idx, k) => {
          results[idx] = helperResults[k] ?? { ok: false, error: 'No result returned.' };
        });
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unable to reach Tassure Draft Helper.';
      for (const idx of indexChunk) results[idx] = { ok: false, error: message };
    }
  }

  for (let idx = 0; idx < results.length; idx++) {
    if (results[idx]?.ok && corrections[idx]?.corrected) {
      results[idx] = {
        ...results[idx],
        amountCorrected: true,
        previousTotal: corrections[idx].previousTotal,
        newTotal: corrections[idx].newTotal,
      };
    }
  }

  return results;
}

// Takes already-PREPARED drafts (see prepareDraftForSend) rather than raw
// DraftLike[] — the review screen calls prepareDraftForSend once when it
// opens, the user reviews exactly that, and this sends exactly that, with
// no second fetch/refresh in between. Calls /drafts/send (.Save() then
// .Send() — a real, immediate send), not /drafts/open.
export async function sendDraftsInOutlook(
  prepared: PreparedDraft[],
  commonAttachments: File[] = [],
): Promise<DraftOpenResult[]> {
  const common = await Promise.all(commonAttachments.map(fileToAttachment));
  const payload: {
    senderEmail: string;
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    body: string;
    attachments: PreparedAttachment[];
    skipStandingAttachments: boolean;
  }[] = [];

  for (const item of prepared) {
    const draft = item.draft;
    const manualAttachments = await Promise.all((draft.additional_attachments ?? []).map(fileToAttachment));
    payload.push({
      senderEmail: draft.sender_email ?? '',
      to: draft.to_email ?? '',
      cc: draft.cc_email ?? '',
      bcc: draft.bcc_email ?? '',
      subject: draft.subject,
      body: draft.body,
      attachments: [...item.systemAttachments, ...manualAttachments, ...common],
      skipStandingAttachments: draft.skip_standing_attachments ?? false,
    });
  }

  const results: DraftOpenResult[] = new Array(prepared.length);
  for (let start = 0; start < payload.length; start += 10) {
    const payloadChunk = payload.slice(start, start + 10);
    try {
      // Bounded timeout, unlike /drafts/open above: this is the one call in
      // this file that can make Outlook actually transmit mail, which is
      // exactly the scenario Outlook's "a program is sending mail on your
      // behalf" security prompt exists for. If that prompt appears with no
      // one there to click it, the COM call blocks rather than throwing —
      // this timeout turns an indefinite hang into a clear, actionable error.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 45000);
      let res: Response;
      try {
        res = await fetch(`${DRAFT_HELPER_URL}/drafts/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ drafts: payloadChunk }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const message = j.error ?? `Helper returned HTTP ${res.status}`;
        for (let k = 0; k < payloadChunk.length; k++) results[start + k] = { ok: false, error: message };
      } else {
        const j = await res.json();
        const helperResults: DraftOpenResult[] = j.results ?? [];
        for (let k = 0; k < payloadChunk.length; k++) {
          results[start + k] = helperResults[k] ?? { ok: false, error: 'No result returned.' };
        }
      }
    } catch (e: unknown) {
      const message = e instanceof Error && e.name === 'AbortError'
        ? 'Draft Helper did not respond in time — check the computer for a stuck Outlook prompt, then try again.'
        : e instanceof Error ? e.message : 'Unable to reach Tassure Draft Helper.';
      for (let k = 0; k < payloadChunk.length; k++) results[start + k] = { ok: false, error: message };
    }
  }
  return results;
}
