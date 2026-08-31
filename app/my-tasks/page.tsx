'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, CalendarClock, Clock, ListChecks, RefreshCw } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { fmtDate } from '@/lib/date';
import { formatStaffName } from '@/lib/staff-directory';

type SessionUser = { email: string; name: string; restrictedTo?: string | null; admin?: boolean };

type ArTask = {
  id: number; entityName: string; uen: string | null; fyeMonth: string; fyeYear: number;
  dueDate: string | null; daysUntilDue: number; pic: string | null; accPic: string | null; taxPic: string | null;
  matchedAs: string[]; remarks: string | null;
};
type LateFilingTask = {
  id: number; companyName: string; uen: string | null; nextAgmDueDate: string | null;
  remarks: string | null; pic: string | null; accPic: string | null; taxPic: string | null; matchedAs: string[];
};
type MyTasksResponse = {
  scope: 'full' | 'ar-only';
  scopeNote: string;
  arReminder: { overdue: ArTask[]; staleOverdue: ArTask[]; dueSoon: ArTask[] };
  lateFiling: { needsAttention: LateFilingTask[] } | null;
  counts: { arOverdue: number; arStaleOverdue: number; arDueSoon: number; lateFiling: number; total: number };
};

type Category = 'ALL' | 'overdue' | 'dueSoon' | 'lateFiling';

function MatchedAsBadges({ fields }: { fields: string[] }) {
  const labels: Record<string, string> = { pic: 'SEC', acc_pic: 'ACC', tax_pic: 'TAX' };
  return (
    <span style={{ display: 'inline-flex', gap: 3 }}>
      {fields.map(f => (
        <span key={f} style={{ fontSize: 9, fontWeight: 700, color: '#1e3a5f', background: '#eef2f7', border: '1px solid #dbe3ec', borderRadius: 999, padding: '1px 6px' }}>{labels[f] ?? f}</span>
      ))}
    </span>
  );
}

function ArTaskTable({ rows, title, tone }: { rows: ArTask[]; title: string; tone: 'danger' | 'warning' }) {
  if (!rows.length) return null;
  return (
    <div className="system-list-shell" style={{ marginBottom: 16 }}>
      <div className="system-list-title-bar px-4 py-3">
        <h2 className="system-list-title">{title} <span style={{ opacity: 0.7, fontWeight: 500 }}>({rows.length})</span></h2>
      </div>
      <table className="system-list-table" style={{ width: '100%' }}>
        <thead><tr className="list-column-header-gray"><th>Company</th><th>FYE</th><th>Due Date</th><th>Days</th><th>Assigned as</th><th>Remarks</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="system-list-row">
              <td style={{ padding: '6px 10px' }}><span className="company-name-text">{r.entityName}</span></td>
              <td style={{ padding: '6px 10px' }}>{r.fyeMonth} {r.fyeYear}</td>
              <td style={{ padding: '6px 10px' }}>{fmtDate(r.dueDate)}</td>
              <td style={{ padding: '6px 10px', fontWeight: 700, color: tone === 'danger' ? '#dc2626' : '#b45309' }}>
                {r.daysUntilDue < 0 ? `${Math.abs(r.daysUntilDue)}d overdue` : r.daysUntilDue === 0 ? 'Due today' : `${r.daysUntilDue}d left`}
              </td>
              <td style={{ padding: '6px 10px' }}><MatchedAsBadges fields={r.matchedAs} /></td>
              <td style={{ padding: '6px 10px', fontSize: 11, color: '#64748b', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.remarks ?? ''}>{r.remarks || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LateFilingTable({ rows }: { rows: LateFilingTask[] }) {
  if (!rows.length) return null;
  return (
    <div className="system-list-shell" style={{ marginBottom: 16 }}>
      <div className="system-list-title-bar px-4 py-3">
        <h2 className="system-list-title">Late Filing <span style={{ opacity: 0.7, fontWeight: 500 }}>({rows.length})</span></h2>
      </div>
      <table className="system-list-table" style={{ width: '100%' }}>
        <thead><tr className="list-column-header-gray"><th>Company</th><th>Next AGM Due</th><th>Assigned as</th><th>Remarks</th></tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className="system-list-row">
              <td style={{ padding: '6px 10px' }}><span className="company-name-text">{r.companyName}</span></td>
              <td style={{ padding: '6px 10px' }}>{r.nextAgmDueDate ? fmtDate(r.nextAgmDueDate) : '—'}</td>
              <td style={{ padding: '6px 10px' }}><MatchedAsBadges fields={r.matchedAs} /></td>
              <td style={{ padding: '6px 10px', fontSize: 11, color: '#64748b', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.remarks ?? ''}>{r.remarks || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MyTasksPage() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [data, setData] = useState<MyTasksResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cat, setCat] = useState<Category>('ALL');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meRes, tasksRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/my-tasks'),
      ]);
      const meJson = meRes.ok ? await meRes.json() : { user: null };
      setUser(meJson.user ?? null);
      if (!tasksRes.ok) {
        const j = await tasksRes.json().catch(() => ({}));
        throw new Error(j.error || 'Failed to load My Tasks');
      }
      setData(await tasksRes.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = data?.counts;
  const arRows = data?.arReminder;
  const lateRows = data?.lateFiling?.needsAttention ?? [];

  const showOverdue = cat === 'ALL' || cat === 'overdue';
  const showDueSoon = cat === 'ALL' || cat === 'dueSoon';
  const showLate = cat === 'ALL' || cat === 'lateFiling';

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › My Tasks</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <ListChecks size={20} color="#1e3a5f" />
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', margin: 0 }}>My Tasks</h1>
        {user && <span style={{ fontSize: 12, color: '#94a3b8' }}>{user.name}</span>}
        <button onClick={load} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}>
          <RefreshCw size={14} />Refresh
        </button>
      </div>
      {data && <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 20 }}>{data.scopeNote}</div>}

      {loading && !data ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#dc2626' }}>{error}</div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 24 }}>
            <MetricCard onClick={() => setCat('ALL')} active={cat === 'ALL'} value={counts?.total ?? 0} label="All Tasks" sub="across AR & Late Filing" icon={<ListChecks size={16} />} color="#1e3a5f" ariaLabel="Show all tasks" />
            <MetricCard onClick={() => setCat('overdue')} active={cat === 'overdue'} value={(counts?.arOverdue ?? 0) + (counts?.arStaleOverdue ?? 0)} label="AR Overdue" sub="past due, not filed" icon={<AlertTriangle size={16} />} color="#dc2626" ariaLabel="Filter by AR overdue" />
            <MetricCard onClick={() => setCat('dueSoon')} active={cat === 'dueSoon'} value={counts?.arDueSoon ?? 0} label="AR Due Soon" sub="due within 14 days" icon={<Clock size={16} />} color="#b45309" ariaLabel="Filter by AR due soon" />
            {data?.scope === 'full' && (
              <MetricCard onClick={() => setCat('lateFiling')} active={cat === 'lateFiling'} value={counts?.lateFiling ?? 0} label="Late Filing" sub="flagged, mine to chase" icon={<CalendarClock size={16} />} color="#7c3aed" ariaLabel="Filter by Late Filing" />
            )}
          </div>

          {counts?.total === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Nothing outstanding — you're all caught up.</div>
          ) : (
            <>
              {showOverdue && arRows && (arRows.overdue.length > 0 || arRows.staleOverdue.length > 0) && (
                <>
                  <ArTaskTable rows={arRows.overdue} title="AR Overdue" tone="danger" />
                  <ArTaskTable rows={arRows.staleOverdue} title="AR Overdue (prior FYE year)" tone="danger" />
                </>
              )}
              {showDueSoon && arRows && <ArTaskTable rows={arRows.dueSoon} title="AR Due Soon" tone="warning" />}
              {showLate && data?.scope === 'full' && <LateFilingTable rows={lateRows} />}
            </>
          )}
        </>
      )}
    </div>
  );
}
