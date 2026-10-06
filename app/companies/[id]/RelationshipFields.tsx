'use client';

import { useEffect, useState } from 'react';

// Company 360's client-relationship row: Client Since / Referred By / RM.
// Saves each field on change via /api/companies/relationship; the two pickers
// share one people list (/api/relationship-contacts) so a partner added once
// is selectable in both. Names come back title-cased from the server.
type Contact = { id: number; name: string; kind: 'internal' | 'external' };
type Field = 'clientSince' | 'referrerContactId' | 'rmContactId';

const LABEL_STYLE = { fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 } as const;
const INPUT_STYLE = { fontSize: 12, padding: '4px 6px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#1e3a5f' } as const;
const ADD_NEW = '__add_new__';

export default function RelationshipFields({ companyId, masterListJoinDates, initialClientSince, initialReferrerId, initialRmId }: {
  companyId: number;
  // Raw master_list.join_date text for this company — only used to remind
  // staff when Client Since is still empty because that text couldn't be
  // turned into a date ("YES", "2020", "31 Apr 2025", two conflicting dates...).
  masterListJoinDates: string[];
  initialClientSince: string | null;
  initialReferrerId: number | null;
  initialRmId: number | null;
}) {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [clientSince, setClientSince] = useState(initialClientSince ?? '');
  const [referrerId, setReferrerId] = useState<number | null>(initialReferrerId);
  const [rmId, setRmId] = useState<number | null>(initialRmId);
  const [saving, setSaving] = useState<Field | null>(null);
  const [adding, setAdding] = useState<'referrerContactId' | 'rmContactId' | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/relationship-contacts')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('load failed'))))
      .then(body => setContacts(body.contacts))
      .catch(() => setError('Could not load the people list'));
  }, []);

  async function save(field: Field, value: string | number | null): Promise<boolean> {
    setSaving(field);
    setError(null);
    try {
      const res = await fetch('/api/companies/relationship', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, field, value }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || 'Save failed');
        return false;
      }
      return true;
    } catch {
      setError('Save failed');
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function changeClientSince(next: string) {
    const prev = clientSince;
    setClientSince(next);
    if (!(await save('clientSince', next || null))) setClientSince(prev);
  }

  async function changeContact(field: 'referrerContactId' | 'rmContactId', raw: string) {
    if (raw === ADD_NEW) { setAdding(field); setNewName(''); return; }
    const next = raw ? Number(raw) : null;
    const setter = field === 'referrerContactId' ? setReferrerId : setRmId;
    const prev = field === 'referrerContactId' ? referrerId : rmId;
    setter(next);
    if (!(await save(field, next))) setter(prev);
  }

  async function addContact() {
    if (!adding || !newName.trim()) return;
    const field = adding;
    setSaving(field);
    setError(null);
    try {
      const res = await fetch('/api/relationship-contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      });
      const body = await res.json();
      if (!res.ok) { setError(body.error || 'Could not add'); return; }
      const created: Contact = body.contact;
      setContacts(list => [...(list ?? []).filter(c => c.id !== created.id), created].sort((a, b) => a.name.localeCompare(b.name)));
      setAdding(null);
      const setter = field === 'referrerContactId' ? setReferrerId : setRmId;
      const prev = field === 'referrerContactId' ? referrerId : rmId;
      setter(created.id);
      if (!(await save(field, created.id))) setter(prev);
    } catch {
      setError('Could not add');
    } finally {
      setSaving(s => (s === field ? null : s));
    }
  }

  function picker(field: 'referrerContactId' | 'rmContactId', label: string, value: number | null) {
    const internal = (contacts ?? []).filter(c => c.kind === 'internal');
    const external = (contacts ?? []).filter(c => c.kind === 'external');
    return (
      <div>
        <div style={LABEL_STYLE}>{label}</div>
        {adding === field ? (
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              autoFocus
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addContact(); if (e.key === 'Escape') setAdding(null); }}
              placeholder="Partner name"
              maxLength={80}
              style={{ ...INPUT_STYLE, width: 130 }}
            />
            <button onClick={addContact} disabled={!newName.trim() || saving === field} style={{ ...INPUT_STYLE, cursor: 'pointer', fontWeight: 700 }}>Add</button>
            <button onClick={() => setAdding(null)} style={{ ...INPUT_STYLE, cursor: 'pointer' }}>Cancel</button>
          </div>
        ) : (
          <select
            value={value ?? ''}
            disabled={saving === field || contacts === null}
            onChange={e => changeContact(field, e.target.value)}
            style={INPUT_STYLE}
          >
            <option value="">—</option>
            <optgroup label="Tassure team">
              {internal.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
            {external.length > 0 && (
              <optgroup label="External partners">
                {external.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </optgroup>
            )}
            <option value={ADD_NEW}>+ Add external partner…</option>
          </select>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 16 }}>
        <div>
          <div style={LABEL_STYLE}>Client Since</div>
          <input
            type="date"
            value={clientSince}
            disabled={saving === 'clientSince'}
            onChange={e => changeClientSince(e.target.value)}
            style={INPUT_STYLE}
          />
        </div>
        {picker('referrerContactId', 'Referred By', referrerId)}
        {picker('rmContactId', 'RM', rmId)}
      </div>
      {!clientSince && masterListJoinDates.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: '#92600a', background: '#fff8e6', border: '1px solid #f3e0b0', borderRadius: 6, padding: '6px 10px' }}>
          Please enter the accurate Client Since date — Master List join date is &ldquo;{masterListJoinDates.join('” / “')}&rdquo;, which can&apos;t be used as a date{masterListJoinDates.length > 1 ? ' (conflicting dates)' : ''}.
        </div>
      )}
      {error && <div style={{ marginTop: 6, fontSize: 11, color: '#b45f6b' }}>{error}</div>}
    </div>
  );
}
