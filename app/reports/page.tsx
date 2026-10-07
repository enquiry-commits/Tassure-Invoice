'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  BarChart3, Users, UserPlus, UserMinus, TrendingUp, TrendingDown, PieChart, Wallet, Compass, Download, X, Sparkles, RefreshCw, Database, ChevronDown, ChevronUp,
} from 'lucide-react';
import MetricCard from '@/components/MetricCard';
import { Donut, VBars, HBars, LineChart } from '@/components/dashboard/Charts';
import { DimensionFilterMenu, type FilterOption } from '@/components/dashboard/DimensionFilterMenu';
import { usePagination, PaginationBar } from '@/components/Pagination';
import ExploreAssistant from '@/components/reports/ExploreAssistant';
import type { ExplorePlan } from '@/lib/reports-explore-intent';
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
  clientSince: string | null; referrerName: string | null; rmName: string | null; clientSinceNote: string | null;
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
type DimensionKey = 'companyType' | 'ssic' | 'customerSource' | 'twStatus' | 'pic' | 'clientSince' | 'referrer' | 'rm';
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
  // Client relationship fields (2026-10-06) — recorded on Company 360.
  // Client Since groups by YYYY-MM so "everything new since Jan 2026" is a
  // plain filter selection; blank until staff fill it in.
  { key: 'clientSince', label: 'Client Since (Month)', value: r => r.clientSince ? r.clientSince.slice(0, 7) : 'Not recorded' },
  { key: 'referrer', label: 'Referred By', value: r => r.referrerName || 'Not recorded' },
  { key: 'rm', label: 'RM (Relationship Manager)', value: r => r.rmName || 'Not assigned' },
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
const EMPTY_FILTERS: FilterState = { companyType: null, ssic: null, customerSource: null, twStatus: null, pic: null, clientSince: null, referrer: null, rm: null };

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

// Plain-language names for the "count" choices (the old dropdown said
// "Has XBRL", which read like a filter, not a number).
const METRIC_LABELS: Record<MetricKey, string> = {
  count: 'Number of companies',
  usesAddress: 'Companies using Address service',
  hasNd: 'Companies with Nominee Director',
  hasAgm: 'Companies with AGM',
  hasXbrl: 'Companies with XBRL',
  hasAccounts: 'Companies with Accounts',
  hasTax: 'Companies with Tax',
};

// Quick views (2026-10-06) — one click sets group-by, filters and the
// result tab together, so nobody has to know the controls to get an answer.
type ExploreView = 'summary' | 'list';
type Preset = { id: string; label: string; hint: string; dimension: DimensionKey; view: ExploreView; sinceFrom?: () => string };
const thisYearStart = () => `${new Date().getFullYear()}-01`;
const PRESETS: Preset[] = [
  { id: 'new', label: 'New clients this year', hint: 'Every company that became a client this year, with who referred it and its RM', dimension: 'referrer', view: 'list', sinceFrom: thisYearStart },
  { id: 'referrer', label: 'By referrer', hint: 'How many clients each referrer brought in', dimension: 'referrer', view: 'summary' },
  { id: 'rm', label: 'By RM', hint: 'How many clients each Relationship Manager looks after', dimension: 'rm', view: 'summary' },
  { id: 'industry', label: 'By industry', hint: 'Clients by SSIC industry', dimension: 'ssic', view: 'summary' },
  { id: 'type', label: 'By company type', hint: 'Clients by legal entity type', dimension: 'companyType', view: 'summary' },
  { id: 'source', label: 'By customer source', hint: 'Where clients came from', dimension: 'customerSource', view: 'summary' },
  { id: 'pic', label: 'By Secretary PIC', hint: 'Workload per secretary', dimension: 'pic', view: 'summary' },
];
const DEFAULT_PRESET = PRESETS[0];

const TH: React.CSSProperties = { textAlign: 'left', padding: '5px 8px', color: '#94a3b8', fontSize: 10.5, textTransform: 'uppercase' };
const STEP_LABEL: React.CSSProperties = { fontSize: 11, color: '#64748b', fontWeight: 700 };
const SELECT_STYLE: React.CSSProperties = { fontSize: 13, padding: '6px 8px', borderRadius: 7, border: '1px solid #e2e8f0', background: '#fff' };
const GUIDE_CARD: React.CSSProperties = {
  border: '1px solid #dbe7ef',
  borderRadius: 14,
  background: 'linear-gradient(180deg, #f8fcfc 0%, #ffffff 100%)',
  padding: 16,
  boxShadow: '0 8px 22px rgba(15, 23, 42, 0.04)',
};
const STEP_BADGE: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 999,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#d9f0ec',
  color: COLORS.teal,
  fontSize: 12,
  fontWeight: 900,
  flex: '0 0 auto',
};
const GUIDE_TITLE: React.CSSProperties = { fontSize: 14, fontWeight: 900, color: COLORS.ink };
const GUIDE_COPY: React.CSSProperties = { fontSize: 12.5, color: '#64748b', lineHeight: 1.45 };

function ExploreSection({ companyRows, exportHref }: { companyRows: CompanyRow[]; exportHref: string }) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [sinceFrom, setSinceFrom] = useState(DEFAULT_PRESET.sinceFrom?.() ?? '');
  const [sinceTo, setSinceTo] = useState('');
  const [dimension, setDimension] = useState<DimensionKey>(DEFAULT_PRESET.dimension);
  const [metric, setMetric] = useState<MetricKey>('count');
  const [view, setView] = useState<ExploreView>(DEFAULT_PRESET.view);
  const [presetId, setPresetId] = useState<string | null>(DEFAULT_PRESET.id);
  const [drilldown, setDrilldown] = useState<DrillDown | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // Step 3 (fine-tune) starts folded away; opened only when someone wants finer control.
  const [fineTuneOpen, setFineTuneOpen] = useState(false);

  function applyPreset(p: Preset) {
    setFilters(EMPTY_FILTERS);
    setSinceFrom(p.sinceFrom?.() ?? '');
    setSinceTo('');
    setDimension(p.dimension);
    setMetric('count');
    setView(p.view);
    setPresetId(p.id);
  }
  // Any manual change means the highlighted quick view no longer describes the screen.
  const edited = () => setPresetId(null);

  // Settings proposed by the AI helper — applied only after the user presses
  // Confirm there. Same setters as a Quick view.
  function applyPlan(plan: ExplorePlan) {
    const next: FilterState = { ...EMPTY_FILTERS };
    for (const [dim, vals] of Object.entries(plan.filters)) {
      if (vals && vals.length) next[dim as DimensionKey] = new Set(vals);
    }
    setFilters(next);
    setSinceFrom(plan.sinceFrom);
    setSinceTo(plan.sinceTo);
    setDimension(plan.dimension as DimensionKey);
    setMetric(plan.metric as MetricKey);
    setView(plan.view);
    setPresetId(null);
  }

  // Whatever the user changes, a drill-down opened for the OLD result is stale.
  useEffect(() => { setDrilldown(null); }, [filters, sinceFrom, sinceTo, dimension, metric]);

  const activeDim = DIMENSIONS.find(d => d.key === dimension)!;
  const matchesAll = (row: CompanyRow, exceptDim: DimensionKey | null) => {
    if (!matchesFilters(row, filters, exceptDim)) return false;
    if (sinceFrom || sinceTo) {
      const m = row.clientSince?.slice(0, 7);
      if (!m) return false;
      if (sinceFrom && m < sinceFrom) return false;
      if (sinceTo && m > sinceTo) return false;
    }
    return true;
  };
  const filteredRows = useMemo(() => companyRows.filter(r => matchesAll(r, null)), [companyRows, filters, sinceFrom, sinceTo]); // eslint-disable-line react-hooks/exhaustive-deps
  const metricRows = useMemo(() => metric === 'count' ? filteredRows : filteredRows.filter(r => r[metric]), [filteredRows, metric]);
  const listRows = useMemo(() => [...metricRows].sort((a, b) => (b.clientSince ?? '').localeCompare(a.clientSince ?? '') || a.companyName.localeCompare(b.companyName)), [metricRows]);

  const pivot = useMemo(() => {
    const rowsByValue = new Map<string, CompanyRow[]>();
    for (const r of metricRows) {
      const v = activeDim.value(r);
      if (!rowsByValue.has(v)) rowsByValue.set(v, []);
      rowsByValue.get(v)!.push(r);
    }
    return [...rowsByValue.entries()]
      .map(([value, rows]) => ({ value, rows, count: rows.length }))
      // Months read newest-first (a count sort would scramble the timeline);
      // "Not recorded" always last.
      .sort((a, b) => dimension === 'clientSince'
        ? (a.value === 'Not recorded' ? 1 : b.value === 'Not recorded' ? -1 : b.value.localeCompare(a.value))
        : b.count - a.count);
  }, [metricRows, activeDim, dimension]);

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
      if (!matchesAll(r, dim)) continue;
      const v = def.value(r);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()].map(([value, count]) => ({ value, count }));
  };

  // Real distinct values per dimension — all the AI helper is allowed to pick
  // from (no company names or amounts are sent).
  const assistantOptions = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const d of DIMENSIONS) {
      if (d.key === 'clientSince') continue;
      out[d.key] = [...new Set(companyRows.map(r => d.value(r)))].sort();
    }
    return out;
  }, [companyRows]);
  const assistantDimLabels = useMemo(() => Object.fromEntries(DIMENSIONS.map(d => [d.key, d.label])), []);
  function previewPlan(plan: ExplorePlan) {
    const f: FilterState = { ...EMPTY_FILTERS };
    for (const [dim, vals] of Object.entries(plan.filters)) if (vals && vals.length) f[dim as DimensionKey] = new Set(vals);
    let count = 0, notRecorded = 0;
    for (const r of companyRows) {
      if (!matchesFilters(r, f, null)) continue;
      if (plan.metric !== 'count' && !r[plan.metric as Exclude<MetricKey, 'count'>]) continue;
      if (plan.sinceFrom || plan.sinceTo) {
        const m = r.clientSince?.slice(0, 7);
        if (!m) { notRecorded++; continue; }
        if (plan.sinceFrom && m < plan.sinceFrom) continue;
        if (plan.sinceTo && m > plan.sinceTo) continue;
      }
      count++;
    }
    return { count, notRecorded };
  }

  const drillPagination = usePagination(drilldown?.rows ?? [], drilldown?.label ?? null);
  const listPagination = usePagination(listRows, `${dimension}|${metric}|${sinceFrom}|${sinceTo}|${listRows.length}`);

  // Active-filter chips: what is currently narrowing the result, each removable.
  const chips: { key: string; text: string; clear: () => void }[] = [];
  if (sinceFrom || sinceTo) {
    chips.push({ key: 'since', text: `Client Since: ${sinceFrom || 'any'} → ${sinceTo || 'now'}`, clear: () => { setSinceFrom(''); setSinceTo(''); edited(); } });
  }
  for (const d of DIMENSIONS) {
    const sel = filters[d.key];
    if (sel !== null) chips.push({ key: d.key, text: `${d.label}: ${sel.size} selected`, clear: () => { setFilters(f => ({ ...f, [d.key]: null })); edited(); } });
  }
  const clearAll = () => { setFilters(EMPTY_FILTERS); setSinceFrom(''); setSinceTo(''); edited(); };

  // Export follows the screen: posts the ids currently shown, so the file has
  // exactly the companies on screen (the old link always exported everyone).
  async function exportShown() {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(exportHref, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: metricRows.map(r => r.id) }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Tassure-Reports-${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  const sentence = `${pivotTotal} ${pivotTotal === 1 ? 'company' : 'companies'}`
    + (metric !== 'count' ? ` (${METRIC_LABELS[metric].toLowerCase()})` : '')
    + (view === 'summary' ? ` · grouped by ${activeDim.label}` : '');
  const tabStyle = (on: boolean): React.CSSProperties => ({
    fontSize: 12.5, fontWeight: 700, padding: '7px 14px', cursor: 'pointer', background: 'none', border: 'none',
    borderBottom: `2px solid ${on ? COLORS.teal : 'transparent'}`, color: on ? COLORS.ink : '#94a3b8',
  });

  return (
    <Card
      title="Explore"
      eyebrow="Custom Analysis"
      icon={<Compass size={16} />}
      note="Start with a Quick view. Want something different? Change ‘Group by’ or add filters in step 2 — the results update instantly."
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.45fr) minmax(320px, 0.75fr)', gap: 16, alignItems: 'stretch', marginBottom: 18 }}>
        <section style={GUIDE_CARD}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 14 }}>
            <span style={STEP_BADGE}>1</span>
            <div>
              <div style={GUIDE_TITLE}>Start with one ready-made question</div>
              <div style={GUIDE_COPY}>Fastest path: click a tile below. It automatically sets the view, date range, filters and result tab.</div>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 9 }}>
            {PRESETS.map(p => {
              const on = presetId === p.id;
              return (
                <button key={p.id} title={p.hint} onClick={() => applyPreset(p)}
                  style={{
                    textAlign: 'left',
                    minHeight: 70,
                    padding: '11px 12px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    border: `1px solid ${on ? COLORS.teal : '#dbe7ef'}`,
                    background: on ? COLORS.teal : '#fff',
                    color: on ? '#fff' : COLORS.ink,
                    boxShadow: on ? '0 8px 18px rgba(49, 138, 131, 0.18)' : 'none',
                  }}>
                  <div style={{ fontSize: 12.5, fontWeight: 900, marginBottom: 4 }}>{p.label}</div>
                  <div style={{ fontSize: 11.5, lineHeight: 1.35, color: on ? 'rgba(255,255,255,0.82)' : '#64748b' }}>{p.hint}</div>
                </button>
              );
            })}
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <span style={{ ...STEP_BADGE, background: '#e8eef8', color: '#1d3a5c' }}>2</span>
            <div>
              <div style={GUIDE_TITLE}>Or ask in your own words</div>
              <div style={GUIDE_COPY}>Use this when the quick tiles are not exactly what you want.</div>
            </div>
          </div>
          <ExploreAssistant options={assistantOptions} dimensionLabels={assistantDimLabels} metricLabels={METRIC_LABELS}
            preview={previewPlan} onApply={applyPlan} />
        </div>
      </div>

      <section style={{ border: '1px solid #edf2f7', background: '#fbfdff', borderRadius: 12, padding: 14, marginBottom: 16 }}>
        <button type="button" onClick={() => setFineTuneOpen(o => !o)} aria-expanded={fineTuneOpen}
          style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginBottom: fineTuneOpen || chips.length > 0 ? 12 : 0 }}>
          <span style={{ ...STEP_BADGE, background: '#f1f5f9', color: '#64748b' }}>3</span>
          <div style={{ flex: 1 }}>
            <div style={GUIDE_TITLE}>Fine-tune only if needed</div>
            <div style={GUIDE_COPY}>{fineTuneOpen ? 'After choosing a quick view or confirming an AI suggestion, these controls are optional adjustments.' : 'Click to open — group by, count, Client Since range and “Only include” filters.'}</div>
          </div>
          {fineTuneOpen ? <ChevronUp size={16} style={{ color: '#94a3b8', marginTop: 2 }} /> : <ChevronDown size={16} style={{ color: '#94a3b8', marginTop: 2 }} />}
        </button>
        {fineTuneOpen && (<>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end', marginBottom: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...STEP_LABEL }}>
            Group by
            <select value={dimension} onChange={e => { setDimension(e.target.value as DimensionKey); setView('summary'); edited(); }} style={{ ...SELECT_STYLE, minWidth: 190 }}>
              {DIMENSIONS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...STEP_LABEL }}>
            Count
            <select value={metric} onChange={e => { setMetric(e.target.value as MetricKey); edited(); }} style={{ ...SELECT_STYLE, minWidth: 230 }}>
              {METRICS.map(m => <option key={m.key} value={m.key}>{METRIC_LABELS[m.key]}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...STEP_LABEL }}>
            Client Since — from
            <input type="month" value={sinceFrom} onChange={e => { setSinceFrom(e.target.value); edited(); }} style={SELECT_STYLE} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, ...STEP_LABEL }}>
            to
            <input type="month" value={sinceTo} onChange={e => { setSinceTo(e.target.value); edited(); }} style={SELECT_STYLE} />
          </label>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: chips.length > 0 ? 10 : 0 }}>
          <span style={STEP_LABEL}>Only include:</span>
          {DIMENSIONS.filter(d => d.key !== 'clientSince').map(d => (
            <DimensionFilterMenu key={d.key} label={d.label} options={filterOptions(d.key)} selected={filters[d.key]}
              onApply={next => { setFilters(f => ({ ...f, [d.key]: next })); edited(); }} />
          ))}
        </div>
        </>)}
        {chips.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <span style={STEP_LABEL}>Active filters:</span>
            {chips.map(c => (
              <span key={c.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, background: '#fffbeb', border: '1px solid #fde68a', color: '#b45309', borderRadius: 999, padding: '3px 6px 3px 10px' }}>
                {c.text}
                <button onClick={c.clear} aria-label={`Remove ${c.text}`} style={{ display: 'flex', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0 }}><X size={12} /></button>
              </span>
            ))}
            <button onClick={clearAll} style={{ fontSize: 12, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Clear all</button>
          </div>
        )}
      </section>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '4px 0 8px' }}>
        <span style={{ ...STEP_BADGE, background: '#eef6ff', color: '#2563eb' }}>4</span>
        <div>
          <div style={GUIDE_TITLE}>Results</div>
          <div style={GUIDE_COPY}>Use the tabs to switch between the summary and the exact company list.</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid #e2e8f0', marginBottom: 14 }}>
        <button style={tabStyle(view === 'summary')} onClick={() => setView('summary')}>Summary by {activeDim.label}</button>
        <button style={tabStyle(view === 'list')} onClick={() => setView('list')}>Company list ({pivotTotal})</button>
        <span style={{ fontSize: 12, color: '#64748b' }}>{sentence}</span>
        <button onClick={() => applyPreset(DEFAULT_PRESET)} style={{ marginLeft: 'auto', fontSize: 11.5, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Reset</button>
        <button onClick={exportShown} disabled={exporting || pivotTotal === 0} title="Downloads exactly the companies counted here"
          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, color: '#fff', background: COLORS.teal, borderRadius: 7, padding: '6px 12px', border: 'none', cursor: pivotTotal === 0 ? 'not-allowed' : 'pointer', opacity: pivotTotal === 0 ? 0.5 : 1, marginBottom: 6 }}>
          <Download size={12} />{exporting ? 'Preparing…' : `Export these ${pivotTotal} (.xlsx)`}
        </button>
      </div>
      {exportError && <div style={{ fontSize: 12, color: '#b45f6b', marginBottom: 8 }}>{exportError}</div>}

      {pivotTotal === 0 ? (
        <div style={{ padding: '28px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          No companies match these filters.{' '}
          {chips.length > 0 && <button onClick={clearAll} style={{ color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Clear all filters</button>}
        </div>
      ) : view === 'list' ? (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                  {['Company', 'Client Since', 'Referred By', 'RM (Relationship Manager)', 'Customer Source'].map(h => <th key={h} style={TH}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {listPagination.pageItems.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ padding: '6px 8px' }}><Link href={`/companies/${r.id}`} style={{ color: COLORS.blue, textDecoration: 'none' }}>{r.companyName}</Link></td>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.clientSince || '—'}</td>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.referrerName || '—'}</td>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.rmName || '—'}</td>
                    <td style={{ padding: '6px 8px', color: '#64748b' }}>{customerSourceLabel(r.customerSource)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <PaginationBar page={listPagination.page} totalPages={listPagination.totalPages} total={listPagination.total} startIndex={listPagination.startIndex} pageCount={listPagination.pageItems.length} onPage={listPagination.setPage} />
        </>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,1fr) minmax(260px,1.3fr)', gap: 24, alignItems: 'start' }}>
            <div>{pivot.length <= 8 ? <Donut segments={chartData} size={160} thickness={24} /> : <HBars data={chartData} accent={COLORS.teal} labelWidth={140} />}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <th style={TH}>{activeDim.label}</th>
                    <th style={{ ...TH, textAlign: 'right' }}>{metric === 'count' ? 'Companies' : METRIC_LABELS[metric]}</th>
                    <th style={{ ...TH, textAlign: 'right' }}>% of results</th>
                    <th style={{ ...TH, textAlign: 'right' }} />
                  </tr>
                </thead>
                <tbody>
                  {pivot.map(p => (
                    <tr key={p.value} onClick={() => setDrilldown({ label: p.value, rows: p.rows })}
                      style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: drilldown?.label === p.value ? '#f1f5f9' : 'transparent' }}
                      onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={e => (e.currentTarget.style.background = drilldown?.label === p.value ? '#f1f5f9' : 'transparent')}>
                      <td style={{ padding: '6px 8px', color: '#334155' }}>{p.value}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: COLORS.ink }}>{p.count}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: '#94a3b8' }}>{pivotTotal ? Math.round((p.count / pivotTotal) * 100) : 0}%</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', color: COLORS.blue, fontSize: 11.5, whiteSpace: 'nowrap' }}>View companies →</td>
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
                      {['Company', 'UEN', 'Client Since', 'Referred By', 'RM (Relationship Manager)'].map(h => <th key={h} style={TH}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {drillPagination.pageItems.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <Link href={`/companies/${r.id}`} style={{ color: COLORS.blue, textDecoration: 'none' }}>{r.companyName}</Link>
                        </td>
                        <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.uen || '—'}</td>
                        <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.clientSince || '—'}</td>
                        <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.referrerName || '—'}</td>
                        <td style={{ padding: '6px 8px', color: '#64748b' }}>{r.rmName || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <PaginationBar page={drillPagination.page} totalPages={drillPagination.totalPages} total={drillPagination.total} startIndex={drillPagination.startIndex} pageCount={drillPagination.pageItems.length} onPage={drillPagination.setPage} />
            </div>
          )}
        </>
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
  // Defaults to English (2026-09-23, Vincent: "这部分显示以英文为先，用户
  // 有需要才自行切换成中文") — users switch to Chinese themselves if needed.
  const [narrativeLang, setNarrativeLang] = useState<'zh' | 'en'>('en');
  const [narrativeLoading, setNarrativeLoading] = useState(true);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);
  // Separate from narrativeLoading (the initial page-load fetch) — a manual
  // regenerate is a much longer wait (computeReportsData + a real OpenAI
  // call, up to ~2 minutes) and needs its own spinner state so the initial
  // load's brief flash doesn't get confused with it.
  const [narrativeRegenerating, setNarrativeRegenerating] = useState(false);
  // 2026-09-23, Vincent: "不喜欢这个板块的暗色显示...并且是可以收起的" —
  // collapsible, not persisted across reloads (component state only, same
  // as components/NDPersonCard.tsx's own expand/collapse — no stated need
  // to remember it between visits).
  const [narrativeCollapsed, setNarrativeCollapsed] = useState(false);

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
  // Reuses REPORT_COLORS' own muted/desaturated family (teal/gold/rose)
  // instead of the brighter mint/amber/coral this card used on its old
  // dark background — those read fine as light text on navy, but as text
  // on white they're too pale for real contrast; the existing palette
  // already has readable, on-brand equivalents for exactly these 3 signals.
  const SIGNAL_STYLE: Record<NarrativeInsight['signal'], { color: string; bg: string; labelZh: string; labelEn: string }> = {
    good: { color: COLORS.teal, bg: 'rgba(57,127,120,.1)', labelZh: '健康', labelEn: 'Good' },
    watch: { color: COLORS.gold, bg: 'rgba(185,130,67,.12)', labelZh: '关注', labelEn: 'Watch' },
    warning: { color: COLORS.rose, bg: 'rgba(180,95,107,.1)', labelZh: '风险', labelEn: 'Warning' },
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

      {/* Light theme + collapsible, 2026-09-23 — Vincent: "不喜欢这个板块的
          暗色显示，一个是要Light的UI的，并且是可以收起的". Same light-card
          look as the Card component above instead of the dark navy
          gradient this used to have — every text/accent color below was
          re-picked for readability on white, not just inverted. */}
      <section style={{ background: 'rgba(255,255,255,.96)', borderRadius: 16, border: '1px solid #dfe7ec', boxShadow: '0 10px 32px rgba(28,52,73,.045)', padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: narrativeCollapsed ? 0 : 16 }}>
          <span style={{ width: 30, height: 30, borderRadius: 9, background: '#edf4f3', color: COLORS.teal, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Sparkles size={15} />
          </span>
          <button onClick={() => setNarrativeCollapsed(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 750, letterSpacing: '-.01em', color: COLORS.ink, background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            {narrativeLang === 'zh' ? 'AI 分析 — 本期观察' : 'AI Analysis — This Period'}
            {narrativeCollapsed ? <ChevronDown size={14} style={{ color: '#94a3b8' }} /> : <ChevronUp size={14} style={{ color: '#94a3b8' }} />}
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Both languages already sit in the one fetched object (see
                lib/reports-narrative.ts) — this only ever flips which field
                renders, never triggers a second request. */}
            <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 7, padding: 2 }}>
              {(['zh', 'en'] as const).map(l => (
                <button key={l} onClick={() => setNarrativeLang(l)}
                  style={{ fontSize: 10.5, fontWeight: 700, padding: '4px 9px', borderRadius: 5, border: 'none', cursor: 'pointer',
                    background: narrativeLang === l ? '#fff' : 'transparent', color: narrativeLang === l ? COLORS.ink : '#64748b',
                    boxShadow: narrativeLang === l ? '0 1px 3px rgba(28,52,73,.12)' : 'none' }}>
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
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: COLORS.ink, background: '#f1f5f9', border: 'none', borderRadius: 7, padding: '5px 10px', cursor: narrativeRegenerating ? 'default' : 'pointer' }}>
                <RefreshCw size={11} style={{ animation: narrativeRegenerating ? 'spin 1s linear infinite' : 'none' }} />
                {narrativeRegenerating ? (narrativeLang === 'zh' ? '生成中…' : 'Working…') : (narrativeLang === 'zh' ? '重新生成' : 'Refresh')}
              </button>
            )}
          </div>
        </div>
        {!narrativeCollapsed && narrativeError && (
          <div style={{ fontSize: 12.5, color: COLORS.rose, lineHeight: 1.6 }}>{narrativeError}</div>
        )}
        {!narrativeCollapsed && !narrativeError && narrativeLoading && (
          <div style={{ fontSize: 12.5, color: '#94a3b8' }}>{narrativeLang === 'zh' ? '加载中…' : 'Loading…'}</div>
        )}
        {!narrativeCollapsed && !narrativeError && !narrativeLoading && !narrative && (
          <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
            {narrativeLang === 'zh' ? '分析将于下周一早上6点（新加坡时间）生成，请稍候。' : 'Analysis will be generated next Monday at 6am SGT.'}
          </div>
        )}
        {!narrativeCollapsed && !narrativeError && narrative && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {narrative.insights.map((ins, i) => {
                const s = SIGNAL_STYLE[ins.signal];
                const c = CONFIDENCE_LABEL[ins.confidence];
                const driver = narrativeLang === 'zh' ? ins.driverZh : ins.driverEn;
                const notYetProven = narrativeLang === 'zh' ? ins.notYetProvenZh : ins.notYetProvenEn;
                return (
                  <div key={i} style={{ display: 'flex', gap: 12, padding: '12px 14px', borderRadius: 10, background: '#f8fafc', borderLeft: `3px solid ${s.color}` }}>
                    <span style={{ flexShrink: 0, height: 20, padding: '0 8px', borderRadius: 999, background: s.bg, color: s.color, fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', letterSpacing: '.02em' }}>
                      {narrativeLang === 'zh' ? s.labelZh : s.labelEn}
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.ink }}>{narrativeLang === 'zh' ? ins.titleZh : ins.titleEn}</span>
                        {/* Confidence is metadata, not a visual centerpiece —
                            dashboard-design skill's own "do not overuse
                            confidence badges visually" guidance. */}
                        <span style={{ fontSize: 9.5, fontWeight: 700, color: '#94a3b8', border: '1px solid #e2e8f0', borderRadius: 999, padding: '1px 7px' }}>
                          {narrativeLang === 'zh' ? c.zh : c.en}
                        </span>
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.7, color: '#475569' }}>{narrativeLang === 'zh' ? ins.observedZh : ins.observedEn}</div>
                      {driver && (
                        <div style={{ fontSize: 12, lineHeight: 1.7, color: '#64748b', marginTop: 5 }}>
                          <span style={{ fontWeight: 700, color: '#94a3b8' }}>{narrativeLang === 'zh' ? '推测 · ' : 'Driver · '}</span>{driver}
                        </div>
                      )}
                      {notYetProven.length > 0 && (
                        <div style={{ fontSize: 11.5, lineHeight: 1.7, color: '#94a3b8', marginTop: 5 }}>
                          <span style={{ fontWeight: 700, color: '#94a3b8' }}>{narrativeLang === 'zh' ? '尚未证实 · ' : 'Not yet proven · '}</span>
                          {notYetProven.join(' / ')}
                        </div>
                      )}
                      <div style={{ fontSize: 12, lineHeight: 1.7, color: COLORS.teal, marginTop: 6 }}>
                        <span style={{ fontWeight: 700 }}>{narrativeLang === 'zh' ? '下一步 · ' : 'Next · '}</span>
                        {narrativeLang === 'zh' ? ins.nextActionZh : ins.nextActionEn}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #f1f5f9', fontSize: 11, lineHeight: 1.6, color: '#94a3b8' }}>
              {narrativeLang === 'zh' ? narrative.summaryZh : narrative.summaryEn}
            </div>
            <div style={{ marginTop: 8, fontSize: 10.5, color: '#94a3b8' }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
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
      </div>

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
      <RevenuePerformanceCard yoy={data.revenue.comparableYoy} />

      <Card title="Revenue by Year" eyebrow="Billing" icon={<Wallet size={16} />} note={data.notes.revenue}>
        {/* revenueTrendThousands stores dollars/1000 (lib/reports-data.ts's
            own computeRevenueTrend) — unitScale multiplies it back to real
            dollars before formatting, so this reads "S$1.28M", not "1284". */}
        <VBars data={data.revenue.revenueTrendThousands} color={COLORS.gold} height={260}
          valueFormatter={v => formatCompactCurrency(v, { unitScale: 1000 })} />
      </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(340px,1fr))', gap: 16 }}>
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
      </div>

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
