'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, ArrowRight } from 'lucide-react';
import { ClientPicker, type ClientSelection } from '@/components/turnover-ai/ClientPicker';
import type { TurnoverSummary } from '@/app/api/turnover-ai/summary/route';

// Turnover AI › Summary. Only 'confirmed' line items count toward the
// totals below (app/api/turnover-ai/summary/route.ts) — a client with
// pending review items always shows that count separately so nobody
// mistakes "confirmed so far" for "everything".

function money(n: number, currency: string) {
  return `${currency} ${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function TurnoverSummaryPage() {
  const [client, setClient] = useState<ClientSelection>({ companyId: null, name: '' });
  const [summary, setSummary] = useState<TurnoverSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback((name: string) => {
    if (!name.trim()) { setSummary(null); return; }
    setLoading(true);
    fetch(`/api/turnover-ai/summary?clientName=${encodeURIComponent(name.trim())}`)
      .then(async res => { const j = await res.json(); if (!res.ok) throw new Error(j.error ?? 'Failed to load'); return j; })
      .then(j => { setSummary(j); setLoadError(null); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(client.name), 350);
    return () => clearTimeout(t);
  }, [client.name, load]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>Turnover AI</div>
          <h1 style={{ margin: '2px 0 8px', fontSize: 22, fontWeight: 800, color: '#0f172a' }}>流水汇总</h1>
          <ClientPicker value={client} onChange={setClient} placeholder="选择客户查看流水汇总" />
        </div>
        {summary && client.name.trim() && (
          <a href={`/api/turnover-ai/export?clientName=${encodeURIComponent(client.name.trim())}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 16px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, background: '#0f766e', color: '#fff', textDecoration: 'none' }}>
            <Download size={14} />导出 Excel
          </a>
        )}
      </div>

      {loadError && <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, marginBottom: 14 }}>{loadError}</div>}
      {!client.name.trim() && !loading && <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>请先选择一个客户</div>}
      {loading && <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>加载中…</div>}

      {summary && client.name.trim() && !loading && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 18, flexWrap: 'wrap' }}>
            {summary.totals.length === 0 && (
              <div style={{ flex: 1, minWidth: 220, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px', color: '#94a3b8', fontSize: 12.5 }}>
                这个客户还没有任何已确认的收据。
              </div>
            )}
            {summary.totals.map(t => (
              <div key={t.currency} style={{ flex: 1, minWidth: 220, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '20px 22px' }}>
                <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>{t.currency} 总流水（已确认）</div>
                <div style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 700, color: '#0f172a' }}>{money(t.total, t.currency)}</div>
                <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>{t.count} 张收据已确认</div>
              </div>
            ))}
            {summary.pendingCount > 0 && (
              <div style={{ flex: 1, minWidth: 220, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 14, padding: '20px 22px' }}>
                <div style={{ fontSize: 12, color: '#b45309', fontWeight: 600, marginBottom: 6 }}>待复核，尚未计入总额</div>
                <div style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 700, color: '#b45309' }}>{summary.pendingCount} 张</div>
                <a href="/turnover-ai/review" style={{ fontSize: 11.5, fontWeight: 700, color: '#0f766e', display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 6 }}>前往复核 <ArrowRight size={11} /></a>
              </div>
            )}
          </div>

          <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700, marginBottom: 8 }}>已确认收据明细</div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 110px 220px', gap: 10, padding: '10px 16px', fontSize: 11, fontWeight: 700, color: '#94a3b8', background: '#f8fafc' }}>
              <div>商家</div><div>日期</div><div style={{ textAlign: 'right' }}>金额</div><div>来源文件</div>
            </div>
            {summary.confirmedItems.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>暂无已确认收据</div>}
            {summary.confirmedItems.map((i, idx) => (
              <div key={i.id} style={{ display: 'grid', gridTemplateColumns: '1.6fr 90px 110px 220px', gap: 10, padding: '9px 16px', borderTop: idx > 0 ? '1px solid #f1f5f9' : 'none', fontSize: 12.5 }}>
                <div style={{ color: '#0f172a', fontWeight: 500 }}>{i.vendor ?? '—'}</div>
                <div style={{ color: '#475569' }}>{i.txnDate ?? '—'}</div>
                <div style={{ textAlign: 'right', fontFamily: 'monospace' }}>{money(i.amount, i.currency ?? '')}</div>
                <div style={{ color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.fileName ?? '—'}</div>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
            此总额仅计入「已确认」的收据；待复核项目在人工确认金额前不计入总流水，确保交给 Account 的数字可追溯、可核对到原始单据。
          </div>
        </>
      )}
    </div>
  );
}
