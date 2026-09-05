'use client';

import { useEffect, useMemo, useState } from 'react';
import { Receipt, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, X, Download, Send, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { formatStaffName, allStaffNames } from '@/lib/staff-directory';
import OutlookStyleSendModal from '@/components/client-communications/OutlookStyleSendModal';
import type { DraftLike } from '@/lib/draft-helper-client';
import type { SoaCompanyRow } from '@/app/api/billing/soa/route';
import type { SoaInvoiceDetail } from '@/app/api/billing/soa/detail/route';
import { AGING_BUCKETS, type AgingBucket } from '@/lib/soa';

function fmtMoney(n: number) {
  return `S$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// The metric card's 28px/-0.035em letter-spacing (app/globals.css's
// .metric-card-value) squeezes "S$" straight into the digits with no visual
// separation at that size and weight. A dedicated span with its own spacing
// breaks that up, same "small currency tag beside a big number" convention
// most finance dashboards use (Vincent, 2026-09-06: "货币单位和数字...看起来
// 像堆在一起"). Table-cell-sized money elsewhere on this page keeps plain
// fmtMoney() — only the large metric-card figure needed this.
function MoneyValue({ amount }: { amount: number }) {
  return (
    <span style={{ letterSpacing: 'normal' }}>
      <span style={{ fontSize: '0.55em', fontWeight: 700, marginRight: 5, color: '#64748b', verticalAlign: '2px' }}>S$</span>
      {amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
}

const BUCKET_COLOR: Record<AgingBucket, string> = {
  current: '#64748b', d1_30: '#0f766e', d31_60: '#ca8a04', d61_90: '#ea580c', d91_plus: 'var(--status-danger)',
};

const soaListColumns = '32px minmax(220px,1.4fr) 100px 100px 100px 100px 100px 110px 100px 150px';

export default function SoaBillingPage() {
  const [companies, setCompanies] = useState<SoaCompanyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null); // keyed by companyName

  const load = () => {
    setLoadError(null);
    fetch('/api/billing/soa')
      .then(res => res.json())
      .then(json => {
        if (json.error) { setLoadError(json.error); return; }
        setCompanies(json.companies ?? []);
      })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
  };
  useEffect(load, []);

  const counts = useMemo(() => {
    const list = companies ?? [];
    const totalOutstanding = list.reduce((s, c) => s + c.totalOutstanding, 0);
    const seriouslyOverdue = list.filter(c => c.aging.d61_90 > 0 || c.aging.d91_plus > 0).length;
    return { total: list.length, totalOutstanding, seriouslyOverdue };
  }, [companies]);

  const filtered = useMemo(() => {
    let list = companies ?? [];
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(c => c.companyName.toLowerCase().includes(q));
    return list;
  }, [companies, search]);

  const { page, setPage, totalPages, pageItems, startIndex, total } = usePagination(filtered, search);

  // Vincent, 2026-09-06: "PIC有几个人的情况，所以实际上就要在右边多一列可以
  // 让CHELSEA 下拉选择谁才是这个outstanding的主要负责人" — companies.pic can
  // legitimately list co-assigned people; this is a SEPARATE, manually-set
  // assignment (soa_owners, keyed by customer name — not companies.id, since
  // 18% of real customers with a balance have no matching companies row at
  // all) for which ONE of them owns chasing this particular outstanding
  // balance. Optimistic update, matching the click-to-edit pattern used
  // elsewhere in this app.
  const updateSoaPic = (companyName: string, value: string) => {
    setCompanies(current => (current ?? []).map(c => (c.companyName === companyName ? { ...c, soaPic: value || null } : c)));
    fetch('/api/billing/soa', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, soaPic: value || null }),
    }).catch(() => {});
  };

  return (
    <div>
      {companies !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
          <MetricCard value={counts.total} label="Clients With a Balance" sub="any TAB/TAC/TAO invoice still unpaid"
            icon={<Receipt size={16} />} color="#1d3a5c" />
          <MetricCard value={<MoneyValue amount={counts.totalOutstanding} />} label="Total Outstanding" sub="across TAB, TAC and TAO combined"
            icon={<Receipt size={16} />} color="#0f766e" />
          <MetricCard value={counts.seriouslyOverdue} label="61+ Days Overdue" sub="needs a statement sent soon"
            icon={<AlertTriangle size={16} />} color="var(--status-danger)" />
        </div>
      )}

      {loadError && (
        <div style={{ background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{loadError}</div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" placeholder="Search company name…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 13, outline: 'none' }} />
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{total} companies</span>
        </div>
      </div>

      <div className="system-list-shell">
        <div className="system-list-title-bar" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span className="system-list-title">SOA — Statement of Account</span>
            <span className="system-list-title-hint" style={{ marginLeft: 8 }}>Every client with an unpaid balance, aged the same way as QuickBooks&apos; own AR Aging report — click a company to review and generate a combined statement</span>
          </div>
          <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            <RefreshCw size={13} />Refresh
          </button>
        </div>
        <div className="system-list-scroll" style={{ maxHeight: 'calc(100vh - 420px)', minHeight: 400 }}>
          <div style={{ minWidth: 940 }}>
            <div className="list-column-header-gray" style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: soaListColumns, columnGap: 10, padding: '10px 14px', alignItems: 'center' }}>
              {['', 'Company Name', ...AGING_BUCKETS.map(b => b.label), 'Total', 'PIC', 'Owner'].map((h, i) => (
                i >= 2 ? <div key={i} style={{ padding: '0 6px', textAlign: 'center' }}>{h}</div> : <div key={i} style={{ padding: '0 6px' }}>{h}</div>
              ))}
            </div>
            {companies === null && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>}
            {companies !== null && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No outstanding balances — nothing to show.</div>}
            {pageItems.map((c, i) => {
              const isOpen = expanded === c.companyName;
              return (
                <div key={c.companyName} className={`system-list-row${isOpen ? ' system-list-row--selected' : ''}`}
                  onClick={() => setExpanded(isOpen ? null : c.companyName)}
                  style={{ display: 'grid', gridTemplateColumns: soaListColumns, alignItems: 'center', minHeight: 56, columnGap: 10, padding: '11px 14px', cursor: 'pointer' }}>
                  <div style={{ color: '#94a3b8', display: 'flex' }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                  <div style={{ padding: '0 6px' }}>
                    <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#cbd5e1', fontSize: 10 }}>{startIndex + i + 1}</span>{c.companyName}
                    </div>
                  </div>
                  {AGING_BUCKETS.map(b => (
                    <div key={b.key} style={{ textAlign: 'center', fontSize: 11.5, fontWeight: c.aging[b.key] > 0 ? 700 : 400, color: c.aging[b.key] > 0 ? BUCKET_COLOR[b.key] : '#cbd5e1' }}>
                      {c.aging[b.key] > 0 ? fmtMoney(c.aging[b.key]) : '—'}
                    </div>
                  ))}
                  <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 800, color: '#1e3a5f' }}>{fmtMoney(c.totalOutstanding)}</div>
                  <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b' }}>{c.pic ? formatStaffName(c.pic) : '—'}</div>
                  <div onClick={e => e.stopPropagation()} style={{ padding: '0 4px' }}>
                    {(() => {
                      // A customer with no companies.pic at all (no
                      // companies row — an individual, or a real company
                      // never onboarded via TeamWork) still needs an owner
                      // for collections — falls back to every staff name
                      // rather than having nothing to choose from.
                      const options = c.picOptions.length ? c.picOptions : allStaffNames();
                      return (
                        <select value={c.soaPic ?? ''} onChange={e => updateSoaPic(c.companyName, e.target.value)}
                          style={{ width: '100%', border: `1px solid ${c.soaPic ? '#a7f3d0' : '#e2e8f0'}`, borderRadius: 6, padding: '4px 6px', fontSize: 11, background: c.soaPic ? '#ecfdf5' : '#fff', color: c.soaPic ? '#0f766e' : '#94a3b8', cursor: 'pointer' }}>
                          <option value="">{c.picOptions.length === 1 ? c.picOptions[0] : 'Choose owner…'}</option>
                          {options.map(name => <option key={name} value={name}>{name}</option>)}
                        </select>
                      );
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />

      {expanded !== null && (() => {
        const c = (companies ?? []).find(x => x.companyName === expanded);
        if (!c) return null;
        return (
          <div onClick={() => setExpanded(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 780, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', borderLeft: '4px solid #ea580c', padding: '16px 20px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{c.companyName}</div>
                  <button onClick={() => setExpanded(null)} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 16 }}><X size={18} /></button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#fff' }}>{c.invoiceCount} unpaid invoice{c.invoiceCount !== 1 ? 's' : ''} · {fmtMoney(c.totalOutstanding)} total</span>
                  <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                  <span style={{ fontSize: 11, color: '#fff' }}>Review &amp; generate Statement of Account</span>
                </div>
              </div>
              <SoaDetail company={c} onSent={() => { load(); setExpanded(null); }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SoaDetail({ company, onSent }: { company: SoaCompanyRow; onSent: () => void }) {
  const [invoices, setInvoices] = useState<SoaInvoiceDetail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sendModalDraft, setSendModalDraft] = useState<DraftLike | null>(null);
  const [me, setMe] = useState<{ email: string; name: string } | null>(null);
  const [sender, setSender] = useState<{ email: string; display_name: string | null } | null>(null);

  useEffect(() => {
    fetch(`/api/billing/soa/detail?companyName=${encodeURIComponent(company.companyName)}`)
      .then(res => res.json())
      .then(json => { if (json.error) setLoadError(json.error); else setInvoices(json.invoices ?? []); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
    fetch('/api/auth/me').then(r => r.json()).then(j => setMe(j.user ?? null)).catch(() => {});
    fetch('/api/client-communications/senders').then(r => r.json()).then(j => {
      const list = j.data ?? [];
      setSender(list.find((s: { is_default: boolean }) => s.is_default) ?? list[0] ?? null);
    }).catch(() => {});
  }, [company.companyName]);

  const downloadPdf = async () => {
    setDownloading(true); setResult(null);
    try {
      const res = await fetch(`/api/billing/soa/pdf?companyName=${encodeURIComponent(company.companyName)}`);
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Unable to generate the combined PDF.'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `SOA - ${company.companyName} - ${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setResult({ ok: true, msg: `Combined PDF (${company.invoiceCount} invoices) downloaded.` });
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setDownloading(false);
    }
  };

  // Vincent, 2026-09-05: reuses the exact same recipient resolution and
  // template/campaign infrastructure Client Communications' own "Statement
  // of Account" campaign type already has (GET .../campaigns/preview and
  // POST .../campaigns) — this page's own new work is only the aging view
  // and the merged PDF; recipient/CC policy stays the one place it's owned.
  const draftEmail = async () => {
    setDrafting(true); setResult(null);
    try {
      const previewRes = await fetch(`/api/client-communications/campaigns/preview?lookup=${encodeURIComponent(company.companyName)}&type=soa`);
      const previewJson = await previewRes.json();
      if (!previewRes.ok || !previewJson.row) throw new Error(previewJson.error ?? 'Could not resolve a recipient for this company.');
      const row = previewJson.row;
      if (!row.toEmail) throw new Error('No valid recipient email on file for this company — resolve it in Campaign Centre first.');

      const templatesRes = await fetch('/api/client-communications/templates?type=soa');
      const templatesJson = await templatesRes.json();
      const templates = templatesJson.data ?? [];
      const template = templates.find((t: { is_default: boolean }) => t.is_default) ?? templates[0];
      if (!template) throw new Error('No Statement of Account template found — add one in Client Communications › Templates.');

      const createRes = await fetch('/api/client-communications/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'soa', name: `SOA - ${company.companyName} - ${new Date().toISOString().slice(0, 10)}`,
          templateId: template.id, companies: [row], createdByEmail: me?.email, createdByName: me?.name,
        }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok || !createJson.ok) throw new Error(createJson.error ?? 'Unable to create this draft.');
      const createdDraft = createJson.drafts?.[0];
      if (!createdDraft) throw new Error('Draft was not created.');

      const pdfRes = await fetch(`/api/billing/soa/pdf?companyName=${encodeURIComponent(company.companyName)}`);
      if (!pdfRes.ok) { const j = await pdfRes.json().catch(() => ({})); throw new Error(j.error ?? 'Unable to generate the combined PDF.'); }
      const pdfBlob = await pdfRes.blob();
      const pdfFile = new File([pdfBlob], `SOA - ${company.companyName}.pdf`, { type: 'application/pdf' });

      setSendModalDraft({
        id: createdDraft.id, version: createdDraft.version,
        company_name: createdDraft.company_name, to_email: createdDraft.to_email, cc_email: createdDraft.cc_email,
        subject: createdDraft.subject, body: createdDraft.body,
        // Empty on purpose — the merged PDF below replaces the automatic
        // per-invoice attachment fetch (fetchSystemAttachments in
        // lib/draft-helper-client.ts only acts on invoice_refs).
        invoice_refs: [],
        additional_attachments: [pdfFile],
        sender_email: sender?.email ?? 'finance@tassure.com',
        skip_amount_refresh: true,
      });
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div style={{ padding: '20px 20px 24px' }}>
      {loadError && <div style={{ padding: 12, borderRadius: 8, background: 'var(--status-danger-tint)', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{loadError}</div>}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px 90px 90px 100px', gap: 0, background: '#f1f5f9', padding: '10px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          <div>Company</div><div>Invoice</div>
          <div style={{ textAlign: 'center' }}>Txn Date</div>
          <div style={{ textAlign: 'center' }}>Due Date</div>
          <div style={{ textAlign: 'center' }}>Bucket</div>
          <div style={{ textAlign: 'right' }}>Balance</div>
        </div>
        {invoices === null && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading…</div>}
        {invoices !== null && invoices.map(inv => (
          <div key={`${inv.qbCompany}-${inv.invoiceNo}`} style={{ display: 'grid', gridTemplateColumns: '90px 1fr 90px 90px 90px 100px', gap: 0, alignItems: 'center', padding: '9px 10px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#31506f' }}>{inv.qbCompany}</div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>#{inv.invoiceNo}</div>
            <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b' }}>{fmtDate(inv.txnDate)}</div>
            <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b' }}>{fmtDate(inv.dueDate)}</div>
            <div style={{ textAlign: 'center', fontSize: 10.5, fontWeight: 700, color: BUCKET_COLOR[inv.bucket] }}>{AGING_BUCKETS.find(b => b.key === inv.bucket)?.label}</div>
            <div style={{ textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#0f766e' }}>{fmtMoney(inv.balance)}</div>
          </div>
        ))}
      </div>

      {result && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13,
          background: result.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${result.ok ? '#bbf7d0' : '#fecaca'}`, color: result.ok ? '#166534' : '#991b1b' }}>
          {result.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{result.msg}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button onClick={downloadPdf} disabled={downloading || !invoices?.length}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 13, fontWeight: 700, cursor: downloading ? 'default' : 'pointer' }}>
          {downloading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
          {downloading ? 'Merging…' : 'Download SOA PDF'}
        </button>
        <button onClick={draftEmail} disabled={drafting || !invoices?.length}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: 'none', background: drafting || !invoices?.length ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: drafting ? 'default' : 'pointer' }}>
          {drafting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
          {drafting ? 'Preparing…' : 'Draft Email'}
        </button>
      </div>

      {sendModalDraft && (
        <OutlookStyleSendModal
          draft={sendModalDraft}
          sender={sender}
          me={me}
          onClose={() => setSendModalDraft(null)}
          onSent={() => { setSendModalDraft(null); onSent(); }}
        />
      )}
    </div>
  );
}
