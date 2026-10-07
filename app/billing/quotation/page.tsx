'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, RefreshCw, X, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Layers, Clock, Loader2, Plus, Send, Trash2, Archive, RotateCcw } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { BillingInvoiceReference } from '@/components/billing/BillingInvoiceReference';
import { fmtDate, todaySGT } from '@/lib/date';
import { QB_CATALOG } from '@/lib/invoice-templates';
import type { QbCompany } from '@/lib/quickbooks';
import type { QuotationData, QuotationRow, QuotationRowView, QuotationTraceInvoice } from '@/app/api/billing/quotation/route';

// Billing System › Quotation (Vincent, 2026-09-24). A quotation is a
// QuickBooks Estimate ("PI…" numbers). Once one is Closed, this page shows
// which book(s) — TAB / TAC / TAO — the invoice(s) issued for it went to.
// Vincent-only for now: proxy.ts hard-blocks direct navigation to this path
// for every account without canViewQuotation (same pattern as /sg-news), and
// app/api/billing/quotation/route.ts enforces the same flag server-side.

type StatusFilter = 'all' | 'open' | 'closed' | 'rejected' | 'split' | 'noinvoice';
// Created By filter value for quotations nobody can attribute.
const NOT_SET = '__not_set__';

const BOOKS: QbCompany[] = ['TAB', 'TAC', 'TAO'];
const listColumns = '28px 104px 96px minmax(210px,1.5fr) 128px 118px 66px 118px minmax(290px,2fr) 128px minmax(210px,1.3fr)';

function money(n: number, currency?: string | null) {
  const body = n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return !currency || currency === 'SGD' ? `S$${body}` : `${currency} ${body}`;
}

// Same neutral look as the Source badges elsewhere in Billing System —
// per-book colours were deliberately removed there.
const chipStyle = { display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 700, letterSpacing: '0.02em', padding: '2px 7px', borderRadius: 5, border: '1px solid #b8c7d6', background: '#fff', color: '#1e3a5f' } as const;

function StatusPill({ row }: { row: QuotationRow }) {
  const tone = row.statusGroup === 'closed'
    ? { border: '#bbf7d0', color: '#15803d' }
    : row.statusGroup === 'rejected'
      ? { border: '#e2e8f0', color: '#64748b' }
      : { border: '#fed7aa', color: '#c2410c' };
  const label = row.txnStatus ?? 'Unknown';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, background: '#fff', border: `1px solid ${tone.border}`, color: tone.color, fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: tone.color }} />
      {label}{row.daysOpen !== null ? ` · ${row.daysOpen}d` : ''}
    </span>
  );
}

// Who issued the quotation (lib/quotation-trace.ts's quotationCreator):
// this system's own record for one made with New Quotation, otherwise the
// Location staff pick on the quotation in QuickBooks. "Not set" is the one
// real blind spot — QuickBooks itself records no user (staff share logins),
// so the fix is choosing a Location on that quotation in QuickBooks.
const NOT_SET_HINT = 'No Location was chosen on this quotation in QuickBooks, and it was not created here. QuickBooks itself does not record who made it — choose a Location on it in QuickBooks to fill this in.';
function creatorTitle(row: QuotationRow): string {
  const c = row.createdBy;
  if (!c) return NOT_SET_HINT;
  if (c.source === 'system') return 'Created in this system with New Quotation';
  return row.locationName && row.locationName.trim() !== c.name
    ? `From the Location chosen in QuickBooks ("${row.locationName}")`
    : 'From the Location chosen on this quotation in QuickBooks';
}
function CreatedBy({ row }: { row: QuotationRow }) {
  const c = row.createdBy;
  if (!c) return <span title={NOT_SET_HINT} style={{ fontSize: 11, fontWeight: 700, color: '#b45309' }}>Not set</span>;
  return <span title={creatorTitle(row)} style={{ fontSize: 11, fontWeight: 600, color: '#334155' }}>{c.name}</span>;
}

// One traced invoice: ● = QuickBooks itself recorded the conversion,
// ○ = matched by customer name only. The chip is the shared
// BillingInvoiceReference ("TAB #02611060", opens the real QuickBooks PDF).
//
// Vincent, 2026-10-04: "设计的稍微整齐顺眼一点，现在感觉一堆内容堆积在一起" —
// rendered as one line per invoice inside TraceSummary's shared grid
// (marker | chip | amount), so chips and right-aligned amounts line up
// vertically across invoices instead of wrapping side by side.
const TRACE_GRID = '10px auto 1fr 14px';
function TracedInvoice({ inv, currency }: { inv: QuotationTraceInvoice; currency: string | null }) {
  const confirmed = inv.via === 'quickbooks_link';
  const voided = inv.status === 'Voided';
  return (
    <>
      <span title={confirmed ? 'Confirmed by QuickBooks (converted with Copy to invoice)' : 'Matched by customer name — not recorded in QuickBooks'}
        style={{ fontSize: 9, lineHeight: 1, color: confirmed ? '#15803d' : '#94a3b8' }}>{confirmed ? '●' : '○'}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <BillingInvoiceReference company={inv.source} invoiceNo={inv.invoiceNo} id={inv.qbInvoiceId} muted={voided} />
        {voided && <span style={{ fontSize: 9, fontWeight: 700, color: '#b91c1c', letterSpacing: '.03em' }}>VOID</span>}
      </span>
      <span style={{ textAlign: 'right', fontSize: 11, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: inv.amountMatches ? 700 : 500, color: voided ? '#94a3b8' : inv.amountMatches ? '#15803d' : '#475569', textDecoration: voided ? 'line-through' : undefined }}>
        {money(inv.totalAmt, currency)}
      </span>
      <span title={inv.amountMatches ? 'This invoice alone equals the quotation' : undefined}
        style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textAlign: 'center' }}>{inv.amountMatches ? '✓' : ''}</span>
    </>
  );
}

function TraceSummary({ row }: { row: QuotationRow }) {
  const t = row.trace;
  if (t.status === 'not_applicable') return <span style={{ color: '#cbd5e1' }}>—</span>;
  if (t.status === 'none') return <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>No invoice found</span>;
  const shown = t.invoices.slice(0, 4);
  // A single invoice that already equals the quotation needs no extra line.
  const showReconcile = t.invoices.length > 0 && !(t.invoices.length === 1 && t.invoices[0].amountMatches);
  const comparable = !row.currency || row.currency === 'SGD';
  const diff = t.tracedTotal - row.totalAmt;
  return (
    <div style={{ maxWidth: 300, padding: '2px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: TRACE_GRID, alignItems: 'center', columnGap: 6, rowGap: 4 }}>
        {shown.map(inv => <TracedInvoice key={`${inv.source}|${inv.qbInvoiceId}`} inv={inv} currency={row.currency} />)}
      </div>
      {t.invoices.length > shown.length && (
        <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3, paddingLeft: 16 }}>+{t.invoices.length - shown.length} more</div>
      )}
      {t.unresolvedLinkedInvoiceIds.map(id => (
        <div key={id} title="QuickBooks says this quotation was converted to this invoice, but it is not in the synced invoice data (deleted, older than the sync window, or not synced yet)"
          style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>● {row.source} invoice id {id} (not in synced data)</div>
      ))}
      {showReconcile && comparable && t.invoices.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: TRACE_GRID, alignItems: 'center', columnGap: 6, marginTop: 5, paddingTop: 5, borderTop: '1px dashed #e2e8f0', fontSize: 10 }}>
          <span />
          <span style={{ color: '#94a3b8', fontWeight: 600 }}>
            {t.sumMatchesTotal
              ? 'Total = quotation'
              : `${diff > 0 ? 'Over' : 'Short'} by ${money(Math.abs(diff), row.currency)}`}
          </span>
          <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 700, color: t.sumMatchesTotal ? '#15803d' : '#b45309' }}>
            {money(t.tracedTotal, row.currency)}
          </span>
          <span style={{ fontWeight: 700, color: '#15803d', textAlign: 'center' }}>{t.sumMatchesTotal ? '✓' : ''}</span>
        </div>
      )}
    </div>
  );
}

function Detail({ row, graceDays, onClose }: { row: QuotationRowView; graceDays: number; onClose: () => void }) {
  const t = row.trace;
  const w = t.nameMatchWindow;
  const sectionTitle = { fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', margin: '18px 0 8px' } as const;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 820, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', borderLeft: '4px solid #397f78', padding: '16px 20px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', lineHeight: 1.3 }}>{row.customerName || '(no customer)'}</div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 16 }}><X size={18} /></button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, color: '#fff' }}>
            <span>{row.docNumber ?? 'No quotation number'}</span>
            <span style={{ opacity: 0.4 }}>|</span><span>{row.source}</span>
            <span style={{ opacity: 0.4 }}>|</span><span>{fmtDate(row.txnDate)}</span>
            <span style={{ opacity: 0.4 }}>|</span><span>{money(row.totalAmt, row.currency)}</span>
            <span style={{ opacity: 0.4 }}>|</span><span>{row.txnStatus ?? 'Unknown'}{row.closedOn && row.statusGroup !== 'open' ? ` (last updated ${fmtDate(row.closedOn)})` : ''}</span>
          </div>
        </div>

        <div style={{ padding: '4px 20px 20px' }}>
          {row.review.completed && (
            <div style={{ margin: '14px 0 0', padding: '9px 12px', borderRadius: 8, background: '#f1f5f9', border: '1px solid #e2e8f0', fontSize: 12, color: '#334155' }}>
              <b>Completed</b> {row.review.completedAt ? fmtDate(row.review.completedAt.slice(0, 10)) : ''}{row.review.completedBy ? ` by ${row.review.completedBy.split('@')[0]}` : ''} — the invoices below are frozen as they were then; no new invoice is matched.
            </div>
          )}
          <div style={sectionTitle}>Invoices issued for this quotation</div>
          {t.status === 'not_applicable' && <div style={{ fontSize: 12, color: '#64748b' }}>Not closed yet — invoices are traced once the quotation is Closed.</div>}
          {t.status === 'none' && <div style={{ fontSize: 12, color: '#64748b' }}>Closed, but no invoice was found in TAB / TAC / TAO for this customer name in the window below. A quotation can be closed without being invoiced, or the customer may be spelled differently on the invoice.</div>}
          {t.invoices.length > 0 && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              {t.invoices.map(inv => (
                <div key={`${inv.source}|${inv.qbInvoiceId}`} style={{ display: 'grid', gridTemplateColumns: '18px 150px 96px 110px 80px minmax(0,1fr)', columnGap: 10, alignItems: 'center', padding: '9px 12px', borderTop: '1px solid #f1f5f9', fontSize: 12 }}>
                  <span title={inv.via === 'quickbooks_link' ? 'Confirmed by QuickBooks' : 'Matched by customer name'} style={{ color: inv.via === 'quickbooks_link' ? '#15803d' : '#94a3b8', fontSize: 11 }}>{inv.via === 'quickbooks_link' ? '●' : '○'}</span>
                  <span><BillingInvoiceReference company={inv.source} invoiceNo={inv.invoiceNo} id={inv.qbInvoiceId} muted={inv.status === 'Voided'} /></span>
                  <span style={{ color: '#64748b' }}>{fmtDate(inv.txnDate)}</span>
                  <span style={{ fontWeight: inv.amountMatches ? 700 : 600, color: inv.amountMatches ? '#15803d' : '#334155' }}>{money(inv.totalAmt, row.currency)}{inv.amountMatches ? ' ✓' : ''}</span>
                  <span style={{ color: inv.status === 'Paid' ? '#15803d' : inv.status === 'Voided' ? '#b91c1c' : '#c2410c', fontWeight: 700 }}>{inv.status === 'Open' ? 'Unpaid' : inv.status}</span>
                  <span style={{ color: '#94a3b8', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${inv.via === 'quickbooks_link' ? 'Confirmed by QuickBooks' : 'Matched by name'} · invoice customer: ${inv.customerName}`}>
                    {inv.via === 'quickbooks_link' ? 'QuickBooks link' : 'Matched by name'} · {inv.customerName}
                  </span>
                </div>
              ))}
            </div>
          )}
          {t.unresolvedLinkedInvoiceIds.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8' }}>
              QuickBooks also links this quotation to {row.source} invoice id {t.unresolvedLinkedInvoiceIds.join(', ')}, which is not in the synced invoice data (deleted, older than the sync window, or not synced yet).
            </div>
          )}
          {t.invoices.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: t.sumMatchesTotal ? '#15803d' : '#64748b', fontWeight: t.sumMatchesTotal ? 700 : 500 }}>
              Traced total {money(t.tracedTotal, row.currency)} · quotation {money(row.totalAmt, row.currency)}{t.sumMatchesTotal ? ' — the invoices add up to the quotation exactly ✓' : ''}
            </div>
          )}
          {w && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
              Name-matched invoices are those with the same customer name (ignoring case and Pte Ltd / Limited) dated {fmtDate(w.from)} – {fmtDate(w.to)}: from the quotation date to {graceDays} days after the quotation was last updated. ● = recorded by QuickBooks itself (same book only), ○ = matched by name only — check the amounts before relying on a ○.
            </div>
          )}

          <div style={sectionTitle}>Quotation lines</div>
          {row.lines.length === 0
            ? <div style={{ fontSize: 12, color: '#94a3b8' }}>No line detail.</div>
            : (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                {row.lines.map((l, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 46px 90px 100px', columnGap: 10, alignItems: 'start', padding: '8px 12px', borderTop: i ? '1px solid #f1f5f9' : 'none', fontSize: 12 }}>
                    <div>
                      {l.item && <div style={{ fontWeight: 700, color: '#1e293b' }}>{l.item}</div>}
                      {l.description && <div style={{ color: '#64748b', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{l.description}</div>}
                      {l.kind === 'discount' && !l.item && <div style={{ fontWeight: 700, color: '#1e293b' }}>Discount</div>}
                    </div>
                    <div style={{ textAlign: 'right', color: '#64748b' }}>{l.qty ?? ''}</div>
                    <div style={{ textAlign: 'right', color: '#64748b' }}>{l.unitPrice !== null && l.unitPrice !== undefined ? money(l.unitPrice, row.currency) : ''}</div>
                    <div style={{ textAlign: 'right', fontWeight: 700, color: '#334155' }}>{l.amount !== null && l.amount !== undefined ? money(l.amount, row.currency) : ''}</div>
                  </div>
                ))}
              </div>
            )}

          <div style={{ marginTop: 14, display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11, color: '#64748b' }}>
            <span title={creatorTitle(row)}>Created by: {row.createdBy
              ? <strong style={{ color: '#334155' }}>{row.createdBy.name}</strong>
              : <strong style={{ color: '#b45309' }}>Not set</strong>}
              <span style={{ color: '#94a3b8' }}> · {row.createdBy?.source === 'system' ? 'created in this system' : row.createdBy ? 'QuickBooks Location' : 'no Location in QuickBooks'}</span>
            </span>
            {row.expirationDate && <span>Expires: <strong style={{ color: '#334155' }}>{fmtDate(row.expirationDate)}</strong></span>}
            {row.privateNote && <span>Note: <strong style={{ color: '#334155' }}>{row.privateNote}</strong></span>}
          </div>
        </div>
      </div>
    </div>
  );
}

type LineDraft = { service: string; item: string; description: string; qty: number; rate: number };

// Vincent: "那个Quotation页面要可以实际开Quotation的功能" — everything else on
// this page only ever reads QuickBooks; this is the one write action, kept
// deliberately simple (see app/api/quickbooks/create-quotation/route.ts's own
// header comment for what it leaves out and why). requestKey is generated
// once per open, not per submit, so retrying the exact same failed attempt
// reuses QuickBooks' own requestid de-dup instead of risking a duplicate.
function NewQuotationModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [book, setBook] = useState<QbCompany>('TAB');
  const [customerName, setCustomerName] = useState('');
  const [txnDate, setTxnDate] = useState(todaySGT());
  const [expirationDate, setExpirationDate] = useState('');
  const [privateNote, setPrivateNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [creating, setCreating] = useState(false);
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerNotFound, setCustomerNotFound] = useState(false);
  const [result, setResult] = useState<{ docNumber: string; totalAmt: number } | null>(null);
  const requestKey = useRef(globalThis.crypto.randomUUID()).current;

  const total = lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const canSubmit = customerName.trim() && lines.length > 0 && lines.every(l => l.description.trim() && Number.isFinite(l.rate) && l.qty > 0);

  const submit = async () => {
    setCreating(true);
    setError(null);
    setCustomerNotFound(false);
    try {
      const res = await fetch('/api/quickbooks/create-quotation', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          book, companyName: customerName.trim(), txnDate,
          expirationDate: expirationDate || null,
          privateNote: privateNote.trim() || null,
          lines: lines.map(l => ({ service: l.service, productService: l.item, description: l.description, qty: l.qty, rate: l.rate })),
          requestKey,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        if (res.status === 404) setCustomerNotFound(true);
        setError(json.error ?? 'Unable to create the quotation.');
        return;
      }
      setResult({ docNumber: json.docNumber, totalAmt: json.totalAmt });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setCreating(false);
    }
  };

  const createCustomerAndRetry = async () => {
    setCreatingCustomer(true);
    setError(null);
    try {
      const res = await fetch('/api/quickbooks/create-customer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: book, companyName: customerName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? `Could not create the customer in QuickBooks ${book}.`); return; }
      setCustomerNotFound(false);
      await submit();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      setCreatingCustomer(false);
    }
  };

  const inputStyle = { border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12, boxSizing: 'border-box' as const, width: '100%' };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '16px 20px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>New Quotation</div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
        </div>

        {result ? (
          <div style={{ padding: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#15803d', fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
              <CheckCircle2 size={18} />Quotation {result.docNumber} created in QuickBooks {book}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 18 }}>
              S${result.totalAmt.toLocaleString()} · created as a draft (Pending) — review and send it from QuickBooks.
            </div>
            <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Done</button>
          </div>
        ) : (
          <div style={{ padding: '16px 20px 20px', display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 10, alignItems: 'center' }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Book</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['TAB', 'TAC', 'TAO'] as const).map(b => (
                  <button key={b} onClick={() => setBook(b)}
                    style={{ padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: `1px solid ${book === b ? '#1d3a5c' : '#e2e8f0'}`, background: book === b ? '#1d3a5c' : '#fff', color: book === b ? '#fff' : '#475569' }}>
                    {b}
                  </button>
                ))}
              </div>

              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Customer</label>
              <input value={customerName} onChange={e => { setCustomerName(e.target.value); setCustomerNotFound(false); }}
                placeholder="Exact QuickBooks customer name" style={inputStyle} />

              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Date</label>
              <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} style={{ ...inputStyle, width: 160 }} />

              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Expires</label>
              <input type="date" value={expirationDate} onChange={e => setExpirationDate(e.target.value)} style={{ ...inputStyle, width: 160 }} />
            </div>

            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>Lines</div>
              {lines.length > 0 && (
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
                  {lines.map((l, i) => (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 56px 90px 24px', gap: 6, alignItems: 'center', padding: '6px 8px', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
                      <input value={l.description} onChange={e => setLines(prev => prev.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} style={{ ...inputStyle, fontSize: 12 }} />
                      <input type="number" min={0} step={1} value={l.qty} onChange={e => setLines(prev => prev.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) || 0 } : x))} style={{ ...inputStyle, textAlign: 'right' }} />
                      <input type="number" min={0} step={0.01} value={l.rate} onChange={e => setLines(prev => prev.map((x, j) => j === i ? { ...x, rate: Number(e.target.value) || 0 } : x))} style={{ ...inputStyle, textAlign: 'right' }} />
                      <button onClick={() => setLines(prev => prev.filter((_, j) => j !== i))} title="Remove line" style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', display: 'flex' }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                </div>
              )}
              <select value="" onChange={e => {
                  const found = QB_CATALOG.find(x => x.item === e.target.value);
                  if (!found) return;
                  setLines(prev => [...prev, { service: found.service, item: found.item, description: found.label, qty: 1, rate: found.rate }]);
                }}
                style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="">+ Add a line…</option>
                {[...new Set(QB_CATALOG.map(x => x.category))].map(cat => (
                  <optgroup key={cat} label={cat}>
                    {QB_CATALOG.filter(x => x.category === cat).map(x => (
                      <option key={x.item} value={x.item}>{x.label}{x.rate ? `  ·  S$${x.rate.toLocaleString()}` : ''}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>Note (optional)</label>
              <textarea value={privateNote} onChange={e => setPrivateNote(e.target.value)} rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>

            {error && (
              <div style={{ padding: '9px 11px', borderRadius: 8, background: 'var(--status-danger-tint)', border: '1px solid #fecaca', color: 'var(--status-danger)', fontSize: 12, fontWeight: 600 }}>
                {error}
                {customerNotFound && (
                  <div style={{ marginTop: 8 }}>
                    <button onClick={createCustomerAndRetry} disabled={creatingCustomer}
                      style={{ padding: '6px 12px', borderRadius: 7, border: 'none', background: creatingCustomer ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 11, fontWeight: 700, cursor: creatingCustomer ? 'default' : 'pointer' }}>
                      {creatingCustomer ? 'Creating…' : `Create "${customerName.trim()}" in QuickBooks ${book}`}
                    </button>
                  </div>
                )}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
              <div style={{ fontSize: 13, color: '#334155' }}>Total <strong style={{ fontSize: 16, color: '#0f766e' }}>S${total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
              <button onClick={submit} disabled={!canSubmit || creating}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none', cursor: (!canSubmit || creating) ? 'not-allowed' : 'pointer', background: (!canSubmit || creating) ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700 }}>
                {creating ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                {creating ? 'Creating…' : 'Create Quotation'}
              </button>
            </div>
          </div>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// Remarks on a quotation (Vincent, 2026-10-07) — free text, writable on any PI at any time, completed or not; saved
// when the box loses focus.
function QuotationRemarks({ value, disabled, onSave }: { value: string | null; disabled: boolean; onSave: (text: string) => Promise<void> }) {
  const [text, setText] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const grow = useCallback(() => { const el = ref.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.max(el.scrollHeight, 32)}px`; } }, []);
  useEffect(() => { if (document.activeElement !== ref.current) setText(value ?? ''); }, [value]);
  useEffect(() => { grow(); }, [text, grow]);
  const save = async () => {
    if (text.trim() === (value ?? '').trim()) return;
    setSaving(true); setFailed(false);
    try { await onSave(text.trim()); } catch { setFailed(true); } finally { setSaving(false); }
  };
  return (
    <textarea ref={ref} value={text} rows={1} disabled={disabled || saving} placeholder="Add remarks…" aria-label="Quotation remarks"
      onChange={e => { setText(e.target.value); grow(); }} onBlur={() => void save()}
      onKeyDown={e => { if (e.key === 'Escape') { setText(value ?? ''); e.currentTarget.blur(); } }}
      title={failed ? 'Could not save — try again' : undefined}
      style={{ width: '100%', boxSizing: 'border-box', border: `1px solid ${failed ? '#fecaca' : '#e2e8f0'}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, color: '#1e293b', resize: 'none', overflow: 'hidden', fontFamily: 'inherit', background: '#fff' }} />
  );
}

export default function QuotationPage() {
  const [data, setData] = useState<QuotationData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | QbCompany>('all');
  const [creatorFilter, setCreatorFilter] = useState<string>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // 'completed' = the hidden, finished PIs (the Completed card); 'active' = the working list
  const [view, setView] = useState<'active' | 'completed'>('active');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // No setState before the fetch starts — react-hooks/set-state-in-effect
  // rejects a synchronous set at the top of an effect body. The refresh
  // button flips `refreshing` itself, in its own event handler.
  const load = useCallback(() => {
    fetch('/api/billing/quotation')
      .then(async res => {
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error ?? 'Failed to load quotations');
        setData(json as QuotationData);
        setLoadError(null);
      })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const allRows = useMemo<QuotationRowView[]>(() => data?.rows ?? [], [data]);
  // Completed PIs leave the working list (Vincent, 2026-10-07) — they only show under the Completed card
  const rows = useMemo(() => allRows.filter(r => !r.review.completed), [allRows]);
  const completedRows = useMemo(() => allRows.filter(r => r.review.completed), [allRows]);
  const creators = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.createdBy) counts.set(r.createdBy.name, (counts.get(r.createdBy.name) ?? 0) + 1);
    return { names: [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])), notSet: rows.filter(r => !r.createdBy).length };
  }, [rows]);

  const counts = useMemo(() => {
    const open = rows.filter(r => r.statusGroup === 'open');
    return {
      open: open.length,
      oldestOpen: open.reduce((max, r) => Math.max(max, r.daysOpen ?? 0), 0),
      closed: rows.filter(r => r.statusGroup === 'closed').length,
      split: rows.filter(r => r.trace.sources.length > 1).length,
      noInvoice: rows.filter(r => r.statusGroup === 'closed' && r.trace.status === 'none').length,
    };
  }, [rows]);

  const filtered = useMemo(() => {
    let list = view === 'completed' ? completedRows : rows;
    if (view === 'active' && filter === 'open' || filter === 'closed' || filter === 'rejected') list = list.filter(r => r.statusGroup === filter);
    if (view === 'active' && filter === 'split') list = list.filter(r => r.trace.sources.length > 1);
    if (view === 'active' && filter === 'noinvoice') list = list.filter(r => r.statusGroup === 'closed' && r.trace.status === 'none');
    if (sourceFilter !== 'all') list = list.filter(r => r.source === sourceFilter);
    if (creatorFilter === NOT_SET) list = list.filter(r => !r.createdBy);
    else if (creatorFilter !== 'all') list = list.filter(r => r.createdBy?.name === creatorFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(r => r.customerName.toLowerCase().includes(q) || (r.docNumber ?? '').toLowerCase().includes(q) || (r.createdBy?.name ?? '').toLowerCase().includes(q));
    return list;
  }, [rows, completedRows, view, filter, sourceFilter, creatorFilter, search]);

  const { page, setPage, totalPages, pageItems, startIndex, total } = usePagination(filtered, `${view}|${filter}|${sourceFilter}|${creatorFilter}|${search}`);

  const detailRow = expanded ? allRows.find(r => `${r.source}|${r.qbEstimateId}` === expanded) ?? null : null;

  // ── Remarks / Completed / Reopen (PATCH /api/billing/quotation) ────────────────────────────────
  const patchReview = async (r: QuotationRowView, body: Record<string, unknown>) => {
    const res = await fetch('/api/billing/quotation', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ book: r.source, estimateId: r.qbEstimateId, ...body }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? 'Save failed');
    return json as { completedAt?: string; completedBy?: string };
  };
  const updateReview = (r: QuotationRowView, patch: Partial<QuotationRowView['review']>) =>
    setData(d => d ? { ...d, rows: d.rows.map(x => (x.source === r.source && x.qbEstimateId === r.qbEstimateId ? { ...x, review: { ...x.review, ...patch } } : x)) } : d);
  const saveRemarks = async (r: QuotationRowView, text: string) => { await patchReview(r, { action: 'remarks', remarks: text }); updateReview(r, { remarks: text || null }); };
  const markCompleted = async (r: QuotationRowView) => {
    if (!window.confirm(`Mark ${r.docNumber ?? 'this quotation'} as Completed?\n\nIt leaves this list and its invoices are frozen exactly as shown now — no new invoice will be matched to it. You can find it under the Completed card.`)) return;
    const key = `${r.source}|${r.qbEstimateId}`;
    setBusyKey(key); setActionError(null);
    try {
      const out = await patchReview(r, { action: 'complete' });
      updateReview(r, { completed: true, completedAt: out.completedAt ?? new Date().toISOString(), completedBy: out.completedBy ?? null });
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); } finally { setBusyKey(null); }
  };
  const reopen = async (r: QuotationRowView) => {
    if (!window.confirm(`Reopen ${r.docNumber ?? 'this quotation'}?\n\nIt returns to the main list and invoices are matched to it again.`)) return;
    const key = `${r.source}|${r.qbEstimateId}`;
    setBusyKey(key); setActionError(null);
    try {
      await patchReview(r, { action: 'reopen' });
      updateReview(r, { completed: false, completedAt: null, completedBy: null });
      setRefreshing(true); load(); // its trace was the frozen one — read the live match again
    } catch (e) { setActionError(e instanceof Error ? e.message : String(e)); } finally { setBusyKey(null); }
  };

  return (
    <div>
      {data !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
          <MetricCard onClick={() => { setView('active'); setFilter(filter === 'open' ? 'all' : 'open'); }} active={view === 'active' && filter === 'open'}
            value={counts.open} label="Open Quotations" sub={counts.open ? `not closed yet · oldest ${counts.oldestOpen} days` : 'nothing waiting'}
            icon={<Clock size={16} />} color="#c2410c" ariaLabel="Show open quotations" />
          <MetricCard onClick={() => { setView('active'); setFilter(filter === 'closed' ? 'all' : 'closed'); }} active={view === 'active' && filter === 'closed'}
            value={counts.closed} label="Closed" sub="converted to invoice(s)"
            icon={<CheckCircle2 size={16} />} color="var(--status-success)" ariaLabel="Show closed quotations" />
          <MetricCard onClick={() => { setView('active'); setFilter(filter === 'split' ? 'all' : 'split'); }} active={view === 'active' && filter === 'split'}
            value={counts.split} label="Invoiced in 2+ Books" sub="split across TAB / TAC / TAO"
            icon={<Layers size={16} />} color="#1d3a5c" ariaLabel="Show quotations invoiced in more than one book" />
          <MetricCard onClick={() => { setView('active'); setFilter(filter === 'noinvoice' ? 'all' : 'noinvoice'); }} active={view === 'active' && filter === 'noinvoice'}
            value={counts.noInvoice} label="Closed · No Invoice Found" sub="closed, nothing traced"
            icon={<AlertTriangle size={16} />} color="#b45309" ariaLabel="Show closed quotations with no invoice found" />
          <MetricCard onClick={() => { setView(view === 'completed' ? 'active' : 'completed'); setFilter('all'); }} active={view === 'completed'}
            value={completedRows.length} label="Completed" sub={view === 'completed' ? 'showing these · click to go back' : 'hidden from the list · click to view'}
            icon={<Archive size={16} />} color="#1d3a5c" ariaLabel="Show completed quotations" />
        </div>
      )}

      {data && !data.reviewsReady && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', color: '#92400e', fontSize: 12, marginBottom: 12 }}>
          Completed and Remarks need one setup step: run <code>scripts/add-quotation-reviews.sql</code> in the Supabase SQL editor. Until then they cannot be saved.
        </div>
      )}
      {actionError && (
        <div style={{ background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{actionError}</div>
      )}
      {view === 'completed' && (
        <div style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 14px', color: '#334155', fontSize: 12, marginBottom: 12 }}>
          <b>Completed quotations</b> — hidden from the main list, invoices frozen as they were when completed. Remarks can still be written. A completed quotation&apos;s record is deleted automatically one year after it was completed.
        </div>
      )}

      {loadError && (
        <div style={{ background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{loadError}</div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="text" placeholder="Search quotation no., customer or creator…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 13, outline: 'none' }} />
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 2 }}>Source</span>
            {(['all', ...BOOKS] as const).map(b => (
              <button key={b} onClick={() => setSourceFilter(b)}
                style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: `1px solid ${sourceFilter === b ? '#1d3a5c' : '#e2e8f0'}`, background: sourceFilter === b ? '#1d3a5c' : '#fff', color: sourceFilter === b ? '#fff' : '#475569' }}>
                {b === 'all' ? 'All' : b}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 2 }}>Created By</span>
            <select value={creatorFilter} onChange={e => setCreatorFilter(e.target.value)} aria-label="Filter by who created the quotation"
              style={{ border: `1px solid ${creatorFilter === 'all' ? '#e2e8f0' : '#1d3a5c'}`, borderRadius: 6, padding: '4px 8px', fontSize: 11, fontWeight: 600, color: '#334155', background: '#fff', cursor: 'pointer' }}>
              <option value="all">All</option>
              {creators.names.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
              {creators.notSet > 0 && <option value={NOT_SET}>Not set ({creators.notSet})</option>}
            </select>
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{total} quotations</span>
        </div>
      </div>

      <div className="system-list-shell">
        <div className="system-list-title-bar" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="system-list-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><FileText size={14} />Quotation — QuickBooks Estimates</span>
            <span className="system-list-title-hint">Read live from QuickBooks. Once a quotation is closed, the invoice(s) issued for it are traced across TAB / TAC / TAO.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {data?.books.map(b => (
              <span key={b.book} title={b.error ?? `${b.book}: ${b.count} quotation${b.count === 1 ? '' : 's'} read from QuickBooks`}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#fff', color: b.ok ? '#166534' : '#991b1b' }}>
                {b.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}{b.book}{b.ok ? ` ${b.count}` : ' failed'}
              </span>
            ))}
            <button onClick={() => setShowCreate(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: 'none', background: '#0f766e', color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
              <Plus size={13} />New Quotation
            </button>
            <button onClick={() => { setRefreshing(true); load(); }} disabled={refreshing}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: refreshing ? 'default' : 'pointer', fontWeight: 600 }}>
              {refreshing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}Refresh from QuickBooks
            </button>
          </div>
        </div>
        {data && data.books.some(b => !b.ok) && (
          <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--status-danger)', fontWeight: 600, borderTop: '1px solid #fee2e2', background: '#fef2f2', lineHeight: 1.6 }}>
            {data.books.filter(b => !b.ok).map(b => <div key={b.book}>{b.error}</div>)}
            <div style={{ fontWeight: 500, color: '#991b1b' }}>Quotations from the failed book(s) are missing below — this is not the same as having none.</div>
          </div>
        )}
        <div style={{ padding: '6px 16px', fontSize: 10, color: '#94a3b8', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span><span style={{ color: '#15803d' }}>●</span> confirmed by QuickBooks (same book)</span>
          <span>○ matched by customer name — check the amount</span>
          <span><span style={{ color: '#15803d', fontWeight: 700 }}>✓</span> amount equals the quotation</span>
          {data && <span>Showing quotations dated from {fmtDate(data.windowStart)} (the last 12 months)</span>}
        </div>
        <div className="system-list-scroll" style={{ maxHeight: 'calc(100vh - 470px)', minHeight: 400 }}>
          <div style={{ minWidth: 1500 }}>
            <div className="list-column-header-gray" style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: listColumns, columnGap: 10, padding: '10px 14px', alignItems: 'center' }}>
              {['', 'PI No.', 'Date', 'Customer', 'Created By', 'Amount', 'Source', 'Status', 'Invoice Source (traced)', 'Completed', 'Remarks'].map((h, i) => (
                <div key={i} style={{ padding: '0 6px', textAlign: i === 5 || i === 6 || i === 7 || i === 9 ? 'center' : 'left' }}>{h}</div>
              ))}
            </div>
            {data === null && !loadError && (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Reading QuickBooks (TAB / TAC / TAO)…</div>
            )}
            {data !== null && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No matching quotations</div>}
            {pageItems.map((r, i) => {
              const key = `${r.source}|${r.qbEstimateId}`;
              const isOpen = expanded === key;
              return (
                <div key={key} className={`system-list-row${isOpen ? ' system-list-row--selected' : ''}`}
                  onClick={() => setExpanded(isOpen ? null : key)}
                  style={{ display: 'grid', gridTemplateColumns: listColumns, alignItems: 'center', minHeight: 56, columnGap: 10, padding: '9px 14px', cursor: 'pointer' }}>
                  <div style={{ color: '#94a3b8', display: 'flex' }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                  <div style={{ padding: '0 6px', fontSize: 12, fontWeight: 700, color: '#1e3a5f', whiteSpace: 'nowrap' }}>{r.docNumber ?? '—'}</div>
                  <div style={{ padding: '0 6px', fontSize: 11, color: '#64748b' }}>{fmtDate(r.txnDate)}</div>
                  <div style={{ padding: '0 6px' }}>
                    <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#cbd5e1', fontSize: 10 }}>{startIndex + i + 1}</span>{r.customerName || '—'}
                    </div>
                  </div>
                  <div style={{ padding: '0 6px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><CreatedBy row={r} /></div>
                  <div style={{ textAlign: 'center', fontSize: 11, color: '#374151', fontWeight: 600 }}>{money(r.totalAmt, r.currency)}</div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}><span style={chipStyle}>{r.source}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}><StatusPill row={r} /></div>
                  {/* The chips are buttons that open a PDF — clicking one must not also toggle this row. */}
                  <div style={{ padding: '0 6px' }} onClick={e => e.stopPropagation()}><TraceSummary row={r} /></div>
                  {/* Completed: the weekly check is done — the PI leaves the list and its invoices are frozen */}
                  <div style={{ padding: '0 6px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                    {r.review.completed ? (
                      <div style={{ display: 'grid', gap: 4, justifyItems: 'center' }}>
                        <span style={{ fontSize: 10, color: '#475569', lineHeight: 1.4 }}>{r.review.completedAt ? fmtDate(r.review.completedAt.slice(0, 10)) : ''}<br />{r.review.completedBy ? r.review.completedBy.split('@')[0] : ''}</span>
                        <button onClick={() => void reopen(r)} disabled={busyKey === key || !data?.reviewsReady} title="Put it back in the main list and match invoices again"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                          {busyKey === key ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <RotateCcw size={11} />}Reopen
                        </button>
                      </div>
                    ) : r.statusGroup === 'closed' ? (
                      <button onClick={() => void markCompleted(r)} disabled={busyKey === key || !data?.reviewsReady}
                        title="The weekly check is done: leave the list and freeze the invoices shown"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 11px', borderRadius: 6, border: '1px solid #15803d', background: '#15803d', color: '#fff', fontSize: 11, fontWeight: 700, cursor: busyKey === key ? 'default' : 'pointer', opacity: data?.reviewsReady ? 1 : 0.5 }}>
                        {busyKey === key ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={12} />}Completed
                      </button>
                    ) : (
                      <span title="Only a Closed quotation can be marked Completed" style={{ color: '#cbd5e1' }}>—</span>
                    )}
                  </div>
                  <div style={{ padding: '0 6px' }} onClick={e => e.stopPropagation()}>
                    <QuotationRemarks value={r.review.remarks} disabled={!data?.reviewsReady} onSave={text => saveRemarks(r, text)} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />

      {detailRow && data && <Detail row={detailRow} graceDays={data.traceGraceDays} onClose={() => setExpanded(null)} />}
      {showCreate && (
        <NewQuotationModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setRefreshing(true); load(); }}
        />
      )}
    </div>
  );
}
