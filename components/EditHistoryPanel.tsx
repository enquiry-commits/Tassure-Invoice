'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export type AuditEntry = { id: number; field: string; old_value: string | null; new_value: string | null; changed_by: string; changed_at: string };

// Inline, collapsed-by-default section for pages with a per-row detail
// modal — currently just Master List's CompanyDetailModal (table="master_list").
// AR Reminder has its own, more capable history+restore panel already
// (ARDetailModal's "History" button, reading directly from the DB-trigger-
// populated ar_reminder_audit table via app/api/ar-reminder/history), so it
// doesn't use this component. Fetched on first expand only, since most rows
// are opened to check current values, not history.
export function EditHistorySection({ table, rowId }: { table: string; rowId: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && entries === null) {
      setLoading(true);
      try {
        const res = await fetch(`/api/audit-log?table=${table}&id=${rowId}`);
        const json = await res.json();
        setEntries(json.data ?? []);
      } catch {
        setEntries([]);
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 14 }}>
      <button onClick={toggle} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}Edit History
      </button>
      {open && (
        <div style={{ marginTop: 10 }}>
          {loading ? (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Loading…</div>
          ) : !entries?.length ? (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>No recorded edits yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
              {entries.map(e => (
                <div key={e.id} style={{ fontSize: 11.5, color: '#374151', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 6, padding: '6px 10px' }}>
                  <span style={{ fontWeight: 700 }}>{e.field}</span>
                  {': '}
                  <span style={{ color: '#94a3b8' }}>{e.old_value ?? '—'}</span>
                  {' → '}
                  <span style={{ color: '#1e293b' }}>{e.new_value ?? '—'}</span>
                  <div style={{ marginTop: 2, fontSize: 10, color: '#94a3b8' }}>{e.changed_by} · {new Date(e.changed_at).toLocaleString()}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
