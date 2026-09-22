'use client';

// Rebuilt on Recharts 2026-09-22 — Vincent's dashboard upgrade package
// ("现在部分图表看起来像开发者原型，不是专业的B2B SaaS产品"). Previously a
// fully hand-rolled SVG/flex chart library (no charting dependency at all)
// — real bugs shipped from that (see the 2026-09-22 LineChart aspect-ratio
// fix this file's own git history carries), and every chart looked
// slightly different because every chart re-implemented its own axes/
// tooltips/scaling by hand.
//
// EVERY exported name and prop shape below is UNCHANGED from the old
// hand-rolled version on purpose — app/page.tsx (Dashboard), app/reports/
// page.tsx (Reports), and app/activity-insights/page.tsx all import these
// by name with no changes needed; only the internals moved to Recharts.
// New OPTIONAL props were added where a caller needs proper number
// formatting (e.g. currency already expressed in thousands) — every
// existing call site still works with its defaults.
import {
  ResponsiveContainer, BarChart, Bar, LineChart as RLineChart, Line,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { formatCompactNumber } from '@/lib/chart-format';

// value: null means "no data collected for this point" (Reports V3 spec,
// "Missing Data Is Not Zero") — genuinely different from a real 0, and must
// never be drawn as one. Real example this fixes: quickbooks_invoices has
// no rows before 2024-01-02, so a 5-year trend chart reaching back to 2022
// was drawing a flat 0 line for 2022/2023 instead of a gap with no data
// collected — a reader has no way to tell "zero invoices that year" apart
// from "we don't have data for that year" from a 0 alone.
type Pt = { label: string; value: number | null; color?: string };

function EmptyState({ height }: { height: number }) {
  return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 }}>
      No data for this period.
    </div>
  );
}

// Shared tooltip shape across every chart below — Period/Category, Metric
// name, Formatted value (dashboard-design skill's own Tooltip spec).
function ChartTooltip({ active, payload, label, valueFormatter }: {
  active?: boolean; label?: string;
  payload?: { name?: string; value?: number | null; color?: string; payload?: Pt }[];
  valueFormatter: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 11px', boxShadow: '0 8px 24px rgba(15,23,42,.12)', fontSize: 12 }}>
      {label && <div style={{ fontWeight: 750, color: '#1e3a5f', marginBottom: payload.length > 1 ? 4 : 2 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#475569' }}>
          {p.color && <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />}
          <span>{p.name ?? p.payload?.label}</span>
          <span style={{ marginLeft: 'auto', paddingLeft: 10, fontWeight: 700, color: p.value == null ? '#94a3b8' : '#1e3a5f' }}>
            {p.value == null ? 'No data' : valueFormatter(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Vertical bar chart ───────────────────────────────────────────────────
export function VBars({ data, color = '#0f766e', height = 220, valueFormatter = formatCompactNumber }: {
  data: Pt[]; color?: string; height?: number; valueFormatter?: (v: number) => string;
}) {
  if (!data.length) return <EmptyState height={height} />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="#eef2f7" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={44} tickFormatter={formatCompactNumber} allowDecimals={false} />
        <Tooltip cursor={{ fill: '#f8fafc' }} content={<ChartTooltip valueFormatter={valueFormatter} />} />
        {/* A null value renders as no bar at all (height 0, invisible) —
            correct: it must never look like a real zero-height bar. The
            X-axis label for that slot is still shown, so the gap itself
            (rather than a phantom flat bar) is what communicates "no data
            collected here", per the "Missing Data Is Not Zero" rule. */}
        <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={44}>
          {data.map((d, i) => <Cell key={i} fill={d.value == null ? 'transparent' : (d.color ?? color)} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ── Donut chart with legend ──────────────────────────────────────────────
export function Donut({ segments: rawSegments, size = 168, thickness = 26 }: { segments: Pt[]; size?: number; thickness?: number }) {
  // Composition charts have no "missing" segment concept the way a time
  // series does — a null-value category is simply excluded, not shown as
  // a 0-width slice.
  const segments = rawSegments.filter((s): s is Pt & { value: number } => s.value != null);
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return <EmptyState height={size} />;
  const outerR = size / 2;
  const innerR = outerR - thickness;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <ResponsiveContainer width={size} height={size}>
          <PieChart>
            <Pie data={segments} dataKey="value" nameKey="label" cx="50%" cy="50%" innerRadius={innerR} outerRadius={outerR} startAngle={90} endAngle={-270} stroke="#fff" strokeWidth={2}>
              {segments.map((s, i) => <Cell key={i} fill={s.color} />)}
            </Pie>
            <Tooltip content={<ChartTooltip valueFormatter={formatCompactNumber} />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ fontSize: 26, fontWeight: 800, color: '#1e3a5f', lineHeight: 1 }}>{formatCompactNumber(total)}</span>
          <span style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 3 }}>total</span>
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
        {segments.map((s, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: s.color, flexShrink: 0 }} />
            <span style={{ color: '#475569', minWidth: 88 }}>{s.label}</span>
            <span style={{ fontWeight: 700, color: '#1e3a5f' }}>{s.value}</span>
            <span style={{ color: '#94a3b8', fontSize: 11 }}>{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Multi-series line chart ──────────────────────────────────────────────
// A data point of `null` breaks the line at that point (Recharts' default
// — connectNulls is NOT set, so it never draws through a gap) instead of
// coercing to 0, same "Missing Data Is Not Zero" rule as VBars above.
export type LineSeries = { label: string; color: string; data: (number | null)[] };
export function LineChart({ labels, series, height = 260, valueFormatter = formatCompactNumber }: {
  labels: string[]; series: LineSeries[]; height?: number; valueFormatter?: (v: number) => string;
}) {
  if (!labels.length || !series.some(s => s.data.length)) return <EmptyState height={height} />;
  const rows = labels.map((label, i) => {
    const row: Record<string, string | number | null> = { label };
    for (const s of series) row[s.label] = s.data[i] ?? null;
    return row;
  });
  // Small point count (this app's charts are always yearly — typically
  // 4-6 points) means real dots per-point are useful (individual values
  // matter, dashboard-design skill's own "Line Rules"); a denser series
  // would drop them, but nothing in this app currently has that shape.
  const showDots = labels.length <= 12;
  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
        {series.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#475569' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />{s.label}
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <RLineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#eef2f7" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={{ stroke: '#e2e8f0' }} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} width={44} tickFormatter={formatCompactNumber} allowDecimals={false} />
          <Tooltip content={<ChartTooltip valueFormatter={valueFormatter} />} />
          {series.map(s => (
            <Line key={s.label} type="monotone" dataKey={s.label} stroke={s.color} strokeWidth={2.5}
              dot={showDots ? { r: 4, fill: s.color, stroke: '#fff', strokeWidth: 1.5 } : false}
              activeDot={{ r: 6, fill: s.color, stroke: '#fff', strokeWidth: 1.5 }} />
          ))}
        </RLineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Horizontal bars (rankings, long category names) ──────────────────────
export function HBars({ data: rawData, accent = '#1d4ed8', labelWidth = 130, valueFormatter = formatCompactNumber }: {
  data: Pt[]; accent?: string; labelWidth?: number; valueFormatter?: (v: number) => string;
}) {
  // Same reasoning as Donut above — a ranking has no meaningful "missing"
  // row to draw.
  const data = rawData.filter((d): d is Pt & { value: number } => d.value != null);
  if (!data.length) return <EmptyState height={40} />;
  const height = Math.max(60, data.length * 34);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 28, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid horizontal={false} stroke="#eef2f7" />
        <XAxis type="number" hide tickFormatter={formatCompactNumber} />
        <YAxis type="category" dataKey="label" width={labelWidth} tick={{ fontSize: 12, fill: '#475569' }} tickLine={false} axisLine={false}
          tickFormatter={(v: string) => v.length > 22 ? `${v.slice(0, 21)}…` : v} />
        <Tooltip cursor={{ fill: '#f8fafc' }} content={<ChartTooltip valueFormatter={valueFormatter} />} />
        <Bar dataKey="value" radius={[0, 5, 5, 0]} maxBarSize={18} label={{ position: 'right', fontSize: 12, fontWeight: 700, fill: '#1e3a5f', formatter: (v: unknown) => valueFormatter(Number(v) || 0) }}>
          {data.map((d, i) => <Cell key={i} fill={d.color ?? accent} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
