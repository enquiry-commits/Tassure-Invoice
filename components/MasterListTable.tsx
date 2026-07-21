'use client';

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { Plus, Check, X, Trash2, MoreVertical, ArrowRightCircle, AlertTriangle, RotateCcw, Filter, ChevronRight } from 'lucide-react';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { usePagination, PaginationBar } from './Pagination';
import { toDisplayDate } from '@/lib/date';
import { useIsMobile } from '@/lib/use-is-mobile';

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
  tw_fye?: string | null;      // authoritative FYE month from TeamWork (for cross-check)
  in_teamwork?: boolean;       // whether this row exists in TeamWork at all
  acc_pic?: string | null;    // acc_pic_override if set, else ar_reminder.acc_pic joined by UEN — Active Client only
  tax_pic?: string | null;    // tax_pic_override if set, else ar_reminder.tax_pic joined by UEN — Active Client only
  acc_pic_override?: string | null;
  tax_pic_override?: string | null;
  // Manually toggleable, independent of whether a name is on file — Active Client only.
  nd_active?: boolean | null;
  secretary_active?: boolean | null;
  acc_active?: boolean | null;
  tax_active?: boolean | null;
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

// acc_pic_override/tax_pic_override/*_active are facets of the acc_pic/
// tax_pic/nominee_director/secretary columns, not columns of their own —
// excluded here so they can never be added to a `fields` list by mistake.
type ColumnField = Exclude<keyof MasterListRow,
  'id' | 'tw_fye' | 'in_teamwork' | 'acc_pic_override' | 'tax_pic_override' | 'nd_active' | 'secretary_active' | 'acc_active' | 'tax_active'>;

// Full column set — the default for every Master List page that passes no
// `fields` prop (Strike Off, Terminated, Change Co Name). A page can pass
// `fields` to show a specific subset/order instead (e.g. Active Client's
// reduced view) without affecting any other page.
//
// IMPORTANT: this array is the default for every page that doesn't pass an
// explicit `fields` list — adding a column here makes it appear EVERYWHERE,
// not just the page you're building it for (this bit us once already: a
// "Services" column meant only for Active Client leaked onto Strike Off/
// Terminated/Change Co Name). Page-specific derived columns belong in
// EXTRA_COLUMNS below instead, and must be opted into via `fields`.
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

// Derived, page-opt-in-only columns — not part of the default COLUMNS set,
// so they only ever appear on a page whose `fields` prop names them
// explicitly (Active Client). Values come from a join done server-side in
// /api/master-list, not from an editable master_list column.
const EXTRA_COLUMNS: { field: ColumnField; label: string; w: number }[] = [
  { field: 'acc_pic', label: 'ACC', w: 120 },
  { field: 'tax_pic', label: 'TAX', w: 120 },
];

const STICKY_WIDTHS = [240, 110, 110]; // company_name, roc_no, status

// A free-text master_list cell counts as "set" (service in use) when it
// holds anything beyond the common ways staff mark something absent.
function isSet(v: string | null | undefined) {
  const t = (v ?? '').trim().toUpperCase();
  return t !== '' && !['NO', 'NA', 'N.A.', 'NONE', '-', '—', '0'].includes(t);
}

// On/off indicator for Active Client's Nominee Dir./Secretary/ACC/TAX
// checkboxes — green+check when active. Freely toggleable (independent of
// whether a name is on file) when `onToggle` is given; purely visual
// otherwise.
function CheckSquare({ checked, onToggle }: { checked: boolean; onToggle?: () => void }) {
  return (
    <span aria-hidden={!onToggle} onClick={onToggle ? e => { e.stopPropagation(); onToggle(); } : undefined}
      title={onToggle ? (checked ? 'Click to turn off' : 'Click to turn on') : undefined}
      style={{
        width: 14, height: 14, minWidth: 14, borderRadius: 4, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: checked ? '#16a34a' : '#e5e7eb',
        border: `1px solid ${checked ? '#15803d' : '#cbd5e1'}`,
        cursor: onToggle ? 'pointer' : undefined,
      }}>
      {checked && <Check size={10} color="#fff" strokeWidth={3} />}
    </span>
  );
}

// Editable checkbox+name cell for ACC/TAX. The name defaults to AR
// Reminder's synced PIC but can be overridden here (saved to
// acc_pic_override/tax_pic_override) — `onSaveName` reloads from the server
// afterwards so the resolved value (override vs. AR Reminder fallback)
// always reflects real DB state rather than a hand-rolled guess.
function PicCell({ name, active, onToggleActive, onSaveName }: {
  name: string | null | undefined; active: boolean; onToggleActive: () => void; onSaveName: (val: string) => void;
}) {
  const [val, setVal] = useState(name ?? '');
  useEffect(() => { setVal(name ?? ''); }, [name]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 22 }}>
      <CheckSquare checked={active} onToggle={onToggleActive} />
      <input value={val} onChange={e => setVal(e.target.value)}
        onBlur={() => { const next = val.trim(); if (next !== (name ?? '').trim()) onSaveName(next); }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onClick={e => e.stopPropagation()}
        placeholder="—" style={{ flex: 1, minWidth: 0, border: '1px solid transparent', borderRadius: 4, padding: '1px 3px', fontSize: 11, outline: 'none', background: 'transparent', color: '#374151' }}
        onFocus={e => (e.currentTarget.style.border = '1px solid #2563eb')}
        onBlurCapture={e => (e.currentTarget.style.border = '1px solid transparent')} />
    </div>
  );
}

// Excel-style column filter: click the funnel to see every distinct value in
// that column (counted across the full loaded list, not just what's
// currently visible after other filters — simpler than cascading Excel
// filters, but still lets staff narrow any column to a handful of values).
// `selected === null` means "no restriction" (every value passes); toggling
// back to all-checked collapses to null again so newly-appearing values
// aren't silently excluded by a stale explicit set.
function ColumnFilterMenu({ field, label, rows, selected, onApply }: {
  field: ColumnField; label: string; rows: MasterListRow[];
  selected: Set<string> | null; onApply: (next: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearchLocal] = useState('');
  const [draft, setDraft] = useState<Set<string> | null>(selected);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setDraft(selected); setSearchLocal(''); } }, [open, selected]);
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const options = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const raw = String((r as unknown as Record<string, string | null>)[field] ?? '').trim();
      const key = raw === '' ? '(Blank)' : raw;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows, field]);

  const filteredOptions = search ? options.filter(([v]) => v.toLowerCase().includes(search.toLowerCase())) : options;
  const isChecked = (v: string) => draft === null || draft.has(v);
  const toggle = (v: string) => setDraft(prev => {
    const base = prev === null ? new Set(options.map(([value]) => value)) : new Set(prev);
    if (base.has(v)) base.delete(v); else base.add(v);
    return base.size === options.length ? null : base;
  });
  const active = selected !== null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={e => { e.stopPropagation(); setOpen(v => !v); }} title={`Filter ${label}`}
        style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', color: active ? '#fde047' : 'rgba(255,255,255,0.6)' }}>
        <Filter size={11} fill={active ? 'currentColor' : 'none'} />
      </button>
      {open && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 30, background: '#fff',
          border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 210, padding: 8,
          textTransform: 'none', fontWeight: 400, letterSpacing: 'normal', color: '#334155',
        }}>
          <input value={search} onChange={e => setSearchLocal(e.target.value)} placeholder="Search values…"
            style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 5, padding: '4px 6px', fontSize: 11, marginBottom: 6, outline: 'none', color: '#1e293b', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
            <button onClick={() => setDraft(null)} style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Select All</button>
            <button onClick={() => setDraft(new Set())} style={{ fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Clear</button>
          </div>
          <div style={{ maxHeight: 200, overflowY: 'auto', borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', padding: '4px 0' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px 2px' }}>No values</div>
            ) : filteredOptions.map(([v, valueCount]) => (
              <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px', fontSize: 11, cursor: 'pointer' }}>
                <input type="checkbox" checked={isChecked(v)} onChange={() => toggle(v)} style={{ width: 12, height: 12, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>{v}</span>
                <span style={{ color: '#94a3b8', fontSize: 9.5, flexShrink: 0 }}>{valueCount}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setOpen(false)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => { onApply(draft); setOpen(false); }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: 'none', background: '#1d3a5c', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

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

const EditCell = memo(function EditCell({ id, field, value, onSave, compactFyeMismatch }: { id: number; field: string; value: string | null; onSave: (id: number, field: string, val: string) => void; compactFyeMismatch?: string | null }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const pendingRef = useRef<{ next: string; prev: string }>({ next: '', prev: '' });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setVal(value ?? ''); }, [value]);
  useEffect(() => {
    if (!editing) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editing]);

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
    <textarea
      ref={inputRef} value={val} rows={1}
      onChange={e => {
        setVal(e.target.value);
        const el = e.target;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
      }}
      onBlur={commit}
      onKeyDown={e => {
        // Enter commits (matches every other single-line cell in this
        // table); Shift+Enter inserts a real line break instead, for
        // fields like Remark/addresses that read better multi-line.
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
        if (e.key === 'Escape') { setVal(value ?? ''); setEditing(false); }
      }}
      style={{ width: '100%', border: '1.5px solid #2563eb', borderRadius: 4, padding: '2px 5px', fontSize: 11, outline: 'none', background: '#eff6ff', fontFamily: 'inherit', resize: 'none', overflow: 'hidden', lineHeight: 1.4, display: 'block' }}
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

  if (field === 'fye' && compactFyeMismatch) {
    const manualMonth = fyeMonthNum(value);
    const teamworkMonth = fyeMonthNum(compactFyeMismatch);
    const monthNames = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    return (
      <div onClick={() => setEditing(true)}
        title={`FYE mismatch — manual: ${value || '—'} · TeamWork: ${compactFyeMismatch}. Click to edit manual FYE.`}
        style={{ width: '100%', minHeight: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
          padding: '4px 2px', borderRadius: 7, background: '#fff7f7', border: '1px solid #fecaca', cursor: 'text', boxShadow: '0 1px 2px rgba(220,38,38,.04)' }}>
        <span style={{ fontSize: 9, lineHeight: 1, fontWeight: 800, color: '#7f1d1d', whiteSpace: 'nowrap' }}>FYE {manualMonth ? monthNames[manualMonth - 1] : '—'}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 8, lineHeight: 1, fontWeight: 750, color: '#dc2626', whiteSpace: 'nowrap' }}>
          <AlertTriangle size={8} />TW {teamworkMonth ? monthNames[teamworkMonth - 1] : String(compactFyeMismatch).slice(0, 3).toUpperCase()}
        </span>
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

// ── Active Client "List" view + detail modal ────────────────────────────────
// Opt-in via `enableListView` (Active Client only, per Vincent's request —
// every other Master List page stays table-only). Fields shown are grouped
// under a fixed set of section headers that make sense for Active Client's
// column set specifically; any field not named below falls back to "Other"
// so this degrades gracefully if ever reused for a page with a different
// field mix, rather than breaking.
const FIELD_SECTIONS: Record<string, string> = {
  internal_code: 'Company Info', join_date: 'Company Info', inc_date: 'Company Info',
  fye: 'Company Info', annual_return: 'Company Info', update_date: 'Company Info',
  add_here: 'Contact & Address', invoice_address: 'Contact & Address', mailing_address: 'Contact & Address',
  contact_window: 'Contact & Address', mailing_list: 'Contact & Address', email: 'Contact & Address', tel: 'Contact & Address',
  nominee_director: 'Services', secretary: 'Services', acc_pic: 'Services', tax_pic: 'Services',
  last_ar_date: 'Compliance', last_agm_date: 'Compliance', last_accounts_date: 'Compliance',
  next_agm_due_date: 'Compliance', months_from_last_accounts: 'Compliance', acra_update: 'Compliance',
  sec_agent: 'Admin', kyc_year: 'Admin', register_of_controllers: 'Admin', corporate_tax: 'Admin',
  efiling_authorization: 'Admin', ac: 'Admin', audit: 'Admin', gst: 'Admin', compil_report: 'Admin',
  cpf_submit: 'Admin', shareholders: 'Admin', directors: 'Admin',
  remark: 'Notes', referral: 'Notes', risk_level: 'Notes', incorp_with_us: 'Notes', mas: 'Notes', grade: 'Notes',
};
const SECTION_ORDER = ['Company Info', 'Contact & Address', 'Services', 'Compliance', 'Admin', 'Notes', 'Other'];

// Always-visible input + on-blur save, for the modal (unlike EditCell's
// click-to-reveal, which exists to keep table cells compact — the modal has
// room to just show every input at once).
const ModalField = memo(function ModalField({ id, field, label, value, onSave }: {
  id: number; field: string; label: string; value: string | null; onSave: (id: number, field: string, val: string) => void;
}) {
  const [val, setVal] = useState(value ?? '');
  const [status, setStatus] = useState<SaveStatus>('idle');
  useEffect(() => { setVal(value ?? ''); }, [value]);

  const commit = useCallback(async () => {
    const next = val.trim();
    const prev = (value ?? '').trim();
    if (next === prev) return;
    onSave(id, field, next);
    setStatus('saving');
    try {
      const res = await fetch('/api/master-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: next || null }) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('saved');
      setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1400);
    } catch { setStatus('error'); }
  }, [val, value, id, field, onSave]);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const resize = useCallback(() => {
    const el = taRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
  }, []);
  useEffect(() => { resize(); }, [val, resize]);

  return (
    <div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {status === 'saving' && <span title="Saving…" style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b' }} />}
        {status === 'saved' && <Check size={10} style={{ color: '#16a34a' }} />}
        {status === 'error' && <span style={{ color: '#dc2626', fontSize: 9 }}>save failed</span>}
      </div>
      {/* Textarea, not input — long values (addresses, remarks) were getting
          clipped behind a single-line box with no way to see the full text. */}
      <textarea ref={taRef} value={val} rows={1} onChange={e => setVal(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
        style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box', color: '#1e293b', fontFamily: 'inherit', resize: 'none', overflow: 'hidden', lineHeight: 1.4 }} />
    </div>
  );
});

function CompanyDetailModal({ row, fieldColumns, onClose, onSave, onToggleActive, onSaveOverride }: {
  row: MasterListRow;
  fieldColumns: { field: ColumnField; label: string }[];
  onClose: () => void;
  onSave: (id: number, field: string, val: string) => void;
  onToggleActive: (id: number, field: 'nd_active' | 'secretary_active' | 'acc_active' | 'tax_active', current: boolean | null | undefined) => void;
  onSaveOverride: (id: number, field: 'acc_pic_override' | 'tax_pic_override', val: string) => void;
}) {
  const sections = useMemo(() => {
    const groups = new Map<string, { field: ColumnField; label: string }[]>();
    for (const c of fieldColumns) {
      const section = FIELD_SECTIONS[c.field] ?? 'Other';
      if (!groups.has(section)) groups.set(section, []);
      groups.get(section)!.push(c);
    }
    return SECTION_ORDER.filter(s => groups.has(s)).map(s => ({ name: s, fields: groups.get(s)! }));
  }, [fieldColumns]);

  const colors = statusColor(row.status);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '16px 20px', flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{row.company_name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              {row.roc_no && <span style={{ fontSize: 11, color: '#fff', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4 }}>{row.roc_no}</span>}
              {row.status && <span style={{ fontSize: 10, fontWeight: 700, background: colors?.bg ?? 'rgba(255,255,255,0.12)', color: colors?.color ?? '#fff', borderRadius: 4, padding: '2px 8px' }}>{row.status}</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', background: '#f8fafc' }}>
          {sections.map(section => (
            <div key={section.name} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>{section.name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
                {section.fields.map(c => {
                  if (c.field === 'acc_pic') return (
                    <div key={c.field}><div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>ACC</div>
                      <PicCell name={row.acc_pic} active={!!row.acc_active} onToggleActive={() => onToggleActive(row.id, 'acc_active', row.acc_active)} onSaveName={val => onSaveOverride(row.id, 'acc_pic_override', val)} />
                    </div>
                  );
                  if (c.field === 'tax_pic') return (
                    <div key={c.field}><div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>TAX</div>
                      <PicCell name={row.tax_pic} active={!!row.tax_active} onToggleActive={() => onToggleActive(row.id, 'tax_active', row.tax_active)} onSaveName={val => onSaveOverride(row.id, 'tax_pic_override', val)} />
                    </div>
                  );
                  if (c.field === 'nominee_director' || c.field === 'secretary') {
                    const value = c.field === 'nominee_director' ? row.nominee_director : row.secretary;
                    const activeField = c.field === 'nominee_director' ? 'nd_active' : 'secretary_active';
                    const active = c.field === 'nominee_director' ? row.nd_active : row.secretary_active;
                    return (
                      <div key={c.field}>
                        <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 5 }}>
                          <CheckSquare checked={!!active} onToggle={() => onToggleActive(row.id, activeField, active)} />{c.label}
                        </div>
                        <input defaultValue={value ?? ''} onBlur={e => {
                          const next = e.target.value.trim();
                          if (next === (value ?? '').trim()) return;
                          onSave(row.id, c.field, next);
                          fetch('/api/master-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, field: c.field, value: next || null }) });
                        }} style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12, outline: 'none', boxSizing: 'border-box', color: '#1e293b' }} />
                      </div>
                    );
                  }
                  return <ModalField key={c.field} id={row.id} field={c.field} label={c.label} value={(row as unknown as Record<string, string | null>)[c.field]} onSave={onSave} />;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function MasterListTable({ listType, title, accentColor = '#1d3a5c', moveTargets, fields, columnWidths, enableListView = false }: { listType: string; title: string; accentColor?: string; moveTargets?: MoveTarget[]; fields?: ColumnField[]; columnWidths?: Partial<Record<ColumnField, number>>; enableListView?: boolean }) {
  const columns = useMemo(() => {
    // `fields` can name an EXTRA_COLUMNS entry (e.g. Active Client's acc_pic/
    // tax_pic); the no-`fields` default deliberately only ever falls back to
    // COLUMNS, never EXTRA_COLUMNS, so a derived column can't leak onto a
    // page that didn't ask for it.
    const byField = new Map([...COLUMNS, ...EXTRA_COLUMNS].map(c => [c.field, c]));
    const selected = fields
      ? fields.map(f => byField.get(f)).filter((c): c is typeof COLUMNS[number] => !!c)
      : COLUMNS;
    if (!columnWidths) return selected;
    return selected.map(c => columnWidths[c.field] === undefined ? c : { ...c, w: columnWidths[c.field] });
  }, [fields, columnWidths]);

  const [rows, setRows]       = useState<MasterListRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState('');
  const [catFilter, setCatFilter] = useState<'all' | 'fye_mismatch' | 'has_nd' | 'mas' | 'non_teamwork'>('all');
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColumnField, Set<string>>>>({});
  const [view, setView] = useState<'list' | 'table'>('list');
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);
  const isMobile = useIsMobile();

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

  // Nominee Dir./Secretary/ACC/TAX checkboxes — freely toggleable, independent
  // of whether a name is on file. Optimistic; a checkbox flip is low-risk
  // enough not to need retry/error UI.
  const toggleActive = useCallback((id: number, field: 'nd_active' | 'secretary_active' | 'acc_active' | 'tax_active', current: boolean | null | undefined) => {
    const next = !current;
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: next } : r));
    fetch('/api/master-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: next }) });
  }, []);

  // ACC/TAX name edits write to the *_override column, which only takes
  // effect ahead of AR Reminder's synced value once set server-side — reload
  // afterwards instead of hand-rolling the override-vs-AR-Reminder
  // resolution locally, so the displayed value always matches real DB state.
  const saveOverride = useCallback((id: number, field: 'acc_pic_override' | 'tax_pic_override', val: string) => {
    fetch('/api/master-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: val || null }) })
      .then(() => load());
  }, [load]);

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

  // Re-runs on `view` too — Active Client's List/Table toggle means the
  // table (and outerRef's real DOM node) doesn't exist at mount time when
  // List is the default view, so a mount-only effect would forever bind to
  // a null ref and the drag-to-scroll bar would never work after switching
  // to Table. Every other Master List page always renders the table, so
  // `view` never changes there and this re-run is a no-op for them.
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
  }, [updateSb, view]);

  const stickyLeftOf = (field: string) => {
    if (field === 'company_name') return 0;
    if (field === 'roc_no')       return STICKY_WIDTHS[0];
    if (field === 'status')       return STICKY_WIDTHS[0] + STICKY_WIDTHS[1];
    return undefined;
  };

  // ── Category breakdown (click a card to filter) ──────────────────────────
  const isFyeMismatch = (r: MasterListRow) =>
    !!r.tw_fye && fyeMonthNum(r.fye) !== null && fyeMonthNum(r.fye) !== fyeMonthNum(r.tw_fye);
  const catMatch = (r: MasterListRow, cat: typeof catFilter) => {
    switch (cat) {
      case 'fye_mismatch': return isFyeMismatch(r);
      case 'has_nd':       return isSet(r.nominee_director);
      case 'mas':          return isSet(r.mas);
      case 'non_teamwork': return r.in_teamwork === false;
      default:             return true;
    }
  };
  const catCount = (cat: typeof catFilter) => rows.filter(r => catMatch(r, cat)).length;
  const columnMatch = (r: MasterListRow) => {
    for (const [field, allowed] of Object.entries(columnFilters) as [ColumnField, Set<string>][]) {
      const raw = String((r as unknown as Record<string, string | null>)[field] ?? '').trim();
      if (!allowed.has(raw === '' ? '(Blank)' : raw)) return false;
    }
    return true;
  };
  const applyColumnFilter = (field: ColumnField, next: Set<string> | null) => setColumnFilters(prev => {
    if (next === null) { const { [field]: _drop, ...rest } = prev; return rest; }
    return { ...prev, [field]: next };
  });
  const activeColumnFilterCount = Object.keys(columnFilters).length;
  const columnFilterKey = Object.entries(columnFilters).map(([f, s]) => `${f}=${[...s].sort().join(',')}`).sort().join('&');
  const visibleRows = rows.filter(r => catMatch(r, catFilter) && columnMatch(r));
  const modalRow = selectedRowId !== null ? rows.find(r => r.id === selectedRowId) ?? null : null;
  // Paginate AFTER search (server-side) + category filter + column filters —
  // search always covers the full list; only rendering is capped per page.
  const { page, setPage, totalPages, pageItems, startIndex, total } =
    usePagination(visibleRows, `${listType}|${search}|${catFilter}|${columnFilterKey}`);

  useEffect(() => { updateSb(); }, [rows, page, updateSb]);
  const catCards: { key: typeof catFilter; label: string; sub: string; color: string; bg: string; bd: string }[] = [
    { key: 'all',          label: 'Total Records',  sub: 'in this list',              color: '#1d3a5c', bg: '#f8fafc', bd: '#e2e8f0' },
    { key: 'fye_mismatch', label: 'FYE Mismatch',   sub: 'differs from TeamWork',     color: '#dc2626', bg: '#fef2f2', bd: '#fecaca' },
    { key: 'has_nd',       label: 'Has Nominee Dir', sub: 'nominee director on file',  color: '#7c3aed', bg: '#f5f3ff', bd: '#ddd6fe' },
    { key: 'mas',          label: 'MAS Regulated',  sub: 'MAS grade assigned',        color: '#0369a1', bg: '#f0f9ff', bd: '#bae6fd' },
    { key: 'non_teamwork', label: 'Non-TeamWork',   sub: 'not found in TeamWork',     color: '#b45309', bg: '#fffbeb', bd: '#fde68a' },
  ];

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Master List › {title}</div>

      {/* Category cards — click to filter */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16, width: '100%' }}>
        {catCards.map(c => {
          const active = catFilter === c.key;
          return (
            <button key={c.key} onClick={() => setCatFilter(c.key)}
              style={{ textAlign: 'left', cursor: 'pointer', background: c.bg, border: `1.5px solid ${active ? c.color : c.bd}`,
                borderRadius: 10, padding: '12px 16px', width: '100%', minWidth: 0, boxShadow: active ? `0 0 0 2px ${c.color}22` : 'none' }}>
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
        {activeColumnFilterCount > 0 && (
          <button onClick={() => setColumnFilters({})}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 7, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', cursor: 'pointer', whiteSpace: 'nowrap' }}>
            <Filter size={11} />{activeColumnFilterCount} column filter{activeColumnFilterCount === 1 ? '' : 's'} · Clear
          </button>
        )}
        <span className="text-sm text-slate-400 ml-auto">{visibleRows.length} shown{(catFilter !== 'all' || activeColumnFilterCount > 0) ? ` of ${rows.length}` : ''}</span>
        {enableListView && !isMobile && (
          <div style={{ display: 'flex', gap: 3, background: '#f1f5f9', borderRadius: 7, padding: 3 }}>
            {([{ k: 'list', icon: '☰', label: 'List' }, { k: 'table', icon: '⊞', label: 'Table' }] as const).map(({ k, icon, label }) => (
              <button key={k} onClick={() => setView(k)} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, background: view === k ? accentColor : 'transparent', color: view === k ? '#fff' : '#64748b', transition: 'all 0.15s' }}>
                <span>{icon}</span>{label}
              </button>
            ))}
          </div>
        )}
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

      {enableListView && view === 'list' ? (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div className="px-4 py-3" style={{ backgroundColor: accentColor, display: 'flex', alignItems: 'center', gap: 8 }}>
            <h2 className="text-white font-semibold text-sm">{title}</h2>
            <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>Click a company to open full details & edit</span>
          </div>
          {!isMobile && (
            <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(220px,1.6fr) 110px 90px minmax(200px,1.2fr) 100px', padding: '7px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
              {['', 'Company Name', 'ROC No.', 'Status', 'Services', 'FYE'].map((h, i) => (
                <div key={i} style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{h}</div>
              ))}
            </div>
          )}
          <div style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>
            ) : visibleRows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No data</div>
            ) : pageItems.map((r, i) => {
              const rowColors = statusColor(r.status);
              return (
                <div key={r.id} onClick={() => setSelectedRowId(r.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr auto' : '28px minmax(220px,1.6fr) 110px 90px minmax(200px,1.2fr) 100px',
                    alignItems: 'center', gap: 8, padding: '10px 16px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer',
                    background: i % 2 === 0 ? '#fff' : '#fafbfc',
                  }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = i % 2 === 0 ? '#fff' : '#fafbfc'}>
                  {!isMobile && <span style={{ fontSize: 10, color: '#cbd5e1' }}>{startIndex + i + 1}</span>}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1e3a5f', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company_name}</div>
                    {r.roc_no && <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{r.roc_no}</div>}
                  </div>
                  {!isMobile && <div style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{r.roc_no ?? '—'}</div>}
                  {!isMobile && (
                    <div>
                      {r.status
                        ? <span style={{ fontSize: 10, fontWeight: 700, background: rowColors?.bg ?? '#f1f5f9', color: rowColors?.color ?? '#64748b', borderRadius: 4, padding: '2px 6px' }}>{r.status}</span>
                        : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>}
                    </div>
                  )}
                  {!isMobile && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span title="Nominee Director" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9.5, color: '#64748b' }}><CheckSquare checked={!!r.nd_active} />ND</span>
                      <span title="Secretary" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9.5, color: '#64748b' }}><CheckSquare checked={!!r.secretary_active} />SEC</span>
                      <span title="ACC PIC" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9.5, color: '#64748b' }}><CheckSquare checked={!!r.acc_active} />ACC</span>
                      <span title="TAX PIC" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9.5, color: '#64748b' }}><CheckSquare checked={!!r.tax_active} />TAX</span>
                    </div>
                  )}
                  {!isMobile && <div style={{ fontSize: 11, color: '#64748b' }}>{r.fye ?? '—'}</div>}
                  {isMobile && <ChevronRight size={14} style={{ color: '#94a3b8' }} />}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div className="px-4 py-3" style={{ backgroundColor: accentColor }}>
          <h2 className="text-white font-semibold text-sm">{title}</h2>
        </div>

        {/* Phone: native swipe-scroll (the mirrored scrollbar is desktop-only) */}
        <div ref={outerRef} style={{ overflowX: isMobile ? 'auto' : 'hidden', maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
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
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'space-between' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                        <ColumnFilterMenu field={c.field} label={c.label} rows={rows} selected={columnFilters[c.field] ?? null} onApply={next => applyColumnFilter(c.field, next)} />
                      </div>
                    </th>
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
                        {c.field === 'acc_pic' ? (
                          <PicCell name={r.acc_pic} active={!!r.acc_active} onToggleActive={() => toggleActive(r.id, 'acc_active', r.acc_active)} onSaveName={val => saveOverride(r.id, 'acc_pic_override', val)} />
                        ) : c.field === 'tax_pic' ? (
                          <PicCell name={r.tax_pic} active={!!r.tax_active} onToggleActive={() => toggleActive(r.id, 'tax_active', r.tax_active)} onSaveName={val => saveOverride(r.id, 'tax_pic_override', val)} />
                        ) : listType === 'active_client' && c.field === 'nominee_director' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <CheckSquare checked={!!r.nd_active} onToggle={() => toggleActive(r.id, 'nd_active', r.nd_active)} />
                            <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} />
                          </div>
                        ) : listType === 'active_client' && c.field === 'secretary' ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <CheckSquare checked={!!r.secretary_active} onToggle={() => toggleActive(r.id, 'secretary_active', r.secretary_active)} />
                            <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} />
                          </div>
                        ) : c.field === 'fye' && r.tw_fye && fyeMonthNum(r.fye) !== null && fyeMonthNum(r.fye) !== fyeMonthNum(r.tw_fye) ? (
                          (c.w ?? 180) <= 80
                            ? <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} compactFyeMismatch={r.tw_fye} />
                            : <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
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
      )}

      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />

      {/* Mirrored scrollbar — table view only, list view has no wide table to scroll */}
      {(!enableListView || view === 'table') && !isMobile && <div
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

      {pendingDelete && (
        <ConfirmDeleteModal
          label={pendingDelete.company_name ?? 'this record'}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDeleteRow}
        />
      )}

      {modalRow && (
        <CompanyDetailModal
          row={modalRow}
          fieldColumns={columns.filter(c => c.field !== 'company_name' && c.field !== 'roc_no' && c.field !== 'status')}
          onClose={() => setSelectedRowId(null)}
          onSave={handleSave}
          onToggleActive={toggleActive}
          onSaveOverride={saveOverride}
        />
      )}
    </div>
  );
}
