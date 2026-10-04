'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, UploadCloud, Loader2, CheckCircle2, AlertTriangle, Download,
  ExternalLink, Pencil, X,
} from 'lucide-react';
import type { TurnoverProjectDocument, TurnoverProjectLineItem } from '@/app/api/turnover-ai/projects/[id]/route';

// Turnover AI — a single project's own page: upload, review and running
// total all together (no more tab-switching — Vincent's original "一个页
// 面不要分散" philosophy, now applied per-project). Vincent, on raising the
// old 20-file cap: "我觉得可以提高到100个PDF的上限...如果超过100个PDF，员
// 工可以在同一个项目内进行导入其他的PDF" — 100 per selection, any number of
// rounds into the same project.

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic';
const MAX_FILES_PER_BATCH = 100;

type ProjectDetail = {
  project: { id: number; name: string; gst_enabled: boolean; created_at: string; confirmed_totals: { currency: string; total: number; count: number }[] };
  documents: TurnoverProjectDocument[];
  lineItems: TurnoverProjectLineItem[];
  pendingCount: number;
  totals: { currency: string; total: number; count: number }[];
};

type UploadRow = { fileName: string; status: 'uploading' | 'done' | 'error'; message?: string; lineItemCount?: number };
type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low';

function money(n: number, currency: string | null) {
  return `${currency ?? ''} ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}
const pillStyle = { fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999 } as const;

function ConfidencePill({ c }: { c: 'high' | 'medium' | 'low' }) {
  const tone = c === 'high' ? { bg: '#dcfce7', fg: '#15803d', label: 'High' } : c === 'medium' ? { bg: '#fef3c7', fg: '#b45309', label: 'Medium' } : { bg: '#fee2e2', fg: '#b91c1c', label: 'Low' };
  return <span style={{ ...pillStyle, background: tone.bg, color: tone.fg }}>{tone.label}</span>;
}

function EditRow({ item, gstEnabled, onSave, onCancel }: {
  item: TurnoverProjectLineItem; gstEnabled: boolean;
  onSave: (patch: { vendor: string; txnDate: string; amount: number; currency: string; gstAmount: number | null }) => void;
  onCancel: () => void;
}) {
  const [vendor, setVendor] = useState(item.edited_vendor_name ?? item.vendor_name ?? '');
  const [txnDate, setTxnDate] = useState(item.edited_txn_date ?? item.txn_date ?? '');
  const [amount, setAmount] = useState(String(item.edited_amount ?? item.amount ?? 0));
  const [currency, setCurrency] = useState(item.edited_currency ?? item.currency ?? '');
  const [gst, setGst] = useState(String(item.edited_gst_amount ?? item.gst_amount ?? ''));
  const inputStyle = { border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 7px', fontSize: 12, boxSizing: 'border-box' as const };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fffbeb', flexWrap: 'wrap' }}>
      <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor" style={{ ...inputStyle, flex: '1 1 180px' }} />
      <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} style={{ ...inputStyle, width: 140 }} />
      <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inputStyle, width: 100, textAlign: 'right' }} />
      <input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} placeholder="Currency" style={{ ...inputStyle, width: 70 }} />
      {gstEnabled && <input type="number" step="0.01" value={gst} onChange={e => setGst(e.target.value)} placeholder="GST" style={{ ...inputStyle, width: 80, textAlign: 'right' }} />}
      <button onClick={() => onSave({ vendor, txnDate, amount: Number(amount) || 0, currency, gstAmount: gst.trim() ? Number(gst) : null })}
        style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#0f766e', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Save</button>
      <button onClick={onCancel} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 11.5, cursor: 'pointer' }}>Cancel</button>
    </div>
  );
}

export default function TurnoverProjectPage() {
  const params = useParams();
  const projectId = Number(params.id);

  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'unconfirmed' | 'all'>('unconfirmed');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch(`/api/turnover-ai/projects/${projectId}`)
      .then(async res => { const j = await res.json(); if (!res.ok) throw new Error(j.error ?? 'Failed to load'); return j; })
      .then(j => { setDetail(j); setLoadError(null); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    let list = Array.from(files);
    if (list.length > MAX_FILES_PER_BATCH) {
      alert(`You selected ${list.length} files — uploading the first ${MAX_FILES_PER_BATCH}. Select the rest in another round once this one finishes.`);
      list = list.slice(0, MAX_FILES_PER_BATCH);
    }
    if (!list.length) return;
    setUploads(prev => [...list.map(f => ({ fileName: f.name, status: 'uploading' as const })), ...prev]);

    for (const file of list) {
      try {
        const form = new FormData();
        form.append('file', file);
        form.append('projectId', String(projectId));
        const res = await fetch('/api/turnover-ai/extract', { method: 'POST', body: form });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Extraction failed');
        const items = (json.lineItems ?? []) as unknown[];
        setUploads(prev => prev.map(u => u.fileName === file.name && u.status === 'uploading' ? { ...u, status: 'done', lineItemCount: items.length } : u));
      } catch (err) {
        setUploads(prev => prev.map(u => u.fileName === file.name && u.status === 'uploading' ? { ...u, status: 'error', message: err instanceof Error ? err.message : String(err) } : u));
      }
      load();
    }
  }, [projectId, load]);

  const patchItem = async (id: number, body: object) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/turnover-ai/line-items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Update failed');
      setDetail(prev => prev ? { ...prev, lineItems: prev.lineItems.map(i => i.id === id ? json.lineItem : i) } : prev);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const bulkConfirmHigh = async () => {
    const ids = (detail?.lineItems ?? []).filter(i => i.review_status === 'unconfirmed' && i.confidence === 'high').map(i => i.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      const res = await fetch('/api/turnover-ai/line-items/bulk-confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Bulk confirm failed');
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loadError) return <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>{loadError}</div>;
  if (!detail) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>Loading…</div>;

  const items = detail.lineItems;
  let visible = items;
  if (statusFilter === 'unconfirmed') visible = visible.filter(i => i.review_status === 'unconfirmed');
  if (confidenceFilter !== 'all') visible = visible.filter(i => i.confidence === confidenceFilter);
  const unconfirmed = items.filter(i => i.review_status === 'unconfirmed');
  const counts = {
    all: unconfirmed.length,
    high: unconfirmed.filter(i => i.confidence === 'high').length,
    medium: unconfirmed.filter(i => i.confidence === 'medium').length,
    low: unconfirmed.filter(i => i.confidence === 'low').length,
  };
  const confirmedTotal = items.filter(i => i.review_status === 'confirmed').length;
  const columns = detail.project.gst_enabled ? '1.5fr 85px 100px 80px 70px 85px 120px' : '1.6fr 90px 110px 70px 90px 130px';

  return (
    <div>
      <Link href="/turnover-ai" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', textDecoration: 'none', marginBottom: 10 }}>
        <ArrowLeft size={13} />All projects
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{detail.project.name}</h1>
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2 }}>
            Created {new Date(detail.project.created_at).toLocaleDateString('en-SG')}{detail.project.gst_enabled && ' · GST calculated separately'}
          </div>
        </div>
        {detail.totals.length > 0 && (
          <a href={`/api/turnover-ai/export?projectId=${projectId}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, background: '#0f766e', color: '#fff', textDecoration: 'none' }}>
            <Download size={14} />Export Excel
          </a>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
        {detail.totals.length === 0 && (
          <div style={{ flex: 1, minWidth: 200, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px', color: '#94a3b8', fontSize: 12.5 }}>No confirmed receipts yet</div>
        )}
        {detail.totals.map(t => (
          <div key={t.currency} style={{ flex: 1, minWidth: 200, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>{t.currency} total (confirmed)</div>
            <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{money(t.total, t.currency)}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{t.count} receipt{t.count === 1 ? '' : 's'}</div>
          </div>
        ))}
        {detail.pendingCount > 0 && (
          <div style={{ flex: 1, minWidth: 200, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, color: '#b45309', fontWeight: 600, marginBottom: 4 }}>Pending review</div>
            <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 700, color: '#b45309' }}>{detail.pendingCount}</div>
          </div>
        )}
      </div>

      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) uploadFiles(e.dataTransfer.files); }}
        onClick={() => fileInputRef.current?.click()}
        style={{ border: `1.5px dashed ${dragOver ? '#0f766e' : '#cbd5e1'}`, borderRadius: 14, background: dragOver ? '#f0fdfa' : '#ffffff', padding: 24, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, textAlign: 'center', cursor: 'pointer', marginBottom: 18 }}
      >
        <UploadCloud size={22} color="#94a3b8" />
        <div style={{ fontSize: 13, color: '#334155', fontWeight: 600 }}>Drag files here, or click to select</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>PDF, JPG, PNG, HEIC — up to {MAX_FILES_PER_BATCH} at once; add more rounds into this same project anytime</div>
        <input ref={fileInputRef} type="file" multiple accept={ACCEPT} style={{ display: 'none' }}
          onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }} />
      </div>

      {uploads.length > 0 && (
        <div style={{ marginBottom: 18, border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden', maxHeight: 220, overflowY: 'auto' }}>
          {uploads.map((u, i) => (
            <div key={`${u.fileName}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', borderBottom: i < uploads.length - 1 ? '1px solid #f1f5f9' : 'none', fontSize: 12.5 }}>
              {u.status === 'uploading' && <Loader2 size={14} color="#94a3b8" style={{ animation: 'spin 1s linear infinite' }} />}
              {u.status === 'done' && <CheckCircle2 size={14} color="#15803d" />}
              {u.status === 'error' && <AlertTriangle size={14} color="#b91c1c" />}
              <span style={{ flexGrow: 1, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.fileName}</span>
              <span style={{ color: u.status === 'error' ? '#b91c1c' : '#64748b', fontSize: 11 }}>
                {u.status === 'uploading' && 'Reading…'}
                {u.status === 'done' && `${u.lineItemCount} found`}
                {u.status === 'error' && u.message}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['unconfirmed', 'all'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: statusFilter === s ? 'none' : '1px solid #e2e8f0', background: statusFilter === s ? '#0f172a' : '#fff', color: statusFilter === s ? '#fff' : '#475569' }}>
            {s === 'unconfirmed' ? `Pending review ${counts.all}` : 'All records'}
          </button>
        ))}
        <span style={{ width: 1, height: 18, background: '#e2e8f0', margin: '0 4px' }} />
        {(['all', 'high', 'medium', 'low'] as const).map(c => (
          <button key={c} onClick={() => setConfidenceFilter(c)}
            style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: confidenceFilter === c ? '1px solid #0f172a' : '1px solid #e2e8f0', background: confidenceFilter === c ? '#f8fafc' : '#fff', color: '#475569' }}>
            {c === 'all' ? 'All confidence' : c === 'high' ? `🟢 High ${counts.high}` : c === 'medium' ? `🟡 Medium ${counts.medium}` : `🔴 Low ${counts.low}`}
          </button>
        ))}
        <div style={{ flexGrow: 1 }} />
        <button onClick={bulkConfirmHigh} disabled={busy || counts.high === 0}
          style={{ height: 32, padding: '0 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none', cursor: counts.high === 0 ? 'default' : 'pointer', background: counts.high === 0 ? '#cbd5e1' : '#0f766e', color: '#fff' }}>
          Bulk confirm high confidence ({counts.high})
        </button>
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 10, padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#94a3b8', background: '#f8fafc' }}>
          <div>Vendor / Source file</div><div>Date</div><div style={{ textAlign: 'right' }}>Amount</div>
          {detail.project.gst_enabled && <div style={{ textAlign: 'right' }}>GST</div>}
          <div>Confidence</div><div>Status</div><div style={{ textAlign: 'right' }}>Actions</div>
        </div>
        {visible.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>No matching records</div>}
        {visible.map(item => (
          editingId === item.id ? (
            <EditRow key={item.id} item={item} gstEnabled={detail.project.gst_enabled}
              onSave={patch => { patchItem(item.id, { action: 'edit', ...patch }); setEditingId(null); }}
              onCancel={() => setEditingId(null)} />
          ) : (
            <div key={item.id} style={{ display: 'grid', gridTemplateColumns: columns, gap: 10, alignItems: 'center', padding: '10px 16px', borderTop: '1px solid #f1f5f9', fontSize: 12.5, background: item.is_duplicate_suspect ? '#fffbeb' : undefined }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#0f172a', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.edited_vendor_name ?? item.vendor_name ?? '(vendor not identified)'}</div>
                <div style={{ color: '#94a3b8', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.file_name}
                  {item.is_duplicate_suspect && ' · ⚠ possible duplicate'}
                  {item.confidence_reason && item.confidence !== 'high' && ` · ${item.confidence_reason}`}
                </div>
              </div>
              <div style={{ color: '#475569' }}>{item.edited_txn_date ?? item.txn_date ?? '—'}</div>
              <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>{money(item.edited_amount ?? item.amount, item.edited_currency ?? item.currency)}</div>
              {detail.project.gst_enabled && (
                <div style={{ textAlign: 'right', fontFamily: 'monospace', color: '#64748b' }}>{(item.edited_gst_amount ?? item.gst_amount) != null ? (item.edited_gst_amount ?? item.gst_amount) : '—'}</div>
              )}
              <div><ConfidencePill c={item.confidence} /></div>
              <div>
                {item.review_status === 'confirmed' && <span style={{ ...pillStyle, background: '#f1f5f9', color: '#475569' }}>Confirmed</span>}
                {item.review_status === 'unconfirmed' && <span style={{ ...pillStyle, background: '#fef3c7', color: '#b45309' }}>Pending</span>}
                {item.review_status === 'rejected' && <span style={{ ...pillStyle, background: '#f1f5f9', color: '#94a3b8' }}>Ignored</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {item.review_status === 'unconfirmed' && (
                  <>
                    <button onClick={() => patchItem(item.id, { action: 'confirm' })} disabled={busy} title="Confirm" style={{ border: 'none', background: 'none', color: '#15803d', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Confirm</button>
                    <button onClick={() => setEditingId(item.id)} title="Edit" style={{ border: 'none', background: 'none', color: '#0f766e', cursor: 'pointer', display: 'flex' }}><Pencil size={13} /></button>
                    <button onClick={() => patchItem(item.id, { action: 'reject' })} disabled={busy} title="Ignore" style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
                  </>
                )}
                <a href={`/api/turnover-ai/file/${item.document_id}`} target="_blank" rel="noreferrer" title="View original" style={{ color: '#94a3b8', display: 'flex' }}><ExternalLink size={13} /></a>
              </div>
            </div>
          )
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8' }}>
        {items.length} receipt{items.length === 1 ? '' : 's'} total · {confirmedTotal} confirmed · originals and per-receipt detail are kept for 3 days, then cleared (the total above stays).
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
