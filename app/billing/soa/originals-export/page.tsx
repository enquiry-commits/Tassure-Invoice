'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import {
  EXPORT_BOOKS, buildManifestCsv, buildMissingCsv, exportFileName, previousMonth, uniqueName, zipName,
  type ExportBook, type ExportInvoice, type ExportOutcome,
} from '@/lib/originals-export';

// Billing System › Outstanding › Monthly Originals Export (Vincent, 2026-10-08, INV-QB-040). The boss wants the ORIGINAL
// invoices of each month kept outside QuickBooks too: pick a month, download one ZIP per book (TAB / TAC / TAO); Chelsea
// files the PDFs on the file server. The ZIP is built HERE, in the browser, one invoice at a time from
// /api/billing/invoice-original — no month-sized file ever passes through the server, and nothing is stored in the
// cloud. An invoice with no proven original is NOT replaced by a redraw: it is listed in MISSING.csv.
// Sits under /billing/soa so the existing Outstanding page rule applies; the API itself is Vincent + Chelsea only.

type Exported = { qb_company: ExportBook; invoice_count: number; missing_count: number; exported_by_email: string | null; exported_at: string };
type Listing = { month: string; invoices: ExportInvoice[]; exported: Exported[]; recordReady: boolean };
type Progress = { book: ExportBook; done: number; total: number; note?: string } | null;
type Summary = { book: ExportBook; total: number; included: number; missing: ExportOutcome[]; failed: number };

const NAVY = '#1d3a5c';
const CONCURRENCY = 3;
const RETRY_MARK = '— retry the export';

async function fetchOriginal(inv: ExportInvoice): Promise<{ bytes: ArrayBuffer; source: 'quickbooks' | 'attachment' } | { reason: string; transient: boolean }> {
  try {
    const res = await fetch(`/api/billing/invoice-original?company=${inv.book}&id=${encodeURIComponent(inv.qbInvoiceId)}`);
    if (res.ok) return { bytes: await res.arrayBuffer(), source: res.headers.get('X-Invoice-Original-Source') === 'attachment' ? 'attachment' : 'quickbooks' };
    const json = await res.json().catch(() => ({} as { error?: string }));
    return { reason: (json as { error?: string }).error ?? `HTTP ${res.status}`, transient: res.status !== 404 };
  } catch (err) {
    return { reason: err instanceof Error ? err.message : 'network error', transient: true };
  }
}

export default function OriginalsExportPage() {
  const [month, setMonth] = useState(() => previousMonth(new Date().toISOString().slice(0, 10)));
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    fetch(`/api/billing/originals-export?month=${month}`, { cache: 'no-store' })
      .then(async res => { const json = await res.json(); if (!res.ok) throw new Error(json.error ?? 'Failed to load'); setListing(json as Listing); })
      .catch(err => { setListing(null); setError(err instanceof Error ? err.message : String(err)); })
      .finally(() => setLoading(false));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const byBook = useMemo(() => {
    const map = new Map<ExportBook, ExportInvoice[]>(EXPORT_BOOKS.map(b => [b, []]));
    for (const inv of listing?.invoices ?? []) map.get(inv.book)?.push(inv);
    return map;
  }, [listing]);

  const build = async (book: ExportBook) => {
    const invoices = byBook.get(book) ?? [];
    if (!invoices.length || progress) return;
    setSummary(null); setError(null); setProgress({ book, done: 0, total: invoices.length });
    const outcomes: ExportOutcome[] = new Array(invoices.length);
    const files = new Map<number, ArrayBuffer>();
    let next = 0, done = 0;
    const worker = async () => {
      while (next < invoices.length) {
        const i = next++;
        const inv = invoices[i];
        const result = await fetchOriginal(inv);
        if ('bytes' in result) { files.set(i, result.bytes); outcomes[i] = { ...inv, source: result.source, reason: null, fileName: null }; }
        else outcomes[i] = { ...inv, source: null, reason: result.transient ? `could not be loaded (${result.reason}) ${RETRY_MARK}` : result.reason, fileName: null };
        setProgress({ book, done: ++done, total: invoices.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, invoices.length) }, worker));

    // QuickBooks sometimes times out; the server then stops asking it for a minute or two, so a quick retry would fail
    // the same way. Retry the failed ones one by one, after a pause, for up to 3 rounds — a failure is never "missing".
    for (let round = 1; round <= 3; round++) {
      const failedIdx = outcomes.map((o, i) => (!o.source && o.reason?.includes(RETRY_MARK) ? i : -1)).filter(i => i >= 0);
      if (!failedIdx.length) break;
      setProgress({ book, done: invoices.length - failedIdx.length, total: invoices.length, note: `retrying ${failedIdx.length} after a QuickBooks hiccup (round ${round}/3)…` });
      await new Promise(resolve => setTimeout(resolve, 20_000));
      for (const i of failedIdx) {
        const retry = await fetchOriginal(invoices[i]);
        if ('bytes' in retry) { files.set(i, retry.bytes); outcomes[i] = { ...invoices[i], source: retry.source, reason: null, fileName: null }; }
        else outcomes[i] = { ...invoices[i], source: null, reason: retry.transient ? `could not be loaded (${retry.reason}) ${RETRY_MARK}` : retry.reason, fileName: null };
      }
    }

    const zip = new JSZip();
    const used = new Set<string>(['manifest.csv', 'missing.csv']);
    outcomes.forEach((o, i) => {
      if (!o.source) return;
      o.fileName = uniqueName(exportFileName(o), used);
      zip.file(o.fileName, files.get(i)!);
    });
    zip.file('manifest.csv', buildManifestCsv(outcomes));
    const missing = outcomes.filter(o => !o.source);
    if (missing.length) zip.file('MISSING.csv', buildMissingCsv(outcomes));
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = zipName(book, month);
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 8000);

    const failed = missing.filter(o => o.reason?.includes(RETRY_MARK)).length;
    setSummary({ book, total: invoices.length, included: invoices.length - missing.length, missing, failed });
    setProgress(null);
    // Record it (the My Tasks reminder stops) — but not when some invoices failed to LOAD: that ZIP is incomplete.
    if (!failed) {
      fetch('/api/billing/originals-export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, book, invoiceCount: invoices.length, missingCount: missing.length }),
      }).then(res => { if (res.ok) load(); }).catch(() => {});
    }
  };

  const busy = progress !== null;
  return (
    <div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 12, fontSize: 12, lineHeight: 1.65, color: '#475569' }}>
        <strong style={{ color: '#1e3a5f' }}>Monthly originals export.</strong>{' '}
        Pick a month: each book (TAB / TAC / TAO) gets one ZIP of the <strong>original</strong> PDFs of every invoice dated in that month (voided ones included, marked VOID; credit notes are not).
        The ZIP is built on your computer — keep this page open until it downloads. Invoices whose original cannot be proven are <strong>not</strong> replaced by a redraw: they are listed in <strong>MISSING.csv</strong> for you to take from the file server.
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Month{' '}
          <input type="month" value={month} disabled={busy} onChange={e => e.target.value && setMonth(e.target.value)}
            style={{ border: '1px solid #cbd5e1', borderRadius: 7, padding: '5px 9px', fontSize: 13, marginLeft: 6 }} />
        </label>
        <button onClick={load} disabled={busy || loading} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', borderRadius: 7, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: busy ? 'default' : 'pointer' }}>
          <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : undefined} />Reload
        </button>
      </div>

      {error && <div style={{ background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{error}</div>}
      {listing && !listing.recordReady && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', color: '#92400e', fontSize: 12, marginBottom: 12 }}>
          The export record needs one setup step: run <code>scripts/add-originals-exports.sql</code> in the Supabase SQL editor. Until then the ZIPs still download, but My Tasks cannot tell they were made.
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
        {EXPORT_BOOKS.map(book => {
          const invoices = byBook.get(book) ?? [];
          const voided = invoices.filter(i => i.status === 'Voided').length;
          const rec = listing?.exported.find(r => r.qb_company === book);
          const mine = progress?.book === book ? progress : null;
          return (
            <div key={book} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 700, color: NAVY }}>{book}</span>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{listing ? invoices.length : '…'}</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>invoices{voided ? ` (${voided} voided)` : ''}</span>
              </div>
              <div style={{ fontSize: 11, color: rec ? '#15803d' : '#94a3b8', margin: '6px 0 10px', minHeight: 30, lineHeight: 1.5 }}>
                {rec
                  ? <><CheckCircle2 size={11} style={{ verticalAlign: -1 }} /> Exported {new Date(rec.exported_at).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' })} by {(rec.exported_by_email ?? '').split('@')[0]} — {rec.invoice_count} invoices{rec.missing_count ? `, ${rec.missing_count} without an original` : ''}</>
                  : 'Not exported yet for this month.'}
              </div>
              <button onClick={() => build(book)} disabled={busy || !invoices.length}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center', border: 'none', background: NAVY, color: '#fff', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, fontWeight: 700, cursor: busy || !invoices.length ? 'default' : 'pointer', opacity: busy || !invoices.length ? 0.55 : 1 }}>
                {mine ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
                {mine ? (mine.note ?? `Collecting ${mine.done} / ${mine.total}…`) : `Download ${book} ZIP`}
              </button>
            </div>
          );
        })}
      </div>

      {summary && (
        <div style={{ background: summary.failed ? '#fffbeb' : '#f0fdf4', border: `1px solid ${summary.failed ? '#fde68a' : '#bbf7d0'}`, borderRadius: 10, padding: '10px 14px', fontSize: 12, lineHeight: 1.7, color: summary.failed ? '#92400e' : '#166534' }}>
          <div style={{ fontWeight: 700 }}>
            {summary.book}: {summary.included} of {summary.total} originals are in the ZIP{summary.missing.length ? `; ${summary.missing.length} are not (see MISSING.csv inside it).` : '.'}
          </div>
          {summary.failed > 0 && (
            <div><AlertTriangle size={12} style={{ verticalAlign: -1 }} /> {summary.failed} could not be loaded just now (QuickBooks hiccup) — this export was NOT recorded as done. Download it again.</div>
          )}
          {summary.missing.slice(0, 12).map(m => (
            <div key={`${m.book}|${m.qbInvoiceId}`} style={{ color: '#475569' }}>• {m.invoiceNo} — {m.customerName}: {m.reason}</div>
          ))}
          {summary.missing.length > 12 && <div style={{ color: '#64748b' }}>…and {summary.missing.length - 12} more in MISSING.csv</div>}
        </div>
      )}
    </div>
  );
}
