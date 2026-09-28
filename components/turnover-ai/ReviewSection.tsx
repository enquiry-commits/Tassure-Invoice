'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, Loader2, Pencil, X } from 'lucide-react';
import type { TurnoverLineItem } from '@/app/api/turnover-ai/line-items/route';

// Every extracted receipt across every upload, filterable by confidence and
// by status. Confirm/reject/edit here is the ONLY thing that makes a
// receipt count toward a client's turnover total (see
// app/api/turnover-ai/summary/route.ts, which only sums 'confirmed').

type ConfidenceFilter = 'all' | 'high' | 'medium' | 'low';

function money(n: number, currency: string | null) {
  return `${currency ?? ''} ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
}

const pillStyle = { fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999 } as const;

function ConfidencePill({ c }: { c: 'high' | 'medium' | 'low' }) {
  const tone = c === 'high' ? { bg: '#dcfce7', fg: '#15803d', label: 'High' } : c === 'medium' ? { bg: '#fef3c7', fg: '#b45309', label: 'Medium' } : { bg: '#fee2e2', fg: '#b91c1c', label: 'Low' };
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
      <input value={vendor} onChange={e => setVendor(e.target.value)} placeholder="Vendor" style={{ ...inputStyle, flex: '1 1 200px' }} />
      <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} style={{ ...inputStyle, width: 140 }} />
      <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} style={{ ...inputStyle, width: 100, textAlign: 'right' }} />
      <input value={currency} onChange={e => setCurrency(e.target.value.toUpperCase())} placeholder="Currency" style={{ ...inputStyle, width: 70 }} />
      <button onClick={() => onSave({ vendor, txnDate, amount: Number(amount) || 0, currency })}
        style={{ padding: '5px 12px', borderRadius: 6, border: 'none', background: '#0f766e', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Save</button>
      <button onClick={onCancel} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 11.5, cursor: 'pointer' }}>Cancel</button>
    </div>
  );
}

export function ReviewSection({ onGoToSummary }: { onGoToSummary: () => void }) {
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
      <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#64748b', lineHeight: 1.6 }}>
        AI has read the receipts below. Low-confidence items need the amount confirmed by hand before they count toward the turnover total.
      </p>

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

      {loadError && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, marginBottom: 14 }}>{loadError}</div>}

      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden', marginBottom: 18 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 110px 70px 90px 130px', gap: 10, padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#94a3b8', background: '#f8fafc' }}>
          <div>Vendor / Source file</div><div>Date</div><div style={{ textAlign: 'right' }}>Amount</div><div>Confidence</div><div>Status</div><div style={{ textAlign: 'right' }}>Actions</div>
        </div>
        {items === null && <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /></div>}
        {items !== null && visible.length === 0 && <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>No matching records</div>}
        {visible.map(item => (
          editingId === item.id ? (
            <EditRow key={item.id} item={item}
              onSave={patch => { patchItem(item.id, { action: 'edit', ...patch }); setEditingId(null); }}
              onCancel={() => setEditingId(null)} />
          ) : (
            <div key={item.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 110px 70px 90px 130px', gap: 10, alignItems: 'center', padding: '10px 16px', borderTop: '1px solid #f1f5f9', fontSize: 12.5, background: item.is_duplicate_suspect ? '#fffbeb' : undefined }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#0f172a', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.edited_vendor_name ?? item.vendor_name ?? '(vendor not identified)'}</div>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>
                  {item.turnover_documents?.file_name}
                  {item.is_duplicate_suspect && ' · ⚠ possible duplicate'}
                  {item.confidence_reason && item.confidence !== 'high' && ` · ${item.confidence_reason}`}
                </div>
              </div>
              <div style={{ color: '#475569' }}>{item.edited_txn_date ?? item.txn_date ?? '—'}</div>
              <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>{money(item.edited_amount ?? item.amount, item.edited_currency ?? item.currency)}</div>
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

      {(pendingTotal > 0 || confirmedTotal > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 12, padding: '14px 20px' }}>
          <div style={{ fontSize: 13, color: '#0f172a' }}>
            <b>{(items ?? []).length}</b> receipts · <b style={{ color: '#15803d' }}>{confirmedTotal}</b> confirmed · <b style={{ color: '#b45309' }}>{pendingTotal}</b> pending review
          </div>
          <div style={{ flexGrow: 1 }} />
          <button onClick={onGoToSummary} style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0f766e', color: '#fff', fontWeight: 700, fontSize: 13, padding: '9px 16px', borderRadius: 8, border: 'none', cursor: 'pointer' }}>
            View turnover summary<ArrowRight size={14} />
          </button>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
