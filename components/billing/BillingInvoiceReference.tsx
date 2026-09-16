'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { displayInvoiceNo } from './ExpandedBillingRow';
import type { QbCompany } from '@/lib/quickbooks';

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
 */
export function BillingInvoiceReference({ company, invoiceNo, id, docType = 'invoice', title, muted = false }: {
  company: QbCompany; invoiceNo?: string | null; id?: string | null; docType?: 'invoice' | 'credit'; title?: string; muted?: boolean;
}) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
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
      const params = new URLSearchParams({ company });
      if (id) params.set('id', id); else params.set('invoiceNo', displayInvoiceNo(invoiceNo));
      if (docType === 'credit') params.set('docType', 'creditmemo');
      const res = await fetch(`/api/quickbooks/invoice-pdf?${params.toString()}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Unable to open ${company} ${docType === 'credit' ? 'credit note' : 'invoice'} ${invoiceNo ?? id}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url; else window.open(url, '_blank');
      setStatus('idle');
    } catch {
      tab?.close();
      setStatus('error');
      setTimeout(() => setStatus('idle'), 2500);
    }
  };
  return (
    <button type="button" onClick={openPdf} disabled={status === 'loading'}
      title={status === 'error' ? 'Could not open the PDF — click to retry' : (title ?? 'Click to open the PDF')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, width: 'fit-content', maxWidth: '100%',
        padding: '2px 5px', borderRadius: 4,
        background: status === 'error' ? '#fee2e2' : '#f2f6f8',
        color: status === 'error' ? '#b91c1c' : '#31506f',
        fontSize: 9.5, fontWeight: 800, lineHeight: 1.25, whiteSpace: 'nowrap',
        opacity: muted ? 0.72 : 1, border: 'none', cursor: status === 'loading' ? 'wait' : 'pointer',
        fontFamily: 'inherit',
      }}>
      {status === 'loading' && <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} />}
      {company} #{displayInvoiceNo(invoiceNo ?? id ?? '')}
    </button>
  );
}
