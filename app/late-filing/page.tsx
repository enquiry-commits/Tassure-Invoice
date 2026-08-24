'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { AlertTriangle, Plus, Check, X, RefreshCw, Zap, Calendar, Building2, Clock, ChevronRight, Trash2 } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { fmtDate as fmtDateStr, toDisplayDate, toIsoDateValue } from '@/lib/date';

const FYE_MONTHS = ['ALL','JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];

// Derive the outstanding year from a row
function lateYear(row: LateRow): number | null {
  if (row.late_fy) return row.late_fy;
  if (row.next_agm_due_date) return new Date(row.next_agm_due_date).getFullYear();
  if (row.last_annual_return_date) return new Date(row.last_annual_return_date).getFullYear() + 1;
  return null;
}

type LateRow = {
  id: string;
  company_name: string;
  uen: string;
  financial_year_end: string;
  last_annual_return_date: string | null;
  last_agm_date: string | null;
  last_accounts_date: string | null;
  next_agm_due_date: string | null;
  remarks: string | null;
  late_fy: number;
  source: 'auto' | 'manual';
  updated_at: string | null;
  manual_fields: Record<string, boolean> | null;
};

const REMARKS_OPTIONS = [
  '',
  'ACRA STRIKE OFF',
  'STRIKE OFF - CLIENT LODGED OBJECTION',
  'ACRA STRIKE OFF - CLIENT LODGED OBJECTION',
  'LATE FILING',
];

// Classify a late-filing row into one of four buckets, so the count can be
// broken down instead of a single "Total". Signal comes from the auto-detection
// remark plus (for manual/strike-off rows) the outstanding due date:
//   serious  — genuinely, badly overdue (> 1 year) or actively being struck off
//   recent   — overdue, but only recently (<= 1 year past due)
//   review   — manually flagged as possibly-resolved, pending human check
// Vincent, 2026-08-20: dropped the old "habitual" bucket (a bad historical
// average alone, with no cycle actually overdue right now) — too easy to
// confuse with companies genuinely late today. A bad average is still
// shown as supplementary text on a row that IS currently overdue; it's
// just never the reason a row gets flagged at all on its own anymore
// (see app/api/late-filing/sync/route.ts's isLate).
type LateCategory = 'serious' | 'recent' | 'review' | 'resolved';
function categorize(row: LateRow): LateCategory {
  const r = row.remarks ?? '';
  if (/^Resolved:/i.test(r)) return 'resolved';
  if (/^Review:/i.test(r)) return 'review';

  const overdueMatch = r.match(/Overdue (\d+) days/);
  const isStrikeOff = /STRIKE OFF/i.test(r);

  let overdueDays: number | null = overdueMatch ? parseInt(overdueMatch[1], 10) : null;
  // Manual strike-off rows (no "Overdue N" remark): derive from the due date.
  if (overdueDays === null && row.next_agm_due_date) {
    overdueDays = Math.round((Date.now() - new Date(row.next_agm_due_date + 'T00:00:00').getTime()) / 86400000);
  }

  if (isStrikeOff) return 'serious';
  if (overdueDays !== null && overdueDays > 365) return 'serious';
  return 'recent';
}

function fmtDate(d: string | null) {
  if (!d) return <span style={{ color: '#94a3b8' }}>NA</span>;
  return fmtDateStr(d);
}

// Text field showing "D MMM YYYY" (e.g. 30 Sep 2021), with a calendar button
// that opens a hidden native date input purely to pick a value — the native
// input itself is never shown, so its locale-dependent yyyy/mm/dd rendering
// never appears. `value`/`onChange` are the canonical ISO (yyyy-mm-dd) form.
function DateField({ label, value, onChange }: { label: string; value: string | null | undefined; onChange: (iso: string | null) => void }) {
  const [text, setText] = useState(toDisplayDate(value ?? null) ?? '');
  const dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(toDisplayDate(value ?? null) ?? ''); }, [value]);
  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) { onChange(null); return; }
    const iso = toIsoDateValue(trimmed);
    if (iso) { onChange(iso); setText(toDisplayDate(iso) ?? ''); }
    else { setText(toDisplayDate(value ?? null) ?? ''); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '3px 8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 200px', minWidth: 0 }}>
        <input type="text" value={text} onChange={e => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { setText(toDisplayDate(value ?? null) ?? ''); } }}
          placeholder="e.g. 03 Apr 2026"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: '3px 0', fontSize: 13, fontWeight: 500, color: '#1e293b', boxSizing: 'border-box' }} />
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" data-cal-btn="1" tabIndex={0}
            onMouseDown={e => { e.preventDefault(); dateRef.current?.showPicker?.(); }}
            style={{ border: '1px solid #c7d2fe', borderRadius: 4, background: '#eef2ff', color: '#4338ca', cursor: 'pointer', padding: '3px 6px', display: 'flex', alignItems: 'center' }}>
            <Calendar size={12} />
          </button>
          <input ref={dateRef} type="date" onChange={e => { const v = e.target.value || null; onChange(v); e.target.value = ''; }}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0, top: 0, left: 0 }} />
        </div>
      </div>
    </div>
  );
}

// Vincent: match Billing tab's "Invoiced"/"To invoice" pill palette exactly
// (app/billing/page.tsx's BillingStatusPill) — green #15803d/#f0fdf4/#bbf7d0
// for the good state, soft orange #c2410c/#fff7ed/#fed7aa for "needs
// attention" instead of this page's previous harsher red.
function SemanticStatusPill({ label, background, color, border }: { label: string; background: string; color: string; border: string }) {
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:'5px 10px', borderRadius:999,
      background, color, border:`1px solid ${border}`, fontSize:10.5, fontWeight:700, whiteSpace:'nowrap' }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:color, flexShrink:0 }} />
      {label}
    </span>
  );
}

// Fields late-filing/sync also writes (see PROTECTED_FIELDS in
// app/api/late-filing/route.ts) — shown with a small blue dot when the
// current value came from automation, not a staff edit.
const AUTO_SYNCED_FIELDS = new Set(['financial_year_end', 'last_agm_date', 'last_annual_return_date', 'next_agm_due_date', 'remarks']);
function isAutoFilled(row: LateRow, field: string, value: unknown) {
  return AUTO_SYNCED_FIELDS.has(field) && value != null && value !== '' && !row.manual_fields?.[field];
}
function AutoFillDot() {
  return <span title="Auto-filled from TeamWork — clear the field to hand this back to automation, or type a value to override it." style={{ width: 6, height: 6, minWidth: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0, display: 'inline-block' }} />;
}

function RemarksBadge({ remarks }: { remarks: string | null }) {
  if (!remarks) return null;
  const isResolved = /^Resolved:/i.test(remarks);
  const isObjn   = remarks.includes('CLIENT LODGED');
  const isStrike = remarks.includes('STRIKE OFF');
  const col    = isResolved ? '#0f766e' : isObjn ? '#92400e'  : isStrike ? '#991b1b'  : '#475569';
  return (
    <span style={{ display:'inline-block', fontSize:11, fontWeight:700,
      padding:'2px 7px', borderRadius:4, background:'#fff', color:col, border:'1px solid #dbe3ec' }}>
      {remarks}
    </span>
  );
}

type EditState = { uen?: string; company_name?: string; remarks?: string | null;
  last_annual_return_date?: string | null; last_agm_date?: string | null;
  last_accounts_date?: string | null; next_agm_due_date?: string | null;
  // Captured when the edit form opens; sent back so the server can detect
  // someone else having saved this row in the meantime (see PATCH's
  // conflict handling in app/api/late-filing/route.ts). Pulled out
  // server-side before the rest of the body is written, so it never lands
  // in the database itself.
  previousUpdatedAt?: string | null; };

export default function LateFilingPage() {
  const [rows, setRows]         = useState<LateRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [fye, setFye]           = useState('ALL');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [catFilter, setCatFilter] = useState<LateCategory | 'ALL'>('ALL');
  const [editId, setEditId]     = useState<string | 'new' | null>(null);
  const [editForm, setEditForm] = useState<EditState & { financial_year_end?: string; }>({});
  const [saving, setSaving]     = useState(false);
  const [customRemarks, setCustomRemarks] = useState(false);
  const remarksTaRef = useRef<HTMLTextAreaElement>(null);
  // Auto-grow to fit whatever's already in the field (e.g. a long
  // "AUTO: Overdue N days" note) as soon as it's shown, not just after the
  // next keystroke — matches Master List's wide-field textareas.
  useEffect(() => {
    const el = remarksTaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [customRemarks, editForm.remarks]);

  // ── Custom mirrored horizontal scrollbar + sticky leading columns ──────
  // Same pattern as Master List's classic table (components/MasterListTable.tsx)
  // and AR Reminder's Table view — too many columns to fit on screen, so the
  // chevron/Company Name/UEN columns stay pinned while scrolling right, and
  // a draggable scrollbar stays reachable at the bottom of the viewport
  // instead of requiring a scroll down to the table's own native one.
  const outerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const sbRef    = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragRef  = useRef({ startX: 0, startScroll: 0 });
  const metaRef  = useRef({ tw: 0, sbW: 0 });
  const STICKY_WIDTHS = [32, 300, 120]; // chevron, company_name, uen

  const updateSb = useCallback(() => {
    const el = outerRef.current, thumb = thumbRef.current, sb = sbRef.current;
    if (!el || !thumb || !sb) return;
    const rect = el.getBoundingClientRect();
    sb.style.left = `${rect.left}px`;
    sb.style.width = `${rect.width}px`;
    if (el.scrollWidth <= el.clientWidth) { sb.style.display = 'none'; return; }
    sb.style.display = 'block';
    const tw = Math.max(rect.width * (el.clientWidth / el.scrollWidth), 40);
    metaRef.current = { tw, sbW: rect.width };
    const maxScroll = el.scrollWidth - el.clientWidth;
    const tl = maxScroll > 0 ? (el.scrollLeft / maxScroll) * (rect.width - tw) : 0;
    thumb.style.width = `${tw}px`;
    thumb.style.left = `${tl}px`;
  }, []);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateSb, { passive: true });
    window.addEventListener('resize', updateSb, { passive: true });
    const ro = new ResizeObserver(updateSb);
    ro.observe(el);
    updateSb();
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !el) return;
      const { tw, sbW } = metaRef.current;
      const dx = e.clientX - dragRef.current.startX;
      const scrollable = el.scrollWidth - el.clientWidth;
      const thumbRange = sbW - tw;
      if (thumbRange <= 0) return;
      el.scrollLeft = Math.max(0, Math.min(dragRef.current.startScroll + dx * (scrollable / thumbRange), scrollable));
    };
    const onUp = () => { dragging.current = false; };
    document.addEventListener('mousemove', onMove, { passive: true });
    document.addEventListener('mouseup', onUp);
    return () => {
      el.removeEventListener('scroll', updateSb);
      window.removeEventListener('resize', updateSb);
      ro.disconnect();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [updateSb]);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`/api/late-filing?fye=${fye}`);
    const j = await r.json();
    setRows(j.companies ?? []);
    setLoading(false);
  }, [fye]);

  useEffect(() => { load(); }, [load]);

  function startEdit(row: LateRow) {
    setEditId(row.id);
    setEditForm({
      uen: row.uen, company_name: row.company_name,
      remarks: row.remarks,
      financial_year_end: row.financial_year_end,
      last_annual_return_date: row.last_annual_return_date,
      last_agm_date: row.last_agm_date,
      last_accounts_date: row.last_accounts_date,
      next_agm_due_date: row.next_agm_due_date,
      previousUpdatedAt: row.updated_at,
    });
    setCustomRemarks(!!row.remarks && !REMARKS_OPTIONS.includes(row.remarks));
  }
  function startNew() { setEditId('new'); setEditForm({ financial_year_end: '' }); setCustomRemarks(false); }
  function cancelEdit() { setEditId(null); setEditForm({}); setCustomRemarks(false); }

  async function save() {
    setSaving(true);
    try {
      const res = editId === 'new'
        ? await fetch('/api/late-filing', { method:'POST',
            headers:{'Content-Type':'application/json'}, body: JSON.stringify(editForm) })
        : await fetch('/api/late-filing', { method:'PATCH',
            headers:{'Content-Type':'application/json'}, body: JSON.stringify(editForm) });
      if (res.status === 409) {
        alert('Someone else already updated this record while you were editing it. Reloading the latest version — please redo your changes.');
        cancelEdit(); await load();
        return;
      }
      cancelEdit(); load();
    } finally { setSaving(false); }
  }

  async function resolve(row: LateRow) {
    const previous = row.remarks?.trim() ?? '';
    const remarks = /^Review:/i.test(previous)
      ? previous.replace(/^Review:/i, 'Resolved:')
      : `Resolved: ${previous || 'Reviewed and completed'}`;
    const res = await fetch('/api/late-filing', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uen: row.uen, company_name: row.company_name, remarks }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? 'Unable to mark this record as resolved.');
      return;
    }
    load();
  }

  const [pendingDelete, setPendingDelete] = useState<LateRow | null>(null);
  const handleDelete = useCallback((row: LateRow) => {
    if (!row.uen) { alert('This record has no UEN on file — cannot remove it.'); return; }
    setPendingDelete(row);
  }, []);
  const confirmDelete = useCallback(async () => {
    const row = pendingDelete;
    if (!row) return;
    setPendingDelete(null);
    const res = await fetch('/api/late-filing', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uen: row.uen }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error ?? 'Unable to remove this record.');
      return;
    }
    load();
  }, [pendingDelete, load]);

  function dateField(key: keyof EditState, label: string) {
    return (
      <DateField label={label} value={editForm[key] as string | null | undefined}
        onChange={v => setEditForm(f => ({ ...f, [key]: v }))} />
    );
  }

  // Category counts for the breakdown cards
  const cats = { serious: 0, recent: 0, review: 0, resolved: 0 } as Record<LateCategory, number>;
  const catOf = new Map<string, LateCategory>();
  for (const r of rows) { const c = categorize(r); cats[c]++; catOf.set(r.id, c); }

  // Derive filtered rows by year + category
  const allYears = [...new Set(rows.map(r => lateYear(r)).filter(Boolean) as number[])].sort((a,b)=>a-b);
  const displayRows = rows
    .filter(r => yearFilter === 'ALL' || String(lateYear(r)) === yearFilter)
    // Vincent: "只要是resolved了，就只会出现在resolved，不会出现在total late
    // flier了" — a resolved company should only show up when the Resolved
    // card is specifically selected, never mixed into the default/"Total
    // Late Filers" (catFilter === 'ALL') list.
    .filter(r => catFilter === 'ALL' ? catOf.get(r.id) !== 'resolved' : catOf.get(r.id) === catFilter);
  // Paginate AFTER the year/category filters — only rendering is capped.
  const { page, setPage, totalPages, pageItems, startIndex, total } =
    usePagination(displayRows, `${yearFilter}|${catFilter}`);

  useEffect(() => { updateSb(); }, [rows, page, updateSb]);

  return (
    <div style={{ paddingTop:12 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:26 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <AlertTriangle size={22} style={{ color:'#dc2626' }} />
          <h1 style={{ fontSize:20, fontWeight:800, color:'#1e3a5f', margin:0 }}>Late Filing Companies</h1>
          <span style={{ fontSize:12, color:'#64748b', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:6, padding:'2px 8px' }}>
            Auto-detected from AR records
          </span>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={load}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 14px', borderRadius:8, border:'1px solid #e2e8f0', background:'#fff', color:'#475569', fontSize:13, cursor:'pointer', fontWeight:600 }}>
            <RefreshCw size={14} />Refresh
          </button>
          <button onClick={startNew}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 16px', borderRadius:8, border:'none', background:'#1e3a5f', color:'#fff', fontSize:13, cursor:'pointer', fontWeight:600 }}>
            <Plus size={14} />Add Manual
          </button>
        </div>
      </div>

      {/* Stats — total + risk breakdown (click a card to filter) */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,minmax(0,1fr))', gap:12, marginBottom:24 }}>
        {([
          { key: 'ALL',      label: 'Total Late Filers', sub: 'outstanding, excludes resolved', count: rows.length - cats.resolved, color: '#1e3a5f', Icon: Building2 },
          { key: 'serious',  label: 'Seriously Overdue', sub: 'over 1 year late / strike-off',   count: cats.serious,  color: '#dc2626', Icon: AlertTriangle },
          { key: 'recent',   label: 'Recently Overdue',  sub: 'past due within the last year',   count: cats.recent,   color: '#ea580c', Icon: Clock },
          { key: 'review',   label: 'Under Review',      sub: 'possibly resolved — verify',      count: cats.review,   color: '#64748b', Icon: Calendar },
          { key: 'resolved', label: 'Resolved',          sub: 'reviewed and retained',           count: cats.resolved, color: '#0f766e', Icon: Check },
        ] as const).map(c => {
          const active = catFilter === c.key || (c.key === 'ALL' && catFilter === 'ALL');
          return (
            <MetricCard
              key={c.key}
              onClick={() => setCatFilter(c.key as LateCategory | 'ALL')}
              active={active}
              value={c.count}
              label={c.label}
              sub={c.sub}
              icon={<c.Icon size={16} />}
              color={c.color}
              ariaLabel={`Filter late filing records by ${c.label}`}
            />
          );
        })}
      </div>

      {/* Year Filter */}
      <div style={{ display:'flex', gap:7, marginBottom:24, flexWrap:'wrap', alignItems:'center' }}>
        <span style={{ fontSize:12, color:'#94a3b8', fontWeight:600, marginRight:4 }}>Late FY:</span>
        {(['ALL', ...allYears.map(String)]).map(y => (
          <button key={y} onClick={() => setYearFilter(y)}
            style={{ padding:'4px 14px', borderRadius:6, border:'1px solid',
              fontSize:12, fontWeight:600, cursor:'pointer',
              borderColor: yearFilter===y ? '#1e3a5f' : '#e2e8f0',
              background:  yearFilter===y ? '#1e3a5f' : '#fff',
              color:       yearFilter===y ? '#fff'    : '#475569' }}>
            {y}
          </button>
        ))}
      </div>

      {/* Add / Edit — one modal, same navy/grey/white chrome as Master List's */}
      {editId !== null && (
        <div onClick={cancelEdit} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <div style={{ background: '#1d3a5c', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{editId === 'new' ? 'Add Manual Entry' : 'Edit Company'}</div>
              <button onClick={cancelEdit} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ padding: '16px 20px', background: '#f8fafc' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '3px 8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110, flexShrink: 0 }}>Company Name *</span>
                  <input value={editForm.company_name ?? ''} onChange={e => setEditForm(f => ({ ...f, company_name: e.target.value.toUpperCase() }))} placeholder="—"
                    style={{ flex: '1 1 200px', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: '3px 0', fontSize: 13, fontWeight: 500, color: '#1e293b', boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '3px 8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110, flexShrink: 0 }}>UEN / ROC</span>
                  <input value={editForm.uen ?? ''} onChange={e => setEditForm(f => ({ ...f, uen: e.target.value.toUpperCase() }))} placeholder="—"
                    style={{ flex: '1 1 200px', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: '3px 0', fontSize: 13, fontWeight: 500, color: '#1e293b', boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '3px 8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110, flexShrink: 0 }}>FYE Month</span>
                  <select value={editForm.financial_year_end ?? ''} onChange={e => setEditForm(f => ({ ...f, financial_year_end: e.target.value }))}
                    style={{ flex: '1 1 200px', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: '3px 0', fontSize: 13, fontWeight: 500, color: '#1e293b', boxSizing: 'border-box' }}>
                    <option value="">—</option>
                    {FYE_MONTHS.filter(m => m !== 'ALL').map(m => <option key={m}>{m}</option>)}
                  </select>
                </div>
                {dateField('last_annual_return_date', 'Last AR Date')}
                {dateField('last_agm_date', 'Last AGM Date')}
                {dateField('last_accounts_date', 'Last Accounts Date')}
                {dateField('next_agm_due_date', 'Next AGM Due')}
                <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '3px 8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110, flexShrink: 0 }}>Remarks</span>
                  <select value={customRemarks ? 'Other' : (editForm.remarks ?? '')}
                    onChange={e => {
                      if (e.target.value === 'Other') { setCustomRemarks(true); setEditForm(f => ({ ...f, remarks: '' })); }
                      else { setCustomRemarks(false); setEditForm(f => ({ ...f, remarks: e.target.value || null })); }
                    }}
                    style={{ flex: '1 1 200px', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: '3px 0', fontSize: 13, fontWeight: 500, color: '#1e293b', boxSizing: 'border-box' }}>
                    {REMARKS_OPTIONS.map(o => <option key={o} value={o}>{o || '(none)'}</option>)}
                    <option value="Other">Other…</option>
                  </select>
                </div>
                {customRemarks && (
                  <div style={{ padding: '8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>Custom Remarks</div>
                    <textarea ref={remarksTaRef} value={editForm.remarks ?? ''} onChange={e => setEditForm(f => ({ ...f, remarks: e.target.value }))} placeholder="Type your own remarks — "
                      rows={1}
                      onInput={e => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }}
                      style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', fontSize: 13, fontWeight: 500, color: '#1e293b', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'none', overflow: 'hidden', lineHeight: 1.4 }} />
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={save} disabled={saving || !editForm.company_name}
                  style={{ padding: '7px 16px', borderRadius: 9, border: '1px solid rgba(21,94,89,.2)', background: '#397f78', color: '#fff', fontWeight: 750, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 5px 14px rgba(57,127,120,.14)', opacity: saving || !editForm.company_name ? 0.6 : 1 }}>
                  <Check size={14} />{saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={cancelEdit}
                  style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <X size={14} />Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table — the scroll container and <table> are always mounted (not
          gated behind loading/empty state) so the mirrored-scrollbar
          effect below binds to a real, stable DOM node on first render,
          same as components/MasterListTable.tsx. Loading/empty states
          render as a single spanning row inside <tbody> instead. */}
        <div ref={outerRef} className="system-list-shell" style={{ maxHeight:'calc(100vh - 260px)', overflowX:'hidden', overflowY:'auto' }}>
          <table className="system-list-table" style={{ minWidth: 1320 }}>
            <colgroup>
              <col style={{ width: 32 }} />
              <col style={{ width: 300 }} />
              <col style={{ width: 120 }} />
              <col style={{ width: 100 }} />
              <col style={{ width: 95 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 130 }} />
              <col style={{ width: 145 }} />
              <col style={{ width: 170 }} />
              <col style={{ width: 160 }} />
              <col style={{ width: 54 }} />
            </colgroup>
            <thead>
              <tr className="list-column-header-gray">
                {['','Company Name','UEN / ROC','FYE','Late FY','Last AR Date','Last AGM Date','Last Accounts Date','Next AGM Due','Remarks',''].map((h,i)=>{
                  const sl = i === 0 ? 0 : i === 1 ? STICKY_WIDTHS[0] : i === 2 ? STICKY_WIDTHS[0] + STICKY_WIDTHS[1] : undefined;
                  return (
                    <th key={i} style={{ textAlign:'left', whiteSpace:'nowrap',
                      position:'sticky', top:0, left: sl, zIndex: sl !== undefined ? 3 : 2,
                      boxShadow: i === 2 ? '3px 0 8px -2px rgba(0,0,0,0.1)' : undefined,
                    }}>{h}</th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={11} style={{ textAlign:'center', padding:60, color:'#94a3b8' }}>Detecting late filers…</td></tr>
              ) : displayRows.length === 0 ? (
                <tr><td colSpan={11} style={{ textAlign:'center', padding:60, color:'#16a34a', fontWeight:600 }}>No late filing companies found for this year</td></tr>
              ) : pageItems.map((row, idx) => (
                  <tr key={row.id} className="system-list-row" onClick={() => startEdit(row)}
                    style={{ cursor: 'pointer' }}>
                    <td style={{ color: '#94a3b8', position:'sticky', left:0, zIndex:1, background:'#fff' }}>
                      <ChevronRight size={14} />
                    </td>
                    <td className="company-name-text" style={{ position:'sticky', left: STICKY_WIDTHS[0], zIndex:1, background:'#fff' }}>
                      <span style={{ color: '#cbd5e1', marginRight: 6, fontSize: 11 }}>{startIndex + idx + 1}</span>
                      {row.company_name}
                    </td>
                    <td className="company-registration-text" style={{ position:'sticky', left: STICKY_WIDTHS[0] + STICKY_WIDTHS[1], zIndex:1, background:'#fff', boxShadow:'3px 0 8px -2px rgba(0,0,0,0.12)' }}>{row.uen||'—'}</td>
                    <td>
                      {row.financial_year_end
                        ? <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                            {isAutoFilled(row, 'financial_year_end', row.financial_year_end) && <AutoFillDot />}
                            <span style={{ color:'#475569', fontSize:12, fontWeight:600 }}>{row.financial_year_end}</span>
                          </span>
                        : <span style={{ color:'#94a3b8' }}>—</span>}
                    </td>
                    <td>
                      {(() => {
                        const yr = lateYear(row);
                        return yr
                          ? <SemanticStatusPill label={`FY ${yr}`} background="#fff7ed" color="#c2410c" border="#fed7aa" />
                          : '—';
                      })()}
                    </td>
                    <td style={{ color:'#475569' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                        {isAutoFilled(row, 'last_annual_return_date', row.last_annual_return_date) && <AutoFillDot />}
                        {fmtDate(row.last_annual_return_date)}
                      </span>
                    </td>
                    <td style={{ color:'#475569' }}>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                        {isAutoFilled(row, 'last_agm_date', row.last_agm_date) && <AutoFillDot />}
                        {fmtDate(row.last_agm_date)}
                      </span>
                    </td>
                    <td style={{ color:'#475569' }}>{fmtDate(row.last_accounts_date)}</td>
                    <td>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                        {isAutoFilled(row, 'next_agm_due_date', row.next_agm_due_date) && <AutoFillDot />}
                        {row.next_agm_due_date ? (() => {
                          const isPast = new Date(row.next_agm_due_date) < new Date();
                          return <SemanticStatusPill
                            label={`${fmtDateStr(row.next_agm_due_date)}${isPast ? ' · OVERDUE' : ''}`}
                            background={isPast ? '#fff7ed' : '#f0fdf4'}
                            color={isPast ? '#c2410c' : '#15803d'}
                            border={isPast ? '#fed7aa' : '#bbf7d0'}
                          />;
                        })() : <span style={{ color:'#94a3b8' }}>NA</span>}
                      </span>
                    </td>
                    <td>
                      <span style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
                        {isAutoFilled(row, 'remarks', row.remarks) && <AutoFillDot />}
                        <RemarksBadge remarks={row.remarks} />
                      </span>
                    </td>
                    <td style={{ whiteSpace:'nowrap' }} onClick={e => e.stopPropagation()}>
                      {(() => {
                        const isResolved = catOf.get(row.id) === 'resolved';
                        return (
                          <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
                            <button onClick={()=>resolve(row)}
                              className="system-list-action"
                              style={isResolved ? { color: '#15803d', background: '#f0fdf4' } : undefined}
                              title={isResolved ? 'Already marked resolved — click to re-confirm' : 'Mark as resolved and retain this record'}>
                              <Check size={12} />
                            </button>
                            <button onClick={()=>handleDelete(row)}
                              className="system-list-action"
                              style={{ color: '#b91c1c' }}
                              title="Permanently remove this record">
                              <Trash2 size={12} />
                            </button>
                          </span>
                        );
                      })()}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>

      {/* Mirrored scrollbar — stays reachable at the bottom of the viewport */}
      {!loading && displayRows.length > 0 && <div
        ref={sbRef}
        style={{ position: 'fixed', bottom: 0, display: 'none', height: 23, zIndex: 50, cursor: 'pointer' }}
        onClick={e => {
          const el = outerRef.current;
          if (!el) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          el.scrollLeft = ((e.clientX - rect.left) / metaRef.current.sbW) * (el.scrollWidth - el.clientWidth);
        }}
      >
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 8, background: '#e1e7ef' }} />
        <div
          ref={thumbRef}
          style={{ position: 'absolute', top: 0, left: 0, width: 0, height: 15, background: '#94a3b8', borderRadius: 8, userSelect: 'none', cursor: 'grab' }}
          onMouseDown={e => {
            dragging.current = true;
            dragRef.current = { startX: e.clientX, startScroll: outerRef.current?.scrollLeft ?? 0 };
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={e => e.stopPropagation()}
        />
      </div>}

      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />

      {/* Legend */}
      <div style={{ marginTop:16, display:'flex', gap:20, fontSize:12, color:'#64748b', flexWrap:'wrap' }}>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <div style={{ width:14, height:14, borderRadius:3, background:'#fee2e2', border:'1px solid #fca5a5' }} /> ACRA Strike Off
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <div style={{ width:14, height:14, borderRadius:3, background:'#fffbeb', border:'1px solid #fcd34d' }} /> Client Lodged Objection
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:5 }}>
          <span style={{ color:'#dc2626', fontWeight:700, fontSize:11 }}>OVERDUE</span> = Next AGM due date has passed
        </div>
      </div>

      {pendingDelete && (
        <ConfirmDeleteModal
          label={pendingDelete.company_name}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
