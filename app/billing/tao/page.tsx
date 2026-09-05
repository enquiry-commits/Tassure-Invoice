'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Receipt, Search, RefreshCw, Plus, Trash2, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
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
  productOption: string; // index into TAO_PRODUCTS as string, or 'custom'
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

export default function TaoBillingPage() {
  const [companies, setCompanies] = useState<TaoCompanyRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<TaoCompanyRow | null>(null);

  const [txnDate, setTxnDate] = useState(todayIso());
  const [email, setEmail] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [suggestedNumber, setSuggestedNumber] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [numberConnected, setNumberConnected] = useState<boolean | null>(null);

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const requestKey = useRef(globalThis.crypto.randomUUID());

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

  // Fetch the suggested next TAO DocNumber whenever the invoice date changes
  // or a new company is selected — mirrors app/billing/page.tsx's own number
  // refresh, scoped to just the TAO column of the same endpoint.
  useEffect(() => {
    if (!selected) return;
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
  }, [selected, txnDate]);

  const filtered = useMemo(() => {
    if (!companies) return [];
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter(c => c.companyName.toLowerCase().includes(q));
  }, [companies, search]);

  const selectCompany = (c: TaoCompanyRow) => {
    setSelected(c);
    setEmail('');
    setLines([newLine()]);
    setResult(null);
    requestKey.current = globalThis.crypto.randomUUID();
  };
  const backToList = () => { setSelected(null); setResult(null); };

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
    if (!selected || !linesValid) return;
    setGenerating(true); setResult(null);
    try {
      const res = await fetch('/api/quickbooks/create-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: selected.companyName,
          companyId: selected.companyId,
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
        setLines([newLine()]);
        load();
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
    <div style={{ paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Receipt size={22} style={{ color: '#1e3a5f' }} />
          <h1 style={{ fontSize: 20, fontWeight: 800, color: '#1e3a5f', margin: 0 }}>TAO — Accounts / Tax Billing</h1>
          <span style={{ fontSize: 12, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 6, padding: '2px 8px' }}>
            ACC — separate from Chelsea&apos;s TAB / TAC drafts
          </span>
        </div>
        <button onClick={load} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
          <RefreshCw size={14} />Refresh
        </button>
      </div>

      {loadError && (
        <div style={{ padding: 12, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 13, marginBottom: 16 }}>{loadError}</div>
      )}

      {!selected ? (
        <div>
          <div style={{ position: 'relative', marginBottom: 16, maxWidth: 420 }}>
            <Search size={15} style={{ position: 'absolute', left: 12, top: 11, color: '#94a3b8' }} />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search companies with Accounts service…"
              style={{ width: '100%', padding: '8px 12px 8px 34px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
            />
          </div>
          <div className="system-list-shell">
            <table className="system-list-table" style={{ minWidth: 640 }}>
              <thead>
                <tr className="list-column-header-gray">
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Company</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px' }}>Last TAO invoice</th>
                  <th style={{ width: 100 }} />
                </tr>
              </thead>
              <tbody>
                {companies === null && (
                  <tr><td colSpan={3} style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>Loading…</td></tr>
                )}
                {companies !== null && filtered.length === 0 && (
                  <tr><td colSpan={3} style={{ padding: 16, color: '#94a3b8', fontSize: 13 }}>No matching companies.</td></tr>
                )}
                {filtered.map(c => (
                  <tr key={c.companyId} className="system-list-row" onClick={() => selectCompany(c)} style={{ cursor: 'pointer' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600, color: '#1e3a5f' }}>{c.companyName}</td>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: '#64748b' }}>
                      {c.lastInvoice ? `#${c.lastInvoice.invoiceNo} · ${c.lastInvoice.txnDate ?? '—'} · ${fmtMoney(c.lastInvoice.totalAmt ?? 0)}` : 'No history yet'}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', color: '#1e3a5f', fontSize: 13, fontWeight: 600 }}>Bill →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ maxWidth: 860 }}>
          <button onClick={backToList} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 14 }}>
            <ArrowLeft size={14} />Back to company list
          </button>

          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, color: '#1e3a5f' }}>{selected.companyName}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                  {selected.lastInvoice
                    ? `Last TAO invoice: #${selected.lastInvoice.invoiceNo} on ${selected.lastInvoice.txnDate ?? '—'} (${fmtMoney(selected.lastInvoice.totalAmt ?? 0)})`
                    : 'No TAO invoice history yet for this company.'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <label style={{ fontSize: 12, color: '#64748b' }}>Invoice date</label>
                <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)}
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#64748b', minWidth: 90 }}>Bill email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="optional"
                style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 13 }} />
              <label style={{ fontSize: 12, color: '#64748b', minWidth: 90, textAlign: 'right' }}>TAO invoice #</label>
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
        </div>
      )}
    </div>
  );
}
