'use client';

import { useEffect, useRef, useState } from 'react';
import { History } from 'lucide-react';

export type AuditEntry = { id: number; field: string; old_value: string | null; new_value: string | null; changed_by: string; changed_at: string };

// Small popover version of Master List's in-modal Edit History section —
// for pages (like AR Reminder's Table view) with no per-row detail modal to
// hang a full section off of. Same generic /api/audit-log endpoint, fetched
// on first open only.
export function EditHistoryButton({ table, rowId }: { table: string; rowId: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

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
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button onClick={toggle} title="View edit history"
        style={{ padding: '3px 6px', borderRadius: 5, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', cursor: 'pointer', display: 'inline-flex' }}>
        <History size={11} />
      </button>
      {open && (
        <div onClick={e => e.stopPropagation()} style={{
          position: 'absolute', right: 0, top: '100%', marginTop: 4, zIndex: 30, background: '#fff',
          border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', width: 280, padding: 10,
          textAlign: 'left', fontWeight: 400, color: '#334155',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Edit History</div>
          {loading ? (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Loading…</div>
          ) : !entries?.length ? (
            <div style={{ fontSize: 12, color: '#94a3b8' }}>No recorded edits yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
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
