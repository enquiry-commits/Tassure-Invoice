'use client';

import { useState } from 'react';
import { InboxSection } from '@/components/turnover-ai/InboxSection';
import { ReviewSection } from '@/components/turnover-ai/ReviewSection';
import { SummarySection } from '@/components/turnover-ai/SummarySection';

// Turnover AI, consolidated onto a single page (Vincent: "这个能不能全部内容
// 只在一个页面不要分散" — one page, not spread across separate routes).
// Inbox / Review Queue / Summary are in-page tabs (local state, no
// navigation) instead of 3 separate sidebar sub-pages.

type Tab = 'inbox' | 'review' | 'summary';

const TABS: { key: Tab; label: string }[] = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'review', label: 'Review Queue' },
  { key: 'summary', label: 'Summary' },
];

export default function TurnoverAiPage() {
  const [tab, setTab] = useState<Tab>('inbox');

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 800, color: '#0f172a' }}>Turnover AI</h1>
        <div style={{ display: 'flex', gap: 6 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', border: tab === t.key ? 'none' : '1px solid #e2e8f0', background: tab === t.key ? '#0f172a' : '#fff', color: tab === t.key ? '#fff' : '#475569' }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'inbox' && <InboxSection onGoToReview={() => setTab('review')} />}
      {tab === 'review' && <ReviewSection onGoToSummary={() => setTab('summary')} />}
      {tab === 'summary' && <SummarySection onGoToReview={() => setTab('review')} />}
    </div>
  );
}
