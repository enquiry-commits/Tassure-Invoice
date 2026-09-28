'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud, FileText, Loader2, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { ClientPicker, type ClientSelection } from '@/components/turnover-ai/ClientPicker';
import type { TurnoverDocument } from '@/app/api/turnover-ai/documents/route';

// Turnover AI › Inbox (Vincent, 2026-09-28: "Account...会需要读客户的单据去
// 计算客户的流水...需要AI AGENT先去读取一轮"). Upload receipts/invoices for
// one client — Claude vision (lib/turnover-ai.ts) splits each file into its
// individual receipts. Nothing here is final: everything lands as
// review_status='unconfirmed' and must be confirmed on the Review Queue
// before it counts toward the client's turnover total (Summary page).

type UploadRow = { fileName: string; status: 'uploading' | 'done' | 'error'; message?: string; lineItemCount?: number; unconfirmedCount?: number };

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic';

function StatusBadge({ status }: { status: TurnoverDocument['status'] }) {
  if (status === 'processing') return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: '#f1f5f9', color: '#475569' }}><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />处理中</span>;
  if (status === 'failed') return <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: '#fee2e2', color: '#b91c1c' }}>失败</span>;
  return <span style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 999, background: '#dcfce7', color: '#15803d' }}>已完成</span>;
}

export default function TurnoverInboxPage() {
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
    if (!client.name.trim()) { alert('请先选择或输入客户名。'); return; }
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
        if (!res.ok) throw new Error(json.error ?? '识别失败');
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
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11.5, color: '#94a3b8', fontWeight: 600 }}>Turnover AI</div>
        <h1 style={{ margin: '2px 0 4px', fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Inbox 上传单据</h1>
        <p style={{ margin: 0, fontSize: 12.5, color: '#64748b', maxWidth: 640, lineHeight: 1.6 }}>
          上传客户的收据 / 发票 / 刷卡单，AI 会自动识别商家、日期、金额；一个文件里有多张收据也会自动拆开。人工在复核队列确认后才计入流水总额。
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <ClientPicker value={client} onChange={setClient} />
        <input value={periodLabel} onChange={e => setPeriodLabel(e.target.value)} placeholder="期间（可选，如 2026年8月）"
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
        <div style={{ fontSize: 13.5, color: '#334155', fontWeight: 600 }}>拖拽文件到此处，或点击选择</div>
        <div style={{ fontSize: 11.5, color: '#94a3b8' }}>支持 PDF · JPG · PNG · HEIC（含手机截图）· 单次最多 20 个文件</div>
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
                {u.status === 'uploading' && 'AI 识别中…'}
                {u.status === 'done' && `发现 ${u.lineItemCount} 张收据${u.unconfirmedCount ? ` · ${u.unconfirmedCount} 条待复核` : ''}`}
                {u.status === 'error' && u.message}
              </span>
            </div>
          ))}
        </div>
      )}

      {loadError && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: 12, marginBottom: 14 }}>{loadError}</div>
      )}

      <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 700, marginBottom: 8 }}>最近上传</div>
      <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden', marginBottom: 18 }}>
        {documents === null && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>加载中…</div>}
        {documents !== null && documents.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>还没有上传任何单据</div>}
        {(documents ?? []).map((d, i) => (
          <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderBottom: i < (documents?.length ?? 0) - 1 ? '1px solid #f1f5f9' : 'none' }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <FileText size={14} color="#dc2626" />
            </div>
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: '#0f172a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.file_name}</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                {d.client_name}{d.period_label ? ` · ${d.period_label}` : ''}
                {d.status === 'done' && ` · 发现 ${d.lineItemCount} 张收据${d.unconfirmedCount ? ` · ${d.unconfirmedCount} 条待复核` : ''}`}
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
            共识别 <b>{totals.lineItems}</b> 张收据 · <b style={{ color: '#b45309' }}>{totals.unconfirmed}</b> 条待人工复核
          </div>
          <div style={{ flexGrow: 1 }} />
          <a href="/turnover-ai/review" style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0f766e', color: '#fff', fontWeight: 700, fontSize: 13, padding: '9px 16px', borderRadius: 8, textDecoration: 'none' }}>
            前往复核队列<ArrowRight size={14} />
          </a>
        </div>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
