'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart3, Users, UserPlus, UserMinus, TrendingUp, TrendingDown, PieChart, Wallet, Compass, Download, X, Sparkles, RefreshCw, Database,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { Donut, VBars, HBars, LineChart } from '@/components/dashboard/Charts';
import { DimensionFilterMenu, type FilterOption } from '@/components/dashboard/DimensionFilterMenu';
import { usePagination, PaginationBar } from '@/components/Pagination';
import { customerSourceLabel } from '@/lib/customer-source';
import { formatStaffName } from '@/lib/staff-directory';
import { REPORT_COLORS, REPORT_PALETTE } from '@/lib/chart-colors';
import { formatCompactCurrency, formatCompactNumber } from '@/lib/chart-format';

// Reports — customer-profile analytics for leadership, gated on
// ApprovedAccount.canViewReports (lib/approved-accounts.ts). Guard pattern
// copied from app/admin/appearance/page.tsx — the one other page in this
// app scoped to a named handful of accounts: a client-side redirect (no
// proxy.ts change, no precedent for that here either) backed by a real
// server-side 403 on the API route itself (app/api/reports/route.ts), so
// this is a real permission boundary, not just hidden UI.
// value: null means no data exists for this point (Reports V3, "Missing
// Data Is Not Zero") — kept in sync with app/api/reports/route.ts's own
// identical widening.
type Pt = { label: string; value: number | null; color?: string };
type CompanyRow = {
  id: number; companyName: string; uen: string | null; companyType: string | null;
  ssicDescription1: string | null; customerSource: string | null; twStatus: string | null;
  pic: string | null; isActive: boolean | null; joinDate: string | null;
  usesAddress: boolean | null; hasNd: boolean | null; hasAgm: boolean | null;
  hasXbrl: boolean | null; hasAccounts: boolean | null; hasTax: boolean | null;
};
type FlowRow = { companyName: string; uen: string | null };
// Page-local copy of lib/reports-data.ts's ComparableRevenue, kept in sync
// by hand — same convention this file's own ReportsData interface already
// documents for the server-only route's identical shape.
type ComparableRevenue = {
  periodLabel: string; comparisonLabel: string | null;
  currentRevenue: number; currentInvoiceCount: number;
  priorRevenue: number | null; priorInvoiceCount: number | null;
  revenuePctChange: number | null; invoiceCountPctChange: number | null;
  comparable: boolean; comparabilityReason: string;
};
// Page-local copy of lib/reports-data.ts's DataQuality, kept in sync by
// hand — same convention as ComparableRevenue above.
type DataQualityStatus = 'normal' | 'minor_issues' | 'partial_data' | 'data_quality_warning' | 'unavailable';
type DataQuality = { parseableRecords: number; unparseableRecords: number; coveragePct: number; status: DataQualityStatus };
interface ReportsData {
  generatedAt: string;
  kpis: { activeClients: number; newThisYear: number; churnedThisYear: number; netGrowthThisYear: number };
  clientTypeDonut: Pt[];
  serviceMix: Pt[];
  sourceDonut: Pt[];
  flow: {
    years: string[]; newClientsTrend: Pt[]; churnedTrend: Pt[];
    newByYearRows: Record<string, FlowRow[]>; churnedByYearRows: Record<string, FlowRow[]>;
    newQuality: DataQuality; churnedQuality: DataQuality;
  };
  revenue: { years: string[]; invoiceCountTrend: Pt[]; revenueTrendThousands: Pt[]; comparableYoy: ComparableRevenue };
  picWorkload: Pt[];
  companyRows: CompanyRow[];
  notes: { clientType: string; flow: string; source: string; revenue: string };
}

// One shared palette now, not two (see lib/chart-colors.ts's own header for
// why) — COLORS/PALETTE names kept local so every reference below is
// unchanged, just re-pointed at the shared source.
const COLORS = REPORT_COLORS;
const PALETTE = REPORT_PALETTE;

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

// Reports V3 §13 — the real fix for docs/MANAGEMENT_ANALYST_GAP_ANALYSIS.md
// §0's bug, shown on screen, not just fed to the AI narrative: the old
// "Revenue by Year" chart compared 2026's partial bucket against 2025's
// FULL year and any reader doing the mental subtraction themselves would
// hit the exact same wrong conclusion the AI narrative used to. This
// renders lib/reports-data.ts's computeComparableRevenue() — a real
// equal-length YTD-vs-previous-YTD comparison — and refuses to show a %
// change at all when `comparable` is false, per spec §5's own
// "Comparison unavailable" instruction, rather than silently computing one
// anyway.
function RevenuePerformanceCard({ yoy }: { yoy: ComparableRevenue }) {
  const up = (yoy.revenuePctChange ?? 0) >= 0;
  return (
    <Card title="Revenue Performance" eyebrow="Comparable Period" icon={<Wallet size={16} />}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22 }}>
        <div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>
            {yoy.comparisonLabel ? `Same Period ${yoy.comparisonLabel.slice(0, 4)}` : 'Comparison Period'}
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#64748b' }}>{yoy.priorRevenue != null ? formatCompactCurrency(yoy.priorRevenue) : '—'}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>
            {yoy.periodLabel.slice(0, 4)} YTD
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: COLORS.ink }}>{formatCompactCurrency(yoy.currentRevenue)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 3 }}>Change</div>
          {yoy.comparable && yoy.revenuePctChange != null ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 20, fontWeight: 800, color: up ? '#0f766e' : '#b45f6b' }}>
              {up ? <TrendingUp size={18} /> : <TrendingDown size={18} />}
              {up ? '+' : ''}{yoy.revenuePctChange.toFixed(1)}%
            </div>
          ) : (
            <div style={{ fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>Comparison unavailable</div>
          )}
        </div>
      </div>
      <p style={{ margin: '16px 0 0', fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
        {yoy.comparable
          ? `${yoy.periodLabel} compared against the SAME date range one year earlier (${yoy.comparisonLabel}) — both periods are the identical length, never a partial year against a full one.`
          : yoy.comparabilityReason}
      </p>
    </Card>
  );
}

// Reports V3 §15/§17 — Customer Source's real coverage is 0% (911/911
// active clients have no customer_source on file — confirmed against live
// data before writing this, not assumed) — a donut chart with one 100%
// slice communicates nothing. Replaced with an honest data-quality signal
// instead of a decorative chart, per spec §30/§31 ("does this chart
// communicate useful information?" / "is a KPI better?").
function CustomerSourceQualityCard({ total, unknown }: { total: number; unknown: number }) {
  const coveragePct = total > 0 ? Math.round(((total - unknown) / total) * 100) : 0;
  return (
    <Card title="Customer Source" eyebrow="Data Quality" icon={<Database size={16} />}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 34, fontWeight: 800, color: coveragePct === 0 ? '#b45f6b' : COLORS.ink }}>{coveragePct}%</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>coverage</span>
      </div>
      <p style={{ margin: 0, fontSize: 12.5, color: '#475569', lineHeight: 1.6 }}>
        {unknown} of {total} active clients have no recorded customer source — a composition chart here would only ever show one 100% &ldquo;Unknown&rdquo; slice.
      </p>
      <p style={{ margin: '10px 0 0', fontSize: 10.5, color: '#94a3b8', lineHeight: 1.5, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
        Source tracking is a new field staff tag going forward from Company 360 — not backfilled from history. This card will show a real composition chart once enough new/updated clients carry it.
      </p>
    </Card>
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
  // .toUpperCase() (2026-09-09) — ssic_description_1 has inconsistent
  // casing in real data (confirmed: the SAME industry synced with both
  // "WHOLESALE TRADE OF A VARIETY OF GOODS WITHOUT A DOMINANT PRODUCT" and
  // "Wholesale trade of a variety of goods without a dominant product" on
  // different companies), which was silently splitting one real industry
  // into two separate pivot rows. Same fix as lib/customer-profile-
  // lookup.ts's chat-facing equivalent — see docs/INVARIANTS.md
  // INV-DATA-027. Never applied to the null-fallback label itself.
  { key: 'ssic', label: 'SSIC Industry', value: r => r.ssicDescription1 ? r.ssicDescription1.trim().toUpperCase() : 'Not yet synced / unclassified' },
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
  // Gates the manual refresh button below — Vincent specifically, not any
  // admin (see app/api/reports/narrative-cron/route.ts's own auth check,
  // the actual enforcement point; this only controls whether the button
  // renders at all for everyone else).
  const [isVincent, setIsVincent] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.ok ? r.json() : null).then(result => {
      if (!result?.user?.canViewReports) { router.replace('/'); return; }
      setIsVincent(result.user.email?.toLowerCase() === 'vincent@tassure.com');
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

  // AI narrative — its own effect/fetch, deliberately independent of `data`
  // above: it has its own (slower, LLM-backed) endpoint, and the numbers
  // must render immediately rather than wait on it. See app/api/reports/
  // narrative/route.ts (a PURE cache read, no generation path at all since
  // 2026-09-23) and app/api/reports/narrative-cron/route.ts (the only
  // writer — a weekly cron, Monday 06:00 SGT) + lib/reports-narrative.ts
  // for the prompt itself. Vincent: "能不能...装好一个金融分析师和企业规划
  // 师的Ai分析助手...让这些数据不会只是单单的数字了", picking "auto-
  // generated narrative" over a chat panel so this always shows something
  // on load. No manual refresh button (removed 2026-09-23, "为了不要浪费
  // Token...不能refresh") — this view only ever reads whatever the weekly
  // cron last wrote.
  //
  // Structured, not prose (round 2) — "文字没有优先级"/"排列也不整齐": a
  // single string can never GUARANTEE visual hierarchy no matter how the
  // prompt words it, so the API now returns real structure (insights[],
  // each with its own signal/title/body) and this renders each as its own
  // distinct row instead of paragraphs of prose. Bilingual per-field, both
  // languages already in the same fetched object — the 中/EN toggle below
  // just switches which field it reads, no second request.
  // Reports V3 Phase 1 (2026-09-23) — replaced the old flat titleZh/bodyZh
  // shape with a real FACT/INFERENCE/HYPOTHESIS/ACTION structure; driver is
  // nullable (the model must never invent a causal explanation just to
  // fill the field) and confidence is its own axis, independent of signal.
  type NarrativeInsight = {
    signal: 'good' | 'watch' | 'warning'; confidence: 'high' | 'medium' | 'low';
    titleZh: string; titleEn: string;
    observedZh: string; observedEn: string;
    metricRefs: string[];
    driverZh: string | null; driverEn: string | null;
    notYetProvenZh: string[]; notYetProvenEn: string[];
    nextActionZh: string; nextActionEn: string;
  };
  const [narrative, setNarrative] = useState<{ insights: NarrativeInsight[]; summaryZh: string; summaryEn: string; generatedAt: string } | null>(null);
  const [narrativeLang, setNarrativeLang] = useState<'zh' | 'en'>('zh');
  const [narrativeLoading, setNarrativeLoading] = useState(true);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);
  // Separate from narrativeLoading (the initial page-load fetch) — a manual
  // regenerate is a much longer wait (computeReportsData + a real OpenAI
  // call, up to ~2 minutes) and needs its own spinner state so the initial
  // load's brief flash doesn't get confused with it.
  const [narrativeRegenerating, setNarrativeRegenerating] = useState(false);

  const fetchNarrative = () => {
    fetch('/api/reports/narrative').then(async r => {
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || 'Failed to load AI analysis');
      // narrative is null when nothing has been generated yet (fresh
      // deploy, before the first Monday run) — not an error.
      setNarrative(body.narrative ? { insights: body.narrative.insights, summaryZh: body.narrative.summaryZh, summaryEn: body.narrative.summaryEn, generatedAt: body.generatedAt } : null);
      setNarrativeError(null);
    }).catch(e => setNarrativeError(e.message)).finally(() => setNarrativeLoading(false));
  };
  useEffect(() => { if (authorized) fetchNarrative(); }, [authorized]);

  // Vincent-only manual trigger (app/api/reports/narrative-cron/route.ts
  // enforces this server-side too — this button is a UI convenience, not
  // the real access boundary). Calls the SAME route the weekly cron calls,
  // then re-reads the cache so the page picks up the row it just wrote —
  // no separate "refresh" code path duplicated in the read endpoint.
  const refreshNarrative = () => {
    setNarrativeRegenerating(true);
    setNarrativeError(null);
    fetch('/api/reports/narrative-cron').then(async r => {
      const body = await r.json();
      if (!r.ok || body.ok === false) throw new Error(body.error || 'Failed to regenerate AI analysis');
      fetchNarrative();
    }).catch(e => setNarrativeError(e.message)).finally(() => setNarrativeRegenerating(false));
  };

  const CONFIDENCE_LABEL: Record<NarrativeInsight['confidence'], { zh: string; en: string }> = {
    high: { zh: '高置信度', en: 'High confidence' },
    medium: { zh: '中置信度', en: 'Medium confidence' },
    low: { zh: '低置信度', en: 'Low confidence' },
  };
  const SIGNAL_STYLE: Record<NarrativeInsight['signal'], { color: string; bg: string; labelZh: string; labelEn: string }> = {
    good: { color: '#6ee7b7', bg: 'rgba(110,231,183,.12)', labelZh: '健康', labelEn: 'Good' },
    watch: { color: '#fbbf24', bg: 'rgba(251,191,36,.12)', labelZh: '关注', labelEn: 'Watch' },
    warning: { color: '#fca5a5', bg: 'rgba(252,165,165,.12)', labelZh: '风险', labelEn: 'Warning' },
  };

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

      <section style={{ background: 'linear-gradient(135deg,#102a43,#1d3a5c)', borderRadius: 16, padding: '20px 22px', color: '#fff', boxShadow: '0 10px 32px rgba(16,42,67,.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Sparkles size={15} />
          </span>
          <div style={{ fontSize: 13, fontWeight: 750, letterSpacing: '-.01em' }}>{narrativeLang === 'zh' ? 'AI 分析 — 本期观察' : 'AI Analysis — This Period'}</div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Both languages already sit in the one fetched object (see
                lib/reports-narrative.ts) — this only ever flips which field
                renders, never triggers a second request. */}
            <div style={{ display: 'flex', background: 'rgba(255,255,255,.1)', borderRadius: 7, padding: 2 }}>
              {(['zh', 'en'] as const).map(l => (
                <button key={l} onClick={() => setNarrativeLang(l)}
                  style={{ fontSize: 10.5, fontWeight: 700, padding: '4px 9px', borderRadius: 5, border: 'none', cursor: 'pointer',
                    background: narrativeLang === l ? 'rgba(255,255,255,.9)' : 'transparent', color: narrativeLang === l ? '#102a43' : 'rgba(255,255,255,.7)' }}>
                  {l === 'zh' ? '中' : 'EN'}
                </button>
              ))}
            </div>
            {/* Vincent-only (2026-09-23: "保留那个 refresh 按钮给我，但是
                其他人是看不到的...只有Vincent可以选择强制 refresh") —
                everyone else only ever sees whatever the weekly cron last
                wrote. Server-side enforcement lives in app/api/reports/
                narrative-cron/route.ts; hiding the button here is just UI
                convenience on top of that, same "hide the entry point, but
                the real check lives in the route" pattern as /ai-learning. */}
            {isVincent && (
              <button onClick={refreshNarrative} disabled={narrativeRegenerating}
                title="Regenerate (Vincent only)"
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.75)', background: 'rgba(255,255,255,.1)', border: 'none', borderRadius: 7, padding: '5px 10px', cursor: narrativeRegenerating ? 'default' : 'pointer' }}>
                <RefreshCw size={11} style={{ animation: narrativeRegenerating ? 'spin 1s linear infinite' : 'none' }} />
                {narrativeRegenerating ? (narrativeLang === 'zh' ? '生成中…' : 'Working…') : (narrativeLang === 'zh' ? '重新生成' : 'Refresh')}
              </button>
            )}
          </div>
        </div>
        {narrativeError && (
          <div style={{ fontSize: 12.5, color: '#fecaca', lineHeight: 1.6 }}>{narrativeError}</div>
        )}
        {!narrativeError && narrativeLoading && (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.65)' }}>{narrativeLang === 'zh' ? '加载中…' : 'Loading…'}</div>
        )}
        {!narrativeError && !narrativeLoading && !narrative && (
          <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.65)' }}>
            {narrativeLang === 'zh' ? '分析将于下周一早上6点（新加坡时间）生成，请稍候。' : 'Analysis will be generated next Monday at 6am SGT.'}
          </div>
        )}
        {!narrativeError && narrative && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {narrative.insights.map((ins, i) => {
                const s = SIGNAL_STYLE[ins.signal];
                const c = CONFIDENCE_LABEL[ins.confidence];
                const driver = narrativeLang === 'zh' ? ins.driverZh : ins.driverEn;
                const notYetProven = narrativeLang === 'zh' ? ins.notYetProvenZh : ins.notYetProvenEn;
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 10, background: 'rgba(255,255,255,.05)', borderLeft: `3px solid ${s.color}` }}>
                    <span style={{ flexShrink: 0, height: 20, padding: '0 8px', borderRadius: 999, background: s.bg, color: s.color, fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', letterSpacing: '.02em' }}>
                      {narrativeLang === 'zh' ? s.labelZh : s.labelEn}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{narrativeLang === 'zh' ? ins.titleZh : ins.titleEn}</span>
                        {/* Confidence is metadata, not a visual centerpiece —
                            dashboard-design skill's own "do not overuse
                            confidence badges visually" guidance. */}
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: 'rgba(255,255,255,.45)', border: '1px solid rgba(255,255,255,.18)', borderRadius: 999, padding: '1px 7px' }}>
                          {narrativeLang === 'zh' ? c.zh : c.en}
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.7, color: 'rgba(255,255,255,.85)' }}>{narrativeLang === 'zh' ? ins.observedZh : ins.observedEn}</div>
                      {driver && (
                        <div style={{ fontSize: 12, lineHeight: 1.7, color: 'rgba(255,255,255,.65)', marginTop: 5 }}>
                          <span style={{ fontWeight: 700, color: 'rgba(255,255,255,.4)' }}>{narrativeLang === 'zh' ? '推测 · ' : 'Driver · '}</span>{driver}
                        </div>
                      )}
                      {notYetProven.length > 0 && (
                        <div style={{ fontSize: 11.5, lineHeight: 1.7, color: 'rgba(255,255,255,.5)', marginTop: 5 }}>
                          <span style={{ fontWeight: 700, color: 'rgba(255,255,255,.4)' }}>{narrativeLang === 'zh' ? '尚未证实 · ' : 'Not yet proven · '}</span>
                          {notYetProven.join(' / ')}
                        </div>
                      )}
                      <div style={{ fontSize: 12, lineHeight: 1.7, color: '#a7f3d0', marginTop: 6 }}>
                        <span style={{ fontWeight: 700 }}>{narrativeLang === 'zh' ? '下一步 · ' : 'Next · '}</span>
                        {narrativeLang === 'zh' ? ins.nextActionZh : ins.nextActionEn}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid rgba(255,255,255,.1)', fontSize: 11, lineHeight: 1.6, color: 'rgba(255,255,255,.5)' }}>
              {narrativeLang === 'zh' ? narrative.summaryZh : narrative.summaryEn}
            </div>
            <div style={{ marginTop: 8, fontSize: 10.5, color: 'rgba(255,255,255,.4)' }}>
              {narrativeLang === 'zh' ? '生成于 ' : 'Generated '}{new Date(narrative.generatedAt).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })}
              {narrativeLang === 'zh' ? ' · 每周一 6:00（新加坡时间）自动更新' : ' · Auto-updates every Monday 6am SGT'}
            </div>
          </>
        )}
      </section>

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
        <CustomerSourceQualityCard
          total={data.kpis.activeClients}
          unknown={data.sourceDonut.find(s => s.label === 'Unknown')?.value ?? 0}
        />
      </div>

      <Card title="Service Mix" eyebrow="Active Clients" icon={<BarChart3 size={16} />}>
        <HBars data={data.serviceMix} accent={COLORS.teal} labelWidth={110} />
      </Card>

      {/* New Clients vs Churned is genuinely a value changing across ORDERED
          years — a line reads that shape at a glance in a way two side-by-
          side bar charts never could (Vincent: "为什么只有柱状图...找出适
          合我们的"), and both series share ONE real axis (client count), so
          one multi-line chart is the correct type, not a design shortcut. */}
      <Card title="Client Flow by Year" eyebrow="Flow" icon={<UserPlus size={16} />} note={data.notes.flow}>
        <LineChart labels={data.flow.years} height={260} valueFormatter={formatCompactNumber}
          series={[
            { label: 'New Clients', color: COLORS.teal, data: data.flow.newClientsTrend.map(p => p.value) },
            { label: 'Churned', color: COLORS.rose, data: data.flow.churnedTrend.map(p => p.value) },
          ]} />
      </Card>

      {/* Revenue and Invoice Count used to be overlaid on one chart on two
          DIFFERENT implicit scales — a real dual-axis chart, which good
          chart-design guidance flags as a non-negotiable to avoid (two
          scales on one plot area is inherently hard to read correctly: a
          reader can't tell which scale a given line height refers to).
          What that overlay was actually FOR — showing whether Tassure bills
          more per invoice over time, not just more invoices — is better
          served by computing that ratio directly as its own single-axis
          series (average invoice value), not by cramming two raw numbers
          onto one plot. */}
      <RevenuePerformanceCard yoy={data.revenue.comparableYoy} />

      <Card title="Revenue by Year" eyebrow="Billing" icon={<Wallet size={16} />} note={data.notes.revenue}>
        {/* revenueTrendThousands stores dollars/1000 (lib/reports-data.ts's
            own computeRevenueTrend) — unitScale multiplies it back to real
            dollars before formatting, so this reads "S$1.28M", not "1284". */}
        <VBars data={data.revenue.revenueTrendThousands} color={COLORS.gold} height={260}
          valueFormatter={v => formatCompactCurrency(v, { unitScale: 1000 })} />
      </Card>
      <Card title="Average Invoice Value by Year" eyebrow="Billing" icon={<Wallet size={16} />}
        note="Revenue ÷ invoice count for that year — rising even while invoice volume is flat means Tassure is billing more per invoice, not just billing more often.">
        <LineChart labels={data.revenue.years} height={260} valueFormatter={formatCompactCurrency}
          series={[{
            label: 'Avg. Invoice Value (S$)', color: COLORS.blue,
            data: data.revenue.years.map((_, i) => {
              const count = data.revenue.invoiceCountTrend[i]?.value ?? 0;
              const revenue = data.revenue.revenueTrendThousands[i]?.value ?? 0;
              return count > 0 ? Math.round((revenue * 1000) / count) : 0;
            }),
          }]} />
      </Card>

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
