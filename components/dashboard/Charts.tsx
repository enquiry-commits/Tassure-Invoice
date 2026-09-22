'use client';

import { useState } from 'react';

type Pt = { label: string; value: number; color?: string };

// ── Vertical bar chart (HTML/flex — responsive, hover-highlight) ────────────
export function VBars({ data, color = '#0f766e', height = 190 }: { data: Pt[]; color?: string; height?: number }) {
  const max = Math.max(1, ...data.map(d => d.value));
  const [hi, setHi] = useState<number | null>(null);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height }}>
        {data.map((d, i) => (
          <div key={i} onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: hi === i ? color : '#64748b', marginBottom: 4, opacity: d.value ? 1 : 0.35 }}>{d.value}</div>
            <div style={{ width: '66%', maxWidth: 40, height: `${(d.value / max) * 100}%`, minHeight: d.value ? 3 : 0,
              background: hi === i ? color : `${color}cc`, borderRadius: '5px 5px 0 0', transition: 'background .15s, filter .15s',
              filter: hi === i ? 'brightness(1.05)' : 'none' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
        {data.map((d, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: hi === i ? '#1e3a5f' : '#94a3b8', fontWeight: hi === i ? 700 : 500 }}>{d.label}</div>
        ))}
      </div>
    </div>
  );
}

// ── Donut chart with legend (SVG) ──────────────────────────────────────────
export function Donut({ segments, size = 168, thickness = 26 }: { segments: Pt[]; size?: number; thickness?: number }) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="#f1f5f9" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const frac = s.value / total;
          const el = (
            <circle key={i} cx={c} cy={c} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${frac * circ} ${circ - frac * circ}`} strokeDashoffset={-acc * circ}
              transform={`rotate(-90 ${c} ${c})`} />
          );
          acc += frac;
          return el;
        })}
        <text x={c} y={c - 2} textAnchor="middle" fontSize={30} fontWeight={800} fill="#1e3a5f">{total}</text>
        <text x={c} y={c + 17} textAnchor="middle" fontSize={11} fill="#94a3b8">total</text>
      </svg>
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

// ── Line chart, 1+ series (SVG, same hand-rolled convention as the charts
//    above — no charting library dependency anywhere in this file) ─────────
// Added 2026-09-22 — Vincent, on Reports only ever using bars: "为什么只有
// 柱状图...我需要你参考后找出适合我们的" (pointing at a chart-type-selection
// reference article). That article's own core distinction (its 趋势/对比
// framing) is exactly why this exists: New-vs-Churned and Average Invoice
// Value are genuinely TIME-SERIES data (a value changing across ordered
// years), which a line reads as a trend at a glance — a bar chart can only
// ever read as per-year comparison, never the shape of the trend between
// them.
// Rebuilt same day, round 2 — Vincent: "这个图形做的很别扭" (a real bug, not
// a style nitpick): the viewBox mixed a 100-unit-wide X axis with a
// 190-PIXEL-tall Y axis, then `preserveAspectRatio="none"` stretched X by
// ~7-9x while leaving Y untouched — circles (radius scales with the box)
// rendered as squashed ellipses, while lines (forced constant-width via
// `vector-effect="non-scaling-stroke"`) rendered as near-invisible
// hairlines completely out of proportion with those same circles. Fixed by
// giving X and Y the SAME unit scale and dropping the "none" override so
// nothing stretches unevenly, plus a design-guidance pass (mark specs: 2px
// line stroke, round joins, ≥8px-diameter end markers with a white ring —
// this app's own compact-dashboard scale, not the guide's own literal
// pixel numbers, which are calibrated for a larger standalone widget).
// Also fixed real x-axis misalignment: points used to sit at `i/(n-1)`
// (edge-to-edge — first point flush left, last flush right) while the
// label row below used equal flex columns (each label CENTERED in its own
// 1/n-wide slot) — two different position systems that never agreed. Both
// now use the same `(i+0.5)/n` center-of-slot formula.
export type LineSeries = { label: string; color: string; data: number[] };
const LINE_VB_W = 500;
export function LineChart({ labels, series, height = 190 }: { labels: string[]; series: LineSeries[]; height?: number }) {
  const [hi, setHi] = useState<number | null>(null);
  const max = Math.max(1, ...series.flatMap(s => s.data));
  const padY = 16;
  const n = Math.max(labels.length, 1);
  const x = (i: number) => ((i + 0.5) / n) * LINE_VB_W;
  const y = (v: number) => height - padY - (v / max) * (height - padY * 2);

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 10 }}>
        {series.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#475569' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.color, flexShrink: 0 }} />{s.label}
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 ${LINE_VB_W} ${height}`} width="100%" height={height}>
        <line x1={0} y1={height - padY} x2={LINE_VB_W} y2={height - padY} stroke="#e2e8f0" strokeWidth={1} />
        {hi !== null && (
          <line x1={x(hi)} y1={4} x2={x(hi)} y2={height - padY} stroke="#e2e8f0" strokeWidth={1} strokeDasharray="3 3" />
        )}
        {series.map(s => (
          <g key={s.label}>
            <polyline points={s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
              fill="none" stroke={s.color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {s.data.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={hi === i ? 6 : 4} fill={s.color} stroke="#fff" strokeWidth={1.5}
                onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)} style={{ cursor: 'default' }} />
            ))}
          </g>
        ))}
      </svg>
      <div style={{ display: 'flex', marginTop: 7 }}>
        {labels.map((l, i) => (
          <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: hi === i ? '#1e3a5f' : '#94a3b8', fontWeight: hi === i ? 700 : 500 }}
            onMouseEnter={() => setHi(i)} onMouseLeave={() => setHi(null)}>
            {l}
            {hi === i && (
              <div style={{ fontSize: 9.5, color: '#64748b', marginTop: 1 }}>
                {series.map(s => <div key={s.label}>{s.data[i]}</div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Horizontal bars ────────────────────────────────────────────────────────
export function HBars({ data, accent = '#1d4ed8', labelWidth = 130 }: { data: Pt[]; accent?: string; labelWidth?: number }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {data.map((d, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: labelWidth, fontSize: 12, color: '#475569', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={d.label}>{d.label}</div>
          <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 6, height: 18, overflow: 'hidden' }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: d.color ?? accent, borderRadius: 6, transition: 'width .4s ease' }} />
          </div>
          <div style={{ width: 34, textAlign: 'right', fontWeight: 700, fontSize: 12.5, color: '#1e3a5f' }}>{d.value}</div>
        </div>
      ))}
    </div>
  );
}
