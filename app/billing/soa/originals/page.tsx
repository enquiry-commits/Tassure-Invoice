'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileQuestion, FilePlus2, FileText, Layers, Loader2, RefreshCw } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { BillingInvoiceReference } from '@/components/billing/BillingInvoiceReference';
import { fmtDate } from '@/lib/date';
import { hintForReason, rowKey, rowStatus, type FileSummary, type OriginalStatusRow, type OriginalVerdict, type RowStatus } from '@/lib/original-status-core';
import type { ScanResult } from '@/lib/original-status';

// Billing System › Outstanding › Invoice Originals (Vincent, 2026-10-06; INV-QB-037).
// Accounting splits an invoice's lines after it has gone to the client, so the
// system sends a client the ORIGINAL invoice attached in QuickBooks when it can
// prove the file is the original, and only otherwise redraws it. Vincent's
// order: the original in QuickBooks, then staff fetch it from the file server
// and attach it, and the redraw last — this page is that work queue: every open
// invoice carrying a Deferred Revenue line, and what the system would do with
// it. READ ONLY: it never attaches, moves or deletes anything. It sits under
// /billing/soa so the existing "Outstanding" page rule covers it for the same
// departments (lib/workspaces.ts).

type Filter = 'all' | 'using' | 'unused' | 'nothing' | 'to-check';
const BOOKS = ['TAB', 'TAC'] as const;
const listColumns = '124px 88px minmax(190px,1.3fr) 96px 150px minmax(300px,2.4fr) 92px';

function money(n: number) {
  return `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Verdicts = Record<string, OriginalVerdict | 'checking' | { failed: string }>;

const PILL: Record<RowStatus, { label: string; color: string; border: string }> = {
  scanning: { label: 'Reading QuickBooks…', color: '#64748b', border: '#e2e8f0' },
  nothing: { label: 'Nothing attached', color: '#b45309', border: '#fed7aa' },
  'no-pdf': { label: 'Attached, not a PDF', color: '#b45309', border: '#fed7aa' },
  'to-check': { label: 'Not opened yet', color: '#1e3a5f', border: '#b8c7d6' },
  checking: { label: 'Opening files…', color: '#64748b', border: '#e2e8f0' },
  using: { label: 'Original in use', color: '#15803d', border: '#bbf7d0' },
  refused: { label: 'Not used — redrawn', color: '#b91c1c', border: '#fecaca' },
  unavailable: { label: 'QuickBooks unavailable', color: '#b91c1c', border: '#fecaca' },
  'not-split': { label: 'No longer split', color: '#64748b', border: '#e2e8f0' },
  failed: { label: 'Check failed', color: '#b91c1c', border: '#fecaca' },
};

function Pill({ status }: { status: RowStatus }) {
  const p = PILL[status];
  const busy = status === 'scanning' || status === 'checking';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 999, background: '#fff', border: `1px solid ${p.border}`, color: p.color, fontSize: 10.5, fontWeight: 750, whiteSpace: 'nowrap' }}>
      {busy ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <span style={{ width: 5, height: 5, borderRadius: '50%', background: p.color }} />}
      {p.label}
    </span>
  );
}

const who = (bySystem: boolean) => (bySystem ? 'attached by the system' : 'attached by hand');

// What is known about the files of one row, in words.
function Detail({ status, files, verdict, scanError }: { status: RowStatus; files: FileSummary[]; verdict: OriginalVerdict | null; scanError?: string }) {
  const small = { fontSize: 11.5, lineHeight: 1.5, color: '#475569' } as const;
  if (status === 'scanning' || status === 'checking') return <span style={{ ...small, color: '#94a3b8' }}>…</span>;
  if (status === 'unavailable') return <span style={{ ...small, color: '#b91c1c' }}>{verdict?.summary ?? scanError ?? 'QuickBooks could not be read.'}</span>;
  if (status === 'failed') return <span style={{ ...small, color: '#b91c1c' }}>The check did not finish — try again.</span>;
  if (status === 'not-split') return <span style={small}>{verdict?.summary}</span>;
  if (status === 'nothing') {
    return <span style={small}>Attach the PDF the client first received to this invoice in QuickBooks. Until then the system redraws it.</span>;
  }
  if (verdict && verdict.files.length) {
    return (
      <div style={{ display: 'grid', gap: 3 }}>
        {verdict.files.map(f => (
          <div key={f.id} style={small}>
            <span style={{ color: f.outcome === 'used' ? '#15803d' : f.outcome === 'refused' ? '#b91c1c' : '#94a3b8', fontWeight: 800 }}>{f.outcome === 'used' ? '✓' : f.outcome === 'refused' ? '✗' : '–'}</span>{' '}
            <span style={{ fontWeight: 600, color: '#334155' }}>{f.fileName}</span>
            <span style={{ color: '#94a3b8' }}> ({who(f.bySystem)}{f.createdAt ? `, ${fmtDate(f.createdAt)}` : ''})</span>
            {f.outcome !== 'used' && <div style={{ color: f.outcome === 'refused' ? '#b91c1c' : '#64748b', paddingLeft: 14 }}>{f.reason}</div>}
            {f.outcome !== 'used' && hintForReason(f.reason) && <div style={{ color: '#64748b', fontStyle: 'italic', paddingLeft: 14 }}>→ {hintForReason(f.reason)}</div>}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 3 }}>
      {files.map(f => (
        <div key={f.id} style={small}>
          <span style={{ fontWeight: 600, color: '#334155' }}>{f.fileName}</span>
          <span style={{ color: '#94a3b8' }}> ({who(f.bySystem)}{f.createdAt ? `, ${fmtDate(f.createdAt)}` : ''}{f.pdf ? '' : ' — not a PDF'})</span>
        </div>
      ))}
      {status === 'to-check' && <div style={{ ...small, color: '#94a3b8' }}>Open the files to see whether the system accepts one as the original.</div>}
      {status === 'no-pdf' && <div style={{ ...small, color: '#64748b', fontStyle: 'italic' }}>→ A picture or another kind of file is not used. Attach the PDF the client first received.</div>}
    </div>
  );
}

export default function InvoiceOriginalsPage() {
  const [rows, setRows] = useState<OriginalStatusRow[] | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [verdicts, setVerdicts] = useState<Verdicts>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [book, setBook] = useState<'all' | typeof BOOKS[number]>('all');
  const [search, setSearch] = useState('');
  const stop = useRef(false);

  // No setState before the fetches start (react-hooks/set-state-in-effect):
  // state is only set in the callbacks, and the refresh button flips `refreshing`
  // in its own handler.
  const load = useCallback(() => {
    const read = async (res: Response) => {
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? 'Failed to load');
      return json;
    };
    fetch('/api/billing/originals').then(read)
      .then(json => { setRows(json.rows as OriginalStatusRow[]); setLoadError(null); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)));
    fetch('/api/billing/originals/scan').then(read)
      .then(json => { setScan(json as ScanResult); setVerdicts({}); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const check = useCallback(async (r: OriginalStatusRow) => {
    const key = rowKey(r);
    setVerdicts(v => ({ ...v, [key]: 'checking' }));
    try {
      const res = await fetch(`/api/billing/originals/check?company=${r.company}&id=${encodeURIComponent(r.qbInvoiceId)}`);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? 'Check failed');
      setVerdicts(v => ({ ...v, [key]: json as OriginalVerdict }));
    } catch (err) {
      setVerdicts(v => ({ ...v, [key]: { failed: err instanceof Error ? err.message : String(err) } }));
    }
  }, []);

  const statusOf = useCallback((r: OriginalStatusRow): RowStatus => {
    const key = rowKey(r);
    return rowStatus({ scanLoaded: scan !== null, scanError: scan?.errors[r.company], scan: scan?.states[key], verdict: verdicts[key] });
  }, [scan, verdicts]);

  const statuses = useMemo(() => new Map((rows ?? []).map(r => [rowKey(r), statusOf(r)] as const)), [rows, statusOf]);
  const counts = useMemo(() => {
    const all = [...statuses.values()];
    return {
      total: all.length,
      using: all.filter(s => s === 'using').length,
      unused: all.filter(s => s === 'refused' || s === 'no-pdf').length,
      nothing: all.filter(s => s === 'nothing').length,
      toCheck: all.filter(s => s === 'to-check').length,
    };
  }, [statuses]);

  const filtered = useMemo(() => {
    let list = rows ?? [];
    if (book !== 'all') list = list.filter(r => r.company === book);
    if (filter !== 'all') {
      list = list.filter(r => {
        const s = statuses.get(rowKey(r));
        return filter === 'using' ? s === 'using' : filter === 'nothing' ? s === 'nothing' : filter === 'to-check' ? s === 'to-check' : s === 'refused' || s === 'no-pdf';
      });
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(r => r.customerName.toLowerCase().includes(q) || r.invoiceNo.toLowerCase().includes(q));
    return list;
  }, [rows, statuses, filter, book, search]);

  const { page, setPage, totalPages, pageItems, startIndex, total } = usePagination(filtered, `${filter}|${book}|${search}`, 200);

  // Opens the files of every invoice that has a PDF and has not been opened,
  // one invoice at a time — each opening is a few QuickBooks calls on a book
  // the whole office is working in, so never in parallel and only on request.
  const checkAll = async () => {
    const todo = (rows ?? []).filter(r => statuses.get(rowKey(r)) === 'to-check');
    stop.current = false;
    setProgress({ done: 0, total: todo.length });
    for (const [i, r] of todo.entries()) {
      if (stop.current) break;
      await check(r);
      setProgress({ done: i + 1, total: todo.length });
    }
    setProgress(null);
  };

  const ready = rows !== null && scan !== null;

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
        <MetricCard onClick={() => setFilter('all')} active={filter === 'all'}
          value={rows ? rows.length : '…'} label="Open split invoices" sub="carry a Deferred Revenue line"
          icon={<Layers size={16} />} color="#1d3a5c" ariaLabel="Show every open split invoice" />
        <MetricCard onClick={() => setFilter(filter === 'using' ? 'all' : 'using')} active={filter === 'using'}
          value={ready ? counts.using : '…'} label="Original in use" sub="the client gets the original"
          icon={<CheckCircle2 size={16} />} color="var(--status-success)" ariaLabel="Show invoices whose original is in use" />
        <MetricCard onClick={() => setFilter(filter === 'unused' ? 'all' : 'unused')} active={filter === 'unused'}
          value={ready ? counts.unused : '…'} label="Attached, not used" sub="the system redraws these"
          icon={<AlertTriangle size={16} />} color="#b91c1c" ariaLabel="Show invoices with a file the system did not accept" />
        <MetricCard onClick={() => setFilter(filter === 'nothing' ? 'all' : 'nothing')} active={filter === 'nothing'}
          value={ready ? counts.nothing : '…'} label="Nothing attached" sub="attach the original in QuickBooks"
          icon={<FilePlus2 size={16} />} color="#b45309" ariaLabel="Show invoices with nothing attached" />
        <MetricCard onClick={() => setFilter(filter === 'to-check' ? 'all' : 'to-check')} active={filter === 'to-check'}
          value={ready ? counts.toCheck : '…'} label="Not opened yet" sub="has a PDF — open it to see"
          icon={<FileQuestion size={16} />} color="#1e3a5f" ariaLabel="Show invoices with a PDF that has not been opened" />
      </div>

      {loadError && (
        <div style={{ background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{loadError}</div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, lineHeight: 1.65, color: '#475569' }}>
        <strong style={{ color: '#1e3a5f' }}>How the client&apos;s invoice PDF is chosen.</strong>{' '}
        Accounting splits an invoice&apos;s lines after it has gone to the client, so QuickBooks only prints the split version. For these invoices the system sends{' '}
        <strong>1.</strong> the original attached to the invoice in QuickBooks, if it can prove the file is the original; otherwise{' '}
        <strong>2.</strong> staff fetch the original (Outlook Sent Items, or the file server) and attach it in QuickBooks; and only then{' '}
        <strong>3.</strong> the system redraws the invoice — the last choice. Attach the PDF <em>the client first received</em>.{' '}
        <strong>Do not attach</strong> the file from Save PDF, a scan or photo, a PDF with a password, or several invoices in one file — the system refuses those.
      </div>

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="text" placeholder="Search invoice no. or customer…" value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, minWidth: 220, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 13, outline: 'none' }} />
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#94a3b8', marginRight: 2 }}>Book</span>
            {(['all', ...BOOKS] as const).map(b => (
              <button key={b} onClick={() => setBook(b)}
                style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: `1px solid ${book === b ? '#1d3a5c' : '#e2e8f0'}`, background: book === b ? '#1d3a5c' : '#fff', color: book === b ? '#fff' : '#475569' }}>
                {b === 'all' ? 'All' : b}
              </button>
            ))}
          </div>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{total} invoice{total === 1 ? '' : 's'}</span>
        </div>
      </div>

      <div className="system-list-shell">
        <div className="system-list-title-bar" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="system-list-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><FileText size={14} />Invoice originals — open split invoices</span>
            <span className="system-list-title-hint">Files are read live from QuickBooks. Nothing is attached, moved or deleted from this page.</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {scan && (Object.entries(scan.errors) as [string, string][]).map(([b, message]) => (
              <span key={b} title={message} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, border: '1px solid #fecaca', background: '#fff', color: '#991b1b' }}>
                <AlertTriangle size={11} />{b} failed
              </span>
            ))}
            {progress ? (
              <button onClick={() => { stop.current = true; }}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #fecaca', background: '#fff', color: '#b91c1c', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />Stop ({progress.done}/{progress.total})
              </button>
            ) : (
              <button onClick={checkAll} disabled={!ready || counts.toCheck === 0}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: 'none', background: !ready || counts.toCheck === 0 ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 12, cursor: !ready || counts.toCheck === 0 ? 'default' : 'pointer', fontWeight: 700 }}>
                <FileQuestion size={13} />Open the files ({counts.toCheck})
              </button>
            )}
            <button onClick={() => { setRefreshing(true); setScan(null); load(); }} disabled={refreshing}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: refreshing ? 'default' : 'pointer', fontWeight: 600 }}>
              {refreshing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}Refresh from QuickBooks
            </button>
          </div>
        </div>
        <div className="system-list-scroll" style={{ maxHeight: 'calc(100vh - 520px)', minHeight: 400 }}>
          <div style={{ minWidth: 1100 }}>
            <div className="list-column-header-gray" style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: listColumns, columnGap: 10, padding: '10px 14px', alignItems: 'center' }}>
              {['Invoice', 'Date', 'Customer', 'Balance', 'Status', 'Files / what the system does', ''].map((h, i) => (
                <div key={i} style={{ padding: '0 6px', textAlign: i === 3 ? 'right' : 'left' }}>{h}</div>
              ))}
            </div>
            {rows === null && !loadError && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Reading the open invoices…</div>}
            {rows !== null && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No matching invoices</div>}
            {pageItems.map((r, i) => {
              const key = rowKey(r);
              const status = statuses.get(key) ?? 'scanning';
              const v = verdicts[key];
              const verdict = v && v !== 'checking' && !('failed' in v) ? v : null;
              const files = scan?.files[key] ?? [];
              const canOpen = status === 'to-check' || status === 'refused' || status === 'failed' || status === 'using';
              return (
                <div key={key} className="system-list-row" style={{ display: 'grid', gridTemplateColumns: listColumns, alignItems: 'start', minHeight: 56, columnGap: 10, padding: '10px 14px' }}>
                  <div style={{ padding: '0 6px' }}><BillingInvoiceReference company={r.company} invoiceNo={r.invoiceNo} id={r.qbInvoiceId} /></div>
                  <div style={{ padding: '0 6px', fontSize: 11, color: '#64748b' }}>{fmtDate(r.txnDate)}</div>
                  <div style={{ padding: '0 6px' }}>
                    <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#cbd5e1', fontSize: 10 }}>{startIndex + i + 1}</span>{r.customerName || '—'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 11.5, color: '#374151', fontWeight: 600, padding: '0 6px' }}>{money(r.balance)}</div>
                  <div style={{ padding: '0 6px' }}><Pill status={status} /></div>
                  <div style={{ padding: '0 6px' }}><Detail status={status} files={files} verdict={verdict} scanError={scan?.errors[r.company]} /></div>
                  <div style={{ padding: '0 6px', display: 'flex', justifyContent: 'flex-end' }}>
                    {canOpen && (
                      <button onClick={() => check(r)} title="Open the attached files and see whether the system accepts one as the original"
                        style={{ padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: '1px solid #e2e8f0', background: '#fff', color: '#475569' }}>
                        {status === 'to-check' ? 'Open files' : 'Re-check'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
