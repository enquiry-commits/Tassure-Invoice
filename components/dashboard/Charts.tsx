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
