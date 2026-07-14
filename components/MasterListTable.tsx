'use client';

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { Plus, Check, X, Trash2, MoreVertical, ArrowRightCircle, AlertTriangle, RotateCcw } from 'lucide-react';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { usePagination, PaginationBar } from './Pagination';
import { toDisplayDate } from '@/lib/date';

export interface MasterListRow {
  id: number;
  update_date: string | null;
  internal_code: string | null;
  company_name: string | null;
  roc_no: string | null;
  status: string | null;
  join_date: string | null;
  sec_agent: string | null;
  kyc_year: string | null;
  register_of_controllers: string | null;
  corporate_tax: string | null;
  efiling_authorization: string | null;
  ac: string | null;
  audit: string | null;
  gst: string | null;
  compil_report: string | null;
  cpf_submit: string | null;
  add_here: string | null;
  invoice_address: string | null;
  mailing_address: string | null;
  contact_window: string | null;
  mailing_list: string | null;
  email: string | null;
  tel: string | null;
  inc_date: string | null;
  shareholders: string | null;
  directors: string | null;
  nominee_director: string | null;
  secretary: string | null;
  annual_return: string | null;
  fye: string | null;
  last_ar_date: string | null;
  last_agm_date: string | null;
  last_accounts_date: string | null;
  next_agm_due_date: string | null;
  months_from_last_accounts: string | null;
  remark: string | null;
  referral: string | null;
  risk_level: string | null;
  incorp_with_us: string | null;
  acra_update: string | null;
  mas: string | null;
  grade: string | null;
  tw_fye?: string | null; // authoritative FYE month from TeamWork (for cross-check)
}

// Normalize any FYE value (month name/abbr, or dd/mm/yyyy date) to a month
// number 1-12 for comparison. Returns null when not recognizable.
const MONTH3: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function fyeMonthNum(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = String(s).trim();
  const dm = t.match(/^\d{1,2}\/(\d{1,2})\//);      // dd/mm/yyyy
  if (dm) { const m = parseInt(dm[1], 10); return m >= 1 && m <= 12 ? m : null; }
  const a = t.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
  return MONTH3[a] ?? null;
}

type ColumnField = Exclude<keyof MasterListRow, 'id' | 'tw_fye'>;

// Full column set — the default for every Master List page. A page can pass
// `fields` to MasterListTable to show only a subset, in a given order
// (e.g. Active Client's reduced view), without affecting any other page.
const COLUMNS: { field: ColumnField; label: string; w: number }[] = [
  { field: 'company_name',               label: 'Company Name',    w: 240 },
  { field: 'roc_no',                     label: 'ROC No.',         w: 110 },
  { field: 'status',                     label: 'Active',          w: 220 },
  { field: 'internal_code',              label: 'Code',            w: 70  },
  { field: 'update_date',                label: 'Update Date',     w: 100 },
  { field: 'join_date',                  label: 'Join Date',       w: 100 },
  { field: 'sec_agent',                  label: 'Sec Agent',       w: 80  },
  { field: 'kyc_year',                   label: 'KYC Year',        w: 90  },
  { field: 'register_of_controllers',    label: 'ROC',             w: 80  },
  { field: 'corporate_tax',              label: 'Corp Tax',        w: 80  },
  { field: 'efiling_authorization',      label: 'E-filing Auth',   w: 100 },
  { field: 'ac',                         label: 'A/C',             w: 70  },
  { field: 'audit',                      label: 'Audit',           w: 70  },
  { field: 'gst',                        label: 'GST',             w: 70  },
  { field: 'compil_report',              label: 'Compil Report',   w: 100 },
  { field: 'cpf_submit',                 label: 'CPF Submit',      w: 90  },
  { field: 'add_here',                   label: 'Add @',           w: 90  },
  { field: 'invoice_address',            label: 'Invoice/Reg Add', w: 220 },
  { field: 'mailing_address',            label: 'Mailing Add',     w: 220 },
  { field: 'contact_window',             label: 'Contact Window',  w: 140 },
  { field: 'mailing_list',               label: 'Mailing List',    w: 140 },
  { field: 'email',                      label: 'Email',           w: 200 },
  { field: 'tel',                        label: 'Tel',             w: 130 },
  { field: 'inc_date',                   label: 'Inc. Date',       w: 100 },
  { field: 'shareholders',               label: 'Shareholders',    w: 200 },
  { field: 'directors',                  label: 'Directors',       w: 200 },
  { field: 'nominee_director',           label: 'Nominee Dir.',    w: 120 },
  { field: 'secretary',                  label: 'Secretary',       w: 130 },
  { field: 'annual_return',              label: 'Annual Return',   w: 110 },
  { field: 'fye',                        label: 'FYE',             w: 180 },
  { field: 'last_ar_date',               label: 'Last AR Date',    w: 110 },
  { field: 'last_agm_date',              label: 'Last AGM Date',   w: 110 },
  { field: 'last_accounts_date',         label: 'Last Accts Date', w: 110 },
  { field: 'next_agm_due_date',          label: 'Next AGM Due',    w: 110 },
  { field: 'months_from_last_accounts',  label: '>13M Accts',      w: 90  },
  { field: 'remark',                     label: 'Remark',          w: 220 },
  { field: 'referral',                   label: 'Referral',        w: 110 },
  { field: 'risk_level',                 label: 'Risk Level',      w: 100 },
  { field: 'incorp_with_us',             label: 'Incorp w/ Us',    w: 100 },
  { field: 'acra_update',                label: 'ACRA Update',     w: 100 },
  { field: 'mas',                        label: 'MAS',             w: 90  },
  { field: 'grade',                      label: 'Grade',           w: 80  },
];

const STICKY_WIDTHS = [240, 110, 110]; // company_name, roc_no, status

function statusColor(v: string | null) {
  const s = (v ?? '').toUpperCase();
  if (s.includes('STRUCK OFF'))  return { bg: '#fee2e2', color: '#b91c1c' };
  if (s.includes('TERMINAT'))    return { bg: '#fef3c7', color: '#b45309' };
  if (s === 'YES')               return { bg: '#dcfce7', color: '#15803d' };
  if (!s)                        return null;
  return { bg: '#f1f5f9', color: '#64748b' };
}

export type MoveTarget = { type: string; label: string; statusValue?: string };

function RowActionMenu({ row, moveTargets, onMove, onDelete }: {
  row: MasterListRow;
  moveTargets?: MoveTarget[];
  onMove: (row: MasterListRow, target: MoveTarget) => void;
  onDelete: (row: MasterListRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (!moveTargets?.length) {
    return (
      <button onClick={() => onDelete(row)} title="Remove"
        style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', cursor: 'pointer', display: 'inline-flex' }}>
        <Trash2 size={11} />
      </button>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(v => !v)} title="Actions"
        style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer', display: 'inline-flex' }}>
        <MoreVertical size={12} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 20,
          background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 170, overflow: 'hidden',
        }}>
          {moveTargets.map(t => (
            <button key={t.type} onClick={() => { setOpen(false); onMove(row, t); }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', border: 'none', background: 'transparent', color: '#1e293b', fontSize: 12, textAlign: 'left', cursor: 'pointer' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f1f5f9'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
              <ArrowRightCircle size={13} style={{ color: '#2563eb', flexShrink: 0 }} />
              Move to {t.label}
            </button>
          ))}
          <div style={{ borderTop: '1px solid #f1f5f9' }} />
          <button onClick={() => { setOpen(false); onDelete(row); }}
            style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 7, padding: '8px 12px', border: 'none', background: 'transparent', color: '#dc2626', fontSize: 12, textAlign: 'left', cursor: 'pointer' }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#fef2f2'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
            <Trash2 size={13} style={{ flexShrink: 0 }} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const EditCell = memo(function EditCell({ id, field, value, onSave }: { id: number; field: string; value: string | null; onSave: (id: number, field: string, val: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const pendingRef = useRef<{ next: string; prev: string }>({ next: '', prev: '' });
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setVal(value ?? ''); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  // Persist just this field of this row. Optimistic: the local value is already
  // updated by the caller before the request; on failure we surface an error
  // and offer retry / revert instead of silently dropping the edit.
  const persist = useCallback(async (next: string, prev: string) => {
    pendingRef.current = { next, prev };
    setStatus('saving');
    try {
      const res = await fetch('/api/master-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: next || null }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('saved');
      setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1400);
    } catch {
      setStatus('error');
    }
  }, [id, field]);

  const commit = useCallback(() => {
    setEditing(false);
    const next = val.trim();
    const prev = (value ?? '').trim();
    if (next === prev) return;
    onSave(id, field, next);      // optimistic local update first
    persist(next, prev);
  }, [val, value, id, field, onSave, persist]);

  const retry  = useCallback(() => persist(pendingRef.current.next, pendingRef.current.prev), [persist]);
  const revert = useCallback(() => { const { prev } = pendingRef.current; onSave(id, field, prev); setVal(prev); setStatus('idle'); }, [id, field, onSave]);

  if (editing) return (
    <input
      ref={inputRef} type="text" value={val}
      onChange={e => setVal(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setVal(value ?? ''); setEditing(false); } }}
      style={{ width: '100%', border: '1.5px solid #2563eb', borderRadius: 4, padding: '2px 5px', fontSize: 11, outline: 'none', background: '#eff6ff' }}
    />
  );

  // On save failure, show an inline error with retry/revert (non-destructive —
  // the optimistic value stays visible until the user chooses).
  if (status === 'error') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 4px' }}>
      <span style={{ fontSize: 11, color: '#b91c1c', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title="Save failed">{val || '—'}</span>
      <button onClick={retry}  title="Retry save"  style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', padding: 0, display: 'flex' }}><RotateCcw size={11} /></button>
      <button onClick={revert} title="Revert change" style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={11} /></button>
    </div>
  );

  const display = (value ?? '').trim();
  const statusDot = status === 'saving'
    ? <span title="Saving…" style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
    : status === 'saved'
      ? <Check size={11} style={{ color: '#16a34a', flexShrink: 0 }} />
      : null;

  if (field === 'status') {
    const colors = statusColor(value);
    return (
      <div onClick={() => setEditing(true)} title="Click to edit" style={{ cursor: 'text', minHeight: 22, display: 'flex', alignItems: 'center', gap: 4 }}>
        {display
          ? <span style={{ background: colors?.bg, color: colors?.color, borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700 }}>{display}</span>
          : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>}
        {statusDot}
      </div>
    );
  }

  // Normalize any cell whose value is a recognizable date to the unified
  // "DD MMM YYYY" format; non-dates (YES/NO, codes, counts) parse to null and
  // are shown as-is. Universal so no date column can be missed.
  const shown = display ? (toDisplayDate(display) ?? display) : display;
  return (
    <div onClick={() => setEditing(true)} title="Click to edit" style={{ cursor: 'text', minHeight: 22, display: 'flex', alignItems: 'center', gap: 4, borderRadius: 3, padding: '1px 3px' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      {shown ? <span style={{ fontSize: 11, color: '#374151' }}>{shown}</span> : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>}
      {statusDot}
    </div>
  );
});

export default function MasterListTable({ listType, title, accentColor = '#1d3a5c', moveTargets, fields }: { listType: string; title: string; accentColor?: string; moveTargets?: MoveTarget[]; fields?: ColumnField[] }) {
  const columns = useMemo(() => {
    if (!fields) return COLUMNS;
    const byField = new Map(COLUMNS.map(c => [c.field, c]));
    return fields.map(f => byField.get(f)).filter((c): c is typeof COLUMNS[number] => !!c);
  }, [fields]);

  const [rows, setRows]       = useState<MasterListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const [catFilter, setCatFilter] = useState<'all' | 'fye_mismatch' | 'has_nd' | 'mas'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: listType, search });
      const res  = await fetch(`/api/master-list?${params}`);
      const json = await res.json();
      setRows(json.data ?? []);
    } finally { setLoading(false); }
  }, [listType, search]);

  useEffect(() => { load(); }, [load]);

  const handleSave = useCallback((id: number, field: string, val: string) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: val || null } : r));
  }, []);

  // ── Add Manual ──────────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [newRow, setNewRow]           = useState<Partial<MasterListRow>>({});

  const startAdd  = () => { setNewRow({}); setShowAddForm(true); };
  const cancelAdd = () => { setShowAddForm(false); setNewRow({}); };

  const saveNew = async () => {
    if (!newRow.company_name?.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/master-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ list_type: listType, ...newRow }),
      });
      cancelAdd();
      load();
    } finally { setSaving(false); }
  };

  const [pendingDelete, setPendingDelete] = useState<MasterListRow | null>(null);

  const deleteRow = (row: MasterListRow) => setPendingDelete(row);

  const confirmDeleteRow = async () => {
    if (!pendingDelete) return;
    const row = pendingDelete;
    setPendingDelete(null);
    await fetch('/api/master-list', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id }),
    });
    setRows(prev => prev.filter(r => r.id !== row.id));
  };

  const moveRow = async (row: MasterListRow, target: MoveTarget) => {
    if (!confirm(`Move "${row.company_name}" to ${target.label}?`)) return;
    await fetch('/api/master-list/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, targetType: target.type, statusValue: target.statusValue }),
    });
    setRows(prev => prev.filter(r => r.id !== row.id));
  };

  // ── Custom mirrored horizontal scrollbar (same pattern as AR Reminder) ──
  const outerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const sbRef    = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const dragRef  = useRef({ startX: 0, startScroll: 0 });
  const metaRef  = useRef({ tw: 0, sbW: 0 });

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

  const stickyLeftOf = (field: string) => {
    if (field === 'company_name') return 0;
    if (field === 'roc_no')       return STICKY_WIDTHS[0];
    if (field === 'status')       return STICKY_WIDTHS[0] + STICKY_WIDTHS[1];
    return undefined;
  };

  // ── Category breakdown (click a card to filter) ──────────────────────────
  const isSet = (v: string | null) => {
    const t = (v ?? '').trim().toUpperCase();
    return t !== '' && !['NO', 'NA', 'N.A.', 'NONE', '-', '—', '0'].includes(t);
  };
  const isFyeMismatch = (r: MasterListRow) =>
    !!r.tw_fye && fyeMonthNum(r.fye) !== null && fyeMonthNum(r.fye) !== fyeMonthNum(r.tw_fye);
  const catMatch = (r: MasterListRow, cat: typeof catFilter) => {
    switch (cat) {
      case 'fye_mismatch': return isFyeMismatch(r);
      case 'has_nd':       return isSet(r.nominee_director);
      case 'mas':          return isSet(r.mas);
      default:             return true;
    }
  };
  const catCount = (cat: typeof catFilter) => rows.filter(r => catMatch(r, cat)).length;
  const visibleRows = rows.filter(r => catMatch(r, catFilter));
  // Paginate AFTER search (server-side) + category filter — search always
  // covers the full list; only rendering is capped at 100 rows per page.
  const { page, setPage, totalPages, pageItems, startIndex, total } =
    usePagination(visibleRows, `${listType}|${search}|${catFilter}`);

  useEffect(() => { updateSb(); }, [rows, page, updateSb]);
  const catCards: { key: typeof catFilter; label: string; sub: string; color: string; bg: string; bd: string }[] = [
    { key: 'all',          label: 'Total Records',  sub: 'in this list',              color: '#1d3a5c', bg: '#f8fafc', bd: '#e2e8f0' },
    { key: 'fye_mismatch', label: 'FYE Mismatch',   sub: 'differs from TeamWork',     color: '#dc2626', bg: '#fef2f2', bd: '#fecaca' },
    { key: 'has_nd',       label: 'Has Nominee Dir', sub: 'nominee director on file',  color: '#7c3aed', bg: '#f5f3ff', bd: '#ddd6fe' },
    { key: 'mas',          label: 'MAS Regulated',  sub: 'MAS grade assigned',        color: '#0369a1', bg: '#f0f9ff', bd: '#bae6fd' },
  ];

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Master List › {title}</div>

      {/* Category cards — click to filter */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {catCards.map(c => {
          const active = catFilter === c.key;
          return (
            <button key={c.key} onClick={() => setCatFilter(c.key)}
              style={{ textAlign: 'left', cursor: 'pointer', background: c.bg, border: `1.5px solid ${active ? c.color : c.bd}`,
                borderRadius: 10, padding: '10px 16px', minWidth: 150, boxShadow: active ? `0 0 0 2px ${c.color}22` : 'none' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: c.color }}>{catCount(c.key)}</div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{c.label}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>{c.sub}</div>
            </button>
          );
        })}
      </div>

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search company name or ROC No..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        <button
          onClick={startAdd}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, border: 'none', background: accentColor, color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
        >
          <Plus size={14} />Add Manual
        </button>
        <span className="text-sm text-slate-400 ml-auto">{visibleRows.length} shown{catFilter !== 'all' ? ` of ${rows.length}` : ''}</span>
      </div>

      {showAddForm && (
        <div style={{ background: '#eff6ff', border: '1.5px solid #bfdbfe', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: '#1e40af', marginBottom: 10 }}>Add Manual Entry</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Company Name *</div>
              <input value={newRow.company_name ?? ''} onChange={e => setNewRow(f => ({ ...f, company_name: e.target.value }))}
                style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>ROC No.</div>
              <input value={newRow.roc_no ?? ''} onChange={e => setNewRow(f => ({ ...f, roc_no: e.target.value }))}
                style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Active / Status</div>
              <input value={newRow.status ?? ''} onChange={e => setNewRow(f => ({ ...f, status: e.target.value }))}
                style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>FYE</div>
              <input value={newRow.fye ?? ''} onChange={e => setNewRow(f => ({ ...f, fye: e.target.value }))}
                style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={saveNew} disabled={saving || !newRow.company_name?.trim()}
              style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: accentColor, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={14} />{saving ? 'Saving…' : 'Save'}
            </button>
            <button onClick={cancelAdd}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <X size={14} />Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div className="px-4 py-3" style={{ backgroundColor: accentColor }}>
          <h2 className="text-white font-semibold text-sm">{title}</h2>
        </div>

        <div ref={outerRef} style={{ overflowX: 'hidden', maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 'max-content', fontSize: 11 }}>
            <thead>
              <tr>
                <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, background: accentColor, color: '#fff', fontSize: 9, fontWeight: 700, padding: '7px 8px', minWidth: 36, width: 36, textAlign: 'center' }}>#</th>
                {columns.map(c => {
                  const sl = stickyLeftOf(c.field);
                  return (
                    <th key={c.field} style={{
                      position: 'sticky', top: 0, left: sl !== undefined ? sl + 36 : undefined,
                      zIndex: sl !== undefined ? 3 : 2,
                      background: accentColor, color: '#fff',
                      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
                      padding: '7px 8px', whiteSpace: 'nowrap', minWidth: c.w, width: c.w,
                      borderRight: '1px solid rgba(255,255,255,0.12)',
                      boxShadow: c.field === 'status' ? '3px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
                    }}>{c.label}</th>
                  );
                })}
                <th style={{ position: 'sticky', top: 0, zIndex: 2, background: accentColor, color: '#fff', fontSize: 9, fontWeight: 700, padding: '7px 8px', minWidth: 50, width: 50, textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={columns.length + 2} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={columns.length + 2} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No data</td></tr>
              ) : pageItems.map((r, i) => (
                <tr key={r.id} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ position: 'sticky', left: 0, zIndex: 1, background: i % 2 === 0 ? '#fff' : '#f8fafc', textAlign: 'center', color: '#94a3b8', fontSize: 10, fontWeight: 600, padding: '3px 6px', borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9' }}>{startIndex + i + 1}</td>
                  {columns.map(c => {
                    const sl = stickyLeftOf(c.field);
                    return (
                      <td key={c.field} style={{
                        padding: '3px 6px', verticalAlign: 'top',
                        borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9',
                        wordBreak: 'break-word', overflowWrap: 'break-word',
                        position: sl !== undefined ? 'sticky' : undefined,
                        left: sl !== undefined ? sl + 36 : undefined,
                        zIndex: sl !== undefined ? 1 : undefined,
                        background: sl !== undefined ? (i % 2 === 0 ? '#fff' : '#f8fafc') : undefined,
                        boxShadow: c.field === 'status' ? '3px 0 8px -2px rgba(0,0,0,0.12)' : undefined,
                      }}>
                        {c.field === 'fye' && r.tw_fye && fyeMonthNum(r.fye) !== null && fyeMonthNum(r.fye) !== fyeMonthNum(r.tw_fye) ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} />
                            <span
                              title={`⚠ FYE mismatch — TeamWork says "${r.tw_fye}", manual entry is "${r.fye}". Please verify which is correct.`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '0 4px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0 }}>
                              <AlertTriangle size={10} />TW:{String(r.tw_fye).slice(0, 3).toUpperCase()}
                            </span>
                          </div>
                        ) : (
                          <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} />
                        )}
                      </td>
                    );
                  })}
                  <td style={{ padding: '3px 6px', textAlign: 'center', borderBottom: '1px solid #f1f5f9' }}>
                    <RowActionMenu row={r} moveTargets={moveTargets} onMove={moveRow} onDelete={deleteRow} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />

      {/* Mirrored scrollbar */}
      <div
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
      </div>

      {pendingDelete && (
        <ConfirmDeleteModal
          label={pendingDelete.company_name ?? 'this record'}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDeleteRow}
        />
      )}
    </div>
  );
}
