'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud, FileText, Loader2, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { ClientPicker, type ClientSelection } from '@/components/turnover-ai/ClientPicker';
import type { TurnoverDocument } from '@/app/api/turnover-ai/documents/route';

// Upload receipts/invoices for one client — Claude vision (lib/turnover-ai.ts)
// splits each file into its individual receipts. Nothing here is final:
// everything lands as review_status='unconfirmed' and must be confirmed on
// the Review Queue tab before it counts toward the client's turnover total.

type UploadRow = { fileName: string; status: 'uploading' | 'done' | 'error'; message?: string; lineItemCount?: number; unconfirmedCount?: number };

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic';

function StatusBadge({ status }: { status: TurnoverDocument['status'] }) {
  if (status === 'processing') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: '#f1f5f9', color: '#475569' }}><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />Processing</span>;
  if (status === 'failed') return <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c' }}>Failed</span>;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: '#dcfce7', color: '#15803d' }}>Done</span>;
}

export function InboxSection({ onGoToReview }: { onGoToReview: () => void }) {
  const [client, setClient] = useState<ClientSelection>({ companyId: null, name: '' });
  const [periodLabel, setPeriodLabel] = useState('');
  const [documents, setDocuments] = useState<TurnoverDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(() => {
    fetch('/api/turnover-ai/documents')
      .then(async res => { const j = await res.json(); if (!res.ok) throw new Error(j.error ?? 'Failed to load'); return j; })
      .then(j => { setDocuments(j.documents ?? []); setLoadError(null); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { loadDocuments(); }, [loadDocuments]);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    if (!client.name.trim()) { alert('Please select or enter a client name first.'); return; }
    setUploads(prev => [...list.map(f => ({ fileName: f.name, status: 'uploading' as const })), ...prev]);

    for (const file of list) {
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('clientName', client.name.trim());
        if (client.companyId) form.append('clientCompanyId', String(client.companyId));
        if (periodLabel.trim()) form.append('periodLabel', periodLabel.trim());
        const res = await fetch('/api/turnover-ai/extract', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Extraction failed');
        const items = (json.lineItems ?? []) as { review_status: string }[];
        setUploads(prev => prev.map(u => u.fileName === file.name && u.status === 'uploading'
          ? { ...u, status: 'done', lineItemCount: items.length, unconfirmedCount: items.filter(i => i.review_status === 'unconfirmed').length }
          : u));
      } catch (err) {
        setUploads(prev => prev.map(u => u.fileName === file.name && u.status === 'uploading'
          ? { ...u, status: 'error', message: err instanceof Error ? err.message : String(err) }
          : u));
      }
      loadDocuments();
    }
  }, [client, periodLabel, loadDocuments]);

  const totals = (documents ?? []).reduce((acc, d) => ({
    lineItems: acc.lineItems + d.lineItemCount,
    unconfirmed: acc.unconfirmed + d.unconfirmedCount,
  }), { lineItems: 0, unconfirmed: 0 });

  return (
    <div>
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#64748b', maxWidth: 640, lineHeight: 1.6 }}>
        Upload a client&apos;s receipts, invoices or card slips — AI automatically reads the vendor, date and amount, and splits a file containing several receipts into separate entries. Nothing counts toward the turnover total until it&apos;s confirmed on the Review Queue tab.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <ClientPicker value={client} onChange={setClient} />
        <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} placeholder="Period (optional, e.g. Aug 2026)"
          style={{ border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 10px', fontSize: 12.5, width: 200 }} />
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        style={{ border: `1.5px dashed ${dragOver ? '#0f766e' : '#cbd5e1'}`, borderRadius: 14, background: dragOver ? '#f0fdfa' : '#ffffff', padding: 28, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, textAlign: 'center', cursor: 'pointer', marginBottom: 18 }}
      >
        <UploadCloud size={24} color="#94a3b8" />
        <div style={{ fontSize: 13.5, color: '#334155', fontWeight: 600 }}>Drag files here, or click to select</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>Supports PDF, JPG, PNG, HEIC (including phone screenshots) — up to 20 files at once</div>
        <input ref={fileInputRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }}
          onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {uploads.length > 0 && (
        <div style={{ marginBottom: 18, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
          {uploads.map((u, i) => (
            <div key={`${u.fileName}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: i < uploads.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize: 12.5 }}>
              {u.status === 'uploading' && <Loader2 size={15} color="#94a3b8" style={{ animation: 'spin 1s linear infinite' }} />}
              {u.status === 'done' && <CheckCircle2 size={15} color="#15803d" />}
              {u.status === 'error' && <AlertTriangle size={15} color="#b91c1c" />}
              <span style={{ flexGrow: 1, color: '#0f172a', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.fileName}</span>
              <span style={{ color: u.status === 'error' ? '#b91c1c' : '#64748b', fontSize: 11.5 }}>
                {u.status === 'uploading' && 'AI reading…'}
                {u.status === 'done' && `Found ${u.lineItemCount} receipt${u.lineItemCount === 1 ? '' : 's'}${u.unconfirmedCount ? ` · ${u.unconfirmedCount} pending review` : ''}`}
                {u.status === 'error' && u.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {loadError && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, marginBottom: 14 }}>{loadError}</div>
      )}

      <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700, marginBottom: 8 }}>Recent uploads</div>
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden', marginBottom: 18 }}>
        {documents === null && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>Loading…</div>}
        {documents !== null && documents.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>No documents uploaded yet</div>}
        {(documents ?? []).map((d, i) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderBottom: i < (documents?.length ?? 0) - 1 ? '1px solid #f1f5f9' : 'none' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FileText size={14} color="#dc2626" />
            </div>
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: '#0f172a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {d.client_name}{d.period_label ? ` · ${d.period_label}` : ''}
                {d.status === 'done' && ` · Found ${d.lineItemCount} receipt${d.lineItemCount === 1 ? '' : 's'}${d.unconfirmedCount ? ` · ${d.unconfirmedCount} pending review` : ''}`}
                {d.status === 'failed' && d.error_message ? ` · ${d.error_message}` : ''}
              </div>
            </div>
            <StatusBadge status={d.status} />
          </div>
        ))}
      </div>

      {(totals.lineItems > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 12, padding: '14px 20px' }}>
          <div style={{ fontSize: 13, color: '#0f172a' }}>
            <b>{totals.lineItems}</b> receipt{totals.lineItems === 1 ? '' : 's'} found · <b style={{ color: '#b45309' }}>{totals.unconfirmed}</b> pending review
          </div>
          <div style={{ flexGrow: 1 }} />
          <button onClick={onGoToReview} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0f766e', color: '#fff', fontWeight: 700, fontSize: 13, padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>
            Go to Review Queue<ArrowRight size={14} />
          </button>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
