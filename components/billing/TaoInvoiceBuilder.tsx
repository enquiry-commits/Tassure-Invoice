'use client';

/**
 * The REAL TAO (ACC) invoice builder — moved here verbatim 2026-09-10 from
 * app/billing/tao/page.tsx, where it was already a module-level component
 * taking only `company` and `onGenerated`, closing over none of that page's
 * state.
 *
 * Same reasoning as components/billing/ExpandedBillingRow.tsx: the chat
 * assistant must open the SAME builder ACC uses, not a chat lookalike of
 * it (Vincent: "现在这些功能都锁死了在各自的功能页内"). TAO billing is
 * MANUAL by design — there is no periodicity model for Accounts/Tax, so
 * nothing can auto-draft it; what chat can usefully do is surface what the
 * company was billed before and then hand over this real builder.
 *
 * Everything below is a mechanical move — verify with `git diff` that the
 * TAO page's own rendered behavior is unchanged. It POSTs real invoices to
 * QuickBooks, so it must never be forked into a second copy.
 */
import { useEffect, useRef, useState } from 'react';
import { Plus, X, AlertCircle, Mail } from 'lucide-react';
import { isValidEmail } from '@/lib/campaign-recipients';
import { rollRecurringDescriptionForward } from '@/lib/invoice-period';
import type { TaoCompanyRow } from '@/app/api/billing/tao/route';
import type { TaoServiceHistoryItem } from '@/app/api/billing/tao/service-history/route';

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
  // Whether this line counts toward the total and gets submitted — same
  // include/exclude checkbox app/billing/page.tsx's renewal table uses.
  // Vincent, 2026-09-05: unlike TAB/TAC (pre-checked, since a due renewal
  // cycle is a real signal), a TAO history row starts UNCHECKED — "不主动
  // 勾选" — since there's no due-date signal to justify assuming it applies
  // again this time; ACC decides.
  include: boolean;
  // Last real invoice date this exact service was billed, shown for
  // reference only ("目的是为了让用户知道上一次开单是什么时候，这次还要
  // 不要开单") — null for a brand-new line added via "Add line".
  lastBilled: string | null;
};

let lineKeySeq = 0;
function newLine(opt: typeof TAO_PRODUCTS[number]): Line {
  return { key: ++lineKeySeq, label: opt.label, productService: opt.productService, service: opt.service, description: opt.label, rate: '', qty: '1', include: true, lastBilled: null };
}
// A history row's description gets its date/period rolled forward one cycle
// (lib/invoice-period.ts — the same function TAB/TAC's own recurring lines
// use) so e.g. "YA2026" becomes "YA2027" and "Apr 2026 to Jun 2026" becomes
// "Apr 2027 to Jun 2027" — a starting guess ACC can still edit, not an
// automatic due-date decision.
function lineFromHistory(h: TaoServiceHistoryItem, catalog: typeof TAO_PRODUCTS): Line {
  const opt = catalog.find(x => x.productService === h.productService);
  const custom = catalog.find(x => x.category === 'Other')!;
  const baseDescription = h.description ?? (opt ? opt.label : (h.productService || custom.label));
  return {
    key: ++lineKeySeq,
    label: opt ? opt.label : (h.productService || custom.label),
    productService: opt ? opt.productService : (h.productService ?? ''),
    service: opt ? opt.service : (h.service || custom.service),
    description: rollRecurringDescriptionForward(baseDescription),
    rate: h.rate != null ? String(h.rate) : '',
    qty: h.qty != null ? String(h.qty) : '1',
    include: false,
    lastBilled: h.lastTxnDate,
  };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
export function fmtMoney(n: number) {
  return `S$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Same local-copy situation as TaoInvoiceRef below — app/billing/page.tsx's
// own AutoTextarea (used for its Description column too) isn't exported.
// Grows to fit its content instead of a fixed-rows box with internal
// scrolling (Vincent, 2026-09-05: "description 太长不要隐藏起来要完全的展示").
function AutoTextarea({ value, onChange, style }: { value: string; onChange: (v: string) => void; style?: React.CSSProperties }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; } };
  useEffect(() => { resize(); }, [value]);
  return (
    <textarea ref={ref} value={value} rows={1}
      onChange={e => { onChange(e.target.value); resize(); }}
      style={{ ...style, overflow: 'hidden', resize: 'none' }} />
  );
}

// Small local equivalent of app/billing/page.tsx's BillingInvoiceReference —
// that one is typed to 'TAB' | 'TAC' and not exported, so this page carries
// its own TAO-flavoured version rather than widening a shared private helper.
export function TaoInvoiceRef({ invoiceNo }: { invoiceNo?: string | null }) {
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



export default function TaoInvoiceBuilder({ company, onGenerated }: { company: TaoCompanyRow; onGenerated: () => void }) {
  const [txnDate, setTxnDate] = useState(todayIso());
  const [email, setEmail] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [suggestedNumber, setSuggestedNumber] = useState('');
  const [docNumber, setDocNumber] = useState('');
  const [numberConnected, setNumberConnected] = useState<boolean | null>(null);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string; customerMissing?: boolean } | null>(null);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const requestKey = useRef(globalThis.crypto.randomUUID());

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
  // 自己打勾自己要开的单" then "之前把previous 的变成下面那个services 的就
  // 好了...TAB/TAC会把服务勾选好...TAO的也是判断出之前的所有服务，但是不
  // 主动勾选" — one merged table, not a separate checklist above an empty
  // one: every distinct service this company has ever been billed for via
  // TAO becomes a row immediately (unlike TAB/TAC's due-cycle rows, unchecked
  // by default — there's no due-date signal here to justify assuming yes),
  // with its description's period rolled forward one cycle as a starting
  // guess and its last-billed date kept visible so ACC can judge whether it's
  // needed again.
  useEffect(() => {
    const controller = new AbortController();
    setHistoryLoading(true);
    fetch(`/api/billing/tao/service-history?companyName=${encodeURIComponent(company.companyName)}`, { signal: controller.signal })
      .then(res => res.json())
      .then(json => {
        const items: TaoServiceHistoryItem[] = json.services ?? [];
        setLines(items.map(h => lineFromHistory(h, TAO_PRODUCTS)));
      })
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

  const included = lines.filter(l => l.include);
  const total = included.reduce((s, l) => s + (Number(l.rate) || 0) * (Number(l.qty) || 0), 0);
  const linesValid = included.length > 0 && included.every(l => l.description.trim() && Number.isFinite(Number(l.rate)) && Number(l.rate) !== 0 && Number(l.qty) > 0);

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
          taoLines: included.map(l => ({
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
        const msg: string = json.errors?.tao ?? json.error ?? 'Invoice generation failed.';
        // Vincent, 2026-09-05: "能不能把这个建成客户的功能，也放置在...TAO"
        // — a brand-new client has no QuickBooks Customer yet; offer to
        // create one right from this exact error instead of a dead end.
        setResult({ ok: false, msg, customerMissing: /Customer not found in QB/i.test(msg) });
      }
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setGenerating(false);
    }
  };

  const createCustomerAndRetry = async () => {
    setCreatingCustomer(true);
    try {
      const res = await fetch('/api/quickbooks/create-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: 'TAO', companyName: company.companyName }),
      });
      const json = await res.json();
      if (!res.ok) { setResult({ ok: false, msg: json.error ?? 'Could not create the customer in QuickBooks.' }); return; }
      setResult({ ok: true, msg: `Created "${json.customer.name}" in QuickBooks TAO — generating the invoice now…` });
      await generate();
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setCreatingCustomer(false);
    }
  };

  // Same visual language as app/billing/page.tsx's ExpandedBillingRow (Vincent,
  // 2026-09-05: "之前的UI就很不错" pointing at that exact TAB/TAC builder) —
  // shared inputStyle, the same section-badge-with-number-box header row, the
  // same include-checkbox + uppercase-header table + attached "Add line"
  // footer bar, the same bottom "N lines · Total" + green Generate button +
  // draft disclaimer. Only Status is dropped (that tracks Secretary/Address/
  // ND renewal-period due-dates, which don't exist for Accounts/Tax) and
  // there's no PIC/Class note (TAO invoices never carry one — see
  // lib/qb-invoice-conventions.ts) — a "Last billed" caption takes Status's
  // place instead, since that's the reference signal that exists here.
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

      {historyLoading && <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 16 }}>Checking billing history…</div>}

      {/* One merged table — Vincent, 2026-09-05: "为什么要分开...就好了啊,
          和TAB/TAC的那样". Rows start populated from every distinct service
          this company has ever been billed for via TAO (unchecked, greyed
          out until ticked — see lineFromHistory above), plus whatever gets
          added via "Add line". */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '26px 1.1fr 2fr 60px 100px 100px 26px', gap: 0, background: '#f1f5f9', padding: '12px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
          <div /><div>Service</div><div>Description</div>
          <div style={{ textAlign: 'center', padding: '0 8px' }}>Qty</div>
          <div style={{ textAlign: 'center', padding: '0 8px' }}>Rate (S$)</div>
          <div style={{ textAlign: 'right' }}>Amount</div><div />
        </div>
        {!historyLoading && lines.length === 0 && (
          <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No prior TAO billing history for this company — add a line below.</div>
        )}
        {lines.map(l => (
          <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '26px 1.1fr 2fr 60px 100px 100px 26px', gap: 0, alignItems: 'start', padding: '14px 10px', borderTop: '1px solid #f1f5f9', background: l.include ? '#fff' : '#fafbfc', opacity: l.include ? 1 : 0.6 }}>
            <input type="checkbox" checked={l.include} onChange={e => updateLine(l.key, { include: e.target.checked })}
              style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#0f766e', marginTop: 6 }} />
            <div style={{ paddingTop: 6 }} title={l.productService || undefined}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.label}</div>
              {/* Last real invoice date this service was billed — reference
                  only ("目的是为了让用户知道上一次开单是什么时候，这次还要
                  不要开单"), never used to gate or auto-check anything. */}
              <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 2, whiteSpace: 'nowrap' }}>{l.lastBilled ? `Last: ${fmtDate(l.lastBilled)}` : 'New service'}</div>
            </div>
            <AutoTextarea value={l.description} onChange={v => updateLine(l.key, { description: v })}
              style={{ ...inputStyle, width: '95%', fontFamily: 'inherit', lineHeight: 1.4 }} />
            <input type="number" min={1} value={l.qty} onChange={e => updateLine(l.key, { qty: e.target.value })}
              style={{ ...inputStyle, width: 44, textAlign: 'center', justifySelf: 'center' }} />
            <input type="number" min={0} value={l.rate} onChange={e => updateLine(l.key, { rate: e.target.value })}
              placeholder="0"
              style={{ ...inputStyle, width: 90, textAlign: 'center', justifySelf: 'center', borderColor: l.include && !l.rate ? '#f87171' : '#cbd5e1', background: l.include && !l.rate ? 'var(--status-danger-tint)' : '#fff' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: l.include ? '#0f766e' : '#94a3b8', textAlign: 'right' }}>
              {l.include && (Number(l.rate) || 0) && (Number(l.qty) || 0) ? fmtMoney((Number(l.rate) || 0) * (Number(l.qty) || 0)) : '—'}
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
          <span style={{ color: '#64748b' }}>{included.length} line{included.length !== 1 ? 's' : ''} · Total </span>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>{result.ok ? '✓ ' : '✕ '}{result.msg}</span>
            {result.customerMissing && (
              <button onClick={createCustomerAndRetry} disabled={creatingCustomer}
                style={{ marginLeft: 'auto', padding: '6px 12px', borderRadius: 7, border: 'none', background: creatingCustomer ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 11.5, fontWeight: 700, cursor: creatingCustomer ? 'default' : 'pointer', whiteSpace: 'nowrap' }}>
                {creatingCustomer ? 'Creating…' : `Create "${company.companyName}" in QuickBooks`}
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 20, fontSize: 10, color: '#94a3b8' }}>
        ⚠ The invoice is created as a draft in QuickBooks (not sent). Review it in QB, then send to the client from there.
      </div>
    </div>
  );
}
