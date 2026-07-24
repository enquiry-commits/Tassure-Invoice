// Client for the local "Tassure Draft Helper" companion app — a small
// Windows program staff install once (per BUILD.md in the separate
// tassure-draft-helper project) that opens real Outlook compose windows via
// COM automation, with invoice PDF(s) already attached. Only ever calls
// Outlook's .Display(), never .Send() — a human still reviews and sends
// every email, same as the legacy BULK.xlsm macro and the existing
// mailto:/​.eml paths on this page.
import { invoicePdfFileName } from './invoice-filename';

export const DRAFT_HELPER_URL = 'http://127.0.0.1:51820';

interface DraftInvoiceRef {
  qbCompany: string;
  invoiceNo: string;
  amount: number;
  qbInvoiceId?: string | null;
}

export interface DraftLike {
  company_name: string;
  to_email: string | null;
  cc_email: string | null;
  subject: string;
  body: string;
  invoice_refs: DraftInvoiceRef[];
}

export interface DraftOpenResult {
  ok: boolean;
  error?: string;
}

export async function checkHelperHealth(timeoutMs = 800): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${DRAFT_HELPER_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

// Chunked to avoid blowing the call stack on multi-MB PDFs (spreading a huge
// Uint8Array into String.fromCharCode all at once fails for large files).
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchAttachments(d: DraftLike): Promise<{ fileName: string; base64: string }[]> {
  const downloadableRefs = (d.invoice_refs ?? []).filter(r => r.qbInvoiceId && (r.qbCompany === 'TAB' || r.qbCompany === 'TAC'));
  return Promise.all(downloadableRefs.map(async r => {
    const res = await fetch(`/api/quickbooks/invoice-pdf?company=${r.qbCompany}&id=${encodeURIComponent(r.qbInvoiceId!)}`);
    if (!res.ok) throw new Error(`Unable to download ${r.qbCompany} #${r.invoiceNo}.`);
    const buf = await res.arrayBuffer();
    return {
      fileName: invoicePdfFileName(r.qbCompany as 'TAB' | 'TAC', r.invoiceNo, d.company_name, r.amount),
      base64: arrayBufferToBase64(buf),
    };
  }));
}

// Opens one Outlook compose window per draft, each with its invoice PDF(s)
// already attached. Returns one result per input draft, same order — a
// failure on one draft (e.g. an invoice PDF fetch error) never stops the
// rest of the batch from opening.
export async function openDraftsInOutlook(drafts: DraftLike[]): Promise<DraftOpenResult[]> {
  const results: DraftOpenResult[] = new Array(drafts.length);
  const payload: { to: string; cc: string; subject: string; body: string; attachments: { fileName: string; base64: string }[] }[] = [];
  const payloadIndex: number[] = [];

  for (let i = 0; i < drafts.length; i++) {
    try {
      const attachments = await fetchAttachments(drafts[i]);
      payload.push({
        to: drafts[i].to_email ?? '',
        cc: drafts[i].cc_email ?? '',
        subject: drafts[i].subject,
        body: drafts[i].body,
        attachments,
      });
      payloadIndex.push(i);
    } catch (e: unknown) {
      results[i] = { ok: false, error: e instanceof Error ? e.message : 'Unable to prepare attachments.' };
    }
  }

  if (payload.length > 0) {
    const res = await fetch(`${DRAFT_HELPER_URL}/drafts/open`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drafts: payload }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      const message = j.error ?? `Helper returned HTTP ${res.status}`;
      for (const idx of payloadIndex) results[idx] = { ok: false, error: message };
    } else {
      const j = await res.json();
      const helperResults: DraftOpenResult[] = j.results ?? [];
      payloadIndex.forEach((idx, k) => { results[idx] = helperResults[k] ?? { ok: false, error: 'No result returned.' }; });
    }
  }

  return results;
}
