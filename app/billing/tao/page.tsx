'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt, RefreshCw, Plus, X, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, AlertTriangle, Mail } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { isValidEmail } from '@/lib/campaign-recipients';
import { rollRecurringDescriptionForward } from '@/lib/invoice-period';
import type { TaoCompanyRow } from '@/app/api/billing/tao/route';
import type { TaoServiceHistoryItem } from '@/app/api/billing/tao/service-history/route';
// The builder + its shared display helpers now live in components/billing/
// so the chat assistant can open the SAME builder (see that file's header).
import TaoInvoiceBuilder, { fmtMoney, fmtDate, TaoInvoiceRef } from '@/components/billing/TaoInvoiceBuilder';

const taoListColumns = '32px minmax(230px,1.55fr) 120px 130px 110px 100px';

// Curated real TAO product/service names (from actual QuickBooks TAO line
// items) — picking one of these resolves to the exact QB Item via
// buildInvoiceLineArray's exact match (lib/qb-invoice-conventions.ts), so the
// invoice item lines up with QuickBooks' own catalogue instead of falling
// back to a fuzzy keyword guess. Same shape/role as app/billing/page.tsx's
// QB_CATALOG, used the same way: picked once from the "Add line" dropdown
// (grouped by category), not re-picked per line afterwards (Vincent,
// 2026-09-05: "TAO 的这部分不能和 TAB/TAC的一样吗" pointing at that exact
// catalogue-dropdown-appends-a-line pattern).
export default function TaoBillingPage() {
  const [companies, setCompanies] = useState<TaoCompanyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'never' | 'billed'>('all');
  const [expanded, setExpanded] = useState<string | null>(null); // keyed by companyName

  // Vincent, 2026-09-05: "TAO 那边...页面上加一个'新增公司'入口" — the GET
  // list above only draws from `companies` + real QuickBooks history, so a
  // genuinely new client (never synced from TeamWork, no QB invoices yet)
  // has no way to appear otherwise. This is a deliberate side door, not a
  // TeamWork-replacement — see app/api/billing/tao/route.ts's POST handler.
  const [addingCompany, setAddingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [addCompanyError, setAddCompanyError] = useState<string | null>(null);
  const [addCompanySubmitting, setAddCompanySubmitting] = useState(false);

  const submitNewCompany = async () => {
    const name = newCompanyName.trim();
    if (!name) return;
    setAddCompanySubmitting(true); setAddCompanyError(null);
    try {
      const res = await fetch('/api/billing/tao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName: name }),
      });
      const json = await res.json();
      if (!res.ok) { setAddCompanyError(json.error ?? 'Could not add this company.'); return; }
      setAddingCompany(false); setNewCompanyName('');
      load();
      setExpanded(json.company.companyName);
    } catch (err) {
      setAddCompanyError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddCompanySubmitting(false);
    }
  };

  const load = () => {
    setLoadError(null);
    fetch('/api/billing/tao')
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
    const billed = list.filter(c => c.lastInvoice).length;
    return { total: list.length, never: list.length - billed, billed };
  }, [companies]);

  const filtered = useMemo(() => {
    let list = companies ?? [];
    if (filter === 'never') list = list.filter(c => !c.lastInvoice);
    if (filter === 'billed') list = list.filter(c => c.lastInvoice);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(c => c.companyName.toLowerCase().includes(q));
    return list;
  }, [companies, filter, search]);

  const { page, setPage, totalPages, pageItems, startIndex, total } = usePagination(filtered, `${filter}|${search}`);

  return (
    <div>
      {companies !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
          <MetricCard onClick={() => setFilter('all')} active={filter === 'all'}
            value={counts.total} label="Accounts / Tax Clients" sub="companies with real QB Accounts/Tax history"
            icon={<Receipt size={16} />} color="#1d3a5c" ariaLabel="Show all TAO-eligible companies" />
          <MetricCard onClick={() => setFilter('never')} active={filter === 'never'}
            value={counts.never} label="Never Billed via TAO" sub="no TAO invoice on file yet"
            icon={<AlertTriangle size={16} />} color="#c2410c" ariaLabel="Filter to companies never billed via TAO" />
          <MetricCard onClick={() => setFilter('billed')} active={filter === 'billed'}
            value={counts.billed} label="Billed Before" sub="has at least one real TAO invoice"
            icon={<CheckCircle2 size={16} />} color="var(--status-success)" ariaLabel="Filter to companies billed before via TAO" />
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
          <button onClick={() => { setAddingCompany(v => !v); setAddCompanyError(null); }}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #a7f3d0', background: addingCompany ? '#ecfdf5' : '#fff', color: '#0f766e', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
            <Plus size={13} />Add new company
          </button>
        </div>
        {addingCompany && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
            <input type="text" placeholder="Company name (not yet in the system)" value={newCompanyName}
              onChange={e => setNewCompanyName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitNewCompany(); }}
              autoFocus
              style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 10px', fontSize: 13, outline: 'none' }} />
            <button onClick={submitNewCompany} disabled={addCompanySubmitting || !newCompanyName.trim()}
              style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: addCompanySubmitting || !newCompanyName.trim() ? '#cbd5e1' : '#0f766e', color: '#fff', fontSize: 12, fontWeight: 700, cursor: addCompanySubmitting ? 'default' : 'pointer' }}>
              {addCompanySubmitting ? 'Adding…' : 'Add'}
            </button>
            <button onClick={() => { setAddingCompany(false); setNewCompanyName(''); setAddCompanyError(null); }}
              style={{ padding: '6px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
          </div>
        )}
        {addCompanyError && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--status-danger)', fontWeight: 600 }}>{addCompanyError}</div>
        )}
      </div>

      <div className="system-list-shell">
        <div className="system-list-title-bar" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <span className="system-list-title">TAO — Accounts / Tax Billing</span>
            <span className="system-list-title-hint" style={{ marginLeft: 8 }}>ACC&apos;s own billing, separate from Chelsea&apos;s TAB / TAC drafts — click a company to build and generate an invoice</span>
          </div>
          <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
            <RefreshCw size={13} />Refresh
          </button>
        </div>
        <div className="system-list-scroll" style={{ maxHeight: 'calc(100vh - 420px)', minHeight: 400 }}>
          <div style={{ minWidth: 760 }}>
            <div className="list-column-header-gray" style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: taoListColumns, columnGap: 10, padding: '10px 14px', alignItems: 'center' }}>
              {['', 'Company Name', 'Status', 'Last TAO Invoice', 'Last Billed', 'Amount'].map((h, i) => (
                i >= 2 ? <div key={i} style={{ padding: '0 6px', textAlign: 'center' }}>{h}</div> : <div key={i} style={{ padding: '0 6px' }}>{h}</div>
              ))}
            </div>
            {companies === null && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>}
            {companies !== null && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No matching companies</div>}
            {pageItems.map((c, i) => {
              const isOpen = expanded === c.companyName;
              return (
                <div key={c.companyName} className={`system-list-row${isOpen ? ' system-list-row--selected' : ''}`}
                  onClick={() => setExpanded(isOpen ? null : c.companyName)}
                  style={{ display: 'grid', gridTemplateColumns: taoListColumns, alignItems: 'center', minHeight: 56, columnGap: 10, padding: '11px 14px', cursor: 'pointer' }}>
                  <div style={{ color: '#94a3b8', display: 'flex' }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                  <div style={{ padding: '0 6px' }}>
                    <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#cbd5e1', fontSize: 10 }}>{startIndex + i + 1}</span>{c.companyName}
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    {c.lastInvoice
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, background: '#fff', border: '1px solid #bbf7d0', color: '#15803d', fontSize: 9.5, fontWeight: 750 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#15803d' }} />Billed</span>
                      : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, background: '#fff', border: '1px solid #fed7aa', color: '#c2410c', fontSize: 9.5, fontWeight: 750 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#c2410c' }} />Never billed</span>}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}><TaoInvoiceRef invoiceNo={c.lastInvoice?.invoiceNo} /></div>
                  <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b' }}>{fmtDate(c.lastInvoice?.txnDate ?? null)}</div>
                  <div style={{ textAlign: 'center', fontSize: 11, color: '#374151', fontWeight: 600 }}>{c.lastInvoice ? fmtMoney(c.lastInvoice.totalAmt ?? 0) : '—'}</div>
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
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 860, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', borderLeft: '4px solid #397f78', padding: '16px 20px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{c.companyName}</div>
                  <button onClick={() => setExpanded(null)} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 16 }}><X size={18} /></button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  {c.lastInvoice
                    ? <span style={{ fontSize: 11, color: '#fff' }}>Last: TAO #{c.lastInvoice.invoiceNo.replace(/^TAO/i, '')} · {fmtDate(c.lastInvoice.txnDate)} · {fmtMoney(c.lastInvoice.totalAmt ?? 0)}</span>
                    : <span style={{ fontSize: 11, color: '#fff' }}>No TAO invoice history yet</span>}
                  <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                  <span style={{ fontSize: 11, color: '#fff' }}>Build &amp; generate TAO invoice</span>
                </div>
              </div>
              <TaoInvoiceBuilder company={c} onGenerated={() => { load(); setExpanded(null); }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

