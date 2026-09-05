'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt, RefreshCw, Plus, Trash2, X, CheckCircle2, AlertCircle, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { isValidEmail } from '@/lib/campaign-recipients';
import type { TaoCompanyRow } from '@/app/api/billing/tao/route';

// Curated real TAO product/service names (from actual QuickBooks TAO line
// items) — picking one of these resolves to the exact QB Item via
// buildInvoiceLineArray's exact match (lib/qb-invoice-conventions.ts), so the
// invoice item lines up with QuickBooks' own catalogue instead of falling
// back to a fuzzy keyword guess. "Custom" lets ACC type something not listed
// here; it still gets bucketed under a `service` category for the generic
// disbursement/PIC-class gating in qb-invoice-conventions.ts.
const TAO_PRODUCTS: { label: string; productService: string; service: string }[] = [
  { label: 'Compilation Report Services', productService: 'Accounts:Compilation Report Services', service: 'Accounts' },
  { label: 'Yearly Accounts Services',    productService: 'Accounts:Yearly Accounts Services',    service: 'Accounts' },
  { label: 'Quarterly Accounts Services', productService: 'Accounts:Quarterly Accounts Services', service: 'Accounts' },
  { label: 'Monthly Accounts Services',   productService: 'Accounts:Monthly Accounts Services',   service: 'Accounts' },
  { label: 'Account Review',              productService: 'Accounts:Account Review',              service: 'Accounts' },
  { label: 'Corporate Tax Services',      productService: 'Tax:Corporate Tax Services',            service: 'Tax' },
  { label: 'Personal Tax Services',       productService: 'Tax:Personal Tax Services',             service: 'Tax' },
  { label: 'GST Submission Services',     productService: 'Tax:GST Submission Services',           service: 'Tax' },
  { label: 'GST Application Services',    productService: 'Tax:GST Application Services',          service: 'Tax' },
  { label: 'AIS Submission',              productService: 'Tax:AIS submission',                    service: 'Tax' },
  { label: 'Form IR8A Preparation',       productService: 'Tax:Form IR8A preparation',              service: 'Tax' },
  { label: 'Certificate of Residence',    productService: 'Tax:Certificate of Residence',           service: 'Tax' },
  { label: 'Withholding Tax',             productService: 'Tax:Withholding Tax',                    service: 'Tax' },
  { label: 'Dormant Tax Return',          productService: 'Tax:Dormant Tax Return',                 service: 'Tax' },
  { label: 'Other Tax Services',          productService: 'Tax:Other Tax Services',                 service: 'Tax' },
  { label: 'Reimbursement (OPE)',         productService: 'Disbursement:Reimbursement - OPE',       service: 'Disbursement' },
  { label: 'Custom / Other…',             productService: '',                                       service: 'Accounts' },
];

type Line = {
  key: number;
  productOption: string;
  productService: string;
  service: string;
  description: string;
  rate: string;
  qty: string;
};

let lineKeySeq = 0;
function newLine(): Line {
  const opt = TAO_PRODUCTS[0];
  return { key: ++lineKeySeq, productOption: '0', productService: opt.productService, service: opt.service, description: '', rate: '', qty: '1' };
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
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [suggestedNumber, setSuggestedNumber] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [numberConnected, setNumberConnected] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const requestKey = useRef(globalThis.crypto.randomUUID());

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

  const updateLine = (key: number, patch: Partial<Line>) =>
    setLines(current => current.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const setLineProduct = (key: number, optIndex: string) => {
    const opt = TAO_PRODUCTS[Number(optIndex)];
    updateLine(key, { productOption: optIndex, productService: opt.productService, service: opt.service });
  };
  const addLine = () => setLines(current => [...current, newLine()]);
  const removeLine = (key: number) => setLines(current => (current.length > 1 ? current.filter(l => l.key !== key) : current));

  const total = lines.reduce((s, l) => s + (Number(l.rate) || 0) * (Number(l.qty) || 0), 0);
  const linesValid = lines.every(l => l.description.trim() && Number.isFinite(Number(l.rate)) && Number(l.rate) !== 0 && Number(l.qty) > 0);

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

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 12, color: '#64748b' }}>Invoice date</label>
        <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
        <label style={{ fontSize: 12, color: '#64748b', marginLeft: 12 }}>Bill email</label>
        <input value={email} onChange={e => setEmail(e.target.value)} placeholder="optional"
          style={{ flex: 1, minWidth: 160, padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
        <label style={{ fontSize: 12, color: '#64748b' }}>TAO invoice #</label>
        <input value={docNumber} onChange={e => setDocNumber(e.target.value.trim())} placeholder={numberConnected === false ? 'not connected' : '…'}
          disabled={numberConnected === false}
          style={{ width: 130, padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
      </div>
      {numberConnected === false && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: '#b45309', fontSize: 12, marginBottom: 12 }}>
          <AlertCircle size={14} />QuickBooks TAO is not connected — connect it from the Dashboard before generating.
        </div>
      )}

      <div style={{ marginBottom: 8 }}>
        {lines.map(l => (
          <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 100px 70px 28px', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <select value={l.productOption} onChange={e => setLineProduct(l.key, e.target.value)}
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }}>
              {TAO_PRODUCTS.map((opt, i) => <option key={i} value={i}>{opt.label}</option>)}
            </select>
            <input value={l.description} onChange={e => updateLine(l.key, { description: e.target.value })}
              placeholder="Line description (shown on the invoice)"
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <input type="number" value={l.rate} onChange={e => updateLine(l.key, { rate: e.target.value })}
              placeholder="Rate"
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <input type="number" value={l.qty} onChange={e => updateLine(l.key, { qty: e.target.value })}
              style={{ padding: '6px 8px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 12 }} />
            <button onClick={() => removeLine(l.key)} disabled={lines.length === 1}
              style={{ border: 'none', background: 'none', color: lines.length === 1 ? '#cbd5e1' : '#dc2626', cursor: lines.length === 1 ? 'default' : 'pointer' }}>
              <Trash2 size={15} />
            </button>
          </div>
        ))}
        <button onClick={addLine} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: '1px dashed #cbd5e1', borderRadius: 6, padding: '6px 12px', color: '#475569', fontSize: 12, cursor: 'pointer' }}>
          <Plus size={13} />Add line
        </button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 14, fontWeight: 700, color: '#1e3a5f', marginTop: 8, marginBottom: 16 }}>
        Total: {fmtMoney(total)}
      </div>

      {result && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderRadius: 8, marginBottom: 14, fontSize: 13,
          background: result.ok ? '#f0fdf4' : '#fef2f2', border: `1px solid ${result.ok ? '#bbf7d0' : '#fecaca'}`, color: result.ok ? '#166534' : '#991b1b' }}>
          {result.ok ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{result.msg}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={generate}
          disabled={generating || !linesValid || numberConnected === false}
          style={{
            padding: '9px 22px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, cursor: generating || !linesValid ? 'default' : 'pointer',
            background: generating || !linesValid || numberConnected === false ? '#cbd5e1' : '#1e3a5f', color: '#fff',
          }}>
          {generating ? 'Generating…' : 'Generate TAO Invoice'}
        </button>
      </div>
    </div>
  );
}
