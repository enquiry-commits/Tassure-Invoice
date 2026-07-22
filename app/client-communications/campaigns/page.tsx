'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { Send, RefreshCw, ArrowLeft, Trash2, Plus, Loader2 } from 'lucide-react';
import CommsTabs from '@/components/client-communications/CommsTabs';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal';

const FYE_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const TYPE_LABEL: Record<string, string> = { ar: 'AR Renewal Reminder', soa: 'Statement of Account', letter: 'Document Reminder' };

interface Template { id: number; type: string; name: string; is_default: boolean }
interface Sender { id: number; email: string; display_name: string | null; is_default: boolean }
interface Campaign {
  id: number; type: string; name: string; fye_month: string | null; fye_year: number | null;
  status: string; created_at: string; created_by_name: string | null;
  email_drafts: { count: number }[];
}
interface InvoiceRef { qbCompany: string; invoiceNo: string; amount: number }
interface Row {
  companyName: string; companyId: number | null;
  toEmail: string | null; ccEmail: string | null; contactName: string;
  invoiceRefs: InvoiceRef[]; totalAmount: number;
  included: boolean; reason: string | null;
  recipientSource: 'teamwork_report' | 'company_fallback' | 'missing';
  recipientSyncedAt: string | null;
  recipientReviewRequired: boolean;
}
interface CompanySearchHit { companyName: string; bestEmail: string | null }

const S: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13, background: '#fff', outline: 'none', color: '#1e3a5f' };
// checkbox | company | to | cc | invoices | amount | note | remove
const ROW_GRID = '28px minmax(140px,1.2fr) minmax(170px,1.5fr) minmax(150px,1.3fr) minmax(140px,1.3fr) 84px minmax(110px,1fr) 26px';
const ROW_GRID_MIN_WIDTH = 980;

export default function CampaignCentrePage() {
  const [step, setStep] = useState<'setup' | 'review'>('setup');
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
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; campaignId?: number } | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [pendingDeleteCampaign, setPendingDeleteCampaign] = useState<{ id: number; name: string } | null>(null);
  const [me, setMe] = useState<{ email: string; name: string } | null>(null);

  const [rows, setRows] = useState<Row[]>([]);
  const [addName, setAddName] = useState('');
  const [addResults, setAddResults] = useState<CompanySearchHit[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : { user: null }).then(j => setMe(j.user ?? null)).catch(() => setMe(null));
  }, []);

  // Default FYE Month/Year to the cycle staff are actually invoicing right
  // now (same source Billing Drafts uses), not just today's calendar month —
  // the two used to disagree whenever the current month hadn't been billed
  // yet.
  useEffect(() => {
    fetch('/api/ar-reminder/latest')
      .then(r => r.json())
      .then(({ month: m, year: y }) => { if (m) setFyeMonth(String(m)); if (y) setFyeYear(String(y)); })
      .catch(() => {});
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

  const preview = async () => {
    if (!templateId) { setResult({ ok: false, msg: 'Choose a template first.' }); return; }
    const companyNames = type === 'letter'
      ? letterCompanies.split('\n').map(s => s.trim()).filter(Boolean)
      : undefined;
    if (type === 'letter' && !companyNames?.length) { setResult({ ok: false, msg: 'Enter at least one company name.' }); return; }

    setPreviewing(true); setResult(null);
    try {
      const res = await fetch('/api/client-communications/campaigns/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, companyNames, onlyUnsent: true,
          fyeMonth: type === 'ar' ? fyeMonth : undefined,
          fyeYear: type === 'ar' ? Number(fyeYear) : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setResult({ ok: false, msg: json.error ?? 'Failed to preview companies.' }); return; }
      if (!json.rows.length) { setResult({ ok: false, msg: 'No companies matched this selection.' }); return; }
      setRows(json.rows);
      setAddName(''); setAddResults([]); setAddError(null);
      setStep('review');
    } catch (e: unknown) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Request failed' });
    } finally { setPreviewing(false); }
  };

  const confirmGenerate = async () => {
    const included = rows.filter(r => r.included);
    if (!included.length) { setResult({ ok: false, msg: 'Select at least one company.' }); return; }
    if (!templateId) { setResult({ ok: false, msg: 'Choose a template first.' }); return; }
    setGenerating(true); setResult(null);
    try {
      const res = await fetch('/api/client-communications/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type, name, templateId, senderId,
          fyeMonth: type === 'ar' ? fyeMonth : undefined,
          fyeYear: type === 'ar' ? Number(fyeYear) : undefined,
          companies: included.map(r => ({
            companyName: r.companyName, companyId: r.companyId, toEmail: r.toEmail,
            ccEmail: r.ccEmail, contactName: r.contactName, invoiceRefs: r.invoiceRefs, totalAmount: r.totalAmount,
          })),
          createdByEmail: me?.email, createdByName: me?.name,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setResult({ ok: false, msg: json.error ?? 'Failed to generate drafts.' }); return; }
      const skippedMsg = json.skipped?.length ? ` · ${json.skipped.length} skipped` : '';
      setResult({ ok: true, msg: `${json.draftsCreated} draft(s) created${skippedMsg}.`, campaignId: json.campaignId });
      setStep('setup'); setRows([]);
      loadCampaigns();
    } catch (e: unknown) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : 'Request failed' });
    } finally { setGenerating(false); }
  };

  const searchCompanies = (term: string) => {
    setAddName(term);
    setAddError(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!term.trim()) { setAddResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/companies?search=${encodeURIComponent(term.trim())}`);
      const json = await res.json();
      const already = new Set(rows.map(r => r.companyName.toLowerCase()));
      setAddResults((json.data ?? []).filter((c: CompanySearchHit) => !already.has(c.companyName.toLowerCase())).slice(0, 8));
    }, 300);
  };

  const addCompanyByName = async (rawName: string) => {
    const trimmed = rawName.trim();
    if (!trimmed) return;
    setAddError(null); setAdding(true);
    try {
      const params = new URLSearchParams({ lookup: trimmed, type });
      if (type === 'ar') { params.set('fyeMonth', fyeMonth); params.set('fyeYear', fyeYear); }
      const res = await fetch(`/api/client-communications/campaigns/preview?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) { setAddError(json.error ?? 'Company not found.'); return; }
      const row = json.row as Row;
      const finalRow: Row = { ...row };
      setRows(prev => {
        const idx = prev.findIndex(r => r.companyName.toLowerCase() === finalRow.companyName.toLowerCase());
        const next = idx >= 0 ? prev.map((r, i) => i === idx ? finalRow : r) : [...prev, finalRow];
        return next.sort((a, b) => a.companyName.localeCompare(b.companyName));
      });
      setAddName(''); setAddResults([]);
    } finally { setAdding(false); }
  };

  const toggleRow = (i: number) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, included: !r.included } : r));
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const updateRowEmail = (i: number, value: string) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, toEmail: value } : r));
  const updateRowCc = (i: number, value: string) => setRows(prev => prev.map((r, idx) => idx === i ? { ...r, ccEmail: value || null } : r));
  const includedCount = rows.filter(r => r.included).length;

  const requestDeleteCampaign = (c: Campaign, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation();
    setPendingDeleteCampaign({ id: c.id, name: c.name });
  };

  const confirmDeleteCampaign = async () => {
    if (!pendingDeleteCampaign) return;
    const { id } = pendingDeleteCampaign;
    setPendingDeleteCampaign(null);
    setDeletingId(id);
    try {
      const res = await fetch(`/api/client-communications/campaigns/${id}`, { method: 'DELETE' });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? 'Delete failed.'); return; }
      loadCampaigns();
    } finally { setDeletingId(null); }
  };

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Billing System › Client Communications</div>
      <CommsTabs />

      {step === 'setup' && (
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
              Pulls this cycle&apos;s AR Reminder batch, matches each company to its TAB/TAC invoices generated for FYE {fyeMonth} {fyeYear}.
              The next step shows exactly who is included before anything is created, so you can uncheck, remove, or add companies yourself.
              TAO is not connected yet — TAO-only invoices will be missing from the total.
            </div>
          )}
          {type === 'soa' && (
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 14 }}>
              Pulls every company with an outstanding (unpaid) balance on a synced TAB/TAC invoice. TAO is not connected yet.
              The next step shows exactly who is included before anything is created, so you can uncheck, remove, or add companies yourself.
            </div>
          )}

          <button onClick={preview} disabled={previewing}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#1d3a5c', color: '#fff', fontWeight: 700, fontSize: 13, cursor: previewing ? 'default' : 'pointer', opacity: previewing ? 0.7 : 1 }}>
            {previewing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
            {previewing ? 'Loading companies…' : 'Preview Companies'}
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
      )}

      {step === 'review' && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: 20, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <button onClick={() => setStep('setup')}
              style={{ display: 'flex', alignItems: 'center', gap: 5, border: 'none', background: 'transparent', color: '#64748b', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', padding: '4px 0' }}>
              <ArrowLeft size={14} />Back
            </button>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#1e3a5f' }}>{name}</div>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 4, padding: '2px 7px' }}>{TYPE_LABEL[type]}</span>
            {type === 'ar' && <span style={{ fontSize: 11, color: '#94a3b8' }}>FYE {fyeMonth} {fyeYear}</span>}
          </div>
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 14 }}>
            Review who gets a draft before anything is generated. Uncheck to skip someone, add a company manually, or remove a row entirely.
            The TeamWork Report recipient list is used by all three campaign types. Customer emails go to To and Tassure emails go to CC.
            Each address is shown on its own line and remains editable for the final human review.
            Rules applied: cindy@tassure.com is excluded; hoechyi@tassure.com is always CC; when kahye@tassure.com is present, sengxin@tassure.com is excluded.
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: '1 1 260px', minWidth: 220 }}>
              <input value={addName} onChange={e => searchCompanies(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') addCompanyByName(addName); }}
                placeholder="Add a company by name…" style={{ ...S, width: '100%' }} />
              {(addResults.length > 0 || adding) && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 4px 14px rgba(15,23,42,0.08)', zIndex: 10, maxHeight: 220, overflowY: 'auto' }}>
                  {adding && <div style={{ padding: '8px 12px', fontSize: 12, color: '#94a3b8' }}>Looking up…</div>}
                  {addResults.map(c => (
                    <div key={c.companyName} onClick={() => addCompanyByName(c.companyName)}
                      style={{ padding: '8px 12px', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid #f1f5f9', color: '#1e3a5f' }}
                      onMouseDown={e => e.preventDefault()}>
                      {c.companyName}
                      {!c.bestEmail && <span style={{ color: '#dc2626', fontSize: 10.5, marginLeft: 6 }}>no email on file</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => addCompanyByName(addName)} disabled={!addName.trim() || adding}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 12px', borderRadius: 8, border: '1px solid #1d3a5c', background: '#fff', color: '#1d3a5c', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
              <Plus size={13} />Add
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 12.5, fontWeight: 700, color: '#1e3a5f' }}>{includedCount} of {rows.length} selected</span>
          </div>
          {addError && <div style={{ fontSize: 11.5, color: '#dc2626', marginBottom: 10, marginTop: -4 }}>{addError}</div>}

          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto', marginBottom: 16 }}>
            <div style={{ minWidth: ROW_GRID_MIN_WIDTH }}>
              <div style={{ display: 'grid', gridTemplateColumns: ROW_GRID, gap: 8, padding: '8px 10px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>
                <span /><span>Company</span><span>To</span><span>CC</span><span>Invoices</span><span>Amount</span><span>Note</span><span />
              </div>
              <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                {rows.map((r, i) => {
                  const hasEmail = !!r.toEmail?.trim();
                  // Once a reviewer types in a missing email, the original "no email"
                  // reason no longer applies — drop it so the note doesn't look stale.
                  const displayReason = r.reason === 'No email on file' && hasEmail ? null : r.reason;
                  return (
                    <div key={`${r.companyName}-${i}`} style={{ display: 'grid', gridTemplateColumns: ROW_GRID, gap: 8, alignItems: 'center', padding: '8px 10px', borderBottom: '1px solid #f1f5f9', background: r.included ? '#fff' : '#fafbfc', opacity: r.included ? 1 : 0.65 }}>
                      <input type="checkbox" checked={r.included} disabled={!hasEmail} onChange={() => toggleRow(i)} style={{ cursor: hasEmail ? 'pointer' : 'not-allowed' }} />
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: '#1e3a5f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.companyName}>{r.companyName}</div>
                        <div title={r.recipientSyncedAt ? `Last synced ${new Date(r.recipientSyncedAt).toLocaleString()}` : undefined}
                          style={{ marginTop: 3, fontSize: 9.5, fontWeight: 700, color: r.recipientSource === 'teamwork_report' ? '#15803d' : '#c2410c' }}>
                          {r.recipientSource === 'teamwork_report' ? 'TEAMWORK REPORT' : r.recipientSource === 'company_fallback' ? 'FALLBACK · REVIEW' : 'NO RECIPIENT DATA'}
                        </div>
                      </div>
                      <textarea value={r.toEmail ?? ''} onChange={e => updateRowEmail(i, e.target.value)} placeholder={'customer@company.com\nfinance@company.com'}
                        rows={Math.max(2, Math.min(5, (r.toEmail ?? '').split(/\r?\n/).filter(Boolean).length))}
                        style={{ fontSize: 11.5, lineHeight: 1.45, padding: '5px 7px', borderRadius: 6, border: `1px solid ${hasEmail ? '#e2e8f0' : '#fecaca'}`, background: hasEmail ? '#fff' : '#fef2f2', color: '#1e3a5f', outline: 'none', width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
                      <textarea value={r.ccEmail ?? ''} onChange={e => updateRowCc(i, e.target.value)} placeholder={'hoechyi@tassure.com\noptional@tassure.com'}
                        rows={Math.max(2, Math.min(5, (r.ccEmail ?? '').split(/\r?\n/).filter(Boolean).length))}
                        style={{ fontSize: 11.5, lineHeight: 1.45, padding: '5px 7px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#1e3a5f', outline: 'none', width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
                      <span style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.invoiceRefs.map(x => `${x.qbCompany} #${x.invoiceNo}`).join(', ')}>
                        {r.invoiceRefs.length ? r.invoiceRefs.map(x => `${x.qbCompany}#${x.invoiceNo}`).join(', ') : '—'}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#0f766e' }}>{r.totalAmount ? `S$${r.totalAmount.toLocaleString()}` : '—'}</span>
                      <span style={{ fontSize: 10.5, color: '#c2410c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={displayReason ?? ''}>{displayReason ?? ''}</span>
                      <button onClick={() => removeRow(i)} title="Remove from this campaign"
                        style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <button onClick={confirmGenerate} disabled={generating || !includedCount}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#1d3a5c', color: '#fff', fontWeight: 700, fontSize: 13, cursor: (generating || !includedCount) ? 'default' : 'pointer', opacity: (generating || !includedCount) ? 0.6 : 1 }}>
            {generating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
            {generating ? 'Generating…' : `Confirm & Generate ${includedCount} Draft${includedCount === 1 ? '' : 's'}`}
          </button>

          {result && !result.ok && (
            <div style={{ marginTop: 12, padding: '9px 12px', borderRadius: 8, fontSize: 12.5, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
              {result.msg}
            </div>
          )}
        </div>
      )}

      {result && result.ok && step === 'setup' && (
        <div style={{ marginBottom: 20, padding: '9px 12px', borderRadius: 8, fontSize: 12.5, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
          {result.msg}
          {result.campaignId && (
            <> · <Link href={`/client-communications/drafts?campaignId=${result.campaignId}`} style={{ color: '#1d4ed8', fontWeight: 700 }}>Review drafts →</Link></>
          )}
        </div>
      )}

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
            <button onClick={e => requestDeleteCampaign(c, e)} disabled={deletingId === c.id} title="Delete campaign"
              style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: deletingId === c.id ? 'default' : 'pointer', display: 'flex', alignItems: 'center', padding: 2 }}>
              {deletingId === c.id ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Trash2 size={14} />}
            </button>
          </Link>
        ))}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {pendingDeleteCampaign && (
        <ConfirmDeleteModal
          label={pendingDeleteCampaign.name}
          onCancel={() => setPendingDeleteCampaign(null)}
          onConfirm={confirmDeleteCampaign}
        />
      )}
    </div>
  );
}
