'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import ConfirmDeleteModal from './ConfirmDeleteModal';
import { fmtDate, todaySGT } from '@/lib/date';

type TrademarkCategory = 'master' | 'in_progress';

interface TrademarkRow {
  id: number;
  category: TrademarkCategory;
  sn: number | null;
  company_name: string;
  application_number: string | null;
  application_date: string | null;
  mark_expired_date: string | null;
  logo_classes: string | null;
  status_text: string | null;
  updates_note: string | null;
  updated_at: string | null;
  updated_by_name: string | null;
}

type ColKey = 'sn' | 'company_name' | 'application_number' | 'application_date' | 'mark_expired_date' | 'logo_classes' | 'status_text' | 'updates_note';

const COLUMN_DEFS: Record<ColKey, { label: string; type: 'text' | 'date'; width: string }> = {
  sn:                  { label: 'S/N',                type: 'text', width: '60px' },
  company_name:        { label: 'Company Name',       type: 'text', width: 'minmax(220px,1.6fr)' },
  application_number:  { label: 'Application No.',    type: 'text', width: '160px' },
  application_date:    { label: 'Application Date',   type: 'date', width: '140px' },
  mark_expired_date:   { label: 'Mark Expired Date',  type: 'date', width: '150px' },
  logo_classes:        { label: 'Logo / Classes',     type: 'text', width: '150px' },
  status_text:         { label: 'Status',             type: 'text', width: '220px' },
  updates_note:        { label: 'Updates',            type: 'text', width: 'minmax(160px,1fr)' },
};

// Master Records = officially filed (real IPOS application number + dates).
// In Progress = pre-numbered filings tracked by logo/class count + a
// free-text status until they graduate to Master Records — see
// scripts/create-trademark-records.sql for the full rationale.
const CATEGORY_COLUMNS: Record<TrademarkCategory, ColKey[]> = {
  master: ['sn', 'company_name', 'application_number', 'application_date', 'mark_expired_date'],
  in_progress: ['sn', 'company_name', 'logo_classes', 'status_text', 'updates_note'],
};

const ACCENT = '#1d3a5c';

export default function TrademarkTable({ category, title }: { category: TrademarkCategory; title: string }) {
  const [rows, setRows] = useState<TrademarkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ id: number; field: ColKey } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [pendingDelete, setPendingDelete] = useState<TrademarkRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/trademark?category=${category}`);
    const json = await res.json();
    setRows(json.data ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, [category]);

  const columns = CATEGORY_COLUMNS[category];
  const today = todaySGT();

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.trim().toLowerCase();
    return rows.filter(r =>
      (r.company_name ?? '').toLowerCase().includes(q) ||
      (r.application_number ?? '').toLowerCase().includes(q));
  }, [rows, search]);

  // sn reads back as a number (integer column) — everything else as a
  // string; the edit input only ever deals in strings, so normalise here.
  const cellText = (row: TrademarkRow, field: ColKey): string => {
    const v = row[field];
    return v === null || v === undefined ? '' : String(v);
  };

  const startEdit = (row: TrademarkRow, field: ColKey) => {
    setEditing({ id: row.id, field });
    setEditValue(cellText(row, field));
  };

  const saveEdit = async (row: TrademarkRow, field: ColKey) => {
    setEditing(null);
    const previousValue = cellText(row, field);
    if (editValue === previousValue) return;
    setRows(prev => prev.map(r => (r.id === row.id ? { ...r, [field]: editValue || null } : r)));
    const res = await fetch('/api/trademark', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, field, value: editValue || null, previousValue: previousValue || null }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      alert(json.error === 'conflict' ? 'Someone else already changed this record — reloading the latest version.' : (json.error ?? 'Failed to save.'));
      load();
    }
  };

  const addRow = async () => {
    if (!newName.trim() || saving) return;
    setSaving(true);
    const res = await fetch('/api/trademark', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, company_name: newName.trim() }),
    });
    setSaving(false);
    if (res.ok) { setNewName(''); setShowAdd(false); load(); }
    else { const json = await res.json().catch(() => ({})); alert(json.error ?? 'Failed to add.'); }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const res = await fetch('/api/trademark', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pendingDelete.id }),
    });
    setPendingDelete(null);
    if (res.ok) load();
  };

  const gridTemplate = `${columns.map(c => COLUMN_DEFS[c].width).join(' ')} 40px`;

  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Master List › Trademark › {title}</div>

      <div className="bg-white rounded-xl shadow-sm p-4 mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search company name or application number..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-48 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400"
        />
        <button
          onClick={() => setShowAdd(true)}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 16px', borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
        >
          <Plus size={14} />Add Record
        </button>
        <span className="text-sm text-slate-400 ml-auto">{filtered.length} shown{search.trim() ? ` of ${rows.length}` : ''}</span>
      </div>

      <div style={{ background: '#fff', borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ minWidth: 700 }}>
            <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, background: '#f1f5f9', padding: '10px 14px', gap: 8 }}>
              {columns.map(c => (
                <div key={c} style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{COLUMN_DEFS[c].label}</div>
              ))}
              <div />
            </div>

            {loading ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>No records.</div>
            ) : filtered.map(row => (
              <div key={row.id} style={{ display: 'grid', gridTemplateColumns: gridTemplate, alignItems: 'center', padding: '9px 14px', gap: 8, borderTop: '1px solid #f1f5f9' }}>
                {columns.map(c => {
                  const def = COLUMN_DEFS[c];
                  const isEditing = editing?.id === row.id && editing.field === c;
                  const raw = row[c] as string | number | null;
                  const isExpired = c === 'mark_expired_date' && category === 'master' && !!raw && String(raw) < today;
                  if (isEditing) {
                    return (
                      <input
                        key={c}
                        type={def.type}
                        autoFocus
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={() => saveEdit(row, c)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(null); }}
                        style={{ border: '1px solid #93c5fd', borderRadius: 5, padding: '4px 6px', fontSize: 12.5, outline: 'none', width: '100%' }}
                      />
                    );
                  }
                  return (
                    <div
                      key={c}
                      onClick={() => startEdit(row, c)}
                      title="Click to edit"
                      style={{
                        fontSize: 12.5, cursor: 'pointer', padding: '4px 6px', borderRadius: 5, minHeight: 20,
                        color: isExpired ? '#dc2626' : raw ? '#334155' : '#cbd5e1',
                        fontWeight: c === 'company_name' ? 600 : isExpired ? 700 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: c === 'company_name' || c === 'status_text' || c === 'updates_note' ? 'normal' : 'nowrap',
                      }}
                    >
                      {def.type === 'date' ? (raw ? fmtDate(String(raw)) : '—') : (raw || '—')}
                      {isExpired && ' ⚠'}
                    </div>
                  );
                })}
                <button onClick={() => setPendingDelete(row)} title="Remove record"
                  style={{ border: 'none', background: 'transparent', color: '#cbd5e1', cursor: 'pointer', padding: 2, display: 'flex', justifyContent: 'center' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showAdd && (
        <div onClick={() => setShowAdd(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
            <div style={{ background: ACCENT, padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>Add Record — {title}</div>
              <button onClick={() => setShowAdd(false)} style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: '#fff', borderRadius: 8, width: 32, height: 32, cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <label style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>Company Name *</label>
              <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus
                onKeyDown={e => { if (e.key === 'Enter') addRow(); }}
                placeholder="Company name" style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', fontSize: 13, outline: 'none' }} />
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Other fields can be filled in after adding — click any cell in the table to edit it.</div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={() => setShowAdd(false)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                <button onClick={addRow} disabled={!newName.trim() || saving}
                  style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: ACCENT, color: '#fff', fontWeight: 700, fontSize: 13, cursor: newName.trim() ? 'pointer' : 'not-allowed', opacity: newName.trim() ? 1 : 0.5 }}>
                  {saving ? 'Adding…' : 'Add'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {pendingDelete && (
        <ConfirmDeleteModal label={pendingDelete.company_name} onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />
      )}
    </div>
  );
}
