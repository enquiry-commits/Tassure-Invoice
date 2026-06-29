'use client';

import { Suspense, useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  RefreshCw, ChevronDown, ChevronRight,
  AlertTriangle, Clock, CheckCircle2, FileText, Calendar,
  ShieldCheck, MapPin, UserCheck, BarChart3, BookOpen, DollarSign,
} from 'lucide-react';
import type { RenewalStatus, AnnualStatus, CompanyBilling } from '@/app/api/billing/renewals/route';

// ─────────────────────────────────────────────────────────────────────────────
// Shared types & helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtMonth(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
}
function fmtPeriod(start: string | null, end: string | null) {
  if (!start || !end) return '—';
  return `${fmtMonth(start)} – ${fmtMonth(end)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BILLING TAB — types & components
// ─────────────────────────────────────────────────────────────────────────────
interface BillingSummary { total: number; expired: number; expiringSoon: number; active: number; withinDays: number; }

const SVC_CONFIG = {
  Secretary: { label: 'Secretary',    short: 'SEC',  bg: '#f5f3ff', color: '#6d28d9', Icon: BookOpen   },
  Address:   { label: 'Reg. Address', short: 'ADDR', bg: '#f0fdf4', color: '#15803d', Icon: MapPin     },
  ND:        { label: 'Nominee Dir.', short: 'ND',   bg: '#dcfce7', color: '#166534', Icon: UserCheck  },
  AR:        { label: 'AR / AGM',     short: 'AR',   bg: '#fff7ed', color: '#c2410c', Icon: BarChart3  },
  XBRL:      { label: 'XBRL',         short: 'XBRL', bg: '#fdf4ff', color: '#7e22ce', Icon: ShieldCheck },
};

function RenewalCard({ r }: { r: RenewalStatus }) {
  const cfg = SVC_CONFIG[r.service];
  const statusColor = r.status === 'expired' ? '#dc2626' : r.status === 'expiring_soon' ? '#ea580c' : r.status === 'active' ? '#16a34a' : '#9ca3af';
  const statusBg    = r.status === 'expired' ? '#fef2f2' : r.status === 'expiring_soon' ? '#fff7ed' : r.status === 'active' ? '#f0fdf4' : '#f9fafb';
  const statusLabel = r.status === 'expired' ? 'EXPIRED' : r.status === 'expiring_soon' ? `${r.daysUntilExpiry}d left` : r.status === 'active' ? 'ACTIVE' : 'NO DATA';

  if (!r.applicable) return (
    <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#f8fafc', flex: '1 1 180px', minWidth: 180, opacity: 0.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <cfg.Icon size={12} color={cfg.color} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{cfg.label}</span>
      </div>
      <span style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }}>Not applicable</span>
    </div>
  );

  return (
    <div style={{ border: `1.5px solid ${cfg.color}30`, borderRadius: 10, padding: '14px 15px', background: '#fff', flex: '1 1 180px', minWidth: 180 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <cfg.Icon size={12} color={cfg.color} />
          <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 700 }}>{cfg.label}</span>
        </div>
        <span style={{ background: statusBg, color: statusColor, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>{statusLabel}</span>
      </div>
      {r.lastPeriodEnd ? (
        <>
          <div style={{ marginBottom: 7 }}>
            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 1 }}>Current Period Ends</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: statusColor }}>{fmtDate(r.lastPeriodEnd)}</div>
          </div>
          <div style={{ marginBottom: 7 }}>
            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 2 }}>Suggested Renewal</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#1e3a5f', background: '#f0f6ff', borderRadius: 5, padding: '2px 7px', display: 'inline-block' }}>
              {fmtPeriod(r.suggestedPeriodStart, r.suggestedPeriodEnd)}
            </div>
          </div>
          {r.lastRate != null && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 1 }}>Last Rate</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#1e3a5f' }}>S${r.lastRate.toLocaleString()}</div>
            </div>
          )}
          {r.history.length > 0 && (
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 7 }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Billing History</div>
              {r.history.map((h, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10, color: '#64748b' }}>
                  <span>{fmtPeriod(h.period_start, h.period_end)}</span>
                  <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{h.invoice_no}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No QB invoice found.</p>
      )}
    </div>
  );
}

function AnnualCard({ a }: { a: AnnualStatus }) {
  const cfg = SVC_CONFIG[a.service];
  const statusColor = a.status === 'billed' ? '#16a34a' : a.status === 'pending' ? '#ea580c' : '#9ca3af';
  const statusBg    = a.status === 'billed' ? '#f0fdf4' : a.status === 'pending' ? '#fff7ed' : '#f9fafb';
  const statusLabel = a.status === 'billed' ? 'BILLED' : a.status === 'pending' ? 'PENDING' : 'NOT FOUND';

  if (!a.applicable) return (
    <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#f8fafc', flex: '1 1 150px', minWidth: 150, opacity: 0.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <cfg.Icon size={12} color={cfg.color} />
        <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8' }}>{cfg.label}</span>
      </div>
      <span style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }}>Not applicable</span>
    </div>
  );

  return (
    <div style={{ border: `1.5px solid ${cfg.color}30`, borderRadius: 10, padding: '14px 15px', background: '#fff', flex: '1 1 150px', minWidth: 150 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <cfg.Icon size={12} color={cfg.color} />
          <span style={{ background: cfg.bg, color: cfg.color, borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 700 }}>{cfg.label}</span>
        </div>
        <span style={{ background: statusBg, color: statusColor, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>{statusLabel}</span>
      </div>
      {a.lastTxnDate ? (
        <>
          <div style={{ marginBottom: 7 }}>
            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 1 }}>Last Billed</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f' }}>{fmtDate(a.lastTxnDate)}</div>
          </div>
          {a.lastFyeDate && (
            <div style={{ marginBottom: 7 }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 1 }}>FYE</div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{fmtDate(a.lastFyeDate)}</div>
            </div>
          )}
          {a.lastAmount != null && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 1 }}>Last Amount</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#1e3a5f' }}>S${a.lastAmount.toLocaleString()}</div>
            </div>
          )}
          {a.history.length > 0 && (
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 7 }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>History</div>
              {a.history.map((h, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0', fontSize: 10, color: '#64748b' }}>
                  <span>{fmtDate(h.txn_date)}</span>
                  <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{h.invoice_no}</span>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No QB billing found.</p>
      )}
    </div>
  );
}

function ServiceMini({ label, status, applicable }: { label: string; status: string; applicable: boolean }) {
  if (!applicable) return (
    <span style={{ fontSize: 9, fontWeight: 700, color: '#cbd5e1', background: '#f1f5f9', borderRadius: 3, padding: '1px 4px' }}>{label}</span>
  );
  const color = status === 'expired' || status === 'pending' ? '#dc2626' : status === 'expiring_soon' ? '#ea580c' : status === 'active' || status === 'billed' ? '#16a34a' : '#94a3b8';
  const bg    = status === 'expired' || status === 'pending' ? '#fef2f2' : status === 'expiring_soon' ? '#fff7ed' : status === 'active' || status === 'billed' ? '#f0fdf4' : '#f8fafc';
  const dot   = status === 'expired' || status === 'pending' ? '✕' : status === 'expiring_soon' ? '!' : status === 'active' || status === 'billed' ? '✓' : '—';
  return <span style={{ fontSize: 9, fontWeight: 700, color, background: bg, borderRadius: 3, padding: '1px 4px' }}>{label} {dot}</span>;
}

// ─────────────────────────────────────────────────────────────────────────────
// AR TAB — types & components
// ─────────────────────────────────────────────────────────────────────────────
interface Services { ar: boolean; agm: boolean; xbrl: boolean; nd: boolean; address: boolean; accounts: boolean; tax: boolean; secretary: boolean; }
interface Stages { accountsReady: boolean; sentToClient: boolean; docsReceived: boolean; agmHeld: boolean; arFiled: boolean; }
interface Invoice { invoice_no: string; txn_date: string; total_amt: number; status: string; }
interface PeriodInfo { periodEnd: string | null; periodStart: string | null; rate: number | null; invoiceNo: string | null; ndName?: string | null; }
interface ServicePeriods { secretary: PeriodInfo | null; address: PeriodInfo | null; nd: PeriodInfo | null; }
interface ARRecord {
  id: number; entity_name: string; uen: string;
  fye_date: string | null; due_date: string | null; daysUntilDue: number | null;
  pic: string | null; acc_pic: string | null; tax_pic: string | null;
  prepared_date: string | null; sent_date: string | null; received_date: string | null;
  date_of_agm: string | null; agm_held_date: string | null; filling_date: string | null;
  ar_status: string | null; xbrl: string | null; software_update: string | null;
  dpo: string | null; ond_ron: string | null; dormant: string | null;
  accounts_status: string | null; fin_stmt_status: string | null;
  audited_fs: string | null; agm_documents: string | null;
  remarks: string | null; reminder_note: string | null;
  services: Services; stages: Stages; stagesDone: number; invoices: Invoice[];
  servicePeriods: ServicePeriods | null;
}

const SVC: Record<string, { label: string; bg: string; color: string }> = {
  ar:        { label: 'Annual Return', bg: '#dbeafe', color: '#1d4ed8' },
  agm:       { label: 'AGM',           bg: '#e0e7ff', color: '#4338ca' },
  xbrl:      { label: 'XBRL',          bg: '#fce7f3', color: '#be185d' },
  nd:        { label: 'Nominee Dir.',  bg: '#dcfce7', color: '#15803d' },
  address:   { label: 'Reg. Address',  bg: '#f0fdf4', color: '#166534' },
  accounts:  { label: 'Accounts',      bg: '#fef9c3', color: '#92400e' },
  tax:       { label: 'Tax Filing',    bg: '#ffedd5', color: '#c2410c' },
  secretary: { label: 'Secretary',     bg: '#f5f3ff', color: '#6d28d9' },
};

const FYE_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const STAGE_LABELS = ['Accounts\nReady','Sent to\nClient','Docs\nReceived','AGM\nHeld','AR\nFiled'];

function EditField({ id, field, value, onSave, placeholder = '—', isDate = false }:
  { id: number; field: string; value: string | null; onSave: (id: number, field: string, val: string) => void; placeholder?: string; isDate?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef  = useRef<HTMLInputElement>(null);
  useEffect(() => { setVal(value ?? ''); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  const save = useCallback(async () => {
    setEditing(false);
    const next = val.trim();
    if (next === (value ?? '').trim()) return;
    try {
      await fetch('/api/ar-reminder', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: next || null }) });
      onSave(id, field, next);
    } catch (_) {}
  }, [id, field, val, value, onSave]);

  const handleDatePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    const d = new Date(e.target.value + 'T00:00:00');
    setVal(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    e.target.value = '';
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const formatDisplay = (v: string) => {
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) {
      const d = new Date(v + 'T00:00:00');
      if (!isNaN(d.getTime())) return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    }
    return v;
  };

  if (editing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input ref={inputRef} type="text" value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={e => { if (!(e.relatedTarget as HTMLElement | null)?.dataset?.calBtn) save(); }}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setVal(value ?? ''); setEditing(false); } }}
        placeholder={isDate ? 'e.g. 05 Jul 2026' : ''}
        style={{ flex: 1, border: '1.5px solid #2563eb', borderRadius: 4, padding: '2px 6px', fontSize: 12, outline: 'none', background: '#eff6ff', minWidth: 0 }}
      />
      {isDate && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button data-cal-btn="1" tabIndex={0}
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

  const display = (value ?? '').trim();
  return (
    <div onClick={() => setEditing(true)} title="点击编辑" style={{ cursor: 'text', minHeight: 24, display: 'flex', alignItems: 'center', borderRadius: 3, padding: '1px 3px' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      {display
        ? isDate
          ? <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>{formatDisplay(display)}</span>
          : <span style={{ fontSize: 12, color: '#374151' }}>{display}</span>
        : <span style={{ color: '#d1d5db', fontSize: 11 }}>{placeholder}</span>}
    </div>
  );
}

type SelectOption = { label: string; bg: string; color: string; type?: 'date' };

// Unified chip palette
const C = {
  green:  { bg: '#dcfce7', color: '#15803d' },
  blue:   { bg: '#dbeafe', color: '#1d4ed8' },
  amber:  { bg: '#fef3c7', color: '#b45309' },
  purple: { bg: '#ede9fe', color: '#6d28d9' },
  red:    { bg: '#fee2e2', color: '#b91c1c' },
};

const ROND_OPTIONS: SelectOption[] = [
  { label: 'DONE',         ...C.green  },
  { label: 'FILED',        ...C.blue   },
  { label: 'ACRA DONE',    ...C.blue   },
  { label: 'SENT & FILED', ...C.purple },
];

const DPO_OPTIONS: SelectOption[] = [
  { label: 'YES',    ...C.green  },
  { label: 'INFORM', ...C.blue   },
  { label: 'DONE',   ...C.green  },
  { label: 'CLIENT', ...C.purple },
];

const XBRL_OPTIONS: SelectOption[] = [
  { label: '日期', ...C.green, type: 'date' },
  { label: 'NO',   ...C.red   },
  { label: 'FULL', ...C.green },
];

function SelectField({ id, field, value, onSave, options }: {
  id: number; field: string; value: string | null;
  onSave: (id: number, field: string, val: string) => void;
  options: SelectOption[];
}) {
  const [open,   setOpen]   = useState(false);
  const [custom, setCustom] = useState(false);
  const [val,    setVal]    = useState(value ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef  = useRef<HTMLInputElement>(null);
  const wrapRef  = useRef<HTMLDivElement>(null);
  useEffect(() => { setVal(value ?? ''); }, [value]);
  useEffect(() => { if (custom) inputRef.current?.focus(); }, [custom]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const commit = useCallback(async (next: string) => {
    setCustom(false); setOpen(false);
    const trimmed = next.trim();
    if (trimmed === (value ?? '').trim()) return;
    try {
      await fetch('/api/ar-reminder', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: trimmed || null }) });
      onSave(id, field, trimmed);
    } catch (_) {}
  }, [id, field, value, onSave]);

  const handleDatePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    const d = new Date(e.target.value + 'T00:00:00');
    setVal(d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }));
    e.target.value = '';
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const display = (value ?? '').trim();
  const chip = display ? options.find(o => o.label === display && !o.type) : null;
  const isDateValue = /^\d{4}-\d{2}-\d{2}$/.test(display);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {custom ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input ref={inputRef} type="text" value={val}
            onChange={e => setVal(e.target.value)}
            onBlur={e => { if (!(e.relatedTarget as HTMLElement | null)?.dataset?.calBtn) commit(val); }}
            onKeyDown={e => { if (e.key === 'Enter') commit(val); if (e.key === 'Escape') { setVal(value ?? ''); setCustom(false); } }}
            placeholder="e.g. 05 Jul 2026"
            style={{ flex: 1, border: '1.5px solid #2563eb', borderRadius: 4, padding: '2px 6px', fontSize: 12, outline: 'none', background: '#eff6ff', minWidth: 0 }}
          />
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <button data-cal-btn="1" tabIndex={0}
              onMouseDown={e => { e.preventDefault(); dateRef.current?.showPicker?.(); }}
              style={{ border: '1px solid #c7d2fe', borderRadius: 4, background: '#eef2ff', color: '#4338ca', cursor: 'pointer', padding: '2px 5px', display: 'flex', alignItems: 'center' }}>
              <Calendar size={12} />
            </button>
            <input ref={dateRef} type="date" onChange={handleDatePick}
              style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0, top: 0, left: 0 }} />
          </div>
        </div>
      ) : (
        <div onClick={() => setOpen(v => !v)} title="点击选择" style={{ cursor: 'pointer', minHeight: 24, display: 'flex', alignItems: 'center', gap: 4, borderRadius: 3, padding: '1px 3px' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
          {display
            ? isDateValue
              ? <span style={{ background: C.green.bg, color: C.green.color, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{new Date(display + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              : chip
                ? <span style={{ background: chip.bg, color: chip.color, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{display}</span>
                : <span style={{ fontSize: 12, color: '#374151' }}>{display}</span>
            : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>}
          <svg width="10" height="10" viewBox="0 0 10 10" style={{ color: '#9ca3af', flexShrink: 0 }}><path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round"/></svg>
        </div>
      )}
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 160, overflow: 'hidden', marginTop: 2 }}>
          {options.filter(o => !o.type).map(opt => (
            <div key={opt.label}
              onClick={() => commit(opt.label)}
              style={{ padding: '7px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}>
              <span style={{ background: opt.bg, color: opt.color, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{opt.label}</span>
            </div>
          ))}
          {display && (
            <div onClick={() => commit('')}
              style={{ padding: '7px 12px', cursor: 'pointer', borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#ef4444' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#fef2f2'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}>
              清除
            </div>
          )}
          <div onClick={() => { setOpen(false); setVal(value ?? ''); setCustom(true); }}
            style={{ padding: '7px 12px', cursor: 'pointer', borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}>
            <Calendar size={11} style={{ color: '#4338ca' }} /> 日期 / 自行填写…
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowBar({ stages, compact = false }: { stages: Stages; compact?: boolean }) {
  const vals = [stages.accountsReady, stages.sentToClient, stages.docsReceived, stages.agmHeld, stages.arFiled];
  const done = vals.filter(Boolean).length;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: compact ? 2 : 4 }}>
      {vals.map((v, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
          <div title={STAGE_LABELS[i].replace('\n',' ')} style={{
            width: compact ? 18 : 22, height: compact ? 18 : 22, borderRadius: '50%',
            background: v ? '#16a34a' : i === done ? '#f59e0b' : '#e2e8f0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: compact ? 8 : 9, fontWeight: 700,
            color: v ? '#fff' : i === done ? '#fff' : '#9ca3af', flexShrink: 0,
          }}>{v ? '✓' : i + 1}</div>
          {compact && i < 4 && <div style={{ width: 6, height: 1, background: v ? '#16a34a' : '#e2e8f0', margin: '0 1px' }} />}
          {!compact && i < 4 && <div style={{ width: 12, height: 2, background: v ? '#16a34a' : '#e2e8f0' }} />}
        </div>
      ))}
      {!compact && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4 }}>{done}/5</span>}
    </div>
  );
}

function DueBadge({ days, filed }: { days: number | null; filed: boolean }) {
  if (filed) return <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>Filed ✓</span>;
  if (days === null) return <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>;
  const bg    = days < 0 ? '#fef2f2' : days < 30 ? '#fff7ed' : days < 90 ? '#fefce8' : '#f0fdf4';
  const color = days < 0 ? '#dc2626' : days < 30 ? '#ea580c' : days < 90 ? '#ca8a04' : '#16a34a';
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d left`;
  return <span style={{ background: bg, color, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{label}</span>;
}

// ── Service Periods list with ND name reveal ──────────────────────────────────
function ServicePeriodList({ servicePeriods, ndStrikeOff = false, ndPending = false, onNdFlag }: {
  servicePeriods: ServicePeriods | null;
  ndStrikeOff?: boolean;
  ndPending?: boolean;
  onNdFlag?: (field: 'dormant' | 'agm_documents', value: string) => void;
}) {
  const [ndRevealed, setNdRevealed] = useState(false);
  const today = new Date();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 4 }}>
      {(['secretary', 'address', 'nd'] as const).map(svc => {
        const info  = servicePeriods?.[svc];
        const label = svc === 'secretary' ? 'Secretary' : svc === 'address' ? 'Reg. Address' : 'Nominee Dir.';
        const end   = info?.periodEnd ? new Date(info.periodEnd) : null;
        const days  = end ? Math.ceil((end.getTime() - today.getTime()) / 86400000) : null;
        const st    = !end ? 'none' : days! < 0 ? 'expired' : days! <= 90 ? 'expiring' : 'active';
        const clr   = ({ none: { bg: '#f1f5f9', text: '#94a3b8' }, expired: { bg: '#fee2e2', text: '#dc2626' }, expiring: { bg: '#fef9c3', text: '#d97706' }, active: { bg: '#dcfce7', text: '#16a34a' } })[st];
        const isND  = svc === 'nd';
        const hasNdName = isND && info?.ndName;

        return (
          <div key={svc}>
            <div
              onClick={() => { if (isND && end) setNdRevealed(v => !v); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '5px 8px', borderRadius: ndRevealed && isND ? '5px 5px 0 0' : 5,
                background: clr.bg,
                cursor: isND && end ? 'pointer' : 'default',
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{label}</span>
                {isND && end && (
                  <span style={{ fontSize: 9, color: clr.text, opacity: 0.7 }}>
                    {ndRevealed ? '▲' : '▼'}
                  </span>
                )}
              </div>
              {end ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {info?.rate && <span style={{ fontSize: 10, color: '#64748b' }}>S${info.rate.toLocaleString()}</span>}
                  {(() => {
                    const startDate = info?.periodStart
                      ? new Date(info.periodStart)
                      : (() => { const d = new Date(end!); d.setFullYear(d.getFullYear() - 1); d.setDate(d.getDate() + 1); return d; })();
                    return (
                      <span style={{ fontSize: 11, fontWeight: 600, color: clr.text }}>
                        {startDate.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' })}
                        {' – '}
                        {end.toLocaleDateString('en-SG', { month: 'short', year: 'numeric' })}
                      </span>
                    );
                  })()}
                </div>
              ) : info?.rate ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#64748b' }}>S${info.rate.toLocaleString()}</span>
                  <span style={{ fontSize: 10, color: '#f59e0b', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: 3, padding: '1px 5px', fontWeight: 600 }}>no period</span>
                </div>
              ) : <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>}
            </div>

            {/* ND name reveal panel */}
            {isND && ndRevealed && (
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderTop: 'none', borderRadius: ndStrikeOff || ndPending ? '0' : '0 0 5px 5px', padding: '7px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <UserCheck size={13} color="#16a34a" />
                {hasNdName
                  ? <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d' }}>{info!.ndName}</span>
                  : <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>No director name found in TeamWork</span>
                }
              </div>
            )}

            {/* ND special flags — always visible when ND is applicable */}
            {isND && onNdFlag && (
              <div style={{
                display: 'flex', gap: 6, padding: '5px 8px',
                background: (ndStrikeOff || ndPending) ? '#fffbeb' : '#f8fafc',
                border: '1px solid #e2e8f0', borderTop: 'none',
                borderRadius: ndRevealed ? '0 0 5px 5px' : (ndStrikeOff || ndPending) ? '0 0 5px 5px' : '0 0 5px 5px',
              }}>
                {/* Strike Off toggle */}
                <button
                  onClick={() => onNdFlag('dormant', ndStrikeOff ? '' : 'STRIKE_OFF')}
                  title="Mark client as pending strike-off — Finance will be notified to review ND billing"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 7px', border: 'none',
                    background: ndStrikeOff ? '#fee2e2' : '#f1f5f9',
                    color:      ndStrikeOff ? '#b91c1c' : '#94a3b8',
                  }}
                  onMouseEnter={e => { if (!ndStrikeOff) (e.currentTarget as HTMLElement).style.background = '#ffe4e6'; }}
                  onMouseLeave={e => { if (!ndStrikeOff) (e.currentTarget as HTMLElement).style.background = '#f1f5f9'; }}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  Strike Off
                  {ndStrikeOff && <span style={{ fontSize: 9, fontWeight: 400, marginLeft: 2 }}>● Active</span>}
                </button>

                {/* ND Pending toggle */}
                <button
                  onClick={() => onNdFlag('agm_documents', ndPending ? '' : 'ND_PENDING')}
                  title="ND service requested but director not yet assigned"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer',
                    fontSize: 10, fontWeight: 700, borderRadius: 4, padding: '2px 7px', border: 'none',
                    background: ndPending ? '#fef3c7' : '#f1f5f9',
                    color:      ndPending ? '#b45309' : '#94a3b8',
                  }}
                  onMouseEnter={e => { if (!ndPending) (e.currentTarget as HTMLElement).style.background = '#fef9c3'; }}
                  onMouseLeave={e => { if (!ndPending) (e.currentTarget as HTMLElement).style.background = '#f1f5f9'; }}
                >
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  ND Pending
                  {ndPending && <span style={{ fontSize: 9, fontWeight: 400, marginLeft: 2 }}>● Active</span>}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function DetailPanel({ r, onSave }: { r: ARRecord; onSave: (id: number, field: string, val: string) => void }) {
  const activeServices = Object.entries(r.services).filter(([, v]) => v).map(([k]) => k);

  return (
    <div style={{ padding: '20px 24px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>

        {/* Col 1: Progress dates + Compliance checklist */}
        <div>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Progress</h4>
          {([
            { label: 'Reminder',      field: 'reminder_note', isDate: false },
            { label: 'Report Ready',  field: 'prepared_date', isDate: true  },
            { label: 'To Client',     field: 'sent_date',     isDate: true  },
            { label: 'Signed / Rcvd', field: 'received_date', isDate: true  },
            { label: 'AGM Date',      field: 'date_of_agm',   isDate: true  },
            { label: 'AR Filed',      field: 'filling_date',  isDate: true  },
          ] as const).map(({ label, field, isDate }) => (
            <div key={field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110 }}>{label}</span>
              <div style={{ flex: 1 }}>
                <EditField id={r.id} field={field} value={(r as unknown as Record<string, string | null>)[field]} onSave={onSave} placeholder="—" isDate={isDate} />
              </div>
            </div>
          ))}

          <h4 style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, marginTop: 16 }}>Compliance</h4>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110 }}>XBRL</span>
            <div style={{ flex: 1 }}>
              <SelectField id={r.id} field="xbrl" value={r.xbrl} onSave={onSave} options={XBRL_OPTIONS} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110 }}>Software Update</span>
            <div style={{ flex: 1 }}>
              <EditField id={r.id} field="software_update" value={r.software_update} onSave={onSave} placeholder="—" isDate />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110 }}>DPO</span>
            <div style={{ flex: 1 }}>
              <SelectField id={r.id} field="dpo" value={r.dpo} onSave={onSave} options={DPO_OPTIONS} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110 }}>ROND RONS</span>
            <div style={{ flex: 1 }}>
              <SelectField id={r.id} field="ond_ron" value={r.ond_ron} onSave={onSave} options={ROND_OPTIONS} />
            </div>
          </div>

        </div>

        {/* Col 2: Team + Service Periods + QB + Notes */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px' }}>
          <h4 style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Team</h4>
          {([
            { label: 'SEC PIC', field: 'pic'     },
            { label: 'ACC PIC', field: 'acc_pic' },
            { label: 'TAX PIC', field: 'tax_pic' },
          ] as const).map(({ label, field }) => (
            <div key={field} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, padding: '4px 8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 70 }}>{label}</span>
              <div style={{ flex: 1 }}>
                <EditField id={r.id} field={field} value={(r as unknown as Record<string, string | null>)[field]} onSave={onSave} placeholder="—" />
              </div>
            </div>
          ))}

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 16 }}>
            <h4 style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>Service Periods</h4>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 3, padding: '1px 5px', letterSpacing: '0.3px', display: 'flex', alignItems: 'center', gap: 3 }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              AUTO
            </span>
          </div>
          <ServicePeriodList
            servicePeriods={r.servicePeriods}
            ndStrikeOff={r.dormant === 'STRIKE_OFF'}
            ndPending={r.agm_documents === 'ND_PENDING'}
            onNdFlag={async (field, value) => {
              await fetch('/api/ar-reminder', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, field, value: value || null }) });
              onSave(r.id, field, value);
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, marginTop: 14 }}>
            <h4 style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>QB Invoices ({r.invoices.length})</h4>
            <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 3, padding: '1px 5px', letterSpacing: '0.3px', display: 'flex', alignItems: 'center', gap: 3 }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              AUTO
            </span>
          </div>
          {r.invoices.length === 0
            ? <p style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>No invoices found in QuickBooks</p>
            : (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
                {r.invoices.slice(0, 5).map((inv, i) => (
                  <div key={inv.invoice_no} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 10px', background: i % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: i < r.invoices.length - 1 ? '1px solid #f1f5f9' : 'none' }}>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#475569' }}>{inv.invoice_no}</span>
                    <span style={{ fontSize: 10, color: '#64748b' }}>{inv.txn_date}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#1e3a5f' }}>S${(inv.total_amt ?? 0).toLocaleString()}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 3, padding: '1px 5px',
                      background: inv.status === 'Paid' ? '#dcfce7' : inv.status === 'Overdue' ? '#fef2f2' : '#fef9c3',
                      color:      inv.status === 'Paid' ? '#15803d' : inv.status === 'Overdue' ? '#dc2626' : '#92400e',
                    }}>{inv.status}</span>
                  </div>
                ))}
                {r.invoices.length > 5 && <div style={{ fontSize: 10, color: '#94a3b8', textAlign: 'center', padding: 4 }}>+{r.invoices.length - 5} more</div>}
              </div>
            )}

        </div>

      </div>

      {/* Notes section */}
      <div style={{ marginTop: 16, borderTop: '2px solid #e2e8f0', paddingTop: 14 }}>
        <h4 style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Notes</h4>
        <div style={{ background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0', padding: '8px 12px' }}>
          <EditField id={r.id} field="remarks" value={r.remarks} onSave={onSave} placeholder="Add remarks…" />
        </div>
      </div>

      {/* Finance section */}
      <div style={{ marginTop: 20, borderTop: '2px solid #e2e8f0', paddingTop: 16 }}>
        <h4 style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
          Finance
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div style={{ background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0', padding: '8px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Invoice</div>
            <EditField id={r.id} field="ar_status" value={r.ar_status} onSave={onSave} placeholder="Invoice no. / notes…" />
          </div>
          <div style={{ background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0', padding: '8px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Email Sent</div>
            <EditField id={r.id} field="accounts_status" value={r.accounts_status} onSave={onSave} placeholder="e.g. 12/5 email" />
          </div>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BILLING TAB
// ─────────────────────────────────────────────────────────────────────────────
function BillingTab() {
  const [data,       setData]       = useState<{ summary: BillingSummary; companies: CompanyBilling[] } | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [expanded,   setExpanded]   = useState<number | null>(null);
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState<'all' | 'expired' | 'expiring_soon' | 'active'>('all');
  const [withinDays, setWithinDays] = useState(90);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/billing/renewals?within=${withinDays}`);
      const json = await res.json();
      if (json.error) { setError(json.error); return; }
      setData(json);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Network error'); }
    finally { setLoading(false); }
  }, [withinDays]);

  useEffect(() => { load(); }, [load]);

  const filtered = (data?.companies ?? []).filter(c => {
    if (search && !c.companyName.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter !== 'all' && c.urgency !== filter) return false;
    return true;
  });

  const S: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13, background: '#fff', outline: 'none', color: '#1e3a5f' };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 14 }}>
        <select value={withinDays} onChange={e => setWithinDays(+e.target.value)} style={S}>
          <option value={30}>到期预警 30d</option>
          <option value={60}>到期预警 60d</option>
          <option value={90}>到期预警 90d</option>
          <option value={180}>到期预警 180d</option>
        </select>
        <button onClick={load} disabled={loading} style={{ ...S, background: '#1d3a5c', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {loading ? '加载中…' : '刷新'}
        </button>
      </div>

      {/* Stats */}
      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
          {([
            { label: 'Active',                    value: data.summary.active,       bg: '#f0fdf4', color: '#16a34a', Icon: CheckCircle2 },
            { label: `Expiring ≤${withinDays}d`,  value: data.summary.expiringSoon, bg: '#fff7ed', color: '#ea580c', Icon: Clock        },
            { label: 'Already Expired',           value: data.summary.expired,      bg: '#fef2f2', color: '#dc2626', Icon: AlertTriangle },
            { label: 'Total CSS Clients',         value: data.summary.total,        bg: '#f8fafc', color: '#1d3a5c', Icon: FileText      },
          ] as const).map(({ label, value, bg, color, Icon }) => (
            <div key={label} style={{ background: bg, borderRadius: 10, border: '1px solid #e2e8f0', padding: '12px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}><Icon size={13} style={{ color }} /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>{label}</span></div>
              <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {/* Filter */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="text" placeholder="搜索公司名…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 13, outline: 'none' }} />
        {([
          { key: 'all',           label: `全部 (${data?.summary.total ?? 0})` },
          { key: 'expired',       label: `已过期 (${data?.summary.expired ?? 0})` },
          { key: 'expiring_soon', label: `即将到期 (${data?.summary.expiringSoon ?? 0})` },
          { key: 'active',        label: `正常 (${data?.summary.active ?? 0})` },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer', background: filter === key ? '#1d3a5c' : '#f1f5f9', color: filter === key ? '#fff' : '#475569', whiteSpace: 'nowrap' }}>{label}</button>
        ))}
        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{filtered.length} 家</span>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <DollarSign size={13} style={{ color: '#93c5fd' }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>BILLING DRAFTS</span>
          <span style={{ fontSize: 10, color: '#93c5fd', marginLeft: 8 }}>TeamWork Active · QB 历史 · ND Appointments · 人工审核后才生成发票</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '28px 2fr 70px 1fr 1fr 80px', padding: '6px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
          {['', 'Company', 'FYE', 'Renewal Services', 'Annual Obligations', 'PIC'].map((h, i) => (
            <div key={i} style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', padding: '0 6px' }}>{h}</div>
          ))}
        </div>
        <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
          {loading && !data && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>加载中…</div>}
          {!loading && filtered.length === 0 && data && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>没有符合条件的记录</div>}
          {filtered.map((c, i) => {
            const isOpen = expanded === c.companyId;
            const rowBg  = i % 2 === 0 ? '#fff' : '#fafbfc';
            const accent = c.urgency === 'expired' ? '#dc2626' : c.urgency === 'expiring_soon' ? '#f59e0b' : '#16a34a';
            const secR   = c.renewals.find(r => r.service === 'Secretary');
            const addrR  = c.renewals.find(r => r.service === 'Address');
            const ndR    = c.renewals.find(r => r.service === 'ND');
            const arA    = c.annuals.find(a => a.service === 'AR');
            const xbrlA  = c.annuals.find(a => a.service === 'XBRL');
            return (
              <div key={c.companyId}>
                <div onClick={() => setExpanded(isOpen ? null : c.companyId)}
                  style={{ display: 'grid', gridTemplateColumns: '28px 2fr 70px 1fr 1fr 80px', alignItems: 'center', padding: '9px 12px', background: isOpen ? '#f0f6ff' : rowBg, borderLeft: `3px solid ${accent}`, borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                  onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = '#f0f6ff'; }}
                  onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = rowBg; }}>
                  <div style={{ color: '#94a3b8' }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                  <div style={{ padding: '0 6px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f' }}><span style={{ color: '#cbd5e1', fontSize: 10, marginRight: 4 }}>{i+1}</span>{c.companyName}</div>
                    {c.uen && <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{c.uen}</div>}
                  </div>
                  <div style={{ padding: '0 6px', fontSize: 11, color: '#64748b' }}>{c.fyeMonth ?? '—'}</div>
                  <div style={{ padding: '0 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {secR  && <ServiceMini label="SEC"  status={secR.status}  applicable={secR.applicable}  />}
                    {addrR && <ServiceMini label="ADDR" status={addrR.status} applicable={addrR.applicable} />}
                    {ndR   && <ServiceMini label="ND"   status={ndR.status}   applicable={ndR.applicable}   />}
                  </div>
                  <div style={{ padding: '0 6px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {arA   && <ServiceMini label="AR"   status={arA.status}   applicable={arA.applicable}   />}
                    {xbrlA && <ServiceMini label="XBRL" status={xbrlA.status} applicable={xbrlA.applicable} />}
                  </div>
                  <div style={{ padding: '0 6px', fontSize: 11, color: '#374151' }}>{c.pic ?? '—'}</div>
                </div>
                {isOpen && (
                  <div style={{ padding: '16px 20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderBottom: '1px solid #e2e8f0' }}>
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>🔄 Renewal Services (annual subscription)</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{c.renewals.map(r => <RenewalCard key={r.service} r={r} />)}</div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>📋 Annual Obligations (per FYE cycle)</div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>{c.annuals.map(a => <AnnualCard key={a.service} a={a} />)}</div>
                    </div>
                    <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 8, fontSize: 11, color: '#94a3b8' }}>
                      ⚠ 续期发票须人工审核后才可发送 · 数据来源：QuickBooks 历史发票 + TeamWork Active 状态 + ND Appointments
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── AR Detail Modal ───────────────────────────────────────────────────────────
function ARDetailModal({ r, onSave, onClose }: { r: ARRecord; onSave: (id: number, field: string, val: string) => void; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const filed     = r.stages.arFiled;
  const accent    = filed ? '#16a34a' : r.stagesDone > 0 ? '#f59e0b' : '#94a3b8';
  const activeSvc = Object.entries(r.services).filter(([, v]) => v).map(([k]) => k);

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 920, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', borderLeft: `4px solid ${accent}`, padding: '16px 20px 14px', flexShrink: 0 }}>
          {/* Row 1: company name + close */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{r.entity_name}</div>
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 16 }}>✕</button>
          </div>
          {/* Row 2: UEN · FYE · due badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            {r.uen && <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#fff', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4 }}>{r.uen}</span>}
            {r.fye_date && (
              <>
                <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                <span style={{ fontSize: 11, color: '#fff' }}>FYE {r.fye_date}</span>
              </>
            )}
            <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
            <DueBadge days={r.daysUntilDue} filed={filed} />
          </div>
          {/* Row 3: service chips */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {activeSvc.map(k => { const c = SVC[k]; return <span key={k} style={{ background: c.bg, color: c.color, borderRadius: 4, padding: '2px 8px', fontSize: 10, fontWeight: 700 }}>{c.label}</span>; })}
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          <DetailPanel r={r} onSave={onSave} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AR TABLE VIEW
// ─────────────────────────────────────────────────────────────────────────────
function ARTableView({ records, onSave }: { records: ARRecord[]; onSave: (id: number, field: string, val: string) => void }) {
  // Finance columns get a teal header + tinted cell bg
  const FIN_HDR = '#0f766e';
  const FIN_CELL = 'rgba(20,184,166,0.06)';

  const outerRef  = useRef<HTMLDivElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const innerRef  = useRef<HTMLDivElement>(null);
  const [mirrorLeft,  setMirrorLeft]  = useState(0);
  const [mirrorWidth, setMirrorWidth] = useState(0);

  useEffect(() => {
    const outer  = outerRef.current;
    const mirror = mirrorRef.current;
    const inner  = innerRef.current;
    if (!outer || !mirror || !inner) return;

    const updatePos = () => {
      const rect = outer.getBoundingClientRect();
      setMirrorLeft(rect.left);
      setMirrorWidth(rect.width);
      const tbl = outer.querySelector('table') as HTMLElement | null;
      if (tbl) inner.style.width = tbl.offsetWidth + 'px';
    };

    const onOuterScroll  = () => { if (mirror.scrollLeft !== outer.scrollLeft)  mirror.scrollLeft = outer.scrollLeft;  };
    const onMirrorScroll = () => { if (outer.scrollLeft  !== mirror.scrollLeft) outer.scrollLeft  = mirror.scrollLeft; };

    outer.addEventListener('scroll',  onOuterScroll);
    mirror.addEventListener('scroll', onMirrorScroll);
    window.addEventListener('resize', updatePos);
    const ro = new ResizeObserver(updatePos);
    ro.observe(outer);
    updatePos();

    return () => {
      outer.removeEventListener('scroll',  onOuterScroll);
      mirror.removeEventListener('scroll', onMirrorScroll);
      window.removeEventListener('resize', updatePos);
      ro.disconnect();
    };
  }, []);

  const TH = ({ children, w, center, finance }: { children: React.ReactNode; w: number; center?: boolean; finance?: boolean }) => (
    <th style={{
      position: 'sticky', top: 0, zIndex: 2,
      background: finance ? FIN_HDR : '#1d3a5c', color: '#fff',
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
      padding: '7px 8px', whiteSpace: 'nowrap', minWidth: w, width: w,
      textAlign: center ? 'center' : 'left',
      borderRight: finance ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(255,255,255,0.12)',
    }}>{children}</th>
  );

  const TD = ({ children, style, finance }: { children: React.ReactNode; style?: React.CSSProperties; finance?: boolean }) => (
    <td style={{
      padding: '3px 6px', verticalAlign: 'top',
      borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9',
      background: finance ? FIN_CELL : undefined,
      wordBreak: 'break-word', overflowWrap: 'break-word',
      ...style,
    }}>{children}</td>
  );

  return (
    <>
    <div ref={outerRef} style={{ overflowX: 'auto', background: '#fff', borderRadius: '0 0 12px 12px', border: '1px solid #e2e8f0', borderTop: 'none', paddingBottom: 2 }}>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 'max-content', fontSize: 11 }}>
        <thead>
          <tr>
            <TH w={36} center>#</TH>
            <TH w={240}>Company Name</TH>
            <TH w={110}>UEN</TH>
            <TH w={120}>Reminder</TH>
            <TH w={120}>Report Ready</TH>
            <TH w={120}>AGM</TH>
            <TH w={120}>To Client</TH>
            <TH w={120}>Signed</TH>
            <TH w={120}>AR</TH>
            <TH w={110}>XBRL</TH>
            <TH w={120}>SW Update</TH>
            <TH w={110}>DPO</TH>
            <TH w={130}>ROND RONS</TH>
            <TH w={100}>SEC PIC</TH>
            <TH w={100}>ACC PIC</TH>
            <TH w={100}>TAX PIC</TH>
            <TH w={180}>Remarks</TH>
            <TH w={150} finance>Invoice</TH>
            <TH w={150} finance>Email Sent</TH>
          </tr>
        </thead>
        <tbody>
          {records.length === 0 && (
            <tr><td colSpan={19} style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>暂无记录</td></tr>
          )}
          {records.map((r, i) => {
            const filed   = r.stages.arFiled;
            const overdue = !filed && r.daysUntilDue !== null && r.daysUntilDue < 0;
            const inProg  = !filed && (r.stages.sentToClient || r.stages.docsReceived || r.stages.agmHeld);
            const rowBg   = filed ? '#f0fdf4' : overdue ? '#fff1f2' : inProg ? '#fffbeb' : i % 2 === 0 ? '#fff' : '#fafbfc';
            const accent  = filed ? '#16a34a' : overdue ? '#dc2626' : inProg ? '#f59e0b' : '#e2e8f0';
            return (
              <tr key={r.id} style={{ background: rowBg }}>
                <TD style={{ textAlign: 'center', color: '#94a3b8', fontSize: 10, fontWeight: 600, borderLeft: `3px solid ${accent}` }}>{i + 1}</TD>
                <TD>
                  <div style={{ fontWeight: 700, color: '#1e3a5f', lineHeight: 1.3 }}>{r.entity_name}</div>
                  {r.fye_date && <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 1 }}>FYE {r.fye_date}</div>}
                </TD>
                <TD><span style={{ fontFamily: 'monospace', fontSize: 10, color: '#64748b' }}>{r.uen || '—'}</span></TD>
                <TD><EditField id={r.id} field="reminder_note"   value={r.reminder_note}   onSave={onSave} placeholder="—" /></TD>
                <TD><EditField id={r.id} field="prepared_date"   value={r.prepared_date}   onSave={onSave} placeholder="—" isDate /></TD>
                <TD><EditField id={r.id} field="date_of_agm"     value={r.date_of_agm}     onSave={onSave} placeholder="—" isDate /></TD>
                <TD><EditField id={r.id} field="sent_date"       value={r.sent_date}       onSave={onSave} placeholder="—" isDate /></TD>
                <TD><EditField id={r.id} field="received_date"   value={r.received_date}   onSave={onSave} placeholder="—" isDate /></TD>
                <TD><EditField id={r.id} field="filling_date"    value={r.filling_date}    onSave={onSave} placeholder="—" isDate /></TD>
                <TD><SelectField id={r.id} field="xbrl"          value={r.xbrl}            onSave={onSave} options={XBRL_OPTIONS} /></TD>
                <TD><EditField id={r.id} field="software_update" value={r.software_update} onSave={onSave} placeholder="—" isDate /></TD>
                <TD><SelectField id={r.id} field="dpo"           value={r.dpo}             onSave={onSave} options={DPO_OPTIONS} /></TD>
                <TD><SelectField id={r.id} field="ond_ron"       value={r.ond_ron}         onSave={onSave} options={ROND_OPTIONS} /></TD>
                <TD><EditField id={r.id} field="pic"             value={r.pic}             onSave={onSave} placeholder="—" /></TD>
                <TD><EditField id={r.id} field="acc_pic"         value={r.acc_pic}         onSave={onSave} placeholder="—" /></TD>
                <TD><EditField id={r.id} field="tax_pic"         value={r.tax_pic}         onSave={onSave} placeholder="—" /></TD>
                <TD><EditField id={r.id} field="remarks"         value={r.remarks}         onSave={onSave} placeholder="—" /></TD>
                <TD finance><EditField id={r.id} field="ar_status"       value={r.ar_status}       onSave={onSave} placeholder="—" /></TD>
                <TD finance><EditField id={r.id} field="accounts_status" value={r.accounts_status} onSave={onSave} placeholder="e.g. 12/5 email" /></TD>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {/* Fixed mirror scrollbar — always visible at viewport bottom, synced with table scroll */}
    <div
      ref={mirrorRef}
      style={{
        position: 'fixed', bottom: 0, left: mirrorLeft, width: mirrorWidth,
        overflowX: 'auto', overflowY: 'hidden', height: 14,
        background: '#f1f5f9', borderTop: '1px solid #cbd5e1',
        zIndex: 50,
      }}
    >
      <div ref={innerRef} style={{ height: 1 }} />
    </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AR TAB
// ─────────────────────────────────────────────────────────────────────────────
function ARTab() {
  const [month,       setMonth]       = useState('April');
  const [year,        setYear]        = useState('2026');
  const [records,     setRecords]     = useState<ARRecord[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [modalRecord, setModalRecord] = useState<ARRecord | null>(null);
  const [search,      setSearch]      = useState('');
  const [filter,      setFilter]      = useState('all');
  const [view,        setView]        = useState<'list' | 'table'>('list');
  const [syncing,     setSyncing]     = useState(false);
  const [syncMsg,     setSyncMsg]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/ar-reminder?month=${month}&year=${year}`);
      const json = await res.json();
      if (json.error) { setError(json.error); return; }
      setRecords(json.companies ?? []);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Network error'); }
    finally { setLoading(false); }
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  const syncQB = useCallback(async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const res  = await fetch('/api/quickbooks/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year }) });
      const json = await res.json();
      if (json.error) { setSyncMsg(`QB error: ${json.error}`); return; }
      setSyncMsg(`✓ ${json.invoices_synced} invoices · ${json.items_synced} line items synced`);
      load();
    } catch (e: unknown) { setSyncMsg(e instanceof Error ? e.message : 'Sync failed'); }
    finally { setSyncing(false); }
  }, [year, load]);

  const handleSave = useCallback((id: number, field: string, value: string) => {
    const updated = (r: ARRecord) => r.id === id ? { ...r, [field]: value || null } : r;
    setRecords(prev => prev.map(updated));
    setModalRecord(prev => prev && prev.id === id ? { ...prev, [field]: value || null } : prev);
  }, []);

  const filtered = records.filter(r => {
    if (search && !r.entity_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'filed')       return r.stages.arFiled;
    if (filter === 'in_progress') return r.stagesDone > 0 && !r.stages.arFiled;
    if (filter === 'pending')     return r.stagesDone === 0;
    return true;
  });

  const stats = {
    total:      records.length,
    filed:      records.filter(r => r.stages.arFiled).length,
    inProgress: records.filter(r => r.stagesDone > 0 && !r.stages.arFiled).length,
    pending:    records.filter(r => r.stagesDone === 0).length,
    overdue:    records.filter(r => !r.stages.arFiled && r.daysUntilDue !== null && r.daysUntilDue < 0).length,
  };

  const S: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13, color: '#1e3a5f', background: '#fff', cursor: 'pointer', outline: 'none' };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 14 }}>
        <select value={month} onChange={e => setMonth(e.target.value)} style={S}>
          {FYE_MONTHS.map(m => <option key={m}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(e.target.value)} style={S}>
          {['2024','2025','2026','2027'].map(y => <option key={y}>{y}</option>)}
        </select>
        <button onClick={load} disabled={loading} style={{ ...S, display: 'flex', alignItems: 'center', gap: 6, background: '#1d3a5c', color: '#fff', border: 'none', fontWeight: 600 }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {loading ? '加载中…' : '刷新'}
        </button>
        <button onClick={syncQB} disabled={syncing || loading} style={{ ...S, display: 'flex', alignItems: 'center', gap: 6, background: syncing ? '#0f766e' : '#0f766e', color: '#fff', border: 'none', fontWeight: 600, opacity: syncing ? 0.75 : 1 }}>
          <RefreshCw size={13} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
          {syncing ? 'Syncing QB…' : 'Sync QB'}
        </button>
      </div>
      {syncMsg && (
        <div style={{ marginBottom: 10, padding: '6px 12px', borderRadius: 6, fontSize: 12, background: syncMsg.startsWith('✓') ? '#f0fdf4' : '#fef2f2', color: syncMsg.startsWith('✓') ? '#16a34a' : '#dc2626', border: `1px solid ${syncMsg.startsWith('✓') ? '#bbf7d0' : '#fecaca'}` }}>
          {syncMsg}
        </div>
      )}

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
        {[
          { label: 'Total Companies', value: stats.total,      bg: '#f8fafc', color: '#1d3a5c', Icon: FileText      },
          { label: 'AR Filed',        value: stats.filed,      bg: '#f0fdf4', color: '#16a34a', Icon: CheckCircle2  },
          { label: 'In Progress',     value: stats.inProgress, bg: '#fffbeb', color: '#b45309', Icon: Clock         },
          { label: 'Not Started',     value: stats.pending,    bg: '#f8fafc', color: '#64748b', Icon: Calendar      },
          { label: 'Overdue',         value: stats.overdue,    bg: '#fef2f2', color: '#dc2626', Icon: AlertTriangle },
        ].map(({ label, value, bg, color, Icon }) => (
          <div key={label} style={{ background: bg, borderRadius: 10, border: '1px solid #e2e8f0', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}><Icon size={13} style={{ color }} /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 600 }}>{label}</span></div>
            <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
          </div>
        ))}
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {/* Filter */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="text" placeholder="搜索公司名…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 13, outline: 'none' }} />
        {([
          { key: 'all',         label: `全部 (${stats.total})` },
          { key: 'filed',       label: `已申报 (${stats.filed})` },
          { key: 'in_progress', label: `进行中 (${stats.inProgress})` },
          { key: 'pending',     label: `未开始 (${stats.pending})` },
        ] as const).map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)} style={{ fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 7, border: 'none', background: filter === key ? '#1d3a5c' : '#f1f5f9', color: filter === key ? '#fff' : '#475569', cursor: 'pointer', whiteSpace: 'nowrap' }}>{label}</button>
        ))}
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{filtered.length} 家</span>
        {/* View toggle */}
        <div style={{ display: 'flex', gap: 3, marginLeft: 'auto', background: '#f1f5f9', borderRadius: 7, padding: 3 }}>
          {([{ k: 'list', icon: '☰', label: 'List' }, { k: 'table', icon: '⊞', label: 'Table' }] as const).map(({ k, icon, label }) => (
            <button key={k} onClick={() => setView(k)} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, background: view === k ? '#1d3a5c' : 'transparent', color: view === k ? '#fff' : '#64748b', transition: 'all 0.15s' }}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </div>
      </div>

      {/* List view */}
      {view === 'list' && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={13} style={{ color: '#93c5fd' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>FYE {month.toUpperCase()} {year}</span>
            <span style={{ fontSize: 10, color: '#93c5fd', marginLeft: 8 }}>Click row to open full details & edit</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '28px 2fr 100px 1fr 110px 80px', padding: '6px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            {['', 'Company Name', 'UEN', 'Services', 'Due Date', 'PIC'].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', padding: '0 6px' }}>{h}</div>
            ))}
          </div>
          <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
            {loading && records.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>加载中…</div>}
            {!loading && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>{records.length > 0 ? '没有符合条件的记录' : `FYE ${month} ${year} 暂无记录`}</div>}
            {filtered.map((r, i) => {
              const filed     = r.stages.arFiled;
              const accent    = filed ? '#16a34a' : r.stagesDone > 0 ? '#f59e0b' : '#e2e8f0';
              const rowBg     = i % 2 === 0 ? '#ffffff' : '#fafbfc';
              const activeSvc = Object.entries(r.services).filter(([, v]) => v).map(([k]) => k);
              return (
                <div key={r.id}
                  onClick={() => setModalRecord(r)}
                  style={{ display: 'grid', gridTemplateColumns: '28px 2fr 100px 1fr 110px 80px', alignItems: 'center', padding: '8px 12px', background: rowBg, borderLeft: `3px solid ${accent}`, borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = rowBg}
                >
                  <div style={{ color: '#94a3b8', display: 'flex', alignItems: 'center' }}><ChevronRight size={14} /></div>
                  <div style={{ padding: '0 6px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f', lineHeight: 1.3 }}><span style={{ color: '#cbd5e1', marginRight: 5, fontSize: 10 }}>{i+1}</span>{r.entity_name}</div>
                    {r.fye_date && <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 1 }}>FYE {r.fye_date}</div>}
                  </div>
                  <div style={{ padding: '0 6px', fontSize: 11, fontFamily: 'monospace', color: '#64748b' }}>{r.uen || <span style={{ color: '#e2e8f0' }}>—</span>}</div>
                  <div style={{ padding: '0 6px', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                    {activeSvc.map(k => { const c = SVC[k]; return <span key={k} style={{ background: c.bg, color: c.color, borderRadius: 3, padding: '1px 5px', fontSize: 9, fontWeight: 700 }}>{c.label}</span>; })}
                  </div>
                  <div style={{ padding: '0 6px' }}><DueBadge days={r.daysUntilDue} filed={r.stages.arFiled} /></div>
                  <div style={{ padding: '0 6px', fontSize: 11, color: '#374151', fontWeight: 500 }}>{r.pic || <span style={{ color: '#e2e8f0' }}>—</span>}</div>
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: '1px solid #f1f5f9', padding: '6px 16px', background: '#f8fafc' }}>
            <span style={{ fontSize: 11, color: '#cbd5e1' }}>Left border: green = AR filed · amber = in progress · grey = not started · Click any row to open details</span>
          </div>
        </div>
      )}

      {/* Table view */}
      {view === 'table' && (
        <>
          <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', borderRadius: '10px 10px 0 0', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={13} style={{ color: '#93c5fd' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>FYE {month.toUpperCase()} {year}</span>
            <span style={{ fontSize: 10, color: '#93c5fd', marginLeft: 8 }}>点击单元格直接编辑 · 数据与 List 视图实时同步</span>
          </div>
          {loading && records.length === 0
            ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>加载中…</div>
            : <ARTableView records={filtered} onSave={handleSave} />
          }
        </>
      )}

      {/* Modal */}
      {modalRecord && (
        <ARDetailModal
          r={modalRecord}
          onSave={handleSave}
          onClose={() => setModalRecord(null)}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMBINED PAGE — tab switcher
// ─────────────────────────────────────────────────────────────────────────────
function CombinedPage() {
  const searchParams = useSearchParams();
  const router       = useRouter();
  const tab          = (searchParams.get('tab') ?? 'billing') as 'billing' | 'ar';

  const switchTab = (t: 'billing' | 'ar') => {
    router.replace(`/billing${t === 'ar' ? '?tab=ar' : ''}`, { scroll: false });
  };

  return (
    <div>
      {/* Page header with tab switcher */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: '#1e3a5f', margin: 0, lineHeight: 1 }}>Client Services</h1>
            <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 4, marginBottom: 0 }}>Billing Drafts · AR Reminder · Secretary · ND · Address · XBRL</p>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginTop: 16, borderBottom: '2px solid #e2e8f0' }}>
          {([
            { key: 'billing', label: '💰 Billing Drafts',  desc: 'Renewals & annual obligations' },
            { key: 'ar',      label: '📋 AR Reminder',      desc: 'Annual Return filing tracker'  },
          ] as const).map(({ key, label, desc }) => {
            const active = tab === key;
            return (
              <button key={key} onClick={() => switchTab(key)} style={{
                padding: '10px 22px', border: 'none', cursor: 'pointer', background: 'transparent',
                borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
                marginBottom: -2,
                color: active ? '#2563eb' : '#64748b',
                fontWeight: active ? 700 : 500,
                fontSize: 13,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1,
              }}>
                <span>{label}</span>
                <span style={{ fontSize: 10, color: active ? '#93c5fd' : '#94a3b8', fontWeight: 400 }}>{desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'billing' ? <BillingTab /> : <ARTab />}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <CombinedPage />
    </Suspense>
  );
}
