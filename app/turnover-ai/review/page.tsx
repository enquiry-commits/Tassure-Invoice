'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, Loader2, Pencil, X } from 'lucide-react';
import type { TurnoverLineItem } from '@/app/api/turnover-ai/line-items/route';

// Turnover AI › Review Queue. Every extracted receipt across every upload,
// filterable by confidence and by client. Confirm/reject/edit here is the
// ONLY thing that makes a receipt count toward a client's turnover total
// (see app/api/turnover-ai/summary/route.ts, which only sums 'confirmed').

type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low';

function money(n: number, currency: string | null) {
  return `${currency ?? ''} ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

const pillStyle = { fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999 } as const;

function ConfidencePill({ c }: { c: 'high' | 'medium' | 'low' }) {
  const tone = c === 'high' ? { bg: '#dcfce7', fg: '#15803d', label: '高' } : c === 'medium' ? { bg: '#fef3c7', fg: '#b45309', label: '中' } : { bg: '#fee2e2', fg: '#b91c1c', label: '低' };
  return <span style={{ ...pillStyle, background: tone.bg, color: tone.fg }}>{tone.label}</span>;
}

function EditRow({ item, onSave, onCancel }: { item: TurnoverLineItem; onSave: (patch: { vendor: string; txnDate: string; amount: number; currency: string }) => void; onCancel: () => void }) {
  const [vendor, setVendor] = useState(item.edited_vendor_name ?? item.vendor_name ?? '');
  const [txnDate, setTxnDate] = useState(item.edited_txn_date ?? item.txn_date ?? '');
  const [amount, setAmount] = useState(String(item.edited_amount ?? item.amount ?? 0));
  const [currency, setCurrency] = useState(item.edited_currency ?? item.currency ?? '');
  const inputStyle = { border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 7px', fontSize: 12, boxSizing: 'border-box' as const };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fffbeb', flexWrap: 'wrap' }}>
      <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="商家" style={{ ...inputStyle, flex: '1 1 200px' }} />
      <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} style={{ ...inputStyle, width: 140 }} />
      <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inputStyle, width: 100, textAlign: 'right' }} />
      <input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} placeholder="币种" style={{ ...inputStyle, width: 70 }} />
      <button onClick={() => onSave({ vendor, txnDate, amount: Number(amount) || 0, currency })}
        style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#0f766e', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>保存</button>
      <button onClick={onCancel} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 11.5, cursor: 'pointer' }}>取消</button>
    </div>
  );
}

export default function TurnoverReviewPage() {
  const [items, setItems] = useState<TurnoverLineItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'unconfirmed' | 'all'>('unconfirmed');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Always fetches every status — statusFilter/confidenceFilter narrow the
  // already-loaded list client-side (see `visible` below), so the pending/
  // confirmed counts stay accurate regardless of which filter is active.
  const load = useCallback(() => {
    fetch('/api/turnover-ai/line-items?status=all')
      .then(async res => { const j = await res.json(); if (!res.ok) throw new Error(j.error ?? 'Failed to load'); return j; })
      .then(j => { setItems(j.lineItems ?? []); setLoadError(null); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    let list = items ?? [];
    if (statusFilter === 'unconfirmed') list = list.filter(i => i.review_status === 'unconfirmed');
    if (confidenceFilter !== 'all') list = list.filter(i => i.confidence === confidenceFilter);
    return list;
  }, [items, statusFilter, confidenceFilter]);

  const counts = useMemo(() => {
    const unconfirmed = (items ?? []).filter(i => i.review_status === 'unconfirmed');
    return {
      all: unconfirmed.length,
      high: unconfirmed.filter(i => i.confidence === 'high').length,
      medium: unconfirmed.filter(i => i.confidence === 'medium').length,
      low: unconfirmed.filter(i => i.confidence === 'low').length,
    };
  }, [items]);

  const patchItem = async (id: number, body: object) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/turnover-ai/line-items/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Update failed');
      setItems(prev => (prev ?? []).map(i => i.id === id ? json.lineItem : i));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const bulkConfirmHigh = async () => {
    const ids = (items ?? []).filter(i => i.review_status === 'unconfirmed' && i.confidence === 'high').map(i => i.id);
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

  const pendingTotal = (items ?? []).filter(i => i.review_status === 'unconfirmed').length;
  const confirmedTotal = (items ?? []).filter(i => i.review_status === 'confirmed').length;

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>Turnover AI</div>
        <h1 style={{ margin: '2px 0 4px', fontSize: 22, fontWeight: 800, color: '#0f172a' }}>复核队列</h1>
        <p style={{ margin: 0, fontSize: 12.5, color: '#64748b', lineHeight: 1.6 }}>AI 已识别以下收据。置信度低的项目需要人工确认金额后，才会计入流水总额。</p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {(['unconfirmed', 'all'] as const).map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: statusFilter === s ? 'none' : '1px solid #e2e8f0', background: statusFilter === s ? '#0f172a' : '#fff', color: statusFilter === s ? '#fff' : '#475569' }}>
            {s === 'unconfirmed' ? `待复核 ${counts.all}` : '全部记录'}
          </button>
        ))}
        <span style={{ width: 1, height: 18, background: '#e2e8f0', margin: '0 4px' }} />
        {(['all', 'high', 'medium', 'low'] as const).map(c => (
          <button key={c} onClick={() => setConfidenceFilter(c)}
            style={{ padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 500, cursor: 'pointer', border: confidenceFilter === c ? '1px solid #0f172a' : '1px solid #e2e8f0', background: confidenceFilter === c ? '#f8fafc' : '#fff', color: '#475569' }}>
            {c === 'all' ? '全部置信度' : c === 'high' ? `🟢 高 ${counts.high}` : c === 'medium' ? `🟡 中 ${counts.medium}` : `🔴 低 ${counts.low}`}
          </button>
        ))}
        <div style={{ flexGrow: 1 }} />
        <button onClick={bulkConfirmHigh} disabled={busy || counts.high === 0}
          style={{ height: 32, padding: '0 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none', cursor: counts.high === 0 ? 'default' : 'pointer', background: counts.high === 0 ? '#cbd5e1' : '#0f766e', color: '#fff' }}>
          批量确认高置信度（{counts.high}）
        </button>
      </div>

      {loadError && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, marginBottom: 14 }}>{loadError}</div>}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden', marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 110px 70px 90px 130px', gap: 10, padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#94a3b8', background: '#f8fafc' }}>
          <div>商家 / 来源文件</div><div>日期</div><div style={{ textAlign: 'right' }}>金额</div><div>置信度</div><div>状态</div><div style={{ textAlign: 'right' }}>操作</div>
        </div>
        {items === null && <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /></div>}
        {items !== null && visible.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>没有符合条件的记录</div>}
        {visible.map(item => (
          editingId === item.id ? (
            <EditRow key={item.id} item={item}
              onSave={patch => { patchItem(item.id, { action: 'edit', ...patch }); setEditingId(null); }}
              onCancel={() => setEditingId(null)} />
          ) : (
            <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 110px 70px 90px 130px', gap: 10, alignItems: 'center', padding: '10px 16px', borderTop: '1px solid #f1f5f9', fontSize: 12.5, background: item.is_duplicate_suspect ? '#fffbeb' : undefined }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#0f172a', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.edited_vendor_name ?? item.vendor_name ?? '（未识别商家）'}</div>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>
                  {item.turnover_documents?.file_name}
                  {item.is_duplicate_suspect && ' · ⚠ 疑似重复收据'}
                  {item.confidence_reason && item.confidence !== 'high' && ` · ${item.confidence_reason}`}
                </div>
              </div>
              <div style={{ color: '#475569' }}>{item.edited_txn_date ?? item.txn_date ?? '—'}</div>
              <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>{money(item.edited_amount ?? item.amount, item.edited_currency ?? item.currency)}</div>
              <div><ConfidencePill c={item.confidence} /></div>
              <div>
                {item.review_status === 'confirmed' && <span style={{ ...pillStyle, background: '#f1f5f9', color: '#475569' }}>已确认</span>}
                {item.review_status === 'unconfirmed' && <span style={{ ...pillStyle, background: '#fef3c7', color: '#b45309' }}>待复核</span>}
                {item.review_status === 'rejected' && <span style={{ ...pillStyle, background: '#f1f5f9', color: '#94a3b8' }}>已忽略</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                {item.review_status === 'unconfirmed' && (
                  <>
                    <button onClick={() => patchItem(item.id, { action: 'confirm' })} disabled={busy} title="确认" style={{ border: 'none', background: 'none', color: '#15803d', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>确认</button>
                    <button onClick={() => setEditingId(item.id)} title="编辑" style={{ border: 'none', background: 'none', color: '#0f766e', cursor: 'pointer', display: 'flex' }}><Pencil size={13} /></button>
                    <button onClick={() => patchItem(item.id, { action: 'reject' })} disabled={busy} title="忽略" style={{ border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
                  </>
                )}
                <a href={`/api/turnover-ai/file/${item.document_id}`} target="_blank" rel="noreferrer" title="查看原图" style={{ color: '#94a3b8', display: 'flex' }}><ExternalLink size={13} /></a>
              </div>
            </div>
          )
        ))}
      </div>

      {(pendingTotal > 0 || confirmedTotal > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 12, padding: '14px 20px' }}>
          <div style={{ fontSize: 13, color: '#0f172a' }}>
            <b>{(items ?? []).length}</b> 张收据 · <b style={{ color: '#15803d' }}>{confirmedTotal}</b> 已确认 · <b style={{ color: '#b45309' }}>{pendingTotal}</b> 待复核
          </div>
          <div style={{ flexGrow: 1 }} />
          <a href="/turnover-ai/summary" style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0f766e', color: '#fff', fontWeight: 700, fontSize: 13, padding: '9px 16px', borderRadius: 8, textDecoration: 'none' }}>
            查看流水汇总<ArrowRight size={14} />
          </a>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
