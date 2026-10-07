'use client';

import { useEffect, useRef, useState } from 'react';

// Vincent, via AskUserQuestion on Turnover AI: pick an existing `companies`
// row OR type a client name that isn't in the system yet (a new customer
// with no companies row). Same caching + free-text-filter shape as
// components/billing/ExpandedBillingRow.tsx's ParentCompanyPicker (reusing
// /api/companies/parent, which already returns the full { id, company_name }
// picklist cheaply), but unlike that picker, typed text that matches nothing
// is kept as the value rather than discarded — that's the "type a new one"
// half of the requirement.

let picklistCache: { id: number; company_name: string }[] | null = null;
let picklistPromise: Promise<{ id: number; company_name: string }[]> | null = null;

function loadPicklist() {
  if (picklistCache) return Promise.resolve(picklistCache);
  if (!picklistPromise) {
    picklistPromise = fetch('/api/companies/parent').then(r => r.json())
      .then(j => { picklistCache = j.companies ?? []; return picklistCache!; })
      .catch(() => { picklistPromise = null; return []; });
  }
  return picklistPromise;
}

export type ClientSelection = { companyId: number | null; name: string };

export function ClientPicker({ value, onChange, placeholder }: {
  value: ClientSelection;
  onChange: (next: ClientSelection) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<{ id: number; company_name: string }[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    loadPicklist().then(setOptions);
    const onOutside = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const q = value.name.trim().toLowerCase();
  const filtered = (q ? options.filter(o => o.company_name.toLowerCase().includes(q)) : options).slice(0, 30);

  return (
    <div ref={boxRef} style={{ position: 'relative', width: 320 }}>
      <input
        value={value.name}
        onChange={e => { onChange({ companyId: null, name: e.target.value }); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder ?? 'Select an existing client, or type a new one'}
        style={{ border: '1px solid #e2e8f0', borderRadius: 7, padding: '6px 10px', fontSize: 12, width: '100%', boxSizing: 'border-box' }}
      />
      {value.companyId && (
        <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 9, fontWeight: 700, color: '#15803d' }}>Matched</span>
      )}
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 2, zIndex: 40, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, boxShadow: '0 8px 20px rgba(0,0,0,0.15)', maxHeight: 240, overflowY: 'auto', width: '100%' }}>
          {filtered.length === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 11, color: '#94a3b8' }}>
              {q ? `No matching existing client — will be saved as a new client "${value.name.trim()}"` : 'Type to search clients'}
            </div>
          )}
          {filtered.map(o => (
            <div key={o.id}
              onClick={() => { onChange({ companyId: o.id, name: o.company_name }); setOpen(false); }}
              style={{ padding: '7px 10px', fontSize: 12, cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#f8fafc'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
            >
              {o.company_name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
