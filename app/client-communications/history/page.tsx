'use client';

import { useState, useEffect, useCallback } from 'react';
import CommsTabs from '@/components/client-communications/CommsTabs';

interface HistoryRow {
  id: number; company_name: string; to_email: string | null; subject: string;
  status: 'pending' | 'sent' | 'skipped'; total_amount: number | null;
  sent_at: string | null; sent_by_name: string | null;
  email_campaigns: { type: string; name: string; fye_month: string | null; fye_year: number | null };
}

const TYPE_LABEL: Record<string, string> = { ar: 'AR', soa: 'SOA', letter: 'Letter' };
const S: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13, background: '#fff', outline: 'none', color: '#1e3a5f' };

export default function DeliveryHistoryPage() {
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    fetch(`/api/client-communications/drafts?${params}`).then(r => r.json()).then(j => setRows(j.data ?? [])).finally(() => setLoading(false));
  }, [search, type, status]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Billing System › Client Communications</div>
      <CommsTabs />

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search company name…" style={{ ...S, flex: 1, minWidth: 200 }} />
        <select value={type} onChange={e => setType(e.target.value)} style={S}>
          <option value="">All types</option>
          <option value="ar">AR Renewal</option>
          <option value="soa">SOA</option>
          <option value="letter">Letter</option>
        </select>
        <select value={status} onChange={e => setStatus(e.target.value)} style={S}>
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="sent">Sent</option>
          <option value="skipped">Skipped</option>
        </select>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '60px 1.4fr 1fr 100px 100px 130px 140px', padding: '8px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
          <div>Type</div><div>Company</div><div>Subject</div><div style={{ textAlign: 'right' }}>Amount</div><div style={{ textAlign: 'center' }}>Status</div><div>Sent</div><div>By</div>
        </div>
        <div style={{ maxHeight: 'calc(100vh - 340px)', overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No records match.</div>
          ) : rows.map((r, i) => {
            const accent = r.status === 'sent' ? '#16a34a' : r.status === 'skipped' ? '#94a3b8' : '#c2410c';
            return (
              <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '60px 1.4fr 1fr 100px 100px 130px 140px', alignItems: 'center', padding: '9px 14px', borderBottom: '1px solid #f1f5f9', borderLeft: `3px solid ${accent}`, background: i % 2 === 0 ? '#fff' : '#fafbfc', fontSize: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8' }}>{TYPE_LABEL[r.email_campaigns?.type] ?? r.email_campaigns?.type}</div>
                <div style={{ fontWeight: 600, color: '#1e3a5f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company_name}</div>
                <div style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subject}</div>
                <div style={{ textAlign: 'right', fontWeight: 700, color: '#0f766e' }}>{r.total_amount != null ? `S$${r.total_amount.toLocaleString()}` : '—'}</div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: accent, background: `${accent}14`, borderRadius: 4, padding: '2px 7px', textTransform: 'uppercase' }}>{r.status}</span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 11 }}>{r.sent_at ? new Date(r.sent_at).toLocaleString() : '—'}</div>
                <div style={{ color: '#94a3b8', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.sent_by_name ?? '—'}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
