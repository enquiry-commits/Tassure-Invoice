import type { CSSProperties, ReactNode } from 'react';

// Company 360 header (Vincent, 2026-10-09): every value sits in a BOX like the Client Since Note input, each 20% narrower
// than its column (the 5 equal columns stay). Editable controls (dropdowns, date, note) and read-only values share one look;
// read-only ones get a faint grey fill so it is still clear what can be changed.
export const FIELD_WIDTH = '80%';

export const FIELD_BOX: CSSProperties = {
  fontSize: 12, padding: '4px 6px', borderRadius: 6, border: '1px solid #e2e8f0', color: '#1e3a5f',
  boxSizing: 'border-box', height: 28,
};

export function ReadBox({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div title={title} style={{ ...FIELD_BOX, width: FIELD_WIDTH, height: 'auto', minHeight: 28, background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 4, minWidth: 0, lineHeight: 1.45, wordBreak: 'break-word' }}>
      {children}
    </div>
  );
}
