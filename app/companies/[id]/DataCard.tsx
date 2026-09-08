'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

// Pulled out of _components.tsx into its own 'use client' file (2026-09-08)
// — same convention this route folder already uses for its other small
// interactive pieces (CopyUenButton.tsx, CustomerSourceField.tsx) — so
// every OTHER Company 360 section (ArAgmSection, InvoicesSection, etc.)
// can stay a plain server component, per _components.tsx's own original
// reasoning ("every one of these is read-only, so all stay server
// components"). Only the shell that now needs interactive state (open/
// closed) crosses that boundary; a server component's already-rendered
// JSX can still be passed in as `children` with no issue.
//
// Vincent, 2026-09-08: "这些部分设置成每个板块都是可以收起的，并且默认收
// 起，用户需要的时候自己打开" (every section should be collapsible,
// collapsed by default, opened on demand) — "除了第1板块不需要收起" (except
// module 1, the header card, doesn't need this — that's page.tsx's own
// plain info block, never rendered through DataCard at all, so it's
// naturally excluded already). The count badge stays visible even while
// collapsed — the whole point of it is letting someone judge "is this
// worth opening" without opening it.
export function DataCard({ title, icon, count, empty, children, scrollable = true }: {
  title: string; icon: React.ReactNode; count: number; empty: string; children?: React.ReactNode;
  // 2026-09-03, Vincent on Officials specifically ("这一块不需要限制长度有多
  // 少显示多少") — the 360px internal scroll every other section here still
  // uses is fine for occasional overflow, but Officials can genuinely run to
  // 8+ real rows (every appointed role, one row each) and forcing that into
  // a little scrollbox made it harder to read than just letting the card
  // grow and the page itself scroll. Opt-in per section, not a global
  // change to every DataCard.
  scrollable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="system-list-shell" style={{ marginBottom: 21.6 }}>
      <div
        className="system-list-title-bar px-4 py-3"
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        onClick={() => setOpen(o => !o)}
        role="button"
        aria-expanded={open}
      >
        {icon}
        <h2 className="system-list-title">{title}</h2>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>
          {count}
          {open ? <ChevronDown size={14} color="#fff" /> : <ChevronRight size={14} color="#fff" />}
        </span>
      </div>
      {open && (
        count === 0 ? (
          <div style={{ padding: '24px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>{empty}</div>
        ) : scrollable ? (
          <div className="system-list-scroll" style={{ maxHeight: 360 }}>
            {children}
          </div>
        ) : (
          <div className="system-list-scroll" style={{ overflow: 'visible' }}>
            {children}
          </div>
        )
      )}
    </div>
  );
}
