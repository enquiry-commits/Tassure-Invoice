'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Send, RefreshCw } from 'lucide-react';
import CommsTabs from '@/components/client-communications/CommsTabs';

const FYE_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const TYPE_LABEL: Record<string, string> = { ar: 'AR Renewal Reminder', soa: 'Statement of Account', letter: 'Document Reminder' };

interface Template { id: number; type: string; name: string; is_default: boolean }
interface Sender { id: number; email: string; display_name: string | null; is_default: boolean }
interface Campaign {
  id: number; type: string; name: string; fye_month: string | null; fye_year: number | null;
  status: string; created_at: string; created_by_name: string | null;
  email_drafts: { count: number }[];
}

const S: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13, background: '#fff', outline: 'none', color: '#1e3a5f' };

export default function CampaignCentrePage() {
  const [type, setType] = useState<'ar' | 'soa' | 'letter'>('ar');
  const now = new Date();
  const [fyeMonth, setFyeMonth] = useState(FYE_MONTHS[now.getMonth()]);
  const [fyeYear, setFyeYear] = useState(String(now.getFullYear()));
  const [letterCompanies, setLetterCompanies] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [templateId, setTemplateId] = useState<number | null>(null);
  const [senderId, setSenderId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; campaignId?: number } | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [me, setMe] = useState<{ email: string; name: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : { user: null }).then(j => setMe(j.user ?? null)).catch(() => setMe(null));
  }, []);

  const loadCampaigns = useCallback(() => {
    setLoadingCampaigns(true);
    fetch('/api/client-communications/campaigns').then(r => r.json()).then(j => setCampaigns(j.data ?? [])).finally(() => setLoadingCampaigns(false));
  }, []);

  useEffect(() => {
    fetch('/api/client-communications/templates').then(r => r.json()).then(j => setTemplates(j.data ?? []));
    fetch('/api/client-communications/senders').then(r => r.json()).then(j => {
      setSenders(j.data ?? []);
      const def = (j.data ?? []).find((s: Sender) => s.is_default);
      if (def) setSenderId(def.id);
    });
    loadCampaigns();
  }, [loadCampaigns]);

  // Default the template to the type's default whenever type or the template list changes.
  useEffect(() => {
    const match = templates.find(t => t.type === type && t.is_default) ?? templates.find(t => t.type === type);
    setTemplateId(match?.id ?? null);
  }, [type, templates]);

  useEffect(() => {
    if (type === 'ar') setName(`AR Renewal - FYE ${fyeMonth} ${fyeYear}`);
    else if (type === 'soa') setName(`SOA Reminder - ${new Date().toISOString().slice(0, 10)}`);
    else setName(`Document Reminder - ${new Date().toISOString().slice(0, 10)}`);
  }, [type, fyeMonth, fyeYear]);

  const typeTemplates = templates.filter(t => t.type === type);

  const generate = async () => {
    if (!templateId) { setResult({ ok: false, msg: 'Choose a template first.' }); return; }
    setGenerating(true); setResult(null);
    try {
      const companyNames = type === 'letter'
        ? letterCompanies.split('\n').map(s => s.trim()).filter(Boolean)
        : undefined;
      const res = await fetch('/api/client-communications/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, name, templateId, senderId,
          fyeMonth: type === 'ar' ? fyeMonth : undefined,
          fyeYear: type === 'ar' ? Number(fyeYear) : undefined,
          companyNames,
          createdByEmail: me?.email, createdByName: me?.name,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setResult({ ok: false, msg: json.error ?? 'Failed to generate drafts.' }); return; }
      const skippedMsg = json.skipped?.length ? ` · ${json.skipped.length} skipped` : '';
      setResult({ ok: true, msg: `${json.draftsCreated} draft(s) created${skippedMsg}.`, campaignId: json.campaignId });
      loadCampaigns();
    } catch (e: unknown) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Request failed' });
    } finally { setGenerating(false); }
  };

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Billing System › Client Communications</div>
      <CommsTabs />

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20, marginBottom: 20 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#1e3a5f', marginBottom: 14 }}>New Campaign</div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          {(['ar', 'soa', 'letter'] as const).map(t => (
            <button key={t} onClick={() => setType(t)}
              style={{ padding: '7px 14px', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
                border: `1.5px solid ${type === t ? '#1d3a5c' : '#e2e8f0'}`,
                background: type === t ? '#1d3a5c' : '#fff', color: type === t ? '#fff' : '#64748b' }}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Campaign name</div>
            <input value={name} onChange={e => setName(e.target.value)} style={{ ...S, width: '100%' }} />
          </div>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Template</div>
            <select value={templateId ?? ''} onChange={e => setTemplateId(Number(e.target.value))} style={{ ...S, width: '100%' }}>
              {typeTemplates.map(t => <option key={t.id} value={t.id}>{t.name}{t.is_default ? ' (default)' : ''}</option>)}
            </select>
          </div>

          {type === 'ar' && (
            <>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>FYE Month</div>
                <select value={fyeMonth} onChange={e => setFyeMonth(e.target.value)} style={{ ...S, width: '100%' }}>
                  {FYE_MONTHS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>FYE Year</div>
                <select value={fyeYear} onChange={e => setFyeYear(e.target.value)} style={{ ...S, width: '100%' }}>
                  {['2024','2025','2026','2027'].map(y => <option key={y}>{y}</option>)}
                </select>
              </div>
            </>
          )}

          <div>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Sender (display only — you still send from your own Outlook)</div>
            <select value={senderId ?? ''} onChange={e => setSenderId(Number(e.target.value))} style={{ ...S, width: '100%' }}>
              {senders.map(s => <option key={s.id} value={s.id}>{s.display_name ? `${s.display_name} <${s.email}>` : s.email}</option>)}
            </select>
          </div>
        </div>

        {type === 'letter' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>Company names (one per line)</div>
            <textarea value={letterCompanies} onChange={e => setLetterCompanies(e.target.value)}
              rows={5} style={{ ...S, width: '100%', fontFamily: 'inherit', resize: 'vertical' }}
              placeholder={'CHINA SHIPBUILDING\nCABC\nHONG XIN DA'} />
          </div>
        )}

        {type === 'ar' && (
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14 }}>
            Pulls this cycle&apos;s AR Reminder batch, matches each company to its TAB/TAC invoices generated for FYE {fyeMonth} {fyeYear}, and skips anyone with no invoice yet or no email on file.
            TAO is not connected yet — TAO-only invoices will be missing from the total.
          </div>
        )}
        {type === 'soa' && (
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14 }}>
            Pulls every company with an outstanding (unpaid) balance on a synced TAB/TAC invoice. TAO is not connected yet.
          </div>
        )}

        <button onClick={generate} disabled={generating}
          style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#1d3a5c', color: '#fff', fontWeight: 700, fontSize: 13, cursor: generating ? 'default' : 'pointer', opacity: generating ? 0.7 : 1 }}>
          <Send size={14} />{generating ? 'Generating…' : 'Generate Drafts'}
        </button>

        {result && (
          <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 8, fontSize: 12.5, background: result.ok ? '#f0fdf4' : '#fef2f2', color: result.ok ? '#16a34a' : '#dc2626', border: `1px solid ${result.ok ? '#bbf7d0' : '#fecaca'}` }}>
            {result.msg}
            {result.ok && result.campaignId && (
              <> · <Link href={`/client-communications/drafts?campaignId=${result.campaignId}`} style={{ color: '#1d4ed8', fontWeight: 700 }}>Review drafts →</Link></>
            )}
          </div>
        )}
      </div>

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e3a5f' }}>Recent Campaigns</span>
          <button onClick={loadCampaigns} style={{ marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} style={{ animation: loadingCampaigns ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
        {campaigns.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No campaigns yet.</div>
        ) : campaigns.map(c => (
          <Link key={c.id} href={`/client-communications/drafts?campaignId=${c.id}`}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid #f1f5f9', textDecoration: 'none' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 4, padding: '2px 7px' }}>{TYPE_LABEL[c.type]}</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#1e3a5f' }}>{c.name}</span>
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{c.email_drafts?.[0]?.count ?? 0} drafts · {new Date(c.created_at).toLocaleDateString()}</span>
          </Link>
        ))}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
