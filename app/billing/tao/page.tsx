'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt, RefreshCw, Plus, X, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, AlertTriangle, Mail, History } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { isValidEmail } from '@/lib/campaign-recipients';
import type { TaoCompanyRow } from '@/app/api/billing/tao/route';
import type { TaoServiceHistoryItem } from '@/app/api/billing/tao/service-history/route';

// Curated real TAO product/service names (from actual QuickBooks TAO line
// items) — picking one of these resolves to the exact QB Item via
// buildInvoiceLineArray's exact match (lib/qb-invoice-conventions.ts), so the
// invoice item lines up with QuickBooks' own catalogue instead of falling
// back to a fuzzy keyword guess. Same shape/role as app/billing/page.tsx's
// QB_CATALOG, used the same way: picked once from the "Add line" dropdown
// (grouped by category), not re-picked per line afterwards (Vincent,
// 2026-09-05: "TAO 的这部分不能和 TAB/TAC的一样吗" pointing at that exact
// catalogue-dropdown-appends-a-line pattern).
const TAO_PRODUCTS: { label: string; category: string; productService: string; service: string }[] = [
  { label: 'Compilation Report Services', category: 'Accounts', productService: 'Accounts:Compilation Report Services', service: 'Accounts' },
  { label: 'Yearly Accounts Services',    category: 'Accounts', productService: 'Accounts:Yearly Accounts Services',    service: 'Accounts' },
  { label: 'Quarterly Accounts Services', category: 'Accounts', productService: 'Accounts:Quarterly Accounts Services', service: 'Accounts' },
  { label: 'Monthly Accounts Services',   category: 'Accounts', productService: 'Accounts:Monthly Accounts Services',   service: 'Accounts' },
  { label: 'Account Review',              category: 'Accounts', productService: 'Accounts:Account Review',              service: 'Accounts' },
  { label: 'Corporate Tax Services',      category: 'Tax', productService: 'Tax:Corporate Tax Services',            service: 'Tax' },
  { label: 'Personal Tax Services',       category: 'Tax', productService: 'Tax:Personal Tax Services',             service: 'Tax' },
  { label: 'GST Submission Services',     category: 'Tax', productService: 'Tax:GST Submission Services',           service: 'Tax' },
  { label: 'GST Application Services',    category: 'Tax', productService: 'Tax:GST Application Services',          service: 'Tax' },
  { label: 'AIS Submission',              category: 'Tax', productService: 'Tax:AIS submission',                    service: 'Tax' },
  { label: 'Form IR8A Preparation',       category: 'Tax', productService: 'Tax:Form IR8A preparation',              service: 'Tax' },
  { label: 'Certificate of Residence',    category: 'Tax', productService: 'Tax:Certificate of Residence',           service: 'Tax' },
  { label: 'Withholding Tax',             category: 'Tax', productService: 'Tax:Withholding Tax',                    service: 'Tax' },
  { label: 'Dormant Tax Return',          category: 'Tax', productService: 'Tax:Dormant Tax Return',                 service: 'Tax' },
  { label: 'Other Tax Services',          category: 'Tax', productService: 'Tax:Other Tax Services',                 service: 'Tax' },
  { label: 'Reimbursement (OPE)',         category: 'Disbursement', productService: 'Disbursement:Reimbursement - OPE', service: 'Disbursement' },
  { label: 'Custom / Other…',             category: 'Other', productService: '',                                     service: 'Accounts' },
];

type Line = {
  key: number;
  label: string;
  productService: string;
  service: string;
  description: string;
  rate: string;
  qty: string;
  // Set only when this line came from the "previously billed" checklist
  // (keyed by that service's productService/description) — lets unticking
  // the checkbox find and remove exactly this line, without touching lines
  // added via the "Add line" catalogue dropdown.
  historyKey?: string;
};

let lineKeySeq = 0;
function newLine(opt: typeof TAO_PRODUCTS[number]): Line {
  return { key: ++lineKeySeq, label: opt.label, productService: opt.productService, service: opt.service, description: opt.label, rate: '', qty: '1' };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function fmtMoney(n: number) {
  return `S$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Small local equivalent of app/billing/page.tsx's BillingInvoiceReference —
// that one is typed to 'TAB' | 'TAC' and not exported, so this page carries
// its own TAO-flavoured version rather than widening a shared private helper.
function TaoInvoiceRef({ invoiceNo }: { invoiceNo?: string | null }) {
  if (!invoiceNo) return <span style={{ color: '#94a3b8', fontSize: 10, whiteSpace: 'nowrap' }}>No history</span>;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', width: 'fit-content', maxWidth: '100%',
      padding: '2px 5px', borderRadius: 4, background: '#f2f6f8', color: '#31506f',
      fontSize: 9.5, fontWeight: 800, lineHeight: 1.25, whiteSpace: 'nowrap',
    }}>
      TAO #{invoiceNo.replace(/^TAO/i, '')}
    </span>
  );
}

const taoListColumns = '32px minmax(230px,1.55fr) 120px 130px 110px 100px';

export default function TaoBillingPage() {
  const [companies, setCompanies] = useState<TaoCompanyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'never' | 'billed'>('all');
  const [expanded, setExpanded] = useState<string | null>(null); // keyed by companyName

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
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{total} companies</span>
        </div>
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

function TaoInvoiceBuilder({ company, onGenerated }: { company: TaoCompanyRow; onGenerated: () => void }) {
  const [txnDate, setTxnDate] = useState(todayIso());
  const [email, setEmail] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [suggestedNumber, setSuggestedNumber] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [numberConnected, setNumberConnected] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const requestKey = useRef(globalThis.crypto.randomUUID());

  const [history, setHistory] = useState<TaoServiceHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/quickbooks/next-invoice-numbers?txnDate=${encodeURIComponent(txnDate)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(json => {
        setNumberConnected(json.TAO?.connected ?? null);
        const next = typeof json.TAO?.number === 'string' ? json.TAO.number : '';
        setSuggestedNumber(next);
        setDocNumber(next);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [txnDate]);

  // Vincent, 2026-09-05: "不管周期，是判断之前开过的所有服务，然后用户才来
  // 自己打勾自己要开的单" — deliberately NOT TAB/TAC's due-date/period-rolling
  // logic (no periodicity data model exists for Accounts/Tax services): just
  // every distinct service this company has ever been billed for via TAO,
  // presented as a checklist ACC ticks on/off, prefilled with the last known
  // rate/description as a starting point.
  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);
    fetch(`/api/billing/tao/service-history?companyName=${encodeURIComponent(company.companyName)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(json => setHistory(json.services ?? []))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
    return () => controller.abort();
  }, [company.companyName]);

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines(current => current.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = (selectValue: string) => {
    const opt = selectValue === '__custom__'
      ? TAO_PRODUCTS.find(x => x.category === 'Other')
      : TAO_PRODUCTS.find(x => x.productService === selectValue);
    if (!opt) return;
    setLines(current => [...current, newLine(opt)]);
  };
  const removeLine = (key: number) => setLines(current => current.filter(l => l.key !== key));

  const historyKeyOf = (h: TaoServiceHistoryItem) => h.productService || h.description || '';
  const toggleHistoryItem = (h: TaoServiceHistoryItem, checked: boolean) => {
    const historyKey = historyKeyOf(h);
    if (!checked) {
      setLines(current => current.filter(l => l.historyKey !== historyKey));
      return;
    }
    const opt = TAO_PRODUCTS.find(x => x.productService === h.productService);
    const custom = TAO_PRODUCTS.find(x => x.category === 'Other')!;
    setLines(current => [...current, {
      key: ++lineKeySeq,
      label: opt ? opt.label : (h.productService || custom.label),
      productService: opt ? opt.productService : (h.productService ?? ''),
      service: opt ? opt.service : (h.service || custom.service),
      description: h.description ?? (opt ? opt.label : ''),
      rate: h.rate != null ? String(h.rate) : '',
      qty: h.qty != null ? String(h.qty) : '1',
      historyKey,
    }]);
  };

  const total = lines.reduce((s, l) => s + (Number(l.rate) || 0) * (Number(l.qty) || 0), 0);
  const linesValid = lines.length > 0 && lines.every(l => l.description.trim() && Number.isFinite(Number(l.rate)) && Number(l.rate) !== 0 && Number(l.qty) > 0);

  const generate = async () => {
    if (!linesValid) return;
    setGenerating(true); setResult(null);
    try {
      const res = await fetch('/api/quickbooks/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: company.companyName,
          companyId: company.companyId ?? undefined,
          email: isValidEmail(email) ? email : undefined,
          txnDate,
          sendEmail: false,
          tabLines: [],
          tacLines: [],
          taoLines: lines.map(l => ({
            service: l.service,
            productService: l.productService || undefined,
            description: l.description.trim(),
            rate: Number(l.rate),
            qty: Number(l.qty),
          })),
          idempotencyKey: requestKey.current,
          docNumbers: { TAO: docNumber || undefined },
          expectedNextNumbers: { TAO: suggestedNumber || undefined },
        }),
      });
      const json = await res.json();
      if (json.tao) {
        setResult({ ok: true, msg: `TAO #${json.tao.invoiceNo} generated — ${fmtMoney(json.tao.total ?? total)}` });
        setTimeout(onGenerated, 900);
      } else {
        setResult({ ok: false, msg: json.errors?.tao ?? json.error ?? 'Invoice generation failed.' });
      }
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setGenerating(false);
    }
  };

  // Same visual language as app/billing/page.tsx's ExpandedBillingRow (Vincent,
  // 2026-09-05: "之前的UI就很不错" pointing at that exact TAB/TAC builder) —
  // shared inputStyle, the same section-badge-with-number-box header row, the
  // same table-with-uppercase-header + attached "Add line" footer bar, the
  // same bottom "N lines · Total" + green Generate button + draft disclaimer.
  // Columns TAB/TAC has that don't apply here are dropped rather than faked:
  // no per-line include/exclude checkbox (every line here was added on
  // purpose, nothing to opt out of), no Status column (that tracks renewal
  // period due-dates, which don't exist for Accounts/Tax), no PIC/Class note
  // (TAO invoices never carry one — see lib/qb-invoice-conventions.ts).
  const inputStyle: React.CSSProperties = { border: '1px solid #cbd5e1', borderRadius: 5, padding: '6px 6px', fontSize: 12, outline: 'none', background: '#fff' };
  const manuallyChanged = !!docNumber && !!suggestedNumber && docNumber !== suggestedNumber;
  const numberBg = manuallyChanged ? '#fffbeb' : '#f8fafc';
  const numberBorder = manuallyChanged ? '#fcd34d' : '#dbe5ee';
  const numberColor = manuallyChanged ? '#92400e' : '#1e3a5f';

  return (
    <div style={{ padding: '28px 20px', background: '#fff' }}>
      {/* Header: bill email + invoice date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Mail size={13} style={{ color: '#64748b' }} />
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="client@email.com (optional)"
            style={{ ...inputStyle, width: 240, color: 'var(--accent-blue)', fontWeight: 600 }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>Invoice date</span>
          <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} style={inputStyle} />
        </div>
      </div>

      {/* Section badge + estimated QB number */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#0f766e', background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 5, padding: '2px 8px' }}>TAO</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>Accounts / Tax Services</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>· built manually, no template</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 9px', borderRadius: 8, background: numberBg, border: `1px solid ${numberBorder}` }}>
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ fontSize: 8, fontWeight: 800, color: manuallyChanged ? 'var(--status-warning)' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '.45px' }}>{manuallyChanged ? 'Manual number' : 'Estimated QB number'}</span>
            <span style={{ fontSize: 8.5, color: '#94a3b8' }}>QB confirms when created</span>
          </div>
          <input value={docNumber} onChange={e => setDocNumber(e.target.value.trim())}
            placeholder={numberConnected === false ? 'not connected' : '…'} disabled={numberConnected === false}
            style={{ width: 92, border: 0, borderBottom: `1px solid ${manuallyChanged ? '#f59e0b' : '#94a3b8'}`, outline: 'none', background: 'transparent', color: numberColor, fontFamily: 'monospace', fontSize: 11.5, fontWeight: 800, padding: '2px 1px', textAlign: 'center' }} />
        </div>
      </div>
      {numberConnected === false && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#b45309', fontSize: 11, marginBottom: 10 }}>
          <AlertCircle size={13} />QuickBooks TAO is not connected — connect it from the Dashboard before generating.
        </div>
      )}

      {/* Previously billed services — tick to add, untick to remove. Not a
          due-date suggestion (no periodicity data exists for Accounts/Tax),
          just every distinct service this company has ever been billed for
          via TAO, so ACC isn't re-deriving it from QuickBooks by hand. */}
      {historyLoading && <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>Checking billing history…</div>}
      {!historyLoading && history.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <History size={13} style={{ color: '#64748b' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>Previously Billed Services</span>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>· tick what applies this time</span>
          </div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            {history.map((h, i) => {
              const key = historyKeyOf(h);
              const checked = lines.some(l => l.historyKey === key);
              const opt = TAO_PRODUCTS.find(x => x.productService === h.productService);
              return (
                <label key={key || i} style={{
                  display: 'grid', gridTemplateColumns: '22px 1fr 100px 90px', gap: 10, alignItems: 'center',
                  padding: '9px 12px', borderTop: i > 0 ? '1px solid #f1f5f9' : 'none', cursor: 'pointer',
                  background: checked ? '#ecfdf5' : '#fff',
                }}>
                  <input type="checkbox" checked={checked} onChange={e => toggleHistoryItem(h, e.target.checked)}
                    style={{ width: 14, height: 14, cursor: 'pointer', accentColor: '#0f766e' }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{opt ? opt.label : (h.productService || 'Other')}</div>
                    {h.description && <div style={{ fontSize: 10.5, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.description}</div>}
                  </div>
                  <div style={{ fontSize: 10.5, color: '#94a3b8', textAlign: 'right', whiteSpace: 'nowrap' }}>Last: {fmtDate(h.lastTxnDate)}</div>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: '#0f766e', textAlign: 'right', whiteSpace: 'nowrap' }}>{h.rate != null ? fmtMoney(h.rate) : '—'}</div>
                </label>
              );
            })}
          </div>
        </div>
      )}
      {!historyLoading && history.length === 0 && (
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>No prior TAO billing history for this company — add lines manually below.</div>
      )}

      {/* Line-items table */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr 60px 100px 100px 26px', gap: 0, background: '#f1f5f9', padding: '12px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          <div>Service</div><div>Description</div>
          <div style={{ textAlign: 'center', padding: '0 8px' }}>Qty</div>
          <div style={{ textAlign: 'center', padding: '0 8px' }}>Rate (S$)</div>
          <div style={{ textAlign: 'right' }}>Amount</div><div />
        </div>
        {lines.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No lines yet — add one below.</div>
        )}
        {lines.map(l => (
          <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr 60px 100px 100px 26px', gap: 0, alignItems: 'start', padding: '14px 10px', borderTop: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', paddingTop: 6 }} title={l.productService || undefined}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</span>
            </div>
            <textarea value={l.description} onChange={e => updateLine(l.key, { description: e.target.value })}
              placeholder="Line description (shown on the invoice)" rows={2}
              style={{ ...inputStyle, width: '95%', fontFamily: 'inherit', lineHeight: 1.4, resize: 'vertical' }} />
            <input type="number" min={1} value={l.qty} onChange={e => updateLine(l.key, { qty: e.target.value })}
              style={{ ...inputStyle, width: 44, textAlign: 'center', justifySelf: 'center' }} />
            <input type="number" min={0} value={l.rate} onChange={e => updateLine(l.key, { rate: e.target.value })}
              placeholder="0"
              style={{ ...inputStyle, width: 90, textAlign: 'center', justifySelf: 'center', borderColor: !l.rate ? '#f87171' : '#cbd5e1', background: !l.rate ? 'var(--status-danger-tint)' : '#fff' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#0f766e', textAlign: 'right' }}>
              {(Number(l.rate) || 0) && (Number(l.qty) || 0) ? fmtMoney((Number(l.rate) || 0) * (Number(l.qty) || 0)) : '—'}
            </span>
            <button onClick={() => removeLine(l.key)} title="Remove line"
              style={{ border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', padding: 0, display: 'flex', justifyContent: 'center' }}>
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 8px 8px', background: '#f8fafc' }}>
        <Plus size={13} style={{ color: '#0f766e' }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Add line</span>
        <select value="" onChange={e => { if (e.target.value) addLine(e.target.value); }}
          style={{ ...inputStyle, minWidth: 260, cursor: 'pointer' }}>
          <option value="">Choose a QuickBooks item…</option>
          {[...new Set(TAO_PRODUCTS.filter(x => x.category !== 'Other').map(x => x.category))].map(cat => (
            <optgroup key={cat} label={cat}>
              {TAO_PRODUCTS.filter(x => x.category === cat).map(x => (
                <option key={x.productService} value={x.productService}>{x.label}</option>
              ))}
            </optgroup>
          ))}
          {TAO_PRODUCTS.filter(x => x.category === 'Other').map(x => (
            <option key={x.label} value={x.productService || '__custom__'}>{x.label}</option>
          ))}
        </select>
      </div>

      {/* Total + Generate */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 16 }}>
        <div style={{ fontSize: 13, color: '#334155' }}>
          <span style={{ color: '#64748b' }}>{lines.length} line{lines.length !== 1 ? 's' : ''} · Total </span>
          <strong style={{ fontSize: 17, color: '#0f766e' }}>{fmtMoney(total)}</strong>
        </div>
        {!linesValid && <span style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600 }}>⚠ Fill in every description, rate and quantity before generating</span>}
        <button
          onClick={generate}
          disabled={generating || !linesValid || numberConnected === false}
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none',
            cursor: generating || !linesValid ? 'default' : 'pointer',
            background: generating || !linesValid || numberConnected === false ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
          }}>
          {generating ? 'Generating…' : 'Generate Invoice in QB (TAO)'}
        </button>
      </div>

      {result && (
        <div style={{ marginTop: 14, padding: '12px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
          background: result.ok ? 'var(--status-success-tint)' : 'var(--status-danger-tint)', color: result.ok ? '#15803d' : 'var(--status-danger)',
          border: `1px solid ${result.ok ? '#bbf7d0' : '#fecaca'}` }}>
          {result.ok ? '✓ ' : '✕ '}{result.msg}
        </div>
      )}

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 20, fontSize: 10, color: '#94a3b8' }}>
        ⚠ The invoice is created as a draft in QuickBooks (not sent). Review it in QB, then send to the client from there.
      </div>
    </div>
  );
}
