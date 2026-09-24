'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, RefreshCw, X, ChevronDown, ChevronRight, CheckCircle2, AlertTriangle, Layers, Clock, Loader2 } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { BillingInvoiceReference } from '@/components/billing/BillingInvoiceReference';
import { fmtDate } from '@/lib/date';
import type { QbCompany } from '@/lib/quickbooks';
import type { QuotationData, QuotationRow, QuotationTraceInvoice } from '@/app/api/billing/quotation/route';

// Billing System › Quotation (Vincent, 2026-09-24). A quotation is a
// QuickBooks Estimate ("PI…" numbers). Once one is Closed, this page shows
// which book(s) — TAB / TAC / TAO — the invoice(s) issued for it went to.
// Vincent-only for now: proxy.ts hard-blocks direct navigation to this path
// for every account without canViewQuotation (same pattern as /sg-news), and
// app/api/billing/quotation/route.ts enforces the same flag server-side.

type StatusFilter = 'all' | 'open' | 'closed' | 'rejected' | 'split' | 'noinvoice';

const BOOKS: QbCompany[] = ['TAB', 'TAC', 'TAO'];
const listColumns = '28px 104px 96px minmax(210px,1.5fr) 118px 66px 118px minmax(290px,2fr)';

function money(n: number, currency?: string | null) {
  const body = n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return !currency || currency === 'SGD' ? `S$${body}` : `${currency} ${body}`;
}

// Same neutral look as the Source badges elsewhere in Billing System —
// per-book colours were deliberately removed there.
const chipStyle = { display: 'inline-flex', alignItems: 'center', fontSize: 10, fontWeight: 800, letterSpacing: '0.02em', padding: '2px 7px', borderRadius: 5, border: '1px solid #b8c7d6', background: '#fff', color: '#1e3a5f' } as const;

function StatusPill({ row }: { row: QuotationRow }) {
  const tone = row.statusGroup === 'closed'
    ? { border: '#bbf7d0', color: '#15803d' }
    : row.statusGroup === 'rejected'
      ? { border: '#e2e8f0', color: '#64748b' }
      : { border: '#fed7aa', color: '#c2410c' };
  const label = row.txnStatus ?? 'Unknown';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 8px', borderRadius: 999, background: '#fff', border: `1px solid ${tone.border}`, color: tone.color, fontSize: 9.5, fontWeight: 750, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: tone.color }} />
      {label}{row.daysOpen !== null ? ` · ${row.daysOpen}d` : ''}
    </span>
  );
}

// One traced invoice: ● = QuickBooks itself recorded the conversion,
// ○ = matched by customer name only. The chip is the shared
// BillingInvoiceReference ("TAB #02611060", opens the real QuickBooks PDF).
function TracedInvoice({ inv, currency }: { inv: QuotationTraceInvoice; currency: string | null }) {
  const confirmed = inv.via === 'quickbooks_link';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
      <span title={confirmed ? 'Confirmed by QuickBooks (converted with Copy to invoice)' : 'Matched by customer name — not recorded in QuickBooks'}
        style={{ fontSize: 9, lineHeight: 1, color: confirmed ? '#15803d' : '#94a3b8' }}>{confirmed ? '●' : '○'}</span>
      <BillingInvoiceReference company={inv.source} invoiceNo={inv.invoiceNo} id={inv.qbInvoiceId} muted={inv.status === 'Voided'} />
      <span style={{ fontSize: 10.5, fontWeight: inv.amountMatches ? 800 : 500, color: inv.amountMatches ? '#15803d' : '#64748b' }}>
        {money(inv.totalAmt, currency)}{inv.amountMatches ? ' ✓' : ''}
      </span>
      {inv.status === 'Voided' && <span style={{ fontSize: 9.5, fontWeight: 700, color: '#b91c1c' }}>VOID</span>}
    </span>
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
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '2px 0' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px' }}>
        {shown.map(inv => <TracedInvoice key={`${inv.source}|${inv.qbInvoiceId}`} inv={inv} currency={row.currency} />)}
        {t.invoices.length > shown.length && <span style={{ fontSize: 10.5, color: '#94a3b8' }}>+{t.invoices.length - shown.length} more</span>}
        {t.unresolvedLinkedInvoiceIds.map(id => (
          <span key={id} title="QuickBooks says this quotation was converted to this invoice, but it is not in the synced invoice data (deleted, older than the sync window, or not synced yet)"
            style={{ fontSize: 10.5, color: '#94a3b8' }}>● {row.source} invoice id {id} (not in synced data)</span>
        ))}
      </div>
      {showReconcile && comparable && t.invoices.length > 0 && (
        <div style={{ fontSize: 10, color: t.sumMatchesTotal ? '#15803d' : '#94a3b8', fontWeight: t.sumMatchesTotal ? 700 : 500 }}>
          {t.sumMatchesTotal
            ? `Traced ${money(t.tracedTotal, row.currency)} = quotation ${money(row.totalAmt, row.currency)} ✓`
            : `Traced ${money(t.tracedTotal, row.currency)} vs quotation ${money(row.totalAmt, row.currency)}`}
        </div>
      )}
    </div>
  );
}

function Detail({ row, graceDays, onClose }: { row: QuotationRow; graceDays: number; onClose: () => void }) {
  const t = row.trace;
  const w = t.nameMatchWindow;
  const sectionTitle = { fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.04em', margin: '18px 0 8px' } as const;
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 820, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', borderLeft: '4px solid #397f78', padding: '16px 20px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{row.customerName || '(no customer)'}</div>
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
          <div style={sectionTitle}>Invoices issued for this quotation</div>
          {t.status === 'not_applicable' && <div style={{ fontSize: 12.5, color: '#64748b' }}>Not closed yet — invoices are traced once the quotation is Closed.</div>}
          {t.status === 'none' && <div style={{ fontSize: 12.5, color: '#64748b' }}>Closed, but no invoice was found in TAB / TAC / TAO for this customer name in the window below. A quotation can be closed without being invoiced, or the customer may be spelled differently on the invoice.</div>}
          {t.invoices.length > 0 && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              {t.invoices.map(inv => (
                <div key={`${inv.source}|${inv.qbInvoiceId}`} style={{ display: 'grid', gridTemplateColumns: '18px 150px 96px 110px 80px minmax(0,1fr)', columnGap: 10, alignItems: 'center', padding: '9px 12px', borderTop: '1px solid #f1f5f9', fontSize: 12 }}>
                  <span title={inv.via === 'quickbooks_link' ? 'Confirmed by QuickBooks' : 'Matched by customer name'} style={{ color: inv.via === 'quickbooks_link' ? '#15803d' : '#94a3b8', fontSize: 11 }}>{inv.via === 'quickbooks_link' ? '●' : '○'}</span>
                  <span><BillingInvoiceReference company={inv.source} invoiceNo={inv.invoiceNo} id={inv.qbInvoiceId} muted={inv.status === 'Voided'} /></span>
                  <span style={{ color: '#64748b' }}>{fmtDate(inv.txnDate)}</span>
                  <span style={{ fontWeight: inv.amountMatches ? 800 : 600, color: inv.amountMatches ? '#15803d' : '#334155' }}>{money(inv.totalAmt, row.currency)}{inv.amountMatches ? ' ✓' : ''}</span>
                  <span style={{ color: inv.status === 'Paid' ? '#15803d' : inv.status === 'Voided' ? '#b91c1c' : '#c2410c', fontWeight: 700 }}>{inv.status === 'Open' ? 'Unpaid' : inv.status}</span>
                  <span style={{ color: '#94a3b8', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={`${inv.via === 'quickbooks_link' ? 'Confirmed by QuickBooks' : 'Matched by name'} · invoice customer: ${inv.customerName}`}>
                    {inv.via === 'quickbooks_link' ? 'QuickBooks link' : 'Matched by name'} · {inv.customerName}
                  </span>
                </div>
              ))}
            </div>
          )}
          {t.unresolvedLinkedInvoiceIds.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: '#94a3b8' }}>
              QuickBooks also links this quotation to {row.source} invoice id {t.unresolvedLinkedInvoiceIds.join(', ')}, which is not in the synced invoice data (deleted, older than the sync window, or not synced yet).
            </div>
          )}
          {t.invoices.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11.5, color: t.sumMatchesTotal ? '#15803d' : '#64748b', fontWeight: t.sumMatchesTotal ? 700 : 500 }}>
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
            ? <div style={{ fontSize: 12.5, color: '#94a3b8' }}>No line detail.</div>
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

          <div style={{ marginTop: 14, display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11.5, color: '#64748b' }}>
            {row.locationName && <span>Location (operator): <strong style={{ color: '#334155' }}>{row.locationName}</strong></span>}
            {row.expirationDate && <span>Expires: <strong style={{ color: '#334155' }}>{fmtDate(row.expirationDate)}</strong></span>}
            {row.privateNote && <span>Note: <strong style={{ color: '#334155' }}>{row.privateNote}</strong></span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function QuotationPage() {
  const [data, setData] = useState<QuotationData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | QbCompany>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

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

  const rows = useMemo(() => data?.rows ?? [], [data]);

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
    let list = rows;
    if (filter === 'open' || filter === 'closed' || filter === 'rejected') list = list.filter(r => r.statusGroup === filter);
    if (filter === 'split') list = list.filter(r => r.trace.sources.length > 1);
    if (filter === 'noinvoice') list = list.filter(r => r.statusGroup === 'closed' && r.trace.status === 'none');
    if (sourceFilter !== 'all') list = list.filter(r => r.source === sourceFilter);
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(r => r.customerName.toLowerCase().includes(q) || (r.docNumber ?? '').toLowerCase().includes(q));
    return list;
  }, [rows, filter, sourceFilter, search]);

  const { page, setPage, totalPages, pageItems, startIndex, total } = usePagination(filtered, `${filter}|${sourceFilter}|${search}`);

  const detailRow = expanded ? rows.find(r => `${r.source}|${r.qbEstimateId}` === expanded) ?? null : null;

  return (
    <div>
      {data !== null && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
          <MetricCard onClick={() => setFilter(filter === 'open' ? 'all' : 'open')} active={filter === 'open'}
            value={counts.open} label="Open Quotations" sub={counts.open ? `not closed yet · oldest ${counts.oldestOpen} days` : 'nothing waiting'}
            icon={<Clock size={16} />} color="#c2410c" ariaLabel="Show open quotations" />
          <MetricCard onClick={() => setFilter(filter === 'closed' ? 'all' : 'closed')} active={filter === 'closed'}
            value={counts.closed} label="Closed" sub="converted to invoice(s)"
            icon={<CheckCircle2 size={16} />} color="var(--status-success)" ariaLabel="Show closed quotations" />
          <MetricCard onClick={() => setFilter(filter === 'split' ? 'all' : 'split')} active={filter === 'split'}
            value={counts.split} label="Invoiced in 2+ Books" sub="split across TAB / TAC / TAO"
            icon={<Layers size={16} />} color="#1d3a5c" ariaLabel="Show quotations invoiced in more than one book" />
          <MetricCard onClick={() => setFilter(filter === 'noinvoice' ? 'all' : 'noinvoice')} active={filter === 'noinvoice'}
            value={counts.noInvoice} label="Closed · No Invoice Found" sub="closed, nothing traced"
            icon={<AlertTriangle size={16} />} color="#b45309" ariaLabel="Show closed quotations with no invoice found" />
        </div>
      )}

      {loadError && (
        <div style={{ background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{loadError}</div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="text" placeholder="Search quotation no. or customer…" value={search} onChange={e => setSearch(e.target.value)}
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
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#fff', color: b.ok ? '#166534' : '#991b1b' }}>
                {b.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}{b.book}{b.ok ? ` ${b.count}` : ' failed'}
              </span>
            ))}
            <button onClick={() => { setRefreshing(true); load(); }} disabled={refreshing}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: refreshing ? 'default' : 'pointer', fontWeight: 600 }}>
              {refreshing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}Refresh from QuickBooks
            </button>
          </div>
        </div>
        {data && data.books.some(b => !b.ok) && (
          <div style={{ padding: '8px 16px', fontSize: 11.5, color: 'var(--status-danger)', fontWeight: 600, borderTop: '1px solid #fee2e2', background: '#fef2f2', lineHeight: 1.6 }}>
            {data.books.filter(b => !b.ok).map(b => <div key={b.book}>{b.error}</div>)}
            <div style={{ fontWeight: 500, color: '#991b1b' }}>Quotations from the failed book(s) are missing below — this is not the same as having none.</div>
          </div>
        )}
        <div style={{ padding: '6px 16px', fontSize: 10.5, color: '#94a3b8', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span><span style={{ color: '#15803d' }}>●</span> confirmed by QuickBooks (same book)</span>
          <span>○ matched by customer name — check the amount</span>
          <span><span style={{ color: '#15803d', fontWeight: 800 }}>✓</span> amount equals the quotation</span>
          {data && <span>Showing quotations dated from {fmtDate(data.windowStart)} (the synced invoice window)</span>}
        </div>
        <div className="system-list-scroll" style={{ maxHeight: 'calc(100vh - 470px)', minHeight: 400 }}>
          <div style={{ minWidth: 1000 }}>
            <div className="list-column-header-gray" style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: listColumns, columnGap: 10, padding: '10px 14px', alignItems: 'center' }}>
              {['', 'PI No.', 'Date', 'Customer', 'Amount', 'Source', 'Status', 'Invoice Source (traced)'].map((h, i) => (
                <div key={i} style={{ padding: '0 6px', textAlign: i === 4 || i === 5 || i === 6 ? 'center' : 'left' }}>{h}</div>
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
                  <div style={{ textAlign: 'center', fontSize: 11.5, color: '#374151', fontWeight: 600 }}>{money(r.totalAmt, r.currency)}</div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}><span style={chipStyle}>{r.source}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'center' }}><StatusPill row={r} /></div>
                  {/* The chips are buttons that open a PDF — clicking one must not also toggle this row. */}
                  <div style={{ padding: '0 6px' }} onClick={e => e.stopPropagation()}><TraceSummary row={r} /></div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />

      {detailRow && data && <Detail row={detailRow} graceDays={data.traceGraceDays} onClose={() => setExpanded(null)} />}
    </div>
  );
}
