'use client';

import { useState } from 'react';
import { CUSTOMER_SOURCE_OPTIONS } from '@/lib/customer-source';

// Company 360's first (and so far only) editable field — see
// app/api/companies/customer-source/route.ts, lib/customer-source.ts.
// Feeds the Reports page's customer-source breakdown; most companies show
// "Unknown" until someone tags them here.
export default function CustomerSourceField({ companyId, initialValue }: { companyId: number; initialValue: string | null }) {
  const [value, setValue] = useState(initialValue ?? '');
  const [saving, setSaving] = useState(false);

  async function save(next: string) {
    const prev = value;
    setValue(next);
    setSaving(true);
    try {
      const res = await fetch('/api/companies/customer-source', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, value: next || null }),
      });
      if (!res.ok) setValue(prev);
    } catch {
      setValue(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <select
      value={value}
      disabled={saving}
      onChange={e => save(e.target.value)}
      style={{ fontSize: 12, padding: '4px 6px', borderRadius: 6, border: '1px solid #e2e8f0', background: '#fff', color: '#1e3a5f' }}
    >
      <option value="">Unknown</option>
      {CUSTOMER_SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
