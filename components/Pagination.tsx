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

// Vincent, 2026-09-23: "当我在看到第1页的最下方点击去第2页的时候，应该是
// 要显示第2页的第一行的，而不是第2页的下方行，这个要全系统都是这样处理分
// 页" — changing page must always land on that new page's own top row, never
// wherever the previous page happened to be scrolled to. Fixed once, here,
// rather than at each of PaginationBar's ~9 call sites (MasterListTable,
// AR Reminder, SOA, Master List/Active Client, Reports, TAO, Late Filing,
// Address Service, Companies) — every one of them renders through this
// shared component, so this is the single point that actually covers "全系
// 统". Walks up from the clicked button to find the nearest ancestor that's
// ACTUALLY scrolling (scrollHeight > clientHeight) and resets its scrollTop
// — deliberately not a fixed class-name lookup (e.g. '.system-list-scroll'),
// since not every page that renders this bar uses that exact class, and a
// generic DOM walk keeps working regardless. Falls back to the window/page
// scroll for a list with no scrollable ancestor of its own.
function scrollPageToTop(button: HTMLElement) {
  // Stop at <body> rather than checking it: in standards mode the
  // document's own scroll is owned by <html>/`window`, not `body.scrollTop`
  // (setting that silently no-ops in most browsers), so treat reaching body
  // as "no specific scrollable ancestor" and fall through to window.scrollTo.
  let node: HTMLElement | null = button;
  while (node && node !== document.body) {
    if (node.scrollHeight > node.clientHeight + 1) {
      node.scrollTop = 0;
      return;
    }
    node = node.parentElement;
  }
  window.scrollTo({ top: 0 });
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
  const goToPage = (p: number, e: React.MouseEvent<HTMLButtonElement>) => {
    scrollPageToTop(e.currentTarget);
    onPage(p);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, padding: '10px 4px 2px' }}>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>
        Showing {startIndex + 1}–{startIndex + pageCount} of {total}
      </span>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
        <button style={btn(false, page <= 1)} disabled={page <= 1} onClick={e => goToPage(page - 1, e)}>‹</button>
        {pageList(page, totalPages).map((p, i) =>
          p === '…'
            ? <span key={`e${i}`} style={{ fontSize: 12, color: '#94a3b8', padding: '0 2px' }}>…</span>
            : <button key={p} style={btn(p === page)} onClick={e => goToPage(p, e)}>{p}</button>
        )}
        <button style={btn(false, page >= totalPages)} disabled={page >= totalPages} onClick={e => goToPage(page + 1, e)}>›</button>
      </div>
    </div>
  );
}
