'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { displayInvoiceNo } from './ExpandedBillingRow';
import type { QbCompany } from '@/lib/quickbooks';
import { invoicePdfRequest, type InvoiceChipView } from '@/lib/invoice-pdf-request';

/**
 * A small clickable "TAB #02610938"-style chip that opens the real QuickBooks
 * PDF in a new tab. Extracted 2026-09-16 from app/billing/page.tsx (where it
 * started, Vincent 2026-09-11: "这些Invoice 可以直接点开到实际的PDF吗") into
 * this shared file so app/billing/soa/_components.tsx's detail modal can use
 * the EXACT SAME chip (Vincent: "SOA 里面的可点击式INVOICE 号码UI格式能不能设
 * 计成和 Billing Drafts的那个INVOICE 格式那样灰色的") instead of a second,
 * differently-styled implementation that would drift from this one over time
 * — same reasoning as every other "one shared component/function, not a
 * copy per page" consolidation in this codebase.
 *
 * Two additions beyond the original Billing Drafts version, both additive
 * (existing callers passing only company/invoiceNo/title/muted are
 * unaffected):
 * - `id`: when the caller already knows QuickBooks' own internal Id (the
 *   SOA detail modal does, straight from the AgedReceivableDetail report —
 *   see lib/quickbooks-ar-aging.ts), pass it to skip the DocNumber lookup
 *   /api/quickbooks/invoice-pdf otherwise has to do server-side.
 * - `docType`: 'credit' for a Credit Note (QuickBooks' PDF endpoint is
 *   /creditmemo/{id}/pdf, not /invoice/{id}/pdf — see that route's own
 *   docType param). Defaults to 'invoice', matching every pre-existing
 *   caller's behavior exactly.
 * - `company` widened from 'TAB' | 'TAC' to the full QbCompany (adds 'TAO')
 *   — the PDF route itself already supported all three; Billing Drafts
 *   just never had a TAO caller yet.
 *
 * `view` (added 2026-10-07, INV-QB-029): which copy of the invoice the chip
 * opens. 'quickbooks' (the default, every existing caller) is QuickBooks' own
 * PDF — accounting's split lines included. 'client' is what the CLIENT gets
 * (/api/billing/client-invoice-pdf: each service once at its full amount; the
 * original when one is attached): the SOA detail uses it, because a statement
 * is a client document — Vincent, after testing it live: the merged statement
 * was right, but the invoices opened from the SOA still showed the split. It
 * only applies to an invoice whose QuickBooks Id is known (a credit note, or a
 * chip given only a number, still opens QuickBooks' own PDF), and when the
 * client copy could not be drawn and QuickBooks' own PDF came back instead the
 * chip turns amber and says why (the route's X-Client-Invoice-Fallback) — it
 * never opens a split invoice silently.
 */
export function BillingInvoiceReference({ company, invoiceNo, id, docType = 'invoice', title, muted = false, view = 'quickbooks', suffix }: {
  company: QbCompany; invoiceNo?: string | null; id?: string | null; docType?: 'invoice' | 'credit'; title?: string; muted?: boolean;
  view?: InvoiceChipView;
  // a short word after the number, e.g. "原装" / "最新" when one invoice has two chips (the assistant's invoice card)
  suffix?: string;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fallback, setFallback] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  // Which request this chip sends is decided in lib/invoice-pdf-request.ts (pure, pinned by test-soa-invoice-chip.ts).
  const request = invoicePdfRequest({ company, id, lookupNo: invoiceNo ? displayInvoiceNo(invoiceNo) : null, docType, view });
  const clientView = request.client;
  if (!invoiceNo && !id) {
    return <span style={{ color: '#94a3b8', fontSize: 10, whiteSpace: 'nowrap' }}>No system invoice</span>;
  }
  const openPdf = async () => {
    if (status === 'loading') return;
    // Open the tab synchronously on the click, before the await below —
    // waiting for the fetch first loses the click's transient user
    // activation, so window.open() after an await gets silently
    // popup-blocked in Chrome.
    const tab = window.open('', '_blank');
    setStatus('loading');
    try {
      const res = await fetch(request.url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Unable to open ${company} ${docType === 'credit' ? 'credit note' : 'invoice'} ${invoiceNo ?? id}`);
      }
      const detail = clientView ? res.headers.get('X-Client-Invoice-Fallback') : null;
      let reason: string | null = null;
      if (detail) { try { reason = decodeURIComponent(detail); } catch { reason = detail; } }
      setFallback(reason);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url; else window.open(url, '_blank');
      setStatus('idle');
    } catch (err) {
      tab?.close();
      setErrorText(request.url.startsWith('/api/billing/invoice-original') && err instanceof Error ? err.message : null);
      setStatus('error');
      setTimeout(() => setStatus('idle'), request.url.startsWith('/api/billing/invoice-original') ? 7000 : 2500);
    }
  };
  return (
    <button type="button" onClick={openPdf} disabled={status === 'loading'}
      title={status === 'error' ? (errorText ? `No original to open: ${errorText}` : 'Could not open the PDF — click to retry')
        : fallback ? `Opened as QuickBooks' own PDF, which shows accounting's split lines — the client's copy could not be drawn: ${fallback}`
        : (title ?? (clientView ? 'Click to open the invoice as the client receives it' : 'Click to open the PDF'))}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, width: 'fit-content', maxWidth: '100%',
        padding: '2px 5px', borderRadius: 4,
        // White fill, not the original gray (#f2f6f8) — Vincent, right
        // after the border shipped: "轮廓是可以的，但是我希望按钮的灰色底
        // 变成白色底" (the outline is good, but wants the gray fill changed
        // to white) — matches the Source badges' own white fill exactly.
        // Error state's red tint is untouched — only the default fill
        // changed.
        background: status === 'error' ? '#fee2e2' : fallback ? '#fffbeb' : '#fff',
        color: status === 'error' ? '#b91c1c' : fallback ? '#92400e' : '#31506f',
        fontSize: 9, fontWeight: 700, lineHeight: 1.25, whiteSpace: 'nowrap',
        opacity: muted ? 0.72 : 1,
        // Visible border, 2026-09-23 — Vincent, after seeing the new
        // Source-badge outline on Company 360's Outstanding table: "那个按
        // 钮轮廓好看很多，能不能把INVOICE 的也设计成这种按钮UI轮廓，但是文字
        // 不变...这个要作用全部的页面，包括360/AR Billing Drafts" (that
        // button outline looks much better, apply the same look here too,
        // text unchanged, across every page). This is the ONE shared chip
        // component every one of those pages already renders (see this
        // file's own header comment), so a single change here reaches all
        // of them — no separate edit needed per page.
        border: `1px solid ${status === 'error' ? '#fca5a5' : fallback ? '#f59e0b' : '#b8c7d6'}`,
        cursor: status === 'loading' ? 'wait' : 'pointer',
        fontFamily: 'inherit',
      }}>
      {status === 'loading' && <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} />}
      {company} #{displayInvoiceNo(invoiceNo ?? id ?? '')}{suffix ? ` · ${suffix}` : ''}
    </button>
  );
}
