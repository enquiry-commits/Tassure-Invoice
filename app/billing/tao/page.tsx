'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt, RefreshCw, Plus, X, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, AlertTriangle, Mail, Trash2, MinusCircle } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal';
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
  //
  // Extended 2026-09-22: this button turned out to have a real dead end —
  // a company already tracked for another service (real TeamWork sync) but
  // never billed under TAO isn't in THIS list (it's built from real TAO
  // eligibility, not from `companies` itself), so typing its name here hit
  // "already exists... search for it instead" pointing at a search that
  // could never find it. UEN is now required (Vincent: "是否有必要加入UEN
  // 做保险机制" — the server checks it before name, since two real
  // companies can never share a UEN, but similar-sounding names do happen —
  // see route.ts's own comment) and Accounts/Tax become an explicit choice
  // instead of a hardcoded `has_accounts: true`. A server response of
  // `needsConfirmation` (a fuzzy name match, not a confident UEN/exact-name
  // one) pauses here for a yes/no rather than silently guessing which real
  // company to flip a service flag on.
  const [addingCompany, setAddingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyUen, setNewCompanyUen] = useState('');
  const [newCompanyAccounts, setNewCompanyAccounts] = useState(true);
  const [newCompanyTax, setNewCompanyTax] = useState(false);
  const [addCompanyError, setAddCompanyError] = useState<string | null>(null);
  const [addCompanySubmitting, setAddCompanySubmitting] = useState(false);
  const [pendingConfirmMatch, setPendingConfirmMatch] = useState<{ id: number; companyName: string; message: string } | null>(null);

  const resetAddCompanyForm = () => {
    setAddingCompany(false); setNewCompanyName(''); setNewCompanyUen('');
    setNewCompanyAccounts(true); setNewCompanyTax(false); setAddCompanyError(null); setPendingConfirmMatch(null);
  };

  const submitNewCompany = async (extra?: { confirmedCompanyId?: number; forceNew?: boolean }) => {
    const name = newCompanyName.trim();
    const uen = newCompanyUen.trim();
    if (!name || !uen || (!newCompanyAccounts && !newCompanyTax)) return;
    setAddCompanySubmitting(true); setAddCompanyError(null);
    try {
      const res = await fetch('/api/billing/tao', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: name, registrationNo: uen,
          services: { accounts: newCompanyAccounts, tax: newCompanyTax },
          ...extra,
        }),
      });
      const json = await res.json();
      if (!res.ok) { setAddCompanyError(json.error ?? 'Could not add this company.'); setPendingConfirmMatch(null); return; }
      if (json.needsConfirmation) { setPendingConfirmMatch({ ...json.candidate, message: json.message }); return; }
      resetAddCompanyForm();
      load();
      setExpanded(json.company.companyName);
    } catch (err) {
      setAddCompanyError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddCompanySubmitting(false);
    }
  };

  // Undo the "+ Add new company" side door above — Vincent, 2026-09-18,
  // after asking for exactly this once (a placeholder row from testing the
  // Add button): "以后这种自己在系统开的公司for 开单的，能不能可以添加过
  // 后删除" (companies I create myself for billing — can they be deleted
  // after adding). Only ever offered for a row with no invoice history yet
  // (lastInvoice === null, same "Never billed" signal already shown) — a
  // company that's genuinely been billed can never pass the server's own
  // deletion checks anyway (see DELETE handler in app/api/billing/tao/
  // route.ts), so there's no point showing the button there. The server is
  // still the real authority: it also refuses a company TeamWork has synced
  // or that has real history anywhere else in the system, with the specific
  // reason surfaced here rather than a generic failure.
  const [pendingDeleteCompany, setPendingDeleteCompany] = useState<TaoCompanyRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);

  const confirmDeleteCompany = async () => {
    const target = pendingDeleteCompany;
    if (!target?.companyId || deleteSubmitting) return;
    setDeleteSubmitting(true);
    // Closed either way, success or refusal — ConfirmDeleteModal is a
    // full-screen overlay, so an error set while it stays open would be
    // invisible behind it until the user separately cancels; the error
    // banner already names the company, so losing the modal's own context
    // costs nothing.
    setPendingDeleteCompany(null);
    try {
      const res = await fetch('/api/billing/tao', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId: target.companyId }),
      });
      const json = await res.json();
      if (!res.ok) { setDeleteError(json.error ?? 'Could not remove this company.'); return; }
      setDeleteError(null);
      if (expanded === target.companyName) setExpanded(null);
      load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleteSubmitting(false);
    }
  };

  // Vincent, 2026-09-22: "假设我后面发现加错公司了怎么办...这个新加的公司后
  // 面发现无效" — for a genuinely fresh row, ConfirmDeleteCompany above
  // already handles it (no tw_status, so DELETE's own server-side gate
  // allows it). But the OTHER add path (POST flipping services_manual on a
  // real TeamWork-tracked company — see TaoCompanyRow.trackedByTeamWork) can
  // never pass that gate, on purpose: it's a real client, deleting the row
  // would be wrong. The correct undo there is clearing the override this
  // page's own Add flow just set, same PATCH /api/companies/service-override
  // endpoint, `value: null` (not `false`) so this only removes what was
  // manually forced on — a real Accounts/Tax history appearing later is
  // still free to make this company TAO-eligible again on its own.
  const [pendingRemoveFromTao, setPendingRemoveFromTao] = useState<TaoCompanyRow | null>(null);
  const [removeFromTaoError, setRemoveFromTaoError] = useState<string | null>(null);
  const [removeFromTaoSubmitting, setRemoveFromTaoSubmitting] = useState(false);

  const confirmRemoveFromTao = async () => {
    const target = pendingRemoveFromTao;
    if (!target?.companyId || removeFromTaoSubmitting) return;
    setRemoveFromTaoSubmitting(true);
    setPendingRemoveFromTao(null);
    try {
      const [accountsRes, taxRes] = await Promise.all([
        fetch('/api/companies/service-override', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: target.companyId, service: 'accounts', value: null }),
        }),
        fetch('/api/companies/service-override', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ companyId: target.companyId, service: 'tax', value: null }),
        }),
      ]);
      const [accountsJson, taxJson] = await Promise.all([accountsRes.json(), taxRes.json()]);
      if (!accountsRes.ok) { setRemoveFromTaoError(accountsJson.error ?? 'Could not remove this company from TAO.'); return; }
      if (!taxRes.ok) { setRemoveFromTaoError(taxJson.error ?? 'Could not remove this company from TAO.'); return; }
      setRemoveFromTaoError(null);
      if (expanded === target.companyName) setExpanded(null);
      load();
    } catch (err) {
      setRemoveFromTaoError(err instanceof Error ? err.message : String(err));
    } finally {
      setRemoveFromTaoSubmitting(false);
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
          <button onClick={() => setAddingCompany(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #a7f3d0', background: '#fff', color: '#0f766e', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
            <Plus size={13} />Add new company
          </button>
        </div>
      </div>

      {/* Vincent, 2026-09-22: "这个能不能变成弹窗" — the inline expanding row
          above squeezed name+UEN+2 checkboxes+Add+Cancel into one toolbar-
          width flex line with no room to breathe. Same modal shell
          ConfirmDeleteModal already uses elsewhere in this app (backdrop +
          centered white card, close on backdrop click), not a new pattern. */}
      {addingCompany && (() => {
        const uenLooksValid = /^(\d{8,9}[A-Z]|(19|20)\d{7}[A-Z])$/.test(newCompanyUen.trim().toUpperCase());
        const canSubmit = !!newCompanyName.trim() && uenLooksValid && (newCompanyAccounts || newCompanyTax);
        return (
          <div onClick={resetAddCompanyForm} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>Add new company</div>
                <button onClick={resetAddCompanyForm} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex', padding: 2 }}><X size={18} /></button>
              </div>

              {pendingConfirmMatch ? (
                <div>
                  <div style={{ fontSize: 13, color: '#334155', marginBottom: 18, lineHeight: 1.5 }}>{pendingConfirmMatch.message}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <button onClick={() => submitNewCompany({ confirmedCompanyId: pendingConfirmMatch.id })} disabled={addCompanySubmitting}
                      style={{ padding: '9px 16px', borderRadius: 8, border: 'none', background: '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: addCompanySubmitting ? 'default' : 'pointer' }}>
                      {addCompanySubmitting ? 'Working…' : `Yes — this is "${pendingConfirmMatch.companyName}"`}
                    </button>
                    <button onClick={() => { setPendingConfirmMatch(null); submitNewCompany({ forceNew: true }); }} disabled={addCompanySubmitting}
                      style={{ padding: '9px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 13, fontWeight: 600, cursor: addCompanySubmitting ? 'default' : 'pointer' }}>
                      No, this is a different company
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#64748b', marginBottom: 5 }}>Company name</label>
                  <input type="text" placeholder="Not yet in the system" value={newCompanyName}
                    onChange={e => setNewCompanyName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && canSubmit) submitNewCompany(); }}
                    autoFocus
                    style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 11px', fontSize: 13.5, outline: 'none', marginBottom: 14 }} />

                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#64748b', marginBottom: 5 }}>UEN</label>
                  <input type="text" placeholder="e.g. 201720273R" value={newCompanyUen}
                    onChange={e => setNewCompanyUen(e.target.value.toUpperCase())}
                    onKeyDown={e => { if (e.key === 'Enter' && canSubmit) submitNewCompany(); }}
                    style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${newCompanyUen.trim() && !uenLooksValid ? '#fca5a5' : '#e2e8f0'}`, borderRadius: 8, padding: '9px 11px', fontSize: 13.5, outline: 'none' }} />
                  {newCompanyUen.trim() && !uenLooksValid && (
                    <div style={{ marginTop: 5, fontSize: 11, color: 'var(--status-danger)' }}>That doesn&apos;t look like a valid Singapore UEN.</div>
                  )}

                  <label style={{ display: 'block', fontSize: 11.5, fontWeight: 700, color: '#64748b', margin: '14px 0 5px' }}>Service(s)</label>
                  <div style={{ display: 'flex', gap: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#334155' }}>
                      <input type="checkbox" checked={newCompanyAccounts} onChange={e => setNewCompanyAccounts(e.target.checked)} />Accounts
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#334155' }}>
                      <input type="checkbox" checked={newCompanyTax} onChange={e => setNewCompanyTax(e.target.checked)} />Tax
                    </label>
                  </div>

                  {addCompanyError && (
                    <div style={{ marginTop: 14, fontSize: 12, color: 'var(--status-danger)', fontWeight: 600, lineHeight: 1.5 }}>{addCompanyError}</div>
                  )}

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 22 }}>
                    <button onClick={resetAddCompanyForm}
                      style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                      Cancel
                    </button>
                    <button onClick={() => submitNewCompany()} disabled={addCompanySubmitting || !canSubmit}
                      style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: addCompanySubmitting || !canSubmit ? '#cbd5e1' : '#0f766e', color: '#fff', fontWeight: 700, fontSize: 13, cursor: addCompanySubmitting ? 'default' : 'pointer' }}>
                      {addCompanySubmitting ? 'Adding…' : 'Add'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

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
        {deleteError && (
          <div style={{ padding: '8px 16px', fontSize: 11.5, color: 'var(--status-danger)', fontWeight: 600, borderTop: '1px solid #fee2e2', background: '#fef2f2' }}>{deleteError}</div>
        )}
        {removeFromTaoError && (
          <div style={{ padding: '8px 16px', fontSize: 11.5, color: '#0369a1', fontWeight: 600, borderTop: '1px solid #bae6fd', background: '#f0f9ff' }}>{removeFromTaoError}</div>
        )}
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
                      {!c.lastInvoice && c.companyId && !c.trackedByTeamWork && (
                        <button
                          onClick={e => { e.stopPropagation(); setDeleteError(null); setPendingDeleteCompany(c); }}
                          title="Remove this company (only possible while it has no real history anywhere)"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', flexShrink: 0 }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#dc2626'; e.currentTarget.style.background = '#fee2e2'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#cbd5e1'; e.currentTarget.style.background = 'transparent'; }}>
                          <Trash2 size={12} />
                        </button>
                      )}
                      {/* A real TeamWork-tracked company never passes DELETE's
                          own tw_status gate (INV-DATA-054) — this is the undo
                          for the OTHER add path instead (POST flipping its
                          services_manual accounts/tax on): clear that
                          override, don't try to delete a real client's row. */}
                      {!c.lastInvoice && c.companyId && c.trackedByTeamWork && (
                        <button
                          onClick={e => { e.stopPropagation(); setRemoveFromTaoError(null); setPendingRemoveFromTao(c); }}
                          title="Take this company off the TAO Accounts/Tax list (does not delete the company)"
                          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', flexShrink: 0 }}
                          onMouseEnter={e => { e.currentTarget.style.color = '#0369a1'; e.currentTarget.style.background = '#e0f2fe'; }}
                          onMouseLeave={e => { e.currentTarget.style.color = '#cbd5e1'; e.currentTarget.style.background = 'transparent'; }}>
                          <MinusCircle size={12} />
                        </button>
                      )}
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

      {pendingDeleteCompany && (
        <ConfirmDeleteModal
          label={pendingDeleteCompany.companyName}
          onCancel={() => setPendingDeleteCompany(null)}
          onConfirm={confirmDeleteCompany}
        />
      )}

      {pendingRemoveFromTao && (
        <ConfirmDeleteModal
          label={pendingRemoveFromTao.companyName}
          onCancel={() => setPendingRemoveFromTao(null)}
          onConfirm={confirmRemoveFromTao}
          tone="neutral"
          title="Take off the TAO list?"
          confirmLabel="Remove from TAO"
          body={<>This removes <strong style={{ color: '#1e293b' }}>{pendingRemoveFromTao.companyName}</strong> from the Accounts/Tax billing list. The company record and its other services (Secretary, ND, etc.) are not affected — if it later gets real Accounts/Tax invoice history, it becomes eligible again on its own.</>}
        />
      )}
    </div>
  );
}

