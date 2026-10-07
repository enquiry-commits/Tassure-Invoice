'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
import type { DraftLike } from '@/lib/draft-helper-client';
import type { CampaignActor, CampaignSender } from '@/lib/campaign-draft-client';
import { normalize } from '@/lib/company-name';
import { buildGroupSoaDraft } from '@/lib/soa-group-draft-client';
import { formatShortMoney } from '@/lib/soa-group-email';

// "Group" on the SOA page (Chelsea, 2026-10-07): some companies belong to one group, and their SOA + invoices go out in
// ONE email. The person ticks the companies (every company that owes money, across TAB / TAC / TAO), types the subject
// herself, and the draft opens in the usual Outlook-style review window — nothing is sent from here.

type RowLite = { companyName: string; qbCompany: 'TAB' | 'TAC' | 'TAO'; totalOutstanding: number };
type Entry = { key: string; name: string; net: number; books: string[] };

const NAVY = '#1d3a5c';

export default function SoaGroupModal({ me, sender, onClose, onDrafted }: {
  me: CampaignActor; sender: CampaignSender; onClose: () => void; onDrafted: (draft: DraftLike) => void;
}) {
  const [rows, setRows] = useState<RowLite[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]); // entry keys, in the order they were ticked
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/billing/soa/all', { cache: 'no-store' })
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? 'Could not load the outstanding list.'); setRows(j.companies as RowLite[]); })
      .catch(e => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  // One entry per company (its books together), only those that owe money overall
  const entries = useMemo<Entry[]>(() => {
    const byKey = new Map<string, Entry>();
    for (const r of rows ?? []) {
      const key = normalize(r.companyName) || r.companyName.trim().toLowerCase();
      const e = byKey.get(key) ?? { key, name: r.companyName, net: 0, books: [] };
      e.net += r.totalOutstanding;
      if (!e.books.includes(r.qbCompany)) e.books.push(r.qbCompany);
      byKey.set(key, e);
    }
    return [...byKey.values()].filter(e => e.net > 0).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  const byKey = useMemo(() => new Map(entries.map(e => [e.key, e])), [entries]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? entries.filter(e => e.name.toLowerCase().includes(q)) : entries;
  }, [entries, search]);
  const chosen = picked.map(k => byKey.get(k)).filter((e): e is Entry => !!e);
  const total = chosen.reduce((s, e) => s + e.net, 0);
  const toggle = (key: string) => setPicked(p => (p.includes(key) ? p.filter(k => k !== key) : [...p, key]));
  const canCreate = chosen.length >= 2 && subject.trim().length > 0 && !busy;

  const create = async () => {
    setBusy(true); setError(null); setProgress('Starting…');
    try {
      const draft = await buildGroupSoaDraft({ companyNames: chosen.map(e => e.name), subject, me, sender, onProgress: setProgress });
      onDrafted(draft);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false); setProgress('');
    }
  };

  return (
    <div onClick={busy ? undefined : onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,.3)', overflow: 'hidden' }}>
        <div style={{ background: NAVY, color: '#fff', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>Group SOA email</div>
            <div style={{ fontSize: 11.5, opacity: 0.75, marginTop: 2 }}>Tick the companies of one group — their SOA and invoices go out together in one email.</div>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" style={{ background: 'none', border: 'none', color: '#fff', cursor: busy ? 'default' : 'pointer' }}><X size={18} /></button>
        </div>

        <div style={{ padding: 18, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11.5, fontWeight: 700, color: '#475569' }}>
            Email subject (you write it)
            <input value={subject} onChange={e => setSubject(e.target.value)} disabled={busy} placeholder="e.g. Outstanding payment — Aquila Group"
              style={{ border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontWeight: 400, color: '#0f172a' }} />
          </label>

          <div>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: 10, color: '#94a3b8' }} />
              <input value={search} onChange={e => setSearch(e.target.value)} disabled={busy} placeholder="Search a company…"
                style={{ width: '100%', boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 8, padding: '8px 10px 8px 30px', fontSize: 13 }} />
            </div>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 8, maxHeight: 280, overflowY: 'auto' }}>
              {rows === null && !loadError && <div style={{ padding: 18, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>Loading…</div>}
              {loadError && <div style={{ padding: 14, color: '#b91c1c', fontSize: 12.5 }}>{loadError}</div>}
              {rows !== null && visible.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: '#94a3b8', fontSize: 12.5 }}>No company matches.</div>}
              {visible.map(e => {
                const on = picked.includes(e.key);
                return (
                  <label key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', borderBottom: '1px solid #f1f5f9', cursor: busy ? 'default' : 'pointer', background: on ? '#f1f5f9' : '#fff' }}>
                    <input type="checkbox" checked={on} disabled={busy} onChange={() => toggle(e.key)} style={{ accentColor: NAVY }} />
                    <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600, color: '#1e293b' }}>{e.name}</span>
                    <span style={{ fontSize: 10.5, color: '#64748b' }}>{e.books.join(' + ')}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: NAVY, minWidth: 84, textAlign: 'right' }}>{formatShortMoney(e.net)}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div style={{ fontSize: 12.5, color: '#334155' }}>
            {chosen.length === 0 ? 'Nothing ticked yet.' : (
              <>
                <b>{chosen.length}</b> {chosen.length === 1 ? 'company' : 'companies'} · total <b>{formatShortMoney(total)}</b>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {chosen.map(e => (
                    <span key={e.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 999, padding: '2px 4px 2px 10px' }}>
                      {e.name}
                      <button onClick={() => toggle(e.key)} disabled={busy} aria-label={`Remove ${e.name}`} style={{ display: 'flex', border: 'none', background: 'none', cursor: 'pointer', color: '#64748b', padding: 0 }}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              </>
            )}
            {chosen.length === 1 && <div style={{ marginTop: 6, color: '#64748b' }}>Tick at least two companies — for one company, use its own Draft Email.</div>}
          </div>

          {error && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, lineHeight: 1.5 }}>{error}</div>}
        </div>

        <div style={{ padding: '12px 18px', borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 10, background: '#f8fafc' }}>
          <span style={{ flex: 1, fontSize: 12, color: '#64748b' }}>{busy ? progress : 'The email opens in the review window — nothing is sent until you press Send there.'}</span>
          <button onClick={onClose} disabled={busy} style={{ border: '1px solid #cbd5e1', background: '#fff', color: '#475569', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: busy ? 'default' : 'pointer' }}>Cancel</button>
          <button onClick={create} disabled={!canCreate}
            style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: NAVY, color: '#fff', borderRadius: 8, padding: '8px 18px', fontSize: 13, fontWeight: 700, cursor: canCreate ? 'pointer' : 'not-allowed', opacity: canCreate ? 1 : 0.5 }}>
            {busy && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {busy ? 'Preparing…' : 'Create draft'}
          </button>
        </div>
      </div>
    </div>
  );
}
