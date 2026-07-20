'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Mail, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import CommsTabs from '@/components/client-communications/CommsTabs';

interface InvoiceRef { qbCompany: string; invoiceNo: string; amount: number }
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
function buildMailto(d: Draft): string {
  const to = d.to_email ?? '';
  const cc = d.cc_email ?? '';
  let body = d.body;
  const params = new URLSearchParams();
  if (cc) params.set('cc', cc);
  params.set('subject', d.subject);
  const base = `mailto:${encodeURIComponent(to)}?${params.toString()}`;
  const budget = 1900 - base.length;
  if (body.length > budget) body = body.slice(0, Math.max(0, budget - 40)) + '\n\n[Truncated — copy the rest from Draft Review]';
  return `${base}&body=${encodeURIComponent(body)}`;
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
                      {d.invoice_refs.map((r, j) => (
                        <span key={j} style={{ fontSize: 10.5, fontFamily: 'monospace', fontWeight: 700, color: r.qbCompany === 'TAB' ? '#1d4ed8' : '#9a3412', background: r.qbCompany === 'TAB' ? '#eff6ff' : '#ffedd5', border: `1px solid ${r.qbCompany === 'TAB' ? '#dbeafe' : '#fed7aa'}`, borderRadius: 4, padding: '2px 7px' }}>
                          {r.qbCompany} #{r.invoiceNo} · S${r.amount.toLocaleString()}
                        </span>
                      ))}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Subject</div>
                  <input value={d.subject} onChange={e => setDrafts(prev => prev.map(x => x.id === d.id ? { ...x, subject: e.target.value } : x))}
                    style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12.5, marginBottom: 10 }} />
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Body</div>
                  <textarea value={d.body} onChange={e => setDrafts(prev => prev.map(x => x.id === d.id ? { ...x, body: e.target.value } : x))}
                    rows={7} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px', fontSize: 12.5, fontFamily: 'inherit', resize: 'vertical', marginBottom: 12 }} />
                  <div style={{ display: 'flex', gap: 8 }}>
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
    </div>
  );
}

export default function DraftReviewPage() {
  return <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>Loading…</div>}><DraftsInner /></Suspense>;
}
