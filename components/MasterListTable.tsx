'use client';

import { useState, useEffect, useCallback, useRef, useMemo, memo, Fragment } from 'react';
import { Plus, Check, X, Trash2, MoreVertical, ArrowRightCircle, AlertTriangle, RotateCcw, Filter, ChevronLeft, ChevronRight, Calendar, Building2, Users, UserCheck, CloudOff, History, RefreshCw } from 'lucide-react';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import MetricCard from './MetricCard';
import { usePagination, PaginationBar } from './Pagination';
import { toDisplayDate, fmtDate } from '@/lib/date';
import { useIsMobile } from '@/lib/use-is-mobile';
import { normalize } from '@/lib/company-name';
import { formatStaffName } from '@/lib/staff-directory';
import { titleCase } from '@/lib/text-case';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

type AuditEntry = { id: number; field: string; old_value: string | null; new_value: string | null; changed_by: string; changed_at: string };

export interface MasterListRow {
  id: number;
  update_date: string | null;
  internal_code: string | null;
  company_name: string | null;
  new_company_name: string | null; // list_type=name_change only — see lib/company-rename.ts
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
  is_css_client?: boolean | null; // TeamWork client_type === 'CSS Client' (null when not matched to a TeamWork company at all)
  // Set when this row's UEN matches a Change Co Name (name_change) record —
  // a "formerly known as" hint, computed server-side, never on name_change
  // rows themselves (see lib/company-rename.ts).
  renamed_from?: string | null;
  renamed_to?: string | null;
  acc_pic?: string | null;    // acc_pic_override if set, else ar_reminder.acc_pic joined by UEN — Active Client only
  tax_pic?: string | null;    // tax_pic_override if set, else ar_reminder.tax_pic joined by UEN — Active Client only
  acc_pic_override?: string | null;
  tax_pic_override?: string | null;
  // AR Reminder's own date_of_agm/filling_date (latest FYE cycle, joined by
  // UEN) — cross-check only, for the mismatch badge on last_agm_date/
  // last_ar_date below. Active Client only.
  ar_date_of_agm?: string | null;
  ar_filling_date?: string | null;
  // Manually toggleable, independent of whether a name is on file — Active Client only.
  nd_active?: boolean | null;
  secretary_active?: boolean | null;
  acc_active?: boolean | null;
  tax_active?: boolean | null;
  // Row-level "last touched" trace (Vincent: wants a persistent record of
  // who changed this row and when, not a checkmark that just vanishes —
  // see scripts/add-master-list-updated-by.sql). Set by the server on
  // every PATCH; kept fresh locally after this client's own edits via
  // markTouched, without waiting for a reload.
  updated_at?: string | null;
  updated_by_name?: string | null;
  // Which auto-synced fields a human has overridden (see
  // scripts/add-master-list-manual-fields.sql) — last_agm_date, last_ar_date,
  // last_accounts_date, next_agm_due_date, invoice_address, secretary,
  // nd_active. A flagged field is skipped by tonight's TeamWork sync.
  manual_fields?: Record<string, boolean> | null;
}

// Normalize any FYE value (month name/abbr, or dd/mm/yyyy date) to a month
// number 1-12 for comparison. Returns null when not recognizable.
const MONTH3: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
const MONTH3_ABBR = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
function fyeMonthNum(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = String(s).trim();
  const dm = t.match(/^\d{1,2}\/(\d{1,2})\//);      // dd/mm/yyyy
  if (dm) { const m = parseInt(dm[1], 10); return m >= 1 && m <= 12 ? m : null; }
  const a = t.toLowerCase().replace(/[^a-z]/g, '').slice(0, 3);
  return MONTH3[a] ?? null;
}

// Last AGM/AR Date (auto, from TeamWork via ar_workflow) vs AR Reminder's
// own date_of_agm/filling_date (staff-editable) — both are plain ISO date
// strings when present, so a straight compare on the date portion is enough.
function dateMismatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return String(a).slice(0, 10) !== String(b).slice(0, 10);
}

// acc_pic_override/tax_pic_override/*_active are facets of the acc_pic/
// tax_pic/nominee_director/secretary columns, not columns of their own —
// excluded here so they can never be added to a `fields` list by mistake.
type ColumnField = Exclude<keyof MasterListRow,
  'id' | 'tw_fye' | 'in_teamwork' | 'is_css_client' | 'acc_pic_override' | 'tax_pic_override' | 'nd_active' | 'secretary_active' | 'acc_active' | 'tax_active' | 'renamed_from' | 'renamed_to' | 'ar_date_of_agm' | 'ar_filling_date' | 'updated_at' | 'updated_by_name' | 'manual_fields'>;

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
  { field: 'roc_no',                     label: 'UEN / ROC',       w: 110 },
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
  { field: 'new_company_name', label: 'New Name', w: 220 },
];

const STICKY_WIDTHS = [240, 110, 110]; // company_name, roc_no, status

// Fields whose values are actual dates (confirmed by sampling real data —
// e.g. kyc_year despite its name holds a full date, while acra_update/
// annual_return etc. hold YES/NO). These get a calendar-picker button in
// both the table's inline editor and the modal, like AR Reminder's date
// fields.
const DATE_FIELDS = new Set<ColumnField>(['update_date', 'join_date', 'inc_date', 'last_ar_date', 'last_agm_date', 'last_accounts_date', 'next_agm_due_date', 'kyc_year']);

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
        background: checked ? '#60a5fa' : '#e5e7eb',
        border: `1px solid ${checked ? '#3b82f6' : '#cbd5e1'}`,
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
  // Displays the canonical full name (see formatStaffName) rather than
  // whatever abbreviation is actually stored — the blur comparison baseline
  // is the SAME formatted value, so simply clicking in and out never
  // silently rewrites a raw "JF" to "Lee Jing Fei"; only a real edit saves.
  const [val, setVal] = useState(formatStaffName(name));
  useEffect(() => { setVal(formatStaffName(name)); }, [name]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minHeight: 22 }}>
      <CheckSquare checked={active} onToggle={onToggleActive} />
      <input value={val} onChange={e => setVal(e.target.value)}
        onBlur={() => { const next = val.trim(); if (next !== formatStaffName(name).trim()) onSaveName(next); }}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        onClick={e => e.stopPropagation()}
        placeholder="—" style={{ flex: 1, minWidth: 0, border: '1px solid transparent', borderRadius: 4, padding: '1px 3px', fontSize: 11, outline: 'none', background: 'transparent', color: '#374151' }}
        onFocus={e => (e.currentTarget.style.border = '1px solid #2563eb')}
        onBlurCapture={e => (e.currentTarget.style.border = '1px solid transparent')} />
    </div>
  );
}

// Service on/off card for the Active Client modal (ND/Secretary/ACC/TAX) —
// a colored check tile + stacked uppercase label/name, matching the same
// on-green/off-muted language AR Reminder's OverrideChip uses, instead of a
// plain checkbox next to a bare input.
// Same blue used everywhere else in this table for "active" (CheckSquare's
// checked state, the status pills, …) — not a distinct color per service.
const SERVICE_CHIP_ACTIVE = { bg: '#eff6ff', color: '#60a5fa' };

function ServiceChip({ name, active, onToggleActive, onSaveName }: {
  name: string | null | undefined; active: boolean; onToggleActive?: () => void; onSaveName: (val: string) => void;
}) {
  // Same canonical-baseline approach as PicCell above.
  const [val, setVal] = useState(formatStaffName(name));
  useEffect(() => { setVal(formatStaffName(name)); }, [name]);
  const chipColor = active ? SERVICE_CHIP_ACTIVE.color : '#94a3b8';
  const chipBg = active ? SERVICE_CHIP_ACTIVE.bg : '#f8fafc';
  const chipBorder = active ? '#bfdbfe' : '#e2e8f0';
  return (
    <div onClick={e => e.stopPropagation()} style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 10, boxSizing: 'border-box', width: '100%',
      background: chipBg, border: `1px solid ${chipBorder}`,
    }}>
      <span onClick={onToggleActive}
        title={onToggleActive ? (active ? 'Click to turn off' : 'Click to turn on') : 'Shows whether this cell has a name on file — kept in sync automatically'}
        style={{
        width: 20, height: 20, borderRadius: 6, flexShrink: 0, cursor: onToggleActive ? 'pointer' : undefined, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: active ? chipColor : '#e5e9f0', color: '#fff',
      }}>
        {active && <Check size={12} strokeWidth={3} />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <input value={val} onChange={e => setVal(e.target.value)}
          onBlur={() => { const next = val.trim(); if (next !== formatStaffName(name).trim()) onSaveName(next); }}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder="Not assigned"
          style={{ width: '100%', border: 'none', outline: 'none', background: 'transparent', padding: 0, fontSize: 13, fontWeight: 650, color: val ? '#1e293b' : '#94a3b8', boxSizing: 'border-box' }} />
      </div>
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
      const raw = (r as unknown as Record<string, string | null>)[field];
      const key = displayFieldValue(field, raw) || '(Blank)';
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
        style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', color: active ? '#b45309' : 'rgba(30,41,59,0.4)' }}>
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

function RowActionMenu({ row, moveTargets, onMove, onDelete, dark = false }: {
  row: MasterListRow;
  moveTargets?: MoveTarget[];
  onMove: (row: MasterListRow, target: MoveTarget) => void;
  onDelete: (row: MasterListRow) => void;
  dark?: boolean;
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
        style={dark
          ? { padding: '3px 6px', borderRadius: 5, border: 'none', background: 'transparent', color: '#fecaca', cursor: 'pointer', display: 'inline-flex' }
          : { padding: '3px 6px', borderRadius: 5, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', cursor: 'pointer', display: 'inline-flex' }}>
        <Trash2 size={11} />
      </button>
    );
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <button onClick={() => setOpen(v => !v)} title="Actions"
        style={dark
          ? { padding: '3px 6px', borderRadius: 5, border: 'none', background: 'transparent', color: '#fff', cursor: 'pointer', display: 'inline-flex' }
          : { padding: '3px 6px', borderRadius: 5, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer', display: 'inline-flex' }}>
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


type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'conflict';

// Fields a nightly TeamWork sync also writes (see AUTO_SYNCED_FIELDS in
// app/api/master-list/route.ts — kept in sync with that set by hand, since
// this is a client component and can't import a server route's constant).
const AUTO_SYNCED_FIELDS_UI = new Set(['last_agm_date', 'last_ar_date', 'last_accounts_date', 'next_agm_due_date', 'invoice_address', 'secretary', 'nominee_director', 'internal_code', 'email', 'fye']);

function AutoFillDot() {
  return <span title="Auto-filled from TeamWork — clear the cell to hand this back to automation, or type a value to override it." style={{ width: 6, height: 6, minWidth: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />;
}

const EditCell = memo(function EditCell({ id, field, value, onSave, compactFyeMismatch, isManual }: { id: number; field: string; value: string | null; onSave: (id: number, field: string, val: string) => void; compactFyeMismatch?: string | null; isManual?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  const [status, setStatus] = useState<SaveStatus>('idle');
  const pendingRef = useRef<{ next: string; prev: string }>({ next: '', prev: '' });
  const conflictRef = useRef<{ currentValue: string; changedBy: string | null }>({ currentValue: '', changedBy: null });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dateRef  = useRef<HTMLInputElement>(null);
  const isDateField = DATE_FIELDS.has(field as ColumnField);
  const handleDatePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    setVal(fmtDate(e.target.value));
    e.target.value = '';
    setTimeout(() => inputRef.current?.focus(), 0);
  };
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
      // previousValue both lets the PATCH handler skip its own SELECT-
      // before-UPDATE round trip AND doubles as an optimistic-concurrency
      // check (mirrors ar_reminder's PATCH) — if someone else already
      // changed this exact field since this cell last saw it, the server
      // returns 409 instead of silently letting one edit clobber the other.
      const res = await fetch('/api/master-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: next || null, previousValue: prev || null }) });
      if (res.status === 409) {
        const json = await res.json().catch(() => ({}));
        const current = String(json.currentValue ?? '');
        conflictRef.current = { currentValue: current, changedBy: json.changedBy ?? null };
        onSave(id, field, current);
        setVal(current);
        setStatus('conflict');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('saved');
      setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1400);
    } catch {
      setStatus('error');
    }
  }, [id, field, onSave]);

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
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
      <textarea
        ref={inputRef} value={val} rows={1}
        onChange={e => {
          setVal(e.target.value);
          const el = e.target;
          el.style.height = 'auto';
          el.style.height = `${el.scrollHeight}px`;
        }}
        onBlur={e => { if (!(e.relatedTarget as HTMLElement | null)?.dataset?.calBtn) commit(); }}
        onKeyDown={e => {
          // Enter commits (matches every other single-line cell in this
          // table); Shift+Enter inserts a real line break instead, for
          // fields like Remark/addresses that read better multi-line.
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setVal(value ?? ''); setEditing(false); }
        }}
        style={{ flex: 1, minWidth: 0, border: '1.5px solid #2563eb', borderRadius: 4, padding: '2px 5px', fontSize: 11, outline: 'none', background: '#eff6ff', fontFamily: 'inherit', resize: 'none', overflow: 'hidden', lineHeight: 1.4, display: 'block' }}
      />
      {isDateField && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" data-cal-btn="1" tabIndex={0}
            onMouseDown={e => { e.preventDefault(); dateRef.current?.showPicker?.(); }}
            style={{ border: '1px solid #c7d2fe', borderRadius: 4, background: '#eef2ff', color: '#4338ca', cursor: 'pointer', padding: '2px 5px', display: 'flex', alignItems: 'center' }}>
            <Calendar size={12} />
          </button>
          <input ref={dateRef} type="date" onChange={handleDatePick}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0, top: 0, left: 0 }} />
        </div>
      )}
    </div>
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

  // Someone else already changed this exact field before this save landed —
  // the value shown here is already the real, current one (adopted in
  // persist() above), so there's nothing to retry; just make it visible
  // that this wasn't the value just typed.
  if (status === 'conflict') return (
    <div title={`Changed by ${conflictRef.current.changedBy ?? 'another user'} just before your edit — showing their value now.`}
      style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 4, padding: '1px 4px', cursor: 'help' }}>
      <span style={{ fontSize: 11, color: '#374151', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conflictRef.current.currentValue || '—'}</span>
      <RotateCcw size={10} style={{ color: '#c2410c', flexShrink: 0 }} />
      <button onClick={() => setStatus('idle')} title="Dismiss" style={{ border: 'none', background: 'transparent', color: '#c2410c', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={11} /></button>
    </div>
  );

  const display = (value ?? '').trim();
  // No visible saving/saved indicator (Vincent: doesn't need every keystroke
  // shown — it's already recorded in the audit log). error/conflict states
  // above still render their own explicit UI since those need attention.
  const statusDot = null;

  if (field === 'status') {
    const colors = statusColor(value);
    return (
      <div onClick={() => setEditing(true)} title="Click to edit" style={{ cursor: 'text', minHeight: 22, display: 'flex', alignItems: 'center', gap: 4 }}>
        {display
          ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#fff', color: colors?.color, border: '1px solid #dbe3ec', borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
              <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: colors?.color ?? '#94a3b8' }} />
              {display}
            </span>
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
  // are shown as-is. Universal so no date column can be missed. PIC-style/
  // title-case columns (never dates) instead go through their formatter.
  const shown = FORMATTED_TEXT_FIELDS.has(field) ? displayFieldValue(field, display) : (display ? (toDisplayDate(display) ?? display) : display);
  return (
    <div onClick={() => setEditing(true)} title="Click to edit" style={{ cursor: 'text', minHeight: 22, display: 'flex', alignItems: 'center', gap: 4, borderRadius: 3, padding: '1px 3px' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      {AUTO_SYNCED_FIELDS_UI.has(field) && !!shown && !isManual && <AutoFillDot />}
      {shown
        ? <span
            className={field === 'company_name' ? 'company-name-text' : field === 'roc_no' ? 'company-registration-text' : undefined}
            style={field === 'company_name' || field === 'roc_no' ? undefined : { fontSize: 11, color: '#374151' }}
          >{shown}</span>
        : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>}
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
  new_company_name: 'Company Info',
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
// Addresses/notes/lists routinely wrap to several lines. In a fixed-column
// grid that stretches every cell in the row to match the tallest one, which
// left short neighbours (Email, Contact Window, …) sitting in a mostly-empty
// cell. These fields get a wider flex basis instead of a cramped narrow one.
const WIDE_MODAL_FIELDS = new Set(['invoice_address', 'mailing_address', 'mailing_list', 'remark', 'referral', 'shareholders', 'directors']);

// Person-name-shaped columns — same casing/full-name treatment as email
// greetings (lib/text-case.ts), routed through the staff directory so an
// abbreviation like "JF" or "Kah Ye" always renders as the one canonical
// name everywhere. Applied at DISPLAY time only (never rewrites the stored
// value) but consistently everywhere a value is shown OR compared — the
// column filter's option list and match logic use the exact same formatted
// value, otherwise raw variants of the same person would still splinter the
// filter dropdown even though the cell text looks unified.
const PIC_STYLE_FIELDS = new Set(['nominee_director', 'secretary', 'acc_pic', 'tax_pic', 'contact_window']);
// Not a name list (no staff-directory lookup, no comma/slash splitting —
// that would mangle a real address like "Blk 5 & 6" or a floor "12/F") —
// just the same title-case rule on its own.
const TITLE_CASE_FIELDS = new Set(['invoice_address']);
const FORMATTED_TEXT_FIELDS = new Set([...PIC_STYLE_FIELDS, ...TITLE_CASE_FIELDS]);

function displayFieldValue(field: string, raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (PIC_STYLE_FIELDS.has(field)) return formatStaffName(value);
  if (TITLE_CASE_FIELDS.has(field)) return titleCase(value);
  return value;
}

// Always-visible input + on-blur save, for the modal (unlike EditCell's
// click-to-reveal, which exists to keep table cells compact — the modal has
// room to just show every input at once).
// Mirrors AR Reminder's EditField exactly (app/billing/page.tsx) for compact
// fields: a plain read-only-looking row by default, click to reveal a real
// input; blur/Enter commits. An empty date shows a muted calendar glyph +
// em-dash (display-only, not the picker button) exactly as EditField does.
// Long free-text fields (addresses, remarks, …) skip this — they stay an
// always-visible auto-resizing textarea since a single-line click-to-edit
// input would clip wrapped content.
const ModalField = memo(function ModalField({ id, field, label, value, onSave, compact = false, dark = false, isManual = false }: {
  id: number; field: string; label: string; value: string | null; onSave: (id: number, field: string, val: string) => void; compact?: boolean; dark?: boolean; isManual?: boolean;
}) {
  const isDateField = DATE_FIELDS.has(field as ColumnField);
  // invoice_address is always used in wide (non-compact) mode — baking its
  // title-casing into inputValue itself means the textarea's own baseline
  // (used for the no-op-edit check below) is the SAME formatted value, so
  // clicking in and out without changing anything never silently rewrites
  // the stored address.
  const inputValue = useCallback((raw: string | null) => {
    if (isDateField) return toDisplayDate(raw) ?? raw ?? '';
    if (TITLE_CASE_FIELDS.has(field)) return titleCase(raw ?? '');
    return raw ?? '';
  }, [isDateField, field]);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(inputValue(value));
  const [status, setStatus] = useState<SaveStatus>('idle');
  const conflictRef = useRef<{ currentValue: string; changedBy: string | null }>({ currentValue: '', changedBy: null });
  const inputRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setVal(inputValue(value)); }, [value, inputValue]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const commit = useCallback(async () => {
    const next = val.trim();
    const prev = inputValue(value).trim();
    if (next === prev) return;
    onSave(id, field, next);
    setStatus('saving');
    try {
      // previousValue must be the RAW stored value (this component's `value`
      // prop), not `prev` above — that's reformatted for display (dates,
      // title case) and would never match the DB's actual text, making
      // every save look like a conflict. Doubles as the optimistic-
      // concurrency check (see app/api/master-list/route.ts's PATCH).
      const res = await fetch('/api/master-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: next || null, previousValue: value || null }) });
      if (res.status === 409) {
        const json = await res.json().catch(() => ({}));
        const current = String(json.currentValue ?? '');
        conflictRef.current = { currentValue: current, changedBy: json.changedBy ?? null };
        onSave(id, field, current);
        setVal(inputValue(current));
        setStatus('conflict');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('saved');
      setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1400);
    } catch { setStatus('error'); }
  }, [val, value, id, field, onSave, inputValue]);

  const handleDatePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    setVal(fmtDate(e.target.value));
    e.target.value = '';
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // No visible saving/saved indicator (Vincent: doesn't need every keystroke
  // shown — it's already recorded in the audit log). error/conflict states
  // below still render their own explicit UI since those need attention.
  const statusDot = null;

  // `compact` never changes for a given field once mounted, but hooks still
  // need to run unconditionally every render (not skipped by an early
  // return), so the wide-field auto-resize is declared here rather than
  // after the compact branch's returns.
  const resize = useCallback(() => {
    const el = taRef.current;
    if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }
  }, []);
  useEffect(() => { if (!compact) resize(); }, [val, resize, compact]);

  if (compact) {
    if (editing) return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input ref={inputRef} type="text" value={val}
          onChange={e => setVal(e.target.value)}
          onBlur={e => { if (!(e.relatedTarget as HTMLElement | null)?.dataset?.calBtn) { setEditing(false); commit(); } }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setEditing(false); commit(); } if (e.key === 'Escape') { setVal(inputValue(value)); setEditing(false); } }}
          placeholder={isDateField ? 'e.g. 03 Apr 2026' : ''}
          style={{ flex: '1 1 200px', border: '1.5px solid #2563eb', borderRadius: 4, padding: '2px 6px', fontSize: 12, outline: 'none', background: '#eff6ff', minWidth: 0 }}
        />
        {isDateField && (
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button type="button" data-cal-btn="1" tabIndex={0}
              onMouseDown={e => { e.preventDefault(); dateRef.current?.showPicker?.(); }}
              style={{ border: '1px solid #c7d2fe', borderRadius: 4, background: '#eef2ff', color: '#4338ca', cursor: 'pointer', padding: '2px 5px', display: 'flex', alignItems: 'center' }}>
              <Calendar size={12} />
            </button>
            <input ref={dateRef} type="date" onChange={handleDatePick}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0, top: 0, left: 0 }} />
          </div>
        )}
      </div>
    );

    const display = PIC_STYLE_FIELDS.has(field) ? displayFieldValue(field, val) : val.trim();
    return (
      <div onClick={() => setEditing(true)} title="Click to edit" style={{ cursor: 'text', minHeight: 24, display: 'flex', alignItems: 'center', gap: 4, borderRadius: 3, padding: '1px 3px' }}
        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = dark ? 'rgba(255,255,255,0.1)' : '#f0f6ff'}
        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
        {AUTO_SYNCED_FIELDS_UI.has(field) && !!display && !isManual && <AutoFillDot />}
        {display
          ? <span style={{ fontSize: 12, color: dark ? '#fff' : '#374151' }}>{display}</span>
          : isDateField
            ? <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: dark ? 'rgba(255,255,255,0.5)' : '#c7d2fe', fontSize: 11 }}><Calendar size={11} /><span style={{ color: dark ? 'rgba(255,255,255,0.4)' : '#d1d5db' }}>—</span></span>
            : <span style={{ color: dark ? 'rgba(255,255,255,0.4)' : '#d1d5db', fontSize: 11 }}>—</span>}
        {statusDot}
        {status === 'error' && <span style={{ color: '#dc2626', fontSize: 9 }}>save failed</span>}
        {status === 'conflict' && (
          <span title={`Changed by ${conflictRef.current.changedBy ?? 'another user'} just before your edit — showing their value now.`}
            style={{ color: '#c2410c', fontSize: 9, cursor: 'help' }}>changed elsewhere, refreshed</span>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
        {label}
        {AUTO_SYNCED_FIELDS_UI.has(field) && !!val.trim() && !isManual && <AutoFillDot />}
        {statusDot}
        {status === 'error' && <span style={{ color: '#dc2626', fontSize: 9 }}>save failed</span>}
        {status === 'conflict' && (
          <span title={`Changed by ${conflictRef.current.changedBy ?? 'another user'} just before your edit — showing their value now.`}
            style={{ color: '#c2410c', fontSize: 9, cursor: 'help' }}>changed elsewhere, refreshed</span>
        )}
      </div>
      <textarea ref={taRef} value={val} rows={1} onChange={e => setVal(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }}
        style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', fontSize: 12, outline: 'none', boxSizing: 'border-box', background: '#fff', color: '#1e293b', fontFamily: 'inherit', resize: 'none', overflow: 'hidden', lineHeight: 1.4 }} />
    </div>
  );
});


function CompanyDetailModal({ row, fieldColumns, onClose, onSave, onToggleActive, onSaveOverride, moveTargets, onMove, onDelete }: {
  row: MasterListRow;
  fieldColumns: { field: ColumnField; label: string }[];
  onClose: () => void;
  onSave: (id: number, field: string, val: string) => void;
  onToggleActive: (id: number, field: 'acc_active' | 'tax_active', current: boolean | null | undefined) => void;
  onSaveOverride: (id: number, field: 'acc_pic_override' | 'tax_pic_override', val: string, previousValue: string | null) => void;
  moveTargets?: MoveTarget[];
  onMove: (row: MasterListRow, target: MoveTarget) => void;
  onDelete: (row: MasterListRow) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, { field: ColumnField; label: string }[]>();
    for (const c of fieldColumns) {
      const section = FIELD_SECTIONS[c.field] ?? 'Other';
      if (!m.has(section)) m.set(section, []);
      m.get(section)!.push(c);
    }
    return m;
  }, [fieldColumns]);

  // Wide (long free-text) fields render after the compact ones within a
  // group regardless of declared field order — e.g. Contact & Address lists
  // invoice_address second, but a full-width address box belongs below the
  // short Tel/Email/Contact Window rows, not sandwiched between them.
  const split = useCallback((name: string, exclude: string[] = []) => {
    const all = (groups.get(name) ?? []).filter(c => !exclude.includes(c.field));
    return { compact: all.filter(c => !WIDE_MODAL_FIELDS.has(c.field)), wide: all.filter(c => WIDE_MODAL_FIELDS.has(c.field)) };
  }, [groups]);

  const companyInfo = split('Company Info');
  const compliance = split('Compliance');
  const contactAddress = split('Contact & Address');
  const services = split('Services');
  const notes = split('Notes', ['referral', 'remark']);
  const referralField = fieldColumns.find(c => c.field === 'referral') ?? null;
  const remarkField = fieldColumns.find(c => c.field === 'remark') ?? null;

  const colors = statusColor(row.status);

  // Change history — same header-toggle-button pattern as AR Reminder's
  // ARDetailModal ("History" button next to delete/close), rather than the
  // small collapsed text link this used to be at the bottom of the modal.
  const [showHistory, setShowHistory] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<AuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/audit-log?table=master_list&id=${row.id}`);
      const json = await res.json();
      setHistoryEntries(json.data ?? []);
    } catch {
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [row.id]);

  const sectionLabel = (text: string) => (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>{text}</div>
  );

  const renderField = (c: { field: ColumnField; label: string }) => {
    if (c.field === 'acc_pic') return (
      <div key={c.field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110 }}>ACC</span>
        <div style={{ flex: 1 }}>
          <ServiceChip name={row.acc_pic} active={!!row.acc_active} onToggleActive={() => onToggleActive(row.id, 'acc_active', row.acc_active)} onSaveName={val => onSaveOverride(row.id, 'acc_pic_override', val, row.acc_pic_override ?? null)} />
        </div>
      </div>
    );
    if (c.field === 'tax_pic') return (
      <div key={c.field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110 }}>TAX</span>
        <div style={{ flex: 1 }}>
          <ServiceChip name={row.tax_pic} active={!!row.tax_active} onToggleActive={() => onToggleActive(row.id, 'tax_active', row.tax_active)} onSaveName={val => onSaveOverride(row.id, 'tax_pic_override', val, row.tax_pic_override ?? null)} />
        </div>
      </div>
    );
    if (c.field === 'nominee_director' || c.field === 'secretary') {
      const value = c.field === 'nominee_director' ? row.nominee_director : row.secretary;
      const active = c.field === 'nominee_director' ? row.nd_active : row.secretary_active;
      return (
        <div key={c.field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110, display: 'flex', alignItems: 'center', gap: 5 }}>
            {c.label}
            {AUTO_SYNCED_FIELDS_UI.has(c.field) && !!value && !row.manual_fields?.[c.field] && <AutoFillDot />}
          </span>
          <div style={{ flex: 1 }}>
            {/* Nominee Dir. and Secretary checkboxes are both pure "has a
                name on file" indicators now (Vincent: "ND的打勾也做一样的
                处理"), always derived from the name itself — never
                independently clickable. */}
            <ServiceChip name={value} active={!!active}
              onSaveName={val => {
                onSave(row.id, c.field, val);
                fetch('/api/master-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, field: c.field, value: val || null, previousValue: value || null }) });
              }} />
          </div>
        </div>
      );
    }
    return (
      <div key={c.field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110 }}>{c.label}</span>
        <div style={{ flex: 1 }}>
          <ModalField id={row.id} field={c.field} label={c.label} value={(row as unknown as Record<string, string | null>)[c.field]} onSave={onSave} compact isManual={!!row.manual_fields?.[c.field]} />
        </div>
      </div>
    );
  };

  const renderWideField = (c: { field: ColumnField; label: string }, marginTop = 8) => (
    <div key={c.field} style={{ marginTop }}>
      <ModalField id={row.id} field={c.field} label={c.label} value={(row as unknown as Record<string, string | null>)[c.field]} onSave={onSave} isManual={!!row.manual_fields?.[c.field]} />
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 880, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '16px 20px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{row.company_name}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
              <button onClick={() => { const next = !showHistory; setShowHistory(next); if (next) void loadHistory(); }} title="Change history"
                style={{ background: showHistory ? 'rgba(59,130,246,0.34)' : 'rgba(255,255,255,0.12)', border: 'none', color: '#dbeafe', borderRadius: 8, height: 32, padding: '0 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700 }}>
                <History size={14} /> History
              </button>
              <div style={{ background: 'rgba(255,255,255,0.12)', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <RowActionMenu row={row} moveTargets={moveTargets} onMove={onMove} onDelete={onDelete} dark />
              </div>
              <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {row.roc_no && <span style={{ fontSize: 11, color: '#fff', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4 }}>{row.roc_no}</span>}
            {row.status && (
              <span style={{ background: colors?.bg ?? 'rgba(255,255,255,0.12)', color: colors?.color ?? '#fff', border: `1px solid ${colors?.color ?? '#fff'}40`, borderRadius: 999, padding: '5px 10px', fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: colors?.color ?? '#fff', flexShrink: 0 }} />
                {row.status}
              </span>
            )}
            {row.renamed_from && (
              <span title={row.renamed_to ? `Renamed from "${row.renamed_from}" to "${row.renamed_to}"` : undefined}
                style={{ background: 'rgba(255,255,255,0.12)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 999, padding: '5px 10px', fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                <RotateCcw size={10} />Formerly &quot;{row.renamed_from}&quot;
              </span>
            )}
          </div>
          {referralField && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.6)', fontWeight: 600, minWidth: 60, flexShrink: 0 }}>Referral</span>
                <ModalField id={row.id} field={referralField.field} label={referralField.label} value={row.referral} onSave={onSave} compact dark />
              </div>
            </div>
          )}
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '16px 20px', background: '#f8fafc' }}>
          {showHistory && (
            <div style={{ marginBottom: 16, border: '1px solid #dbe3ee', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
              <div style={{ padding: '10px 13px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#1e3a5f' }}>Change history</div>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>Every saved change records who changed it.</div>
                </div>
                <button onClick={() => void loadHistory()} disabled={historyLoading} style={{ border: '1px solid #cbd5e1', background: '#fff', color: '#475569', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', display: 'flex' }}><RefreshCw size={11} /></button>
              </div>
              {historyLoading && historyEntries.length === 0 ? (
                <div style={{ padding: '18px 18px 28px', textAlign: 'center', color: '#94a3b8', fontSize: 10 }}>Loading history…</div>
              ) : historyEntries.length === 0 ? (
                <div style={{ padding: '18px 18px 28px', textAlign: 'center', color: '#94a3b8', fontSize: 10 }}>No saved changes yet.</div>
              ) : (
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {historyEntries.map((entry, index) => (
                    <div key={entry.id} style={{ padding: '9px 13px', borderBottom: index < historyEntries.length - 1 ? '1px solid #f1f5f9' : 'none', display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 150px', gap: 10, alignItems: 'center' }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: '#475569' }}>{entry.field}</div>
                      <div style={{ minWidth: 0, fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.old_value ?? 'Empty'}</span>
                        <span style={{ color: '#cbd5e1' }}>→</span>
                        <span style={{ color: '#1e3a5f', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.new_value ?? 'Empty'}</span>
                      </div>
                      <div style={{ fontSize: 9, color: '#64748b' }}>
                        <div style={{ fontWeight: 700 }}>{entry.changed_by}</div>
                        <div>{new Date(entry.changed_at).toLocaleString()}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Left: Company Info + Compliance, sequential — no card outline. */}
            <div>
              {(companyInfo.compact.length > 0 || companyInfo.wide.length > 0) && (
                <div>
                  {sectionLabel('Company Info')}
                  {companyInfo.compact.map(renderField)}
                  {companyInfo.wide.map(c => renderWideField(c))}
                </div>
              )}
              {(compliance.compact.length > 0 || compliance.wide.length > 0) && (
                <div style={{ marginTop: companyInfo.compact.length || companyInfo.wide.length ? 16 : 0 }}>
                  {sectionLabel('Compliance')}
                  {compliance.compact.map(renderField)}
                  {compliance.wide.map(c => renderWideField(c))}
                </div>
              )}
            </div>

            {/* Right: Contact & Address, its own card. */}
            {(contactAddress.compact.length > 0 || contactAddress.wide.length > 0) && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
                {sectionLabel('Contact & Address')}
                {contactAddress.compact.map(renderField)}
                {contactAddress.wide.map(c => renderWideField(c))}
              </div>
            )}
          </div>

          {/* Services — no card, divider line, 2-up grid (ND/Secretary/ACC/TAX). */}
          {services.compact.length > 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              {sectionLabel('Services')}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {services.compact.map(renderField)}
              </div>
              {services.wide.map(c => renderWideField(c))}
            </div>
          )}

          {/* Notes — no card, just a divider line, 2-up grid. */}
          {notes.compact.length > 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              {sectionLabel('Notes')}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {notes.compact.map(renderField)}
              </div>
            </div>
          )}

          {/* Remark — its own divider, full-width row. */}
          {remarkField && (
            <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
              {renderWideField(remarkField, 0)}
            </div>
          )}
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
  const [catFilter, setCatFilter] = useState<'all' | 'tw_css_client' | 'fye_mismatch' | 'has_nd' | 'non_teamwork'>('all');
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ColumnField, Set<string>>>>({});
  const [view, setView] = useState<'list' | 'table'>('list');
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);
  const isMobile = useIsMobile();
  // Active Client only: TeamWork CSS Clients with no row here at all — can't
  // be shown by filtering the table (there's nothing to filter to), so it's
  // its own small panel instead of a catFilter card.
  const [missingCssClients, setMissingCssClients] = useState<{ company_name: string; registration_no: string | null; internal_code: string | null }[]>([]);
  const [showMissingPanel, setShowMissingPanel] = useState(false);
  // TeamWork's own total client count, independent of master_list — see
  // app/api/master-list/route.ts's GET for how it's computed.
  const [twTotalClientCount, setTwTotalClientCount] = useState(0);
  // Only for stamping the "last edited by" trace optimistically on this
  // client's own saves (see handleSave/toggleActive below) — not an auth
  // check, the server already enforces that.
  const [me, setMe] = useState<{ email: string; name: string } | null>(null);
  useEffect(() => { fetch('/api/auth/me').then(r => r.json()).then(j => setMe(j.user ?? null)).catch(() => {}); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type: listType, search });
      const res  = await fetch(`/api/master-list?${params}`);
      const json = await res.json();
      setRows(json.data ?? []);
      setMissingCssClients(json.missingCssClients ?? []);
      setTwTotalClientCount(json.twTotalClientCount ?? 0);
    } finally { setLoading(false); }
  }, [listType, search]);

  useEffect(() => { load(); }, [load]);

  // Live sync — same pattern as AR Reminder's own realtime subscription
  // (app/billing/page.tsx's ARTab), so another staff member's edit shows up
  // here without a manual refresh (Vincent: wants this "Sheets-fast", not
  // laggy). Scoped to this page's own list_type so an edit on a different
  // Master List page never reaches here. UPDATE events patch just the one
  // changed row directly from the payload — no refetch, no round trip, no
  // visible re-render of anything else on the page, ever, for an UPDATE.
  // Vincent was explicit twice that any full-table refresh from background
  // sync is unwanted, even briefly, even debounced — so unlike the first
  // version of this handler, there is now NO reload path for UPDATE at all,
  // full stop, not even for acc_pic_override/tax_pic_override (their
  // *displayed* value, a cross-table join the raw payload can't recompute
  // client-side, can go briefly stale until the next real page load — a
  // rare, minor, self-correcting cosmetic gap, accepted deliberately in
  // exchange for the table never visibly reloading while someone's editing
  // it). INSERT (a genuinely new row, needing the same join enrichment
  // before it can be shown at all — no local row exists yet to patch) is
  // the only remaining case that still reloads, debounced so a burst of
  // several new rows coalesces into one fetch instead of one per row.
  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void load(), 700);
    };

    const channel = supabase
      .channel(`master-list-${listType}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'master_list', filter: `list_type=eq.${listType}` }, payload => {
        const next = payload.new as Partial<MasterListRow> & { id?: number; updated_by_name?: string | null; updated_by_email?: string | null };
        const previous = payload.old as Partial<MasterListRow> & { id?: number };
        const id = next.id ?? previous.id;
        if (!id) return;

        if (payload.eventType === 'DELETE') {
          setRows(current => current.filter(r => r.id !== id));
          setSelectedRowId(current => current === id ? null : current);
          return;
        }

        // Skip re-applying this client's OWN change — it's already reflected
        // locally (handleSave/toggleActive stamp it optimistically, ahead of
        // this event even arriving), so patching it in again is a pure
        // no-op re-render with nothing new to show. Only DELETE is exempt
        // from this (someone else deleting a row this client happens to
        // have open still needs to be reflected even if it were somehow
        // this client's own action).
        if (next.updated_by_email && next.updated_by_email === me?.email) return;

        if (payload.eventType === 'UPDATE') {
          setRows(current => current.map(r => r.id === id ? { ...r, ...next } : r));
          return;
        }

        scheduleReload();
      })
      .subscribe();

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      void supabase.removeChannel(channel);
    };
  }, [listType, load, me?.email]);

  const handleSave = useCallback((id: number, field: string, val: string) => {
    // Same optimism as the field value itself (see EditCell/ModalField —
    // both call onSave before the request even resolves): stamps the
    // trace immediately rather than waiting for a reload. A failed save
    // still shows its own error/conflict state on the cell, so this
    // staying slightly ahead of the server is harmless.
    setRows(prev => prev.map(r => r.id === id
      ? {
          ...r, [field]: val || null, updated_at: new Date().toISOString(), updated_by_name: me?.name ?? r.updated_by_name,
          // The server derives secretary_active/nd_active from the same
          // write (see app/api/master-list/route.ts's PATCH) — mirrored
          // here so the checkbox updates immediately instead of only
          // catching up on the next reload (Vincent: "打勾还在，我刷新页
          // 面后，打勾才不见...重新填写内容后，打勾又没有实现打勾回去，
          // 意思就是不同步"; ND given the same treatment per "ND的打勾也
          // 做一样的处理").
          ...(field === 'secretary' ? { secretary_active: !!val } : {}),
          ...(field === 'nominee_director' ? { nd_active: !!val } : {}),
          // Same instant-sync fix, generalized: the server also flags
          // manual_fields[field] on every auto-synced text field's save
          // (see app/api/master-list/route.ts's `isManual` computation) —
          // mirror it here too so the blue AutoFillDot appears/disappears
          // immediately rather than only on the next reload, for every
          // field in AUTO_SYNCED_FIELDS_UI (CODE/EMAIL/FYE included).
          ...(AUTO_SYNCED_FIELDS_UI.has(field) ? { manual_fields: { ...r.manual_fields, [field]: !!val } } : {}),
        }
      : r));
  }, [me]);

  // ACC/TAX checkboxes — freely toggleable, independent of whether a name
  // is on file (Nominee Dir./Secretary are no longer independently
  // toggleable, see above). Optimistic; a checkbox flip is low-risk
  // enough not to need retry/error UI — but still conflict-safe: if someone
  // else already flipped it since this click's `current` was rendered, the
  // server rejects the stale write (409) and the checkbox snaps back to
  // whatever it actually is now, instead of silently clobbering their change.
  const toggleActive = useCallback((id: number, field: 'acc_active' | 'tax_active', current: boolean | null | undefined) => {
    const next = !current;
    setRows(prev => prev.map(r => r.id === id
      ? { ...r, [field]: next, updated_at: new Date().toISOString(), updated_by_name: me?.name ?? r.updated_by_name }
      : r));
    fetch('/api/master-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: next, previousValue: !!current }) })
      .then(async res => {
        if (res.status !== 409) return;
        const json = await res.json().catch(() => ({}));
        setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: !!json.currentValue } : r));
      });
  }, [me]);

  // ACC/TAX name edits write to the *_override column, which only takes
  // effect ahead of AR Reminder's synced value once set server-side — reload
  // afterwards instead of hand-rolling the override-vs-AR-Reminder
  // resolution locally, so the displayed value always matches real DB state.
  const saveOverride = useCallback((id: number, field: 'acc_pic_override' | 'tax_pic_override', val: string, previousValue: string | null) => {
    fetch('/api/master-list', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: val || null, previousValue: previousValue || null }) })
      .then(() => load());
  }, [load]);

  // Collapsible "Active" column — same collapse/expand pattern as AR
  // Reminder's PIC columns (app/billing/page.tsx's ARTableView), since the
  // status badge (e.g. "STRUCK OFF") can take up a lot of width per row.
  const [statusOpen, setStatusOpen] = useState(true);

  // ── Add Manual ──────────────────────────────────────────────────────────
  // Change Co Name gets its own Add Manual flow: UEN first (auto-fills the
  // current name/Code from whatever's on file under that UEN), then a
  // dedicated New Name field — see lookupByUen below.
  const isNameChange = listType === 'name_change';
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving]           = useState(false);
  const [newRow, setNewRow]           = useState<Partial<MasterListRow>>({});

  const missingAddRequired = !newRow.company_name?.trim() || (isNameChange && !newRow.new_company_name?.trim());
  const startAdd  = () => { setNewRow({}); setShowAddForm(true); };
  const cancelAdd = () => { setShowAddForm(false); setNewRow({}); };
  // Pre-fills the same Add Manual form from a "Missing from Active Client"
  // entry, so staff don't have to retype the name/UEN/Code TeamWork already gave us.
  const startAddFrom = (c: { company_name: string; registration_no: string | null; internal_code: string | null }) => {
    setNewRow({ company_name: c.company_name.toUpperCase(), roc_no: c.registration_no?.toUpperCase() ?? '', internal_code: c.internal_code?.toUpperCase() ?? '' });
    setShowAddForm(true);
  };
  // Typing a company name that's already TeamWork-synced (companies table)
  // auto-fills its Code on blur, so staff typing a brand-new row from
  // scratch don't have to look it up and retype it by hand. Best-effort —
  // silently does nothing if the lookup fails or finds no exact match, and
  // never overwrites a Code the user already typed themselves.
  const lookupTwCode = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`/api/companies?search=${encodeURIComponent(trimmed)}&limit=10`);
      const json = await res.json();
      const candidates: { companyName: string; internalCode: string | null }[] = json.data ?? [];
      const target = normalize(trimmed);
      const match = candidates.find(c => normalize(c.companyName) === target);
      if (match?.internalCode) {
        setNewRow(v => (v.internal_code?.trim() ? v : { ...v, internal_code: match.internalCode!.toUpperCase() }));
      }
    } catch {
      // Best-effort only — never block manual entry on a failed lookup.
    }
  }, []);

  // Change Co Name only: UEN is filled in FIRST, and drives everything else —
  // looks up the company already on file under that UEN and fills in its
  // current name + Code, so staff never retype what TeamWork already knows.
  // Unlike lookupTwCode above, this always overwrites (a changed UEN should
  // always re-resolve to whichever company that UEN now points to).
  const lookupByUen = useCallback(async (uen: string) => {
    const trimmed = uen.trim();
    if (!trimmed) return;
    try {
      const res = await fetch(`/api/companies?search=${encodeURIComponent(trimmed)}&limit=10`);
      const json = await res.json();
      const candidates: { companyName: string; registrationNo: string | null; internalCode: string | null }[] = json.data ?? [];
      const target = trimmed.toUpperCase();
      const match = candidates.find(c => (c.registrationNo ?? '').trim().toUpperCase() === target);
      if (match) {
        setNewRow(v => ({
          ...v,
          company_name: match.companyName.toUpperCase(),
          internal_code: match.internalCode ? match.internalCode.toUpperCase() : v.internal_code,
        }));
      }
    } catch {
      // Best-effort only — never block manual entry on a failed lookup.
    }
  }, []);

  const saveNew = async () => {
    if (missingAddRequired) return;
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
      case 'tw_css_client': return r.is_css_client === true;
      case 'fye_mismatch':  return isFyeMismatch(r);
      case 'has_nd':        return !!r.nd_active;
      case 'non_teamwork':  return r.in_teamwork === false;
      default:              return true;
    }
  };
  const catCount = (cat: typeof catFilter) => rows.filter(r => catMatch(r, cat)).length;
  const columnMatch = (r: MasterListRow) => {
    for (const [field, allowed] of Object.entries(columnFilters) as [ColumnField, Set<string>][]) {
      const raw = (r as unknown as Record<string, string | null>)[field];
      const value = displayFieldValue(field, raw) || '(Blank)';
      if (!allowed.has(value)) return false;
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
  // Order here is the actual on-screen order (Vincent: "non teamwork /
  // missing from active client 卡片放到 第3/第4张的排序") — non_teamwork is
  // 3rd; Missing from Active Client (its own card below, not in this array
  // since it toggles a different panel) is rendered right after it as the
  // 4th, ahead of fye_mismatch/has_nd. MAS Regulated removed per Vincent
  // (replaced by the standalone TW Total Client card, rendered first,
  // ahead of this whole array — see below).
  const catCards: { key: typeof catFilter; label: string; sub: string; color: string; Icon: typeof Building2 }[] = [
    { key: 'all',           label: 'Total Records',   sub: 'in this list',                          color: '#1d3a5c', Icon: Building2 },
    { key: 'tw_css_client', label: 'TW CSS Clients',  sub: 'synced as CSS Client (Companies page)', color: '#0f766e', Icon: Users },
    { key: 'non_teamwork',  label: 'Non-TeamWork',    sub: 'not found in TeamWork',                 color: '#b45309', Icon: CloudOff },
    { key: 'fye_mismatch',  label: 'FYE Mismatch',    sub: 'differs from TeamWork',                 color: '#dc2626', Icon: AlertTriangle },
    { key: 'has_nd',        label: 'Has Nominee Dir', sub: 'nominee director on file',              color: '#7c3aed', Icon: UserCheck },
  ];

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Master List › {title}</div>

      {/* Category cards — click to filter */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12, marginBottom: 16, width: '100%' }}>
        {listType === 'active_client' && (
          <MetricCard
            value={twTotalClientCount}
            label="TW Total Client"
            sub="CSS Client, active in TeamWork"
            icon={<Building2 size={16} />}
            color="#1d3a5c"
            ariaLabel="TeamWork's total active CSS Client count"
          />
        )}
        {catCards.map(c => {
          const active = catFilter === c.key;
          return (
            <Fragment key={c.key}>
              <MetricCard
                onClick={() => setCatFilter(c.key)}
                active={active}
                value={catCount(c.key)}
                label={c.label}
                sub={c.sub}
                icon={<c.Icon size={16} />}
                color={c.color}
                ariaLabel={`Filter records by ${c.label}`}
              />
              {c.key === 'non_teamwork' && listType === 'active_client' && (
                <MetricCard
                  onClick={() => setShowMissingPanel(v => !v)}
                  active={showMissingPanel}
                  value={missingCssClients.length}
                  label="Missing from Active Client"
                  sub="TW CSS Client, no row here yet"
                  icon={<AlertTriangle size={16} />}
                  color="#b45309"
                  ariaLabel="Show TeamWork CSS clients missing from Active Client"
                />
              )}
            </Fragment>
          );
        })}
      </div>

      {showMissingPanel && listType === 'active_client' && (
        <div style={{ border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 14, marginBottom: 16, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px' }}>
            <span style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', flexShrink: 0, background: '#fef3c7', color: '#b45309' }}>
              <AlertTriangle size={16} />
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#1e293b' }}>Missing from Active Client</span>
                <span style={{ borderRadius: 999, background: '#fff', border: '1px solid #fde68a', color: '#92400e', padding: '3px 9px', fontSize: 10.5, fontWeight: 800 }}>
                  {missingCssClients.length} TeamWork CSS Client{missingCssClients.length === 1 ? '' : 's'}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#78716c', marginTop: 3 }}>Confirmed as a TeamWork CSS Client, but no row exists here yet.</div>
            </div>
          </div>
          {missingCssClients.length === 0 ? (
            <div style={{ background: '#fff', borderTop: '1px solid #fde68a', padding: '14px 16px', fontSize: 11.5, color: '#94a3b8' }}>None — every TeamWork CSS Client has a row here.</div>
          ) : (
            <div style={{ background: '#fff', borderTop: '1px solid #fde68a', maxHeight: 220, overflowY: 'auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))' }}>
              {missingCssClients.map(c => (
                <div key={c.registration_no ?? c.company_name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '9px 16px', borderBottom: '1px solid #fef3c7', fontSize: 11.5 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span className="company-name-text" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>{c.company_name}</span>
                    <span className="company-registration-text">{c.registration_no ?? '—'}</span>
                  </div>
                  <button onClick={() => startAddFrom(c)} title="Add to Master List — pre-fills Company Name, UEN/ROC and Code"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, padding: '5px 10px', borderRadius: 8, border: '1px solid #fde68a', background: '#fffbeb', color: '#b45309', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <Plus size={11} />Add to Master List
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search company name or UEN / ROC..."
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
        <div onClick={cancelAdd} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <div style={{ background: accentColor, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Add Manual Entry</div>
              <button onClick={cancelAdd} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ padding: '16px 20px', background: '#f8fafc' }}>
              {isNameChange && (
                <div style={{ fontSize: 11.5, color: '#64748b', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 7, padding: '7px 10px', marginBottom: 10 }}>
                  Enter the UEN first — the company&apos;s current name and Code fill in automatically. Then type the new name it&apos;s changing to.
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {(isNameChange ? [
                  { key: 'roc_no',            label: 'UEN / ROC *',    normalize: (v: string) => v.toUpperCase() },
                  { key: 'company_name',      label: 'Current Name',   normalize: (v: string) => v.toUpperCase() },
                  { key: 'new_company_name',  label: 'New Name *',     normalize: (v: string) => v.toUpperCase() },
                  { key: 'internal_code',     label: 'Code',           normalize: (v: string) => v.toUpperCase() },
                  { key: 'status',            label: 'Active / Status', normalize: (v: string) => v.toUpperCase() },
                  { key: 'fye',               label: 'FYE Month',      normalize: undefined },
                ] as const : [
                  { key: 'company_name', label: 'Company Name *', normalize: (v: string) => v.toUpperCase() },
                  { key: 'internal_code', label: 'Code',          normalize: (v: string) => v.toUpperCase() },
                  { key: 'roc_no',       label: 'UEN / ROC',      normalize: (v: string) => v.toUpperCase() },
                  { key: 'status',       label: 'Active / Status', normalize: (v: string) => v.toUpperCase() },
                  { key: 'fye',          label: 'FYE Month',      normalize: undefined },
                ] as const).map(f => (
                  <div key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '3px 8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 92, flexShrink: 0 }}>{f.label}</span>
                    {f.key === 'fye' ? (
                      <select value={newRow.fye ?? ''} onChange={e => setNewRow(v => ({ ...v, fye: e.target.value }))}
                        style={{ flex: '1 1 200px', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: '3px 0', fontSize: 13, fontWeight: 500, color: '#1e293b', boxSizing: 'border-box' }}>
                        <option value="">—</option>
                        {MONTH3_ABBR.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      <input value={newRow[f.key] ?? ''} onChange={e => setNewRow(v => ({ ...v, [f.key]: f.normalize ? f.normalize(e.target.value) : e.target.value }))}
                        onBlur={
                          isNameChange
                            ? (f.key === 'roc_no' ? e => void lookupByUen(e.target.value) : undefined)
                            : (f.key === 'company_name' ? e => void lookupTwCode(e.target.value) : undefined)
                        }
                        placeholder="—"
                        style={{ flex: '1 1 200px', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: '3px 0', fontSize: 13, fontWeight: 500, color: '#1e293b', boxSizing: 'border-box' }} />
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveNew} disabled={saving || missingAddRequired}
                  style={{ padding: '7px 16px', borderRadius: 9, border: listType === 'strike_off' ? 'none' : '1px solid rgba(21,94,89,.2)', background: listType === 'strike_off' ? accentColor : '#397f78', color: '#fff', fontWeight: 750, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: listType === 'strike_off' ? 'none' : '0 5px 14px rgba(57,127,120,.14)', opacity: saving || missingAddRequired ? 0.6 : 1 }}>
                  <Check size={14} />{saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={cancelAdd}
                  style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <X size={14} />Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {enableListView && view === 'list' ? (
        <div className="system-list-shell">
          <div className="system-list-title-bar px-4 py-3">
            <h2 className="system-list-title">{title}</h2>
            <span className="system-list-title-hint">Click a company to open full details and edit</span>
          </div>
          {!isMobile && (
            <div className="list-column-header-gray" style={{ display: 'grid', gridTemplateColumns: '32px minmax(260px,1.6fr) 120px 110px minmax(260px,1.25fr) 90px', padding: '10px 16px', columnGap: 12 }}>
              {['', 'Company Name', 'UEN / ROC', 'Status', 'Services', 'FYE'].map((h, i) => (
                <div key={i} style={{ fontWeight: 700 }}>{h}</div>
              ))}
            </div>
          )}
          <div style={{ maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>
            ) : visibleRows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No data</div>
            ) : pageItems.map((r, i) => {
              const openDetails = () => setSelectedRowId(r.id);
              return (
                <div
                  key={r.id}
                  className="system-list-row"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open full details for ${r.company_name}`}
                  title="Click to open full details and edit"
                  onClick={openDetails}
                  onKeyDown={event => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openDetails();
                    }
                  }}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? '1fr auto' : '32px minmax(260px,1.6fr) 120px 110px minmax(260px,1.25fr) 90px',
                    alignItems: 'center', columnGap: 12, minHeight: 64, padding: '11px 16px',
                    cursor: 'pointer', background: '#fff', transition: 'background 0.15s, box-shadow 0.15s',
                    outline: 'none',
                  }}
                  onFocus={event => {
                    event.currentTarget.style.background = '#f0f6ff';
                    event.currentTarget.style.boxShadow = 'inset 0 0 0 2px #93c5fd';
                  }}
                  onBlur={event => {
                    event.currentTarget.style.background = '#fff';
                    event.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  {!isMobile && (
                    <div style={{ color: '#94a3b8', display: 'flex', alignItems: 'center' }}>
                      <ChevronRight size={14} />
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div className="company-name-text" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: '#cbd5e1', marginRight: 6, fontSize: 11 }}>{startIndex + i + 1}</span>
                      {r.company_name}
                    </div>
                    {r.renamed_from && (
                      <div title={`Renamed from "${r.renamed_from}"${r.renamed_to ? ` to "${r.renamed_to}"` : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 2, fontSize: 10, fontWeight: 700, color: '#7c3aed' }}>
                        <RotateCcw size={9} />Formerly {r.renamed_from}
                      </div>
                    )}
                    {isMobile && r.roc_no && <div className="company-registration-text" style={{ marginTop: 1 }}>{r.roc_no}</div>}
                  </div>
                  {!isMobile && <div className="company-registration-text">{r.roc_no ?? '—'}</div>}
                  {!isMobile && (
                    <div>
                      {r.status
                        ? <span style={{ fontSize: 10, fontWeight: 700, background: '#fff', color: '#64748b', border: '1px solid #dbe3ec', borderRadius: 999, padding: '3px 9px', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#64748b', flexShrink: 0 }} />
                            {r.status}
                          </span>
                        : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>}
                    </div>
                  )}
                  {!isMobile && (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span title="Nominee Director" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9.5, color: '#64748b' }}><CheckSquare checked={!!r.nd_active} />ND</span>
                      <span title="Secretary" style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 9.5, color: '#64748b' }}><CheckSquare checked={!!r.secretary_active} />SEC</span>
                    </div>
                  )}
                  {!isMobile && <div style={{ fontSize: 11, color: '#64748b' }}>{r.fye ?? '—'}</div>}
                  {isMobile && <ChevronRight size={14} style={{ color: '#94a3b8' }} />}
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: '1px solid #f1f5f9', padding: '6px 16px', background: '#f8fafc' }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Arrow and highlighted row indicate that the company can be opened. Click any row to view full details and edit.
            </span>
          </div>
        </div>
      ) : (
      <div className="system-list-shell">
        <div className="system-list-title-bar px-4 py-3" style={{ background: accentColor }}>
          <h2 className="system-list-title">{title}</h2>
        </div>

        {/* Phone: native swipe-scroll (the mirrored scrollbar is desktop-only).
            minHeight keeps this from shrinking to just a few rows' worth of
            height when the filtered/searched result set is small — a column
            filter dropdown opened from the header needs room to render its
            search box, option list and buttons below it, and with too few
            rows the container's own height (driven by its normal-flow
            content; the dropdown itself is position:absolute and doesn't
            expand it) was clipping that dropdown via overflowY (Vincent:
            "当我的数据很小的时候，窗口会变到很小，导致我很难使用filter功能，
            能不能默认窗口大小"). */}
        <div ref={outerRef} style={{ overflowX: isMobile ? 'auto' : 'hidden', maxHeight: 'calc(100vh - 280px)', minHeight: 400, overflowY: 'auto' }}>
          <table style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: 'max-content', fontSize: 11 }}>
            <thead>
              <tr className="list-column-header-gray">
                <th style={{ position: 'sticky', top: 0, left: 0, zIndex: 3, padding: '7px 8px', minWidth: 36, width: 36, textAlign: 'center' }}>No.</th>
                {columns.map(c => {
                  const sl = stickyLeftOf(c.field);
                  const isStatus = c.field === 'status';
                  const collapsed = isStatus && !statusOpen;
                  return (
                    <th key={c.field} style={{
                      position: 'sticky', top: 0, left: sl !== undefined ? sl + 36 : undefined,
                      zIndex: sl !== undefined ? 3 : 2,
                      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
                      padding: '7px 8px', whiteSpace: 'nowrap', minWidth: collapsed ? 34 : c.w, width: collapsed ? 34 : c.w,
                      borderRight: '1px solid rgba(15,23,42,0.08)',
                      boxShadow: isStatus ? '3px 0 8px -2px rgba(0,0,0,0.1)' : undefined,
                    }}>
                      {isStatus ? (
                        collapsed ? (
                          <button type="button" onClick={() => setStatusOpen(true)} title={`Expand ${c.label}`}
                            style={{ width: '100%', padding: 0, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ChevronRight size={11} />
                          </button>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                            <button type="button" onClick={() => setStatusOpen(false)} title={`Collapse ${c.label} to the left`}
                              style={{ padding: 0, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700 }}>
                              <ChevronLeft size={11} /><span>{c.label}</span>
                            </button>
                            <ColumnFilterMenu field={c.field} label={c.label} rows={rows} selected={columnFilters[c.field] ?? null} onApply={next => applyColumnFilter(c.field, next)} />
                          </div>
                        )
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'space-between' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
                          <ColumnFilterMenu field={c.field} label={c.label} rows={rows} selected={columnFilters[c.field] ?? null} onApply={next => applyColumnFilter(c.field, next)} />
                        </div>
                      )}
                    </th>
                  );
                })}
                <th style={{ position: 'sticky', top: 0, zIndex: 2, fontSize: 9, fontWeight: 700, padding: '7px 8px', minWidth: 50, width: 50, textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={columns.length + 2} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</td></tr>
              ) : visibleRows.length === 0 ? (
                <tr><td colSpan={columns.length + 2} style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No data</td></tr>
              ) : pageItems.map((r, i) => (
                <tr key={r.id} className="system-list-row">
                  <td style={{ position: 'sticky', left: 0, zIndex: 1, background: '#fff', textAlign: 'center', color: '#94a3b8', fontSize: 10, fontWeight: 600, padding: '3px 6px', borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9' }}>{startIndex + i + 1}</td>
                  {columns.map(c => {
                    const sl = stickyLeftOf(c.field);
                    const statusCollapsed = c.field === 'status' && !statusOpen;
                    return (
                      <td key={c.field} style={{
                        padding: statusCollapsed ? 0 : '3px 6px', verticalAlign: 'top',
                        borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9',
                        wordBreak: 'break-word', overflowWrap: 'break-word',
                        position: sl !== undefined ? 'sticky' : undefined,
                        left: sl !== undefined ? sl + 36 : undefined,
                        zIndex: sl !== undefined ? 1 : undefined,
                        background: sl !== undefined ? '#fff' : undefined,
                        boxShadow: c.field === 'status' ? '3px 0 8px -2px rgba(0,0,0,0.12)' : undefined,
                      }}>
                        {statusCollapsed ? null : c.field === 'acc_pic' ? (
                          <PicCell name={r.acc_pic} active={!!r.acc_active} onToggleActive={() => toggleActive(r.id, 'acc_active', r.acc_active)} onSaveName={val => saveOverride(r.id, 'acc_pic_override', val, r.acc_pic_override ?? null)} />
                        ) : c.field === 'tax_pic' ? (
                          <PicCell name={r.tax_pic} active={!!r.tax_active} onToggleActive={() => toggleActive(r.id, 'tax_active', r.tax_active)} onSaveName={val => saveOverride(r.id, 'tax_pic_override', val, r.tax_pic_override ?? null)} />
                        ) : listType === 'active_client' && (c.field === 'nominee_director' || c.field === 'secretary') ? (
                          // Table view: name only, no checkbox (Vincent: 表格视图去掉打勾，
                          // List 视图的打勾保留不变 — see the CheckSquare usage further down
                          // near the compact ND/SEC pills for that view).
                          <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} isManual={!!r.manual_fields?.[c.field]} />
                        ) : c.field === 'company_name' && r.renamed_from ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} isManual={!!r.manual_fields?.[c.field]} />
                            <span
                              title={`Renamed from "${r.renamed_from}"${r.renamed_to ? ` to "${r.renamed_to}"` : ''}`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: 4, padding: '0 4px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0 }}>
                              <RotateCcw size={9} />Renamed
                            </span>
                          </div>
                        ) : c.field === 'fye' && r.tw_fye && fyeMonthNum(r.fye) !== null && fyeMonthNum(r.fye) !== fyeMonthNum(r.tw_fye) ? (
                          (c.w ?? 180) <= 80
                            ? <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} compactFyeMismatch={r.tw_fye} />
                            : <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} isManual={!!r.manual_fields?.[c.field]} />
                                <span
                                  title={`⚠ FYE mismatch — TeamWork says "${r.tw_fye}", manual entry is "${r.fye}". Please verify which is correct.`}
                                  style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '0 4px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0 }}>
                                  <AlertTriangle size={10} />TW:{String(r.tw_fye).slice(0, 3).toUpperCase()}
                                </span>
                              </div>
                        ) : c.field === 'last_agm_date' && dateMismatch(r.last_agm_date, r.ar_date_of_agm) ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} isManual={!!r.manual_fields?.[c.field]} />
                            <span
                              title={`⚠ AGM date mismatch — TeamWork's latest Held Date is "${r.last_agm_date}", AR Reminder's AGM column shows "${r.ar_date_of_agm}". Please verify which is correct.`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '0 4px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0 }}>
                              <AlertTriangle size={10} />AR:{String(r.ar_date_of_agm).slice(0, 10)}
                            </span>
                          </div>
                        ) : c.field === 'last_ar_date' && dateMismatch(r.last_ar_date, r.ar_filling_date) ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                            <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} isManual={!!r.manual_fields?.[c.field]} />
                            <span
                              title={`⚠ AR filing date mismatch — TeamWork's latest Filing Date is "${r.last_ar_date}", AR Reminder's AR column shows "${r.ar_filling_date}". Please verify which is correct.`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 2, background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 4, padding: '0 4px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0 }}>
                              <AlertTriangle size={10} />AR:{String(r.ar_filling_date).slice(0, 10)}
                            </span>
                          </div>
                        ) : (
                          <EditCell id={r.id} field={c.field} value={r[c.field]} onSave={handleSave} isManual={!!r.manual_fields?.[c.field]} />
                        )}
                      </td>
                    );
                  })}
                  <td style={{ padding: '3px 6px', textAlign: 'center', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' }}>
                    <button onClick={() => setSelectedRowId(r.id)} title="View details & edit history"
                      style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer', display: 'inline-flex', marginRight: 4 }}>
                      <History size={11} />
                    </button>
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
          moveTargets={moveTargets}
          onMove={moveRow}
          onDelete={deleteRow}
        />
      )}
    </div>
  );
}
