'use client';

import { useState } from 'react';
import { Mail, Trash2 } from 'lucide-react';
import { fmtDate } from '@/lib/date';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal';
import { DataCard } from './DataCard';
import type { Company360 } from '@/lib/company-360';

// Pulled out of _components.tsx into its own 'use client' file (2026-09-23)
// — same DataCard.tsx convention: every OTHER Company 360 section stays a
// plain read-only server component; only the one that now needs its own
// state (here: a per-row delete) crosses that boundary. Vincent: repeated
// test SOA-reminder drafts (1V CAPITAL, his own test company) kept needing
// a manual cleanup on his behalf — "为了麻烦你每次要额外更新，我要多一个删
// 除记录的功能" — so staff can remove a stray record themselves instead of
// asking for it each time. Deletes the individual draft row shown (same
// `DELETE /api/client-communications/drafts` endpoint and confirm-modal
// pattern the Email Activity/History page already ships), never the whole
// campaign — this view is scoped to one company, and a real campaign can
// bundle several companies, so deleting "the campaign" from here could
// silently remove another company's record the person viewing this page
// never saw and didn't ask to touch.
const GRID_6_COLS = 'repeat(5, minmax(0,1fr)) 28px';

export function CommsSection({ drafts: initialDrafts }: { drafts: Company360['communications']['drafts'] }) {
  const [drafts, setDrafts] = useState(initialDrafts);
  const [pendingDelete, setPendingDelete] = useState<Company360['communications']['drafts'][number] | null>(null);
  const [deleteError, setDeleteError] = useState('');

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      const res = await fetch('/api/client-communications/drafts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pendingDelete.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? 'Unable to remove this record.');
      setDrafts(current => current.filter(d => d.id !== pendingDelete.id));
      setPendingDelete(null);
      setDeleteError('');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to remove this record.');
      setPendingDelete(null);
    }
  };

  return (
    <DataCard title="Email Status" icon={<Mail size={15} color="#fff" />} count={drafts.length} empty="No client communications sent to this company yet.">
      {/* Genuinely equal 5-way column split matching the header card's own
          grid (2026-09-04, Vincent: "分成5等分列宽和 第一模块的5等分列宽一致",
          then "上下没有对齐" once the first attempt — table colgroup
          percentages — still didn't line up against a CSS grid's gap-based
          math). Same div/grid pattern as ArAgmSection above; see
          GRID_5_COLS' own comment for why a <table> can't do this. A 6th,
          narrow (28px) column was added on the end for the delete icon —
          the original 5 keep their own equal widths untouched, per
          Vincent's own "每列的位置还是保留只是在最右边多一个垃圾桶的ICON". */}
      <div className="list-column-header-gray" style={{ display: 'grid', gridTemplateColumns: GRID_6_COLS, gap: 16, padding: '10px 16px' }}>
        <div>Campaign</div><div>Subject</div><div>To</div><div>Status</div><div>Sent</div><div />
      </div>
      {/* Vincent, 2026-09-04: "隐藏的内容往下行展示" — the previous
          nowrap+ellipsis truncation (Campaign/Subject/To) hid the rest of a
          long value behind a title-only tooltip; wrap onto additional lines
          instead so nothing is hidden. Row alignItems switched from center
          to start since row height now varies with wrapped content. */}
      {drafts.map(d => {
        const campaign = d.email_campaigns as { name?: string; type?: string } | null;
        return (
          <div key={d.id as number} className="system-list-row" style={{ display: 'grid', gridTemplateColumns: GRID_6_COLS, gap: 16, padding: '10px 16px', alignItems: 'start' }}>
            <div>{campaign?.name || campaign?.type || '—'}</div>
            <div>{(d.subject as string) || '—'}</div>
            <div style={{ fontSize: 11 }}>{(d.to_email as string) || '—'}</div>
            <div>
              <span style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: d.status === 'sent' ? '#15803d' : d.status === 'skipped' ? '#94a3b8' : '#b45309' }}>{d.status as string}</span>
            </div>
            <div>{d.sent_at ? fmtDate(d.sent_at as string) : '—'}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setPendingDelete(d)}
                title="Remove this record"
                className="system-list-action system-list-action--danger"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        );
      })}
      {deleteError && (
        <div style={{ padding: '8px 16px', color: '#b91c1c', fontSize: 11.5 }}>{deleteError}</div>
      )}
      {pendingDelete && (
        <ConfirmDeleteModal
          label={`${(pendingDelete.subject as string) || 'this record'}`}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </DataCard>
  );
}
