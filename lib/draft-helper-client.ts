// Browser client for the local Tassure Draft Helper. The helper is bound to
// localhost and creates Outlook MailItems with .Display() only — never Send().
import { invoicePdfFileName } from './invoice-filename';

export const DRAFT_HELPER_URL = 'http://127.0.0.1:51820';

// Bump alongside tassure-draft-helper/app.py's own VERSION whenever a new
// exe is built and copied to public/downloads/TassureDraftHelper.exe — this
// is what lets the web app tell staff their locally-installed Helper is
// stale instead of silently running old behaviour with no signal at all.
export const LATEST_HELPER_VERSION = '1.2.0';

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
  subject: string;
  body: string;
  invoice_refs: DraftInvoiceRef[];
  additional_attachments?: File[];
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

async function fileToAttachment(file: File) {
  return { fileName: file.name, base64: arrayBufferToBase64(await file.arrayBuffer()) };
}

async function fetchAttachments(d: DraftLike): Promise<{ fileName: string; base64: string }[]> {
  const downloadableRefs = (d.invoice_refs ?? []).filter(
    r => r.qbInvoiceId && (r.qbCompany === 'TAB' || r.qbCompany === 'TAC'),
  );
  const systemAttachments = await Promise.all(downloadableRefs.map(async r => {
    const res = await fetch(`/api/quickbooks/invoice-pdf?company=${r.qbCompany}&id=${encodeURIComponent(r.qbInvoiceId!)}`);
    if (!res.ok) throw new Error(`Unable to download ${r.qbCompany} ${r.invoiceNo}.`);
    return {
      fileName: invoicePdfFileName(
        r.qbCompany as 'TAB' | 'TAC',
        r.invoiceNo,
        d.company_name,
        r.amount,
      ),
      base64: arrayBufferToBase64(await res.arrayBuffer()),
    };
  }));
  const manualAttachments = await Promise.all((d.additional_attachments ?? []).map(fileToAttachment));
  return [...systemAttachments, ...manualAttachments];
}

// Right before a draft opens in Outlook, re-verify its invoice amount(s)
// against live QuickBooks data — catches the case where an invoice was
// corrected directly in QuickBooks after the draft text was prepared here,
// so the email body never shows a stale total while the attached PDF (always
// fetched live) shows the corrected one. Fails open: any error here just
// keeps the draft as originally passed in, never blocks it from opening.
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
      const [refreshed, attachments] = await Promise.all([
        refreshAmount(draft),
        fetchAttachments(draft),
      ]);
      corrections[index] = {
        corrected: refreshed.corrected,
        previousTotal: refreshed.previousTotal,
        newTotal: refreshed.newTotal,
      };
      return { index, draft: refreshed.draft, attachments };
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
    attachments: { fileName: string; base64: string }[];
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
