'use client';

import type { ReactNode } from 'react';
import { AlertTriangle, MinusCircle } from 'lucide-react';

// title/body/confirmLabel/tone all optional, defaulting to the exact
// original hard-delete wording/styling — every existing caller (Late
// Filing, Billing Drafts, MasterListTable, Client Communications History,
// TrademarkTable) passes only label/onCancel/onConfirm and is unaffected.
// Added 2026-09-22 for app/billing/tao/page.tsx's own second use: a
// REVERSIBLE "take this company off the TAO list" action (clearing a
// services_manual override, not deleting the companies row) needs the same
// backdrop+card+confirm shell but neither the "permanently"/"cannot be
// undone" wording nor the alarming red icon are true for it — tone
// 'neutral' swaps both for a calmer blue MinusCircle without a second,
// divergent modal implementation.
export default function ConfirmDeleteModal({
  label, onCancel, onConfirm,
  title = 'Remove this record?',
  body,
  confirmLabel = 'Remove',
  tone = 'danger',
}: {
  label: string; onCancel: () => void; onConfirm: () => void;
  title?: string; body?: ReactNode; confirmLabel?: string; tone?: 'danger' | 'neutral';
}) {
  const danger = tone === 'danger';
  return (
    <div onClick={onCancel} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 400, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: '50%', background: danger ? '#fee2e2' : '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            {danger ? <AlertTriangle size={20} style={{ color: '#dc2626' }} /> : <MinusCircle size={20} style={{ color: '#0369a1' }} />}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>{title}</div>
        </div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20, lineHeight: 1.5 }}>
          {body ?? <>You are about to permanently remove <strong style={{ color: '#1e293b' }}>{label}</strong>. This action cannot be undone.</>}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            Cancel
          </button>
          <button onClick={onConfirm}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: danger ? '#dc2626' : '#0369a1', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
