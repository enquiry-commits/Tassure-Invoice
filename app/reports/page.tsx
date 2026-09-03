'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart3, Users, UserPlus, UserMinus, TrendingUp, PieChart, Wallet, Compass, Download, X,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { Donut, VBars, HBars } from '@/components/dashboard/Charts';
import { DimensionFilterMenu, type FilterOption } from '@/components/dashboard/DimensionFilterMenu';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { customerSourceLabel } from '@/lib/customer-source';
import { formatStaffName } from '@/lib/staff-directory';

// Reports — customer-profile analytics for leadership, gated on
// ApprovedAccount.canViewReports (lib/approved-accounts.ts). Guard pattern
// copied from app/admin/appearance/page.tsx — the one other page in this
// app scoped to a named handful of accounts: a client-side redirect (no
// proxy.ts change, no precedent for that here either) backed by a real
// server-side 403 on the API route itself (app/api/reports/route.ts), so
// this is a real permission boundary, not just hidden UI.
type Pt = { label: string; value: number; color?: string };
type CompanyRow = {
  id: number; companyName: string; uen: string | null; companyType: string | null;
  ssicDescription1: string | null; customerSource: string | null; twStatus: string | null;
  pic: string | null; isActive: boolean | null; joinDate: string | null;
  usesAddress: boolean | null; hasNd: boolean | null; hasAgm: boolean | null;
  hasXbrl: boolean | null; hasAccounts: boolean | null; hasTax: boolean | null;
};
type FlowRow = { companyName: string; uen: string | null };
interface ReportsData {
  generatedAt: string;
  kpis: { activeClients: number; newThisYear: number; churnedThisYear: number; netGrowthThisYear: number };
  clientTypeDonut: Pt[];
  serviceMix: Pt[];
  sourceDonut: Pt[];
  flow: { years: string[]; newClientsTrend: Pt[]; churnedTrend: Pt[]; newByYearRows: Record<string, FlowRow[]>; churnedByYearRows: Record<string, FlowRow[]> };
  revenue: { years: string[]; invoiceCountTrend: Pt[]; revenueTrendThousands: Pt[] };
  picWorkload: Pt[];
  companyRows: CompanyRow[];
  notes: { clientType: string; flow: string; source: string; revenue: string };
}

const COLORS = { ink: '#102a43', teal: '#397f78', blue: '#557795', gold: '#b98243', plum: '#746487', rose: '#b45f6b' };
const PALETTE = ['#0f766e', '#2563eb', '#7c3aed', '#c026d3', '#0891b2', '#f59e0b', '#dc2626', '#65a30d', '#94a3b8', '#334155'];

function Card({ title, eyebrow, icon, children, note }: {
  title: string; eyebrow: string; icon: React.ReactNode; children: React.ReactNode; note?: string;
}) {
  return (
    <section style={{ background: 'rgba(255,255,255,.96)', borderRadius: 16, border: '1px solid #dfe7ec', boxShadow: '0 10px 32px rgba(28,52,73,.045)', padding: '20px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: '#edf4f3', color: COLORS.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
        <div>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.8px', marginBottom: 2 }}>{eyebrow}</div>
          <h2 style={{ fontSize: 14, fontWeight: 750, color: COLORS.ink, margin: 0, letterSpacing: '-.01em' }}>{title}</h2>
        </div>
      </div>
      {children}
      {note && <p style={{ margin: '14px 0 0', fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>{note}</p>}
    </section>
  );
}

// ── Explore: dimension x metric "simple pivot table", 2026-09-03 ───────────
// Vincent, after reviewing the fixed-chart version above: "这个部分主要是给
// 老板自己做分析的，所以是可以手动操作的...目前你提供的内容作用单一，看起来更像是
// 一个摆设" (this needs to be manually operable, not decorative) — asked for
// filters, dimension-switching, a freeform dimension x metric pivot, and
// export. Deliberately NOT a real 2-axis crosstab (that's a bigger UI than
// "简易透视表" — a simple pivot table — calls for): one dimension at a time,
// grouped-by count or a service-flag COUNTIF, each row clickable to drill
// into the real companies behind it. All computed client-side over the one
// `companyRows` array /api/reports already ships — no extra network
// round-trip per filter/dimension change (the whole point of "manual
// operation" feeling instant, not another static chart).
type DimensionKey = 'companyType' | 'ssic' | 'customerSource' | 'twStatus' | 'pic';
type MetricKey = 'count' | 'usesAddress' | 'hasNd' | 'hasAgm' | 'hasXbrl' | 'hasAccounts' | 'hasTax';

const DIMENSIONS: { key: DimensionKey; label: string; value: (r: CompanyRow) => string }[] = [
  { key: 'companyType', label: 'Company Type', value: r => r.companyType || 'Unspecified' },
  { key: 'ssic', label: 'SSIC Industry', value: r => r.ssicDescription1 || 'Not yet synced / unclassified' },
  { key: 'customerSource', label: 'Customer Source', value: r => customerSourceLabel(r.customerSource) },
  { key: 'twStatus', label: 'Roster Status', value: r => r.twStatus || 'Untracked' },
  { key: 'pic', label: 'Secretary PIC', value: r => formatStaffName(r.pic) || 'Unassigned' },
];

const METRICS: { key: MetricKey; label: string }[] = [
  { key: 'count', label: 'Company Count' },
  { key: 'usesAddress', label: 'Uses Address Service' },
  { key: 'hasNd', label: 'Has Nominee Director' },
  { key: 'hasAgm', label: 'Has AGM' },
  { key: 'hasXbrl', label: 'Has XBRL' },
  { key: 'hasAccounts', label: 'Has Accounts' },
  { key: 'hasTax', label: 'Has Tax' },
];

type FilterState = Record<DimensionKey, Set<string> | null>;
const EMPTY_FILTERS: FilterState = { companyType: null, ssic: null, customerSource: null, twStatus: null, pic: null };

function matchesFilters(row: CompanyRow, filters: FilterState, exceptDim: DimensionKey | null): boolean {
  for (const dim of DIMENSIONS) {
    if (dim.key === exceptDim) continue;
    const sel = filters[dim.key];
    if (sel === null) continue;
    if (!sel.has(dim.value(row))) return false;
  }
  return true;
}

type DrillDown = { label: string; rows: CompanyRow[] };

function ExploreSection({ companyRows, exportHref }: { companyRows: CompanyRow[]; exportHref: string }) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [dimension, setDimension] = useState<DimensionKey>('companyType');
  const [metric, setMetric] = useState<MetricKey>('count');
  const [drilldown, setDrilldown] = useState<DrillDown | null>(null);

  const activeDim = DIMENSIONS.find(d => d.key === dimension)!;
  const filteredRows = useMemo(() => companyRows.filter(r => matchesFilters(r, filters, null)), [companyRows, filters]);
  const metricRows = useMemo(() => metric === 'count' ? filteredRows : filteredRows.filter(r => r[metric]), [filteredRows, metric]);

  const pivot = useMemo(() => {
    const rowsByValue = new Map<string, CompanyRow[]>();
    for (const r of metricRows) {
      const v = activeDim.value(r);
      if (!rowsByValue.has(v)) rowsByValue.set(v, []);
      rowsByValue.get(v)!.push(r);
    }
    return [...rowsByValue.entries()]
      .map(([value, rows]) => ({ value, rows, count: rows.length }))
      .sort((a, b) => b.count - a.count);
  }, [metricRows, activeDim]);

  const pivotTotal = metricRows.length;
  const chartData: Pt[] = useMemo(() => {
    if (pivot.length <= 8) return pivot.map((p, i) => ({ label: p.value, value: p.count, color: PALETTE[i % PALETTE.length] }));
    const top = pivot.slice(0, 14).map((p, i) => ({ label: p.value, value: p.count, color: PALETTE[i % PALETTE.length] }));
    const rest = pivot.slice(14).reduce((s, p) => s + p.count, 0);
    return rest > 0 ? [...top, { label: 'Other', value: rest, color: '#cbd5e1' }] : top;
  }, [pivot]);

  const filterOptions = (dim: DimensionKey): FilterOption[] => {
    const counts = new Map<string, number>();
    const def = DIMENSIONS.find(d => d.key === dim)!;
    for (const r of companyRows) {
      if (!matchesFilters(r, filters, dim)) continue;
      const v = def.value(r);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }));
  };

  const drillPagination = usePagination(drilldown?.rows ?? [], drilldown?.label ?? null);

  return (
    <Card
      title="Explore"
      eyebrow="Custom Analysis"
      icon={<Compass size={16} />}
      note="Group-by counts here are computed live from every active client — change a filter or dimension and everything below updates instantly, no page reload."
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16, alignItems: 'center' }}>
        {DIMENSIONS.map(d => (
          <DimensionFilterMenu key={d.key} label={d.label} options={filterOptions(d.key)} selected={filters[d.key]}
            onApply={next => setFilters(f => ({ ...f, [d.key]: next }))} />
        ))}
        <a href={exportHref} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: '#fff', background: COLORS.teal, borderRadius: 7, padding: '6px 12px', textDecoration: 'none' }}>
          <Download size={12} />Export .xlsx
        </a>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 18 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#64748b', fontWeight: 700 }}>
          GROUP BY
          <select value={dimension} onChange={e => setDimension(e.target.value as DimensionKey)}
            style={{ fontSize: 13, padding: '6px 8px', borderRadius: 7, border: '1px solid #e2e8f0', minWidth: 180 }}>
            {DIMENSIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: '#64748b', fontWeight: 700 }}>
          METRIC
          <select value={metric} onChange={e => setMetric(e.target.value as MetricKey)}
            style={{ fontSize: 13, padding: '6px 8px', borderRadius: 7, border: '1px solid #e2e8f0', minWidth: 200 }}>
            {METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) minmax(260px,1.3fr)', gap: 24, alignItems: 'start' }}>
        <div>{pivot.length <= 8 ? <Donut segments={chartData} size={160} thickness={24} /> : <HBars data={chartData} accent={COLORS.teal} labelWidth={140} />}</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '5px 8px', color: '#94a3b8', fontSize: 10.5, textTransform: 'uppercase' }}>{activeDim.label}</th>
                <th style={{ textAlign: 'right', padding: '5px 8px', color: '#94a3b8', fontSize: 10.5, textTransform: 'uppercase' }}>Count</th>
                <th style={{ textAlign: 'right', padding: '5px 8px', color: '#94a3b8', fontSize: 10.5, textTransform: 'uppercase' }}>%</th>
              </tr>
            </thead>
            <tbody>
              {pivot.map(p => (
                <tr key={p.value} onClick={() => setDrilldown({ label: p.value, rows: p.rows })}
                  style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                  <td style={{ padding: '6px 8px', color: '#334155' }}>{p.value}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: COLORS.ink }}>{p.count}</td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', color: '#94a3b8' }}>{pivotTotal ? Math.round((p.count / pivotTotal) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drilldown && (
        <div style={{ marginTop: 20, borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: COLORS.ink }}>{drilldown.label} — {drilldown.rows.length} companies</span>
            <button onClick={() => setDrilldown(null)} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer' }}>
              <X size={12} />Close
            </button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '5px 8px', color: '#94a3b8', fontSize: 10.5, textTransform: 'uppercase' }}>Company</th>
                  <th style={{ textAlign: 'left', padding: '5px 8px', color: '#94a3b8', fontSize: 10.5, textTransform: 'uppercase' }}>UEN</th>
                </tr>
              </thead>
              <tbody>
                {drillPagination.pageItems.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ padding: '6px 8px' }}>
                      <Link href={`/companies/${r.id}`} style={{ color: COLORS.blue, textDecoration: 'none' }}>{r.companyName}</Link>
                    </td>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.uen || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar page={drillPagination.page} totalPages={drillPagination.totalPages} total={drillPagination.total} startIndex={drillPagination.startIndex} pageCount={drillPagination.pageItems.length} onPage={drillPagination.setPage} />
        </div>
      )}
    </Card>
  );
}

export default function ReportsPage() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [data, setData] = useState<ReportsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flowDrilldown, setFlowDrilldown] = useState<'new' | 'churned' | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(result => {
      if (!result?.user?.canViewReports) { router.replace('/'); return; }
      setAuthorized(true);
    }).catch(() => router.replace('/'));
  }, [router]);

  useEffect(() => {
    if (!authorized) return;
    fetch('/api/reports').then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Failed to load Reports');
      setData(body);
    }).catch(e => setError(e.message));
  }, [authorized]);

  // usePagination MUST run on every render, before the early returns below
  // — calling a hook only on renders where authorized/data happen to be
  // ready (as this was originally written, with the call sitting after
  // those `if (...) return` guards) is a real Rules-of-Hooks violation:
  // React sees a different number of hooks called between the "still
  // loading" renders and the "data arrived" render and hard-crashes with
  // no error boundary to catch it — this is what actually broke the page
  // in production ("This page couldn't load"), not a data or auth issue.
  const thisYear = String(new Date().getFullYear());
  const flowDrillRows: FlowRow[] = !data ? [] : flowDrilldown === 'new' ? (data.flow.newByYearRows[thisYear] ?? [])
    : flowDrilldown === 'churned' ? (data.flow.churnedByYearRows[thisYear] ?? []) : [];
  const flowPagination = usePagination(flowDrillRows, flowDrilldown);

  if (authorized === null) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>;
  if (error) return <div style={{ padding: 40, textAlign: 'center', color: '#b45f6b', fontSize: 13 }}>{error}</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: '#edf4f3', color: COLORS.teal, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BarChart3 size={18} />
        </span>
        <div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: COLORS.ink, letterSpacing: '-.02em' }}>Reports</h1>
          <p style={{ margin: '2px 0 0', fontSize: 12, color: '#8493a3' }}>Customer profile analytics — generated {data.generatedAt}. Visible to a small, named group only.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 14 }}>
        <MetricCard value={data.kpis.activeClients} label="Active Clients" icon={<Users size={16} />} color={COLORS.teal} />
        <MetricCard value={data.kpis.newThisYear} label="New This Year" icon={<UserPlus size={16} />} color={COLORS.blue}
          active={flowDrilldown === 'new'} onClick={() => setFlowDrilldown(v => v === 'new' ? null : 'new')} />
        <MetricCard value={data.kpis.churnedThisYear} label="Churned This Year" icon={<UserMinus size={16} />} color={COLORS.rose}
          active={flowDrilldown === 'churned'} onClick={() => setFlowDrilldown(v => v === 'churned' ? null : 'churned')} />
        <MetricCard
          value={data.kpis.netGrowthThisYear > 0 ? `+${data.kpis.netGrowthThisYear}` : data.kpis.netGrowthThisYear}
          label="Net Growth This Year"
          icon={<TrendingUp size={16} />}
          color={data.kpis.netGrowthThisYear >= 0 ? COLORS.teal : COLORS.rose}
        />
      </div>

      {flowDrilldown && (
        <Card title={flowDrilldown === 'new' ? 'New This Year' : 'Churned This Year'} eyebrow="Drill-down" icon={flowDrilldown === 'new' ? <UserPlus size={16} /> : <UserMinus size={16} />}
          note="Sourced from master_list, not companies — a struck-off company can be entirely removed from companies, so this list only shows what master_list actually has on file (no company type/SSIC for these rows).">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '5px 8px', color: '#94a3b8', fontSize: 10.5, textTransform: 'uppercase' }}>Company</th>
                  <th style={{ textAlign: 'left', padding: '5px 8px', color: '#94a3b8', fontSize: 10.5, textTransform: 'uppercase' }}>UEN</th>
                </tr>
              </thead>
              <tbody>
                {flowPagination.pageItems.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ padding: '6px 8px' }}>{r.companyName}</td>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.uen || '—'}</td>
                  </tr>
                ))}
                {flowDrillRows.length === 0 && (
                  <tr><td colSpan={2} style={{ padding: 20, textAlign: 'center', color: '#94a3b8' }}>No rows found for {thisYear}.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationBar page={flowPagination.page} totalPages={flowPagination.totalPages} total={flowPagination.total} startIndex={flowPagination.startIndex} pageCount={flowPagination.pageItems.length} onPage={flowPagination.setPage} />
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
        <Card title="Client Type" eyebrow="Composition" icon={<PieChart size={16} />} note={data.notes.clientType}>
          <Donut segments={data.clientTypeDonut} size={150} thickness={22} />
        </Card>
        <Card title="Customer Source" eyebrow="Composition" icon={<Compass size={16} />} note={data.notes.source}>
          <Donut segments={data.sourceDonut} size={150} thickness={22} />
        </Card>
      </div>

      <Card title="Service Mix" eyebrow="Active Clients" icon={<BarChart3 size={16} />}>
        <HBars data={data.serviceMix} accent={COLORS.teal} labelWidth={110} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
        <Card title="New Clients by Year" eyebrow="Flow" icon={<UserPlus size={16} />} note={data.notes.flow}>
          <VBars data={data.flow.newClientsTrend} color={COLORS.teal} height={170} />
        </Card>
        <Card title="Churned by Year" eyebrow="Flow" icon={<UserMinus size={16} />} note={data.notes.flow}>
          <VBars data={data.flow.churnedTrend} color={COLORS.rose} height={170} />
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
        <Card title="Invoice Volume by Year" eyebrow="Billing" icon={<Wallet size={16} />}>
          <VBars data={data.revenue.invoiceCountTrend} color={COLORS.blue} height={170} />
        </Card>
        <Card title="Revenue by Year (S$'000)" eyebrow="Billing" icon={<Wallet size={16} />} note={data.notes.revenue}>
          <VBars data={data.revenue.revenueTrendThousands} color={COLORS.gold} height={170} />
        </Card>
      </div>

      <Card title="Staff Workload" eyebrow="Open AR / AGM Cycles" icon={<Users size={16} />} note="Counts every open (not yet filed) cycle a person is SEC, ACC, or TAX PIC on — the same fields My Tasks reads.">
        {data.picWorkload.length
          ? <HBars data={data.picWorkload} accent={COLORS.plum} labelWidth={140} />
          : <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No open cycles.</div>}
      </Card>

      <ExploreSection companyRows={data.companyRows} exportHref="/api/reports/export" />

      <Card title="Potential Customer Direction" eyebrow="Coming later" icon={<Compass size={16} />}>
        <div style={{ padding: '4px 0', color: '#64748b', fontSize: 12.5, lineHeight: 1.6 }}>
          No prospect/lead data exists anywhere in this system yet, so there is nothing real to show here.
          Now that SSIC and Customer Source have real data, this section can eventually show which
          industries and channels are under-represented in the current client base — a real,
          data-grounded growth signal instead of a guess. Use the Explore section above to look at
          that breakdown yourself in the meantime.
        </div>
      </Card>
    </div>
  );
}
