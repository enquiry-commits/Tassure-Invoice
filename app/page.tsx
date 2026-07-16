'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Building2, UserCheck, MapPin, CalendarClock, AlertTriangle, RefreshCw,
  BarChart3, Users, ArrowRight, ShieldCheck, Layers3, Activity, Clock3,
  BriefcaseBusiness, Sparkles, FileSpreadsheet, Download, ChevronDown,
} from 'lucide-react';
import QBConnectButton from '@/components/QBConnectButton';
import { Donut, VBars, HBars } from '@/components/dashboard/Charts';

type Pt = { label: string; value: number; color?: string };
interface Data {
  kpis: { activeClients: number; cssClients: number; activeNDAppts: number; addressClients: number; upcomingAR: number; lateFiling: number };
  statusDonut: Pt[];
  fyeMonths: Pt[];
  serviceMix: Pt[];
  upcomingAR: Pt[];
  topNDs: Pt[];
}
interface AutomationHealth {
  ok: boolean;
  attentionCount: number;
  jobs: Array<{
    source: string;
    status: string;
    lastSuccessAt: string | null;
    successAgeHours: number | null;
    error: string | null;
  }>;
  anomalies: {
    numericPics: number;
    qbPeriodParseExceptions: number;
    invoiceRequestsNeedingReconciliation: number;
    openIntegrationExceptions: number;
  };
  exceptionGroups: AutomationExceptionGroup[];
}

interface AutomationExceptionInvoice {
  qb_company: string;
  qb_invoice_id: string;
  invoice_no: string;
  customer_name: string;
  txn_date: string;
  total_amt: number;
  balance: number;
  status: string;
}

interface AutomationExceptionItem {
  id: number;
  source: string;
  type: string;
  key: string;
  name: string | null;
  details: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  company: {
    internalId: string;
    name: string;
    uen: string | null;
    companyType: string | null;
    teamworkStatus: string | null;
    active: boolean | null;
    email: string | null;
  } | null;
  invoices: AutomationExceptionInvoice[];
}

interface AutomationExceptionGroup {
  source: string;
  type: string;
  count: number;
  items: AutomationExceptionItem[];
}

const DASHBOARD_COLORS = {
  ink: '#102a43',
  navy: '#234e70',
  teal: '#397f78',
  blue: '#557795',
  gold: '#b98243',
  plum: '#746487',
  rose: '#b45f6b',
  muted: '#a8b5c2',
};

function Card({ title, eyebrow, icon, children, action, style }: {
  title: string; eyebrow?: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <section style={{ background: 'rgba(255,255,255,.96)', borderRadius: 16, border: '1px solid #dfe7ec', boxShadow: '0 10px 32px rgba(28,52,73,.045)', padding: '20px 22px', ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: '#edf4f3', color: DASHBOARD_COLORS.teal, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>
        <div>
          {eyebrow && <div style={{ fontSize: 9.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 2 }}>{eyebrow}</div>}
          <h2 style={{ fontSize: 14, fontWeight: 750, color: DASHBOARD_COLORS.ink, margin: 0, letterSpacing: '-.01em' }}>{title}</h2>
        </div>
        <span style={{ marginLeft: 'auto' }}>{action}</span>
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, Icon, tint, href }: {
  label: string; value: number | string; sub: string; Icon: typeof Building2; tint: string; href: string;
}) {
  return (
    <Link href={href} className="dashboard-kpi" style={{ display: 'block', background: 'rgba(255,255,255,.96)', borderRadius: 14, border: '1px solid #dfe7ec', boxShadow: '0 6px 22px rgba(28,52,73,.035)', padding: '16px 17px', textDecoration: 'none' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ width: 32, height: 32, borderRadius: 9, background: `${tint}12`, color: tint, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={16} /></span>
        <ArrowRight size={13} style={{ color: '#cbd5e1' }} />
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: DASHBOARD_COLORS.ink, lineHeight: 1, letterSpacing: '-.035em' }}>{value}</div>
      <div style={{ fontSize: 11.5, color: '#475569', fontWeight: 700, marginTop: 7 }}>{label}</div>
      <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>{sub}</div>
    </Link>
  );
}

function ActionItem({ title, description, value, href, color, background, Icon }: {
  title: string; description: string; value: number | string; href: string; color: string; background: string; Icon: typeof AlertTriangle;
}) {
  return (
    <Link href={href} className="dashboard-action" style={{ display: 'grid', gridTemplateColumns: '38px 1fr auto', alignItems: 'center', gap: 12, padding: '13px 0', textDecoration: 'none', borderBottom: '1px solid #eef2f6' }}>
      <span style={{ width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', color, background }}><Icon size={17} /></span>
      <span>
        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 750, color: DASHBOARD_COLORS.ink }}>{title}</span>
        <span style={{ display: 'block', fontSize: 10.5, color: '#94a3b8', marginTop: 2 }}>{description}</span>
      </span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 19, color, letterSpacing: '-.02em' }}>{value}</strong>
        <ArrowRight size={13} style={{ color: '#cbd5e1' }} />
      </span>
    </Link>
  );
}

function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  return <Link href={href} style={{ fontSize: 11.5, color: DASHBOARD_COLORS.teal, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}>{children}<ArrowRight size={12} /></Link>;
}

function SectionLabel({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div style={{ margin: '30px 0 14px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
      <div>
        <div style={{ fontSize: 9.5, fontWeight: 800, color: DASHBOARD_COLORS.teal, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>{eyebrow}</div>
        <h2 style={{ margin: 0, color: DASHBOARD_COLORS.ink, fontSize: 18, fontWeight: 800, letterSpacing: '-.025em' }}>{title}</h2>
      </div>
      <p style={{ margin: 0, color: '#8493a3', fontSize: 11.5, maxWidth: 460, textAlign: 'right', lineHeight: 1.5 }}>{description}</p>
    </div>
  );
}

const AUTOMATION_LABELS: Record<string, string> = {
  teamwork_nd: 'TeamWork ND',
  teamwork_companies: 'TeamWork Companies',
  ar_generate: 'AR Generate',
  quickbooks: 'QuickBooks',
  ar_workflow: 'AR Workflow',
  late_filing: 'Late Filing',
};

const EXCEPTION_SOURCE_LABELS: Record<string, string> = {
  teamwork_companies: 'TeamWork Companies',
  teamwork_nd: 'TeamWork ND',
  quickbooks: 'QuickBooks',
  ar_generate: 'AR Generate',
  ar_workflow: 'AR Workflow',
  late_filing: 'Late Filing',
};

function exceptionTitle(group: AutomationExceptionGroup) {
  if (group.type === 'unknown_pic_id') return 'PIC identity needs mapping';
  const duplicate = group.type.match(/^duplicate_doc_number_(TAB|TAC)_(\d{4})$/);
  if (duplicate) return `Duplicate invoice numbers · ${duplicate[1]} ${duplicate[2]}`;
  if (group.type.startsWith('oauth_refresh_')) return 'QuickBooks OAuth connection';
  return group.type.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function formatSgtTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    minimumFractionDigits: 2,
  }).format(Number(value ?? 0));
}

function ExceptionStatus({ value }: { value: string | null | undefined }) {
  const normalized = String(value ?? 'Unknown');
  const paid = normalized.toLowerCase() === 'paid';
  const open = normalized.toLowerCase() === 'open';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '3px 7px', fontSize: 9, fontWeight: 800, color: paid ? '#047857' : open ? '#b45309' : '#64748b', background: paid ? '#ecfdf5' : open ? '#fff7ed' : '#f1f5f9', border: `1px solid ${paid ? '#a7f3d0' : open ? '#fed7aa' : '#e2e8f0'}` }}>
      {normalized}
    </span>
  );
}

function UnknownPicDetails({ items }: { items: AutomationExceptionItem[] }) {
  const byPicId = new Map<string, AutomationExceptionItem[]>();
  for (const item of items) {
    const picId = String(item.details.teamwork_pic_id ?? 'Unknown');
    byPicId.set(picId, [...(byPicId.get(picId) ?? []), item]);
  }
  const picGroups = [...byPicId.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]));

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ padding: '10px 12px', borderRadius: 9, background: '#fff8ed', border: '1px solid #f6dfbd', color: '#8a551a', fontSize: 10.5, lineHeight: 1.55 }}>
        TeamWork returned a numeric person-in-charge ID that has no verified staff-name mapping. The system intentionally keeps the visible PIC blank instead of displaying the number.
      </div>
      {picGroups.map(([picId, picItems]) => (
        <details key={picId} style={{ background: '#fff', border: '1px solid #e5eaf0', borderRadius: 10, overflow: 'hidden' }}>
          <summary style={{ cursor: 'pointer', listStyle: 'none', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 9, color: DASHBOARD_COLORS.ink, fontSize: 10.5, fontWeight: 800 }}>
            <ChevronDown size={13} style={{ color: '#94a3b8' }} />
            TeamWork PIC ID {picId}
            <span style={{ marginLeft: 'auto', color: '#a6530a', background: '#fff7ed', border: '1px solid #fed7aa', padding: '2px 7px', borderRadius: 999, fontSize: 9 }}>{picItems.length} companies</span>
          </summary>
          <div style={{ overflowX: 'auto', borderTop: '1px solid #edf1f5' }}>
            <table style={{ width: '100%', minWidth: 920, borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}>
                  {['#', 'Company', 'UEN', 'TeamWork Company ID', 'Status', 'Company Type', 'Email', 'Last detected'].map(label => <th key={label} style={{ padding: '8px 10px', fontWeight: 800, borderBottom: '1px solid #e8edf2' }}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {picItems.map((item, index) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #eef2f6', color: '#475569' }}>
                    <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{index + 1}</td>
                    <td style={{ padding: '8px 10px', color: DASHBOARD_COLORS.ink, fontWeight: 750 }}>{item.company?.name ?? item.name ?? '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{item.company?.uen ?? '—'}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{item.company?.internalId ?? item.key}</td>
                    <td style={{ padding: '8px 10px' }}><ExceptionStatus value={item.company?.teamworkStatus ?? (item.company?.active ? 'Active' : 'Inactive')} /></td>
                    <td style={{ padding: '8px 10px' }}>{item.company?.companyType ?? '—'}</td>
                    <td style={{ padding: '8px 10px' }}>{item.company?.email ?? '—'}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{formatSgtTime(item.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </div>
  );
}

function DuplicateInvoiceDetails({ items }: { items: AutomationExceptionItem[] }) {
  return (
    <div style={{ display: 'grid', gap: 9 }}>
      <div style={{ padding: '10px 12px', borderRadius: 9, background: '#f6f8fb', border: '1px solid #e1e7ee', color: '#536273', fontSize: 10.5, lineHeight: 1.55 }}>
        QuickBooks contains the same displayed invoice number on more than one immutable invoice record. Nothing is deleted automatically because each QB Invoice ID is a real accounting record.
      </div>
      {items.map(item => (
        <div key={item.id} style={{ background: '#fff', border: '1px solid #e1e7ee', borderRadius: 11, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: '#f8fafc', borderBottom: '1px solid #e8edf2' }}>
            <span style={{ fontSize: 10, color: '#64748b' }}>Invoice Number</span>
            <strong style={{ color: DASHBOARD_COLORS.ink, fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{item.name ?? item.key}</strong>
            <span style={{ marginLeft: 'auto', color: '#9a5a13', fontSize: 9.5, fontWeight: 750 }}>{item.invoices.length} QB records · detected {formatSgtTime(item.lastSeenAt)}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', minWidth: 850, borderCollapse: 'collapse', fontSize: 10 }}>
              <thead>
                <tr style={{ color: '#64748b', textAlign: 'left' }}>
                  {['QB Company', 'QB Invoice ID', 'Customer', 'Invoice Date', 'Status', 'Total', 'Balance'].map(label => <th key={label} style={{ padding: '8px 10px', borderBottom: '1px solid #edf1f5', fontWeight: 800 }}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {item.invoices.map(invoice => (
                  <tr key={`${invoice.qb_company}-${invoice.qb_invoice_id}`} style={{ borderBottom: '1px solid #f0f3f6', color: '#475569' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 800 }}>{invoice.qb_company}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{invoice.qb_invoice_id}</td>
                    <td style={{ padding: '8px 10px', color: invoice.customer_name.includes('DO NOT USE') ? '#b45309' : DASHBOARD_COLORS.ink, fontWeight: 700 }}>{invoice.customer_name}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{invoice.txn_date}</td>
                    <td style={{ padding: '8px 10px' }}><ExceptionStatus value={invoice.status} /></td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{formatMoney(invoice.total_amt)}</td>
                    <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{formatMoney(invoice.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function GenericExceptionDetails({ items }: { items: AutomationExceptionItem[] }) {
  return (
    <div style={{ overflowX: 'auto', background: '#fff', border: '1px solid #e5eaf0', borderRadius: 10 }}>
      <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 10 }}>
        <thead>
          <tr style={{ background: '#f8fafc', color: '#64748b', textAlign: 'left' }}>
            {['Entity', 'Key', 'Details', 'First detected', 'Last detected'].map(label => <th key={label} style={{ padding: '8px 10px', borderBottom: '1px solid #e8edf2', fontWeight: 800 }}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.id} style={{ borderBottom: '1px solid #eef2f6', color: '#475569' }}>
              <td style={{ padding: '8px 10px', color: DASHBOARD_COLORS.ink, fontWeight: 750 }}>{item.name ?? '—'}</td>
              <td style={{ padding: '8px 10px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{item.key}</td>
              <td style={{ padding: '8px 10px', maxWidth: 480, wordBreak: 'break-word' }}>{Object.entries(item.details).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : String(value)}`).join(' · ') || '—'}</td>
              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{formatSgtTime(item.firstSeenAt)}</td>
              <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>{formatSgtTime(item.lastSeenAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AutomationExceptionPanel({ health }: { health: AutomationHealth }) {
  const failedJobs = health.jobs.filter(job => job.status === 'attention');
  return (
    <div style={{ borderTop: '1px solid #f0dcc0', padding: '14px 2px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: DASHBOARD_COLORS.ink }}>Integration exception register</div>
          <div style={{ fontSize: 10, color: '#718096', marginTop: 3 }}>Every open case is listed below with its source record and the information needed for review.</div>
        </div>
        <span style={{ borderRadius: 999, padding: '5px 9px', background: '#fff4e5', border: '1px solid #f4d3a5', color: '#9a5a13', fontSize: 9.5, fontWeight: 800 }}>{health.anomalies.openIntegrationExceptions} open cases</span>
      </div>

      {failedJobs.length > 0 && (
        <div style={{ display: 'grid', gap: 7, marginBottom: 10 }}>
          {failedJobs.map(job => (
            <div key={job.source} style={{ padding: '9px 11px', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 9, color: '#9f1239', fontSize: 10 }}>
              <strong>{AUTOMATION_LABELS[job.source] ?? job.source}</strong> · {job.error ?? 'No successful run within the expected 30-hour window.'}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gap: 9, maxHeight: 620, overflowY: 'auto', paddingRight: 3 }}>
        {health.exceptionGroups.length === 0 ? (
          <div style={{ padding: 18, textAlign: 'center', color: '#64748b', background: '#fff', border: '1px solid #e5eaf0', borderRadius: 10, fontSize: 10.5 }}>No open integration exceptions.</div>
        ) : health.exceptionGroups.map(group => (
          <details key={`${group.source}-${group.type}`} style={{ background: '#fffdf9', border: '1px solid #eddcc5', borderRadius: 11, overflow: 'hidden' }}>
            <summary style={{ cursor: 'pointer', listStyle: 'none', padding: '11px 13px', display: 'flex', alignItems: 'center', gap: 9 }}>
              <ChevronDown size={14} style={{ color: '#a87335' }} />
              <span style={{ color: '#8b5e2d', fontSize: 9, fontWeight: 850, textTransform: 'uppercase', letterSpacing: '.6px' }}>{EXCEPTION_SOURCE_LABELS[group.source] ?? group.source}</span>
              <strong style={{ color: DASHBOARD_COLORS.ink, fontSize: 10.5 }}>{exceptionTitle(group)}</strong>
              <span style={{ marginLeft: 'auto', borderRadius: 999, padding: '3px 7px', background: '#fff4e5', border: '1px solid #f4d3a5', color: '#9a5a13', fontSize: 9, fontWeight: 800 }}>{group.count}</span>
            </summary>
            <div style={{ padding: '10px 11px 11px', borderTop: '1px solid #f2e5d4' }}>
              {group.type === 'unknown_pic_id'
                ? <UnknownPicDetails items={group.items} />
                : group.type.startsWith('duplicate_doc_number_')
                  ? <DuplicateInvoiceDetails items={group.items} />
                  : <GenericExceptionDetails items={group.items} />}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function AutomationHealthBar({ health }: { health: AutomationHealth }) {
  const [expanded, setExpanded] = useState(false);
  const attention = !health.ok;
  return (
    <section style={{ marginBottom: 18, border: `1px solid ${attention ? '#f2d6b0' : '#cde8df'}`, background: attention ? '#fffaf3' : '#f4fbf8', borderRadius: 13, padding: '0 14px', overflow: 'hidden' }}>
      <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} style={{ width: '100%', border: 0, background: 'transparent', padding: '12px 0', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', cursor: 'pointer', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 190 }}>
          <span style={{ width: 31, height: 31, borderRadius: 9, display: 'grid', placeItems: 'center', color: attention ? '#b45309' : '#0f766e', background: attention ? '#ffedd5' : '#dff5ec' }}>
            {attention ? <AlertTriangle size={15} /> : <ShieldCheck size={15} />}
          </span>
          <span>
            <strong style={{ display: 'block', fontSize: 11.5, color: DASHBOARD_COLORS.ink }}>Automation health</strong>
            <span style={{ display: 'block', fontSize: 9.5, color: '#718096', marginTop: 1 }}>{attention ? `${health.attentionCount} item(s) need attention` : 'All scheduled data flows are healthy'}</span>
          </span>
        </div>
        <div style={{ display: 'flex', gap: 7, flex: 1, flexWrap: 'wrap' }}>
          {health.jobs.map(job => {
            const ok = job.status !== 'attention';
            return (
              <span key={job.source} title={job.error ?? undefined} style={{ padding: '5px 8px', borderRadius: 999, border: `1px solid ${ok ? '#cde8df' : '#f2d6b0'}`, background: '#fff', color: ok ? '#176b5b' : '#a6530a', fontSize: 9.5, fontWeight: 750 }}>
                <span style={{ marginRight: 5 }}>{ok ? '●' : '!'}</span>{AUTOMATION_LABELS[job.source] ?? job.source}
                <span style={{ color: '#94a3b8', fontWeight: 600, marginLeft: 5 }}>{job.successAgeHours == null ? 'never' : `${job.successAgeHours}h`}</span>
              </span>
            );
          })}
        </div>
        {(health.anomalies.numericPics > 0 || health.anomalies.invoiceRequestsNeedingReconciliation > 0 || health.anomalies.openIntegrationExceptions > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 9.5, color: '#9a5a13', fontWeight: 750 }}>
            {health.anomalies.numericPics > 0 && `${health.anomalies.numericPics} numeric PIC`}
            {health.anomalies.invoiceRequestsNeedingReconciliation > 0 && `${health.anomalies.invoiceRequestsNeedingReconciliation} invoice reconciliation`}
            {health.anomalies.openIntegrationExceptions > 0 && `${health.anomalies.openIntegrationExceptions} integration exceptions`}
            <ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform .16s ease' }} />
          </div>
        )}
      </button>
      {expanded && <AutomationExceptionPanel health={health} />}
    </section>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState('');
  const [automationHealth, setAutomationHealth] = useState<AutomationHealth | null>(null);

  const load = () => {
    setLoading(true);
    fetch('/api/dashboard').then(r => r.json()).then(setData).finally(() => setLoading(false));
    fetch('/api/automation/health').then(r => r.ok ? r.json() : null).then(setAutomationHealth).catch(() => setAutomationHealth(null));
  };
  useEffect(() => {
    fetch('/api/dashboard').then(r => r.json()).then(setData).finally(() => setLoading(false));
    fetch('/api/automation/health').then(r => r.ok ? r.json() : null).then(setAutomationHealth).catch(() => setAutomationHealth(null));
  }, []);

  const exportCompanyData = async () => {
    setExporting(true);
    setExportError('');
    try {
      const response = await fetch('/api/export/company-data');
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'Tassure-Company-Data.xlsx';
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError('Export failed. Please try again.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ maxWidth: 1760, margin: '0 auto' }}>
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
            <Activity size={12} style={{ color: DASHBOARD_COLORS.teal }} />
            <span style={{ fontSize: 10, fontWeight: 800, color: DASHBOARD_COLORS.teal, textTransform: 'uppercase', letterSpacing: '.9px' }}>Live operations</span>
          </div>
          <h1 style={{ fontSize: 23, fontWeight: 800, color: DASHBOARD_COLORS.ink, margin: 0, letterSpacing: '-.03em' }}>Portfolio Overview</h1>
          <p style={{ fontSize: 12.5, color: '#64748b', margin: '4px 0 0' }}>Corporate-services performance, obligations and operational priorities.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <button
              onClick={exportCompanyData}
              disabled={exporting}
              title="Download the latest Active Clients and AR Reminder data in one Excel workbook"
              style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 750, color: '#fff', background: exporting ? '#769a95' : DASHBOARD_COLORS.teal, border: '1px solid rgba(21,94,89,.2)', borderRadius: 9, padding: '8px 12px', cursor: exporting ? 'wait' : 'pointer', boxShadow: '0 5px 14px rgba(57,127,120,.14)' }}
            >
              <FileSpreadsheet size={15} />
              {exporting ? 'Preparing Excel…' : 'Export Company Data'}
              <Download size={13} />
            </button>
            {exportError && <span style={{ fontSize: 9.5, color: '#b91c1c' }}>{exportError}</span>}
          </div>
          <button onClick={load} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 650, color: '#475569', background: '#fff', border: '1px solid #dfe6ee', borderRadius: 9, padding: '7px 11px', cursor: 'pointer' }}>
            <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} /> Refresh
          </button>
          <QBConnectButton />
        </div>
      </header>

      {automationHealth && <AutomationHealthBar health={automationHealth} />}

      {!data ? (
        <div style={{ textAlign: 'center', padding: 90, color: '#94a3b8', fontSize: 13 }}>Loading portfolio intelligence…</div>
      ) : (
        <>
          <div className="dashboard-command-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.55fr) minmax(330px,.65fr)', gap: 22, alignItems: 'stretch' }}>
            <section className="dashboard-hero" style={{ position: 'relative', overflow: 'hidden', minHeight: 290, borderRadius: 20, background: 'linear-gradient(118deg,#17344b 0%,#244f61 68%,#326f6b 100%)', padding: '30px 32px', color: '#fff', boxShadow: '0 18px 44px rgba(24,52,72,.17)', border: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'stretch' }}>
              <div style={{ position: 'absolute', width: 330, height: 330, borderRadius: '50%', right: -80, top: -180, border: '58px solid rgba(255,255,255,.04)' }} />
              <div style={{ position: 'absolute', width: 160, height: 160, borderRadius: '50%', right: 100, bottom: -125, border: '28px solid rgba(255,255,255,.035)' }} />
              <div className="dashboard-hero-grid" style={{ position: 'relative', width: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 10, fontWeight: 800, color: '#c8ded5', textTransform: 'uppercase', letterSpacing: '.9px', marginBottom: 12 }}><Sparkles size={12} /> Portfolio command centre</div>
                  <div style={{ fontSize: 27, fontWeight: 760, letterSpacing: '-.035em', lineHeight: 1.18, maxWidth: 600 }}>Your operational picture,<br />beautifully focused.</div>
                  <div style={{ fontSize: 12, color: '#c6d8e8', marginTop: 10, maxWidth: 570, lineHeight: 1.6 }}>Prioritise upcoming annual returns, resolve filing risks and understand service coverage before billing begins.</div>
                </div>
                <div className="dashboard-hero-metrics" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 18, marginTop: 28, paddingTop: 22, borderTop: '1px solid rgba(255,255,255,.15)' }}>
                  {[
                    { label: 'Active portfolio', value: data.kpis.activeClients, note: `${data.kpis.cssClients} CSS clients` },
                    { label: 'Next 6 months', value: data.kpis.upcomingAR, note: 'AR obligations' },
                    { label: 'Needs attention', value: data.kpis.lateFiling, note: 'late-filing flags' },
                  ].map(item => (
                    <div key={item.label}>
                      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.04em' }}>{item.value}</div>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#fff', marginTop: 3 }}>{item.label}</div>
                      <div style={{ fontSize: 9.5, color: '#a9c1d5', marginTop: 3 }}>{item.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <Card title="Action Centre" eyebrow="Priority queue" icon={<ShieldCheck size={16} />} action={<span style={{ fontSize: 10, color: '#94a3b8' }}>Live counts</span>} style={{ padding: '24px 24px' }}>
              <ActionItem title="Late-filing review" description="Investigate and resolve flagged entities" value={data.kpis.lateFiling} href="/late-filing" color={DASHBOARD_COLORS.rose} background="#fbf1f2" Icon={AlertTriangle} />
              <ActionItem title="AR preparation window" description="Review the next six months of filings" value={data.kpis.upcomingAR} href="/billing?tab=ar" color={DASHBOARD_COLORS.gold} background="#fbf5ec" Icon={Clock3} />
              <ActionItem title="Billing drafts" description="Review services before creating invoices" value="Open" href="/billing?tab=billing" color={DASHBOARD_COLORS.blue} background="#eef3f7" Icon={BriefcaseBusiness} />
            </Card>
          </div>

          <SectionLabel eyebrow="Portfolio pulse" title="Key operating metrics" description="Five live indicators covering clients, managed services and statutory obligations." />
          <div className="dashboard-kpis" style={{ display: 'grid', gridTemplateColumns: 'repeat(5,minmax(150px,1fr))', gap: 16 }}>
            <Kpi label="Active Clients" value={data.kpis.activeClients} sub={`${data.kpis.cssClients} CSS clients`} Icon={Building2} tint={DASHBOARD_COLORS.teal} href="/master-list/active-clients" />
            <Kpi label="Nominee Appointments" value={data.kpis.activeNDAppts} sub="active mandates" Icon={UserCheck} tint={DASHBOARD_COLORS.plum} href="/nominee-directors" />
            <Kpi label="Address Service" value={data.kpis.addressClients} sub="registered-address clients" Icon={MapPin} tint={DASHBOARD_COLORS.blue} href="/address-service" />
            <Kpi label="Upcoming AR" value={data.kpis.upcomingAR} sub="rolling six-month window" Icon={CalendarClock} tint={DASHBOARD_COLORS.gold} href="/billing?tab=ar" />
            <Kpi label="Late-Filing Watch" value={data.kpis.lateFiling} sub="companies currently flagged" Icon={AlertTriangle} tint={DASHBOARD_COLORS.rose} href="/late-filing" />
          </div>

          <SectionLabel eyebrow="Planning" title="Workload and portfolio health" description="See what is coming next and how the active entity portfolio is distributed." />
          <div className="dashboard-grid-primary" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.45fr) minmax(360px,.65fr)', gap: 22 }}>
            <Card title="Upcoming Annual Return Workload" eyebrow="Six-month outlook" icon={<CalendarClock size={16} />} action={<TextLink href="/billing?tab=ar">Open AR Reminder</TextLink>}>
              <VBars data={data.upcomingAR} color={DASHBOARD_COLORS.blue} height={190} />
            </Card>
            <Card title="Client Portfolio Status" eyebrow="Entity lifecycle" icon={<Layers3 size={16} />} action={<TextLink href="/companies">View companies</TextLink>}>
              <Donut segments={data.statusDonut.map((segment, index) => ({ ...segment, color: [DASHBOARD_COLORS.teal, DASHBOARD_COLORS.gold, DASHBOARD_COLORS.rose, DASHBOARD_COLORS.muted][index] }))} size={154} thickness={22} />
            </Card>
          </div>

          <SectionLabel eyebrow="Annual rhythm" title="Financial year-end landscape" description="The full portfolio calendar, with enough space to expose seasonal workload peaks." />
          <Card title="Financial Year-End Calendar" eyebrow="Annual distribution" icon={<BarChart3 size={16} />} action={<span style={{ fontSize: 10.5, color: '#94a3b8' }}>active clients by FYE month</span>} style={{ padding: '24px 28px' }}>
            <VBars data={data.fyeMonths} color={DASHBOARD_COLORS.teal} height={220} />
          </Card>

          <SectionLabel eyebrow="Coverage" title="Managed service portfolios" description="Compare service adoption with nominee-director appointment concentration." />
          <div className="dashboard-grid-secondary" style={{ display: 'grid', gridTemplateColumns: 'minmax(360px,.7fr) minmax(0,1.3fr)', gap: 22 }}>
            <Card title="Service Coverage" eyebrow="Active-client mix" icon={<BriefcaseBusiness size={16} />} action={<span style={{ fontSize: 10.5, color: '#94a3b8' }}>number of clients</span>}>
              <HBars data={data.serviceMix.map((service, index) => ({ ...service, color: [DASHBOARD_COLORS.teal, DASHBOARD_COLORS.plum, DASHBOARD_COLORS.blue, DASHBOARD_COLORS.gold, '#688b8a'][index] }))} accent={DASHBOARD_COLORS.teal} labelWidth={105} />
            </Card>
            <Card title="Nominee Director Portfolio" eyebrow="Active appointment load" icon={<Users size={16} />} action={<TextLink href="/nominee-directors">Open directory</TextLink>}>
              {data.topNDs.length > 0 ? <HBars data={data.topNDs} accent={DASHBOARD_COLORS.plum} labelWidth={170} /> : <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No active nominee appointments.</div>}
            </Card>
          </div>
        </>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .dashboard-kpi, .dashboard-action { transition: transform .16s ease, box-shadow .16s ease, background .16s ease; }
        .dashboard-kpi:hover { transform: translateY(-2px); box-shadow: 0 10px 28px rgba(16,37,66,.09) !important; }
        .dashboard-action:last-child { border-bottom: 0 !important; }
        .dashboard-action:hover { background: #fbfdff; }
        @media (max-width: 1180px) {
          .dashboard-kpis { grid-template-columns: repeat(3,minmax(160px,1fr)) !important; }
          .dashboard-command-grid { grid-template-columns: minmax(0,1.2fr) minmax(300px,.8fr) !important; }
        }
        @media (max-width: 980px) {
          .dashboard-command-grid, .dashboard-grid-primary, .dashboard-grid-secondary { grid-template-columns: 1fr !important; }
          .dashboard-kpis { grid-template-columns: repeat(2,minmax(150px,1fr)) !important; }
        }
        @media (max-width: 560px) {
          .dashboard-kpis, .dashboard-hero-metrics { grid-template-columns: 1fr !important; }
          .dashboard-hero { padding: 20px !important; }
        }
      `}</style>
    </div>
  );
}
