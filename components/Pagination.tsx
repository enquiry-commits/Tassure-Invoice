'use client';

import { useState, useMemo, useCallback, type Dispatch, type SetStateAction } from 'react';

export const PAGE_SIZE = 100;

// Client-side pagination over an ALREADY-FILTERED list. Search/filters must be
// applied to the full dataset BEFORE this hook, so a search always scans
// everything — pagination only limits what gets rendered to the DOM.
// `resetKey`: change it (search text, filter, month…) to jump back to page 1.
export function usePagination<T>(items: T[], resetKey: unknown, pageSize = PAGE_SIZE) {
  const [pageState, setPageState] = useState({ page: 1, resetKey });
  const page = Object.is(pageState.resetKey, resetKey) ? pageState.page : 1;
  const setPage: Dispatch<SetStateAction<number>> = useCallback(next => {
    setPageState(current => {
      const currentPage = Object.is(current.resetKey, resetKey) ? current.page : 1;
      return {
        resetKey,
        page: typeof next === 'function' ? next(currentPage) : next,
      };
    });
  }, [resetKey]);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages); // clamp when the list shrinks
  const startIndex = (safePage - 1) * pageSize;
  const pageItems = useMemo(
    () => items.slice(startIndex, startIndex + pageSize),
    [items, startIndex, pageSize],
  );
  return { page: safePage, setPage, totalPages, pageItems, startIndex, total: items.length };
}

// Numbered page buttons with ellipsis: 1 … 4 [5] 6 … 12
function pageList(page: number, totalPages: number): (number | '…')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set<number>([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages].filter(p => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  let prev = 0;
  for (const p of sorted) {
    if (p - prev > 1) out.push('…');
    out.push(p);
    prev = p;
  }
  return out;
}

export function PaginationBar({ page, totalPages, total, startIndex, pageCount, onPage }: {
  page: number; totalPages: number; total: number; startIndex: number; pageCount: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  const btn = (active = false, disabled = false): React.CSSProperties => ({
    minWidth: 30, height: 30, padding: '0 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    border: `1px solid ${active ? '#1d3a5c' : '#e2e8f0'}`,
    background: active ? '#1d3a5c' : '#fff',
    color: active ? '#fff' : disabled ? '#cbd5e1' : '#475569',
    cursor: disabled ? 'default' : 'pointer',
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: '10px 4px 2px' }}>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>
        Showing {startIndex + 1}–{startIndex + pageCount} of {total}
      </span>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button style={btn(false, page <= 1)} disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
        {pageList(page, totalPages).map((p, i) =>
          p === '…'
            ? <span key={`e${i}`} style={{ fontSize: 12, color: '#94a3b8', padding: '0 2px' }}>…</span>
            : <button key={p} style={btn(p === page)} onClick={() => onPage(p)}>{p}</button>
        )}
        <button style={btn(false, page >= totalPages)} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>›</button>
      </div>
    </div>
  );
}
