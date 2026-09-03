'use client';

import { Suspense, useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  RefreshCw, ChevronDown, ChevronLeft, ChevronRight,
  AlertTriangle, Clock, CheckCircle2, FileText, Calendar,
  ShieldCheck, MapPin, UserCheck, BarChart3, BookOpen, DollarSign,
  Plus, Check, X, Trash2, History, RotateCcw, Filter, Mail, Send, Loader2,
  FileSpreadsheet, Download, Pencil, Building2,
} from 'lucide-react';
import type { RenewalStatus, AnnualStatus, CompanyBilling, GeneratedInvoice } from '@/app/api/billing/renewals/route';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal';
import MetricCard from '@/components/MetricCard';
import OutlookStyleSendModal from '@/components/client-communications/OutlookStyleSendModal';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { useIsMobile } from '@/lib/use-is-mobile';
import { fmtDate, fmtMonth, toDisplayDate, toIsoDateValue, todaySGT } from '@/lib/date';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import { resolveTeamworkPic } from '@/lib/teamwork-pic';
import { formatStaffName } from '@/lib/staff-directory';
import { QB_ITEM, MEDIAN_RATE, QB_CATALOG, NAME_TO_INITIALS, secretaryDescription, addressDescription, arGovtFeeDescription, xbrlDescription, periodLabel, fyeDateString } from '@/lib/invoice-templates';
import { parseInvoicePeriod, rollRecurringDescriptionForward, servicePeriodOverlapError } from '@/lib/invoice-period';
import { getHelperHealth, isHelperOutdated, buildMailtoLink, type DraftLike } from '@/lib/draft-helper-client';
import { isValidEmail } from '@/lib/campaign-recipients';

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
  Address:   { label: 'Reg. Address', short: 'ADDR', bg: 'var(--status-success-tint)', color: '#15803d', Icon: MapPin     },
  ND:        { label: 'Nominee Dir.', short: 'ND',   bg: '#dcfce7', color: '#166534', Icon: UserCheck  },
  AR:        { label: 'AR / AGM',     short: 'AR',   bg: 'var(--status-warning-tint)', color: '#c2410c', Icon: BarChart3  },
  XBRL:      { label: 'XBRL',         short: 'XBRL', bg: '#fdf4ff', color: '#7e22ce', Icon: ShieldCheck },
  Discount:  { label: 'Discount',     short: 'DISC', bg: 'var(--status-danger-tint)', color: 'var(--status-danger)', Icon: DollarSign },
  Accounts:  { label: 'Accounts',     short: 'ACCT', bg: 'var(--status-info-tint)', color: 'var(--accent-blue)', Icon: FileText   },
  Tax:       { label: 'Tax',          short: 'TAX',  bg: '#f0fdfa', color: '#0f766e', Icon: FileText   },
};

function RenewalCard({ r }: { r: RenewalStatus }) {
  const cfg = SVC_CONFIG[r.service];
  const statusColor = r.status === 'expired' ? 'var(--status-danger)' : r.status === 'expiring_soon' ? '#ea580c' : r.status === 'active' ? 'var(--status-success)' : '#9ca3af';
  const statusBg    = r.status === 'expired' ? 'var(--status-danger-tint)' : r.status === 'expiring_soon' ? 'var(--status-warning-tint)' : r.status === 'active' ? 'var(--status-success-tint)' : '#f9fafb';
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
      {r.periodNeedsReview && (
        <div style={{ marginBottom: 8, border: '1px solid #fed7aa', background: 'var(--status-warning-tint)', color: '#9a3412', borderRadius: 6, padding: '6px 7px', fontSize: 9.5, fontWeight: 650 }}>
          {r.periodWarning}
        </div>
      )}
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
                  <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{displayInvoiceNo(h.invoice_no)}</span>
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
  const statusColor = a.status === 'billed' ? 'var(--status-success)' : a.status === 'pending' ? '#ea580c' : '#9ca3af';
  const statusBg    = a.status === 'billed' ? 'var(--status-success-tint)' : a.status === 'pending' ? 'var(--status-warning-tint)' : '#f9fafb';
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
                  <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{displayInvoiceNo(h.invoice_no)}</span>
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

// Same square-tile language as ServiceSquare (below)/Active Client's
// Services column — color keeps this page's own renewal-status meaning
// (red = expired/pending, orange = expiring soon, green = active/billed,
// grey = not applicable), check = "active/billed", cross = anything else.
function ServiceMini({ label, status, applicable }: { label: string; status: string; applicable: boolean }) {
  const color = !applicable ? '#94a3b8'
    : status === 'expired' || status === 'pending' ? 'var(--status-danger)'
    : status === 'expiring_soon' ? '#ea580c'
    : status === 'active' || status === 'billed' ? 'var(--status-success)'
    : '#94a3b8';
  const on = applicable && (status === 'active' || status === 'billed');
  return (
    <span title={`${label}: ${!applicable ? 'not applicable' : status.replace(/_/g, ' ')}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9.5, fontWeight: 750, color: '#475569', whiteSpace: 'nowrap' }}>
      <ServiceSquare on={on} color={color} grey={color === '#94a3b8'} />
      {label}
    </span>
  );
}

function BillingStatusPill({ label, color, background, border, title, muted = false }: {
  label: string; color: string; background: string; border: string; title?: string; muted?: boolean;
}) {
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5,
      width: 'fit-content', maxWidth: '100%', padding: '4px 8px', borderRadius: 999,
      background: background === '#f8fafc' ? '#f8fafc' : '#fff', color,
      border: `1px solid ${border === '#e2e8f0' ? border : '#dbe3ec'}`, fontSize: 9.5, fontWeight: 750, lineHeight: 1, whiteSpace: 'nowrap',
      opacity: muted ? 0.78 : 1 }}>
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

// Manual "already invoiced outside the system" marker (2026-09-03, Vincent
// re: WOLVEZ CAPITAL — Chelsea invoiced two FYE cycles ahead of a client's
// request, one through this system (generated_invoices has it) and one
// typed straight into QuickBooks to avoid confusing the two — so
// billedCyclesMap's own QB-description parsing (app/api/billing/renewals/
// route.ts) never picked it up, and this cycle kept showing "not invoiced"
// every time the page loaded. A plain Remarks note alone doesn't stop that
// — nothing reads remarks for this check — so this is a real, parseable
// marker in the SAME Remarks field AR Reminder already lets staff free-type
// into (REMARKS_OPTIONS' presets don't preclude custom text), not a new
// field/button. Format: "MANUALLY INVOICED: TAB #02611029" (or TAC).
const MANUAL_INVOICE_MARKER_RE = /MANUALLY INVOICED:\s*(TAB|TAC)\s*#?\s*(\S+)/gi;
function manualInvoiceOverrides(remarks: string | null | undefined): { company: 'TAB' | 'TAC'; invoiceNo: string }[] {
  if (!remarks) return [];
  const out: { company: 'TAB' | 'TAC'; invoiceNo: string }[] = [];
  const re = new RegExp(MANUAL_INVOICE_MARKER_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(remarks))) out.push({ company: m[1].toUpperCase() as 'TAB' | 'TAC', invoiceNo: m[2] });
  return out;
}

function BillingInvoiceReference({ company, invoiceNo, title, muted = false }: {
  company: 'TAB' | 'TAC'; invoiceNo?: string | null; title?: string; muted?: boolean;
}) {
  if (!invoiceNo) {
    return <span style={{ color: '#94a3b8', fontSize: 10, whiteSpace: 'nowrap' }}>No system invoice</span>;
  }
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', width: 'fit-content', maxWidth: '100%',
      padding: '2px 5px', borderRadius: 4, background: '#f2f6f8', color: '#31506f',
      fontSize: 9.5, fontWeight: 800, lineHeight: 1.25, whiteSpace: 'nowrap',
      opacity: muted ? 0.72 : 1,
    }}>
      {company} #{displayInvoiceNo(invoiceNo)}
    </span>
  );
}

// AR Reminder's "Invoice" column — Vincent, 2026-08-27: show the same real
// TAB/TAC invoice numbers Billing Drafts already tracks (tab_invoice_no /
// tac_invoice_no, resolved server-side in app/api/ar-reminder/route.ts from
// generated_invoices, scoped to this row's own FYE cycle), stacked when both
// exist — instead of relying on someone re-typing the number into ar_status
// by hand. Falls back to the original free-text ar_status EditField only
// when no system invoice exists yet for this cycle (invoice not generated
// through this system, or not yet raised at all) — same "system record when
// we have one, manual fallback when we don't" pattern notInvoicedYet() below
// already uses for the Billing tab.
function ArInvoiceCell({ r, onSave, placeholder }: {
  r: ARRecord; onSave: (id: number, field: string, val: string) => void; placeholder?: string;
}) {
  if (!r.tab_invoice_no && !r.tac_invoice_no) {
    return <EditField id={r.id} field="ar_status" value={r.ar_status} onSave={onSave} placeholder={placeholder} />;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
      {r.tab_invoice_no && <BillingInvoiceReference company="TAB" invoiceNo={r.tab_invoice_no} />}
      {r.tac_invoice_no && <BillingInvoiceReference company="TAC" invoiceNo={r.tac_invoice_no} />}
    </div>
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
  fye_month: string; fye_year: number; isStaleOverdue?: boolean;
  pic: string | null; acc_pic: string | null; tax_pic: string | null;
  prepared_date: string | null; sent_date: string | null; received_date: string | null;
  date_of_agm: string | null; agm_held_date: string | null; filling_date: string | null;
  date_of_agm_manual?: boolean | null; filling_date_manual?: boolean | null; reminder_note_manual?: boolean | null;
  acc_pic_manual?: boolean | null; tax_pic_manual?: boolean | null;
  ar_status: string | null; xbrl: string | null; software_update: string | null;
  tab_invoice_no: string | null; tac_invoice_no: string | null;
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
  'date_of_agm', 'agm_held_date', 'sent_date', 'received_date', 'filling_date',
]);

function historyValue(value: string | null) {
  if (!value) return 'Empty';
  return toDisplayDate(value) ?? value;
}

const SVC: Record<string, { label: string; bg: string; color: string }> = {
  ar:        { label: 'Annual Return', bg: '#dbeafe', color: 'var(--accent-blue)' },
  agm:       { label: 'AGM',           bg: '#e0e7ff', color: '#4338ca' },
  xbrl:      { label: 'XBRL',          bg: '#fce7f3', color: '#be185d' },
  nd:        { label: 'Nominee Dir.',  bg: '#dcfce7', color: '#15803d' },
  address:   { label: 'Reg. Address',  bg: 'var(--status-success-tint)', color: '#166534' },
  accounts:  { label: 'Accounts',      bg: '#fef9c3', color: '#92400e' },
  tax:       { label: 'Tax Filing',    bg: '#ffedd5', color: '#c2410c' },
  secretary: { label: 'Secretary',     bg: '#f5f3ff', color: '#6d28d9' },
};

// Services rendered as FIXED slots in a FIXED order so each service always
// sits in the same position row-to-row — much easier to scan than a
// variable-length list. Only active services are shown here, so every
// square is a green check (see the modal for the fuller auto/manual/off
// color scheme).
const SVC_ORDER = ['ar', 'agm', 'secretary', 'nd', 'address', 'xbrl', 'accounts', 'tax'] as const;
const SVC_SHORT: Record<string, string> = {
  ar: 'AR', agm: 'AGM', secretary: 'SEC', nd: 'ND',
  address: 'ADDR', xbrl: 'XBRL', accounts: 'ACC', tax: 'TAX',
};
type SvcState = 'auto-on' | 'manual-on' | 'off';
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

// Small colored checkbox-style tile, same square-tile language as Active
// Client's Services column (components/MasterListTable.tsx's CheckSquare).
// `color` carries whatever the caller's own status/provenance scheme means
// (e.g. AR Reminder's modal: light blue = on via locked/auto, green = on
// via manual; Billing Drafts: red = expired, orange = expiring soon,
// green = active/billed) — `ServiceSquare` itself only renders
// check-vs-cross for `on`. `grey` renders the plain empty tile instead
// (same #e5e7eb fill / #cbd5e1 border as CheckSquare's unchecked state,
// no icon) — used for "off" / "not applicable", where Vincent didn't
// want a cross mark once he saw it rendered.
const SVC_SQUARE_COLOR = { off: '#e5e7eb', auto: '#60a5fa', manual: 'var(--status-success)' } as const;
function ServiceSquare({ on, color, grey }: { on: boolean; color: string; grey?: boolean }) {
  if (grey) {
    return <span aria-hidden="true" style={{ width: 14, height: 14, minWidth: 14, borderRadius: 4, flexShrink: 0, background: '#e5e7eb', border: '1px solid #cbd5e1' }} />;
  }
  return (
    <span aria-hidden="true" style={{
      width: 14, height: 14, minWidth: 14, borderRadius: 4, flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: color,
    }}>
      {on ? <Check size={10} color="#fff" strokeWidth={3} /> : <X size={10} color="#fff" strokeWidth={3} />}
    </span>
  );
}

// Clickable service tile: AUTO by default; one click flips the effective
// state (manual), clicking again restores AUTO. Automation never touches
// manual values.
function OverrideChip({ svc, effective, manual, disabled, onCycle }:
  { svc: string; effective: boolean; manual: boolean | undefined; disabled: boolean; onCycle: () => void }) {
  const c = SVC[svc];
  const isManual = manual !== undefined;
  const on = isManual ? !!manual : effective;
  const color = isManual ? SVC_SQUARE_COLOR.manual : SVC_SQUARE_COLOR.auto;
  return (
    <button onClick={onCycle} disabled={disabled}
      title={disabled ? 'No company-master match — cannot override' : isManual ? `${c.label}: manual ${manual ? 'ON' : 'OFF'} · click to restore auto` : `${c.label}: auto (${effective ? 'on' : 'off'}) · click to force ${effective ? 'OFF' : 'ON'}`}
      style={{
        background: 'transparent', border: 'none', padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1,
        display: 'inline-flex', alignItems: 'center', gap: 6,
      }}>
      <ServiceSquare on={on} color={color} grey={!on} />
      <span style={{ fontSize: 10.5, fontWeight: 700, color: '#475569' }}>{c.label}</span>
    </button>
  );
}

export const EditField = memo(function EditField({ id, field, value, onSave, placeholder = '—', isDate = false, multiline = false, looseDate = false }:
  { id: number; field: string; value: string | null; onSave: (id: number, field: string, val: string) => void; placeholder?: string; isDate?: boolean; multiline?: boolean; looseDate?: boolean }) {
  const inputValue = useCallback((raw: string | null) => isDate ? (toDisplayDate(raw) ?? raw ?? '') : (raw ?? ''), [isDate]);
  // multiline fields (Vincent, 2026-08-17: Billing Drafts Remarks — "可以做
  // 成这种吗" referencing Late Filing's always-visible auto-growing
  // textarea) never use the click-to-reveal pattern the rest of this
  // component is built around — they start, and stay, in the "editing"
  // render below instead of collapsing to a plain span.
  const [editing, setEditing] = useState(multiline);
  const [val, setVal] = useState(inputValue(value));
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<FieldConflict | null>(null);
  const pendingRef = useRef<{ next: string; prev: string }>({ next: '', prev: '' });
  const editBaselineRef = useRef(value ?? '');
  const committingRef = useRef(false);
  const requestRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dateRef  = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  useEffect(() => { if (multiline) resizeTextarea(); }, [multiline, val, resizeTextarea]);
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
      editBaselineRef.current = saved;
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
    if (!multiline) setEditing(false);
    const typed = val.trim();
    // looseDate fields (Email Sent, mirrored with Billing Drafts' free-typed
    // Remarks — Vincent, 2026-08-18: whatever's typed in either must show up
    // identically in the other) accept a real date OR arbitrary text: never
    // reject, just normalize to ISO when it happens to parse as a date.
    const next = isDate && typed ? (toIsoDateValue(typed) ?? (looseDate ? typed : null)) : typed;
    const baseline = editBaselineRef.current;
    const prev = isDate && baseline && AR_DATABASE_DATE_FIELDS.has(field)
      ? (toIsoDateValue(baseline) ?? baseline.trim())
      : baseline.trim();
    if (isDate && typed && !next) {
      setMessage('Use a valid date, e.g. 03 Apr 2026');
      setStatus('error');
      return;
    }
    if ((next ?? '') === prev) return;
    committingRef.current = true;
    onSave(id, field, next ?? '');
    void persist(next ?? '', prev);
  }, [val, id, field, isDate, looseDate, multiline, onSave, persist]);

  const retry = useCallback(() => { committingRef.current = true; void persist(pendingRef.current.next, pendingRef.current.prev); }, [persist]);
  const acceptLatest = useCallback(() => {
    const latest = String(conflict?.currentValue ?? pendingRef.current.prev ?? '');
    editBaselineRef.current = latest;
    onSave(id, field, latest); setVal(inputValue(latest)); setConflict(null); setStatus('idle');
  }, [conflict, field, id, inputValue, onSave]);
  const overwriteLatest = useCallback(() => {
    committingRef.current = true;
    void persist(pendingRef.current.next, String(conflict?.currentValue ?? ''));
  }, [conflict, persist]);
  const revert = useCallback(() => { const { prev } = pendingRef.current; editBaselineRef.current = prev; onSave(id, field, prev); setVal(inputValue(prev)); setStatus('idle'); }, [id, field, inputValue, onSave]);

  const handleDatePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    setVal(fmtDate(e.target.value));
    e.target.value = '';
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (editing && multiline) return (
    <textarea ref={textareaRef} value={val} rows={1}
      onChange={e => { setVal(e.target.value); resizeTextarea(); }}
      onBlur={save}
      placeholder={placeholder}
      style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', fontSize: 12.5, color: '#1e293b', outline: 'none', fontFamily: 'inherit', resize: 'none', overflow: 'hidden', lineHeight: 1.4, background: '#fff' }}
    />
  );

  if (editing) return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <input ref={inputRef} type="text" value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={e => { if (!(e.relatedTarget as HTMLElement | null)?.dataset?.calBtn) save(); }}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } if (e.key === 'Escape') { setVal(inputValue(value)); setEditing(false); } }}
        placeholder={isDate ? (looseDate ? 'Date or note…' : 'e.g. 03 Apr 2026') : ''}
        style={{ flex: '1 1 200px', border: '1.5px solid #2563eb', borderRadius: 4, padding: '2px 6px', fontSize: 12, outline: 'none', background: 'var(--status-info-tint)', minWidth: 0 }}
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
    <div title={`Updated by ${conflict?.updatedByName ?? conflict?.updatedByEmail ?? 'another user'}`} style={{ background: 'var(--status-warning-tint)', border: '1px solid #fdba74', borderRadius: 5, padding: '3px 5px', minHeight: 28 }}>
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 4px', minHeight: 24 }}>
      <span title={message || 'Save failed'} style={{ fontSize: 11, color: '#b91c1c', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message || val || 'Save failed'}</span>
      <button onClick={retry}  title="Retry save"   style={{ border: 'none', background: 'transparent', color: 'var(--status-danger)', cursor: 'pointer', padding: 0, display: 'flex' }}><RefreshCw size={11} /></button>
      <button onClick={revert} title="Revert change" style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: 0, display: 'flex' }}><X size={11} /></button>
    </div>
  );

  const display = (value ?? '').trim();
  // No visible saving/saved indicator (Vincent: doesn't need every keystroke
  // shown — it's already recorded in the audit trail). error/conflict states
  // above still render their own explicit UI since those need attention.
  const statusDot = null;
  return (
    <div onClick={() => { editBaselineRef.current = value ?? ''; setVal(inputValue(value)); setEditing(true); }} title="Click to edit" style={{ cursor: 'text', minHeight: 24, display: 'flex', alignItems: 'center', gap: 4, borderRadius: 3, padding: '1px 3px' }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      {display
        ? isDate
          ? <span style={{ fontSize: 12, color: '#374151' }}>{toDisplayDate(display) ?? display}</span>
          : <span style={{ fontSize: 12, color: '#374151' }}>{display}</span>
        : isDate
          ? <span style={{ display:'flex', alignItems:'center', gap:3, color:'#c7d2fe', fontSize:11 }}><Calendar size={11} /><span style={{ color:'#d1d5db' }}>{placeholder}</span></span>
          : <span style={{ color: '#d1d5db', fontSize: 11 }}>{placeholder}</span>}
      {statusDot}
    </div>
  );
});

export type SelectOption = { label: string; bg: string; color: string; type?: 'date' };

// Unified chip palette
export const C = {
  green:  { bg: '#dcfce7', color: '#15803d' },
  blue:   { bg: '#dbeafe', color: 'var(--accent-blue)' },
  amber:  { bg: '#fef3c7', color: 'var(--status-warning)' },
  purple: { bg: '#ede9fe', color: '#6d28d9' },
  red:    { bg: '#fee2e2', color: '#b91c1c' },
  grey:   { bg: '#e2e8f0', color: '#475569' },
};

// Drives ARTableView's whole-row tint (Vincent, 2026-08-13: TERMINATED/STRIKE
// OFF -> grey row, AR COMPLETED -> green row, a free-typed CUSTOM remark ->
// row unchanged). See remarksRowState() below.
const REMARKS_OPTIONS: SelectOption[] = [
  { label: 'TERMINATED',   ...C.grey  },
  { label: 'STRIKE OFF',   ...C.amber },
  { label: 'AR COMPLETED', ...C.green },
];

function remarksRowState(remarks: string | null | undefined): 'closed' | 'done' | null {
  if (remarks === 'TERMINATED' || remarks === 'STRIKE OFF') return 'closed';
  if (remarks === 'AR COMPLETED') return 'done';
  return null;
}

export const ROND_OPTIONS: SelectOption[] = [
  { label: 'DONE',         ...C.green  },
  { label: 'FILED',        ...C.blue   },
  { label: 'ACRA DONE',    ...C.blue   },
  { label: 'SENT & FILED', ...C.purple },
];

export const DPO_OPTIONS: SelectOption[] = [
  { label: 'YES',    ...C.green  },
  { label: 'INFORM', ...C.blue   },
  { label: 'DONE',   ...C.green  },
  { label: 'CLIENT', ...C.purple },
];

export const XBRL_OPTIONS: SelectOption[] = [
  { label: 'Date',       ...C.green, type: 'date' },
  { label: 'NO',         ...C.red   },
  { label: 'SIMPLIFIED', ...C.amber },
  { label: 'FULL',       ...C.green },
];

// SEC/ACC/TAX PIC dropdowns (Vincent, 2026-08-17) — every option uses the
// same neutral grey ("不需要有什么特别颜色处理", unlike Remarks/XBRL/DPO/ROND
// which carry semantic color). Names match lib/staff-directory.ts's own
// Corporate-Secretarial+Malaysia / Accounting / Tax groupings.
export const SEC_PIC_OPTIONS: SelectOption[] = [
  'Lim Hoe Chyi', 'Hoo Seng Xin', 'Jenny Lai', 'Chin Kah Ye',
  'Ang Shi Ming', 'Tey Shemin', 'Tan Min Quan', 'Client',
].map(label => ({ label, ...C.grey }));

export const ACC_PIC_OPTIONS: SelectOption[] = [
  'Jay Tay', 'Lee Jing Fei', 'Tee Yu Heng', 'Vernice Chai', 'Chee Wei En', 'Client',
].map(label => ({ label, ...C.grey }));

export const TAX_PIC_OPTIONS: SelectOption[] = [
  'Clarence Saw', 'Quinnie Tan', 'Victoria Yap', 'Client',
].map(label => ({ label, ...C.grey }));

// Report Ready dropdown (Vincent, 2026-08-17): a date -> plain text (no
// chip, see plainDates on SelectField), DORMANT -> colored, anything else
// typed -> the existing plain-text fallback every custom value already got.
export const REPORT_READY_OPTIONS: SelectOption[] = [
  { label: 'DORMANT', ...C.amber },
];

export const SelectField = memo(function SelectField({ id, field, value, onSave, options, customLabel = 'Date / custom…', dateHelper = true, formatDisplay, plainDisplay = false, plainDates = false }: {
  id: number; field: string; value: string | null;
  onSave: (id: number, field: string, val: string) => void;
  options: SelectOption[];
  customLabel?: string;
  dateHelper?: boolean;
  formatDisplay?: (raw: string) => string;
  // Skips the colored chip entirely once a value is picked — just plain
  // text next to the dropdown arrow, like an unmatched custom value already
  // rendered. Vincent (2026-08-17, PIC dropdowns): "下拉完成后就普通表示就好
  // 了，不需要灰色外轮廓" — the picker itself still shows chips, only the
  // closed/selected state goes plain.
  plainDisplay?: boolean;
  // Narrower than plainDisplay: only a date-shaped value goes plain (e.g.
  // Report Ready's "日期(纯文字显示)") — a matched preset chip (its
  // "DORMANT(可以带颜色)") still keeps its color. Ignored when plainDisplay
  // is set, since that already forces everything plain.
  plainDates?: boolean;
}) {
  const [open,   setOpen]   = useState(false);
  const [custom, setCustom] = useState(false);
  const [val,    setVal]    = useState(value ?? '');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error' | 'conflict'>('idle');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState<FieldConflict | null>(null);
  const pendingRef = useRef<{ next: string; prev: string }>({ next: '', prev: '' });
  const editBaselineRef = useRef(value ?? '');
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
      editBaselineRef.current = saved;
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
  const revert = useCallback(() => { const { prev } = pendingRef.current; editBaselineRef.current = prev; onSave(id, field, prev); setVal(prev); setStatus('idle'); }, [id, field, onSave]);
  const acceptLatest = useCallback(() => {
    const latest = String(conflict?.currentValue ?? pendingRef.current.prev ?? '');
    editBaselineRef.current = latest;
    onSave(id, field, latest); setVal(latest); setConflict(null); setStatus('idle');
  }, [conflict, field, id, onSave]);
  const overwriteLatest = useCallback(() => persist(pendingRef.current.next, String(conflict?.currentValue ?? '')), [conflict, persist]);

  const commit = useCallback((next: string) => {
    setCustom(false); setOpen(false);
    const typed = next.trim();
    const trimmed = toIsoDateValue(typed) ?? typed;
    const prev = editBaselineRef.current.trim();
    if (trimmed === prev) return;
    onSave(id, field, trimmed);   // optimistic
    persist(trimmed, prev);
  }, [id, field, onSave, persist]);

  const handleDatePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.value) return;
    setVal(fmtDate(e.target.value));
    e.target.value = '';
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const rawDisplay = (value ?? '').trim();
  // formatDisplay (e.g. formatStaffName) normalizes messy legacy values
  // ("JF", "Kah Ye Chin") into the clean canonical name before chip-matching
  // — so a shorthand that already resolves to a preset renders as that chip,
  // not as unrecognised plain text.
  const display = rawDisplay && formatDisplay ? formatDisplay(rawDisplay) || rawDisplay : rawDisplay;
  const chip = display ? options.find(o => o.label === display && !o.type) : null;
  const isDateValue = !!toDisplayDate(display);
  // No visible saving/saved indicator (Vincent: doesn't need every keystroke
  // shown — it's already recorded in the audit trail). error/conflict states
  // below still render their own explicit UI since those need attention.
  const statusDot = null;

  if (status === 'conflict') return (
    <div title={`Updated by ${conflict?.updatedByName ?? conflict?.updatedByEmail ?? 'another user'}`} style={{ background: 'var(--status-warning-tint)', border: '1px solid #fdba74', borderRadius: 5, padding: '3px 5px', minHeight: 28 }}>
      <div style={{ fontSize: 9, color: '#c2410c', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Changed by {conflict?.updatedByName ?? conflict?.updatedByEmail ?? 'another user'}</div>
      <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
        <button onClick={acceptLatest} style={{ border: 0, background: 'transparent', padding: 0, color: '#64748b', fontSize: 9, cursor: 'pointer' }}>Use latest</button>
        <button onClick={overwriteLatest} style={{ border: 0, background: 'transparent', padding: 0, color: '#c2410c', fontSize: 9, fontWeight: 700, cursor: 'pointer' }}>Keep mine</button>
      </div>
    </div>
  );

  if (status === 'error') return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 4, padding: '1px 4px', minHeight: 24 }}>
      <span title={message || 'Save failed'} style={{ fontSize: 11, color: '#b91c1c', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{message || val || 'Save failed'}</span>
      <button onClick={retry}  title="Retry save"   style={{ border: 'none', background: 'transparent', color: 'var(--status-danger)', cursor: 'pointer', padding: 0, display: 'flex' }}><RefreshCw size={11} /></button>
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
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit(val); if (e.key === 'Escape') { setVal(value ?? ''); setCustom(false); } }}
            placeholder={dateHelper ? 'e.g. 03 Apr 2026' : 'Type your own remarks…'}
            style={{ flex: '1 1 200px', border: '1.5px solid #2563eb', borderRadius: 4, padding: '2px 6px', fontSize: 12, outline: 'none', background: 'var(--status-info-tint)', minWidth: 0 }}
          />
          {dateHelper && (
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
      ) : (
        <div onClick={() => setOpen(current => { if (!current) editBaselineRef.current = value ?? ''; return !current; })} title="Click to select" style={{ cursor: 'pointer', minHeight: 24, display: 'flex', alignItems: 'center', gap: 4, borderRadius: 3, padding: '1px 3px' }}
          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f0f6ff'}
          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
          {display
            ? plainDisplay
              ? <span style={{ fontSize: 12, color: '#374151' }}>{display}</span>
              : isDateValue
                ? plainDates
                  ? <span style={{ fontSize: 12, color: '#374151' }}>{fmtDate(display)}</span>
                  : <span style={{ background: C.green.bg, color: C.green.color, borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{fmtDate(display)}</span>
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
              style={{ padding: '7px 12px', cursor: 'pointer', borderTop: '1px solid #f1f5f9', fontSize: 11, color: 'var(--accent-red)' }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'var(--status-danger-tint)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}>
              Clear
            </div>
          )}
          <div onClick={() => { editBaselineRef.current = value ?? ''; setOpen(false); setVal(value ?? ''); setCustom(true); }}
            style={{ padding: '7px 12px', cursor: 'pointer', borderTop: '1px solid #f1f5f9', fontSize: 11, color: 'var(--accent-gray)', display: 'flex', alignItems: 'center', gap: 6 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#f8fafc'}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = '#fff'}>
            {dateHelper && <Calendar size={11} style={{ color: '#4338ca' }} />} {customLabel}
          </div>
        </div>
      )}
    </div>
  );
});

// Marks a date as filled by the TeamWork sync rather than typed in by a
// staff member — only shown in the AR Table view (Vincent: distinguish
// automated vs. manual so it's obvious which cells automation still owns).
export function AutoFillDot({ show, title = 'Auto-filled from TeamWork — clear the cell to hand this back to automation, or type a date to override it.' }: { show: boolean; title?: string }) {
  if (!show) return null;
  return <span title={title} style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6', flexShrink: 0 }} />;
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
            background: v ? 'var(--status-success)' : i === done ? '#f59e0b' : '#e2e8f0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: compact ? 8 : 9, fontWeight: 700,
            color: v ? '#fff' : i === done ? '#fff' : '#9ca3af', flexShrink: 0,
          }}>{v ? '✓' : i + 1}</div>
          {compact && i < 4 && <div style={{ width: 6, height: 1, background: v ? 'var(--status-success)' : '#e2e8f0', margin: '0 1px' }} />}
          {!compact && i < 4 && <div style={{ width: 12, height: 2, background: v ? 'var(--status-success)' : '#e2e8f0' }} />}
        </div>
      ))}
      {!compact && <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 4 }}>{done}/5</span>}
    </div>
  );
}

// Marks Remarks text written by /api/late-filing/sync's Late Filing ->
// AR Reminder mirror (Vincent: distinguish those companies in both List and
// Table views). Kept as a plain text prefix, not a stored column, so the
// same field doubles as the human-readable note and the machine-readable
// flag — must match LATE_FILING_MARKER in that route exactly.
const LATE_FILING_MARKER = '⚠ LATE FILING:';
function lateFilingReason(remarks: string | null | undefined): string | null {
  if (!remarks) return null;
  const line = remarks.split('\n')[0];
  return line.startsWith(LATE_FILING_MARKER) ? line.slice(LATE_FILING_MARKER.length).trim() : null;
}
function LateFilingBadge({ remarks }: { remarks: string | null | undefined }) {
  const reason = lateFilingReason(remarks);
  if (!reason) return null;
  return (
    <span title={`Flagged on the Late Filing page: ${reason}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, background: 'var(--status-danger-tint)', color: 'var(--status-danger)',
      border: '1px solid #fecaca', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700,
      whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0,
    }}>
      <AlertTriangle size={9} />LATE
    </span>
  );
}

// A company genuinely overdue right now but still filed under an earlier
// fye_year (AR/AGM due dates are FYE + 9 months, so the due date can roll
// into the next calendar year) — surfaced in the current cycle's Overdue
// view (see staleOverdueRecords in ARTab) so staff can catch it up this
// cycle. Colors match late-filing/page.tsx's own "Late FY" pill.
function StaleFyeBadge({ fyeYear }: { fyeYear: number }) {
  return (
    <span title={`Still unfiled from FYE ${fyeYear} — overdue, not this cycle's own`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, background: '#fff7ed', color: '#c2410c',
      border: '1px solid #fed7aa', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700,
      whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0,
    }}>
      Late FY {fyeYear}
    </span>
  );
}

// Shown on a company's CURRENT-cycle row (never on the backlog row itself
// — see backlogYearsFor in ARTab) when that same company also has one or
// more still-unfiled prior-year rows, so the notice is visible whichever
// row search/browsing happens to surface, not only via the Overdue filter.
function BacklogNoticeBadge({ years }: { years: number[] }) {
  if (!years.length) return null;
  const label = years.slice().sort((a, b) => b - a).join(', ');
  return (
    <span title={`Also has an unfiled AR still outstanding from FYE ${label}`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, background: '#fff7ed', color: '#c2410c',
      border: '1px solid #fed7aa', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700,
      whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0,
    }}>
      <AlertTriangle size={9} />Owes FY {label}
    </span>
  );
}

// Vincent: some clients have a parent/subsidiary structure — invoices for
// the subsidiary should still be created under the subsidiary's own QB
// customer (revenue tracking stays correct), but the "Bill To" name/address
// on the PDF the client sees should be the PARENT's (see
// app/api/quickbooks/create-invoice/route.ts's resolveParentBillAddr). This
// link is persistent (companies.parent_company_id), not a per-invoice
// choice — set once here, applies to every future cycle until changed.
function ParentCompanyBadge({ name }: { name: string | null | undefined }) {
  if (!name) return null;
  return (
    <span title={`Invoices for this company show "${name}" as the Bill-To name/address`} style={{
      display: 'inline-flex', alignItems: 'center', gap: 3, background: '#eef2ff', color: '#4338ca',
      border: '1px solid #e0e7ff', borderRadius: 4, padding: '1px 5px', fontSize: 9, fontWeight: 700,
      whiteSpace: 'nowrap', cursor: 'help', flexShrink: 0,
    }}>
      <Building2 size={9} />{name}
    </span>
  );
}

// Module-level cache: ExpandedBillingRow fully unmounts every time the
// draft modal closes, so a component-local fetch would re-run on every
// re-open. One fetch shared for the page's lifetime; the in-flight promise
// dedups concurrent opens.
let parentPickCache: { id: number; company_name: string }[] | null = null;
let parentPickPromise: Promise<{ id: number; company_name: string }[]> | null = null;
function loadParentPicklist() {
  if (parentPickCache) return Promise.resolve(parentPickCache);
  if (!parentPickPromise) {
    parentPickPromise = fetch('/api/companies/parent').then(r => r.json())
      .then(j => { parentPickCache = j.companies ?? []; return parentPickCache!; })
      .catch(() => { parentPickPromise = null; return []; });
  }
  return parentPickPromise;
}

function ParentCompanyPicker({ companyId, parentCompanyId, parentCompanyName, onChange }: {
  companyId: number | null; parentCompanyId: number | null; parentCompanyName: string | null;
  onChange: (id: number | null, name: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<{ id: number; company_name: string }[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    loadParentPicklist().then(setOptions);
    const onOutside = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  if (!companyId) return null; // this row never resolved a real companies.id — nothing to link yet

  const filtered = (query.trim()
    ? options.filter(o => o.company_name.toLowerCase().includes(query.trim().toLowerCase()) && o.id !== companyId)
    : options.filter(o => o.id !== companyId)).slice(0, 30);

  const save = async (id: number | null, name: string | null) => {
    const prev = { id: parentCompanyId, name: parentCompanyName };
    onChange(id, name); // optimistic
    setOpen(false); setQuery('');
    try {
      const res = await fetch('/api/companies/parent', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, parentCompanyId: id }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(`Failed to save parent company: ${j.error ?? res.status}`);
        onChange(prev.id, prev.name);
      }
    } catch {
      alert('Failed to save parent company — check your connection.');
      onChange(prev.id, prev.name);
    }
  };

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      {parentCompanyId && !open ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#64748b' }}>
          <Building2 size={11} />Bill-To parent: <strong style={{ color: '#334155' }}>{parentCompanyName}</strong>
          <button onClick={() => setOpen(true)} style={{ border: 'none', background: 'none', color: 'var(--accent-blue)', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>Change</button>
          <button onClick={() => save(null, null)} style={{ border: 'none', background: 'none', color: '#94a3b8', fontSize: 10.5, cursor: 'pointer', padding: 0 }}>Clear</button>
        </span>
      ) : !open ? (
        <button onClick={() => setOpen(true)} style={{ border: '1px dashed #cbd5e1', background: 'none', color: '#94a3b8', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', borderRadius: 5, padding: '2px 7px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Plus size={10} />Set parent company
        </button>
      ) : (
        <div style={{ position: 'relative' }}>
          <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search company…"
            style={{ border: '1px solid #cbd5e1', borderRadius: 5, padding: '4px 7px', fontSize: 11.5, width: 200 }} />
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 40, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, boxShadow: '0 8px 20px rgba(0,0,0,0.15)', maxHeight: 220, overflowY: 'auto', width: 260 }}>
            {filtered.length === 0 && <div style={{ padding: '8px 10px', fontSize: 11, color: '#94a3b8' }}>No match</div>}
            {filtered.map(o => (
              <div key={o.id} onClick={() => save(o.id, o.company_name)} style={{ padding: '6px 10px', fontSize: 11.5, cursor: 'pointer' }}>{o.company_name}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Matches BillingStatusPill's own look (white/neutral-bordered with just a
// colored dot + text, e.g. the "Invoiced" pill elsewhere on this page)
// instead of a solid colored background — Vincent: "DUE DATE那边的胶囊优化成
// invoiced 的那种胶囊格式和颜色设计." Delegates to that same component rather
// than re-implementing its look here, so both stay visually identical if
// either ever changes.
function DueBadge({ days, filed }: { days: number | null; filed: boolean }) {
  if (filed) return <BillingStatusPill label="Filed" color="#15803d" background="#fff" border="#dbe3ec" title="The Annual Return for this FYE cycle has already been filed with ACRA — no due date to track." />;
  if (days === null) return <span style={{ color: '#d1d5db', fontSize: 11 }}>—</span>;
  // Neutral grey, not urgency-colored — Vincent: match Active Client List's
  // own Status pill (components/MasterListTable.tsx's list-view status
  // span, color #64748b) exactly. Same pill shape/background/border as
  // before, only the color changes.
  const color = '#64748b';
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d left`;
  const title = days < 0
    ? `The Annual Return filing deadline for this FYE cycle was ${Math.abs(days)} day(s) ago and it has not been filed yet.`
    : days === 0
    ? 'The Annual Return filing deadline for this FYE cycle is today.'
    : `${days} day(s) remain until the Annual Return filing deadline for this FYE cycle.`;
  return <BillingStatusPill label={label} color={color} background="#fff" border="#dbe3ec" title={title} />;
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
        const clr   = ({ none: { bg: '#f1f5f9', text: '#94a3b8' }, expired: { bg: '#fee2e2', text: 'var(--status-danger)' }, expiring: { bg: '#fef9c3', text: '#d97706' }, active: { bg: '#dcfce7', text: 'var(--status-success)' } })[st];
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
                {isND && <span style={{ width: 28, height: 28, borderRadius: 8, background: '#dbeafe', color: 'var(--accent-blue)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><UserCheck size={14} /></span>}
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
              <div style={{ background: 'var(--status-success-tint)', border: '1px solid #bbf7d0', borderTop: 'none', borderRadius: ndStrikeOff || ndPending ? '0' : '0 0 8px 8px', padding: '9px 11px', display: 'flex', alignItems: 'center', gap: 9 }}>
                <UserCheck size={14} color="var(--status-success)" />
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
                    background: ndStrikeOff ? 'var(--status-warning-tint)' : '#fff', color: ndStrikeOff ? '#c2410c' : '#64748b',
                  }}
                >
                  {/* Checkbox square */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 13, height: 13, flexShrink: 0,
                    border: `1.5px solid ${ndStrikeOff ? '#c2410c' : '#cbd5e1'}`,
                    borderRadius: 2,
                    background: ndStrikeOff ? 'var(--status-warning-tint)' : '#fff',
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
                    background: ndPending ? '#fefce8' : '#fff', color: ndPending ? 'var(--status-warning)' : '#64748b',
                  }}
                >
                  {/* Checkbox square */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: 13, height: 13, flexShrink: 0,
                    border: `1.5px solid ${ndPending ? 'var(--status-warning)' : '#cbd5e1'}`,
                    borderRadius: 2,
                    background: ndPending ? '#fef3c7' : '#fff',
                  }}>
                    {ndPending && (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="var(--status-warning)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
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
            { label: 'Reminder', field: 'reminder_note', isDate: true },
          ] as const).map(({ label, field, isDate }) => (
            <div key={field} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110 }}>{label}</span>
              <div style={{ flex: 1 }}>
                <EditField id={r.id} field={field} value={(r as unknown as Record<string, string | null>)[field]} onSave={onSave} placeholder="—" isDate={isDate} />
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px', marginBottom: 2, background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 110 }}>Report Ready</span>
            <div style={{ flex: 1 }}>
              <SelectField id={r.id} field="prepared_date" value={r.prepared_date} onSave={onSave} options={REPORT_READY_OPTIONS} plainDates />
            </div>
          </div>
          {([
            { label: 'To Client',     field: 'sent_date',     isDate: true },
            { label: 'Signed / Rcvd', field: 'received_date', isDate: true },
            { label: 'AGM Date',      field: 'date_of_agm',   isDate: true },
            { label: 'AR Filed',      field: 'filling_date',  isDate: true },
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
            { label: 'SEC PIC', field: 'pic',     options: SEC_PIC_OPTIONS },
            { label: 'ACC PIC', field: 'acc_pic', options: ACC_PIC_OPTIONS },
            { label: 'TAX PIC', field: 'tax_pic', options: TAX_PIC_OPTIONS },
          ] as const).map(({ label, field, options }) => (
            <div key={field} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, padding: '4px 8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 70 }}>{label}</span>
              <div style={{ flex: 1 }}>
                <SelectField id={r.id} field={field} value={(r as unknown as Record<string, string | null>)[field]} onSave={onSave} options={options} customLabel="Custom…" dateHelper={false} formatDisplay={formatStaffName} plainDisplay />
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
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#475569' }}>{displayInvoiceNo(inv.invoice_no)}</span>
                    <span style={{ fontSize: 10, color: '#64748b' }}>{fmtDate(inv.txn_date)}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#1e3a5f' }}>S${(inv.total_amt ?? 0).toLocaleString()}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 3, padding: '1px 5px',
                      background: inv.status === 'Paid' ? '#dcfce7' : inv.status === 'Overdue' ? 'var(--status-danger-tint)' : '#fef9c3',
                      color:      inv.status === 'Paid' ? '#15803d' : inv.status === 'Overdue' ? 'var(--status-danger)' : '#92400e',
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
            <ArInvoiceCell r={r} onSave={onSave} placeholder="Invoice no. / notes…" />
          </div>
          <div style={{ background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0', padding: '8px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Email Sent</div>
            <EditField id={r.id} field="accounts_status" value={r.accounts_status} onSave={onSave} placeholder="—" isDate looseDate />
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
  previousPeriodEnd?: string | null;
  periodNeedsReview?: boolean;
  periodReviewed?: boolean;
};

type InvoiceNumberState = { TAB: string; TAC: string };
type GeneratedPdf = { company: 'TAB' | 'TAC'; invoiceNo: string; qbId: string; total: number };

function displayInvoiceNo(invoiceNo: string | null | undefined) {
  const value = String(invoiceNo ?? '').trim();
  return value.replace(/^(?:TAB|TAC)(?=\d|[\s#:_-])[\s#:_-]*/i, '');
}

// House naming convention for saved invoice PDFs — TAB: "INV<no>-<company>-S$<amt>",
// TAC: "TAC<no>-<company>-S$<amt>" (no spaces around the dashes).
function invoicePdfFileName(company: 'TAB' | 'TAC', invoiceNo: string, companyName: string, total: number) {
  const prefix = company === 'TAB' ? 'INV' : 'TAC';
  const safeCompany = companyName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
  const amount = Number.isInteger(total) ? String(total) : total.toFixed(2);
  return `${prefix}${displayInvoiceNo(invoiceNo)}-${safeCompany}-S$${amount}.pdf`;
}

type WritablePdfFileHandle = {
  createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }>;
};
type SaveFilePickerWindow = Window & {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<WritablePdfFileHandle>;
};

function existingGeneratedPdfs(company: CompanyBilling, cycleFye?: string): GeneratedPdf[] {
  const seen = new Set<'TAB' | 'TAC'>();
  const pdfs: GeneratedPdf[] = [];
  for (const invoice of company.generatedInvoices ?? []) {
    if (cycleFye && invoice.fyeCycle !== cycleFye) continue;
    if (!invoice.invoiceNo || !invoice.qbId || seen.has(invoice.qbCompany)) continue;
    seen.add(invoice.qbCompany);
    pdfs.push({ company: invoice.qbCompany, invoiceNo: invoice.invoiceNo, qbId: invoice.qbId, total: invoice.totalAmt ?? 0 });
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
  const invoiceRequestKey = useRef(globalThis.crypto.randomUUID()).current;
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
  const [parentOverride, setParentOverride] = useState<{ id: number | null; name: string | null }>({ id: c.parentCompanyId, name: c.parentCompanyName });

  // Edit mode (Vincent, 2026-08-18): once an invoice already exists for a
  // company+cycle, this section switches to editing that real QB invoice
  // instead of generating another one — see PATCH /api/quickbooks/update-invoice.
  // Independent per QB company, since a company can have e.g. a TAB invoice
  // already generated and a separate TAC one not yet. No client-side
  // SyncToken tracking needed — the update route always re-reads the
  // invoice's current one itself right before writing.
  const [editLoading, setEditLoading] = useState<Partial<Record<'TAB' | 'TAC', boolean>>>({});
  const [editLoadError, setEditLoadError] = useState<Partial<Record<'TAB' | 'TAC', string>>>({});
  const [savingEdit, setSavingEdit] = useState<Partial<Record<'TAB' | 'TAC', boolean>>>({});
  const [editResult, setEditResult] = useState<Partial<Record<'TAB' | 'TAC', { ok: boolean; msg: string; blocked?: boolean }>>>({});

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
        include: r.periodNeedsReview ? false : isND ? true : due,
        due,
        reason: r.periodNeedsReview ? 'Check latest QB period'
              : isND ? 'Active nominee per TeamWork · confirm annual fee (excl. deposit)'
              : r.status === 'expired' ? `Expired ${Math.abs(r.daysUntilExpiry ?? 0)}d ago`
              : r.status === 'expiring_soon' ? `Expiring in ${r.daysUntilExpiry}d`
              : r.status === 'active' ? `Active until ${r.lastPeriodEnd ? fmtDate(r.lastPeriodEnd) : '—'}`
              : 'No prior invoice',
        previousPeriodEnd: r.lastPeriodEnd,
        periodNeedsReview: r.periodNeedsReview,
        periodReviewed: false,
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
          description: rollRecurringDescriptionForward(p.description || 'Discount Given'),
          qty: 1, rate: p.amount ?? 0, include: true, due: true,
          reason: `Discount from ${priorDate} — confirm it still applies`,
        });
      } else if (/Yearly Accounts Services|Compilation Services|Monthly Accounts Services/i.test(ps) && !/DO NOT USE/i.test(ps)) {
        out.push({
          service: 'Accounts', productService: ps,
          description: rollRecurringDescriptionForward(p.description || ps),
          qty: 1, rate: p.amount ?? MEDIAN_RATE.Accounts ?? 0, include: false, due: false,
          reason: `On ${priorDate} invoice — confirm if recurring`,
        });
      } else if (/Corporate Tax Services|Personal Income Tax Services|Other Tax Services/i.test(ps)) {
        out.push({
          service: 'Tax', productService: ps,
          description: rollRecurringDescriptionForward(p.description || ps),
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

  const tabInvoice = generatedPdfs.find(p => p.company === 'TAB') ?? null;
  const tacInvoice = generatedPdfs.find(p => p.company === 'TAC') ?? null;

  // Fetch each edit-mode company's live QB lines once, replacing that
  // company's slice of `lines` with what's actually on the invoice — not
  // the historical-template guess `initialLines` started from.
  const loadedEditCompanies = useRef(new Set<'TAB' | 'TAC'>()).current;
  const loadLiveLines = useCallback(async (company: 'TAB' | 'TAC', qbId: string) => {
    setEditLoading(prev => ({ ...prev, [company]: true }));
    setEditLoadError(prev => ({ ...prev, [company]: undefined }));
    try {
      const res = await fetch(`/api/quickbooks/invoice-lines?company=${company}&id=${encodeURIComponent(qbId)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Unable to load this invoice from QuickBooks.');
      const liveLines: EditableLine[] = (json.lines ?? []).map((l: { service: string; productService: string; description: string; qty: number; rate: number }) => ({
        service: l.service, productService: l.productService, description: l.description,
        qty: l.qty, rate: l.rate, include: true, due: false, reason: 'Live from QuickBooks',
      }));
      setLines(prev => company === 'TAB'
        ? [...liveLines, ...prev.filter(l => l.service === 'ND')]
        : [...prev.filter(l => l.service !== 'ND'), ...liveLines]);
    } catch (error) {
      setEditLoadError(prev => ({ ...prev, [company]: error instanceof Error ? error.message : 'Unable to load this invoice.' }));
    } finally {
      setEditLoading(prev => ({ ...prev, [company]: false }));
    }
  }, []);

  useEffect(() => {
    if (tabInvoice && !loadedEditCompanies.has('TAB')) {
      loadedEditCompanies.add('TAB');
      void loadLiveLines('TAB', tabInvoice.qbId);
    }
    if (tacInvoice && !loadedEditCompanies.has('TAC')) {
      loadedEditCompanies.add('TAC');
      void loadLiveLines('TAC', tacInvoice.qbId);
    }
  }, [tabInvoice, tacInvoice, loadLiveLines, loadedEditCompanies]);

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
  // Only the side(s) still being generated need a confirmed QB number —
  // an already-existing invoice being edited keeps its real DocNumber,
  // untouched by this panel.
  const missingInvoiceNumber = (!tabInvoice && includedTab.length > 0 && !invoiceNumbers.TAB) || (!tacInvoice && includedTac.length > 0 && !invoiceNumbers.TAC);
  // Overlap issues are split out from everything else (Vincent, 2026-08-19):
  // a real period overlap is a judgment call, not always a mistake —
  // "有时候有特别情况" (sometimes there are special cases) — so it still
  // warns (both here and server-side in create-invoice/route.ts) but no
  // longer disables Generate; instead createInvoice() below pops a confirm
  // dialog the moment it's clicked. "Confirm the latest period" and
  // "incomplete period" stay hard blocks — those are real data gaps, not
  // something a human can just confirm past.
  const blockingPeriodErrors: string[] = [];
  const overlapWarnings: string[] = [];
  for (const line of included) {
    if (!['Secretary', 'Address', 'ND'].includes(line.service)) continue;
    if (line.periodNeedsReview && !line.periodReviewed) {
      blockingPeriodErrors.push(`${line.service}: confirm the latest period against QuickBooks.`);
    }
    const issue = servicePeriodOverlapError(
      line.service,
      parseInvoicePeriod(line.description, line.service),
      line.previousPeriodEnd,
    );
    if (issue?.kind === 'incomplete') blockingPeriodErrors.push(issue.message);
    else if (issue?.kind === 'overlap') overlapWarnings.push(issue.message);
  }
  const hasPeriodError = blockingPeriodErrors.length > 0;
  const hasOverlapWarning = overlapWarnings.length > 0;
  const [overlapConfirmModal, setOverlapConfirmModal] = useState<string[] | null>(null);

  // Once a company already has an invoice this cycle, it's edited via its
  // own "Save … changes" button (see renderSaveButton) instead of the
  // combined bottom Generate button below — that button only ever creates
  // NEW invoices, for whichever company(ies) don't have one yet.
  const needsGenerateTab = !tabInvoice;
  const needsGenerateTac = hasTac && !tacInvoice;
  const showGenerateButton = needsGenerateTab || needsGenerateTac;

  const createInvoice = async (overlapConfirmed = false) => {
    if (hasPeriodError) {
      setDraftResult({ ok: false, msg: blockingPeriodErrors.join(' ') });
      return;
    }
    // Pop the confirm dialog instead of blocking outright — Vincent,
    // 2026-08-19. Only reached on the FIRST click; createInvoice(true) from
    // the modal's own "Generate anyway" button skips straight past this.
    if (hasOverlapWarning && !overlapConfirmed) {
      setOverlapConfirmModal(overlapWarnings);
      return;
    }
    setDrafting(true); setDraftResult(null);
    try {
      const fyeYear = cycleFye ? +cycleFye.slice(-4) : currentYear;
      const toApiLine = (l: EditableLine) => ({
        service: l.service,
        productService: l.productService,
        description: l.description,
        rate: l.rate,
        qty: l.qty,
        periodConfirmed: l.periodReviewed === true,
      });
      const res = await fetch('/api/quickbooks/create-invoice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: c.companyName,
          companyId: c.resolvedCompanyId ?? undefined,
          email: email || undefined,
          txnDate,
          sendEmail: false,
          pic: c.pic ?? undefined,
          // A company that already has an invoice this cycle is edited via
          // saveInvoiceEdit/renderSaveButton instead — never re-created here.
          tabLines: needsGenerateTab ? includedTab.map(toApiLine) : [],
          tacLines: needsGenerateTac ? includedTac.map(toApiLine) : [],
          fyeMonth: c.fyeMonth, fyeYear, fyeCycle: cycleFye ?? null,
          idempotencyKey: invoiceRequestKey,
          docNumbers: invoiceNumbers,
          expectedNextNumbers: suggestedNumbers,
          overlapConfirmed,
        }),
      });
      const json = await res.json();
      // The server independently re-checks the same overlap — it may catch
      // one the client's own (possibly slightly stale) renewal data didn't.
      // Show the same confirm dialog rather than surfacing it as a plain
      // error; confirming retries with overlapConfirmed:true.
      if (res.status === 409 && json.overlapConfirmationRequired && !overlapConfirmed) {
        const warnings = [...(json.overlapWarnings?.tab ?? []), ...(json.overlapWarnings?.tac ?? [])];
        setOverlapConfirmModal(warnings.length ? warnings : ['This invoice period overlaps one already on file.']);
        return;
      }
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
      const numberAdjustments = [
        ...(json.tab?.numberAdjusted ? [`TAB ${json.tab.expectedInvoiceNo} → ${json.tab.invoiceNo}`] : []),
        ...(json.tac?.numberAdjusted ? [`TAC ${json.tac.expectedInvoiceNo} → ${json.tac.invoiceNo}`] : []),
      ];
      const errs: string[] = [];
      if (json.errors?.tab) errs.push(`TAB: ${json.errors.tab}`);
      if (json.errors?.tac) errs.push(`TAC: ${json.errors.tac}`);
      if (json.errors?.persistence) errs.push(json.errors.persistence);
      if (json.success) {
        if (json.tab?.invoiceNo || json.tac?.invoiceNo) {
          setInvoiceNumbers(current => ({
            TAB: json.tab?.invoiceNo ? String(json.tab.invoiceNo) : current.TAB,
            TAC: json.tac?.invoiceNo ? String(json.tac.invoiceNo) : current.TAC,
          }));
        }
        if (numberAdjustments.length) {
          setNumberWarning(`QuickBooks assigned the latest available number: ${numberAdjustments.join(' · ')}. No duplicate invoice number was created.`);
        }
        const pdfs: GeneratedPdf[] = [
          ...(json.tab?.qbId && json.tab?.invoiceNo ? [{ company: 'TAB' as const, qbId: String(json.tab.qbId), invoiceNo: String(json.tab.invoiceNo), total: json.tab.total ?? 0 }] : []),
          ...(json.tac?.qbId && json.tac?.invoiceNo ? [{ company: 'TAC' as const, qbId: String(json.tac.qbId), invoiceNo: String(json.tac.invoiceNo), total: json.tac.total ?? 0 }] : []),
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

  // Saves changes to an invoice that ALREADY exists (edit mode) — a
  // completely different QB call from createInvoice above (a sparse update
  // to one existing invoice, not creating a new one), so it's its own
  // function rather than a branch inside createInvoice.
  const saveInvoiceEdit = async (company: 'TAB' | 'TAC') => {
    const invoice = company === 'TAB' ? tabInvoice : tacInvoice;
    if (!invoice) return;
    const companyLines = company === 'TAB' ? includedTab : includedTac;
    if (!companyLines.length) {
      setEditResult(prev => ({ ...prev, [company]: { ok: false, msg: 'At least one line must be included.' } }));
      return;
    }
    setSavingEdit(prev => ({ ...prev, [company]: true }));
    setEditResult(prev => ({ ...prev, [company]: undefined }));
    try {
      const toApiLine = (l: EditableLine) => ({
        service: l.service, productService: l.productService, description: l.description, rate: l.rate, qty: l.qty,
      });
      const res = await fetch('/api/quickbooks/update-invoice', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qbCompany: company, qbInvoiceId: invoice.qbId, pic: c.pic ?? undefined, lines: companyLines.map(toApiLine) }),
      });
      const json = await res.json();
      if (!res.ok) {
        setEditResult(prev => ({
          ...prev,
          [company]: { ok: false, msg: json.error ?? 'Unable to save changes.', blocked: !!(json.alreadySent || json.staleSyncToken) },
        }));
        return;
      }
      setGeneratedPdfs(prev => prev.map(pdf => pdf.company === company ? { ...pdf, total: json.total ?? pdf.total } : pdf));
      setEditResult(prev => ({ ...prev, [company]: { ok: true, msg: `Saved — ${company} invoice #${displayInvoiceNo(json.invoiceNo)} updated in QuickBooks.` } }));
    } catch (error) {
      setEditResult(prev => ({ ...prev, [company]: { ok: false, msg: error instanceof Error ? error.message : 'Request failed.' } }));
    } finally {
      setSavingEdit(prev => ({ ...prev, [company]: false }));
    }
  };

  const saveInvoicePdf = async (invoice: GeneratedPdf) => {
    if (savingPdfs) return;
    setPdfResult(null);
    setSavingPdfs(true);

    const downloadBlob = (blob: Blob, fileName: string) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    try {
      const visibleInvoiceNo = displayInvoiceNo(invoice.invoiceNo);
      const fileName = invoicePdfFileName(invoice.company, invoice.invoiceNo, c.companyName, invoice.total);
      const saveFilePicker = (window as SaveFilePickerWindow).showSaveFilePicker;
      let fileHandle: WritablePdfFileHandle | null = null;
      let useDownloadFallback = !saveFilePicker;

      if (saveFilePicker) {
        try {
          // Open Save As directly from the button click. Waiting for the PDF
          // request first can consume Chrome's transient user activation.
          fileHandle = await saveFilePicker({
            suggestedName: fileName,
            types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }],
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') {
            setPdfResult({ ok: false, msg: 'Save cancelled. No PDF was saved.' });
            return;
          }
          useDownloadFallback = true;
        }
      }

      const response = await fetch(`/api/quickbooks/invoice-pdf?company=${invoice.company}&id=${encodeURIComponent(invoice.qbId)}`);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error ?? `Unable to download ${invoice.company} invoice ${invoice.invoiceNo}`);
      }
      const blob = await response.blob();

      if (fileHandle && !useDownloadFallback) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
      } else {
        downloadBlob(blob, fileName);
      }

      setPdfResult({
        ok: true,
        msg: fileHandle && !useDownloadFallback
          ? `${invoice.company} invoice #${visibleInvoiceNo} saved to the selected location.`
          : `${invoice.company} invoice #${visibleInvoiceNo} sent to Chrome downloads.`,
      });
    } catch (error) {
      setPdfResult({ ok: false, msg: error instanceof Error ? error.message : 'Unable to save invoice PDF.' });
    } finally {
      setSavingPdfs(false);
    }
  };

  const inputStyle: React.CSSProperties = { border: '1px solid #cbd5e1', borderRadius: 5, padding: '6px 6px', fontSize: 12, outline: 'none', background: '#fff' };

  const renderInvoiceNumber = (company: keyof InvoiceNumberState) => {
    const value = invoiceNumbers[company];
    const suggested = suggestedNumbers[company];
    const manuallyChanged = !!value && !!suggested && value !== suggested;
    // TAC gets the same amber chrome as the rest of its section (badge/PIC
    // pill/table header) instead of the neutral blue-grey shared with TAB —
    // that neutral box was the one piece of "still grey" chrome left sitting
    // inside an otherwise amber-themed block.
    const isTac = company === 'TAC';
    const bg = manuallyChanged ? '#fffbeb' : isTac ? 'var(--status-warning-tint)' : '#f8fafc';
    const border = manuallyChanged ? '#fcd34d' : isTac ? '#fed7aa' : '#dbe5ee';
    const numberColor = manuallyChanged ? '#92400e' : isTac ? '#9a3412' : '#1e3a5f';
    return (
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px 4px 9px', borderRadius: 8, background: bg, border: `1px solid ${border}` }}>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: manuallyChanged ? 'var(--status-warning)' : isTac ? '#9a3412' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '.45px' }}>{manuallyChanged ? 'Manual number' : 'Estimated QB number'}</span>
          <span style={{ fontSize: 8.5, color: isTac ? '#c2703d' : '#94a3b8' }}>{numberLoading ? 'Checking live…' : 'QB confirms when created'}</span>
        </div>
        <input
          value={value}
          onChange={event => { setInvoiceNumbers(current => ({ ...current, [company]: event.target.value.trim() })); setNumberWarning(''); }}
          placeholder={numberLoading ? 'Loading…' : 'Unavailable'}
          aria-label={`${company} invoice number`}
          style={{ width: 92, border: 0, borderBottom: `1px solid ${manuallyChanged ? '#f59e0b' : isTac ? '#fdba74' : '#94a3b8'}`, outline: 'none', background: 'transparent', color: numberColor, fontFamily: 'monospace', fontSize: 11.5, fontWeight: 800, padding: '2px 1px', textAlign: 'center' }}
        />
        <button type="button" onClick={() => setNumberRefreshKey(key => key + 1)} title="Refresh from QuickBooks" style={{ border: 0, background: 'transparent', color: isTac ? '#c2703d' : '#64748b', padding: 2, cursor: 'pointer', display: 'flex' }}>
          <RefreshCw size={12} style={{ animation: numberLoading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>
    );
  };

  // Shared table renderer for both the TAB and TAC sections. TAC passes
  // accent='amber' so its header strip matches the amber chrome the rest of
  // that section already uses (badge/PIC pill/provenance note/footer bar) —
  // previously this stayed flat grey regardless of company, which is what
  // read as uncoordinated sitting inside an otherwise-amber TAC block.
  const renderTable = (rows: { l: EditableLine; i: number }[], emptyMsg: string, accent?: 'amber') => (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '34px 120px 1fr 110px 44px 90px 100px 26px', gap: 0, background: accent === 'amber' ? 'var(--status-warning-tint)' : '#f1f5f9', padding: '12px 10px', fontSize: 10, fontWeight: 700, color: accent === 'amber' ? '#9a3412' : '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
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
          <div key={`${l.productService}-${i}`} style={{ display: 'grid', gridTemplateColumns: '34px 120px 1fr 110px 44px 90px 100px 26px', gap: 0, alignItems: 'start', padding: '16px 10px', borderTop: '1px solid #f1f5f9', background: l.periodNeedsReview ? '#fffaf0' : l.include ? '#fff' : '#fafbfc', opacity: l.include || l.periodNeedsReview ? 1 : 0.55 }}>
            <input type="checkbox" checked={l.include} onChange={e => setLine(i, { include: e.target.checked })} style={{ width: 15, height: 15, cursor: 'pointer', accentColor: '#0f766e' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }} title={l.productService}>
              {cfg && <cfg.Icon size={13} style={{ color: cfg.color }} />}
              <span style={{ fontSize: 12, fontWeight: 700, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svcLabel}</span>
            </div>
            <AutoTextarea value={l.description} onChange={v => setLine(i, { description: v })} style={{ ...inputStyle, width: '95%', fontFamily: 'inherit', lineHeight: 1.4 }} />
            <div style={{ fontSize: 10, fontWeight: 600, color: l.periodNeedsReview ? 'var(--status-warning)' : l.due ? '#c2410c' : '#94a3b8', textAlign: 'center', padding: '0 5px' }}>
              <span>{l.reason}</span>
              {l.periodNeedsReview && (
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginTop: 6, color: l.periodReviewed ? '#15803d' : 'var(--status-warning)', cursor: 'pointer' }}>
                  <input type="checkbox" checked={l.periodReviewed === true} onChange={e => setLine(i, { periodReviewed: e.target.checked })} style={{ width: 12, height: 12, accentColor: '#15803d' }} />
                  Checked in QB
                </label>
              )}
            </div>
            <input type="number" min={1} value={l.qty} onChange={e => setLine(i, { qty: Math.max(1, +e.target.value || 1) })} style={{ ...inputStyle, width: 38, textAlign: 'center', justifySelf: 'center' }} />
            <input type="number" min={0} value={l.rate || ''} placeholder="0" onChange={e => setLine(i, { rate: +e.target.value || 0 })}
              style={{ ...inputStyle, width: 90, textAlign: 'center', justifySelf: 'center', borderColor: l.include && !l.rate ? '#f87171' : '#cbd5e1', background: l.include && !l.rate ? 'var(--status-danger-tint)' : '#fff' }} />
            <span style={{ fontSize: 12, fontWeight: 700, color: l.include ? '#0f766e' : '#94a3b8', textAlign: 'right' }}>{l.include ? `S$${(l.qty * l.rate).toLocaleString()}` : '—'}</span>
            <button onClick={() => setLines(prev => prev.filter((_, idx) => idx !== i))} title="Remove line" style={{ border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', padding: 0, display: 'flex', justifyContent: 'center' }}><X size={13} /></button>
          </div>
        );
      })}
      {rows.length === 0 && <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{emptyMsg}</div>}
    </div>
  );

  // Replaces renderInvoiceNumber(company) in the section header once that
  // company already has an invoice this cycle — editing never touches
  // DocNumber, so there's nothing to estimate/confirm here anymore.
  const renderEditHeader = (company: 'TAB' | 'TAC', invoice: GeneratedPdf | null) =>
    invoice ? (
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, background: '#eef2ff', border: '1px solid #c7d2fe', fontSize: 11, fontWeight: 700, color: '#4338ca' }}>
        <Pencil size={12} /> Editing invoice #{displayInvoiceNo(invoice.invoiceNo)}
      </span>
    ) : renderInvoiceNumber(company);

  // Per-company Save button + result banner, shown instead of the combined
  // bottom Generate button once that company is in edit mode.
  const renderSaveButton = (company: 'TAB' | 'TAC', invoice: GeneratedPdf) => {
    const companyLines = company === 'TAB' ? includedTab : includedTac;
    const saving = !!savingEdit[company];
    const disabled = saving || !!editLoading[company] || companyLines.length === 0 || companyLines.some(l => !l.rate);
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button
          onClick={() => saveInvoiceEdit(company)}
          disabled={disabled}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none',
            cursor: disabled ? 'not-allowed' : 'pointer',
            background: disabled ? '#94a3b8' : '#4338ca', color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
          }}>
          {saving ? 'Saving…' : `Save ${company} changes to QuickBooks`}
        </button>
        {editResult[company] && (
          <span style={{ fontSize: 11.5, fontWeight: 600, color: editResult[company]!.ok ? '#15803d' : 'var(--status-danger)' }}>
            {editResult[company]!.ok ? '✓ ' : '✕ '}{editResult[company]!.msg}
            {editResult[company]!.blocked && (
              <button onClick={() => loadLiveLines(company, invoice.qbId)} style={{ marginLeft: 8, border: 'none', background: 'transparent', color: '#4338ca', fontWeight: 700, cursor: 'pointer', textDecoration: 'underline', fontSize: 11.5 }}>
                Reload latest from QuickBooks
              </button>
            )}
          </span>
        )}
      </div>
    );
  };

  return (
    <>
    <div style={{ padding: '28px 20px', background: '#fff' }}>
      <div style={{ marginBottom: 12 }}>
        <ParentCompanyPicker
          companyId={c.resolvedCompanyId}
          parentCompanyId={parentOverride.id}
          parentCompanyName={parentOverride.name}
          onChange={(id, name) => setParentOverride({ id, name })}
        />
      </div>
      {/* Header: contact + PIC + invoice date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="client@email.com"
            style={{ ...inputStyle, width: 240, color: 'var(--accent-blue)', fontWeight: 600 }} />
        </div>
        {c.contactName && <span style={{ fontSize: 11, color: '#64748b' }}>· {c.contactName}</span>}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>Invoice date</span>
          <input type="date" value={txnDate} onChange={e => setTxnDate(e.target.value)} style={inputStyle} />
        </div>
        {c.pic && <span style={{ fontSize: 11, color: '#64748b', marginLeft: 'auto' }}>SEC / XBRL PIC: <strong style={{ color: '#334155' }}>{formatStaffName(c.pic)}</strong></span>}
      </div>

      {/* TAB — basic services (Secretary/Address/AR/XBRL/Accounts/Tax/Discount).
          Layout mirrors the TAC section: badge header first, then the
          "based on last invoice" provenance note. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 7, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--accent-blue)', background: 'var(--status-info-tint)', border: '1px solid #dbeafe', borderRadius: 5, padding: '2px 8px' }}>TAB</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>Basic Services</span>
        <span style={{ fontSize: 10, color: '#94a3b8' }}>· default QuickBooks company</span>
        {renderEditHeader('TAB', tabInvoice)}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <FileText size={12} />
        {tabInvoice
          ? <span>Editing the real invoice — lines below are loaded live from QuickBooks, not a template.</span>
          : c.priorInvoiceDate
          ? <span>
              Based on last invoice
              {c.priorInvoiceNo && <strong style={{ color: 'var(--accent-blue)', fontFamily: 'monospace', margin: '0 5px', background: 'var(--status-info-tint)', border: '1px solid #dbeafe', padding: '1px 7px', borderRadius: 4 }}>#{c.priorInvoiceNo}</strong>}
              {' '}dated <strong style={{ color: '#334155' }}>{fmtDate(c.priorInvoiceDate)}</strong> — items & amounts carried forward, period rolled to this cycle. Verify discount still applies.
            </span>
          : <span style={{ color: 'var(--status-warning)' }}>No prior renewal invoice found — draft built from standard template. Confirm each line.</span>}
      </div>
      <div style={{ marginBottom: 0 }}>
        {editLoading.TAB ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8 }}>Loading live invoice lines from QuickBooks…</div>
        ) : editLoadError.TAB ? (
          <div style={{ padding: 12, borderRadius: 8, border: '1px solid #fecaca', background: 'var(--status-danger-tint)', color: 'var(--status-danger)', fontSize: 12, fontWeight: 600 }}>{editLoadError.TAB}</div>
        ) : renderTable(tabRows, 'No applicable services for this company.')}
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
        {tabInvoice && renderSaveButton('TAB', tabInvoice)}
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
              <span style={{ fontSize: 10.5, color: '#9a3412', background: 'var(--status-warning-tint)', border: '1px solid #fed7aa', borderRadius: 999, padding: '2px 8px', marginLeft: 3 }}>
                TAC PIC: <strong>{c.ndPic}</strong>{ndInitials ? ` · ${ndInitials} in service` : ' · confirm service shorthand'}
              </span>
            )}
            {tacStatus && !tacStatus.connected && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10.5, fontWeight: 700, color: 'var(--status-danger)', background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 5, padding: '2px 8px', marginLeft: 4 }}>
                <AlertTriangle size={11} />
                QuickBooks TAC not connected
                <a href="/api/quickbooks/auth?company=TAC" style={{ color: 'var(--accent-blue)', textDecoration: 'underline', fontWeight: 700 }}>Connect TAC</a>
              </span>
            )}
            {renderEditHeader('TAC', tacInvoice)}
          </div>
          {/* Provenance for the TAC invoice — mirrors the TAB note above. The
              ND draft line's item & fee come from this exact invoice. */}
          {tacInvoice ? (
            <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText size={12} />
              <span>Editing the real invoice — lines below are loaded live from QuickBooks, not a template.</span>
            </div>
          ) : (() => {
            const ndPrior = c.renewals.find(r => r.service === 'ND')?.history?.[0] ?? null;
            return (
              <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileText size={12} />
                {ndPrior?.invoice_no
                  ? <span>
                      Based on last invoice
                      <strong style={{ color: '#9a3412', fontFamily: 'monospace', margin: '0 5px', background: '#ffedd5', border: '1px solid #fed7aa', padding: '1px 7px', borderRadius: 4 }}>#{displayInvoiceNo(ndPrior.invoice_no)}</strong>
                      {ndPrior.txn_date && <> dated <strong style={{ color: '#334155' }}>{fmtDate(ndPrior.txn_date)}</strong></>}
                      {' '}— ND fee &amp; director item carried forward, period rolled to this cycle.
                    </span>
                  : <span style={{ color: 'var(--status-warning)' }}>No prior ND invoice found — confirm the director&apos;s item &amp; fee before generating.</span>}
              </div>
            );
          })()}
          <div style={{ marginBottom: 0 }}>
            {editLoading.TAC ? (
              <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 12, border: '1px solid #e2e8f0', borderRadius: 8 }}>Loading live invoice lines from QuickBooks…</div>
            ) : editLoadError.TAC ? (
              <div style={{ padding: 12, borderRadius: 8, border: '1px solid #fecaca', background: 'var(--status-danger-tint)', color: 'var(--status-danger)', fontSize: 12, fontWeight: 600 }}>{editLoadError.TAC}</div>
            ) : renderTable(tacRows, 'No Nominee Director line.', 'amber')}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 10px', border: '1px solid #e2e8f0', borderTop: 'none', borderRadius: '0 0 8px 8px', background: 'var(--status-warning-tint)' }}>
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
            {tacInvoice && renderSaveButton('TAC', tacInvoice)}
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
        {missingRate && <span style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600 }}>⚠ Fill in the highlighted rate(s) before generating</span>}
        {missingInvoiceNumber && !numberLoading && <span style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600 }}>Confirm the required QB invoice number</span>}
        {hasPeriodError && (
          <div style={{ flexBasis: '100%', border: '1px solid #fecaca', background: 'var(--status-danger-tint)', color: '#b91c1c', borderRadius: 7, padding: '9px 12px', fontSize: 11, fontWeight: 600 }}>
            Period check required: {blockingPeriodErrors.slice(0, 3).join(' · ')}
          </div>
        )}
        {!hasPeriodError && hasOverlapWarning && (
          <div style={{ flexBasis: '100%', border: '1px solid #fed7aa', background: 'var(--status-warning-tint)', color: '#9a3412', borderRadius: 7, padding: '9px 12px', fontSize: 11, fontWeight: 600 }}>
            ⚠ {overlapWarnings.slice(0, 3).join(' · ')} — you can still generate; you&apos;ll be asked to confirm.
          </div>
        )}
        {showGenerateButton && (() => {
          const pendingTabCount = needsGenerateTab ? includedTab.length : 0;
          const pendingTacCount = needsGenerateTac ? includedTac.length : 0;
          const nothingPending = pendingTabCount + pendingTacCount === 0;
          const disabled = drafting || numberLoading || nothingPending || missingRate || missingInvoiceNumber || hasPeriodError;
          return (
            <button
              onClick={() => createInvoice()}
              disabled={disabled}
              style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 8, border: 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                background: disabled ? '#94a3b8' : '#0f766e', color: '#fff', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap',
              }}>
              {
                drafting ? 'Generating…'
                : pendingTabCount && pendingTacCount ? 'Generate 2 Invoices (TAB + TAC)'
                : pendingTacCount ? 'Generate Invoice in QB (TAC)'
                : 'Generate Invoice in QB (TAB)'
              }
            </button>
          );
        })()}
      </div>

      {numberWarning && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 7, padding: '9px 11px', borderRadius: 8, background: 'var(--status-warning-tint)', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 11, fontWeight: 650 }}>
          <AlertTriangle size={13} style={{ marginTop: 1, flexShrink: 0 }} />
          <span>{numberWarning}</span>
        </div>
      )}

      {draftResult && (
        <div style={{ marginTop: 20, padding: '12px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600,
          background: draftResult.ok ? 'var(--status-success-tint)' : 'var(--status-danger-tint)', color: draftResult.ok ? '#15803d' : 'var(--status-danger)',
          border: `1px solid ${draftResult.ok ? '#bbf7d0' : '#fecaca'}` }}>
          {draftResult.ok ? '✓ ' : '✕ '}{draftResult.msg}
        </div>
      )}

      {generatedPdfs.length > 0 && (
        <div style={{ marginTop: 12, padding: '12px 13px', borderRadius: 9, border: '1px solid #bfdbfe', background: '#f8fbff', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#1e3a5f' }}>Invoice PDF ready</div>
            <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
              {generatedPdfs.map(pdf => `#${displayInvoiceNo(pdf.invoiceNo)}`).join(' · ')} · Windows Save As, without granting access to the whole folder
            </div>
          </div>
          {generatedPdfs.map(pdf => (
            <button key={`${pdf.company}-${pdf.qbId}`} type="button" onClick={() => saveInvoicePdf(pdf)} disabled={savingPdfs} style={{ border: '1px solid #93c5fd', borderRadius: 7, background: savingPdfs ? '#dbeafe' : 'var(--status-info-tint)', color: 'var(--accent-blue)', padding: '8px 12px', fontSize: 11.5, fontWeight: 800, cursor: savingPdfs ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileText size={13} /> {savingPdfs ? 'Preparing PDF…' : `Save ${pdf.company} PDF`}
            </button>
          ))}
        </div>
      )}

      {pdfResult && (
        <div style={{ marginTop: 8, fontSize: 11, fontWeight: 650, color: pdfResult.ok ? '#15803d' : 'var(--status-warning)' }}>{pdfResult.msg}</div>
      )}

      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16, marginTop: 24, fontSize: 10, color: '#94a3b8' }}>
        ⚠ The invoice is created as a draft in QuickBooks (not sent). Review it in QB, then send to the client from there.
      </div>
    </div>
    {overlapConfirmModal && (
      <div onClick={() => setOverlapConfirmModal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 440, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--status-warning-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <AlertTriangle size={20} style={{ color: 'var(--status-warning)' }} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>This period overlaps an existing invoice</div>
          </div>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 12, lineHeight: 1.5 }}>
            {overlapConfirmModal.map((msg, i) => <div key={i} style={{ marginBottom: 4 }}>{msg}</div>)}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20, lineHeight: 1.5 }}>
            If this is genuinely a special case (a correction, a split invoice, etc.), you can generate it anyway. Otherwise, cancel and check the period or the company&apos;s existing invoices first.
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setOverlapConfirmModal(null)}
              style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              Cancel
            </button>
            <button onClick={() => { setOverlapConfirmModal(null); void createInvoice(true); }}
              style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'var(--status-warning)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Generate anyway
            </button>
          </div>
        </div>
      </div>
    )}
    </>
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
  billing_remarks: string | null;
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
             : { service, applicable, lastPeriodEnd: null, lastRate: null, daysUntilExpiry: null, status: 'not_found', suggestedPeriodStart: null, suggestedPeriodEnd: null, periodNeedsReview: false, periodWarning: null, history: [] };
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
    billingRemarks: ar.billing_remarks ?? null,
    billedCycles: matched?.billedCycles ?? [],
    priorLines: matched?.priorLines ?? [],
    priorInvoiceDate: matched?.priorInvoiceDate ?? null,
    priorInvoiceNo: matched?.priorInvoiceNo ?? null,
    generatedInvoices: matched?.generatedInvoices ?? [],
    resolvedCompanyId: matched?.companyId ?? null,
    parentCompanyId: matched?.parentCompanyId ?? null,
    parentCompanyName: matched?.parentCompanyName ?? null,
  };
}

// Both Billing Drafts and AR Reminder List are scoped to one FYE month/year
// batch at a time (each company has a single fixed FYE month, and the
// numbers shown are computed against that specific cycle) — so searching
// for a company outside the current batch previously just showed "no
// matching records" with no explanation. When the local (name-or-UEN)
// search comes up empty, this escalates to a cross-cycle lookup via
// `fetchMatch` (source differs per tab — see call sites) and, if found,
// jumps the month/year selectors to that company's real FYE cycle so the
// numbers stay accurate. `onSwitch` lets each tab clear its own
// status/column filters so the newly-loaded company can't end up hidden by
// an unrelated filter.
function useCrossCycleSearch(
  items: { companyName: string; uen: string | null }[],
  months: string[],
  year: string,
  setMonth: (v: string) => void,
  setYear: (v: string) => void,
  search: string,
  onSwitch: () => void,
  fetchMatch: (term: string) => Promise<{ companyName: string; fyeMonth: string | null; fyeYear: number | null } | null>,
): string | null {
  const [notice, setNotice] = useState<string | null>(null);
  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; }, [items]);
  const monthsRef = useRef(months);
  useEffect(() => { monthsRef.current = months; }, [months]);
  const yearRef = useRef(year);
  useEffect(() => { yearRef.current = year; }, [year]);
  const onSwitchRef = useRef(onSwitch);
  useEffect(() => { onSwitchRef.current = onSwitch; }, [onSwitch]);
  const fetchMatchRef = useRef(fetchMatch);
  useEffect(() => { fetchMatchRef.current = fetchMatch; }, [fetchMatch]);

  useEffect(() => {
    const term = search.trim();
    if (!term) { setNotice(null); return; }
    const timer = setTimeout(async () => {
      const q = term.toLowerCase();
      const localMatch = itemsRef.current.some(c => c.companyName.toLowerCase().includes(q) || (c.uen ?? '').toLowerCase().includes(q));
      if (localMatch) { setNotice(null); return; }
      try {
        const match = await fetchMatchRef.current(term);
        if (!match) { setNotice(`No company found matching "${term}".`); return; }
        if (!match.fyeMonth) { setNotice(`${match.companyName} has no FYE month on file — can't switch automatically.`); return; }
        const monthChanged = !monthsRef.current.includes(match.fyeMonth);
        const yearChanged  = match.fyeYear != null && String(match.fyeYear) !== yearRef.current;
        if (monthChanged || yearChanged) {
          setNotice(`Switched to ${match.fyeMonth}${yearChanged ? ` ${match.fyeYear}` : ''} — ${match.companyName}'s FYE cycle.`);
          setMonth(match.fyeMonth);
          if (yearChanged && match.fyeYear != null) setYear(String(match.fyeYear));
          onSwitchRef.current();
        } else {
          setNotice(null);
        }
      } catch { setNotice(null); }
    }, 400);
    return () => clearTimeout(timer);
  }, [search, setMonth, setYear]);

  return notice;
}

// Wide enough to cover long-struck-off companies mirrored in from Late
// Filing (their FYE cycle can be many years old — e.g. 2022) while still
// being a reasonable dropdown length. Was hardcoded to 2024-2027, which
// made those older cycles unreachable in the UI even once a row existed.
const CURRENT_YEAR_FOR_OPTIONS = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 14 }, (_, i) => String(CURRENT_YEAR_FOR_OPTIONS - 12 + i));

function BillingTab({ month, year, setMonth, setYear }: { month: string; year: string; setMonth: (v: string) => void; setYear: (v: string) => void }) {
  const [data,       setData]       = useState<{ summary: BillingSummary; companies: CompanyBilling[] } | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [expanded,   setExpanded]   = useState<number | null>(null);
  const [search,     setSearch]     = useState('');
  const [filter,     setFilter]     = useState<'all' | 'needs' | 'expired' | 'expiring_soon' | 'active'>('all');
  const [withinDays, setWithinDays] = useState(90);

  const [arList, setArList] = useState<ARCompany[]>([]);
  // EditField already PATCHes /api/ar-reminder itself (ar.id === the AR
  // Reminder row id, per arToBillingRow's own comment) -- this just keeps
  // arList (and therefore monthCompanies, derived from it) in sync after a
  // successful save, same optimistic-update role handleSave plays on the
  // AR Reminder tab.
  const handleArSave = useCallback((id: number, field: string, value: string) => {
    setArList(prev => prev.map(ar => ar.id === id ? { ...ar, [field]: value || null } : ar));
  }, []);

  // Quick "EMAIL DRAFTS" action: pick a template, jump straight to Outlook,
  // without the Campaign Centre wizard. Reuses the same recipient/invoice
  // resolution and merge logic as Client Communications, and still records
  // a campaign+draft (type 'ar') so it shows up in Delivery History like
  // every other draft — just without the multi-step review screen first.
  const [me, setMe] = useState<{ email: string; name: string } | null>(null);
  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : { user: null }).then(j => setMe(j.user ?? null)).catch(() => setMe(null));
  }, []);
  // Whole-row tint (Vincent, 2026-08-18): green once a company's AR draft
  // for this cycle is confirmed sent (auto-detected via Draft Helper's
  // ItemSend listener, or manually confirmed in Delivery History), amber if
  // one exists but isn't sent yet, untouched if none exists at all. "sent"
  // wins over "drafted" if a company somehow has more than one this cycle.
  const [draftStatusByCompany, setDraftStatusByCompany] = useState<Map<string, 'sent' | 'drafted'>>(new Map());
  const loadDraftStatus = useCallback(() => {
    fetch(`/api/client-communications/drafts?type=ar&fyeMonth=${encodeURIComponent(month)}&fyeYear=${year}&limit=500`)
      .then(r => r.json())
      .then(j => {
        const rows: { company_name: string; status: string }[] = j.data ?? [];
        const map = new Map<string, 'sent' | 'drafted'>();
        for (const row of rows) {
          // A skipped draft (Delivery History's "Skip") is a deliberate
          // non-send, not a pending one — it must not keep the row amber.
          if (row.status === 'skipped') continue;
          const key = normName(row.company_name);
          const next = row.status === 'sent' ? 'sent' : 'drafted';
          if (next === 'sent' || map.get(key) !== 'sent') map.set(key, next);
        }
        setDraftStatusByCompany(map);
      }).catch(() => {});
  }, [month, year]);
  useEffect(() => { loadDraftStatus(); }, [loadDraftStatus]);
  const [helperAvailable, setHelperAvailable] = useState<boolean | null>(null);
  const [helperOutdated, setHelperOutdated] = useState(false);
  useEffect(() => {
    getHelperHealth().then(health => {
      setHelperAvailable(health !== null);
      setHelperOutdated(isHelperOutdated(health));
    });
  }, []);
  const [emailTemplates, setEmailTemplates] = useState<{ id: number; name: string; subject_template: string; body_template: string; is_default: boolean }[]>([]);
  useEffect(() => {
    fetch('/api/client-communications/templates?type=ar').then(r => r.json()).then(j => {
      const list = j.data ?? [];
      setEmailTemplates(list);
      setSelectedTemplateId(prev => prev ?? list.find((t: { is_default: boolean }) => t.is_default)?.id ?? list[0]?.id ?? null);
    }).catch(() => {});
  }, []);
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(null);
  // Billing Drafts' quick draft used to always send from finance@tassure.com
  // with no picker at all. Vincent, 2026-08-18: needed a second option
  // (vincenttassure@outlook.com) after hitting "account not configured on
  // this computer" — but finance@tassure.com must stay the default. Reuses
  // the same email_senders table/API Campaign Centre's sender picker
  // already uses, so adding another sender there covers both pages at once.
  const [senders, setSenders] = useState<{ id: number; email: string; display_name: string | null; is_default: boolean }[]>([]);
  const [senderId, setSenderId] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/client-communications/senders').then(r => r.json()).then(j => {
      const list = j.data ?? [];
      setSenders(list);
      setSenderId(prev => prev ?? list.find((s: { is_default: boolean }) => s.is_default)?.id ?? list[0]?.id ?? null);
    }).catch(() => {});
  }, []);
  const selectedSender = senders.find(s => s.id === senderId) ?? null;
  const [draftPopoverFor, setDraftPopoverFor] = useState<number | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  // Set once quickEmailDraft has created the draft row and Draft Helper is
  // available — opens the Outlook-style review screen for the actual send.
  const [sendModalDraft, setSendModalDraft] = useState<DraftLike | null>(null);
  // No email on file (e.g. TeamWork never captured one) — offer a one-off
  // manual entry instead of just blocking (Vincent, 2026-08-19). Not saved
  // back to the company record, only used for this one draft. Cc is shown
  // alongside To (not just To alone) because the resolved default Cc list
  // (buildDefaultCcList — always includes hoechyi@tassure.com plus any
  // resolved PIC emails, see lib/client-comms-resolve.ts) already exists
  // even when To is missing — staff should see and be able to adjust it,
  // not send blind to whatever was silently pre-filled.
  const [needsManualEmail, setNeedsManualEmail] = useState(false);
  const [manualToEmail, setManualToEmail] = useState('');
  const [manualCcEmail, setManualCcEmail] = useState('');
  // Resolved as soon as the popover opens (Vincent, 2026-08-19: "不需要我按
  // DRAFT了才写email，而是你一开始就应该知道") — reused for the actual draft
  // rather than re-fetched, so opening early costs one lookup, not two.
  const [previewRow, setPreviewRow] = useState<{
    companyName: string; companyId: number | null; toEmail: string | null; ccEmail: string | null;
    contactName: string; invoiceRefs: { qbCompany: 'TAB' | 'TAC' | 'TAO'; invoiceNo: string; amount: number; qbInvoiceId?: string | null }[];
    totalAmount: number;
  } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const resolveDraftPreview = async (c: CompanyBilling) => {
    setPreviewLoading(true);
    try {
      const previewRes = await fetch(`/api/client-communications/campaigns/preview?lookup=${encodeURIComponent(c.companyName)}&type=ar&fyeMonth=${encodeURIComponent(month)}&fyeYear=${year}`);
      const previewJson = await previewRes.json();
      if (!previewRes.ok || !previewJson.row) { setDraftError(previewJson.error ?? 'Unable to resolve this company.'); return; }
      setPreviewRow(previewJson.row);
      if (!previewJson.row.toEmail) {
        setNeedsManualEmail(true);
        setManualCcEmail(previewJson.row.ccEmail ?? '');
        setDraftError('No valid recipient email on file — resolve this in Campaign Centre, or type one below to draft anyway.');
      }
    } catch {
      setDraftError('Unable to resolve this company.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const quickEmailDraft = async (c: CompanyBilling, override?: { to?: string; cc?: string }) => {
    const templateId = selectedTemplateId;
    if (!templateId) { setDraftError('No AR template found — add one in Client Communications › Templates.'); return; }
    if (!previewRow) { setDraftError('Still resolving this company — try again in a moment.'); return; }
    setDrafting(true);
    setDraftError(null);
    try {
      const row = { ...previewRow };
      if (!row.toEmail && override?.to && isValidEmail(override.to)) row.toEmail = override.to;
      if (override?.cc !== undefined) row.ccEmail = override.cc || null;
      if (!row.toEmail) {
        setNeedsManualEmail(true);
        setDraftError('No valid recipient email on file — resolve this in Campaign Centre, or type one below to draft anyway.');
        return;
      }

      const createRes = await fetch('/api/client-communications/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'ar', name: `Quick Draft - ${row.companyName} - ${month} ${year}`, fyeMonth: month, fyeYear: Number(year),
          templateId, companies: [row], createdByEmail: me?.email, createdByName: me?.name,
        }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok || !createJson.ok) throw new Error(createJson.error ?? 'Unable to save this draft.');
      // Use the server-persisted draft (with a real id) rather than a
      // client-merged copy — needed for the review screen's later PATCHes
      // (mark-sent, save-on-close), which require a real id/version.
      const createdDraft = createJson.drafts?.[0];
      if (!createdDraft) throw new Error('Draft was not created.');

      const draftForOutlook: DraftLike = {
        id: createdDraft.id, version: createdDraft.version,
        company_name: createdDraft.company_name, to_email: createdDraft.to_email, cc_email: createdDraft.cc_email,
        subject: createdDraft.subject, body: createdDraft.body, invoice_refs: createdDraft.invoice_refs,
        sender_email: selectedSender?.email ?? 'finance@tassure.com',
        // This draft's amount came from generated_invoices moments ago (the
        // POST above) — skip prepareDraftForSend's live QuickBooks re-check,
        // which exists for a draft that's sat around since (see
        // skip_amount_refresh's own comment in draft-helper-client.ts).
        skip_amount_refresh: true,
      };
      if (helperAvailable) {
        // Amount re-verification, attachment resolution and the actual send
        // all now happen in the Outlook-style review screen itself — see
        // OutlookStyleSendModal, which calls prepareDraftForSend on open.
        setSendModalDraft(draftForOutlook);
      } else {
        window.location.href = buildMailtoLink(draftForOutlook);
      }
      setDraftPopoverFor(null);
      loadDraftStatus();
    } catch (e: unknown) {
      setDraftError(e instanceof Error ? e.message : 'Unable to create this draft.');
    } finally {
      setDrafting(false);
    }
  };

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

  const draftPopoverRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (draftPopoverFor === null) return;
    const onClickOutside = (e: MouseEvent) => { if (draftPopoverRef.current && !draftPopoverRef.current.contains(e.target as Node)) setDraftPopoverFor(null); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [draftPopoverFor]);


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

  const fetchBillingMatch = useCallback(async (term: string) => {
    const res = await fetch(`/api/companies?search=${encodeURIComponent(term)}&limit=5`);
    const json = await res.json();
    const matches: { companyName: string; fyeMonth: string | null }[] = json.data ?? [];
    return matches[0] ? { companyName: matches[0].companyName, fyeMonth: matches[0].fyeMonth, fyeYear: null } : null;
  }, []);
  const crossMonthNotice = useCrossCycleSearch(monthCompanies, [month], year, setMonth, setYear, search, useCallback(() => { setFilter('all'); }, []), fetchBillingMatch);

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
  // Falls back to a MANUALLY INVOICED marker in Remarks (see
  // manualInvoiceOverrides above) when this cycle has no real
  // generated_invoices row — a company invoiced straight in QB, outside
  // this system, on purpose.
  const latestInvoiceNo = (c: CompanyBilling, company: 'TAB' | 'TAC') => {
    const matches = generatedThisCycle(c).filter(g => g.qbCompany === company);
    if (matches.length) return matches.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)).invoiceNo;
    return manualInvoiceOverrides(c.billingRemarks).find(o => o.company === company)?.invoiceNo ?? null;
  };
  const manualInvoiceOverride = (c: CompanyBilling, company: 'TAB' | 'TAC') =>
    generatedThisCycle(c).some(g => g.qbCompany === company) ? null : manualInvoiceOverrides(c.billingRemarks).find(o => o.company === company) ?? null;
  const notInvoicedYet = (c: CompanyBilling) =>
    !currentFye ? true
    : generatedThisCycle(c).length > 0 ? false
    : manualInvoiceOverrides(c.billingRemarks).length > 0 ? false
    : !(c.billedCycles ?? []).includes(currentFye);
  const needsCount = monthCompanies.filter(notInvoicedYet).length;
  const filtered = monthCompanies.filter(c => {
    if (search && !c.companyName.toLowerCase().includes(search.toLowerCase()) && !(c.uen ?? '').toLowerCase().includes(search.toLowerCase())) return false;
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
  const billingListColumns = '32px minmax(230px,1.55fr) 112px 68px 190px 94px 180px 116px 116px 100px 160px 38px';

  const S: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13, background: '#fff', outline: 'none', color: '#1e3a5f' };
  // Counts scoped to the selected FYE month.
  const mCount = { total: monthCompanies.length, needs: needsCount, invoiced: monthCompanies.length - needsCount };

  return (
    <div>
      {/* Controls — month/year shared with AR Reminder */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: isMobile ? 'wrap' : undefined }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#203d5f', display: 'flex', alignItems: 'center', gap: 5 }}><Calendar size={14} />Invoicing FYE</span>
        <select value={month} onChange={e => setMonth(e.target.value)} style={S}>
          {FYE_MONTHS.map(m => <option key={m}>{m}</option>)}
        </select>
        <select value={year} onChange={e => setYear(e.target.value)} style={S}>
          {YEAR_OPTIONS.map(y => <option key={y}>{y}</option>)}
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
            { key: 'all',    label: `AR Reminder · FYE ${month || '—'} ${year}`, sub: 'staff-reviewed batch this cycle', value: mCount.total,    color: '#1d3a5c', Icon: FileText },
            { key: 'needs',  label: 'Needs Billing',               sub: 'not yet invoiced this cycle',  value: mCount.needs,    color: '#c2410c', Icon: AlertTriangle },
            { key: 'active', label: 'Invoiced',                    sub: 'already invoiced this cycle',   value: mCount.invoiced, color: 'var(--status-success)', Icon: CheckCircle2 },
          ] as const).map(({ key, label, sub, value, color, Icon }) => {
            const active = filter === key;
            return (
              <MetricCard
                key={key}
                onClick={() => setFilter(key)}
                active={active}
                value={value}
                label={label}
                sub={sub}
                icon={<Icon size={16} />}
                color={color}
                ariaLabel={`Filter billing drafts by ${label}`}
              />
            );
          })}
        </div>
      )}

      {error && <div style={{ background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {/* Filter */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="text" placeholder="Search company name or UEN / ROC… (any FYE month)" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 13, outline: 'none' }} />
          <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{filtered.length} companies</span>
        </div>
        {crossMonthNotice && <div style={{ fontSize: 11, color: '#2563eb', marginTop: 6 }}>{crossMonthNotice}</div>}
      </div>

      {/* Table */}
      <div className="system-list-shell">
        <div className="system-list-title-bar" style={{ padding: '8px 16px' }}>
          <span className="system-list-title">Billing Drafts</span>
          <span className="system-list-title-hint" style={{ marginLeft: 8 }}>Driven by the AR Reminder cycle (TeamWork + staff review) · fees from QB history · invoices generated only after manual review</span>
        </div>
        {/* minHeight keeps this from shrinking to just a few rows' worth of
            height when the filtered result set is small — the Email Drafts
            popover opened from a row near the bottom needs room to render
            below it, and a too-short container clips it via overflowY.
            Same fix already applied to MasterListTable.tsx and the AR Tab's
            own table further down this file — this is a third, separate
            table implementation that never got it (Vincent, 2026-08-19). */}
        <div className="system-list-scroll" style={{ maxHeight: 'calc(100vh - 420px)', minHeight: 400 }}>
          <div style={{ minWidth: isMobile ? undefined : 1320 }}>
          {!isMobile && <div className="list-column-header-gray" style={{ position: 'sticky', top: 0, zIndex: 2, display: 'grid', gridTemplateColumns: billingListColumns, columnGap: 10, padding: '10px 14px', borderLeft: '3px solid transparent', alignItems: 'center' }}>
            {['', 'Company Name', 'Billing Status', 'FYE', 'Renewal Services', '', 'Annual Obligations', 'TAB Invoice', 'TAC Invoice', 'PIC', 'Remarks', ''].map((h, i) => (
              i === 5
                ? <div key={i} style={{ padding: '0 6px', textAlign: 'center' }}>ND (TAC)</div>
                : (i >= 2 && i <= 8)
                ? <div key={i} style={{ padding: '0 6px', textAlign: 'center' }}>{h}</div>
                : <div key={i} style={{ padding: '0 6px' }}>{h}</div>
            ))}
          </div>}
          {loading && !data && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>}
          {!loading && arList.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No AR Reminder batch for {month} {year}. Generate/review it on the AR Reminder tab first.</div>}
          {!loading && arList.length > 0 && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>No matching records</div>}
          {pageItems.map((c, i) => {
            const isOpen = expanded === c.companyId;
            const secR   = c.renewals.find(r => r.service === 'Secretary');
            const addrR  = c.renewals.find(r => r.service === 'Address');
            const ndR    = c.renewals.find(r => r.service === 'ND');
            const arA    = c.annuals.find(a => a.service === 'AR');
            const xbrlA  = c.annuals.find(a => a.service === 'XBRL');
            const draftStatus = draftStatusByCompany.get(normName(c.companyName));
            // .system-list-row's own background is !important (see
            // globals.css) — a plain inline style here would silently lose
            // to it, so the tint has to be a real class, same reasoning
            // --selected below already relies on.
            const draftRowClass = draftStatus === 'sent' ? ' system-list-row--draft-sent'
              : draftStatus === 'drafted' ? ' system-list-row--draft-pending' : '';
            // Phone: view-only card (no draft modal — that's a desktop task)
            if (isMobile) return (
              <div key={c.companyId} className={`system-list-row${draftRowClass}`} style={{ padding: '11px 12px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 600, paddingTop: 2 }}>{startIndex + i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="company-name-text">{c.companyName}</div>
                    {c.parentCompanyName && <div style={{ marginTop: 2 }}><ParentCompanyBadge name={c.parentCompanyName} /></div>}
                    {c.uen && <div className="company-registration-text">{c.uen} · FYE {c.fyeMonth ?? '—'}</div>}
                  </div>
                  {notInvoicedYet(c)
                    ? <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--status-warning-tint)', color: '#c2410c', borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap' }}>To invoice</span>
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
                    {latestInvoiceNo(c, 'TAB') && <BillingInvoiceReference company="TAB" invoiceNo={latestInvoiceNo(c, 'TAB')} muted={!!manualInvoiceOverride(c, 'TAB')} title={manualInvoiceOverride(c, 'TAB') ? 'Manually invoiced directly in QuickBooks — see Remarks' : undefined} />}
                    {latestInvoiceNo(c, 'TAC') && <BillingInvoiceReference company="TAC" invoiceNo={latestInvoiceNo(c, 'TAC')} muted={!!manualInvoiceOverride(c, 'TAC')} title={manualInvoiceOverride(c, 'TAC') ? 'Manually invoiced directly in QuickBooks — see Remarks' : undefined} />}
                    {c.pic && <span style={{ fontSize: 10.5, color: '#64748b' }}>PIC: {formatStaffName(c.pic)}</span>}
                  </div>
                )}
              </div>
            );
            return (
              <div key={c.companyId}>
                <div className={`system-list-row${isOpen ? ' system-list-row--selected' : draftRowClass}`} onClick={() => setExpanded(isOpen ? null : c.companyId)}
                  style={{ display: 'grid', gridTemplateColumns: billingListColumns, alignItems: 'center', minHeight: 68, columnGap: 10, padding: '11px 14px', cursor: 'pointer', transition: 'background 0.15s' }}>
                  <div style={{ color: '#94a3b8' }}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</div>
                  <div style={{ padding: '0 6px' }}>
                    <div className="company-name-text" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: '#cbd5e1', fontSize: 10 }}>{startIndex + i + 1}</span>{c.companyName}
                    </div>
                    {c.parentCompanyName && <div style={{ marginTop: 2 }}><ParentCompanyBadge name={c.parentCompanyName} /></div>}
                    {c.uen && <div className="company-registration-text">{c.uen}</div>}
                  </div>
                  <div style={{ width: '100%', padding: '0 6px', display: 'flex', justifyContent: 'center', boxSizing: 'border-box' }}>
                    {notInvoicedYet(c)
                      ? <BillingStatusPill label="To invoice" color="#c2410c" background="var(--status-warning-tint)" border="#fed7aa" />
                      : <BillingStatusPill label="Invoiced" color="#15803d" background="var(--status-success-tint)" border="#bbf7d0" />}
                  </div>
                  <div style={{ width: '100%', padding: '0 6px', fontSize: 11, color: '#64748b', textAlign: 'center', boxSizing: 'border-box' }}>{c.fyeMonth ?? '—'}</div>
                  <div style={{ width: '100%', padding: '2px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, whiteSpace: 'nowrap', boxSizing: 'border-box' }}>
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
                  <div style={{ width: '100%', padding: '2px 6px', display: 'flex', justifyContent: 'center', boxSizing: 'border-box' }}>
                    <BillingInvoiceReference company="TAB" invoiceNo={latestInvoiceNo(c, 'TAB')}
                      muted={!!manualInvoiceOverride(c, 'TAB')}
                      title={manualInvoiceOverride(c, 'TAB') ? 'Manually invoiced directly in QuickBooks — see Remarks' : undefined} />
                  </div>
                  <div style={{ width: '100%', padding: '0 6px', display: 'flex', justifyContent: 'center', boxSizing: 'border-box' }}>
                    {(() => {
                      // This cycle's system-generated TAC invoice takes priority;
                      // otherwise fall back to the company's most recent ND
                      // invoice from synced history (ND invoices carry a service
                      // period, not an FYE-cycle marker, so they can't be keyed
                      // to cycles the way the TAB backfill was) — shown muted.
                      const gen = latestInvoiceNo(c, 'TAC');
                      const manualTac = manualInvoiceOverride(c, 'TAC');
                      if (gen) return <BillingInvoiceReference company="TAC" invoiceNo={gen}
                        muted={!!manualTac} title={manualTac ? 'Manually invoiced directly in QuickBooks — see Remarks' : undefined} />;
                      const ndHist = c.renewals.find(r => r.service === 'ND' && r.applicable)?.history?.[0];
                      if (ndHist?.invoice_no) return (
                        <BillingInvoiceReference company="TAC" invoiceNo={ndHist.invoice_no}
                          title={`Last ND invoice${ndHist.txn_date ? ` · ${fmtDate(ndHist.txn_date)}` : ''} — historical, not this cycle`} muted />
                      );
                      return <BillingInvoiceReference company="TAC" />;
                    })()}
                  </div>
                  <div style={{ padding: '0 6px', fontSize: 11, color: '#374151' }}>{c.pic ? formatStaffName(c.pic) : '—'}</div>
                  <div style={{ padding: '0 6px' }} onClick={e => e.stopPropagation()}>
                    <EditField id={c.companyId} field="billing_remarks" value={c.billingRemarks} onSave={handleArSave} multiline />
                  </div>
                  <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                    <button title="Email Drafts" onClick={e => {
                        e.stopPropagation();
                        setDraftError(null); setNeedsManualEmail(false); setManualToEmail(''); setManualCcEmail(''); setPreviewRow(null);
                        const opening = draftPopoverFor !== c.companyId;
                        setDraftPopoverFor(opening ? c.companyId : null);
                        if (opening) void resolveDraftPreview(c);
                      }}
                      style={{ border: 'none', background: 'transparent', padding: 4, cursor: 'pointer', display: 'flex', color: draftPopoverFor === c.companyId ? '#1d3a5c' : '#94a3b8' }}>
                      <Mail size={15} />
                    </button>
                    {draftPopoverFor === c.companyId && (
                      <div ref={draftPopoverRef} onClick={e => e.stopPropagation()} style={{
                        position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 30, background: '#fff',
                        border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 260, padding: 12,
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#1e3a5f', marginBottom: 8 }}>Email Drafts — {c.companyName}</div>
                        <>
                            <select value={senderId ?? ''} onChange={e => setSenderId(Number(e.target.value))}
                              style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}>
                              {senders.length === 0 && <option value="">No senders found</option>}
                              {senders.map(s => <option key={s.id} value={s.id}>{s.display_name ?? s.email}</option>)}
                            </select>
                            <select value={selectedTemplateId ?? ''} onChange={e => setSelectedTemplateId(Number(e.target.value))}
                              style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}>
                              {emailTemplates.length === 0 && <option value="">No AR templates found</option>}
                              {emailTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                            </select>
                            {previewLoading && <div style={{ fontSize: 10.5, color: '#94a3b8', marginBottom: 8 }}>Checking recipient…</div>}
                            {draftError && <div style={{ fontSize: 10.5, color: '#b91c1c', marginBottom: 8 }}>{draftError}</div>}
                            {needsManualEmail && (
                              <>
                                <label style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.4px' }}>To</label>
                                <input type="email" value={manualToEmail} onChange={e => setManualToEmail(e.target.value)}
                                  placeholder="recipient@email.com" autoFocus
                                  style={{ width: '100%', border: `1px solid ${manualToEmail && !isValidEmail(manualToEmail) ? '#fecaca' : '#e2e8f0'}`, borderRadius: 6, padding: '6px 8px', fontSize: 12, marginTop: 3, marginBottom: 8, boxSizing: 'border-box' }} />
                                <label style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.4px' }}>Cc <span style={{ fontWeight: 500, textTransform: 'none' }}>(optional)</span></label>
                                {/* The resolved default Cc list is newline-joined (recipientLines
                                    in lib/campaign-recipients.ts) — a single-line <input> collapsed
                                    those onto one unreadable line (Vincent, 2026-08-19). */}
                                <textarea value={manualCcEmail} onChange={e => setManualCcEmail(e.target.value)}
                                  placeholder="cc@email.com" rows={2}
                                  style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', fontSize: 12, marginTop: 3, marginBottom: 8, boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' }} />
                              </>
                            )}
                            <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 8 }}>
                              {helperAvailable ? 'Opens a review screen with the invoice attached — you send it from there.' : 'Draft Helper not detected — opens a blank Outlook draft (no attachment) instead.'}
                            </div>
                            {helperAvailable && helperOutdated && (
                              <div style={{ fontSize: 10, color: 'var(--status-warning)', marginBottom: 8 }}>
                                A newer Draft Helper is available.{' '}
                                <a href="/downloads/TassureDraftHelper.exe" download style={{ color: 'var(--status-warning)', fontWeight: 800 }}>Update it</a>.
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button onClick={() => setDraftPopoverFor(null)} style={{ fontSize: 11, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '5px 8px' }}>Cancel</button>
                              <button onClick={() => quickEmailDraft(c, needsManualEmail ? { to: manualToEmail, cc: manualCcEmail } : undefined)}
                                disabled={drafting || previewLoading || !selectedTemplateId || (needsManualEmail && !isValidEmail(manualToEmail))}
                                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#fff', background: '#397f78', border: 'none', borderRadius: 6, cursor: drafting ? 'wait' : 'pointer', padding: '6px 12px', opacity: (previewLoading || !selectedTemplateId || (needsManualEmail && !isValidEmail(manualToEmail))) ? 0.6 : 1 }}>
                                {drafting ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={12} />}
                                {drafting ? 'Drafting…' : 'Draft'}
                              </button>
                            </div>
                          </>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>

      <PaginationBar page={page} totalPages={totalPages} total={total} startIndex={startIndex} pageCount={pageItems.length} onPage={setPage} />

      {sendModalDraft && (
        <OutlookStyleSendModal
          draft={sendModalDraft}
          sender={selectedSender}
          me={me}
          onClose={() => setSendModalDraft(null)}
          onSent={() => loadDraftStatus()}
        />
      )}

      {/* Draft builder modal */}
      {expanded !== null && (() => {
        // Rows come from the AR-Reminder-driven list (companyId = ar.id), so the
        // modal must resolve against that same list — not the raw renewals data.
        const c = monthCompanies.find(x => x.companyId === expanded);
        if (!c) return null;
        const accent = c.urgency === 'expired' ? 'var(--status-danger)' : c.urgency === 'expiring_soon' ? '#f59e0b' : 'var(--status-success)';
        return (
          <div onClick={() => setExpanded(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 100, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 20px', overflowY: 'auto' }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 1040, boxShadow: '0 20px 60px rgba(0,0,0,0.3)', overflow: 'hidden' }}>
              <div style={{ background: 'linear-gradient(135deg,#1d3a5c,#1e4976)', borderLeft: `4px solid ${accent}`, padding: '16px 20px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#fff', lineHeight: 1.3 }}>{c.companyName}</div>
                  <button onClick={() => setExpanded(null)} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 16 }}><X size={18} /></button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {c.uen && <span style={{ fontSize: 11, color: '#fff', background: 'rgba(255,255,255,0.08)', padding: '2px 6px', borderRadius: 4 }}>{c.uen}</span>}
                  <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                  <span style={{ fontSize: 11, color: '#fff' }}>FYE {c.fyeMonth ?? '—'}</span>
                  <span style={{ width: 1, height: 12, background: 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                  <span style={{ fontSize: 11, color: '#fff' }}>Build &amp; generate invoice</span>
                </div>
              </div>
              <ExpandedBillingRow c={c} cycleFye={currentFye || undefined} />
            </div>
          </div>
        );
      })()}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
  const accent    = filed ? 'var(--status-success)' : r.stagesDone > 0 ? '#f59e0b' : '#94a3b8';
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
              Light blue = on via locked/auto · green = manually on ·
              grey = off (auto or manual). */}
          <div style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: '14px 16px 16px', boxShadow: '0 3px 12px rgba(15,23,42,0.12)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, marginBottom: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <ShieldCheck size={14} style={{ color: 'var(--accent-blue)' }} />
                  <span style={{ fontSize: 11.5, fontWeight: 800, color: '#1e3a5f' }}>Service configuration</span>
                  <span style={{ padding: '2px 6px', borderRadius: 999, background: 'var(--status-warning-tint)', color: 'var(--status-warning)', fontSize: 7.5, fontWeight: 800, letterSpacing: '0.35px' }}>REVIEW BEFORE BILLING</span>
                </div>
                <div style={{ fontSize: 9.5, color: '#64748b', marginTop: 5, lineHeight: 1.5 }}>Click an adjustable service to override the system result. Click again to restore automatic detection.</div>
              </div>
              <div style={{ display: 'flex', gap: 13, flexShrink: 0, fontSize: 8, fontWeight: 700, alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#475569' }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: SVC_SQUARE_COLOR.auto, flexShrink: 0 }} />Locked / Auto
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#475569' }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: SVC_SQUARE_COLOR.manual, flexShrink: 0 }} />Manual On
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#475569' }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: SVC_SQUARE_COLOR.off, border: '1px solid #cbd5e1', flexShrink: 0 }} />Off
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px,0.7fr) minmax(500px,2fr)', gap: 20, alignItems: 'center' }}>
              <div style={{ padding: '4px 0' }}>
                <div style={{ fontSize: 7.5, fontWeight: 800, color: '#94a3b8', letterSpacing: '0.5px', marginBottom: 9 }}>SYSTEM MANAGED</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {activeSvc.filter(k => !(OVERRIDABLE_SVC as readonly string[]).includes(k)).map(k => {
                    const svc = SVC[k];
                    return (
                      <span key={k} title={`${svc.label}: locked${['nd','address'].includes(k) ? ' (follows TeamWork)' : ''}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <ServiceSquare on color={SVC_SQUARE_COLOR.auto} />
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#475569' }}>{svc.label}</span>
                      </span>
                    );
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
            <div style={{ margin: '16px 24px 20px', border: '1px solid #dbe3ee', borderRadius: 10, background: '#fff', overflow: 'hidden' }}>
              <div style={{ padding: '10px 13px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#1e3a5f' }}>Change history</div>
                  <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>Every saved change records who changed it. Restore is protected against newer edits.</div>
                </div>
                <button onClick={() => void loadHistory()} disabled={historyLoading} style={{ border: '1px solid #cbd5e1', background: '#fff', color: '#475569', borderRadius: 6, padding: '4px 7px', cursor: 'pointer', display: 'flex' }}><RefreshCw size={11} /></button>
              </div>
              {historyError && <div style={{ padding: '8px 13px', background: 'var(--status-danger-tint)', color: '#b91c1c', fontSize: 10 }}>{historyError}</div>}
              {historyLoading && historyRows.length === 0 ? (
                <div style={{ padding: '18px 18px 28px', textAlign: 'center', color: '#94a3b8', fontSize: 10 }}>Loading history…</div>
              ) : historyRows.length === 0 ? (
                <div style={{ padding: '18px 18px 28px', textAlign: 'center', color: '#94a3b8', fontSize: 10 }}>No saved changes yet.</div>
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
                        style={{ border: '1px solid #bfdbfe', background: 'var(--status-info-tint)', color: 'var(--accent-blue)', borderRadius: 6, padding: '4px 6px', fontSize: 9, fontWeight: 700, cursor: restoringId !== null ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
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
type ARColumnKey = 'reminder_note' | 'prepared_date' | 'date_of_agm' | 'sent_date' | 'received_date'
  | 'filling_date' | 'xbrl' | 'software_update' | 'dpo' | 'ond_ron' | 'pic' | 'acc_pic' | 'tax_pic'
  | 'remarks' | 'ar_status' | 'accounts_status';
const AR_DATE_COLUMNS = new Set<ARColumnKey>(['reminder_note', 'prepared_date', 'date_of_agm', 'sent_date', 'received_date', 'filling_date', 'software_update', 'accounts_status']);

const AR_PIC_COLUMNS = new Set<ARColumnKey>(['pic', 'acc_pic', 'tax_pic']);

function arColumnValue(r: ARRecord, field: ARColumnKey): string {
  const raw = (r as unknown as Record<string, string | null>)[field] ?? '';
  if (AR_PIC_COLUMNS.has(field)) return formatStaffName(raw);
  return AR_DATE_COLUMNS.has(field) ? (toDisplayDate(raw) ?? raw) : raw;
}

// Excel-style per-column filter, mirroring components/MasterListTable.tsx's
// ColumnFilterMenu — options are computed from the full loaded month/year
// record set (non-cascading), not re-narrowed by other active filters.
function ARColumnFilterMenu({ field, label, records, selected, onApply }: {
  field: ARColumnKey; label: string; records: ARRecord[];
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
    for (const r of records) {
      const raw = arColumnValue(r, field).trim();
      const key = raw === '' ? '(Blank)' : raw;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [records, field]);

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
        style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', display: 'flex', color: active ? 'var(--status-warning)' : 'rgba(30,41,59,0.4)' }}>
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
                <span style={{ color: '#94a3b8', flexShrink: 0 }}>{valueCount}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 6 }}>
            <button onClick={() => setOpen(false)} style={{ fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: '3px 6px' }}>Cancel</button>
            <button onClick={() => { onApply(draft); setOpen(false); }} style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: '#1d3a5c', border: 'none', borderRadius: 5, cursor: 'pointer', padding: '3px 8px' }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Vincent, 2026-08-20: AR Reminder's own month picker — replaces a plain
// single <select> so staff can pick several FYE months at once for
// year-end consolidation. Same trigger-button + click-outside-close
// popover pattern as ARColumnFilterMenu above, checkboxes over a fixed
// month list instead of dynamic value-counts (no staged draft needed for
// a list this small — each click applies immediately).
function MonthMultiSelect({ months, allMonths, onChange, triggerStyle }: {
  months: string[]; allMonths: readonly string[];
  onChange: (next: string[]) => void; triggerStyle: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const toggle = (m: string) => {
    const has = months.includes(m);
    if (has && months.length === 1) return; // keep at least one month selected always
    onChange(has ? months.filter(x => x !== m) : allMonths.filter(x => months.includes(x) || x === m));
  };

  const label = months.length === 1 ? months[0]
    : months.length === 2 ? months.join(', ')
    : `${months.length} months`;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={() => setOpen(v => !v)} style={{ ...triggerStyle, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
        {label}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 30, background: '#fff',
          border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 170, padding: 8,
        }}>
          <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
            <button onClick={() => onChange([...allMonths])} style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Select All</button>
            <button onClick={() => onChange([months[0]])} style={{ fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Reset</button>
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', padding: '4px 0' }}>
            {allMonths.map(m => (
              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px', fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={months.includes(m)} onChange={() => toggle(m)} style={{ width: 12, height: 12, cursor: 'pointer', flexShrink: 0 }} />
                <span>{m}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ARTableView({ records, allRecords, columnFilters, onApplyFilter, onSave, onDelete, onOpenDetail, startIndex = 0, backlogYearsFor }: {
  records: ARRecord[]; allRecords: ARRecord[];
  columnFilters: Partial<Record<ARColumnKey, Set<string>>>;
  onApplyFilter: (field: ARColumnKey, next: Set<string> | null) => void;
  onSave: (id: number, field: string, val: string) => void; onDelete: (id: number) => void;
  onOpenDetail: (r: ARRecord) => void; startIndex?: number;
  backlogYearsFor: (r: ARRecord) => number[];
}) {
  // A very light neutral grouping keeps finance columns legible without
  // introducing another competing accent colour into the list.
  const FIN_CELL = '#fbfcfe';

  const outerRef  = useRef<HTMLDivElement>(null);
  const thumbRef  = useRef<HTMLDivElement>(null);
  const sbRef     = useRef<HTMLDivElement>(null);
  const dragging  = useRef(false);
  const dragRef   = useRef({ startX: 0, startScroll: 0 });
  const metaRef   = useRef({ tw: 0, sbW: 0 });
  const [picOpen, setPicOpen] = useState({ sec: true, acc: false, tax: false });
  // Expanding/collapsing a PIC column changes the table's total scroll
  // width, which was snapping the view back to the leftmost columns —
  // same bug and fix as Master List's collapsible Status column
  // (components/MasterListTable.tsx). Save scrollLeft right before the
  // toggle and restore it once the new width has rendered.
  const scrollLeftBeforeToggle = useRef<number | null>(null);
  const togglePicOpen = (key: keyof typeof picOpen) => {
    scrollLeftBeforeToggle.current = outerRef.current?.scrollLeft ?? null;
    setPicOpen(current => ({ ...current, [key]: !current[key] }));
  };
  useLayoutEffect(() => {
    if (scrollLeftBeforeToggle.current !== null && outerRef.current) {
      outerRef.current.scrollLeft = scrollLeftBeforeToggle.current;
      scrollLeftBeforeToggle.current = null;
    }
  }, [picOpen]);

  const picHeader = (key: keyof typeof picOpen, label: string, field: ARColumnKey) => {
    const open = picOpen[key];
    return (
      <TH w={open ? 120 : 34} center>
        {open ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, width: '100%' }}>
            <button type="button" onClick={() => togglePicOpen(key)}
              title={`Collapse ${label} to the left`}
              style={{ padding: 0, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700 }}>
              <ChevronLeft size={11} /><span>{label}</span>
            </button>
            <ARColumnFilterMenu field={field} label={label} records={allRecords} selected={columnFilters[field] ?? null} onApply={next => onApplyFilter(field, next)} />
          </div>
        ) : (
          <button type="button" onClick={() => togglePicOpen(key)}
            title={`Expand ${label}`}
            style={{ width: '100%', padding: 0, border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1, fontSize: 11, fontWeight: 700 }}>
            <ChevronRight size={10} /><span>{label.replace(' PIC', '')}</span>
          </button>
        )}
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
      background: '#e4e9ef', color: '#1e293b',
      fontSize: 11, fontWeight: 700, letterSpacing: 'normal',
      padding: '7px 8px', whiteSpace: 'nowrap', minWidth: w, width: w,
      textAlign: center ? 'center' : 'left',
      borderRight: finance ? '1px solid rgba(15,23,42,0.14)' : '1px solid rgba(15,23,42,0.08)',
      boxShadow: lastSticky ? '3px 0 8px -2px rgba(0,0,0,0.1)' : undefined,
    }}>{children}</th>
  );

  const TD = ({ children, style, finance, stickyLeft, lastSticky, tint }: { children: React.ReactNode; style?: React.CSSProperties; finance?: boolean; stickyLeft?: number; lastSticky?: boolean; tint?: string }) => (
    <td style={{
      padding: '3px 6px', verticalAlign: 'top',
      borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9',
      background: tint ?? (finance ? FIN_CELL : stickyLeft !== undefined ? '#fff' : undefined),
      wordBreak: 'break-word', overflowWrap: 'break-word',
      position: stickyLeft !== undefined ? 'sticky' : undefined,
      left: stickyLeft !== undefined ? stickyLeft : undefined,
      zIndex: stickyLeft !== undefined ? 1 : undefined,
      boxShadow: lastSticky ? '3px 0 8px -2px rgba(0,0,0,0.12)' : undefined,
      ...style,
    }}>{children}</td>
  );

  // Column label + Excel-style filter icon, for the plain (non-PIC) headers.
  const HF = (field: ARColumnKey, label: string) => (
    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
      <span>{label}</span>
      <ARColumnFilterMenu field={field} label={label} records={allRecords} selected={columnFilters[field] ?? null} onApply={next => onApplyFilter(field, next)} />
    </span>
  );

  return (
    <>
    {/* minHeight keeps this from shrinking to just a few rows' worth of
        height when the filtered/searched result set is small — a column
        filter dropdown opened from the header needs room to render below it,
        and with too few rows the container's own content-driven height was
        clipping that dropdown via overflowY. Same fix already applied to
        Master List's table view (components/MasterListTable.tsx) — this is
        a separate, independent table implementation that never got it
        (Vincent: "之前你就处理过了...可能你只是处理了 MATER LIST那边 AR
        REMINDER 这边的TABLE没有处理好"). */}
    <div ref={outerRef} style={{ overflowX: 'hidden', overflowY: 'auto', maxHeight: 'calc(100vh - 300px)', minHeight: 400, background: '#fff', borderRadius: '0 0 12px 12px', border: '1px solid #e2e8f0', borderTop: 'none' }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed', width: 'max-content', fontSize: 11 }}>
        <thead>
          <tr>
            <TH w={30} center stickyLeft={0}>No.</TH>
            <TH w={200} stickyLeft={30}>Company Name</TH>
            <TH w={80} stickyLeft={230} lastSticky>UEN / ROC</TH>
            <TH w={100}>{HF('reminder_note', 'Reminder')}</TH>
            <TH w={110}>{HF('prepared_date', 'Report Ready')}</TH>
            <TH w={100}>{HF('date_of_agm', 'AGM')}</TH>
            <TH w={100}>{HF('sent_date', 'To Client')}</TH>
            <TH w={100}>{HF('received_date', 'Signed')}</TH>
            <TH w={100}>{HF('filling_date', 'AR')}</TH>
            <TH w={110}>{HF('xbrl', 'XBRL')}</TH>
            <TH w={100}>{HF('software_update', 'TW Update')}</TH>
            <TH w={100}>{HF('dpo', 'DPO')}</TH>
            <TH w={100}>{HF('ond_ron', 'ROND RONS')}</TH>
            {picHeader('sec', 'SEC PIC', 'pic')}
            {picHeader('acc', 'ACC PIC', 'acc_pic')}
            {picHeader('tax', 'TAX PIC', 'tax_pic')}
            <TH w={180}>{HF('remarks', 'Remarks')}</TH>
            <TH w={150} finance>{HF('ar_status', 'Invoice')}</TH>
            <TH w={150} finance>{HF('accounts_status', 'Email Sent')}</TH>
            <TH w={68} center>{''}</TH>
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
            const accent  = filed ? 'var(--status-success)' : overdue ? 'var(--status-danger)' : inProg ? '#f59e0b' : '#e2e8f0';
            // Whole-row tint from the Remarks selection (Vincent, 2026-08-13:
            // TERMINATED/STRIKE OFF -> grey row, AR COMPLETED -> green row, a
            // free-typed custom remark -> row unchanged). Passed to every TD
            // as `tint` rather than styling the <tr> itself, because
            // .system-list-row's own background is `!important` in
            // globals.css and would silently win over a <tr>-level override.
            const rowState = remarksRowState(r.remarks);
            const rowTint  = rowState === 'closed' ? '#eef1f5' : rowState === 'done' ? 'var(--status-success-tint)' : undefined;
            return (
              <tr key={r.id} className="system-list-row">
                <TD stickyLeft={0} tint={rowTint} style={{ textAlign: 'center', color: '#94a3b8', fontSize: 10, fontWeight: 600, borderLeft: `3px solid ${accent}` }}>{startIndex + i + 1}</TD>
                <TD stickyLeft={30} tint={rowTint}>
                  <div className="company-name-text">{r.entity_name}</div>
                  {(lateFilingReason(r.remarks) || r.isStaleOverdue || backlogYearsFor(r).length > 0) && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' }}>
                      <LateFilingBadge remarks={r.remarks} />
                      {r.isStaleOverdue && <StaleFyeBadge fyeYear={r.fye_year} />}
                      <BacklogNoticeBadge years={backlogYearsFor(r)} />
                    </div>
                  )}
                  {r.fye_date && <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 1 }}>FYE {fmtDate(r.fye_date)}</div>}
                </TD>
                <TD stickyLeft={230} lastSticky tint={rowTint}><span className="company-registration-text">{r.uen || '—'}</span></TD>
                <TD tint={rowTint}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <AutoFillDot show={!!r.reminder_note && !r.reminder_note_manual} />
                    <EditField id={r.id} field="reminder_note" value={r.reminder_note} onSave={onSave} placeholder="—" isDate />
                  </div>
                </TD>
                <TD tint={rowTint}><SelectField id={r.id} field="prepared_date" value={r.prepared_date} onSave={onSave} options={REPORT_READY_OPTIONS} plainDates /></TD>
                <TD tint={rowTint}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <AutoFillDot show={!!r.date_of_agm && !r.date_of_agm_manual} />
                    <EditField id={r.id} field="date_of_agm" value={r.date_of_agm} onSave={onSave} placeholder="—" isDate />
                  </div>
                </TD>
                <TD tint={rowTint}><EditField id={r.id} field="sent_date"       value={r.sent_date}       onSave={onSave} placeholder="—" isDate /></TD>
                <TD tint={rowTint}><EditField id={r.id} field="received_date"   value={r.received_date}   onSave={onSave} placeholder="—" isDate /></TD>
                <TD tint={rowTint}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <AutoFillDot show={!!r.filling_date && !r.filling_date_manual} />
                    <EditField id={r.id} field="filling_date" value={r.filling_date} onSave={onSave} placeholder="—" isDate />
                  </div>
                </TD>
                <TD tint={rowTint}><SelectField id={r.id} field="xbrl"          value={r.xbrl}            onSave={onSave} options={XBRL_OPTIONS} /></TD>
                <TD tint={rowTint}><EditField id={r.id} field="software_update" value={r.software_update} onSave={onSave} placeholder="—" isDate /></TD>
                <TD tint={rowTint}><SelectField id={r.id} field="dpo"           value={r.dpo}             onSave={onSave} options={DPO_OPTIONS} /></TD>
                <TD tint={rowTint}><SelectField id={r.id} field="ond_ron"       value={r.ond_ron}         onSave={onSave} options={ROND_OPTIONS} /></TD>
                <TD tint={rowTint} style={!picOpen.sec ? { padding: 0 } : undefined}>{picOpen.sec && <SelectField id={r.id} field="pic"     value={r.pic}     onSave={onSave} options={SEC_PIC_OPTIONS} customLabel="Custom…" dateHelper={false} formatDisplay={formatStaffName} plainDisplay />}</TD>
                <TD tint={rowTint} style={!picOpen.acc ? { padding: 0 } : undefined}>{picOpen.acc && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <AutoFillDot show={!!r.acc_pic && !r.acc_pic_manual} title="Carried forward from this company's last cycle — pick someone to override it, or clear it to leave blank." />
                    <SelectField id={r.id} field="acc_pic" value={r.acc_pic} onSave={onSave} options={ACC_PIC_OPTIONS} customLabel="Custom…" dateHelper={false} formatDisplay={formatStaffName} plainDisplay />
                  </div>
                )}</TD>
                <TD tint={rowTint} style={!picOpen.tax ? { padding: 0 } : undefined}>{picOpen.tax && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <AutoFillDot show={!!r.tax_pic && !r.tax_pic_manual} title="Carried forward from this company's last cycle — pick someone to override it, or clear it to leave blank." />
                    <SelectField id={r.id} field="tax_pic" value={r.tax_pic} onSave={onSave} options={TAX_PIC_OPTIONS} customLabel="Custom…" dateHelper={false} formatDisplay={formatStaffName} plainDisplay />
                  </div>
                )}</TD>
                <TD tint={rowTint}><SelectField id={r.id} field="remarks" value={r.remarks} onSave={onSave} options={REMARKS_OPTIONS} customLabel="Custom…" dateHelper={false} /></TD>
                <TD finance tint={rowTint}><ArInvoiceCell r={r} onSave={onSave} placeholder="—" /></TD>
                <TD finance tint={rowTint}><EditField id={r.id} field="accounts_status" value={r.accounts_status} onSave={onSave} placeholder="—" isDate looseDate /></TD>
                <TD tint={rowTint} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                  <button onClick={() => onOpenDetail(r)} title="Open full details & edit history"
                    style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer', display: 'inline-flex' }}>
                    <History size={11} />
                  </button>
                  <button onClick={() => onDelete(r.id)} title="Remove"
                    style={{ marginLeft: 4, padding: '3px 6px', borderRadius: 5, border: '1px solid #fca5a5', background: '#fff', color: 'var(--status-danger)', cursor: 'pointer', display: 'inline-flex' }}>
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

// Text field showing "D MMM YYYY" (e.g. 30 Sep 2021), with a calendar button
// that opens a hidden native date input purely to pick a value — the native
// input itself is never shown, so its locale-dependent yyyy/mm/dd rendering
// never appears. `value`/`onChange` are the canonical ISO (yyyy-mm-dd) form.
function AddManualDateField({ label, value, onChange }: { label: string; value: string; onChange: (iso: string) => void }) {
  const [text, setText] = useState(toDisplayDate(value) ?? '');
  const dateRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(toDisplayDate(value) ?? ''); }, [value]);
  const commit = () => {
    const trimmed = text.trim();
    if (!trimmed) { onChange(''); return; }
    const iso = toIsoDateValue(trimmed);
    if (iso) { onChange(iso); setText(toDisplayDate(iso) ?? ''); }
    else { setText(toDisplayDate(value) ?? ''); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '3px 8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
      <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 92, flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: '1 1 200px', minWidth: 0 }}>
        <input type="text" value={text} onChange={e => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); } if (e.key === 'Escape') { setText(toDisplayDate(value) ?? ''); } }}
          placeholder="e.g. 03 Apr 2026"
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: '3px 0', fontSize: 13, fontWeight: 500, color: '#1e293b', boxSizing: 'border-box' }} />
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button type="button" data-cal-btn="1" tabIndex={0}
            onMouseDown={e => { e.preventDefault(); dateRef.current?.showPicker?.(); }}
            style={{ border: '1px solid #c7d2fe', borderRadius: 4, background: '#eef2ff', color: '#4338ca', cursor: 'pointer', padding: '3px 6px', display: 'flex', alignItems: 'center' }}>
            <Calendar size={12} />
          </button>
          <input ref={dateRef} type="date" onChange={e => { onChange(e.target.value || ''); e.target.value = ''; }}
            style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0, top: 0, left: 0 }} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AR TAB
// ─────────────────────────────────────────────────────────────────────────────
function ARTab({ month, year, setMonth, setYear }: { month: string; year: string; setMonth: (v: string) => void; setYear: (v: string) => void }) {
  // Vincent, 2026-08-20: AR Reminder gets its own multi-month selection,
  // decoupled from the single month/year Billing Drafts shares with this
  // tab (CombinedPage's own state) — so picking several months here for a
  // year-end consolidation never touches Billing Drafts' single-cycle
  // invoice-generation flow. Vincent, 2026-08-20 (follow-up): keep
  // auto-syncing to whatever month Billing Drafts is currently on — the
  // shared `month` only resolves AFTER an async fetch on mount, so a
  // one-time seed missed it entirely and left this tab stuck empty. Sync
  // reactively until the user actually picks something themselves; a
  // manual choice (including a cross-cycle search jump) then sticks even
  // if Billing Drafts' own month later changes underneath it.
  const [months, setMonths] = useState<string[]>(() => (month ? [month] : []));
  const userChangedMonthsRef = useRef(false);
  useEffect(() => {
    if (userChangedMonthsRef.current || !month) return;
    setMonths([month]);
  }, [month]);
  const setMonthsManually = useCallback((next: string[]) => {
    userChangedMonthsRef.current = true;
    setMonths(next);
  }, []);
  const monthsLabel = months.length === 1 ? months[0].toUpperCase() : `${months.length} MONTHS`;
  const [records,     setRecords]     = useState<ARRecord[]>([]);
  // Companies genuinely overdue right now but filed under an earlier
  // fye_year (AR/AGM due dates are FYE + 9 months, so a due date can roll
  // into the next calendar year) — kept separate from `records` so only
  // the Overdue view merges them in; see app/api/ar-reminder/route.ts's
  // `staleOverdue` field.
  const [staleOverdueRecords, setStaleOverdueRecords] = useState<ARRecord[]>([]);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [exporting,   setExporting]   = useState(false);
  const [exportError, setExportError] = useState('');
  const [modalRecord, setModalRecord] = useState<ARRecord | null>(null);
  const [search,      setSearch]      = useState('');
  const [filter,      setFilter]      = useState('all');
  const [columnFilters, setColumnFilters] = useState<Partial<Record<ARColumnKey, Set<string>>>>({});
  const applyColumnFilter = useCallback((field: ARColumnKey, next: Set<string> | null) => setColumnFilters(prev => {
    if (next === null) { const { [field]: _drop, ...rest } = prev; return rest; }
    return { ...prev, [field]: next };
  }), []);
  const columnFilterKey = Object.entries(columnFilters).map(([f, s]) => `${f}=${[...s].sort().join(',')}`).sort().join('&');
  const [view,        setView]        = useState<'list' | 'table'>('list');

  const load = useCallback(async () => {
    if (!months.length || !year) return;
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`/api/ar-reminder?month=${months.join(',')}&year=${year}`);
      const json = await res.json();
      if (json.error) { setError(json.error); return; }
      setRecords(json.companies ?? []);
      setStaleOverdueRecords(json.staleOverdue ?? []);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Network error'); }
    finally { setLoading(false); }
  }, [months, year]);

  const exportAr = useCallback(async () => {
    if (!months.length || !year) return;
    setExporting(true); setExportError('');
    try {
      const response = await fetch(`/api/ar-reminder/export?month=${months.join(',')}&year=${year}`);
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const monthsForName = months.length <= 3 ? months.join('-') : `${months.length}months`;
      link.download = `AR-Reminder-${monthsForName}-${year}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  }, [months, year]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!months.length || !year) return;
    const supabase = getSupabaseBrowserClient();
    let reloadTimer: ReturnType<typeof setTimeout> | null = null;
    // No visible notice for this (Vincent: doesn't want a toast on every
    // sync event) — the sync itself still runs silently in the background,
    // this just stops announcing it.
    const scheduleReload = () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(() => void load(), 700);
    };

    const channel = supabase
      .channel(`ar-reminder-${year}-${months.join('-')}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ar_reminder', filter: `fye_year=eq.${year}` }, payload => {
        const next = payload.new as Partial<ARRecord> & { id?: number; fye_month?: string; fye_year?: number; status?: string };
        const previous = payload.old as Partial<ARRecord> & { id?: number };
        const id = next.id ?? previous.id;
        if (!id) return;
        if (payload.eventType !== 'DELETE' && (!next.fye_month || !months.includes(next.fye_month) || Number(next.fye_year) !== Number(year))) return;

        if (payload.eventType === 'DELETE' || next.status === 'Excluded') {
          setRecords(current => current.filter(record => record.id !== id));
          setModalRecord(current => current?.id === id ? null : current);
          return;
        }

        if (payload.eventType === 'UPDATE') {
          const realtimePatch = {
            ...next,
            ...(Object.prototype.hasOwnProperty.call(next, 'pic') ? { pic: resolveTeamworkPic(next.pic) } : {}),
          };
          const merge = (record: ARRecord) => {
            if (record.id !== id) return record;
            return recomputeArRecord({ ...record, ...realtimePatch } as ARRecord);
          };
          setRecords(current => current.map(merge));
          setModalRecord(current => current?.id === id ? merge(current) : current);
          return;
        }

        // New rows need normal service/QB enrichment, so coalesce bursts of
        // generator inserts into one normal reload.
        scheduleReload();
      })
      .subscribe();

    return () => {
      if (reloadTimer) clearTimeout(reloadTimer);
      void supabase.removeChannel(channel);
    };
  }, [load, months, year]);

  const handleSave = useCallback((id: number, field: string, value: string) => {
    // date_of_agm/filling_date/reminder_note/acc_pic/tax_pic flip their own
    // "manual" flag alongside the value — matches the PATCH handler's
    // server-side behaviour so the blue auto-fill dot updates immediately,
    // without waiting for a refetch.
    const extra = (field === 'date_of_agm' || field === 'filling_date' || field === 'reminder_note' || field === 'acc_pic' || field === 'tax_pic')
      ? { [`${field}_manual`]: !!value } : {};
    const updated = (r: ARRecord) => r.id === id ? recomputeArRecord({ ...r, [field]: value || null, ...extra }) : r;
    setRecords(prev => prev.map(updated));
    // A backlog row's id never exists in `records` — without this, editing
    // one (e.g. filling in filling_date to mark it caught up) would
    // silently no-op until the next full reload.
    setStaleOverdueRecords(prev => prev.map(updated));
    setModalRecord(prev => prev && prev.id === id ? recomputeArRecord({ ...prev, [field]: value || null, ...extra }) : prev);
  }, []);

  // Optimistic local sync after a service-override cycle in the modal.
  const handleServices = useCallback((id: number, services: Services, manual: Partial<Record<string, boolean>>) => {
    const updated = (r: ARRecord) => r.id === id ? { ...r, services, servicesManual: manual } : r;
    setRecords(prev => prev.map(updated));
    setStaleOverdueRecords(prev => prev.map(updated));
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
        body: JSON.stringify({ entity_name: newEntity.trim(), fye_month: months[0], fye_year: year, uen: newUen || null, pic: newPic || null, due_date: newDueDate || null }),
      });
      const json = await res.json();
      if (json.error) { alert(json.error); return; }
      setShowAddForm(false); setNewEntity(''); setNewUen(''); setNewPic(''); setNewDueDate('');
      load();
    } finally { setAdding(false); }
  };

  const filtered = useMemo(() => {
    // Backlog (prior-fye_year, still unfiled) companies only ever appear
    // in the Overdue view — every other filter stays scoped to this
    // cycle's own `records`, unchanged.
    const source = filter === 'overdue' ? [...records, ...staleOverdueRecords] : records;
    return source.filter(r => {
      if (search && !r.entity_name.toLowerCase().includes(search.toLowerCase()) && !(r.uen ?? '').toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === 'filed'       && !r.stages.arFiled) return false;
      if (filter === 'in_progress' && !(r.stagesDone > 0 && !r.stages.arFiled)) return false;
      if (filter === 'pending'     && r.stagesDone !== 0) return false;
      if (filter === 'overdue'     && !(!r.stages.arFiled && r.daysUntilDue !== null && r.daysUntilDue < 0)) return false;
      for (const [field, allowed] of Object.entries(columnFilters) as [ARColumnKey, Set<string>][]) {
        const raw = arColumnValue(r, field).trim();
        if (!allowed.has(raw === '' ? '(Blank)' : raw)) return false;
      }
      return true;
    });
  }, [records, staleOverdueRecords, search, filter, columnFilters]);

  // Vincent, 2026-08-20: a company can have BOTH a normal current-cycle row
  // and a still-open backlog row from an earlier fye_year (e.g. MITRADE
  // GROUP has a clean June 2026 row and a separate, still-unfiled June
  // 2021 row) — searching/browsing outside the Overdue filter only ever
  // shows the current row, with nothing hinting the backlog exists. This
  // looks up, per company, which prior years are still owed, so the
  // current row can carry its own small notice regardless of which filter
  // is active.
  const backlogYearsByCompany = useMemo(() => {
    const m = new Map<string, number[]>();
    for (const s of staleOverdueRecords) {
      const key = s.uen?.trim() ? `uen:${s.uen.trim().toUpperCase()}` : `name:${normName(s.entity_name)}`;
      const list = m.get(key) ?? [];
      list.push(s.fye_year);
      m.set(key, list);
    }
    return m;
  }, [staleOverdueRecords]);
  const backlogYearsFor = useCallback((r: ARRecord): number[] => {
    if (r.isStaleOverdue) return []; // never point a backlog row at itself/siblings
    const key = r.uen?.trim() ? `uen:${r.uen.trim().toUpperCase()}` : `name:${normName(r.entity_name)}`;
    return backlogYearsByCompany.get(key) ?? [];
  }, [backlogYearsByCompany]);

  // See useCrossCycleSearch's own comment (defined above BillingTab) — same
  // cross-cycle escalation, but searching ar_reminder itself (not the
  // TeamWork roster) so it can find rows that only exist here, such as
  // Late Filing's mirror of struck-off/orphaned companies (see
  // app/api/ar-reminder/search/route.ts).
  const arRecordsForSearch = useMemo(() => records.map(r => ({ companyName: r.entity_name, uen: r.uen })), [records]);
  const fetchArMatch = useCallback(async (term: string) => {
    const res = await fetch(`/api/ar-reminder/search?q=${encodeURIComponent(term)}`);
    const json = await res.json();
    const matches: { entity_name: string; fye_month: string | null; fye_year: number | null }[] = json.data ?? [];
    return matches[0] ? { companyName: matches[0].entity_name, fyeMonth: matches[0].fye_month, fyeYear: matches[0].fye_year } : null;
  }, []);
  // A cross-cycle match should land on that one specific cycle, not
  // silently widen whatever multi-month selection is already active.
  const collapseToMonth = useCallback((m: string) => setMonthsManually([m]), [setMonthsManually]);
  const crossMonthNotice = useCrossCycleSearch(arRecordsForSearch, months, year, collapseToMonth, setYear, search, useCallback(() => { setFilter('all'); setColumnFilters({}); }, []), fetchArMatch);

  const stats = useMemo(() => ({
    total:      records.length,
    filed:      records.filter(r => r.stages.arFiled).length,
    inProgress: records.filter(r => r.stagesDone > 0 && !r.stages.arFiled).length,
    pending:    records.filter(r => r.stagesDone === 0).length,
    // Includes backlog from prior fye_years still unfiled and past due —
    // see staleOverdueRecords above.
    overdue:    records.filter(r => !r.stages.arFiled && r.daysUntilDue !== null && r.daysUntilDue < 0).length + staleOverdueRecords.length,
  }), [records, staleOverdueRecords]);

  // Paginate AFTER search/filter — shared by both List and Table views.
  const { page, setPage, totalPages, pageItems, startIndex, total: pagedTotal } =
    usePagination(filtered, `${search}|${filter}|${months.join(',')}|${year}|${columnFilterKey}`, 40);
  const isMobile = useIsMobile();

  const S: React.CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 13, color: '#1e3a5f', background: '#fff', cursor: 'pointer', outline: 'none' };

  return (
    <div>
      {/* Controls */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: isMobile ? 'wrap' : undefined }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <button
            onClick={exportAr}
            disabled={exporting}
            title="Download this month's AR Reminder table as an Excel file"
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 750, color: '#fff', background: exporting ? '#769a95' : '#397f78', border: '1px solid rgba(21,94,89,.2)', borderRadius: 9, padding: '8px 12px', cursor: exporting ? 'wait' : 'pointer', boxShadow: '0 5px 14px rgba(57,127,120,.14)' }}
          >
            <FileSpreadsheet size={15} />
            {exporting ? 'Preparing Excel…' : 'Export Excel'}
            <Download size={13} />
          </button>
          {exportError && <span style={{ fontSize: 9.5, color: '#b91c1c' }}>{exportError}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: isMobile ? 'wrap' : undefined }}>
          <MonthMultiSelect months={months} allMonths={FYE_MONTHS} onChange={setMonthsManually} triggerStyle={S} />
          <select value={year} onChange={e => setYear(e.target.value)} style={S}>
            {YEAR_OPTIONS.map(y => <option key={y}>{y}</option>)}
          </select>
          <button onClick={load} disabled={loading} style={{ ...S, display: 'flex', alignItems: 'center', gap: 6, background: '#1d3a5c', color: '#fff', border: 'none', fontWeight: 600 }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button onClick={() => setShowAddForm(v => !v)} style={{ ...S, display: 'flex', alignItems: 'center', gap: 6, background: '#1d3a5c', color: '#fff', border: 'none', fontWeight: 600 }}>
            <Plus size={13} />Add Manual
          </button>
        </div>
      </div>

      {/* Add Manual — modal, same navy/grey/white chrome as Master List's */}
      {showAddForm && (
        <div onClick={() => setShowAddForm(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 640, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <div style={{ background: '#1d3a5c', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Add Manual Entry — FYE {months[0]} {year}</div>
              <button onClick={() => setShowAddForm(false)} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ padding: '16px 20px', background: '#f8fafc' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {([
                  { label: 'Company Name *', value: newEntity, set: setNewEntity, type: 'text', normalize: (v: string) => v.toUpperCase() },
                  { label: 'UEN / ROC',      value: newUen,    set: setNewUen,    type: 'text', normalize: (v: string) => v.toUpperCase() },
                  { label: 'PIC',            value: newPic,    set: setNewPic,    type: 'text' },
                ] as const).map(f => (
                  <div key={f.label} style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '3px 8px', background: '#fff', borderRadius: 5, border: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, minWidth: 92, flexShrink: 0 }}>{f.label}</span>
                    <input type={f.type} value={f.value} onChange={e => f.set('normalize' in f && f.normalize ? f.normalize(e.target.value) : e.target.value)} placeholder={f.type === 'text' ? '—' : undefined}
                      style={{ flex: '1 1 200px', minWidth: 0, border: 'none', outline: 'none', background: 'transparent', padding: '3px 0', fontSize: 13, fontWeight: 500, color: '#1e293b', boxSizing: 'border-box' }} />
                  </div>
                ))}
                <AddManualDateField label="Due Date" value={newDueDate} onChange={setNewDueDate} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={saveNewEntity} disabled={adding || !newEntity.trim()}
                  style={{ padding: '7px 16px', borderRadius: 9, border: '1px solid rgba(21,94,89,.2)', background: '#397f78', color: '#fff', fontWeight: 750, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 5px 14px rgba(57,127,120,.14)', opacity: adding || !newEntity.trim() ? 0.6 : 1 }}>
                  <Check size={14} />{adding ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setShowAddForm(false)}
                  style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <X size={14} />Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stats — click a card to filter */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
        {([
          { key: 'all',         label: 'Total Companies', sub: 'in this FYE cycle',       value: stats.total,      color: '#1d3a5c', Icon: FileText },
          { key: 'filed',       label: 'AR Filed',        sub: 'annual return filed',     value: stats.filed,      color: 'var(--status-success)', Icon: CheckCircle2 },
          { key: 'in_progress', label: 'In Progress',     sub: 'some steps done',         value: stats.inProgress, color: 'var(--status-warning)', Icon: Clock },
          { key: 'pending',     label: 'Not Started',     sub: 'no steps yet',            value: stats.pending,    color: '#64748b', Icon: Calendar },
          { key: 'overdue',     label: 'Overdue',         sub: 'past due, not filed',     value: stats.overdue,    color: 'var(--status-danger)', Icon: AlertTriangle },
        ] as const).map(({ key, label, sub, value, color, Icon }) => {
          const active = filter === key;
          return (
            <MetricCard
              key={key}
              onClick={() => setFilter(key)}
              active={active}
              value={value}
              label={label}
              sub={sub}
              icon={<Icon size={16} />}
              color={color}
              ariaLabel={`Filter AR records by ${label}`}
            />
          );
        })}
      </div>

      {error && <div style={{ background: 'var(--status-danger-tint)', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: 'var(--status-danger)', fontSize: 12, marginBottom: 12 }}>{error}</div>}

      {/* Search + view toggle */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>
       <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="text" placeholder="Search company name or UEN / ROC… (any FYE month)" value={search} onChange={e => setSearch(e.target.value)} style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 10px', fontSize: 13, outline: 'none' }} />
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
       {crossMonthNotice && <div style={{ fontSize: 11, color: '#2563eb', marginTop: 6 }}>{crossMonthNotice}</div>}
      </div>

      {/* List view */}
      {(view === 'list' || isMobile) && (
        <div className="system-list-shell">
          <div className="system-list-title-bar" style={{ padding: '8px 16px' }}>
            <Calendar size={13} style={{ color: '#fff' }} />
            <span className="system-list-title">FYE {monthsLabel} {year}</span>
            <span className="system-list-title-hint" style={{ marginLeft: 8 }}>Click a company to open full details and edit</span>
          </div>
          {!isMobile && <div className="list-column-header-gray" style={{ display: 'grid', gridTemplateColumns: '32px minmax(310px,1.45fr) 120px minmax(300px,1fr) 110px 120px', columnGap: 12, padding: '10px 16px' }}>
            {['', 'Company Name', 'UEN / ROC', 'Services', 'Due Date', 'PIC'].map((h, i) => (
              <div key={i} style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', padding: '0 6px', display: 'flex', alignItems: 'center', gap: 4 }}>
                {h}
                {h === 'Due Date' && (
                  <span title={'Filed = the Annual Return for this FYE cycle has already been filed with ACRA.\n"Xd left" = X days remain until the AR filing deadline.\n"Xd overdue" = the deadline has passed by X days and it is not yet filed.'}
                    style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 13, height: 13, borderRadius: '50%', background: '#cbd5e1', color: '#fff', fontSize: 9, fontWeight: 800, fontStyle: 'normal', textTransform: 'none', letterSpacing: 'normal', cursor: 'help' }}>?</span>
                )}
              </div>
            ))}
          </div>}
          <div style={{ maxHeight: 'calc(100vh - 420px)', overflowY: 'auto', background: '#fff' }}>
            {loading && records.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>Loading…</div>}
            {!loading && filtered.length === 0 && <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>{records.length > 0 ? 'No matching records' : `No records for FYE ${monthsLabel} ${year}`}</div>}
            {pageItems.map((r, i) => {
              const filed     = r.stages.arFiled;
              const activeSvc = Object.entries(r.services).filter(([, v]) => v).map(([k]) => k);
              // Phone: view-only card (workflow editing is a desktop task)
              if (isMobile) return (
                <div key={r.id} className="system-list-row" style={{ padding: '11px 12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <span style={{ fontSize: 10, color: '#cbd5e1', fontWeight: 600, paddingTop: 2 }}>{startIndex + i + 1}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="company-name-text">{r.entity_name}</div>
                      {(lateFilingReason(r.remarks) || r.isStaleOverdue || backlogYearsFor(r).length > 0) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 2 }}>
                          <LateFilingBadge remarks={r.remarks} />
                          {r.isStaleOverdue && <StaleFyeBadge fyeYear={r.fye_year} />}
                          <BacklogNoticeBadge years={backlogYearsFor(r)} />
                        </div>
                      )}
                      <div className="company-registration-text" style={{ marginTop: 1 }}>{r.uen || '—'}{r.fye_date ? ` · FYE ${fmtDate(r.fye_date)}` : ''}</div>
                    </div>
                    <DueBadge days={r.daysUntilDue} filed={r.stages.arFiled} />
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 7, alignItems: 'center' }}>
                    {activeSvc.map(k => (
                      <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#475569' }}>
                        <ServiceSquare on color={svcStateOf(r.services, r.servicesManual, k) === 'manual-on' ? SVC_SQUARE_COLOR.manual : SVC_SQUARE_COLOR.auto} />
                        {SVC[k].label}
                      </span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: 10, marginTop: 7, fontSize: 10.5, color: '#64748b' }}>
                    <span>Progress: <span style={{ fontWeight: 700, color: filed ? 'var(--status-success)' : r.stagesDone > 0 ? 'var(--status-warning)' : '#94a3b8' }}>{r.stagesDone}/5{filed ? ' · Filed' : ''}</span></span>
                    {r.pic && <span>PIC: {formatStaffName(r.pic)}</span>}
                  </div>
                </div>
              );
              return (
                <div key={r.id} className="system-list-row"
                  onClick={() => setModalRecord(r)}
                  style={{ display: 'grid', gridTemplateColumns: '32px minmax(310px,1.45fr) 120px minmax(300px,1fr) 110px 120px', columnGap: 12, alignItems: 'center', minHeight: 66, padding: '11px 16px', background: '#fff', cursor: 'pointer', transition: 'background 0.15s' }}
                >
                  <div style={{ color: '#94a3b8', display: 'flex', alignItems: 'center' }}><ChevronRight size={14} /></div>
                  <div style={{ padding: '0 6px' }}>
                    <div className="company-name-text"><span style={{ color: '#cbd5e1', marginRight: 5, fontSize: 11 }}>{startIndex + i + 1}</span>{r.entity_name}</div>
                    {(lateFilingReason(r.remarks) || r.isStaleOverdue || backlogYearsFor(r).length > 0) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, flexWrap: 'wrap' }}>
                        <LateFilingBadge remarks={r.remarks} />
                        {r.isStaleOverdue && <StaleFyeBadge fyeYear={r.fye_year} />}
                        <BacklogNoticeBadge years={backlogYearsFor(r)} />
                      </div>
                    )}
                    {r.fye_date && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 1 }}>FYE {fmtDate(r.fye_date)}</div>}
                  </div>
                  <div className="company-registration-text" style={{ padding: '0 6px' }}>{r.uen || <span style={{ color: '#e2e8f0' }}>—</span>}</div>
                  {/* Fixed slots in fixed order — every service always in the
                      same position, so rows align and differences pop out.
                      Color follows the same Locked/Auto (blue) vs Manual On
                      (green) distinction as the modal's legend — previously
                      hardcoded to manual/green regardless of actual state. */}
                  <div style={{ margin: '0 6px', padding: '2px 0', minHeight: 32, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                    {SVC_ORDER.filter(k => r.services[k]).map(k => {
                      const state = svcStateOf(r.services, r.servicesManual, k);
                      return (
                        <span key={k} title={`${SVC[k].label} — ${state === 'auto-on' ? 'auto' : state === 'manual-on' ? 'manually on' : 'not provided / off'}`}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>
                          <ServiceSquare on color={state === 'manual-on' ? SVC_SQUARE_COLOR.manual : SVC_SQUARE_COLOR.auto} />
                          {SVC_SHORT[k]}
                        </span>
                      );
                    })}
                    {SVC_ORDER.every(k => !r.services[k]) && <span style={{ fontSize: 11, color: '#94a3b8' }}>No active services</span>}
                  </div>
                  <div style={{ padding: '0 6px' }}><DueBadge days={r.daysUntilDue} filed={r.stages.arFiled} /></div>
                  <div style={{ padding: '0 6px', fontSize: 12, color: '#475569' }}>{r.pic ? formatStaffName(r.pic) : <span style={{ color: '#e2e8f0' }}>—</span>}</div>
                </div>
              );
            })}
          </div>
          <div style={{ borderTop: '1px solid #edf1f5', padding: '8px 16px', background: '#f8fafc' }}>
            <span style={{ fontSize: 11, color: '#718096' }}>Click any row to open details. Filing status remains visible in the due-date and progress fields.</span>
          </div>
        </div>
      )}

      {/* Table view — desktop only */}
      {view === 'table' && !isMobile && (
        <>
          <div className="system-list-title-bar" style={{ borderRadius: '10px 10px 0 0', padding: '8px 16px' }}>
            <Calendar size={13} style={{ color: '#fff' }} />
            <span className="system-list-title">FYE {monthsLabel} {year}</span>
            <span className="system-list-title-hint" style={{ marginLeft: 8 }}>Click any cell to edit · Data syncs with List view in real time</span>
          </div>
          {loading && records.length === 0
            ? <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>Loading…</div>
            : <ARTableView records={pageItems} allRecords={records} columnFilters={columnFilters} onApplyFilter={applyColumnFilter} onSave={handleSave} onDelete={handleDelete} onOpenDetail={setModalRecord} startIndex={startIndex} backlogYearsFor={backlogYearsFor} />
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
        <div style={{
          display: 'inline-flex', marginTop: 16, borderRadius: 10, overflow: 'hidden',
          border: '1px solid #dbe3ec', boxShadow: '0 1px 3px rgba(15,35,60,.06)',
        }}>
          {([
            { key: 'billing', label: 'Billing Drafts',  desc: 'Renewals & annual obligations' },
            { key: 'ar',      label: 'AR Reminder',      desc: 'Annual Return filing tracker'  },
          ] as const).map(({ key, label, desc }, i) => {
            const active = tab === key;
            return (
              <button key={key} onClick={() => switchTab(key)} style={{
                padding: '10px 22px', border: 'none', cursor: 'pointer',
                background: active ? '#1d3a5c' : '#fff',
                borderLeft: i > 0 ? `1px solid ${active ? '#1d3a5c' : '#dbe3ec'}` : 'none',
                color: active ? '#fff' : '#1d3a5c',
                fontWeight: 700,
                fontSize: 13,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                transition: 'background .15s ease',
              }}>
                <span>{label}</span>
                <span style={{ fontSize: 10.5, color: active ? 'rgba(255,255,255,.7)' : '#7c8ba1', fontWeight: 500 }}>{desc}</span>
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
