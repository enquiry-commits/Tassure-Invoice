'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, Eye, MousePointerClick, Users } from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { HBars, VBars } from '@/components/dashboard/Charts';

// Real behavioral analytics for leadership — Vincent, 2026-09-08: "Vincent
// 和管理层，可以调用全部的数据来继续单独人员的了解，又或者是整体公司人员
// 的了解". Guard pattern copied from app/reports/page.tsx (itself copied
// from app/admin/appearance/page.tsx) — a client-side redirect backed by a
// real server-side 403 on app/api/activity/insights/route.ts, so this is a
// real permission boundary, not just hidden UI.
//
// UI is intentionally simple for now, same as My Tasks' own daily-briefing
// banner shipped the same day — the point today is real data flowing
// through a real pipeline, not a polished dashboard. Iterate the look
// later once there's something real to look at.
type PageVisitStat = { pathname: string; visits: number; lastVisitedAt: string };
type ActionStat = { eventType: string; count: number; lastAt: string; sampleDetails: (Record<string, unknown> | null)[] };
type PersonSummary = { email: string; rangeDays: number; totalEvents: number; topPages: PageVisitStat[]; topActions: ActionStat[]; hourOfDayDistribution: number[] };
type CompanySummary = { rangeDays: number; totalEvents: number; topPages: PageVisitStat[]; topActions: ActionStat[]; byPerson: { email: string; totalEvents: number; topPage: string | null }[] };
type StaffEntry = { email: string; name: string };

function fmtTs(iso: string) {
  return new Date(iso).toLocaleString('en-SG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// Best-effort human label for an action's own recorded detail, so "12
// generate_invoice events" reads as something concrete rather than a bare
// count — company name is the one field every current action logs.
function sampleLabel(samples: (Record<string, unknown> | null)[]): string | null {
  const names = samples.map(s => (s?.companyName as string | undefined)).filter(Boolean).slice(0, 2);
  return names.length ? `e.g. ${names.join(', ')}` : null;
}

function EmptyState({ rangeDays }: { rangeDays: number }) {
  return (
    <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontSize: 13 }}>
      No activity recorded in the last {rangeDays} days.
      <div style={{ fontSize: 11.5, marginTop: 6, color: '#b7c1cd' }}>
        This tracking only started recently — there is no historical click data to backfill. Check back once people have used the system for a while.
      </div>
    </div>
  );
}

export default function ActivityInsightsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [selectedEmail, setSelectedEmail] = useState(''); // '' = company-wide
  const [staffDirectory, setStaffDirectory] = useState<StaffEntry[]>([]);
  const [personData, setPersonData] = useState<PersonSummary | null>(null);
  const [companyData, setCompanyData] = useState<CompanySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Vincent-only, 2026-09-09 ("只有Vincent 可以看到") — moved from the
    // canViewActivityInsights flag (still true for Cindy/Samuell/Yee Soon,
    // but that flag now only gates the unrelated AI Learning candidates
    // cross-staff view) to `admin`, which only Vincent's account has.
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(result => {
      if (!result?.user?.admin) { router.replace('/'); return; }
      setAuthorized(true);
    }).catch(() => router.replace('/'));
  }, [router]);

  const load = useCallback(() => {
    if (!authorized) return;
    setLoading(true);
    setError(null);
    const url = selectedEmail ? `/api/activity/insights?email=${encodeURIComponent(selectedEmail)}` : '/api/activity/insights';
    fetch(url).then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Failed to load Activity Insights');
      setStaffDirectory(body.staffDirectory ?? []);
      if (body.scope === 'person') { setPersonData(body.summary); setCompanyData(null); }
      else { setCompanyData(body.summary); setPersonData(null); }
    }).catch(e => setError(e instanceof Error ? e.message : String(e))).finally(() => setLoading(false));
  }, [authorized, selectedEmail]);

  useEffect(() => { load(); }, [load]);

  if (authorized === null) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>;

  const summary = personData ?? companyData;
  const nameFor = (email: string) => staffDirectory.find(s => s.email === email)?.name ?? email;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Activity Insights</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Activity size={20} color="#1e3a5f" />
        <h1 style={{ fontSize: 18, fontWeight: 800, color: '#1e293b', margin: 0 }}>Activity Insights</h1>
        <select
          value={selectedEmail}
          onChange={e => setSelectedEmail(e.target.value)}
          style={{ marginLeft: 12, border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', fontSize: 12.5, color: '#475569', background: '#fff' }}
        >
          <option value="">Company-wide</option>
          {staffDirectory.map(s => <option key={s.email} value={s.email}>{s.name}</option>)}
        </select>
      </div>
      <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 20 }}>
        Real page-visit and key-action history — starts from the day this tracking shipped (2026-09-08), never backfilled. Last {summary?.rangeDays ?? 30} days.
      </div>

      {loading && !summary ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>
      ) : error ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#dc2626' }}>{error}</div>
      ) : !summary || summary.totalEvents === 0 ? (
        <EmptyState rangeDays={summary?.rangeDays ?? 30} />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginBottom: 24 }}>
            <MetricCard value={summary.totalEvents} label="Total Events" sub={`last ${summary.rangeDays} days`} icon={<Activity size={16} />} color="#1e3a5f" />
            <MetricCard value={summary.topPages.length} label="Distinct Pages Visited" sub="page views" icon={<Eye size={16} />} color="#0f766e" />
            <MetricCard value={summary.topActions.reduce((s, a) => s + a.count, 0)} label="Key Actions" sub="tracked actions only, not every click" icon={<MousePointerClick size={16} />} color="#7c3aed" />
            {companyData && <MetricCard value={companyData.byPerson.length} label="Active Staff" sub="with any recorded activity" icon={<Users size={16} />} color="#b45309" />}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(360px,1fr))', gap: 16, marginBottom: 16 }}>
            <div className="system-list-shell">
              <div className="system-list-title-bar px-4 py-3"><span className="system-list-title">Most Visited Pages</span></div>
              <div style={{ padding: 16 }}>
                {summary.topPages.length
                  ? <HBars data={summary.topPages.map(p => ({ label: p.pathname, value: p.visits }))} accent="#0f766e" />
                  : <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No page views recorded.</div>}
              </div>
            </div>
            <div className="system-list-shell">
              <div className="system-list-title-bar px-4 py-3"><span className="system-list-title">Most Common Key Actions</span></div>
              <div style={{ padding: 16 }}>
                {summary.topActions.length ? (
                  <>
                    <HBars data={summary.topActions.map(a => ({ label: a.eventType, value: a.count }))} accent="#7c3aed" />
                    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {summary.topActions.map(a => {
                        const label = sampleLabel(a.sampleDetails);
                        return label ? (
                          <div key={a.eventType} style={{ fontSize: 10.5, color: '#94a3b8' }}>
                            <strong style={{ color: '#64748b' }}>{a.eventType}</strong> — {label} · last {fmtTs(a.lastAt)}
                          </div>
                        ) : null;
                      })}
                    </div>
                  </>
                ) : <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No key actions recorded yet — only a handful of actions are tracked so far (Generate Invoice, AR Delete, Late Filing Resolve, Create Outlook Drafts); more can be added over time.</div>}
              </div>
            </div>
          </div>

          {personData && (
            <div className="system-list-shell" style={{ marginBottom: 16 }}>
              <div className="system-list-title-bar px-4 py-3"><span className="system-list-title">When {nameFor(personData.email)} Is Active (hour of day, SGT)</span></div>
              <div style={{ padding: 16 }}>
                <VBars data={personData.hourOfDayDistribution.map((v, h) => ({ label: String(h), value: v }))} color="#1d4ed8" height={160} />
              </div>
            </div>
          )}

          {companyData && (
            <div className="system-list-shell">
              <div className="system-list-title-bar px-4 py-3" style={{ display: 'flex', alignItems: 'center' }}>
                <span className="system-list-title">By Staff Member</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{companyData.byPerson.length}</span>
              </div>
              <table className="system-list-table" style={{ width: '100%' }}>
                <thead><tr className="list-column-header-gray"><th>Staff</th><th>Total Events</th><th>Most-Visited Page</th></tr></thead>
                <tbody>
                  {companyData.byPerson.map(p => (
                    <tr key={p.email} className="system-list-row" style={{ cursor: 'pointer' }} onClick={() => setSelectedEmail(p.email)}>
                      <td style={{ padding: '6px 10px' }}>{nameFor(p.email)}</td>
                      <td style={{ padding: '6px 10px' }}>{p.totalEvents}</td>
                      <td style={{ padding: '6px 10px', fontSize: 11, color: '#64748b' }}>{p.topPage ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
