'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FilePlus2, FileText, Layers, Loader2, RefreshCw, Upload } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { BillingInvoiceReference } from '@/components/billing/BillingInvoiceReference';
import { fmtDate } from '@/lib/date';
import { hintForReason, rowKey, type QueueResult, type QueueRow } from '@/lib/original-status-core';
import type { UploadResult } from '@/lib/original-upload';

// Billing System › Outstanding › Invoice Originals (Vincent, 2026-10-06; INV-QB-037).
// Accounting splits an invoice's lines after it has gone to the client, so the
// system sends the client the ORIGINAL invoice attached in QuickBooks when it
// can prove the file is the original, and only otherwise redraws it. This page
// is the to-do list for the invoices that still have no such file — and ONLY
// those: an invoice whose original is in use is finished work and is not
// listed. Staff find the original (Outlook Sent Items, the file server) and
// upload it on the row; the server checks it against the live invoice, attaches
// it to the invoice in QuickBooks, and the row leaves the list. It sits under
// /billing/soa so the existing "Outstanding" page rule covers it for the same
// departments (lib/workspaces.ts).

type Filter = 'all' | 'nothing' | 'unused';
const BOOKS = ['TAB', 'TAC'] as const;
const MAX_BYTES = 1024 * 1024;
const listColumns = '124px 88px minmax(190px,1.2fr) 96px minmax(320px,2.6fr) 150px';

function money(n: number) {
  return `S$${n.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// What the last upload on a row said, when the row stays on the list.
type Note = { tone: 'bad' | 'warn'; text: string; hint?: string | null };
type Finished = { key: string; invoiceNo: string; text: string };

const WAITING: Record<QueueRow['state'], { label: string; color: string; border: string }> = {
  nothing: { label: 'Nothing attached', color: '#b45309', border: '#fed7aa' },
  'no-pdf': { label: 'No PDF attached', color: '#b45309', border: '#fed7aa' },
  refused: { label: 'Attached, not accepted', color: '#b91c1c', border: '#fecaca' },
};

function Pill({ state }: { state: QueueRow['state'] }) {
  const p = WAITING[state];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 999, background: '#fff', border: `1px solid ${p.border}`, color: p.color, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>
      <span style={{ width: 5, height: 5, borderRadius: '50%', background: p.color }} />{p.label}
    </span>
  );
}

const who = (bySystem: boolean) => (bySystem ? 'attached by the system' : 'attached by hand');

// What is attached now and why none of it is used, in words staff can act on.
function Detail({ row }: { row: QueueRow }) {
  const small = { fontSize: 11, lineHeight: 1.5, color: '#475569' } as const;
  const goesOut = (
    <div style={{ ...small, color: '#64748b' }}>
      <strong style={{ fontWeight: 700, color: '#475569' }}>The client gets now:</strong> {row.fallback}
    </div>
  );
  if (row.state === 'nothing') {
    return (
      <div style={{ display: 'grid', gap: 4 }}>
        <span style={small}>Nothing is attached to this invoice in QuickBooks. Find the PDF the client first received and upload it here.</span>
        {goesOut}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      {row.tried.map(f => (
        <div key={f.id} style={small}>
          <span style={{ color: '#b91c1c', fontWeight: 700 }}>✗</span>{' '}
          <span style={{ fontWeight: 600, color: '#334155' }}>{f.fileName}</span>
          <span style={{ color: '#94a3b8' }}> ({who(f.bySystem)}{f.createdAt ? `, ${fmtDate(f.createdAt)}` : ''})</span>
          <div style={{ paddingLeft: 14 }}>{f.reason}</div>
          {hintForReason(f.reason) && <div style={{ color: '#64748b', fontStyle: 'italic', paddingLeft: 14 }}>→ {hintForReason(f.reason)}</div>}
        </div>
      ))}
      {goesOut}
    </div>
  );
}

export default function InvoiceOriginalsPage() {
  const [queue, setQueue] = useState<QueueResult | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [book, setBook] = useState<'all' | typeof BOOKS[number]>('all');
  const [search, setSearch] = useState('');
  // The rows done in this visit leave the list at once, without re-reading QuickBooks.
  const [finished, setFinished] = useState<Finished[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [notes, setNotes] = useState<Record<string, Note>>({});
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});

  // No setState before the fetch starts (react-hooks/set-state-in-effect): state
  // is only set in the callbacks, and the refresh button flips `refreshing` in
  // its own handler.
  const load = useCallback(() => {
    fetch('/api/billing/originals')
      .then(async res => {
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error ?? 'Failed to load');
        return json as QueueResult;
      })
      .then(json => { setQueue(json); setLoadError(null); setFinished([]); setNotes({}); })
      .catch(err => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setRefreshing(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const doneKeys = useMemo(() => new Set(finished.map(f => f.key)), [finished]);
  const rows = useMemo(() => (queue?.rows ?? []).filter(r => !doneKeys.has(rowKey(r))), [queue, doneKeys]);

  const counts = useMemo(() => ({
    waiting: rows.length,
    nothing: rows.filter(r => r.state === 'nothing').length,
    unused: rows.filter(r => r.state !== 'nothing').length,
  }), [rows]);

  const filtered = useMemo(() => {
    let list = rows;
    if (book !== 'all') list = list.filter(r => r.company === book);
    if (filter === 'nothing') list = list.filter(r => r.state === 'nothing');
    if (filter === 'unused') list = list.filter(r => r.state !== 'nothing');
    const q = search.trim().toLowerCase();
    if (q) list = list.filter(r => r.customerName.toLowerCase().includes(q) || r.invoiceNo.toLowerCase().includes(q));
    return list;
  }, [rows, filter, book, search]);

  const { page, setPage, totalPages, pageItems, startIndex, total } = usePagination(filtered, `${filter}|${book}|${search}`, 200);

  const upload = useCallback(async (r: QueueRow, file: File) => {
    const key = rowKey(r);
    const say = (note: Note | null) => setNotes(n => { const next = { ...n }; if (note) next[key] = note; else delete next[key]; return next; });
    say(null);
    if (file.size > MAX_BYTES) {
      say({ tone: 'bad', text: `${file.name} is larger than 1 MB — an invoice PDF is 80–260 KB.`, hint: hintForReason('larger than 1 MB') });
      return;
    }
    setBusy(b => ({ ...b, [key]: true }));
    try {
      const form = new FormData();
      form.append('company', r.company);
      form.append('id', r.qbInvoiceId);
      form.append('file', file);
      const res = await fetch('/api/billing/originals/upload', { method: 'POST', body: form });
      const json = await res.json().catch(() => null) as UploadResult | { error: string } | null;
      if (!json || !('status' in json)) throw new Error(json?.error ?? (res.status === 413 ? 'The file is too large to upload.' : `The upload did not finish (HTTP ${res.status}).`));
      const done = (text: string) => setFinished(f => [{ key, invoiceNo: `${r.company} #${r.invoiceNo}`, text }, ...f]);
      switch (json.status) {
        case 'attached': done('original attached — the system now sends it to the client'); break;
        case 'already': done('already has its original — nothing more to do'); break;
        case 'not-split': done('is no longer split — QuickBooks’ own PDF is used, no original needed'); break;
        case 'refused': say({ tone: 'bad', text: `${file.name} was not accepted: ${json.reason}. Nothing was attached.`, hint: json.hint }); break;
        case 'unconfirmed': say({ tone: 'warn', text: `${file.name} was attached to the invoice in QuickBooks, but the system could not confirm yet that it uses it (${json.reason}). Press Refresh in a minute.` }); break;
        case 'failed': say({ tone: 'bad', text: json.error }); break;
      }
    } catch (err) {
      say({ tone: 'bad', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(b => ({ ...b, [key]: false }));
    }
  }, []);

  const ready = queue !== null;
  const failedBooks = Object.entries(queue?.errors ?? {}) as [string, string][];

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
        <MetricCard onClick={() => setFilter('all')} active={filter === 'all'}
          value={ready ? counts.waiting : '…'} label="Waiting for an original" sub="no original the system accepts yet"
          icon={<Layers size={16} />} color="#1d3a5c" ariaLabel="Show every invoice waiting for an original" />
        <MetricCard onClick={() => setFilter(filter === 'nothing' ? 'all' : 'nothing')} active={filter === 'nothing'}
          value={ready ? counts.nothing : '…'} label="Nothing attached" sub="find the PDF the client received"
          icon={<FilePlus2 size={16} />} color="#b45309" ariaLabel="Show invoices with nothing attached" />
        <MetricCard onClick={() => setFilter(filter === 'unused' ? 'all' : 'unused')} active={filter === 'unused'}
          value={ready ? counts.unused : '…'} label="Attached, not accepted" sub="see why on each row"
          icon={<AlertTriangle size={16} />} color="#b91c1c" ariaLabel="Show invoices with a file the system did not accept" />
      </div>

      {loadError && (
        <div style={{ background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{loadError}</div>
      )}

      {finished.length > 0 && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '8px 14px', marginBottom: 12, fontSize: 12, lineHeight: 1.7, color: '#166534' }}>
          {finished.slice(0, 8).map(f => (
            <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}><CheckCircle2 size={13} /><strong>{f.invoiceNo}</strong> {f.text}</div>
          ))}
          {finished.length > 8 && <div style={{ color: '#4d7c5f' }}>…and {finished.length - 8} more</div>}
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, lineHeight: 1.65, color: '#475569' }}>
        <strong style={{ color: '#1e3a5f' }}>What to do here.</strong>{' '}
        Accounting splits an invoice&apos;s lines after it has gone to the client, so QuickBooks can only print the split version. The system sends the client the{' '}
        <strong>original</strong> — the PDF the client first received — when it is attached to the invoice in QuickBooks and the system can prove it is that. The invoices below still have no such file.{' '}
        Find it (Outlook Sent Items, the file server) and <strong>upload it on its row</strong>: the system checks it against the invoice (number, customer, date, amounts) and attaches it to the invoice in QuickBooks; from then on the SOA, Email Drafts and Save PDF use it, and the row leaves this list. Until then the client gets the redraw — or, where the system cannot draw the invoice, QuickBooks&apos; own PDF. Invoices whose original is in use, and the few that were decided to stay as they are, are not listed.{' '}
        <strong>Do not upload</strong> the file from Save PDF, a scan or photo, a PDF with a password, or several invoices in one file — the system refuses those.
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
            <span className="system-list-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><FileText size={14} />Invoices waiting for their original</span>
            <span className="system-list-title-hint">
              Read live from QuickBooks{queue && queue.done + queue.decided > 0 ? ` · ${queue.done + queue.decided} other open split invoice${queue.done + queue.decided === 1 ? '' : 's'} need${queue.done + queue.decided === 1 ? 's' : ''} nothing and ${queue.done + queue.decided === 1 ? 'is' : 'are'} not listed (${queue.done} with the original in use, ${queue.decided} decided to stay as they are)` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {failedBooks.map(([b, message]) => (
              <span key={b} title={message} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 999, border: '1px solid #fecaca', background: '#fff', color: '#991b1b' }}>
                <AlertTriangle size={11} />{b} could not be fully checked{queue && queue.unknown ? ` (${queue.unknown} invoice${queue.unknown === 1 ? '' : 's'} not checked)` : ''}
              </span>
            ))}
            <button onClick={() => { setRefreshing(true); setQueue(null); load(); }} disabled={refreshing || !ready && !loadError}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 12, cursor: refreshing ? 'default' : 'pointer', fontWeight: 600 }}>
              {refreshing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}Refresh from QuickBooks
            </button>
          </div>
        </div>
        <div className="system-list-scroll" style={{ maxHeight: 'calc(100vh - 520px)', minHeight: 400 }}>
          <div style={{ minWidth: 1100 }}>
            <div className="list-column-header-gray" style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: listColumns, columnGap: 10, padding: '10px 14px', alignItems: 'center' }}>
              {['Invoice', 'Date', 'Customer', 'Balance', 'In QuickBooks now', ''].map((h, i) => (
                <div key={i} style={{ padding: '0 6px', textAlign: i === 3 ? 'right' : 'left' }}>{h}</div>
              ))}
            </div>
            {queue === null && !loadError && (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle', marginRight: 8 }} />
                Reading the open invoices and the files attached in QuickBooks… this can take up to a minute.
              </div>
            )}
            {queue !== null && filtered.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>
                {rows.length === 0 && failedBooks.length === 0 ? 'Every open split invoice has its original — nothing to do.' : rows.length === 0 ? 'Nothing could be listed — see the book that could not be checked above.' : 'No matching invoices'}
              </div>
            )}
            {pageItems.map((r, i) => {
              const key = rowKey(r);
              const note = notes[key];
              const working = !!busy[key];
              return (
                <div key={key} className="system-list-row" style={{ display: 'grid', gridTemplateColumns: listColumns, alignItems: 'start', minHeight: 56, columnGap: 10, padding: '10px 14px' }}>
                  <div style={{ padding: '0 6px' }}><BillingInvoiceReference company={r.company} invoiceNo={r.invoiceNo} id={r.qbInvoiceId} /></div>
                  <div style={{ padding: '0 6px', fontSize: 11, color: '#64748b' }}>{fmtDate(r.txnDate)}</div>
                  <div style={{ padding: '0 6px' }}>
                    <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#cbd5e1', fontSize: 10 }}>{startIndex + i + 1}</span>{r.customerName || '—'}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 11, color: '#374151', fontWeight: 600, padding: '0 6px' }}>{money(r.balance)}</div>
                  <div style={{ padding: '0 6px', display: 'grid', gap: 6 }}>
                    <div><Pill state={r.state} /></div>
                    <Detail row={r} />
                    {note && (
                      <div style={{ fontSize: 11, lineHeight: 1.5, padding: '6px 9px', borderRadius: 7, border: `1px solid ${note.tone === 'bad' ? '#fecaca' : '#fde68a'}`, background: note.tone === 'bad' ? '#fef2f2' : '#fffbeb', color: note.tone === 'bad' ? '#991b1b' : '#92400e' }}>
                        {note.text}
                        {note.hint && <div style={{ fontStyle: 'italic', marginTop: 2 }}>→ {note.hint}</div>}
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '0 6px', display: 'flex', justifyContent: 'flex-end' }}>
                    <input ref={el => { inputs.current[key] = el; }} type="file" accept="application/pdf,.pdf" hidden
                      onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(r, f); }} />
                    <button onClick={() => inputs.current[key]?.click()} disabled={working}
                      title="Upload the PDF the client first received. The system checks it against this invoice before attaching it in QuickBooks."
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: 'none', background: working ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 12, cursor: working ? 'default' : 'pointer', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {working ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={13} />}{working ? 'Checking…' : 'Upload original'}
                    </button>
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
