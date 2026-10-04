'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, UploadCloud, Loader2, CheckCircle2, AlertTriangle, Download,
  ExternalLink, Pencil, X, Check, Undo2,
} from 'lucide-react';
import type { TurnoverProjectDocument, TurnoverProjectLineItem } from '@/app/api/turnover-ai/projects/[id]/route';

// Turnover AI — a single project's own page: upload, review and running
// total all together (no more tab-switching — Vincent's original "一个页
// 面不要分散" philosophy, now applied per-project). Vincent, on raising the
// old 20-file cap: "我觉得可以提高到100个PDF的上限...如果超过100个PDF，员
// 工可以在同一个项目内进行导入其他的PDF" — 100 per selection, any number of
// rounds into the same project.
//
// UPDATED 2026-10-04 — Vincent, after seeing the Pending/Confirm review
// queue in use: "还是不需要 Peding 和 Confirm 就把他当成最简单的计算功能，
// 就是那些High / Medium 都只是给员工参考，如果高风险的他们自己会去查看原
// 始的账单，直接修改金额就好，不需要多一步 SAVE，或者confirm". Removed:
// the Pending/All status tab, the "Needs a glance" KPI card, Bulk-confirm,
// and the Confirm button. Confidence pills are now purely informational.
// Every table cell is directly editable and saves on blur — no edit mode,
// no Save button. The only review action left is Ignore (excludes a line
// from the total) and its undo, Restore.

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
type CurrencyTotal = { currency: string; total: number; count: number };

// Mirrors lib/turnover-ai.ts's computeCurrencyTotals + mergeCurrencyTotals
// (can't import that file directly — it's `server-only`). Lets an edit,
// ignore or restore update the totals card immediately instead of only on
// the next full page load, which matters now that there's no separate
// Confirm/Save step to visually mark "this is done" (Vincent: "直接修改金
// 额就好，不需要多一步 SAVE").
function recomputeTotals(lineItems: TurnoverProjectLineItem[], snapshot: CurrencyTotal[]): CurrencyTotal[] {
  const byCurrency = new Map<string, { total: number; count: number }>();
  for (const s of snapshot) byCurrency.set(s.currency, { total: s.total, count: s.count });
  for (const i of lineItems) {
    if (i.review_status === 'rejected') continue;
    const currency = i.edited_currency ?? i.currency ?? 'Unknown';
    const amount = Number(i.edited_amount ?? i.amount ?? 0);
    const entry = byCurrency.get(currency) ?? { total: 0, count: 0 };
    entry.total += amount;
    entry.count += 1;
    byCurrency.set(currency, entry);
  }
  return [...byCurrency.entries()].map(([currency, v]) => ({ currency, total: Math.round(v.total * 100) / 100, count: v.count }));
}

function money(n: number, currency: string | null) {
  return `${currency ?? ''} ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}
const pillStyle = { fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999 } as const;

function ConfidencePill({ c }: { c: 'high' | 'medium' | 'low' }) {
  const tone = c === 'high' ? { bg: '#dcfce7', fg: '#15803d', label: 'High' } : c === 'medium' ? { bg: '#fef3c7', fg: '#b45309', label: 'Medium' } : { bg: '#fee2e2', fg: '#b91c1c', label: 'Low' };
  return <span style={{ ...pillStyle, background: tone.bg, color: tone.fg }}>{tone.label}</span>;
}

// Every field saves on blur — no edit mode, no Save button (Vincent:
// "直接修改金额就好，不需要多一步 SAVE"). Local draft state exists only so
// typing doesn't fire a request per keystroke; the actual write happens
// once the field loses focus.
function cellInputStyle(extra?: object) {
  return {
    border: '1px solid transparent', borderRadius: 6, padding: '5px 7px', fontSize: 12.5,
    boxSizing: 'border-box' as const, width: '100%', background: 'transparent', font: 'inherit', color: 'inherit',
    ...extra,
  };
}

function LineItemRow({ item, gstEnabled, columns, busy, onPatch, onToggle }: {
  item: TurnoverProjectLineItem; gstEnabled: boolean; columns: string; busy: boolean;
  onPatch: (id: number, patch: { vendor: string; txnDate: string; amount: number; currency: string; gstAmount: number | null }) => void;
  onToggle: (item: TurnoverProjectLineItem) => void;
}) {
  const ignored = item.review_status === 'rejected';
  const [vendor, setVendor] = useState(item.edited_vendor_name ?? item.vendor_name ?? '');
  const [txnDate, setTxnDate] = useState(item.edited_txn_date ?? item.txn_date ?? '');
  const [amount, setAmount] = useState(String(item.edited_amount ?? item.amount ?? 0));
  const [currency, setCurrency] = useState(item.edited_currency ?? item.currency ?? '');
  const [gst, setGst] = useState(String(item.edited_gst_amount ?? item.gst_amount ?? ''));

  const save = () => onPatch(item.id, { vendor, txnDate, amount: Number(amount) || 0, currency, gstAmount: gst.trim() ? Number(gst) : null });
  const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); };
  const focusBorder = { onFocus: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = '#0f766e'; }, onBlurCapture: (e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = 'transparent'; } };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 10, alignItems: 'center', padding: '6px 16px', borderTop: '1px solid #f1f5f9', fontSize: 12.5, background: ignored ? '#f8fafc' : item.is_duplicate_suspect ? '#fffbeb' : undefined, opacity: ignored ? 0.6 : 1 }}>
      <div style={{ minWidth: 0 }}>
        <input value={vendor} onChange={e => setVendor(e.target.value)} onBlur={save} onKeyDown={commitOnEnter} disabled={ignored || busy} placeholder="(vendor not identified)"
          style={cellInputStyle({ fontWeight: 500, color: '#0f172a' })} {...focusBorder} />
        <div style={{ color: '#94a3b8', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 7px' }}>
          {item.file_name}
          {item.is_duplicate_suspect && ' · ⚠ possible duplicate'}
          {ignored && ' · ignored, not counted'}
        </div>
      </div>
      <input type="date" value={txnDate ?? ''} onChange={e => setTxnDate(e.target.value)} onBlur={save} disabled={ignored || busy} style={cellInputStyle({ color: '#475569' })} {...focusBorder} />
      <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} onBlur={save} onKeyDown={commitOnEnter} disabled={ignored || busy}
        style={cellInputStyle({ textAlign: 'right', fontFamily: 'monospace' })} {...focusBorder} />
      <input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} onBlur={save} onKeyDown={commitOnEnter} disabled={ignored || busy}
        style={cellInputStyle({ textTransform: 'uppercase' })} {...focusBorder} />
      {gstEnabled && (
        <input type="number" step="0.01" value={gst} onChange={e => setGst(e.target.value)} onBlur={save} onKeyDown={commitOnEnter} disabled={ignored || busy} placeholder="—"
          style={cellInputStyle({ textAlign: 'right', fontFamily: 'monospace', color: '#64748b' })} {...focusBorder} />
      )}
      <div><ConfidencePill c={item.confidence} /></div>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        <button onClick={() => onToggle(item)} disabled={busy} title={ignored ? 'Restore (counts it again)' : 'Ignore (excludes it from the total)'}
          style={{ border: 'none', background: 'none', color: ignored ? '#0f766e' : '#94a3b8', cursor: 'pointer', display: 'flex' }}>
          {ignored ? <Undo2 size={13} /> : <X size={13} />}
        </button>
        <a href={`/api/turnover-ai/file/${item.document_id}`} target="_blank" rel="noreferrer" title="View original" style={{ color: '#94a3b8', display: 'flex' }}><ExternalLink size={13} /></a>
      </div>
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
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

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
      setDetail(prev => {
        if (!prev) return prev;
        const lineItems = prev.lineItems.map(i => i.id === id ? json.lineItem : i);
        return { ...prev, lineItems, totals: recomputeTotals(lineItems, prev.project.confirmed_totals) };
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // Vincent: "文件夹名字可以随时更改的".
  const renameProject = async () => {
    const name = nameDraft.trim();
    if (!name || !detail) { setRenaming(false); return; }
    if (name === detail.project.name) { setRenaming(false); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/turnover-ai/projects/${projectId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Rename failed');
      setDetail(prev => prev ? { ...prev, project: { ...prev.project, name: json.project.name } } : prev);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setRenaming(false);
    }
  };

  const toggleIgnore = (item: TurnoverProjectLineItem) => patchItem(item.id, { action: item.review_status === 'rejected' ? 'restore' : 'reject' });

  if (loadError) return <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12 }}>{loadError}</div>;
  if (!detail) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>Loading…</div>;

  const items = detail.lineItems;
  const visible = confidenceFilter === 'all' ? items : items.filter(i => i.confidence === confidenceFilter);
  const active = items.filter(i => i.review_status !== 'rejected');
  const counts = {
    all: active.length,
    high: active.filter(i => i.confidence === 'high').length,
    medium: active.filter(i => i.confidence === 'medium').length,
    low: active.filter(i => i.confidence === 'low').length,
  };
  const rejectedCount = items.length - active.length;
  const columns = detail.project.gst_enabled ? '1.4fr 95px 100px 65px 80px 85px 90px' : '1.5fr 100px 110px 70px 90px 90px';

  return (
    <div>
      <Link href="/turnover-ai" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', textDecoration: 'none', marginBottom: 10 }}>
        <ArrowLeft size={13} />All projects
      </Link>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <div>
          {renaming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input autoFocus value={nameDraft} onChange={e => setNameDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') renameProject(); if (e.key === 'Escape') setRenaming(false); }}
                style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', border: '1px solid #0f766e', borderRadius: 6, padding: '2px 6px', outline: 'none' }} />
              <button onClick={renameProject} disabled={busy} title="Save" style={{ border: 'none', background: 'none', color: '#15803d', cursor: 'pointer', display: 'flex' }}><Check size={18} /></button>
              <button onClick={() => setRenaming(false)} title="Cancel" style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex' }}><X size={18} /></button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{detail.project.name}</h1>
              <button onClick={() => { setNameDraft(detail.project.name); setRenaming(true); }} title="Rename project"
                style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex' }}><Pencil size={14} /></button>
            </div>
          )}
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
          <div style={{ flex: 1, minWidth: 200, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px', color: '#94a3b8', fontSize: 12.5 }}>No receipts yet</div>
        )}
        {detail.totals.map(t => (
          <div key={t.currency} style={{ flex: 1, minWidth: 200, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>{t.currency} total</div>
            <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 700, color: '#0f172a' }}>{money(t.total, t.currency)}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{t.count} receipt{t.count === 1 ? '' : 's'}</div>
          </div>
        ))}
        {rejectedCount > 0 && (
          <div style={{ flex: 1, minWidth: 200, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 4 }}>Ignored</div>
            <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 700, color: '#94a3b8' }}>{rejectedCount}</div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>excluded from the total</div>
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
        {(['all', 'high', 'medium', 'low'] as const).map(c => (
          <button key={c} onClick={() => setConfidenceFilter(c)}
            style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: confidenceFilter === c ? '1px solid #0f172a' : '1px solid #e2e8f0', background: confidenceFilter === c ? '#f8fafc' : '#fff', color: '#475569' }}>
            {c === 'all' ? `All confidence ${counts.all}` : c === 'high' ? `🟢 High ${counts.high}` : c === 'medium' ? `🟡 Medium ${counts.medium}` : `🔴 Low ${counts.low}`}
          </button>
        ))}
      </div>

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: columns, gap: 10, padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#94a3b8', background: '#f8fafc' }}>
          <div>Vendor / Source file</div><div>Date</div><div style={{ textAlign: 'right' }}>Amount</div><div>Currency</div>
          {detail.project.gst_enabled && <div style={{ textAlign: 'right' }}>GST</div>}
          <div>Confidence</div><div style={{ textAlign: 'right' }}>Actions</div>
        </div>
        {visible.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>No matching records</div>}
        {visible.map(item => (
          <LineItemRow key={item.id} item={item} gstEnabled={detail.project.gst_enabled} columns={columns} busy={busy}
            onPatch={(id, patch) => patchItem(id, { action: 'edit', ...patch })} onToggle={toggleIgnore} />
        ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8' }}>
        {items.length} receipt{items.length === 1 ? '' : 's'} total{rejectedCount > 0 ? ` · ${rejectedCount} ignored (not counted)` : ''} · every receipt counts toward the total above the moment it{"'"}s read — edit any field directly, it saves right away · confidence is just a hint on where to double-check · originals and per-receipt detail are kept for 3 days, then cleared (the total stays).
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
