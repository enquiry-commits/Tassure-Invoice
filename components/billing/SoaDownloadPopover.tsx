'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import type { QbCompany } from '@/lib/quickbooks';
import { downloadSoaPdf, type SoaCompanySelector } from '@/lib/soa-actions-client';

/**
 * Extracted 2026-09-18 from app/billing/soa/_components.tsx's SoaDetail —
 * Vincent then asked for the exact same "All" download button on Company
 * 360's Outstanding table too: "复制这个 Download SOA PDF 的按钮，但是是All
 * 的版本" (copy this exact button, the All version) — a second,
 * independently-styled copy of this popover would be exactly the kind of
 * drift lib/soa-actions-client.ts's own header warns about (see
 * lib/company-name.ts's four divergent matchers), so this file exists
 * purely so both places render the SAME component.
 */

// Canonical display order — QbCompany's own declared union order, not
// whatever order a book happens to appear in some invoices list.
export const BOOK_ORDER: QbCompany[] = ['TAB', 'TAC', 'TAO'];

/**
 * The picker itself: each book with a real balance as its own one-click
 * download, plus an explicitly-labeled combined option when there's more
 * than one (Vincent: "再优化一点就是点击下载 TAB / TAO / All (TAB+TAO)").
 * Caller owns fetching `books` and performing the actual download
 * (`onDownload`) — this component only renders the choice.
 */
export function SoaDownloadPopover({
  books, downloading, isOpen, onOpenChange, onDownload, openUpward,
}: {
  books: QbCompany[]; downloading: boolean;
  isOpen: boolean; onOpenChange: (open: boolean) => void;
  onDownload: (book: SoaCompanySelector) => void;
  // SoaDetail's own modal has `overflow: hidden`, so its button (fixed at
  // the bottom of the modal) needs the popover to open UPWARD or it clips
  // almost entirely — same reasoning as SoaDraftPopover's 'button' variant
  // right next to it. A plain table row (Company 360's Outstanding) has no
  // such ancestor, so the default (downward) is the normal dropdown feel.
  openUpward?: boolean;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [isOpen, onOpenChange]);

  const pick = (book: SoaCompanySelector) => { onOpenChange(false); onDownload(book); };
  const disabled = downloading || !books.length;

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }} onClick={e => e.stopPropagation()}>
      <button onClick={() => onOpenChange(!isOpen)} disabled={disabled}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#334155', fontSize: 13, fontWeight: 700, cursor: disabled ? 'default' : 'pointer' }}>
        {downloading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={14} />}
        {downloading ? 'Downloading…' : 'Download SOA PDF'}
      </button>
      {isOpen && (
        <div ref={popoverRef} style={{
          position: 'absolute', right: 0, zIndex: 30, background: '#fff',
          ...(openUpward ? { bottom: '100%', marginBottom: 4 } : { top: '100%', marginTop: 4 }),
          border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 200, padding: 6,
        }}>
          {books.map(book => (
            <button key={book} onClick={() => pick(book)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: 'none', background: 'none', fontSize: 12.5, fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
              {book}
            </button>
          ))}
          {books.length > 1 && (
            <>
              <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />
              <button onClick={() => pick('ALL')}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 6, border: 'none', background: 'none', fontSize: 12.5, fontWeight: 700, color: '#0f766e', cursor: 'pointer' }}>
                All ({books.join('+')})
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Self-contained "All" download button for callers with no invoices list
 * already loaded — just a company name. Company 360's Outstanding table
 * (app/companies/[id]/_components.tsx) renders one per row (one row per
 * book that company owes on), each fetching the same books-with-balance
 * list independently — a little redundant when 2 rows are the same
 * company, but this table only ever shows a handful of rows per company
 * page, not worth de-duplicating. SoaDetail keeps deriving `books` from
 * the invoices table it already fetched instead of using this — no point
 * re-fetching there.
 */
export function SoaAllDownloadButton({ companyName }: { companyName: string }) {
  const [books, setBooks] = useState<QbCompany[] | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    fetch(`/api/billing/soa/detail?companyName=${encodeURIComponent(companyName)}&company=ALL`)
      .then(res => res.json())
      .then(json => {
        const rows: { qbCompany: string }[] = json.invoices ?? [];
        setBooks(BOOK_ORDER.filter(b => rows.some(r => r.qbCompany === b)));
      })
      .catch(() => setBooks([]));
  }, [companyName]);

  const onDownload = async (book: SoaCompanySelector) => {
    setDownloading(true); setError(null);
    try {
      await downloadSoaPdf(companyName, book);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <SoaDownloadPopover books={books ?? []} downloading={downloading || books === null}
        isOpen={isOpen} onOpenChange={setIsOpen} onDownload={onDownload} />
      {error && <span title={error} style={{ fontSize: 11, fontWeight: 700, color: 'var(--status-danger)', cursor: 'help' }}>⚠</span>}
    </span>
  );
}
