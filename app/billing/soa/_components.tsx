'use client';

import { useEffect, useMemo, useState } from 'react';
import { Receipt, RefreshCw, ChevronDown, ChevronRight, AlertTriangle, X, Download, Send, Loader2, CheckCircle2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { allStaffNames } from '@/lib/staff-directory';
import OutlookStyleSendModal from '@/components/client-communications/OutlookStyleSendModal';
import type { DraftLike } from '@/lib/draft-helper-client';
import type { QbCompany } from '@/lib/quickbooks';
import type { SoaCompanyRow } from '@/app/api/billing/soa/route';
import type { SoaInvoiceDetail } from '@/app/api/billing/soa/detail/route';
import { AGING_BUCKETS, type AgingBucket } from '@/lib/soa';

function fmtMoney(n: number) {
  return `S$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
// Vincent, 2026-09-07: "这些的所有数字前面都不需要 S$" — the list's own aging
// columns (Current/1-30/.../91+/Total) drop the currency prefix; every
// other money figure on this page (the detail modal's header summary and
// its own invoice-breakdown table) keeps fmtMoney() since he pointed at
// the list specifically, not those.
function fmtNum(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// Non-person Owner values, always selectable for any company — not real
// staff, so never in lib/staff-directory.ts. "BD" = "放着先" (hold off for
// now), confirmed by Vincent 2026-09-07.
const PLACEHOLDER_OWNER_CODES = ['BD'];

const BUCKET_COLOR: Record<AgingBucket, string> = {
  current: '#64748b', d1_30: '#0f766e', d31_60: '#ca8a04', d61_90: '#ea580c', d91_plus: 'var(--status-danger)',
};

const soaListColumns = '32px minmax(220px,1.4fr) 100px 100px 100px 100px 100px 110px 100px 150px';

// Vincent, 2026-09-07: "把 SOA 放成一个单独的2级标题,然后把 TAB/TAC/TAO分成3
// 个不同的3级标题,数据分开" — this used to be one page pooling TAB+TAC+TAO
// together per customer. Now a single company-scoped view, rendered by 3
// thin page.tsx files (tab/, tac/, tao/) each passing their own qbCompany —
// every fetch below is scoped to that ONE QuickBooks system, so a TAB
// statement never shows a TAC or TAO balance and vice versa.
export default function SoaBillingView({ qbCompany }: { qbCompany: QbCompany }) {
  const [companies, setCompanies] = useState<SoaCompanyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [picFilter, setPicFilter] = useState(''); // '' = everyone
  const [expanded, setExpanded] = useState<string | null>(null); // keyed by companyName
  const [exporting, setExporting] = useState(false);
  const [exportingAll, setExportingAll] = useState(false); // full 18-sheet workbook, not just this page's own

  // `silent`: skip the null-out-then-"Loading…" flash — used by the
  // background auto-refresh below, where re-fetching shouldn't visibly
  // reset the table (or collapse an open detail row) every 30s. The
  // manual Refresh button and the initial/company-switch load stay
  // non-silent, since a visible reset there IS the expected feedback.
  const load = (opts?: { silent?: boolean }) => {
    setLoadError(null);
    if (!opts?.silent) setCompanies(null);
    fetch(`/api/billing/soa?company=${qbCompany}`)
      .then(res => res.json())
      .then(json => {
        if (json.error) { setLoadError(json.error); return; }
        setCompanies(json.companies ?? []);
      })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
  };
  // Re-load (not just on mount) when the company changes — the 3 sidebar
  // entries render this same component with a different qbCompany, and
  // Next.js reuses the component instance across sibling routes rather than
  // remounting it, so a plain useEffect(load, []) would keep showing the
  // PREVIOUS company's data after clicking from one tab to another.
  //
  // Vincent, 2026-09-07: "当QUICKBOOK那边更新了...这边的欠款数字会不会更新？
  // 而且最好是实时更新" — the underlying data already updates within
  // seconds of a real QuickBooks change (a live webhook, confirmed against
  // real production events, upserts quickbooks_invoices.balance the moment
  // Intuit notifies us — see app/api/quickbooks/webhook/route.ts). What
  // this page itself lacked was ever re-checking that data on its own — it
  // only fetched once per visit. A 30s silent poll closes that last gap
  // without the disruptive full-page "Loading…" reset a naive re-run of
  // this same effect would cause.
  useEffect(() => {
    load();
    const interval = setInterval(() => load({ silent: true }), 30_000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qbCompany]);
  // Also reset picFilter/search/expanded/page-affecting state when switching
  // companies — a PIC selected on TAB's book shouldn't silently carry over
  // and mis-scope TAC's list before the user notices.
  useEffect(() => { setSearch(''); setPicFilter(''); setExpanded(null); }, [qbCompany]);

  // Vincent, 2026-09-07: "不用再靠人工从 Google Sheet 回填" — Chelsea's real
  // rule (Class on the invoice line, Location as fallback — computed
  // server-side into `suggestedOwner`, see lib/soa-owner.ts) now supplies a
  // real default the moment QuickBooks itself carries the signal, no manual
  // pick required first. A confirmed soa_owners pick (soaPic) still wins
  // when one exists — it's a human override, not just a smarter guess.
  const effectiveOwner = (c: SoaCompanyRow): string | null => c.soaPic ?? c.suggestedOwner;

  // Vincent, 2026-09-06: "我选择某个PIC,她就能看到和自己相关的所有欠款公司" —
  // a person's own book is everything where she's the confirmed Owner, the
  // system's own suggested owner, OR she's still listed on the raw PIC field
  // with no owner (confirmed or suggested) at all yet (so she can find and
  // claim her own unassigned companies too). Only offer names that actually
  // show up somewhere in this data — not the full staff directory, most of
  // whom never touch collections.
  const picFilterOptions = useMemo(() => {
    const names = new Set<string>();
    for (const c of companies ?? []) {
      const owner = effectiveOwner(c);
      if (owner) names.add(owner);
      for (const p of c.picOptions) names.add(p);
    }
    return [...names].sort();
  }, [companies]);

  const picScoped = useMemo(() => {
    const list = companies ?? [];
    if (!picFilter) return list;
    return list.filter(c => effectiveOwner(c) === picFilter || (!effectiveOwner(c) && c.picOptions.includes(picFilter)));
  }, [companies, picFilter]);

  // KPI cards follow the PIC scope (this IS "her own dashboard" once she's
  // picked herself) but not the free-text search box, which stays a
  // find-one-company tool within whatever scope is active.
  const counts = useMemo(() => {
    const list = picScoped;
    const totalOutstanding = list.reduce((s, c) => s + c.totalOutstanding, 0);
    const seriouslyOverdue = list.filter(c => c.aging.d61_90 > 0 || c.aging.d91_plus > 0).length;
    return { total: list.length, totalOutstanding, seriouslyOverdue };
  }, [picScoped]);

  const filtered = useMemo(() => {
    let list = picScoped;
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(c => c.companyName.toLowerCase().includes(q));
    return list;
  }, [picScoped, search]);

  const { page, setPage, totalPages, pageItems, startIndex, total } = usePagination(filtered, `${qbCompany}::${search}::${picFilter}`);

  // Vincent, 2026-09-06: "PIC有几个人的情况，所以实际上就要在右边多一列可以
  // 让CHELSEA 下拉选择谁才是这个outstanding的主要负责人" — companies.pic can
  // legitimately list co-assigned people; this is a SEPARATE, manually-set
  // assignment (soa_owners, keyed by customer name + qb_company, not
  // companies.id — see that table's own migration comments). Originally
  // shared globally across TAB/TAC/TAO on the theory that it's "the same
  // real person regardless of which system billed them" — Vincent,
  // 2026-09-07, comparing against his real 3-tab Google Sheet: that
  // assumption was wrong for 13 of 81 real companies that owe on 2+
  // systems, which genuinely have a DIFFERENT confirmed person per tab
  // (e.g. "Meishan Silk Road Trading": TAB tab says Chin Kah Ye, TAO tab
  // says a different person). A pick made here is scoped to THIS page's
  // own qbCompany only. Optimistic update, matching the click-to-edit
  // pattern used elsewhere in this app.
  const updateSoaPic = (companyName: string, value: string) => {
    setCompanies(current => (current ?? []).map(c => (c.companyName === companyName ? { ...c, soaPic: value || null } : c)));
    fetch('/api/billing/soa', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, soaPic: value || null, company: qbCompany }),
    }).catch(() => {});
  };

  // Vincent, 2026-09-07: "我要可以导出EXCEL，要和GOOGLE SHEET的格式一样" —
  // same blob-download pattern SoaDetail's own downloadPdf() already uses.
  const downloadBlobFrom = async (url: string, fileName: string, onError: (msg: string) => void) => {
    const res = await fetch(url);
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Unable to export.'); }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  };
  const exportExcel = async () => {
    setExporting(true);
    try {
      await downloadBlobFrom(`/api/billing/soa/export?company=${qbCompany}`, `${qbCompany} A-R Ageing - ${new Date().toISOString().slice(0, 10)}.xlsx`, setLoadError);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };
  // Vincent, 2026-09-07: "另外要生成一个完整版的EXCEL（和GOOGLE SHEET 那边
  // 的一样的），要有 TAB/TAC/TAO/每个人员的/internal的" — the full 18-sheet
  // workbook (see app/api/billing/soa/export-all/route.ts), offered from
  // every one of the 3 pages since there's no single shared "SOA home" page
  // to put a combined-export-only button on.
  const exportAllExcel = async () => {
    setExportingAll(true);
    try {
      await downloadBlobFrom('/api/billing/soa/export-all', `SOA - Full Workbook - ${new Date().toISOString().slice(0, 10)}.xlsx`, setLoadError);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setExportingAll(false);
    }
  };

  return (
    <div style={{ paddingTop: 12 }}>
      {/* Vincent, 2026-09-07: exports (green, #397f78) on the left, Refresh
          (dark navy) on the right — matches AR Reminder's own toolbar
          layout. The title+hint that used to live here moved back into the
          list's own dark title bar below (see "SOA — {qbCompany}..." further
          down) — Vincent: "把SOA — TAB Statement of Account...放回去Company
          Name 上面的深蓝色行". */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={exportExcel} disabled={exporting} title={`Just this ${qbCompany} sheet`}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#397f78', color: '#fff', fontSize: 13, cursor: exporting ? 'default' : 'pointer', fontWeight: 600 }}>
            {exporting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileSpreadsheet size={14} />}
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
          <button onClick={exportAllExcel} disabled={exportingAll} title="Full workbook — TAB/TAC/TAO + every staff sheet + Internal"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#397f78', color: '#fff', fontSize: 13, cursor: exportingAll ? 'default' : 'pointer', fontWeight: 600 }}>
            {exportingAll ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <FileSpreadsheet size={14} />}
            {exportingAll ? 'Exporting…' : 'Export Full Workbook'}
          </button>
        </div>
        <button onClick={() => load()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: 'none', background: '#1e3a5f', color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
          <RefreshCw size={14} />Refresh
        </button>
      </div>

      {companies !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
          <MetricCard value={counts.total} label="Clients With a Balance" sub={picFilter ? `${picFilter}'s book` : `any ${qbCompany} invoice still unpaid`}
            icon={<Receipt size={16} />} color="#1d3a5c" />
          <MetricCard value={<MoneyValue amount={counts.totalOutstanding} />} label="Total Outstanding" sub={picFilter ? `${picFilter}'s book` : `${qbCompany} invoices only`}
            icon={<Receipt size={16} />} color="#0f766e" />
          <MetricCard value={counts.seriouslyOverdue} label="61+ Days Overdue" sub={picFilter ? `${picFilter}'s book` : 'needs a statement sent soon'}
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
          <div style={{ width: 1, height: 20, background: '#e2e8f0' }} />
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>My book:</span>
          <select value={picFilter} onChange={e => setPicFilter(e.target.value)}
            style={{ border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 8px', fontSize: 12.5, fontWeight: picFilter ? 700 : 400, background: '#fff', color: picFilter ? '#1e3a5f' : '#334155', cursor: 'pointer', outline: 'none' }}>
            <option value="">Everyone</option>
            {picFilterOptions.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
          {picFilter && (
            <button onClick={() => setPicFilter('')} title="Clear filter"
              style={{ display: 'flex', alignItems: 'center', gap: 4, border: 'none', background: 'none', color: '#94a3b8', fontSize: 11, cursor: 'pointer', padding: '4px 2px' }}>
              <X size={12} />Clear
            </button>
          )}
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{total} companies</span>
        </div>
      </div>

      <div className="system-list-shell">
        <div className="system-list-title-bar" style={{ padding: '8px 16px' }}>
          <div>
            <span className="system-list-title">SOA — {qbCompany} Statement of Account</span>
            <span className="system-list-title-hint" style={{ marginLeft: 8 }}>Aged the same way as QuickBooks&apos; own AR Aging report</span>
          </div>
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
                    {/* Vincent, 2026-09-07: "公司名要统一...都大字母" — some
                        companies (matched via companies.company_name) are
                        already ALL CAPS, others (no companies match — falls
                        back to the raw QuickBooks customer_name) can be
                        mixed case, reading as inconsistent side by side.
                        .toUpperCase() only at display time — the underlying
                        c.companyName stays untouched, since it's also used
                        as an exact lookup key (detail/pdf/campaign-preview
                        fetches). */}
                    <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#cbd5e1', fontSize: 10 }}>{startIndex + i + 1}</span>{c.companyName.toUpperCase()}
                    </div>
                  </div>
                  {AGING_BUCKETS.map(b => (
                    <div key={b.key} style={{ textAlign: 'center', fontSize: 11.5, fontWeight: c.aging[b.key] > 0 ? 700 : 400, color: c.aging[b.key] > 0 ? BUCKET_COLOR[b.key] : '#cbd5e1' }}>
                      {c.aging[b.key] > 0 ? fmtNum(c.aging[b.key]) : '—'}
                    </div>
                  ))}
                  <div style={{ textAlign: 'center', fontSize: 12, fontWeight: 800, color: '#1e3a5f' }}>{fmtNum(c.totalOutstanding)}</div>
                  <div style={{ textAlign: 'center', fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
                    {c.picOptions.length ? c.picOptions.map(name => <div key={name}>{name}</div>) : '—'}
                  </div>
                  <div onClick={e => e.stopPropagation()} style={{ padding: '0 4px' }}>
                    {(() => {
                      // Display priority: (1) soaPic — a human's confirmed
                      // pick, always wins; (2) suggestedOwner — computed
                      // server-side from THIS company's own real QuickBooks
                      // Class/Location data (see lib/soa-owner.ts —
                      // Vincent, 2026-09-07: "不用再靠人工从 Google Sheet
                      // 回填"); (3) the single unambiguous companies.pic
                      // name, only when there's exactly one and no better
                      // signal exists — a last-resort convenience, same as
                      // before this system had any real QB-derived signal.
                      const singlePicFallback = c.picOptions.length === 1 ? c.picOptions[0] : null;
                      const displayedOwner = c.soaPic ?? c.suggestedOwner ?? singlePicFallback;
                      const isConfirmed = !!c.soaPic;

                      // Vincent, 2026-09-07: "假设某个人不在PIC，但是owner
                      // 我要加她怎么办" — the dropdown used to offer ONLY
                      // picOptions once there was at least one (falling back
                      // to the full directory only when picOptions was
                      // completely empty), so Chelsea had no way to hand an
                      // outstanding balance to someone who simply hasn't
                      // touched this company yet (a coverage reassignment,
                      // someone new taking over). Now always offers everyone
                      // — picOptions/displayedOwner grouped first as the
                      // likely picks, every other real staff name below,
                      // alphabetical since that group is too long to scan
                      // in file-declaration order.
                      const likely = displayedOwner && !c.picOptions.includes(displayedOwner)
                        ? [displayedOwner, ...c.picOptions] : c.picOptions;
                      const likelySet = new Set(likely);
                      const everyoneElse = allStaffNames().filter(n => !likelySet.has(n)).sort();
                      // Vincent, 2026-09-07: "每个公司都能放BD" — "BD" ("放着
                      // 先", a deliberate hold-off marker, not a real person)
                      // must be pickable for ANY company, not only the 3 it
                      // happened to already be backfilled onto. Excluded from
                      // its own group when it's already the row's current
                      // value (already shown once, in "Associated" above).
                      const placeholders = PLACEHOLDER_OWNER_CODES.filter(code => !likelySet.has(code));
                      return (
                        <select value={displayedOwner ?? ''} onChange={e => updateSoaPic(c.companyName, e.target.value)}
                          title={!isConfirmed && c.suggestedOwner ? 'Suggested from QuickBooks — not yet confirmed' : undefined}
                          style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '4px 6px', fontSize: 11, background: '#fff', color: isConfirmed ? '#1e3a5f' : displayedOwner ? '#0f766e' : '#94a3b8', fontWeight: isConfirmed ? 600 : 400, cursor: 'pointer' }}>
                          <option value="">Choose owner…</option>
                          {likely.length > 0 ? (
                            <>
                              <optgroup label="Associated with this company">
                                {likely.map(name => <option key={name} value={name}>{name}</option>)}
                              </optgroup>
                              <optgroup label="All staff">
                                {everyoneElse.map(name => <option key={name} value={name}>{name}</option>)}
                              </optgroup>
                            </>
                          ) : everyoneElse.map(name => <option key={name} value={name}>{name}</option>)}
                          {placeholders.length > 0 && (
                            <optgroup label="Other">
                              {placeholders.map(code => <option key={code} value={code}>{code}</option>)}
                            </optgroup>
                          )}
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
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{c.companyName.toUpperCase()}</div>
                  <button onClick={() => setExpanded(null)} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 16 }}><X size={18} /></button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#fff' }}>{qbCompany} · {c.invoiceCount} unpaid invoice{c.invoiceCount !== 1 ? 's' : ''} · {fmtMoney(c.totalOutstanding)} total</span>
                  <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                  <span style={{ fontSize: 11, color: '#fff' }}>Review &amp; generate Statement of Account</span>
                </div>
              </div>
              <SoaDetail company={c} qbCompany={qbCompany} onSent={() => { load(); setExpanded(null); }} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function SoaDetail({ company, qbCompany, onSent }: { company: SoaCompanyRow; qbCompany: QbCompany; onSent: () => void }) {
  const [invoices, setInvoices] = useState<SoaInvoiceDetail[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [sendModalDraft, setSendModalDraft] = useState<DraftLike | null>(null);
  const [me, setMe] = useState<{ email: string; name: string } | null>(null);
  const [sender, setSender] = useState<{ email: string; display_name: string | null } | null>(null);

  useEffect(() => {
    fetch(`/api/billing/soa/detail?companyName=${encodeURIComponent(company.companyName)}&company=${qbCompany}`)
      .then(res => res.json())
      .then(json => { if (json.error) setLoadError(json.error); else setInvoices(json.invoices ?? []); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
    fetch('/api/auth/me').then(r => r.json()).then(j => setMe(j.user ?? null)).catch(() => {});
    fetch('/api/client-communications/senders').then(r => r.json()).then(j => {
      const list = j.data ?? [];
      setSender(list.find((s: { is_default: boolean }) => s.is_default) ?? list[0] ?? null);
    }).catch(() => {});
  }, [company.companyName, qbCompany]);

  const downloadPdf = async () => {
    setDownloading(true); setResult(null);
    try {
      const res = await fetch(`/api/billing/soa/pdf?companyName=${encodeURIComponent(company.companyName)}&company=${qbCompany}`);
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? 'Unable to generate the combined PDF.'); }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `SOA (${qbCompany}) - ${company.companyName} - ${new Date().toISOString().slice(0, 10)}.pdf`;
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
          type: 'soa', name: `SOA (${qbCompany}) - ${company.companyName} - ${new Date().toISOString().slice(0, 10)}`,
          templateId: template.id, companies: [row], createdByEmail: me?.email, createdByName: me?.name,
        }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok || !createJson.ok) throw new Error(createJson.error ?? 'Unable to create this draft.');
      const createdDraft = createJson.drafts?.[0];
      if (!createdDraft) throw new Error('Draft was not created.');

      const pdfRes = await fetch(`/api/billing/soa/pdf?companyName=${encodeURIComponent(company.companyName)}&company=${qbCompany}`);
      if (!pdfRes.ok) { const j = await pdfRes.json().catch(() => ({})); throw new Error(j.error ?? 'Unable to generate the combined PDF.'); }
      const pdfBlob = await pdfRes.blob();
      const pdfFile = new File([pdfBlob], `SOA (${qbCompany}) - ${company.companyName}.pdf`, { type: 'application/pdf' });

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
