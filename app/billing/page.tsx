'use client';

import { Suspense, useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  RefreshCw, ChevronDown, ChevronLeft, ChevronRight,
  AlertTriangle, Clock, CheckCircle2, FileText, Calendar,
  ShieldCheck, MapPin, UserCheck, BarChart3, BookOpen, DollarSign,
  Plus, Check, X, Trash2, History, RotateCcw,
} from 'lucide-react';
import type { RenewalStatus, AnnualStatus, CompanyBilling, GeneratedInvoice } from '@/app/api/billing/renewals/route';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { useIsMobile } from '@/lib/use-is-mobile';
import { fmtDate, fmtMonth, toDisplayDate, toIsoDateValue, todaySGT } from '@/lib/date';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { QB_ITEM, MEDIAN_RATE, QB_CATALOG, NAME_TO_INITIALS, secretaryDescription, addressDescription, arGovtFeeDescription, xbrlDescription, periodLabel, fyeDateString } from '@/lib/invoice-templates';

// ─────────────────────────────────────────────────────────────────────────────
// Shared types & helpers
// ─────────────────────────────────────────────────────────────────────────────
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
  Discount:  { label: 'Discount',     short: 'DISC', bg: '#fef2f2', color: '#dc2626', Icon: DollarSign },
  Accounts:  { label: 'Accounts',     short: 'ACCT', bg: '#eff6ff', color: '#1d4ed8', Icon: FileText   },
  Tax:       { label: 'Tax',          short: 'TAX',  bg: '#f0fdfa', color: '#0f766e', Icon: FileText   },
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
  if (!applicable) return <BillingStatusPill label={label} color="#94a3b8" background="#f8fafc" border="#e2e8f0" />;
  const color = status === 'expired' || status === 'pending' ? '#dc2626' : status === 'expiring_soon' ? '#ea580c' : status === 'active' || status === 'billed' ? '#16a34a' : '#94a3b8';
  const bg    = status === 'expired' || status === 'pending' ? '#fef2f2' : status === 'expiring_soon' ? '#fff7ed' : status === 'active' || status === 'billed' ? '#f0fdf4' : '#f8fafc';
  const border = status === 'expired' || status === 'pending' ? '#fecaca' : status === 'expiring_soon' ? '#fed7aa' : status === 'active' || status === 'billed' ? '#bbf7d0' : '#e2e8f0';
  return <BillingStatusPill label={label} color={color} background={bg} border={border} />;
}

function BillingStatusPill({ label, color, background, border, title, muted = false }: {
  label: string; color: string; background: string; border: string; title?: string; muted?: boolean;
}) {
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      width: 'fit-content', maxWidth: '100%', padding: '4px 8px', borderRadius: 999, background, color,
      border: `1px solid ${border}`, fontSize: 9.5, fontWeight: 750, lineHeight: 1, whiteSpace: 'nowrap',
      opacity: muted ? 0.78 : 1 }}>
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
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
  company_id: number | null;
  services: Services; stages: Stages; stagesDone: number; invoices: Invoice[];
  servicesAuto?: Services; servicesManual?: Partial<Record<string, boolean>>;
  servicePeriods: ServicePeriods | null;
  updated_at?: string | null; updated_by_email?: string | null; updated_by_name?: string | null; version?: number;
}

function recomputeArRecord(record: ARRecord): ARRecord {
  const stages = {
    accountsReady: !!record.prepared_date,
    sentToClient: !!record.sent_date,
    docsReceived: !!record.received_date,
    agmHeld: !!record.agm_held_date,
    arFiled: !!record.filling_date,
  };
  const today = new Date(`${todaySGT()}T00:00:00`).getTime();
  const due = record.due_date ? new Date(`${String(record.due_date).slice(0, 10)}T00:00:00`).getTime() : NaN;
  return {
    ...record,
    stages,
    stagesDone: Object.values(stages).filter(Boolean).length,
    daysUntilDue: Number.isFinite(due) ? Math.ceil((due - today) / 86400000) : null,
  };
}

type FieldConflict = {
  currentValue: string | null;
  updatedByName: string | null;
  updatedByEmail: string | null;
  updatedAt: string | null;
};

type AuditEntry = {
  id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by_name: string | null;
  changed_by_email: string | null;
  changed_at: string;
  version: number;
};

const AR_FIELD_LABELS: Record<string, string> = {
  reminder_note: 'Reminder', prepared_date: 'Report Ready', date_of_agm: 'AGM',
  agm_held_date: 'AGM Held', sent_date: 'To Client', received_date: 'Signed',
  filling_date: 'AR Filed', ar_status: 'Invoice', xbrl: 'XBRL',
  software_update: 'TW Update', dpo: 'DPO', ond_ron: 'ROND RONS',
  pic: 'SEC PIC', acc_pic: 'ACC PIC', tax_pic: 'TAX PIC', remarks: 'Remarks',
  accounts_status: 'Email Sent', dormant: 'Strike Off', agm_documents: 'ND Pending',
};
const AR_DATABASE_DATE_FIELDS = new Set([
  'prepared_date', 'date_of_agm', 'agm_held_date', 'sent_date', 'received_date', 'filling_date',
]);

function historyValue(value: string | null) {
  if (!value) return 'Empty';
  return toDisplayDate(value) ?? value;
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

// Services rendered as FIXED slots in a FIXED order so each service always
// sits in the same position row-to-row — much easier to scan than a
// variable-length list. Color encodes PROVENANCE, not service type:
//   blue = automatically detected · green = manually switched on ·
//   grey = not provided / switched off.
const SVC_ORDER = ['ar', 'agm', 'secretary', 'nd', 'address', 'xbrl', 'accounts', 'tax'] as const;
const SVC_SHORT: Record<string, string> = {
  ar: 'AR', agm: 'AGM', secretary: 'SEC', nd: 'ND',
  address: 'ADDR', xbrl: 'XBRL', accounts: 'ACC', tax: 'TAX',
};
type SvcState = 'auto-on' | 'manual-on' | 'off';
const SVC_STATE_STYLE: Record<SvcState, { bg: string; color: string; bd: string }> = {
  'auto-on':   { bg: '#dbeafe', color: '#1d4ed8', bd: '#93c5fd' },
  'manual-on': { bg: '#dcfce7', color: '#15803d', bd: '#86efac' },
  'off':       { bg: '#f1f5f9', color: '#94a3b8', bd: '#e2e8f0' },
};
function svcStateOf(services: Services, manual: Partial<Record<string, boolean>> | undefined, key: string): SvcState {
  if (manual?.[key] === true) return 'manual-on';
  if ((services as unknown as Record<string, boolean>)[key]) return 'auto-on';
  return 'off';
}

const FYE_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const STAGE_LABELS = ['Accounts\nReady','Sent to\nClient','Docs\nReceived','AGM\nHeld','AR\nFiled'];

// Services a human may override from the AR detail modal. ND/Address are
// deliberately excluded — they follow TeamWork (appointments / reg. address).
const OVERRIDABLE_SVC = ['secretary', 'accounts', 'tax', 'xbrl'] as const;

// Clickable service chip: AUTO by default; one click flips the effective
// state (manual, ✎ marker), clicking again restores AUTO. Automation never
// touches manual values. Colors encode provenance: blue = auto-detected,
// green = manually on, grey = off / not provided.
function OverrideChip({ svc, effective, manual, disabled, onCycle }:
  { svc: string; effective: boolean; manual: boolean | undefined; disabled: boolean; onCycle: () => void }) {
  const c = SVC[svc];
  const isManual = manual !== undefined;
  const stateLabel = isManual ? (manual ? 'MANUAL ON' : 'MANUAL OFF') : (effective ? 'AUTO ON' : 'AUTO OFF');
  const isOn = effective;
  const chipColor = isOn ? c.color : '#94a3b8';
  const chipBg = isOn ? c.bg : '#f8fafc';
  const chipBorder = isManual ? (manual ? '#86efac' : '#cbd5e1') : (isOn ? `${c.color}40` : '#e2e8f0');
  return (
    <button onClick={onCycle} disabled={disabled}
      title={disabled ? 'No company-master match — cannot override' : isManual ? `${c.label}: manual ${manual ? 'ON' : 'OFF'} · click to restore auto` : `${c.label}: auto (${effective ? 'on' : 'off'}) · click to force ${effective ? 'OFF' : 'ON'}`}
      style={{
        background: chipBg, color: chipColor,
        border: `1px solid ${chipBorder}`,
        borderRadius: 999, padding: '8px 12px', fontSize: 10.5, fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        display: 'inline-flex', alignItems: 'center', gap: 8,
        boxShadow: isManual && manual ? '0 0 0 2px rgba(22,163,74,0.07)' : 'none',
      }}>
      {isManual && <span style={{ width: 5, height: 5, borderRadius: '50%', background: manual ? '#16a34a' : '#94a3b8', flexShrink: 0 }} />}
      <span style={{ textDecoration: isManual && !effective ? 'line-through' : 'none' }}>{c.label}</span>
      <span style={{ padding: '1px 4px', borderRadius: 999, background: 'rgba(255,255,255,0.62)', fontSize: 7.5, fontWeight: 800, letterSpacing: '0.35px', opacity: 0.78 }}>{stateLabel}</span>
    </button>
  );
}

const EditField = memo(function EditField({ id, field, value, onSave, placeholder = '—', isDate = false }:
  { id: number; field: string; value: string | null; onSave: (id: number, field: string, val: string) => void; placeholder?: string; isDate?: boolean }) {
  const inputValue = useCallback((raw: string | null) => isDate ? (toDisplayDate(raw) ?? raw ?? '') : (raw ?? ''), [isDate]);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(inputValue(value));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<FieldConflict | null>(null);
  const pendingRef = useRef<{ next: string; prev: string }>({ next: '', prev: '' });
  const committingRef = useRef(false);
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef  = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const persist = useCallback(async (next: string, prev: string) => {
    pendingRef.current = { next, prev };
    setStatus('saving');
    setMessage('');
    setConflict(null);
    const requestId = ++requestRef.current;
    try {
      const res = await fetch('/api/ar-reminder', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: next || null, previousValue: prev || null }) });
      const json = await res.json().catch(() => ({}));
      if (requestId !== requestRef.current) return;
      if (res.status === 409) {
        const current = String(json.currentValue ?? '');
        onSave(id, field, current);
        setVal(inputValue(current));
        setConflict({ currentValue: json.currentValue ?? null, updatedByName: json.updatedByName ?? null, updatedByEmail: json.updatedByEmail ?? null, updatedAt: json.updatedAt ?? null });
        setStatus('conflict');
        return;
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const saved = String(json.value ?? '');
      onSave(id, field, saved);
      setVal(inputValue(saved));
      setStatus('saved');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1400);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed');
      setStatus('error');
    } finally {
      committingRef.current = false;
    }
  }, [id, field, inputValue, onSave]);

  const save = useCallback(() => {
    if (committingRef.current) return;
    setEditing(false);
    const typed = val.trim();
    const next = isDate && typed ? toIsoDateValue(typed) : typed;
    const prev = isDate && value && AR_DATABASE_DATE_FIELDS.has(field)
      ? (toIsoDateValue(value) ?? value.trim())
      : (value ?? '').trim();
    if (isDate && typed && !next) {
      setMessage('Use a valid date, e.g. 03 Apr 2026');
      setStatus('error');
      return;
    }
    if ((next ?? '') === prev) return;
    committingRef.current = true;
    onSave(id, field, next ?? '');
    void persist(next ?? '', prev);
  }, [val, value, id, field, isDate, onSave, persist]);

  const retry = useCallback(() => { committingRef.current = true; void persist(pendingRef.current.next, pendingRef.current.prev); }, [persist]);
  const acceptLatest = useCallback(() => {
    const latest = String(conflict?.currentValue ?? pendingRef.current.prev ?? '');
    onSave(id, field, latest); setVal(inputValue(latest)); setConflict(null); setStatus('idle');
  }, [conflict, field, id, inputValue, onSave]);
  const overwriteLatest = useCallback(() => {
    committingRef.current = true;
    void persist(pendingRef.current.next, String(conflict?.currentValue ?? ''));
  }, [conflict, persist]);
  const revert = useCallback(() => { const { prev } = pendingRef.current; onSave(id, field, prev); setVal(inputValue(prev)); setStatus('idle'); }, [id, field, inputValue, onSave]);

  const handleDatePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    setVal(fmtDate(e.target.value));
    e.target.value = '';
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (editing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input ref={inputRef} type="text" value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={e => { if (!(e.relatedTarget as HTMLElement | null)?.dataset?.calBtn) save(); }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } if (e.key === 'Escape') { setVal(inputValue(value)); setEditing(false); } }}
        placeholder={isDate ? 'e.g. 03 Apr 2026' : ''}
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

  if (status === 'conflict') return (
    <div title={`Updated by ${conflict?.updatedByName ?? conflict?.updatedByEmail ?? 'another user'}`} style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 5, padding: '3px 5px', minHeight: 28 }}>
      <div style={{ fontSize: 9, color: '#c2410c', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        Changed by {conflict?.updatedByName ?? conflict?.updatedByEmail ?? 'another user'}
      </div>
      <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
        <button onClick={acceptLatest} style={{ border: 0, background: 'transparent', padding: 0, color: '#64748b', fontSize: 9, cursor: 'pointer' }}>Use latest</button>
        <button onClick={overwriteLatest} style={{ border: 0, background: 'transparent', padding: 0, color: '#c2410c', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>Keep mine</button>
      </div>
    </div>
  );

  if (status === 'error') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 4px', minHeight: 24 }}>
      <span title={message || 'Save failed'} style={{ fontSize: 11, color: '#b91c1c', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message || val || 'Save failed'}</span>
      <button onClick={retry}  title="Retry save"   style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', padding: 0, display: 'flex' }}><RefreshCw size={11} /></button>
      <button onClick={revert} title="Revert change" style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={11} /></button>
    </div>
  );

  const display = (value ?? '').trim();
  const statusDot = status === 'saving'
    ? <span title="Saving…" style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
    : status === 'saved' ? <Check size={11} style={{ color: '#16a34a', flexShrink: 0 }} /> : null;
  return (
    <div onClick={() => { setVal(inputValue(value)); setEditing(true); }} title="Click to edit" style={{ cursor: 'text', minHeight: 24, display: 'flex', alignItems: 'center', gap: 4, borderRadius: 3, padding: '1px 3px' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      {display
        ? isDate
          ? <span style={{ background: '#dcfce7', color: '#15803d', borderRadius: 4, padding: '1px 6px', fontSize: 11, fontWeight: 700 }}>{toDisplayDate(display) ?? display}</span>
          : <span style={{ fontSize: 12, color: '#374151' }}>{display}</span>
        : isDate
          ? <span style={{ display:'flex', alignItems:'center', gap:3, color:'#c7d2fe', fontSize:11 }}><Calendar size={11} /><span style={{ color:'#d1d5db' }}>{placeholder}</span></span>
          : <span style={{ color: '#d1d5db', fontSize: 11 }}>{placeholder}</span>}
      {statusDot}
    </div>
  );
});

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
  { label: 'Date', ...C.green, type: 'date' },
  { label: 'NO',   ...C.red   },
  { label: 'FULL', ...C.green },
];

const SelectField = memo(function SelectField({ id, field, value, onSave, options }: {
  id: number; field: string; value: string | null;
  onSave: (id: number, field: string, val: string) => void;
  options: SelectOption[];
}) {
  const [open,   setOpen]   = useState(false);
  const [custom, setCustom] = useState(false);
  const [val,    setVal]    = useState(value ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<FieldConflict | null>(null);
  const pendingRef = useRef<{ next: string; prev: string }>({ next: '', prev: '' });
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef  = useRef<HTMLInputElement>(null);
  const wrapRef  = useRef<HTMLDivElement>(null);
  useEffect(() => { if (custom) inputRef.current?.focus(); }, [custom]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const persist = useCallback(async (next: string, prev: string) => {
    pendingRef.current = { next, prev };
    setStatus('saving');
    setMessage('');
    setConflict(null);
    const requestId = ++requestRef.current;
    try {
      const res = await fetch('/api/ar-reminder', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, field, value: next || null, previousValue: prev || null }) });
      const json = await res.json().catch(() => ({}));
      if (requestId !== requestRef.current) return;
      if (res.status === 409) {
        const current = String(json.currentValue ?? '');
        onSave(id, field, current);
        setVal(current);
        setConflict({ currentValue: json.currentValue ?? null, updatedByName: json.updatedByName ?? null, updatedByEmail: json.updatedByEmail ?? null, updatedAt: json.updatedAt ?? null });
        setStatus('conflict');
        return;
      }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const saved = String(json.value ?? '');
      onSave(id, field, saved);
      setVal(saved);
      setStatus('saved');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setStatus(s => (s === 'saved' ? 'idle' : s)), 1400);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Save failed');
      setStatus('error');
    }
  }, [id, field, onSave]);
  const retry  = useCallback(() => persist(pendingRef.current.next, pendingRef.current.prev), [persist]);
  const revert = useCallback(() => { const { prev } = pendingRef.current; onSave(id, field, prev); setVal(prev); setStatus('idle'); }, [id, field, onSave]);
  const acceptLatest = useCallback(() => {
    const latest = String(conflict?.currentValue ?? pendingRef.current.prev ?? '');
    onSave(id, field, latest); setVal(latest); setConflict(null); setStatus('idle');
  }, [conflict, field, id, onSave]);
  const overwriteLatest = useCallback(() => persist(pendingRef.current.next, String(conflict?.currentValue ?? '')), [conflict, persist]);

  const commit = useCallback((next: string) => {
    setCustom(false); setOpen(false);
    const typed = next.trim();
    const trimmed = toIsoDateValue(typed) ?? typed;
    const prev = (value ?? '').trim();
    if (trimmed === prev) return;
    onSave(id, field, trimmed);   // optimistic
    persist(trimmed, prev);
  }, [id, field, value, onSave, persist]);

  const handleDatePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    setVal(fmtDate(e.target.value));
    e.target.value = '';
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const display = (value ?? '').trim();
  const chip = display ? options.find(o => o.label === display && !o.type) : null;
  const isDateValue = !!toDisplayDate(display);
  const statusDot = status === 'saving'
    ? <span title="Saving…" style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />
    : status === 'saved' ? <Check size={11} style={{ color: '#16a34a', flexShrink: 0 }} /> : null;

  if (status === 'conflict') return (
    <div title={`Updated by ${conflict?.updatedByName ?? conflict?.updatedByEmail ?? 'another user'}`} style={{ background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 5, padding: '3px 5px', minHeight: 28 }}>
      <div style={{ fontSize: 9, color: '#c2410c', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Changed by {conflict?.updatedByName ?? conflict?.updatedByEmail ?? 'another user'}</div>
      <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
        <button onClick={acceptLatest} style={{ border: 0, background: 'transparent', padding: 0, color: '#64748b', fontSize: 9, cursor: 'pointer' }}>Use latest</button>
        <button onClick={overwriteLatest} style={{ border: 0, background: 'transparent', padding: 0, color: '#c2410c', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>Keep mine</button>
      </div>
    </div>
  );

  if (status === 'error') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 4px', minHeight: 24 }}>
      <span title={message || 'Save failed'} style={{ fontSize: 11, color: '#b91c1c', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message || val || 'Save failed'}</span>
      <button onClick={retry}  title="Retry save"   style={{ border: 'none', background: 'transparent', color: '#dc2626', cursor: 'pointer', padding: 0, display: 'flex' }}><RefreshCw size={11} /></button>
      <button onClick={revert} title="Revert change" style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={11} /></button>
    </div>
  );

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      {custom ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input ref={inputRef} type="text" value={val}
            onChange={e => setVal(e.target.value)}
            onBlur={e => { if (!(e.relatedTarget as HTMLElement | null)?.dataset?.calBtn) commit(val); }}
            onKeyDown={e => { if (e.key === 'Enter') commit(val); if (e.key === 'Escape') { setVal(value ?? ''); setCustom(false); } }}
            placeholder="e.g. 03 Apr 2026"
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
        <div onClick={() => setOpen(v => !v)} title="Click to select" style={{ cursor: 'pointer', minHeight: 24, display: 'flex', alignItems: 'center', gap: 4, borderRadius: 3, padding: '1px 3px' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
          {display
            ? isDateValue
              ? <span style={{ background: C.green.bg, color: C.green.color, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{fmtDate(display)}</span>
              : chip
                ? <span style={{ background: chip.bg, color: chip.color, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{display}</span>
                : <span style={{ fontSize: 12, color: '#374151' }}>{display}</span>
            : <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>}
          {statusDot}
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
              Clear
            </div>
          )}
          <div onClick={() => { setOpen(false); setVal(value ?? ''); setCustom(true); }}
            style={{ padding: '7px 12px', cursor: 'pointer', borderTop: '1px solid #f1f5f9', fontSize: 11, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 6 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}>
            <Calendar size={11} style={{ color: '#4338ca' }} /> Date / custom…
          </div>
        </div>
      )}
    </div>
  );
});

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
  if (filed) return <span style={{ background: '#dcfce7', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 999, padding: '5px 10px', fontSize: 10.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: '#16a34a' }} />Filed</span>;
  if (days === null) return <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>;
  const bg    = days < 0 ? '#fef2f2' : days < 30 ? '#fff7ed' : days < 90 ? '#fefce8' : '#f0fdf4';
  const color = days < 0 ? '#dc2626' : days < 30 ? '#ea580c' : days < 90 ? '#ca8a04' : '#16a34a';
  const border = days < 0 ? '#fecaca' : days < 30 ? '#fed7aa' : days < 90 ? '#fde68a' : '#bbf7d0';
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d left`;
  return <span style={{ background: bg, color, border: `1px solid ${border}`, borderRadius: 999, padding: '5px 10px', fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 5 }}><span style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />{label}</span>;
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
              onClick={() => { if (isND) setNdRevealed(v => !v); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: isND ? '9px 10px' : '5px 8px', borderRadius: isND && (ndRevealed || onNdFlag) ? '8px 8px 0 0' : isND ? 8 : 5,
                background: isND ? '#f8fbff' : clr.bg,
                border: isND ? '1px solid #bfdbfe' : 'none',
                cursor: isND ? 'pointer' : 'default',
                userSelect: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: isND ? 8 : 5 }}>
                {isND && <span style={{ width: 28, height: 28, borderRadius: 8, background: '#dbeafe', color: '#1d4ed8', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><UserCheck size={14} /></span>}
                <div>
                  <span style={{ fontSize: isND ? 11.5 : 11, fontWeight: isND ? 750 : 600, color: isND ? '#1e3a5f' : '#475569' }}>{label}</span>
                  {isND && <div style={{ marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, color: '#2563eb', fontSize: 8.5, fontWeight: 700 }}><ChevronDown size={10} style={{ transform: ndRevealed ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />{ndRevealed ? 'Hide director details' : 'View director details'}</div>}
                </div>
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
                        {fmtMonth(startDate)}
                        {' – '}
                        {fmtMonth(end)}
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
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderTop: 'none', borderRadius: ndStrikeOff || ndPending ? '0' : '0 0 8px 8px', padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 9 }}>
                <UserCheck size={14} color="#16a34a" />
                <div>
                  <div style={{ fontSize: 8, color: '#65a30d', fontWeight: 800, letterSpacing: '0.45px', marginBottom: 2 }}>ASSIGNED DIRECTOR · FROM TEAMWORK</div>
                  {hasNdName
                    ? <span style={{ fontSize: 12, fontWeight: 700, color: '#15803d' }}>{info!.ndName}</span>
                    : <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>No director name found in TeamWork</span>
                  }
                </div>
              </div>
            )}

            {/* ND special flags — always visible when ND is applicable */}
            {isND && onNdFlag && (
              <div style={{
                padding: '9px 10px 10px',
                background: (ndStrikeOff || ndPending) ? '#fffbeb' : '#f8fafc',
                border: '1px solid #e2e8f0', borderTop: 'none',
                borderRadius: '0 0 8px 8px',
              }}>
                <div style={{ fontSize: 8, fontWeight: 800, color: '#64748b', letterSpacing: '0.45px', marginBottom: 7 }}>ND WORKFLOW FLAGS · CLICK TO UPDATE</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {/* Strike Off toggle */}
                <button
                  onClick={() => onNdFlag('dormant', ndStrikeOff ? '' : 'STRIKE_OFF')}
                  title={ndStrikeOff
                    ? 'Strike-off in progress — initiated but NOT yet confirmed by ACRA. All services (Secretary, Address, ND, etc.) remain active and billable. May be cancelled at any time.'
                    : 'Mark as pending strike-off — all services continue until ACRA formally confirms'}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', flex: '1 1 165px',
                    fontSize: 10, fontWeight: 700, borderRadius: 7, padding: '7px 9px',
                    border: `1px solid ${ndStrikeOff ? '#fdba74' : '#e2e8f0'}`,
                    background: ndStrikeOff ? '#fff7ed' : '#fff', color: ndStrikeOff ? '#c2410c' : '#64748b',
                  }}
                >
                  {/* Checkbox square */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 13, height: 13, flexShrink: 0,
                    border: `1.5px solid ${ndStrikeOff ? '#c2410c' : '#cbd5e1'}`,
                    borderRadius: 2,
                    background: ndStrikeOff ? '#fff7ed' : '#fff',
                  }}>
                    {ndStrikeOff && (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#c2410c" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </span>
                  <span style={{ textAlign: 'left' }}><span style={{ display: 'block' }}>Strike-Off Pending</span><span style={{ display: 'block', fontSize: 8, fontWeight: 500, color: ndStrikeOff ? '#ea580c' : '#94a3b8', marginTop: 1 }}>Services remain active until confirmed</span></span>
                </button>

                {/* ND Pending toggle */}
                <button
                  onClick={() => onNdFlag('agm_documents', ndPending ? '' : 'ND_PENDING')}
                  title="ND service requested but director not yet assigned"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', flex: '1 1 165px',
                    fontSize: 10, fontWeight: 700, borderRadius: 7, padding: '7px 9px',
                    border: `1px solid ${ndPending ? '#fcd34d' : '#e2e8f0'}`,
                    background: ndPending ? '#fefce8' : '#fff', color: ndPending ? '#b45309' : '#64748b',
                  }}
                >
                  {/* Checkbox square */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 13, height: 13, flexShrink: 0,
                    border: `1.5px solid ${ndPending ? '#b45309' : '#cbd5e1'}`,
                    borderRadius: 2,
                    background: ndPending ? '#fef3c7' : '#fff',
                  }}>
                    {ndPending && (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#b45309" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    )}
                  </span>
                  <span style={{ textAlign: 'left' }}><span style={{ display: 'block' }}>ND Assignment Pending</span><span style={{ display: 'block', fontSize: 8, fontWeight: 500, color: ndPending ? '#ca8a04' : '#94a3b8', marginTop: 1 }}>Service requested, director not assigned</span></span>
                </button>
                </div>
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
            { label: 'Reminder',      field: 'reminder_note', isDate: true  },
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
            onNdFlag={(field, value) => {
              const previousValue = String((r as unknown as Record<string, string | null>)[field] ?? '');
              onSave(r.id, field, value); // optimistic update — UI responds immediately
              fetch('/api/ar-reminder', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, field, value: value || null, previousValue: previousValue || null }) })
                .then(async response => {
                  const json = await response.json().catch(() => ({}));
                  if (!response.ok) onSave(r.id, field, String(json.currentValue ?? previousValue));
                });
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
                    <span style={{ fontSize: 10, color: '#64748b' }}>{fmtDate(inv.txn_date)}</span>
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
            <EditField id={r.id} field="accounts_status" value={r.accounts_status} onSave={onSave} placeholder="—" isDate />
          </div>
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BILLING TAB
// ── Expanded billing row: email + draft creation ──────────────────────────────
type EditableLine = {
  service: string;
  productService: string;   // exact QB Product/Service item
  description: string;
  qty: number;
  rate: number;
  include: boolean;
  due: boolean;
  reason: string;
};

type InvoiceNumberState = { TAB: string; TAC: string };
type GeneratedPdf = { company: 'TAB' | 'TAC'; invoiceNo: string; qbId: string };

type WritableFileHandle = { createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> };
type WritableDirectoryHandle = { getFileHandle: (name: string, options: { create: boolean }) => Promise<WritableFileHandle> };
type FolderPickerWindow = Window & { showDirectoryPicker?: () => Promise<WritableDirectoryHandle> };

function existingGeneratedPdfs(company: CompanyBilling, cycleFye?: string): GeneratedPdf[] {
  const seen = new Set<'TAB' | 'TAC'>();
  const pdfs: GeneratedPdf[] = [];
  for (const invoice of company.generatedInvoices ?? []) {
    if (cycleFye && invoice.fyeCycle !== cycleFye) continue;
    if (!invoice.invoiceNo || !invoice.qbId || seen.has(invoice.qbCompany)) continue;
    seen.add(invoice.qbCompany);
    pdfs.push({ company: invoice.qbCompany, invoiceNo: invoice.invoiceNo, qbId: invoice.qbId });
  }
  return pdfs;
}

// Textarea that grows to fit its content — the full line description is always
// visible, no inner scrollbar.
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

function ExpandedBillingRow({ c, cycleFye }: { c: CompanyBilling; cycleFye?: string }) {
  const [drafting, setDrafting] = useState(false);
  const [draftResult, setDraftResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [email, setEmail] = useState(c.email ?? '');
  const [txnDate, setTxnDate] = useState(new Date().toISOString().slice(0, 10));
  const [invoiceNumbers, setInvoiceNumbers] = useState<InvoiceNumberState>({ TAB: '', TAC: '' });
  const [suggestedNumbers, setSuggestedNumbers] = useState<InvoiceNumberState>({ TAB: '', TAC: '' });
  const [numberLoading, setNumberLoading] = useState(true);
  const [numberWarning, setNumberWarning] = useState('');
  const [numberRefreshKey, setNumberRefreshKey] = useState(0);
  const [generatedPdfs, setGeneratedPdfs] = useState<GeneratedPdf[]>(() => existingGeneratedPdfs(c, cycleFye));
  const [savingPdfs, setSavingPdfs] = useState(false);
  const [pdfResult, setPdfResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Build the editable draft. Each line defaults to how THIS company was last
  // invoiced for that service (same QB item + description wording + rate, from
  // history), refreshing the period/FYE; when there's no history it falls back
  // to Tassure's standard template + typical rate. AR adds the fixed S$60 ACRA
  // government-fee line. Lines that are actually due are pre-checked.
  const currentYear = new Date().getFullYear();
  const ndInitials = c.ndPic ? NAME_TO_INITIALS[c.ndPic.trim().toUpperCase()] : undefined;
  const ndProductService = ndInitials ? `${QB_ITEM.ND} - ${ndInitials}` : QB_ITEM.ND;
  const initialLines = useMemo<EditableLine[]>(() => {
    const out: EditableLine[] = [];
    const period = periodLabel(c.renewals[0]?.suggestedPeriodStart ?? null, c.renewals[0]?.suggestedPeriodEnd ?? null);
    // Prefer the FYE of the cycle actually being invoiced (from the selected
    // month/year) over a current-year guess — a January-selected cycle drafted
    // in December would otherwise stamp the wrong year on AR/XBRL lines.
    const fyeStr = cycleFye ?? fyeDateString(c.fyeMonth, currentYear);
    // "Invoiced this cycle" from the FYE markers on QB lines — validated
    // reliable, unlike the 13-month recency heuristic which misreads
    // last year's invoice as covering this cycle at boundary months.
    const billedThisCycle = cycleFye ? (c.billedCycles ?? []).includes(cycleFye) : null;

    for (const r of c.renewals) {
      if (!r.applicable) continue;
      const due = r.status === 'expired' || r.status === 'expiring_soon';
      const last = r.history?.[0];
      const pLabel = periodLabel(r.suggestedPeriodStart, r.suggestedPeriodEnd);
      const templateDesc = r.service === 'Secretary' ? secretaryDescription(pLabel)
                         : r.service === 'Address'   ? addressDescription(pLabel)
                         : `Nominee Director for one year${pLabel ? ` (${pLabel})` : ''}`;
      // ND's source of truth is TeamWork's nominee-director records, not QB.
      // A line only reaches here when r.applicable is true, i.e. TeamWork shows
      // an ACTIVE nominee appointment (validated accurate) — so trust it and
      // pre-check it. QB history is unreliable for ND only because deposits and
      // annual fees are billed on separate invoices, so the *fee* is the only
      // thing to eyeball, not whether we're still engaged. Secretary is 85%
      // identical YoY / Address 95% — likewise safe to pre-fill.
      const isND = r.service === 'ND';
      out.push({
        service: r.service,
        productService: isND ? (ndInitials ? ndProductService : last?.product_service ?? ndProductService) : last?.product_service ?? QB_ITEM[r.service] ?? '',
        description: templateDesc,
        qty: 1,
        rate: r.lastRate ?? MEDIAN_RATE[r.service] ?? 0,
        include: isND ? true : due,
        due,
        reason: isND ? 'Active nominee per TeamWork · confirm annual fee (excl. deposit)'
              : r.status === 'expired' ? `Expired ${Math.abs(r.daysUntilExpiry ?? 0)}d ago`
              : r.status === 'expiring_soon' ? `Expiring in ${r.daysUntilExpiry}d`
              : r.status === 'active' ? `Active until ${r.lastPeriodEnd ? fmtDate(r.lastPeriodEnd) : '—'}`
              : 'No prior invoice',
      });
    }

    for (const a of c.annuals) {
      if (!a.applicable) continue;
      // Cycle marker beats the recency heuristic whenever we know the cycle.
      const due = billedThisCycle !== null ? !billedThisCycle : a.status === 'pending';
      const last = a.history?.[0];
      const reason = billedThisCycle === true ? `Already invoiced this cycle [FYE ${cycleFye}]`
                   : billedThisCycle === false ? 'Not yet invoiced this cycle'
                   : a.status === 'billed' ? `Already billed ${a.lastTxnDate ? fmtDate(a.lastTxnDate) : ''}`
                   : a.status === 'pending' ? 'Not yet billed this cycle' : 'No prior invoice';
      if (a.service === 'AR') {
        // AR = fixed S$60 ACRA government filing fee (a disbursement line).
        out.push({
          service: 'AR', productService: last?.product_service ?? QB_ITEM.AR,
          description: arGovtFeeDescription(fyeStr),
          qty: 1, rate: last?.rate ?? MEDIAN_RATE.AR, include: due, due, reason,
        });
      } else { // XBRL
        // Validation: XBRL amount is 100% stable when present, but presence is
        // unpredictable YoY (added 18× / dropped 7× across 32 pairs) because it
        // depends on the year's filing requirement — always confirm it's needed.
        out.push({
          service: 'XBRL', productService: last?.product_service ?? QB_ITEM.XBRL,
          description: xbrlDescription(fyeStr),
          qty: 1, rate: a.lastAmount ?? MEDIAN_RATE.XBRL, include: due, due,
          reason: `⚠ Confirm XBRL required this FY · ${reason}`,
        });
      }
    }

    // Carry forward the extras from last year's actual invoice that the core
    // template doesn't cover — per the SOP "沿用上一年的收费项目/金额/折扣".
    // Discount is pre-checked (part of the client's deal) but flagged to
    // confirm it still applies; recurring Accounts/Tax lines are surfaced
    // unchecked for staff to confirm they recur this year.
    const priorDate = c.priorInvoiceDate ? fmtDate(c.priorInvoiceDate) : 'last year';
    for (const p of c.priorLines ?? []) {
      const ps = p.product_service ?? '';
      if (/Discount Given/i.test(ps)) {
        out.push({
          service: 'Discount', productService: ps,
          description: p.description || 'Discount Given',
          qty: 1, rate: p.amount ?? 0, include: true, due: true,
          reason: `Discount from ${priorDate} — confirm it still applies`,
        });
      } else if (/Yearly Accounts Services|Compilation Services|Monthly Accounts Services/i.test(ps) && !/DO NOT USE/i.test(ps)) {
        out.push({
          service: 'Accounts', productService: ps,
          description: p.description || ps,
          qty: 1, rate: p.amount ?? MEDIAN_RATE.Accounts ?? 0, include: false, due: false,
          reason: `On ${priorDate} invoice — confirm if recurring`,
        });
      } else if (/Corporate Tax Services|Personal Income Tax Services|Other Tax Services/i.test(ps)) {
        out.push({
          service: 'Tax', productService: ps,
          description: p.description || ps,
          qty: 1, rate: p.amount ?? MEDIAN_RATE.Tax ?? 0, include: false, due: false,
          reason: `On ${priorDate} invoice — confirm if recurring`,
        });
      }
    }
    return out;
  }, [c, currentYear, cycleFye, ndInitials, ndProductService]);

  const [lines, setLines] = useState<EditableLine[]>(initialLines);
  const setLine = (i: number, patch: Partial<EditableLine>) =>
    setLines(prev => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  // All Nominee Director lines invoice separately under TAC; everything else
  // (Secretary/Address/AR/XBRL/Accounts/Tax/Discount) stays under TAB, the
  // default company. Keep original array indices so setLine/remove still
  // target the right row after splitting into two rendered tables.
  const withIndex = lines.map((l, i) => ({ l, i }));
  const tabRows = withIndex.filter(x => x.l.service !== 'ND');
  const tacRows = withIndex.filter(x => x.l.service === 'ND');

  // Only offer the TAC section at all when this company actually has an ND
  // line — most companies never will.
  const hasTac = tacRows.length > 0;

  const [tacStatus, setTacStatus] = useState<{ connected: boolean } | null>(null);
  useEffect(() => {
    if (!hasTac) return;
    fetch('/api/quickbooks/status?company=TAC').then(r => r.json()).then(setTacStatus).catch(() => setTacStatus({ connected: false }));
  }, [hasTac]);

  useEffect(() => {
    const controller = new AbortController();
    const startTimer = setTimeout(() => {
      setNumberLoading(true);
      setNumberWarning('');
    }, 0);
    fetch(`/api/quickbooks/next-invoice-numbers?txnDate=${encodeURIComponent(txnDate)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Unable to read QuickBooks invoice numbers');
        return response.json();
      })
      .then(json => {
        const next = {
          TAB: typeof json.TAB?.number === 'string' ? json.TAB.number : '',
          TAC: typeof json.TAC?.number === 'string' ? json.TAC.number : '',
        };
        setSuggestedNumbers(next);
        setInvoiceNumbers(next);
        if (!json.TAB?.connected || (hasTac && !json.TAC?.connected)) {
          setNumberWarning('QuickBooks connection unavailable for one or more invoice numbers.');
        }
      })
      .catch(error => {
        if (error instanceof Error && error.name !== 'AbortError') setNumberWarning(error.message);
      })
      .finally(() => { if (!controller.signal.aborted) setNumberLoading(false); });
    return () => { clearTimeout(startTimer); controller.abort(); };
  }, [txnDate, hasTac, numberRefreshKey]);

  const included = lines.filter(l => l.include);
  const includedTab = included.filter(l => l.service !== 'ND');
  const includedTac = included.filter(l => l.service === 'ND');
  const total = included.reduce((s, l) => s + l.qty * l.rate, 0);
  const totalTab = includedTab.reduce((s, l) => s + l.qty * l.rate, 0);
  const totalTac = includedTac.reduce((s, l) => s + l.qty * l.rate, 0);
  const missingRate = included.some(l => !l.rate);
  const missingInvoiceNumber = (includedTab.length > 0 && !invoiceNumbers.TAB) || (includedTac.length > 0 && !invoiceNumbers.TAC);

  const createInvoice = async () => {
    setDrafting(true); setDraftResult(null);
    try {
      const fyeYear = cycleFye ? +cycleFye.slice(-4) : currentYear;
      const toApiLine = (l: EditableLine) => ({ service: l.service, productService: l.productService, description: l.description, rate: l.rate, qty: l.qty });
      const res = await fetch('/api/quickbooks/create-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: c.companyName,
          email: email || undefined,
          txnDate,
          sendEmail: false,
          pic: c.pic ?? undefined,
          tabLines: includedTab.map(toApiLine),
          tacLines: includedTac.map(toApiLine),
          fyeMonth: c.fyeMonth, fyeYear, fyeCycle: cycleFye ?? null,
          docNumbers: invoiceNumbers,
          expectedNextNumbers: suggestedNumbers,
        }),
      });
      const json = await res.json();
      if (res.status === 409 && json.numberConflict) {
        const refreshed = {
          TAB: typeof json.nextNumbers?.TAB === 'string' ? json.nextNumbers.TAB : invoiceNumbers.TAB,
          TAC: typeof json.nextNumbers?.TAC === 'string' ? json.nextNumbers.TAC : invoiceNumbers.TAC,
        };
        setSuggestedNumbers(refreshed);
        setInvoiceNumbers(refreshed);
        const details = Object.entries(json.conflicts ?? {}).map(([company, message]) => `${company}: ${message}`).join(' · ');
        setNumberWarning(`Invoice number changed in QuickBooks. ${details}`);
        setDraftResult({ ok: false, msg: 'No invoice was created. Review the refreshed TAB / TAC number, then generate again.' });
        return;
      }
      const parts: string[] = [];
      if (json.tab) parts.push(`TAB #${json.tab.invoiceNo ?? '?'} · S$${(json.tab.total ?? 0).toLocaleString()}`);
      if (json.tac) parts.push(`TAC #${json.tac.invoiceNo ?? '?'} · S$${(json.tac.total ?? 0).toLocaleString()}`);
      const errs: string[] = [];
      if (json.errors?.tab) errs.push(`TAB: ${json.errors.tab}`);
      if (json.errors?.tac) errs.push(`TAC: ${json.errors.tac}`);
      if (json.success) {
        const pdfs: GeneratedPdf[] = [
          ...(json.tab?.qbId && json.tab?.invoiceNo ? [{ company: 'TAB' as const, qbId: String(json.tab.qbId), invoiceNo: String(json.tab.invoiceNo) }] : []),
          ...(json.tac?.qbId && json.tac?.invoiceNo ? [{ company: 'TAC' as const, qbId: String(json.tac.qbId), invoiceNo: String(json.tac.invoiceNo) }] : []),
        ];
        setGeneratedPdfs(pdfs);
        setPdfResult(null);
        setDraftResult({ ok: true, msg: `Created in QuickBooks — ${parts.join(' · ')}${errs.length ? `  ⚠ ${errs.join('; ')}` : ''} · review & send from QB` });
      } else {
        setDraftResult({ ok: false, msg: errs.join('; ') || json.error || 'QB create failed' });
      }
    } catch (e: unknown) {
      setDraftResult({ ok: false, msg: e instanceof Error ? e.message : 'Request failed' });
    } finally { setDrafting(false); }
  };

  const saveInvoicePdfs = async () => {
    if (!generatedPdfs.length) return;
    setSavingPdfs(true);
    setPdfResult(null);
    try {
      const picker = (window as FolderPickerWindow).showDirectoryPicker;
      const directory = picker ? await picker() : null;
      const safeCompany = c.companyName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();

      for (const invoice of generatedPdfs) {
        const response = await fetch(`/api/quickbooks/invoice-pdf?company=${invoice.company}&id=${encodeURIComponent(invoice.qbId)}`);
        if (!response.ok) {
          const error = await response.json().catch(() => ({}));
          throw new Error(error.error ?? `Unable to download ${invoice.company} invoice ${invoice.invoiceNo}`);
        }
        const blob = await response.blob();
        const fileName = `${invoice.invoiceNo} - ${safeCompany} - ${invoice.company}.pdf`;

        if (directory) {
          const fileHandle = await directory.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        } else {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = fileName;
          document.body.appendChild(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(url);
        }
      }

      setPdfResult({
        ok: true,
        msg: directory
          ? `${generatedPdfs.length} invoice PDF${generatedPdfs.length > 1 ? 's' : ''} saved to the selected folder.`
          : `${generatedPdfs.length} invoice PDF${generatedPdfs.length > 1 ? 's' : ''} downloaded.`,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setPdfResult({ ok: false, msg: 'Folder selection cancelled. No file was saved.' });
      } else {
        setPdfResult({ ok: false, msg: error instanceof Error ? error.message : 'Unable to save invoice PDF.' });
      }
    } finally {
      setSavingPdfs(false);
    }
  };

  const inputStyle: React.CSSProperties = { border: '1px solid #cbd5e1', borderRadius: 5, padding: '6px 6px', fontSize: 12, outline: 'none', background: '#fff' };

  const renderInvoiceNumber = (company: keyof InvoiceNumberState) => {
    const value = invoiceNumbers[company];
    const suggested = suggestedNumbers[company];
    const manuallyChanged = !!value && !!suggested && value !== suggested;
    return (
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 9px', borderRadius: 8, background: manuallyChanged ? '#fffbeb' : '#f8fafc', border: `1px solid ${manuallyChanged ? '#fcd34d' : '#dbe5ee'}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: manuallyChanged ? '#b45309' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '.45px' }}>{manuallyChanged ? 'Manual number' : 'Next QB number'}</span>
          <span style={{ fontSize: 8.5, color: '#94a3b8' }}>{numberLoading ? 'Checking live…' : 'rechecked before create'}</span>
        </div>
        <input
          value={value}
          onChange={event => { setInvoiceNumbers(current => ({ ...current, [company]: event.target.value.trim() })); setNumberWarning(''); }}
          placeholder={numberLoading ? 'Loading…' : 'Unavailable'}
          aria-label={`${company} invoice number`}
          style={{ width: 92, border: 0, borderBottom: `1px solid ${manuallyChanged ? '#f59e0b' : '#94a3b8'}`, outline: 'none', background: 'transparent', color: manuallyChanged ? '#92400e' : '#1e3a5f', fontFamily: 'monospace', fontSize: 11.5, fontWeight: 800, padding: '2px 1px', textAlign: 'center' }}
        />
        <button type="button" onClick={() => setNumberRefreshKey(key => key + 1)} title="Refresh from QuickBooks" style={{ border: 0, background: 'transparent', color: '#64748b', padding: 2, cursor: 'pointer', display: 'flex' }}>
          <RefreshCw size={12} style={{ animation: numberLoading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>
    );
  };

  // Shared table renderer for both the TAB and TAC sections.
  const renderTable = (rows: { l: EditableLine; i: number }[], emptyMsg: string) => (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '34px 120px 1fr 90px 44px 100px 110px 26px', gap: 0, background: '#f1f5f9', padding: '12px 10px', fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        <div></div><div>Service</div><div>Description</div>
        <div style={{ textAlign: 'center', padding: '0 8px' }}>Status</div>
        <div style={{ textAlign: 'center', padding: '0 8px' }}>Qty</div>
        <div style={{ textAlign: 'center', padding: '0 8px' }}>Rate (S$)</div>
        <div style={{ textAlign: 'right' }}>Amount</div><div></div>
      </div>
      {rows.map(({ l, i }) => {
        const cfg = SVC_CONFIG[l.service as keyof typeof SVC_CONFIG];
        const ndCode = l.service === 'ND' ? l.productService.match(/Nominee Director Fees\s*-\s*([A-Z]+)/i)?.[1]?.toUpperCase() : null;
        const svcLabel = ndCode ? `ND · ${ndCode}` : cfg?.label ?? (l.productService.includes(':') ? l.productService.split(':').slice(1).join(':') : l.service);
        return (
          <div key={`${l.productService}-${i}`} style={{ display: 'grid', gridTemplateColumns: '34px 120px 1fr 90px 44px 100px 110px 26px', gap: 0, alignItems: 'start', padding: '16px 10px', borderTop: '1px solid #f1f5f9', background: l.include ? '#fff' : '#fafbfc', opacity: l.include ? 1 : 0.55 }}>
            <input type="checkbox" checked={l.include} onChange={e => setLine(i, { include: e.target.checked })} style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#0f766e' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={l.productService}>
              {cfg && <cfg.Icon size={13} style={{ color: cfg.color }} />}
              <span style={{ fontSize: 12, fontWeight: 700, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svcLabel}</span>
            </div>
            <AutoTextarea value={l.description} onChange={v => setLine(i, { description: v })} style={{ ...inputStyle, width: '95%', fontFamily: 'inherit', lineHeight: 1.4 }} />
            <span style={{ fontSize: 10, fontWeight: 600, color: l.due ? '#c2410c' : '#94a3b8', textAlign: 'center', padding: '0 8px' }}>{l.reason}</span>
            <input type="number" min={1} value={l.qty} onChange={e => setLine(i, { qty: Math.max(1, +e.target.value || 1) })} style={{ ...inputStyle, width: 38, textAlign: 'center', justifySelf: 'center' }} />
            <input type="number" min={0} value={l.rate || ''} placeholder="0" onChange={e => setLine(i, { rate: +e.target.value || 0 })}
              style={{ ...inputStyle, width: 90, textAlign: 'center', justifySelf: 'center', borderColor: l.include && !l.rate ? '#f87171' : '#cbd5e1', background: l.include && !l.rate ? '#fef2f2' : '#fff' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: l.include ? '#0f766e' : '#94a3b8', textAlign: 'right' }}>{l.include ? `S$${(l.qty * l.rate).toLocaleString()}` : '—'}</span>
            <button onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} title="Remove line" style={{ border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', padding: 0, display: 'flex', justifyContent: 'center' }}><X size={13} /></button>
          </div>
        );
      })}
      {rows.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{emptyMsg}</div>}
    </div>
  );

  return (
    <div style={{ padding: '28px 20px', background: '#fff' }}>
      {/* Header: contact + PIC + invoice date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="client@email.com"
            style={{ ...inputStyle, width: 240, color: '#1d4ed8', fontWeight: 600 }} />
        </div>
        {c.contactName && <span style={{ fontSize: 11, color: '#64748b' }}>· {c.contactName}</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>Invoice date</span>
          <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} style={inputStyle} />
        </div>
        {c.pic && <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>SEC / XBRL PIC: <strong style={{ color: '#334155' }}>{c.pic}</strong></span>}
      </div>

      {/* TAB — basic services (Secretary/Address/AR/XBRL/Accounts/Tax/Discount).
          Layout mirrors the TAC section: badge header first, then the
          "based on last invoice" provenance note. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 5, padding: '2px 8px' }}>TAB</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>Basic Services</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>· default QuickBooks company</span>
        {renderInvoiceNumber('TAB')}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <FileText size={12} />
        {c.priorInvoiceDate
          ? <span>
              Based on last invoice
              {c.priorInvoiceNo && <strong style={{ color: '#1d4ed8', fontFamily: 'monospace', margin: '0 5px', background: '#eff6ff', border: '1px solid #dbeafe', padding: '1px 7px', borderRadius: 4 }}>#{c.priorInvoiceNo}</strong>}
              {' '}dated <strong style={{ color: '#334155' }}>{fmtDate(c.priorInvoiceDate)}</strong> — items & amounts carried forward, period rolled to this cycle. Verify discount still applies.
            </span>
          : <span style={{ color: '#b45309' }}>No prior renewal invoice found — draft built from standard template. Confirm each line.</span>}
      </div>
      <div style={{ marginBottom: 0 }}>
        {renderTable(tabRows, 'No applicable services for this company.')}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 8px 8px', background: '#f8fafc' }}>
          <Plus size={13} style={{ color: '#0f766e' }} />
          <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Add line</span>
          <select value="" onChange={e => {
              const item = QB_CATALOG.find(x => x.item === e.target.value);
              if (!item) return;
              setLines(prev => [...prev, { service: item.service, productService: item.item, description: item.label, qty: 1, rate: item.rate, include: true, due: false, reason: 'Added manually' }]);
            }}
            style={{ ...inputStyle, minWidth: 260, cursor: 'pointer' }}>
            <option value="">Choose a QuickBooks item…</option>
            {[...new Set(QB_CATALOG.filter(x => x.category !== 'Nominee').map(x => x.category))].map(cat => (
              <optgroup key={cat} label={cat}>
                {QB_CATALOG.filter(x => x.category === cat).map(x => (
                  <option key={x.item} value={x.item}>{x.label}{x.rate ? `  ·  S$${x.rate.toLocaleString()}` : ''}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* TAC — Nominee Director only, and only shown when this company has an
          ND line at all (most companies never will). Gap between the TAB and
          TAC sections is 3x the normal section spacing (22 -> 66), with a
          dashed divider centred in it — visually separates the two invoices. */}
      {hasTac && (
        <>
          <div style={{ height: 66, display: 'flex', alignItems: 'center' }}>
            <div style={{ flex: 1, borderTop: '1px dashed #e2e8f0' }} />
          </div>
          <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#9a3412', background: '#ffedd5', border: '1px solid #fed7aa', borderRadius: 5, padding: '2px 8px' }}>TAC</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>Nominee Director</span>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>· invoiced separately under the TAC company</span>
            {c.ndPic && (
              <span style={{ fontSize: 10.5, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 999, padding: '2px 8px', marginLeft: 3 }}>
                TAC PIC: <strong>{c.ndPic}</strong>{ndInitials ? ` · ${ndInitials} in service` : ' · confirm service shorthand'}
              </span>
            )}
            {tacStatus && !tacStatus.connected && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: '#dc2626', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 5, padding: '2px 8px', marginLeft: 4 }}>
                <AlertTriangle size={11} />
                QuickBooks TAC not connected
                <a href="/api/quickbooks/auth?company=TAC" style={{ color: '#1d4ed8', textDecoration: 'underline', fontWeight: 700 }}>Connect TAC</a>
              </span>
            )}
            {renderInvoiceNumber('TAC')}
          </div>
          {/* Provenance for the TAC invoice — mirrors the TAB note above. The
              ND draft line's item & fee come from this exact invoice. */}
          {(() => {
            const ndPrior = c.renewals.find(r => r.service === 'ND')?.history?.[0] ?? null;
            return (
              <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileText size={12} />
                {ndPrior?.invoice_no
                  ? <span>
                      Based on last invoice
                      <strong style={{ color: '#9a3412', fontFamily: 'monospace', margin: '0 5px', background: '#ffedd5', border: '1px solid #fed7aa', padding: '1px 7px', borderRadius: 4 }}>#{ndPrior.invoice_no}</strong>
                      {ndPrior.txn_date && <> dated <strong style={{ color: '#334155' }}>{fmtDate(ndPrior.txn_date)}</strong></>}
                      {' '}— ND fee &amp; director item carried forward, period rolled to this cycle.
                    </span>
                  : <span style={{ color: '#b45309' }}>No prior ND invoice found — confirm the director&apos;s item &amp; fee before generating.</span>}
              </div>
            );
          })()}
          <div style={{ marginBottom: 0 }}>
            {renderTable(tacRows, 'No Nominee Director line.')}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 8px 8px', background: '#fff7ed' }}>
              <Plus size={13} style={{ color: '#9a3412' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Add ND line</span>
              <select value="" onChange={e => {
                  const item = QB_CATALOG.find(x => x.item === e.target.value);
                  if (!item) return;
                  setLines(prev => [...prev, { service: item.service, productService: item.item, description: item.label, qty: 1, rate: item.rate, include: true, due: false, reason: 'Added manually' }]);
                }}
                style={{ ...inputStyle, minWidth: 260, cursor: 'pointer' }}>
                <option value="">Choose a Nominee item…</option>
                {QB_CATALOG.filter(x => x.category === 'Nominee').map(x => (
                  <option key={x.item} value={x.item}>{x.label}{x.rate ? `  ·  S$${x.rate.toLocaleString()}` : ''}</option>
                ))}
              </select>
            </div>
          </div>
          </div>
        </>
      )}

      {/* Total + generate */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 24, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: '#334155' }}>
          <span style={{ color: '#64748b' }}>{included.length} line{included.length !== 1 ? 's' : ''} · Total </span>
          <strong style={{ fontSize: 17, color: '#0f766e' }}>S${total.toLocaleString()}</strong>
          {hasTac && includedTac.length > 0 && (
            <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 8 }}>(TAB S${totalTab.toLocaleString()} · TAC S${totalTac.toLocaleString()})</span>
          )}
        </div>
        {missingRate && <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>⚠ Fill in the highlighted rate(s) before generating</span>}
        {missingInvoiceNumber && !numberLoading && <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>Confirm the required QB invoice number</span>}
        <button
          onClick={createInvoice}
          disabled={drafting || numberLoading || included.length === 0 || missingRate || missingInvoiceNumber}
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none',
            cursor: (drafting || numberLoading || included.length === 0 || missingRate || missingInvoiceNumber) ? 'not-allowed' : 'pointer',
            background: (drafting || numberLoading || included.length === 0 || missingRate || missingInvoiceNumber) ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
          }}>
          {
            drafting ? 'Generating…'
            : includedTab.length && includedTac.length ? 'Generate 2 Invoices (TAB + TAC)'
            : includedTac.length ? 'Generate Invoice in QB (TAC)'
            : 'Generate Invoice in QB (TAB)'
          }
        </button>
      </div>

      {numberWarning && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 7, padding: '9px 11px', borderRadius: 8, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 11, fontWeight: 650 }}>
          <AlertTriangle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{numberWarning}</span>
        </div>
      )}

      {draftResult && (
        <div style={{ marginTop: 20, padding: '12px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
          background: draftResult.ok ? '#f0fdf4' : '#fef2f2', color: draftResult.ok ? '#15803d' : '#dc2626',
          border: `1px solid ${draftResult.ok ? '#bbf7d0' : '#fecaca'}` }}>
          {draftResult.ok ? '✓ ' : '✕ '}{draftResult.msg}
        </div>
      )}

      {generatedPdfs.length > 0 && (
        <div style={{ marginTop: 12, padding: '12px 13px', borderRadius: 9, border: '1px solid #bfdbfe', background: '#f8fbff', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#1e3a5f' }}>Invoice PDF ready</div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
              {generatedPdfs.map(pdf => `${pdf.company} #${pdf.invoiceNo}`).join(' · ')} · choose a local folder and save directly
            </div>
          </div>
          <button type="button" onClick={saveInvoicePdfs} disabled={savingPdfs} style={{ border: '1px solid #93c5fd', borderRadius: 7, background: savingPdfs ? '#dbeafe' : '#eff6ff', color: '#1d4ed8', padding: '8px 12px', fontSize: 11.5, fontWeight: 800, cursor: savingPdfs ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FileText size={13} /> {savingPdfs ? 'Saving PDF…' : `Choose Folder & Save PDF${generatedPdfs.length > 1 ? 's' : ''}`}
          </button>
        </div>
      )}

      {pdfResult && (
        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 650, color: pdfResult.ok ? '#15803d' : '#b45309' }}>{pdfResult.msg}</div>
      )}

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 24, fontSize: 10, color: '#94a3b8' }}>
        ⚠ The invoice is created as a draft in QuickBooks (not sent). Review it in QB, then send to the client from there.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Billing is a downstream STEP of the AR Reminder: TeamWork determines the AR
// cycle, staff review it, and only then does a company reach Billing. So the
// Billing list for a cycle IS the AR Reminder list — not a QB-derived guess
// (a companies-table filter silently drops the ~5 of 35 that have no companies
// row or aren't yet CSS+Active). We take the AR Reminder rows as the master
// list and join each to the renewals record (by name) purely for accurate fee
// amounts / prior-invoice cloning.
type ARServiceFlags = { ar: boolean; agm: boolean; xbrl: boolean; nd: boolean; address: boolean; accounts: boolean; tax: boolean; secretary: boolean };
type ARCompany = {
  id: number; entity_name: string; uen: string | null; fye_date: string | null;
  due_date: string | null; pic: string | null; status: string | null;
  acc_pic: string | null; tax_pic: string | null; dormant: string | null;
  services: ARServiceFlags;
};

function normName(s: string) {
  return (s ?? '').toLowerCase()
    .replace(/\bpte\.?\s*ltd\.?\b/gi, '').replace(/\bprivate\s+limited\b/gi, '')
    .replace(/\blimited\b/gi, '').replace(/\bllp\b/gi, '')
    .replace(/[.\-,()&]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Merge an AR Reminder row with its matched renewals record into a CompanyBilling
// that ExpandedBillingRow can render. The AR Reminder is authoritative for WHICH
// services to bill; the renewals record supplies the validated amounts + history.
function arToBillingRow(ar: ARCompany, matched: CompanyBilling | undefined, month: string): CompanyBilling {
  const svc = ar.services;
  const mkRenewal = (service: RenewalStatus['service'], applicable: boolean): RenewalStatus => {
    const m = matched?.renewals.find(r => r.service === service);
    return m ? { ...m, applicable }
             : { service, applicable, lastPeriodEnd: null, lastRate: null, daysUntilExpiry: null, status: 'not_found', suggestedPeriodStart: null, suggestedPeriodEnd: null, history: [] };
  };
  const mkAnnual = (service: AnnualStatus['service'], applicable: boolean): AnnualStatus => {
    const m = matched?.annuals.find(a => a.service === service);
    return m ? { ...m, applicable }
             : { service, applicable, status: 'pending', lastTxnDate: null, lastFyeDate: null, lastAmount: null, history: [] };
  };
  return {
    // Use the AR Reminder row id as the row identity: it's unique within the
    // batch, so rows never collide (a companies-table id could clash with an
    // unmatched row's ar.id). QB lookups key off companyName, not this id.
    companyId: ar.id,
    companyName: ar.entity_name,
    uen: ar.uen ?? matched?.uen ?? null,
    fyeMonth: month,
    pic: ar.pic ?? matched?.pic ?? null,
    ndPic: matched?.ndPic ?? null,
    twActive: matched?.twActive ?? true,
    urgency: matched?.urgency ?? 'not_found',
    renewals: [mkRenewal('Secretary', true), mkRenewal('Address', !!svc.address), mkRenewal('ND', !!svc.nd)],
    annuals: [mkAnnual('AR', true), mkAnnual('XBRL', !!svc.xbrl)],
    email: matched?.email ?? null,
    contactName: matched?.contactName ?? null,
    billedCycles: matched?.billedCycles ?? [],
    priorLines: matched?.priorLines ?? [],
    priorInvoiceDate: matched?.priorInvoiceDate ?? null,
    priorInvoiceNo: matched?.priorInvoiceNo ?? null,
    generatedInvoices: matched?.generatedInvoices ?? [],
  };
}

function BillingTab({ month, year, setMonth, setYear }: { month: string; year: string; setMonth: (v: string) => void; setYear: (v: string) => void }) {
  const [data,       setData]       = useState<{ summary: BillingSummary; companies: CompanyBilling[] } | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [expanded,   setExpanded]   = useState<number | null>(null);
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState<'all' | 'needs' | 'expired' | 'expiring_soon' | 'active'>('all');
  const [withinDays, setWithinDays] = useState(90);

  const [arList, setArList] = useState<ARCompany[]>([]);

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

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  // The master list for a cycle is the AR Reminder (TeamWork-driven, staff-
  // reviewed). Re-fetch it whenever the FYE month/year changes.
  useEffect(() => {
    if (!month || !year) {
      const timer = setTimeout(() => setArList([]), 0);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    fetch(`/api/ar-reminder?month=${encodeURIComponent(month)}&year=${year}`)
      .then(r => r.json())
      .then(j => { if (!cancelled) setArList(j.companies ?? []); })
      .catch(() => { if (!cancelled) setArList([]); });
    return () => { cancelled = true; };
  }, [month, year]);

  useEffect(() => {
    if (expanded === null) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setExpanded(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [expanded]);

  // The billing list for a cycle = the AR Reminder rows for that FYE month/year
  // (the definitive, staff-reviewed set), each joined to its renewals record for
  // accurate fees. Match by normalised name; unmatched AR rows (new companies
  // with no QB history yet) still appear, built from the standard template.
  const renewalByName = useMemo(() => {
    const m = new Map<string, CompanyBilling>();
    for (const c of data?.companies ?? []) m.set(normName(c.companyName), c);
    return m;
  }, [data]);
  const monthCompanies = useMemo(() => {
    const findMatch = (name: string) => {
      const key = normName(name);
      if (renewalByName.has(key)) return renewalByName.get(key);
      for (const [k, v] of renewalByName) if (k.includes(key) || key.includes(k)) return v;
      return undefined;
    };
    return arList.map(ar => arToBillingRow(ar, findMatch(ar.entity_name), month));
  }, [arList, renewalByName, month]);
  // "Needs billing" for month-driven invoicing = this FYE cycle hasn't been
  // invoiced yet. Prefer our own generated_invoices record (exact — we made
  // it) over the billedCycles heuristic (fuzzy-parsed from QB descriptions;
  // still useful as a fallback for invoices created before this feature, or
  // created manually in QB outside this system).
  const currentFye = fyeDateString(month, parseInt(year || '0', 10));
  const generatedThisCycle = (c: CompanyBilling) => (c.generatedInvoices ?? []).filter(g => g.fyeCycle === currentFye);
  // Latest invoice number for this cycle, per QB company — for the dedicated
  // TAB Invoice / TAC Invoice columns. Most recent by createdAt if more than
  // one somehow exists for the same cycle.
  const latestInvoiceNo = (c: CompanyBilling, company: 'TAB' | 'TAC') => {
    const matches = generatedThisCycle(c).filter(g => g.qbCompany === company);
    if (!matches.length) return null;
    return matches.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).invoiceNo;
  };
  const notInvoicedYet = (c: CompanyBilling) =>
    !currentFye ? true
    : generatedThisCycle(c).length > 0 ? false
    : !(c.billedCycles ?? []).includes(currentFye);
  const needsCount = monthCompanies.filter(notInvoicedYet).length;
  const filtered = monthCompanies.filter(c => {
    if (search && !c.companyName.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'needs') return notInvoicedYet(c);
    if (filter === 'active') return !notInvoicedYet(c); // already invoiced this cycle
    if (filter !== 'all' && c.urgency !== filter) return false;
    return true;
  });
  // Paginate AFTER search/filter — search always covers the full cycle list;
  // only rendering is capped at 100 rows per page.
  const { page, setPage, totalPages, pageItems, startIndex, total } =
    usePagination(filtered, `${search}|${filter}|${month}|${year}`);
  const isMobile = useIsMobile();

  const S: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13, background: '#fff', outline: 'none', color: '#1e3a5f' };
  // Counts scoped to the selected FYE month.
  const mCount = { total: monthCompanies.length, needs: needsCount, invoiced: monthCompanies.length - needsCount };

  return (
    <div>
      {/* Controls — month/year shared with AR Reminder */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: isMobile ? 'wrap' : undefined }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#0f766e', display: 'flex', alignItems: 'center', gap: 5 }}><Calendar size={14} />Invoicing FYE</span>
        <select value={month} onChange={e => setMonth(e.target.value)} style={S}>
          {FYE_MONTHS.map(m => <option key={m}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(e.target.value)} style={S}>
          {['2024','2025','2026','2027'].map(y => <option key={y}>{y}</option>)}
        </select>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <select value={withinDays} onChange={e => setWithinDays(+e.target.value)} style={S}>
            <option value={30}>Expiry alert 30d</option>
            <option value={60}>Expiry alert 60d</option>
            <option value={90}>Expiry alert 90d</option>
            <option value={180}>Expiry alert 180d</option>
          </select>
          <button onClick={load} disabled={loading} style={{ ...S, background: '#1d3a5c', color: '#fff', border: 'none', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Stats — click to filter (scoped to the month) */}
      {arList.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: 10, marginBottom: 16 }}>
          {([
            { key: 'all',    label: `AR Reminder · FYE ${month || '—'} ${year}`, sub: 'staff-reviewed batch this cycle', value: mCount.total,    color: '#1d3a5c', bg: '#f8fafc', bd: '#e2e8f0', Icon: FileText     },
            { key: 'needs',  label: 'Needs Billing',               sub: 'not yet invoiced this cycle',  value: mCount.needs,    color: '#c2410c', bg: '#fff7ed', bd: '#fed7aa', Icon: null         },
            { key: 'active', label: 'Invoiced',                    sub: 'already invoiced this cycle',   value: mCount.invoiced, color: '#16a34a', bg: '#f0fdf4', bd: '#bbf7d0', Icon: CheckCircle2 },
          ] as const).map(({ key, label, sub, value, color, bg, bd, Icon }) => {
            const active = filter === key;
            return (
              <button key={key} onClick={() => setFilter(key)}
                style={{ textAlign: 'left', cursor: 'pointer', background: bg, borderRadius: 10, border: `1.5px solid ${active ? color : bd}`, padding: '12px 16px', boxShadow: active ? `0 0 0 2px ${color}22` : 'none' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>{Icon && <Icon size={13} style={{ color }} />}<span style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>{label}</span></div>
                <div style={{ fontSize: 26, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
                <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>{sub}</div>
              </button>
            );
          })}
        </div>
      )}

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {/* Filter */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="text" placeholder="Search company name…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 13, outline: 'none' }} />
        <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{filtered.length} companies</span>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '8px 16px', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>BILLING DRAFTS</span>
          <span style={{ fontSize: 10, color: '#93c5fd', marginLeft: 8 }}>Driven by the AR Reminder cycle (TeamWork + staff review) · fees from QB history · invoices generated only after manual review</span>
        </div>
        <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto' }}>
          {!isMobile && <div style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: '28px minmax(180px,1fr) 110px 70px 170px 100px 190px 120px 120px 90px', columnGap: 4, padding: '8px 12px', background: '#f8fafc', borderLeft: '3px solid transparent', borderBottom: '1px solid #e2e8f0', alignItems: 'center' }}>
            {['', 'Company', 'Billing Status', 'FYE', 'Renewal Services', '', 'Annual Obligations', 'TAB Invoice', 'TAC Invoice', 'PIC'].map((h, i) => (
              i === 5
                ? <div key={i} style={{ fontSize: 10, fontWeight: 700, color: '#9a3412', textTransform: 'uppercase', letterSpacing: '0.4px', padding: '0 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                    ND <span style={{ fontSize: 8, fontWeight: 800, background: '#ffedd5', border: '1px solid #fed7aa', borderRadius: 3, padding: '0 3px' }}>TAC</span>
                  </div>
                : (i >= 2 && i <= 8)
                ? <div key={i} style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', padding: '0 6px', textAlign: 'center', backgroundImage: i === 4 || i === 7 ? 'linear-gradient(to right, #dbe3ee 0, #dbe3ee 1px, transparent 1px)' : 'none' }}>{h}</div>
                : <div key={i} style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', padding: '0 6px' }}>{h}</div>
            ))}
          </div>}
          {loading && !data && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>}
          {!loading && arList.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No AR Reminder batch for {month} {year}. Generate/review it on the AR Reminder tab first.</div>}
          {!loading && arList.length > 0 && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No matching records</div>}
          {pageItems.map((c, i) => {
            const isOpen = expanded === c.companyId;
            const rowBg  = i % 2 === 0 ? '#fff' : '#fafbfc';
            const accent = c.urgency === 'expired' ? '#dc2626' : c.urgency === 'expiring_soon' ? '#f59e0b' : '#16a34a';
            const secR   = c.renewals.find(r => r.service === 'Secretary');
            const addrR  = c.renewals.find(r => r.service === 'Address');
            const ndR    = c.renewals.find(r => r.service === 'ND');
            const arA    = c.annuals.find(a => a.service === 'AR');
            const xbrlA  = c.annuals.find(a => a.service === 'XBRL');
            // Phone: view-only card (no draft modal — that's a desktop task)
            if (isMobile) return (
              <div key={c.companyId} style={{ padding: '10px 12px', borderLeft: `3px solid ${accent}`, borderBottom: '1px solid #f1f5f9', background: rowBg }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 600, paddingTop: 2 }}>{startIndex + i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1e3a5f', lineHeight: 1.3 }}>{c.companyName}</div>
                    {c.uen && <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{c.uen} · FYE {c.fyeMonth ?? '—'}</div>}
                  </div>
                  {notInvoicedYet(c)
                    ? <span style={{ fontSize: 10, fontWeight: 700, background: '#fff7ed', color: '#c2410c', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>To invoice</span>
                    : <span style={{ fontSize: 10, fontWeight: 700, background: '#dcfce7', color: '#15803d', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>✓ Invoiced</span>}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 7 }}>
                  {secR  && <ServiceMini label="SEC"  status={secR.status}  applicable={secR.applicable}  />}
                  {addrR && <ServiceMini label="ADDR" status={addrR.status} applicable={addrR.applicable} />}
                  {ndR   && <ServiceMini label="ND"   status={ndR.status}   applicable={ndR.applicable}   />}
                  {arA   && <ServiceMini label="AR"   status={arA.status}   applicable={arA.applicable}   />}
                  {xbrlA && <ServiceMini label="XBRL" status={xbrlA.status} applicable={xbrlA.applicable} />}
                </div>
                {(latestInvoiceNo(c, 'TAB') || latestInvoiceNo(c, 'TAC') || c.pic) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 10px', marginTop: 7, alignItems: 'center' }}>
                    {latestInvoiceNo(c, 'TAB') && <BillingStatusPill label={`TAB #${latestInvoiceNo(c, 'TAB')}`} color="#1d4ed8" background="#eff6ff" border="#bfdbfe" />}
                    {latestInvoiceNo(c, 'TAC') && <BillingStatusPill label={`TAC #${latestInvoiceNo(c, 'TAC')}`} color="#9a3412" background="#fff7ed" border="#fed7aa" />}
                    {c.pic && <span style={{ fontSize: 10.5, color: '#64748b' }}>PIC: {c.pic}</span>}
                  </div>
                )}
              </div>
            );
            return (
              <div key={c.companyId}>
                <div onClick={() => setExpanded(isOpen ? null : c.companyId)}
                  style={{ display: 'grid', gridTemplateColumns: '28px minmax(180px,1fr) 110px 70px 170px 100px 190px 120px 120px 90px', alignItems: 'center', minHeight: 64, columnGap: 4, padding: '9px 12px', background: isOpen ? '#f0f6ff' : '#fff', borderLeft: `3px solid ${accent}`, borderBottom: '1px solid #edf1f5', cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = '#f0f6ff'; }}
                  onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLElement).style.background = '#fff'; }}>
                  <div style={{ color: '#94a3b8' }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                  <div style={{ padding: '0 6px' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#cbd5e1', fontSize: 10 }}>{startIndex + i + 1}</span>{c.companyName}
                    </div>
                    {c.uen && <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{c.uen}</div>}
                  </div>
                  <div style={{ width: '100%', padding: '0 6px', display: 'flex', justifyContent: 'center', boxSizing: 'border-box' }}>
                    {notInvoicedYet(c)
                      ? <BillingStatusPill label="To invoice" color="#c2410c" background="#fff7ed" border="#fed7aa" />
                      : <BillingStatusPill label="Invoiced" color="#15803d" background="#f0fdf4" border="#bbf7d0" />}
                  </div>
                  <div style={{ width: '100%', padding: '0 6px', fontSize: 11, color: '#64748b', textAlign: 'center', boxSizing: 'border-box' }}>{c.fyeMonth ?? '—'}</div>
                  <div style={{ width: '100%', padding: '2px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, whiteSpace: 'nowrap', boxSizing: 'border-box', backgroundImage: 'linear-gradient(to right, #dbe3ee 0, #dbe3ee 1px, transparent 1px)' }}>
                    {secR  && <ServiceMini label="SEC"  status={secR.status}  applicable={secR.applicable}  />}
                    {addrR && <ServiceMini label="ADDR" status={addrR.status} applicable={addrR.applicable} />}
                  </div>
                  {/* ND is its own column — invoiced separately under TAC, not bundled with the TAB renewal services. */}
                  <div style={{ width: '100%', padding: '0 6px', display: 'flex', justifyContent: 'center', boxSizing: 'border-box' }}>
                    {ndR && <ServiceMini label="ND" status={ndR.status} applicable={ndR.applicable} />}
                  </div>
                  <div style={{ width: '100%', padding: '2px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, whiteSpace: 'nowrap', boxSizing: 'border-box' }}>
                    {arA   && <ServiceMini label="AR"   status={arA.status}   applicable={arA.applicable}   />}
                    {xbrlA && <ServiceMini label="XBRL" status={xbrlA.status} applicable={xbrlA.applicable} />}
                  </div>
                  {/* Latest invoice number for this cycle, per QB company — the
                      authoritative generated_invoices record, not a QB-parsed guess. */}
                  <div style={{ width: '100%', padding: '2px 6px', display: 'flex', justifyContent: 'center', boxSizing: 'border-box', backgroundImage: 'linear-gradient(to right, #dbe3ee 0, #dbe3ee 1px, transparent 1px)' }}>
                    {latestInvoiceNo(c, 'TAB')
                      ? <BillingStatusPill label={`#${latestInvoiceNo(c, 'TAB')}`} color="#1d4ed8" background="#eff6ff" border="#bfdbfe" />
                      : <BillingStatusPill label="Not issued" color="#94a3b8" background="#f8fafc" border="#e2e8f0" />}
                  </div>
                  <div style={{ width: '100%', padding: '0 6px', display: 'flex', justifyContent: 'center', boxSizing: 'border-box' }}>
                    {(() => {
                      // This cycle's system-generated TAC invoice takes priority;
                      // otherwise fall back to the company's most recent ND
                      // invoice from synced history (ND invoices carry a service
                      // period, not an FYE-cycle marker, so they can't be keyed
                      // to cycles the way the TAB backfill was) — shown muted.
                      const gen = latestInvoiceNo(c, 'TAC');
                      if (gen) return <BillingStatusPill label={`#${gen}`} color="#9a3412" background="#fff7ed" border="#fed7aa" />;
                      const ndHist = c.renewals.find(r => r.service === 'ND' && r.applicable)?.history?.[0];
                      if (ndHist?.invoice_no) return (
                        <BillingStatusPill label={`#${ndHist.invoice_no}`} color="#c2712e" background="#fffbf5" border="#fed7aa"
                          title={`Last ND invoice${ndHist.txn_date ? ` · ${fmtDate(ndHist.txn_date)}` : ''} — historical, not this cycle`} muted />
                      );
                      return <BillingStatusPill label="Not issued" color="#94a3b8" background="#f8fafc" border="#e2e8f0" />;
                    })()}
                  </div>
                  <div style={{ padding: '0 6px', fontSize: 11, color: '#374151' }}>{c.pic ?? '—'}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />

      {/* Draft builder modal */}
      {expanded !== null && (() => {
        // Rows come from the AR-Reminder-driven list (companyId = ar.id), so the
        // modal must resolve against that same list — not the raw renewals data.
        const c = monthCompanies.find(x => x.companyId === expanded);
        if (!c) return null;
        return (
          <div onClick={() => setExpanded(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 1040, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <DollarSign size={16} style={{ color: '#93c5fd' }} />
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{c.companyName}</div>
                  <div style={{ fontSize: 11, color: '#93c5fd' }}>{c.uen ?? ''} · FYE {c.fyeMonth ?? '—'} · Build &amp; generate invoice</div>
                </div>
                <button onClick={() => setExpanded(null)} style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><X size={18} /></button>
              </div>
              <ExpandedBillingRow c={c} cycleFye={currentFye || undefined} />
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── AR Detail Modal ───────────────────────────────────────────────────────────
function ARDetailModal({ r, onSave, onClose, onDelete, onServices }: { r: ARRecord; onSave: (id: number, field: string, val: string) => void; onClose: () => void; onDelete: (id: number) => void; onServices?: (id: number, services: Services, manual: Partial<Record<string, boolean>>) => void }) {
  const [showHistory, setShowHistory] = useState(false);
  const [historyRows, setHistoryRows] = useState<AuditEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const response = await fetch(`/api/ar-reminder/history?id=${r.id}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error ?? `HTTP ${response.status}`);
      setHistoryRows(json.history ?? []);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Could not load history');
    } finally {
      setHistoryLoading(false);
    }
  }, [r.id]);

  const restoreHistory = useCallback(async (entry: AuditEntry) => {
    setRestoringId(entry.id);
    setHistoryError('');
    try {
      const response = await fetch('/api/ar-reminder/history', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditId: entry.id }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.message ?? json.error ?? `HTTP ${response.status}`);
      onSave(r.id, json.field, String(json.value ?? ''));
      await loadHistory();
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : 'Restore failed');
    } finally {
      setRestoringId(null);
    }
  }, [loadHistory, onSave, r.id]);

  // Toggle a service override: default is AUTO; one click flips the current
  // effective state (a lit badge becomes manual-OFF, an unlit one manual-ON —
  // always a visible change); clicking again restores AUTO. Optimistic local
  // update; the PATCH persists it on companies.services_manual where no
  // automation ever writes.
  const cycleService = async (svc: string) => {
    if (!r.company_id) return;
    const cur = r.servicesManual?.[svc];
    const auto = (r.servicesAuto as Record<string, boolean> | undefined)?.[svc] ?? false;
    const next = cur === undefined ? !auto : null;
    const newManual = { ...(r.servicesManual ?? {}) };
    if (next === null) delete newManual[svc]; else newManual[svc] = next;
    const newServices = { ...r.services, [svc]: next === null ? auto : next } as Services;
    onServices?.(r.id, newServices, newManual);
    const res = await fetch('/api/companies/service-override', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId: r.company_id, service: svc, value: next }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      alert(`Save failed: ${j.error ?? res.status}`);
    }
  };
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
            <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginLeft: 16 }}>
              <button onClick={() => { const next = !showHistory; setShowHistory(next); if (next) void loadHistory(); }} title="Change history"
                style={{ background: showHistory ? 'rgba(59,130,246,0.34)' : 'rgba(255,255,255,0.12)', border: 'none', color: '#dbeafe', borderRadius: 8, height: 32, padding: '0 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700 }}>
                <History size={14} /> History
              </button>
              <button onClick={() => onDelete(r.id)} title="Remove this company"
                style={{ background: 'rgba(220,38,38,0.18)', border: 'none', color: '#fecaca', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Trash2 size={15} />
              </button>
              <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
          </div>
          {/* Row 2: UEN · FYE · due badge */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            {r.uen && <span style={{ fontSize: 11, color: '#fff', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4 }}>{r.uen}</span>}
            {r.fye_date && (
              <>
                <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                <span style={{ fontSize: 11, color: '#fff' }}>FYE {fmtDate(r.fye_date)}</span>
              </>
            )}
            <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
            <DueBadge days={r.daysUntilDue} filed={filed} />
          </div>
          {/* Row 3: service chips — Secretary/Accounts/Tax/XBRL are clickable
              (auto → manual on → manual off); ND/Address follow TeamWork.
              Blue = auto-detected · green = manually on · grey = off. */}
          <div style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: '14px 16px 16px', boxShadow: '0 3px 12px rgba(15,23,42,0.12)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginBottom: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <ShieldCheck size={14} style={{ color: '#1d4ed8' }} />
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: '#1e3a5f' }}>Service configuration</span>
                  <span style={{ padding: '2px 6px', borderRadius: 999, background: '#fff7ed', color: '#b45309', fontSize: 7.5, fontWeight: 800, letterSpacing: '0.35px' }}>REVIEW BEFORE BILLING</span>
                </div>
                <div style={{ fontSize: 9.5, color: '#64748b', marginTop: 5, lineHeight: 1.5 }}>Click an adjustable service to override the system result. Click again to restore automatic detection.</div>
              </div>
              <div style={{ display: 'flex', gap: 13, flexShrink: 0, fontSize: 8, fontWeight: 700 }}>
                <span style={{ color: '#64748b' }}>AUTO · System</span>
                <span style={{ color: '#15803d' }}>● Manual</span>
                <span style={{ color: '#94a3b8' }}>Grey · Off</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,0.7fr) minmax(500px,2fr)', gap: 20, alignItems: 'center' }}>
              <div style={{ padding: '4px 0' }}>
                <div style={{ fontSize: 7.5, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.5px', marginBottom: 9 }}>SYSTEM MANAGED</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {activeSvc.filter(k => !(OVERRIDABLE_SVC as readonly string[]).includes(k)).map(k => {
                    const svc = SVC[k];
                    return <span key={k} title={`${svc.label}: automatic${['nd','address'].includes(k) ? ' (follows TeamWork)' : ''}`} style={{ background: svc.bg, color: svc.color, border: `1px solid ${svc.color}30`, borderRadius: 999, padding: '8px 12px', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 7 }}><span>{svc.label}</span><span style={{ fontSize: 7, opacity: 0.65, letterSpacing: '0.35px' }}>LOCKED</span></span>;
                  })}
                </div>
              </div>

              <div style={{ borderLeft: '1px solid #e2e8f0', padding: '4px 0 4px 20px' }}>
                <div style={{ fontSize: 7.5, fontWeight: 800, color: '#64748b', letterSpacing: '0.5px', marginBottom: 9 }}>ADJUSTABLE · CLICK TO CHANGE</div>
                <div style={{ display: 'flex', gap: 10, rowGap: 9, flexWrap: 'wrap' }}>
                  {OVERRIDABLE_SVC.map(k => (
                    <OverrideChip key={k} svc={k}
                      effective={r.services[k as keyof Services]}
                      manual={r.servicesManual?.[k]}
                      disabled={!r.company_id}
                      onCycle={() => cycleService(k)} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {showHistory && (
            <div style={{ margin: '16px 24px 0', border: '1px solid #dbe3ee', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
              <div style={{ padding: '10px 13px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#1e3a5f' }}>Change history</div>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>Every saved change records who changed it. Restore is protected against newer edits.</div>
                </div>
                <button onClick={() => void loadHistory()} disabled={historyLoading} style={{ border: '1px solid #cbd5e1', background: '#fff', color: '#475569', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', display: 'flex' }}><RefreshCw size={11} /></button>
              </div>
              {historyError && <div style={{ padding: '8px 13px', background: '#fef2f2', color: '#b91c1c', fontSize: 10 }}>{historyError}</div>}
              {historyLoading && historyRows.length === 0 ? (
                <div style={{ padding: 18, textAlign: 'center', color: '#94a3b8', fontSize: 10 }}>Loading history…</div>
              ) : historyRows.length === 0 ? (
                <div style={{ padding: 18, textAlign: 'center', color: '#94a3b8', fontSize: 10 }}>No saved changes yet.</div>
              ) : (
                <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {historyRows.map((entry, index) => (
                    <div key={entry.id} style={{ padding: '9px 13px', borderBottom: index < historyRows.length - 1 ? '1px solid #f1f5f9' : 'none', display: 'grid', gridTemplateColumns: '110px minmax(0,1fr) 150px 66px', gap: 10, alignItems: 'center' }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: '#475569' }}>{AR_FIELD_LABELS[entry.field_name] ?? entry.field_name}</div>
                      <div style={{ minWidth: 0, fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{historyValue(entry.old_value)}</span>
                        <span style={{ color: '#cbd5e1' }}>→</span>
                        <span style={{ color: '#1e3a5f', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{historyValue(entry.new_value)}</span>
                      </div>
                      <div style={{ fontSize: 9, color: '#64748b' }}>
                        <div style={{ fontWeight: 700 }}>{entry.changed_by_name ?? entry.changed_by_email ?? 'System'}</div>
                        <div style={{ color: '#94a3b8', marginTop: 2 }}>{new Date(entry.changed_at).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })}</div>
                      </div>
                      <button onClick={() => void restoreHistory(entry)} disabled={restoringId !== null}
                        style={{ border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 6, padding: '4px 6px', fontSize: 9, fontWeight: 700, cursor: restoringId !== null ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
                        <RotateCcw size={9} />{restoringId === entry.id ? 'Restoring' : 'Restore'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <DetailPanel r={r} onSave={onSave} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AR TABLE VIEW
// ─────────────────────────────────────────────────────────────────────────────
function ARTableView({ records, onSave, onDelete, startIndex = 0 }: { records: ARRecord[]; onSave: (id: number, field: string, val: string) => void; onDelete: (id: number) => void; startIndex?: number }) {
  // Finance columns get a teal header + tinted cell bg
  const FIN_HDR = '#0f766e';
  const FIN_CELL = 'rgba(20,184,166,0.06)';

  const outerRef  = useRef<HTMLDivElement>(null);
  const thumbRef  = useRef<HTMLDivElement>(null);
  const sbRef     = useRef<HTMLDivElement>(null);
  const dragging  = useRef(false);
  const dragRef   = useRef({ startX: 0, startScroll: 0 });
  const metaRef   = useRef({ tw: 0, sbW: 0 });
  const [picOpen, setPicOpen] = useState({ sec: true, acc: false, tax: false });

  const picHeader = (key: keyof typeof picOpen, label: string) => {
    const open = picOpen[key];
    return (
      <TH w={open ? 100 : 34} center>
        <button
          type="button"
          onClick={() => setPicOpen(current => ({ ...current, [key]: !current[key] }))}
          title={open ? `Collapse ${label} to the left` : `Expand ${label}`}
          style={{
            width: '100%', padding: 0, border: 0, background: 'transparent', color: '#fff',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: open ? 4 : 1, fontSize: open ? 9 : 8, fontWeight: 700,
          }}
        >
          {open ? <ChevronLeft size={11} /> : <ChevronRight size={10} />}
          <span>{open ? label : label.replace(' PIC', '')}</span>
        </button>
      </TH>
    );
  };

  // Direct DOM update — zero React re-renders per scroll tick
  const updateSb = () => {
    const el    = outerRef.current;
    const thumb = thumbRef.current;
    const sb    = sbRef.current;
    if (!el || !thumb || !sb) return;
    const rect = el.getBoundingClientRect();
    sb.style.left  = `${rect.left}px`;
    sb.style.width = `${rect.width}px`;
    if (el.scrollWidth <= el.clientWidth) { sb.style.display = 'none'; return; }
    sb.style.display = 'block';
    const tw = Math.max(rect.width * (el.clientWidth / el.scrollWidth), 40);
    metaRef.current = { tw, sbW: rect.width };
    const maxScroll = el.scrollWidth - el.clientWidth;
    const tl = maxScroll > 0 ? (el.scrollLeft / maxScroll) * (rect.width - tw) : 0;
    thumb.style.width = `${tw}px`;
    thumb.style.left  = `${tl}px`;
  };

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
  }, []);

  const TH = ({ children, w, center, finance, stickyLeft, lastSticky }: { children: React.ReactNode; w: number; center?: boolean; finance?: boolean; stickyLeft?: number; lastSticky?: boolean }) => (
    <th style={{
      position: 'sticky', top: 0, zIndex: stickyLeft !== undefined ? 3 : 2,
      left: stickyLeft !== undefined ? stickyLeft : undefined,
      background: finance ? FIN_HDR : '#1d3a5c', color: '#fff',
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
      padding: '7px 8px', whiteSpace: 'nowrap', minWidth: w, width: w,
      textAlign: center ? 'center' : 'left',
      borderRight: finance ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(255,255,255,0.12)',
      boxShadow: lastSticky ? '3px 0 8px -2px rgba(0,0,0,0.18)' : undefined,
    }}>{children}</th>
  );

  const TD = ({ children, style, finance, stickyLeft, lastSticky }: { children: React.ReactNode; style?: React.CSSProperties; finance?: boolean; stickyLeft?: number; lastSticky?: boolean }) => (
    <td style={{
      padding: '3px 6px', verticalAlign: 'top',
      borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9',
      background: finance ? FIN_CELL : stickyLeft !== undefined ? '#fff' : undefined,
      wordBreak: 'break-word', overflowWrap: 'break-word',
      position: stickyLeft !== undefined ? 'sticky' : undefined,
      left: stickyLeft !== undefined ? stickyLeft : undefined,
      zIndex: stickyLeft !== undefined ? 1 : undefined,
      boxShadow: lastSticky ? '3px 0 8px -2px rgba(0,0,0,0.12)' : undefined,
      ...style,
    }}>{children}</td>
  );

  return (
    <>
    <div ref={outerRef} style={{ overflowX: 'hidden', overflowY: 'auto', maxHeight: 'calc(100vh - 300px)', background: '#fff', borderRadius: '0 0 12px 12px', border: '1px solid #e2e8f0', borderTop: 'none' }}>
      <table style={{ borderCollapse: 'collapse', tableLayout: 'fixed', width: 'max-content', fontSize: 11 }}>
        <thead>
          <tr>
            <TH w={30} center stickyLeft={0}>#</TH>
            <TH w={200} stickyLeft={30}>Company Name</TH>
            <TH w={80} stickyLeft={230} lastSticky>UEN</TH>
            <TH w={100}>Reminder</TH>
            <TH w={100}>Report Ready</TH>
            <TH w={100}>AGM</TH>
            <TH w={100}>To Client</TH>
            <TH w={100}>Signed</TH>
            <TH w={100}>AR</TH>
            <TH w={100}>XBRL</TH>
            <TH w={100}>TW Update</TH>
            <TH w={100}>DPO</TH>
            <TH w={100}>ROND RONS</TH>
            {picHeader('sec', 'SEC PIC')}
            {picHeader('acc', 'ACC PIC')}
            {picHeader('tax', 'TAX PIC')}
            <TH w={180}>Remarks</TH>
            <TH w={150} finance>Invoice</TH>
            <TH w={150} finance>Email Sent</TH>
            <TH w={44} center>{''}</TH>
          </tr>
        </thead>
        <tbody>
          {records.length === 0 && (
            <tr><td colSpan={20} style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>No records</td></tr>
          )}
          {records.map((r, i) => {
            const filed   = r.stages.arFiled;
            const overdue = !filed && r.daysUntilDue !== null && r.daysUntilDue < 0;
            const inProg  = !filed && (r.stages.sentToClient || r.stages.docsReceived || r.stages.agmHeld);
            const rowBg   = filed ? '#f0fdf4' : overdue ? '#fff1f2' : inProg ? '#fffbeb' : i % 2 === 0 ? '#fff' : '#fafbfc';
            const accent  = filed ? '#16a34a' : overdue ? '#dc2626' : inProg ? '#f59e0b' : '#e2e8f0';
            return (
              <tr key={r.id} style={{ background: rowBg }}>
                <TD stickyLeft={0} style={{ textAlign: 'center', color: '#94a3b8', fontSize: 10, fontWeight: 600, borderLeft: `3px solid ${accent}` }}>{startIndex + i + 1}</TD>
                <TD stickyLeft={30}>
                  <div style={{ fontWeight: 700, color: '#1e3a5f', lineHeight: 1.3 }}>{r.entity_name}</div>
                  {r.fye_date && <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 1 }}>FYE {fmtDate(r.fye_date)}</div>}
                </TD>
                <TD stickyLeft={230} lastSticky><span style={{ fontSize: 10, color: '#64748b' }}>{r.uen || '—'}</span></TD>
                <TD><EditField id={r.id} field="reminder_note"   value={r.reminder_note}   onSave={onSave} placeholder="—" isDate /></TD>
                <TD><EditField id={r.id} field="prepared_date"   value={r.prepared_date}   onSave={onSave} placeholder="—" isDate /></TD>
                <TD><EditField id={r.id} field="date_of_agm"     value={r.date_of_agm}     onSave={onSave} placeholder="—" isDate /></TD>
                <TD><EditField id={r.id} field="sent_date"       value={r.sent_date}       onSave={onSave} placeholder="—" isDate /></TD>
                <TD><EditField id={r.id} field="received_date"   value={r.received_date}   onSave={onSave} placeholder="—" isDate /></TD>
                <TD><EditField id={r.id} field="filling_date"    value={r.filling_date}    onSave={onSave} placeholder="—" isDate /></TD>
                <TD><SelectField id={r.id} field="xbrl"          value={r.xbrl}            onSave={onSave} options={XBRL_OPTIONS} /></TD>
                <TD><EditField id={r.id} field="software_update" value={r.software_update} onSave={onSave} placeholder="—" isDate /></TD>
                <TD><SelectField id={r.id} field="dpo"           value={r.dpo}             onSave={onSave} options={DPO_OPTIONS} /></TD>
                <TD><SelectField id={r.id} field="ond_ron"       value={r.ond_ron}         onSave={onSave} options={ROND_OPTIONS} /></TD>
                <TD style={!picOpen.sec ? { padding: 0 } : undefined}>{picOpen.sec && <EditField id={r.id} field="pic"     value={r.pic}     onSave={onSave} placeholder="—" />}</TD>
                <TD style={!picOpen.acc ? { padding: 0 } : undefined}>{picOpen.acc && <EditField id={r.id} field="acc_pic" value={r.acc_pic} onSave={onSave} placeholder="—" />}</TD>
                <TD style={!picOpen.tax ? { padding: 0 } : undefined}>{picOpen.tax && <EditField id={r.id} field="tax_pic" value={r.tax_pic} onSave={onSave} placeholder="—" />}</TD>
                <TD><EditField id={r.id} field="remarks"         value={r.remarks}         onSave={onSave} placeholder="—" /></TD>
                <TD finance><EditField id={r.id} field="ar_status"       value={r.ar_status}       onSave={onSave} placeholder="—" /></TD>
                <TD finance><EditField id={r.id} field="accounts_status" value={r.accounts_status} onSave={onSave} placeholder="—" isDate /></TD>
                <TD style={{ textAlign: 'center' }}>
                  <button onClick={() => onDelete(r.id)} title="Remove"
                    style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', cursor: 'pointer', display: 'inline-flex' }}>
                    <Trash2 size={11} />
                  </button>
                </TD>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {/* Custom scrollbar — DOM-only updates, zero React re-renders on scroll */}
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
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AR TAB
// ─────────────────────────────────────────────────────────────────────────────
function ARTab({ month, year, setMonth, setYear }: { month: string; year: string; setMonth: (v: string) => void; setYear: (v: string) => void }) {
  const [records,     setRecords]     = useState<ARRecord[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [modalRecord, setModalRecord] = useState<ARRecord | null>(null);
  const [search,      setSearch]      = useState('');
  const [filter,      setFilter]      = useState('all');
  const [view,        setView]        = useState<'list' | 'table'>('list');
  const [liveNotice,  setLiveNotice]  = useState('');

  const load = useCallback(async () => {
    if (!month || !year) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/ar-reminder?month=${month}&year=${year}`);
      const json = await res.json();
      if (json.error) { setError(json.error); return; }
      setRecords(json.companies ?? []);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Network error'); }
    finally { setLoading(false); }
  }, [month, year]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!month || !year) return;
    const supabase = getSupabaseBrowserClient();
    let noticeTimer: ReturnType<typeof setTimeout> | null = null;
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    const showNotice = (name: string | null | undefined) => {
      setLiveNotice(name ? `Live update from ${name}` : 'Live update received');
      if (noticeTimer) clearTimeout(noticeTimer);
      noticeTimer = setTimeout(() => setLiveNotice(''), 2600);
    };
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void load(), 700);
    };

    const channel = supabase
      .channel(`ar-reminder-${year}-${month}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ar_reminder', filter: `fye_year=eq.${year}` }, payload => {
        const next = payload.new as Partial<ARRecord> & { id?: number; fye_month?: string; fye_year?: number; status?: string };
        const previous = payload.old as Partial<ARRecord> & { id?: number };
        const id = next.id ?? previous.id;
        if (!id) return;
        if (payload.eventType !== 'DELETE' && (next.fye_month !== month || Number(next.fye_year) !== Number(year))) return;

        if (payload.eventType === 'DELETE' || next.status === 'Excluded') {
          setRecords(current => current.filter(record => record.id !== id));
          setModalRecord(current => current?.id === id ? null : current);
          showNotice(next.updated_by_name);
          return;
        }

        if (payload.eventType === 'UPDATE') {
          const merge = (record: ARRecord) => {
            if (record.id !== id) return record;
            return recomputeArRecord({ ...record, ...next } as ARRecord);
          };
          setRecords(current => current.map(merge));
          setModalRecord(current => current?.id === id ? merge(current) : current);
          showNotice(next.updated_by_name);
          return;
        }

        // New rows need normal service/QB enrichment, so coalesce bursts of
        // generator inserts into one normal reload.
        showNotice(next.updated_by_name);
        scheduleReload();
      })
      .subscribe();

    return () => {
      if (noticeTimer) clearTimeout(noticeTimer);
      if (reloadTimer) clearTimeout(reloadTimer);
      void supabase.removeChannel(channel);
    };
  }, [load, month, year]);

  const handleSave = useCallback((id: number, field: string, value: string) => {
    const updated = (r: ARRecord) => r.id === id ? recomputeArRecord({ ...r, [field]: value || null }) : r;
    setRecords(prev => prev.map(updated));
    setModalRecord(prev => prev && prev.id === id ? recomputeArRecord({ ...prev, [field]: value || null }) : prev);
  }, []);

  // Optimistic local sync after a service-override cycle in the modal.
  const handleServices = useCallback((id: number, services: Services, manual: Partial<Record<string, boolean>>) => {
    setRecords(prev => prev.map(r => r.id === id ? { ...r, services, servicesManual: manual } : r));
    setModalRecord(prev => prev && prev.id === id ? { ...prev, services, servicesManual: manual } : prev);
  }, []);

  const [pendingDeleteId, setPendingDeleteId] = useState<number | null>(null);
  const handleDelete = useCallback((id: number) => setPendingDeleteId(id), []);

  const confirmDelete = useCallback(async () => {
    const id = pendingDeleteId;
    if (id == null) return;
    setPendingDeleteId(null);
    await fetch('/api/ar-reminder', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    setRecords(prev => prev.filter(r => r.id !== id));
    setModalRecord(prev => prev && prev.id === id ? null : prev);
  }, [pendingDeleteId]);

  // ── Add Manual ──────────────────────────────────────────────────────────
  const [showAddForm, setShowAddForm] = useState(false);
  const [adding,      setAdding]      = useState(false);
  const [newEntity,   setNewEntity]   = useState('');
  const [newUen,      setNewUen]      = useState('');
  const [newPic,      setNewPic]      = useState('');
  const [newDueDate,  setNewDueDate]  = useState('');

  const saveNewEntity = async () => {
    if (!newEntity.trim()) return;
    setAdding(true);
    try {
      const res = await fetch('/api/ar-reminder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_name: newEntity.trim(), fye_month: month, fye_year: year, uen: newUen || null, pic: newPic || null, due_date: newDueDate || null }),
      });
      const json = await res.json();
      if (json.error) { alert(json.error); return; }
      setShowAddForm(false); setNewEntity(''); setNewUen(''); setNewPic(''); setNewDueDate('');
      load();
    } finally { setAdding(false); }
  };

  const filtered = useMemo(() => records.filter(r => {
    if (search && !r.entity_name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'filed')       return r.stages.arFiled;
    if (filter === 'in_progress') return r.stagesDone > 0 && !r.stages.arFiled;
    if (filter === 'pending')     return r.stagesDone === 0;
    if (filter === 'overdue')     return !r.stages.arFiled && r.daysUntilDue !== null && r.daysUntilDue < 0;
    return true;
  }), [records, search, filter]);

  const stats = useMemo(() => ({
    total:      records.length,
    filed:      records.filter(r => r.stages.arFiled).length,
    inProgress: records.filter(r => r.stagesDone > 0 && !r.stages.arFiled).length,
    pending:    records.filter(r => r.stagesDone === 0).length,
    overdue:    records.filter(r => !r.stages.arFiled && r.daysUntilDue !== null && r.daysUntilDue < 0).length,
  }), [records]);

  // Paginate AFTER search/filter — shared by both List and Table views.
  const { page, setPage, totalPages, pageItems, startIndex, total: pagedTotal } =
    usePagination(filtered, `${search}|${filter}|${month}|${year}`, 40);
  const isMobile = useIsMobile();

  const S: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13, color: '#1e3a5f', background: '#fff', cursor: 'pointer', outline: 'none' };

  return (
    <div>
      {liveNotice && (
        <div style={{ position: 'fixed', right: 22, bottom: 22, zIndex: 1500, background: '#0f766e', color: '#fff', borderRadius: 9, padding: '8px 12px', fontSize: 10.5, fontWeight: 700, boxShadow: '0 8px 24px rgba(15,118,110,0.25)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#5eead4' }} />{liveNotice}
        </div>
      )}
      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 14, flexWrap: isMobile ? 'wrap' : undefined }}>
        <select value={month} onChange={e => setMonth(e.target.value)} style={S}>
          {FYE_MONTHS.map(m => <option key={m}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(e.target.value)} style={S}>
          {['2024','2025','2026','2027'].map(y => <option key={y}>{y}</option>)}
        </select>
        <button onClick={load} disabled={loading} style={{ ...S, display: 'flex', alignItems: 'center', gap: 6, background: '#1d3a5c', color: '#fff', border: 'none', fontWeight: 600 }}>
          <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          {loading ? 'Loading…' : 'Refresh'}
        </button>
        <button onClick={() => setShowAddForm(v => !v)} style={{ ...S, display: 'flex', alignItems: 'center', gap: 6, background: '#1d3a5c', color: '#fff', border: 'none', fontWeight: 600 }}>
          <Plus size={13} />Add Manual
        </button>
      </div>

      {/* Add Manual form */}
      {showAddForm && (
        <div style={{ background: '#faf5ff', border: '1.5px solid #ddd6fe', borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: '#6d28d9', marginBottom: 10 }}>Add Manual Entry — FYE {month} {year}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Company Name *</div>
              <input value={newEntity} onChange={e => setNewEntity(e.target.value)}
                style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>UEN</div>
              <input value={newUen} onChange={e => setNewUen(e.target.value)}
                style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>PIC</div>
              <input value={newPic} onChange={e => setNewPic(e.target.value)}
                style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13 }} />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 2 }}>Due Date</div>
              <input type="date" value={newDueDate} onChange={e => setNewDueDate(e.target.value)}
                style={{ width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 13 }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={saveNewEntity} disabled={adding || !newEntity.trim()}
              style={{ padding: '6px 16px', borderRadius: 6, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={14} />{adding ? 'Saving…' : 'Save'}
            </button>
            <button onClick={() => setShowAddForm(false)}
              style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <X size={14} />Cancel
            </button>
          </div>
        </div>
      )}

      {/* Stats — click a card to filter */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
        {([
          { key: 'all',         label: 'Total Companies', sub: 'in this FYE cycle',       value: stats.total,      color: '#1d3a5c', bg: '#f8fafc', bd: '#e2e8f0', Icon: FileText      },
          { key: 'filed',       label: 'AR Filed',        sub: 'annual return filed',     value: stats.filed,      color: '#16a34a', bg: '#f0fdf4', bd: '#bbf7d0', Icon: CheckCircle2  },
          { key: 'in_progress', label: 'In Progress',     sub: 'some steps done',         value: stats.inProgress, color: '#b45309', bg: '#fffbeb', bd: '#fde68a', Icon: Clock         },
          { key: 'pending',     label: 'Not Started',     sub: 'no steps yet',            value: stats.pending,    color: '#64748b', bg: '#f8fafc', bd: '#e2e8f0', Icon: Calendar      },
          { key: 'overdue',     label: 'Overdue',         sub: 'past due, not filed',     value: stats.overdue,    color: '#dc2626', bg: '#fef2f2', bd: '#fecaca', Icon: AlertTriangle },
        ] as const).map(({ key, label, sub, value, color, bg, bd, Icon }) => {
          const active = filter === key;
          return (
            <button key={key} onClick={() => setFilter(key)}
              style={{ textAlign: 'left', cursor: 'pointer', background: bg, borderRadius: 10, border: `1.5px solid ${active ? color : bd}`, padding: '12px 14px', boxShadow: active ? `0 0 0 2px ${color}22` : 'none' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}><Icon size={13} style={{ color }} /><span style={{ fontSize: 10, color: '#64748b', fontWeight: 700 }}>{label}</span></div>
              <div style={{ fontSize: 24, fontWeight: 800, color, lineHeight: 1 }}>{value}</div>
              <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 3 }}>{sub}</div>
            </button>
          );
        })}
      </div>

      {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {/* Search + view toggle */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input type="text" placeholder="Search company name…" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 13, outline: 'none' }} />
        {filter !== 'all' && (
          <button onClick={() => setFilter('all')} style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer', whiteSpace: 'nowrap' }}>Clear filter ✕</button>
        )}
        <span style={{ fontSize: 11, color: '#94a3b8' }}>{filtered.length} companies</span>
        {/* View toggle — desktop only; phones always get the card list */}
        {!isMobile && <div style={{ display: 'flex', gap: 3, marginLeft: 'auto', background: '#f1f5f9', borderRadius: 7, padding: 3 }}>
          {([{ k: 'list', icon: '☰', label: 'List' }, { k: 'table', icon: '⊞', label: 'Table' }] as const).map(({ k, icon, label }) => (
            <button key={k} onClick={() => setView(k)} style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 5, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, background: view === k ? '#1d3a5c' : 'transparent', color: view === k ? '#fff' : '#64748b', transition: 'all 0.15s' }}>
              <span>{icon}</span>{label}
            </button>
          ))}
        </div>}
      </div>

      {/* List view */}
      {(view === 'list' || isMobile) && (
        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={13} style={{ color: '#93c5fd' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>FYE {month.toUpperCase()} {year}</span>
            <span style={{ fontSize: 10, color: '#93c5fd', marginLeft: 8 }}>Click row to open full details & edit</span>
          </div>
          {!isMobile && <div style={{ display: 'grid', gridTemplateColumns: '28px minmax(300px,1.45fr) 100px minmax(260px,1fr) 100px 120px', padding: '7px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
            {['', 'Company Name', 'UEN', 'Services', 'Due Date', 'PIC'].map((h, i) => (
              <div key={i} style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', padding: '0 6px' }}>{h}</div>
            ))}
          </div>}
          <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto', background: '#fff' }}>
            {loading && records.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>Loading…</div>}
            {!loading && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>{records.length > 0 ? 'No matching records' : `No records for FYE ${month} ${year}`}</div>}
            {pageItems.map((r, i) => {
              const filed     = r.stages.arFiled;
              const accent    = filed ? '#16a34a' : r.stagesDone > 0 ? '#f59e0b' : '#e2e8f0';
              const rowBg     = i % 2 === 0 ? '#ffffff' : '#fafbfc';
              const activeSvc = Object.entries(r.services).filter(([, v]) => v).map(([k]) => k);
              // Phone: view-only card (workflow editing is a desktop task)
              if (isMobile) return (
                <div key={r.id} style={{ padding: '10px 12px', borderLeft: `3px solid ${accent}`, borderBottom: '1px solid #f1f5f9', background: rowBg }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 600, paddingTop: 2 }}>{startIndex + i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a5f', lineHeight: 1.3 }}>{r.entity_name}</div>
                      <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 1 }}>{r.uen || '—'}{r.fye_date ? ` · FYE ${fmtDate(r.fye_date)}` : ''}</div>
                    </div>
                    <DueBadge days={r.daysUntilDue} filed={r.stages.arFiled} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 7, alignItems: 'center' }}>
                    {activeSvc.map(k => {
                      const st = SVC_STATE_STYLE[svcStateOf(r.services, r.servicesManual, k)];
                      return <span key={k} style={{ background: st.bg, color: st.color, border: `1px solid ${st.bd}`, borderRadius: 3, padding: '1px 5px', fontSize: 10, fontWeight: 700 }}>{SVC[k].label}</span>;
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 7, fontSize: 10.5, color: '#64748b' }}>
                    <span>Progress: <span style={{ fontWeight: 700, color: filed ? '#16a34a' : r.stagesDone > 0 ? '#b45309' : '#94a3b8' }}>{r.stagesDone}/5{filed ? ' · Filed' : ''}</span></span>
                    {r.pic && <span>PIC: {r.pic}</span>}
                  </div>
                </div>
              );
              return (
                <div key={r.id}
                  onClick={() => setModalRecord(r)}
                  style={{ display: 'grid', gridTemplateColumns: '28px minmax(300px,1.45fr) 100px minmax(260px,1fr) 100px 120px', alignItems: 'center', minHeight: 64, padding: '8px 12px', background: '#fff', borderLeft: `3px solid ${accent}`, borderBottom: '1px solid #edf1f5', cursor: 'pointer', transition: 'background 0.15s' }}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}
                >
                  <div style={{ color: '#94a3b8', display: 'flex', alignItems: 'center' }}><ChevronRight size={14} /></div>
                  <div style={{ padding: '0 6px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#1e3a5f', lineHeight: 1.3 }}><span style={{ color: '#cbd5e1', marginRight: 5, fontSize: 11 }}>{startIndex + i + 1}</span>{r.entity_name}</div>
                    {r.fye_date && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>FYE {fmtDate(r.fye_date)}</div>}
                  </div>
                  <div style={{ padding: '0 6px', fontSize: 13, color: '#64748b' }}>{r.uen || <span style={{ color: '#e2e8f0' }}>—</span>}</div>
                  {/* Fixed slots in fixed order — every service always in the
                      same position, so rows align and differences pop out.
                      Blue = auto · green = manual on · grey = off. */}
                  <div style={{ margin: '0 6px', padding: '2px 0 2px 14px', minHeight: 32, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, borderLeft: '1px solid #dbe3ee' }}>
                    {SVC_ORDER.filter(k => r.services[k]).map(k => {
                      const state = svcStateOf(r.services, r.servicesManual, k);
                      const svc = SVC[k];
                      return (
                        <span key={k} title={`${SVC[k].label} — ${state === 'auto-on' ? 'auto' : state === 'manual-on' ? 'manually on' : 'not provided / off'}`}
                          style={{ background: svc.bg, color: svc.color, border: `1px solid ${svc.color}20`, borderRadius: 999, padding: '4px 9px', fontSize: 10.5, fontWeight: 700, letterSpacing: '0.15px', display: 'inline-flex', alignItems: 'center', gap: 5, whiteSpace: 'nowrap' }}>
                          {state === 'manual-on' && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#16a34a', flexShrink: 0 }} />}
                          {SVC_SHORT[k]}
                        </span>
                      );
                    })}
                    {SVC_ORDER.every(k => !r.services[k]) && <span style={{ fontSize: 11, color: '#94a3b8' }}>No active services</span>}
                  </div>
                  <div style={{ padding: '0 6px' }}><DueBadge days={r.daysUntilDue} filed={r.stages.arFiled} /></div>
                  <div style={{ padding: '0 6px', fontSize: 14, color: '#374151', fontWeight: 500 }}>{r.pic || <span style={{ color: '#e2e8f0' }}>—</span>}</div>
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: '1px solid #f1f5f9', padding: '6px 16px', background: '#f8fafc' }}>
            <span style={{ fontSize: 11, color: '#cbd5e1' }}>Left border: green = AR filed · amber = in progress · grey = not started · Click any row to open details</span>
          </div>
        </div>
      )}

      {/* Table view — desktop only */}
      {view === 'table' && !isMobile && (
        <>
          <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', borderRadius: '10px 10px 0 0', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Calendar size={13} style={{ color: '#93c5fd' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: '#fff' }}>FYE {month.toUpperCase()} {year}</span>
            <span style={{ fontSize: 10, color: '#93c5fd', marginLeft: 8 }}>Click any cell to edit · Data syncs with List view in real time</span>
          </div>
          {loading && records.length === 0
            ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>Loading…</div>
            : <ARTableView records={pageItems} onSave={handleSave} onDelete={handleDelete} startIndex={startIndex} />
          }
        </>
      )}

      <PaginationBar page={page} totalPages={totalPages} total={pagedTotal} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />

      {/* Modal */}
      {modalRecord && (
        <ARDetailModal
          r={modalRecord}
          onSave={handleSave}
          onClose={() => setModalRecord(null)}
          onDelete={handleDelete}
          onServices={handleServices}
        />
      )}

      {pendingDeleteId != null && (
        <ConfirmDeleteModal
          label={records.find(r => r.id === pendingDeleteId)?.entity_name ?? 'this record'}
          onCancel={() => setPendingDeleteId(null)}
          onConfirm={confirmDelete}
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

  // Month/year is shared across both tabs — invoicing is organised by FYE month,
  // so Billing Drafts and AR Reminder always look at the same batch of companies.
  const [month, setMonth] = useState('');
  const [year,  setYear]  = useState('');
  useEffect(() => {
    fetch('/api/ar-reminder/latest')
      .then(r => r.json())
      .then(({ month: m, year: y }) => { setMonth(String(m)); setYear(String(y)); })
      .catch(() => { setMonth('January'); setYear(String(new Date().getFullYear())); });
  }, []);

  const switchTab = (t: 'billing' | 'ar') => {
    router.replace(`/billing?tab=${t}`, { scroll: false });
  };

  return (
    <div>
      {/* Page header with tab switcher */}
      <div style={{ marginBottom: 20 }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, marginTop: 16, borderBottom: '2px solid #e2e8f0' }}>
          {([
            { key: 'billing', label: 'Billing Drafts',  desc: 'Renewals & annual obligations' },
            { key: 'ar',      label: 'AR Reminder',      desc: 'Annual Return filing tracker'  },
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
      <div style={{ paddingBottom: tab === 'ar' ? 44 : 0 }}>
        {tab === 'billing'
          ? <BillingTab month={month} year={year} setMonth={setMonth} setYear={setYear} />
          : <ARTab month={month} year={year} setMonth={setMonth} setYear={setYear} />}
      </div>
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
