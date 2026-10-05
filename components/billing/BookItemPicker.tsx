'use client';

import { useEffect, useState } from 'react';
import type { BookCatalog } from '@/lib/qb-item-catalog';

// Billing Drafts' "Add line": the book's LIVE QuickBooks item list, grouped
// like QuickBooks, each item bringing its own QuickBooks description
// (Vincent, 2026-10-05: "和 QuickBooks 一样，全部列出"; INV-QB-034). No price
// is prefilled ("不预填，和 TAO 一样") — the rate starts empty and Generate
// waits for it. Replaces the hardcoded QB_CATALOG list here.

export type PickedItem = { service: string; productService: string; description: string };

const cache: Partial<Record<'TAB' | 'TAC', Promise<BookCatalog>>> = {};
function loadCatalog(book: 'TAB' | 'TAC'): Promise<BookCatalog> {
  if (!cache[book]) {
    cache[book] = fetch(`/api/billing/item-catalog?book=${book}`)
      .then(async r => {
        const json = await r.json().catch(() => ({})) as { groups?: BookCatalog; error?: string };
        if (!r.ok || !json.groups) throw new Error(json.error ?? `QuickBooks ${book}'s item list could not be loaded.`);
        return json.groups;
      })
      // A failure is shown and retried next time, never cached as "no items".
      .catch(error => { delete cache[book]; throw error; });
  }
  return cache[book]!;
}

export function BookItemPicker({ book, style, onPick }: {
  book: 'TAB' | 'TAC';
  style?: React.CSSProperties;
  onPick: (item: PickedItem) => void;
}) {
  const [groups, setGroups] = useState<BookCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadCatalog(book)
      .then(g => { if (!cancelled) { setGroups(g); setError(null); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [book]);

  const pick = (fq: string) => {
    const item = groups?.flatMap(g => g.items).find(i => i.fullyQualifiedName === fq);
    if (!item) return;
    onPick({ service: item.service, productService: item.fullyQualifiedName, description: item.description?.trim() || item.name });
  };

  return (
    <>
      <select value="" disabled={!groups} onChange={e => { if (e.target.value) pick(e.target.value); }}
        style={{ ...style, minWidth: 260, cursor: groups ? 'pointer' : 'default' }}>
        <option value="">{groups ? `Choose a QuickBooks ${book} item…` : error ? 'Item list unavailable' : 'Loading QuickBooks items…'}</option>
        {(groups ?? []).map(g => (
          <optgroup key={g.group} label={g.group}>
            {g.items.map(i => (
              <option key={i.fullyQualifiedName} value={i.fullyQualifiedName} title={i.description ?? undefined}>{i.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {error && <span style={{ fontSize: 11, color: 'var(--status-danger)', fontWeight: 600 }}>⚠ {error} Reload the page to try again.</span>}
    </>
  );
}
