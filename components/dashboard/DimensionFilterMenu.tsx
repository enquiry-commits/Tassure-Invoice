'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Filter } from 'lucide-react';

// Reports-scoped filter menu (2026-09-03) — reimplements the exact
// interaction from components/MasterListTable.tsx's own `ColumnFilterMenu`
// (funnel icon -> popover -> search box -> checkbox list with per-value
// counts -> Select All/Clear -> Cancel/OK), not a straight export of it.
// That component is private to MasterListTable and keyed to its own row
// shape/field enum; Reports' five dimensions don't share that shape, so
// this takes pre-computed {value,count} options directly instead, kept
// local to the Reports "Explore" section rather than promoted to a
// system-wide primitive for a single caller.
export type FilterOption = { value: string; count: number };

export function DimensionFilterMenu({ label, options, selected, onApply }: {
  label: string; options: FilterOption[];
  selected: Set<string> | null; onApply: (next: Set<string> | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Set<string> | null>(selected);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (open) { setDraft(selected); setSearch(''); } }, [open, selected]);
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const sorted = useMemo(() => [...options].sort((a, b) => a.value.localeCompare(b.value)), [options]);
  const filtered = search ? sorted.filter(o => o.value.toLowerCase().includes(search.toLowerCase())) : sorted;
  const isChecked = (v: string) => draft === null || draft.has(v);
  const toggle = (v: string) => setDraft(prev => {
    const base = prev === null ? new Set(sorted.map(o => o.value)) : new Set(prev);
    if (base.has(v)) base.delete(v); else base.add(v);
    return base.size === sorted.length ? null : base;
  });
  const active = selected !== null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={e => { e.stopPropagation(); setOpen(v => !v); }} title={`Filter ${label}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 5, border: `1px solid ${active ? '#fde68a' : '#e2e8f0'}`,
          background: active ? '#fffbeb' : '#fff', color: active ? '#b45309' : '#475569',
          borderRadius: 7, padding: '5px 9px', cursor: 'pointer', fontSize: 11.5, fontWeight: 600,
        }}>
        <Filter size={11} fill={active ? 'currentColor' : 'none'} />
        {label}{active && selected ? ` (${selected.size})` : ''}
      </button>
      {open && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 30, background: '#fff',
          border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 230, padding: 8,
        }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search values…"
            style={{ width: '100%', border: '1px solid #e2e8f0', borderRadius: 5, padding: '4px 6px', fontSize: 11, marginBottom: 6, outline: 'none', color: '#1e293b', boxSizing: 'border-box' }} />
          <div style={{ display: 'flex', gap: 10, marginBottom: 6 }}>
            <button onClick={() => setDraft(null)} style={{ fontSize: 10, color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Select All</button>
            <button onClick={() => setDraft(new Set())} style={{ fontSize: 10, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 700 }}>Clear</button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9', padding: '4px 0' }}>
            {filtered.length === 0 ? (
              <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px 2px' }}>No values</div>
            ) : filtered.map(o => (
              <label key={o.value} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 2px', fontSize: 11, cursor: 'pointer' }}>
                <input type="checkbox" checked={isChecked(o.value)} onChange={() => toggle(o.value)} style={{ width: 12, height: 12, cursor: 'pointer', flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={o.value}>{o.value}</span>
                <span style={{ color: '#94a3b8', fontSize: 9.5, flexShrink: 0 }}>{o.count}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => setOpen(false)} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px solid #e2e8f0', background: '#fff', color: '#64748b', cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => { onApply(draft); setOpen(false); }} style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: 'none', background: '#1d3a5c', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
