'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Check, X, ChevronDown, ChevronRight, Download, Loader2, Send } from 'lucide-react';
import CommsTabs from '@/components/client-communications/CommsTabs';
import { invoicePdfFileName } from '@/lib/invoice-filename';
import { checkHelperHealth, openDraftsInOutlook } from '@/lib/draft-helper-client';

interface InvoiceRef { qbCompany: string; invoiceNo: string; amount: number; qbInvoiceId?: string | null }
interface Draft {
  id: number; company_name: string; to_email: string | null; cc_email: string | null;
  subject: string; body: string; invoice_refs: InvoiceRef[]; total_amount: number | null;
  status: 'pending' | 'sent' | 'skipped'; version: number;
}
interface Campaign {
  id: number; type: string; name: string; fye_month: string | null; fye_year: number | null;
  email_senders: { email: string; display_name: string | null } | null;
}

// mailto: links are size-limited (~2000 chars is the safe cross-client
// ceiling) — long merged bodies still open Outlook with To/CC/Subject
// filled in and a truncation notice instead of silently failing to open.
//
// Reviewers type multiple recipients as either comma- or semicolon-
// separated (Outlook's own compose window shows semicolons) — the mailto:
// spec (RFC 6068) only recognises commas, so normalise before building the
// link. Comma-separating them here is what actually makes them arrive as
// separate To/CC recipients instead of one broken address.
function normalizeRecipients(raw: string): string {
  return raw.split(/[;,\n\r]+/).map(s => s.trim()).filter(Boolean).join(',');
}

function buildMailto(d: Draft): string {
  const to = normalizeRecipients(d.to_email ?? '');
  const cc = normalizeRecipients(d.cc_email ?? '');
  let body = d.body;
  const params = new URLSearchParams();
  if (cc) params.set('cc', cc);
  params.set('subject', d.subject);
  const base = `mailto:${encodeURIComponent(to)}?${params.toString()}`;
  const budget = 1900 - base.length;
  if (body.length > budget) body = body.slice(0, Math.max(0, budget - 40)) + '\n\n[Truncated — copy the rest from Draft Review]';
  return `${base}&body=${encodeURIComponent(body)}`;
}

function isPlainAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) > 127) return false;
  return true;
}

// RFC 2047 encoded-word, for headers that may contain non-ASCII (Chinese
// contact names, etc.) — plain ASCII passes through untouched.
function encodeHeader(value: string): string {
  if (isPlainAscii(value)) return value;
  return `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

// Base64-encode an ArrayBuffer in chunks (spreading a huge Uint8Array into
// String.fromCharCode blows the call stack on multi-MB PDFs), wrapped at the
// MIME-standard 76 chars/line.
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const b64 = btoa(binary);
  return b64.replace(/(.{76})/g, '$1\r\n');
}

// A self-contained .eml (RFC 5322 multipart/mixed) with the invoice PDF(s)
// embedded as real attachments — double-clicking it opens straight in
// Outlook with To/CC/Subject/Body/attachment already in place, no manual
// drag-and-drop step. mailto: can't do this (no attachment support in the
// URI scheme); this sidesteps that limit entirely by building the message
// file itself instead of asking the OS mail handler to do it.
function buildEmlBlob(d: Draft, attachments: { fileName: string; data: ArrayBuffer }[]): Blob {
  const boundary = `----tassure-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const to = normalizeRecipients(d.to_email ?? '');
  const cc = normalizeRecipients(d.cc_email ?? '');
  const lines: string[] = [];
  if (to) lines.push(`To: ${to}`);
  if (cc) lines.push(`Cc: ${cc}`);
  lines.push(`Subject: ${encodeHeader(d.subject)}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(arrayBufferToBase64(new TextEncoder().encode(d.body).buffer as ArrayBuffer));
  for (const att of attachments) {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: application/pdf; name="${att.fileName}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-Disposition: attachment; filename="${att.fileName}"`);
    lines.push('');
    lines.push(arrayBufferToBase64(att.data));
  }
  lines.push(`--${boundary}--`);
  lines.push('');
  return new Blob([lines.join('\r\n')], { type: 'message/rfc822' });
}

function DraftsInner() {
  const searchParams = useSearchParams();
  const campaignIdParam = searchParams.get('campaignId');

  const [campaigns, setCampaigns] = useState<{ id: number; name: string; type: string }[]>([]);
  const [campaignId, setCampaignId] = useState<number | null>(campaignIdParam ? Number(campaignIdParam) : null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(false);
  const [campaignsLoading, setCampaignsLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'sent' | 'skipped'>('pending');
  const [me, setMe] = useState<{ email: string; name: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : { user: null }).then(j => setMe(j.user ?? null)).catch(() => setMe(null));
  }, []);

  // Tassure Draft Helper: a small local app staff install once (see
  // lib/draft-helper-client.ts) that opens real Outlook drafts with invoice
  // PDFs already attached. Detected via a localhost health check — if it's
  // not running, the existing mailto:/.eml buttons below still work as-is.
  const [helperAvailable, setHelperAvailable] = useState<boolean | null>(null);
  const [helperBannerDismissed, setHelperBannerDismissed] = useState(false);
  const recheckHelper = useCallback(() => { checkHelperHealth().then(setHelperAvailable); }, []);
  useEffect(() => { recheckHelper(); }, [recheckHelper]);

  const [openingId, setOpeningId] = useState<number | 'batch' | null>(null);
  const [openErrors, setOpenErrors] = useState<Record<number, string>>({});

  const openInHelper = async (d: Draft) => {
    setOpeningId(d.id);
    setOpenErrors(prev => { const next = { ...prev }; delete next[d.id]; return next; });
    try {
      const [result] = await openDraftsInOutlook([d]);
      if (!result.ok) setOpenErrors(prev => ({ ...prev, [d.id]: result.error ?? 'Failed to open.' }));
    } catch (e: unknown) {
      setOpenErrors(prev => ({ ...prev, [d.id]: e instanceof Error ? e.message : 'Failed to open.' }));
    } finally {
      setOpeningId(null);
    }
  };

  const openAllPendingInHelper = async () => {
    const pending = drafts.filter(d => d.status === 'pending');
    if (pending.length === 0) return;
    if (!window.confirm(`Open ${pending.length} pending draft(s) as Outlook compose windows?`)) return;
    setOpeningId('batch');
    try {
      const results = await openDraftsInOutlook(pending);
      const errors: Record<number, string> = {};
      pending.forEach((d, i) => { if (!results[i]?.ok) errors[d.id] = results[i]?.error ?? 'Failed to open.'; });
      setOpenErrors(errors);
    } finally {
      setOpeningId(null);
    }
  };

  useEffect(() => {
    fetch('/api/client-communications/campaigns').then(r => r.json()).then(j => {
      const list = j.data ?? [];
      setCampaigns(list);
      if (!campaignId && list.length) setCampaignId(list[0].id);
    }).finally(() => setCampaignsLoading(false));
  }, [campaignId]);

  const load = useCallback(() => {
    if (!campaignId) return;
    setLoading(true);
    fetch(`/api/client-communications/campaigns/${campaignId}`).then(r => r.json()).then(j => {
      setCampaign(j.campaign ?? null);
      setDrafts(j.drafts ?? []);
    }).finally(() => setLoading(false));
  }, [campaignId]);

  useEffect(() => { load(); }, [load]);

  const updateDraft = async (d: Draft, patch: Partial<Draft>) => {
    const res = await fetch('/api/client-communications/drafts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: d.id, version: d.version, patch, sentByEmail: me?.email, sentByName: me?.name }),
    });
    if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? 'Update failed'); return; }
    setDrafts(prev => prev.map(x => x.id === d.id ? { ...x, ...patch, version: x.version + 1 } : x));
  };

  const openInOutlook = (d: Draft) => {
    window.location.href = buildMailto(d);
  };

  // mailto: links cannot carry attachments — that's a hard limit of the URI
  // scheme, not something a workaround can fix. The closest we can get is
  // downloading the real invoice PDF straight from QuickBooks (same endpoint
  // Billing Draft's "save PDF" uses) with the house filename convention, so
  // whoever is sending just drags it into the Outlook window this page opens.
  const [downloadingRef, setDownloadingRef] = useState<string | null>(null);
  const downloadInvoicePdf = async (r: InvoiceRef, companyName: string, key: string) => {
    if (!r.qbInvoiceId || (r.qbCompany !== 'TAB' && r.qbCompany !== 'TAC')) return;
    setDownloadingRef(key);
    try {
      const res = await fetch(`/api/quickbooks/invoice-pdf?company=${r.qbCompany}&id=${encodeURIComponent(r.qbInvoiceId)}`);
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? 'Unable to download invoice PDF.'); return; }
      const blob = await res.blob();
      const fileName = invoicePdfFileName(r.qbCompany as 'TAB' | 'TAC', r.invoiceNo, companyName, r.amount);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = fileName;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Unable to download invoice PDF.');
    } finally {
      setDownloadingRef(null);
    }
  };

  // One-click equivalent of the old Excel tool: builds a single .eml with
  // every downloadable invoice already attached, ready to open in Outlook.
  const [emlBuildingId, setEmlBuildingId] = useState<number | null>(null);
  const downloadEml = async (d: Draft) => {
    setEmlBuildingId(d.id);
    try {
      const downloadableRefs = (d.invoice_refs ?? []).filter(r => r.qbInvoiceId && (r.qbCompany === 'TAB' || r.qbCompany === 'TAC'));
      const attachments = await Promise.all(downloadableRefs.map(async r => {
        const res = await fetch(`/api/quickbooks/invoice-pdf?company=${r.qbCompany}&id=${encodeURIComponent(r.qbInvoiceId!)}`);
        if (!res.ok) throw new Error(`Unable to download ${r.qbCompany} #${r.invoiceNo}.`);
        return { fileName: invoicePdfFileName(r.qbCompany as 'TAB' | 'TAC', r.invoiceNo, d.company_name, r.amount), data: await res.arrayBuffer() };
      }));
      const blob = buildEmlBlob(d, attachments);
      const safeCompany = d.company_name.replace(/[<>:"/\\|?*]/g, ' ').replace(/\s+/g, ' ').trim();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${safeCompany}.eml`;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : 'Unable to generate the email file.');
    } finally {
      setEmlBuildingId(null);
    }
  };

  const filtered = drafts.filter(d => filter === 'all' || d.status === filter);
  const counts = { pending: drafts.filter(d => d.status === 'pending').length, sent: drafts.filter(d => d.status === 'sent').length, skipped: drafts.filter(d => d.status === 'skipped').length };

  // First-run empty state: no campaign exists anywhere yet. Show this
  // instead of a blank dropdown + "No drafts" with no explanation. Gated on
  // campaignsLoading (not the per-campaign `loading`) so it never flashes
  // before the initial campaigns fetch has actually returned.
  if (campaignsLoading) {
    return (
      <div>
        <div className="mb-4 text-sm text-slate-500">Dashboard › Billing System › Client Communications</div>
        <CommsTabs />
        <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
      </div>
    );
  }
  if (campaigns.length === 0) {
    return (
      <div>
        <div className="mb-4 text-sm text-slate-500">Dashboard › Billing System › Client Communications</div>
        <CommsTabs />
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 40, textAlign: 'center' }}>
          <Mail size={28} style={{ color: '#cbd5e1', marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#1e3a5f', marginBottom: 6 }}>No campaigns yet</div>
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginBottom: 16 }}>Drafts show up here after you generate a campaign.</div>
          <Link href="/client-communications/campaigns"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, background: '#1d3a5c', color: '#fff', fontWeight: 700, fontSize: 12.5, textDecoration: 'none' }}>
            Go to Campaign Centre →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Billing System › Client Communications</div>
      <CommsTabs />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select value={campaignId ?? ''} onChange={e => setCampaignId(Number(e.target.value))}
          style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: 13, minWidth: 260 }}>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {campaign?.email_senders && (
          <span style={{ fontSize: 11.5, color: '#64748b' }}>From: {campaign.email_senders.display_name ?? campaign.email_senders.email}</span>
        )}
        <div style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {([['pending', counts.pending, '#c2410c'], ['sent', counts.sent, '#16a34a'], ['skipped', counts.skipped, '#94a3b8'], ['all', drafts.length, '#1d3a5c']] as const).map(([key, count, color]) => (
            <button key={key} onClick={() => setFilter(key)}
              style={{ padding: '5px 12px', borderRadius: 7, fontSize: 11.5, fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${filter === key ? color : '#e2e8f0'}`, background: filter === key ? `${color}14` : '#fff', color: filter === key ? color : '#64748b' }}>
              {key} ({count})
            </button>
          ))}
        </div>
      </div>

      {helperAvailable === false && !helperBannerDismissed && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, padding: '10px 14px', borderRadius: 8, border: '1px solid #fde68a', background: '#fffbeb' }}>
          <span style={{ fontSize: 12.5, color: '#92400e', flex: 1 }}>
            未检测到 Tassure Draft Helper — 一次性安装后即可在这里一键开好 Outlook 草稿并自动带上发票附件。
          </span>
          <a href="/downloads/TassureDraftHelper.exe" download
            style={{ fontSize: 12, fontWeight: 700, padding: '6px 12px', borderRadius: 6, background: '#b45309', color: '#fff', textDecoration: 'none' }}>
            下载 Helper
          </a>
          <button onClick={recheckHelper} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 6, border: '1px solid #fde68a', background: '#fff', color: '#92400e', cursor: 'pointer' }}>
            重新检测
          </button>
          <button onClick={() => setHelperBannerDismissed(true)} title="Dismiss" style={{ border: 'none', background: 'transparent', color: '#92400e', cursor: 'pointer', display: 'flex' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {helperAvailable && counts.pending > 0 && (
        <div style={{ marginBottom: 14 }}>
          <button onClick={openAllPendingInHelper} disabled={openingId === 'batch'}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, border: 'none', background: '#397f78', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: openingId === 'batch' ? 'wait' : 'pointer' }}>
            {openingId === 'batch' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
            {openingId === 'batch' ? 'Opening…' : `Open All Pending in Outlook (${counts.pending})`}
          </button>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>No drafts in this view.</div>
        ) : filtered.map((d, i) => {
          const isOpen = expanded === d.id;
          const accent = d.status === 'sent' ? '#16a34a' : d.status === 'skipped' ? '#94a3b8' : '#c2410c';
          return (
            <div key={d.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
              <div onClick={() => setExpanded(isOpen ? null : d.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderLeft: `3px solid ${accent}`, cursor: 'pointer' }}>
                {isOpen ? <ChevronDown size={14} color="#94a3b8" /> : <ChevronRight size={14} color="#94a3b8" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a5f' }}>{d.company_name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.to_email ?? '(no email)'} · {d.subject}</div>
                </div>
                {d.total_amount != null && <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0f766e' }}>S${d.total_amount.toLocaleString()}</span>}
                <span style={{ fontSize: 10, fontWeight: 700, color: accent, background: `${accent}14`, borderRadius: 4, padding: '2px 8px', textTransform: 'uppercase' }}>{d.status}</span>
              </div>

              {isOpen && (
                <div style={{ padding: '4px 14px 16px 38px' }}>
                  {d.invoice_refs?.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                      {d.invoice_refs.map((r, j) => {
                        const downloadKey = `${d.id}-${j}`;
                        const downloadable = !!r.qbInvoiceId && (r.qbCompany === 'TAB' || r.qbCompany === 'TAC');
                        const isDownloading = downloadingRef === downloadKey;
                        return (
                          <span key={j} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontFamily: 'monospace', fontWeight: 700, color: r.qbCompany === 'TAB' ? '#1d4ed8' : '#9a3412', background: r.qbCompany === 'TAB' ? '#eff6ff' : '#ffedd5', border: `1px solid ${r.qbCompany === 'TAB' ? '#dbeafe' : '#fed7aa'}`, borderRadius: 4, padding: '2px 6px 2px 7px' }}>
                            {r.qbCompany} #{r.invoiceNo} · S${r.amount.toLocaleString()}
                            {downloadable && (
                              <button onClick={() => downloadInvoicePdf(r, d.company_name, downloadKey)} disabled={isDownloading}
                                title="Download the invoice PDF to attach in Outlook" style={{ border: 'none', background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', color: 'inherit', cursor: isDownloading ? 'wait' : 'pointer' }}>
                                {isDownloading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={11} />}
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Subject</div>
                  <input value={d.subject} onChange={e => setDrafts(prev => prev.map(x => x.id === d.id ? { ...x, subject: e.target.value } : x))}
                    style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, marginBottom: 10 }} />
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Body</div>
                  <textarea value={d.body} onChange={e => setDrafts(prev => prev.map(x => x.id === d.id ? { ...x, body: e.target.value } : x))}
                    rows={7} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px', fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical', marginBottom: 12 }} />
                  {d.invoice_refs?.some(r => r.qbInvoiceId && (r.qbCompany === 'TAB' || r.qbCompany === 'TAC')) && (
                    <div style={{ fontSize: 10.5, color: '#94a3b8', marginBottom: 10 }}>
                      Download Email builds a ready-to-send .eml with the invoice(s) already attached — double-click it to open in Outlook. Compose in Outlook opens a blank draft instead (no attachment; mailto: links can&apos;t carry one).
                    </div>
                  )}
                  {openErrors[d.id] && (
                    <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 8 }}>{openErrors[d.id]}</div>
                  )}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {helperAvailable && (
                      <button onClick={() => { updateDraft(d, { subject: d.subject, body: d.body }); openInHelper(d); }} disabled={openingId === d.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: 'none', background: '#397f78', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: openingId === d.id ? 'wait' : 'pointer' }}>
                        {openingId === d.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
                        {openingId === d.id ? 'Opening…' : 'Open in Outlook (with attachment)'}
                      </button>
                    )}
                    {d.invoice_refs?.some(r => r.qbInvoiceId && (r.qbCompany === 'TAB' || r.qbCompany === 'TAC')) && (
                      <button onClick={() => { updateDraft(d, { subject: d.subject, body: d.body }); downloadEml(d); }} disabled={emlBuildingId === d.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: 'none', background: '#0f766e', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: emlBuildingId === d.id ? 'wait' : 'pointer' }}>
                        {emlBuildingId === d.id ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />}
                        {emlBuildingId === d.id ? 'Building…' : 'Download Email (with invoice)'}
                      </button>
                    )}
                    <button onClick={() => { updateDraft(d, { subject: d.subject, body: d.body }); openInOutlook(d); }}
                      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: 'none', background: '#1d3a5c', color: '#fff', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                      <Mail size={13} />Compose in Outlook
                    </button>
                    {d.status !== 'sent' && (
                      <button onClick={() => updateDraft(d, { status: 'sent' })}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: '1px solid #bbf7d0', background: '#f0fdf4', color: '#16a34a', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                        <Check size={13} />Mark as Sent
                      </button>
                    )}
                    {d.status !== 'skipped' && (
                      <button onClick={() => updateDraft(d, { status: 'skipped' })}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                        <X size={13} />Skip
                      </button>
                    )}
                    {d.status !== 'pending' && (
                      <button onClick={() => updateDraft(d, { status: 'pending' })}
                        style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#94a3b8', fontWeight: 600, fontSize: 12.5, cursor: 'pointer' }}>
                        Reset to pending
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

export default function DraftReviewPage() {
  return <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>}><DraftsInner /></Suspense>;
}
