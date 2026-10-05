import 'server-only';
import { qbQuery, type QbCompany } from './quickbooks';
import { classifyCatalogItem } from './qb-item-classify';

// TAB/TAC's live QuickBooks item list for Billing Drafts' "Add line"
// (Vincent, 2026-10-05: "和 QuickBooks 一样，全部列出" — replacing the
// hardcoded 61-item QB_CATALOG in lib/invoice-templates.ts, which left out
// items staff bill on 401 of 1,284 TAB and 164 of 329 TAC invoices this year
// and used TAB names for TAC). Every active Service item of THAT book, with
// QuickBooks' own description, grouped by its top-level parent like
// QuickBooks' dropdown — except accounting's Deferred Revenue twins, never
// offered (INV-QB-029). No prices: a new line's rate is typed by staff.
// INV-QB-034.

export type BookCatalogItem = { name: string; fullyQualifiedName: string; description: string | null; service: string };
export type BookCatalog = { group: string; items: BookCatalogItem[] }[];

export const NO_CATEGORY = 'No category';

export async function fetchBookItemCatalog(book: Extract<QbCompany, 'TAB' | 'TAC'>): Promise<BookCatalog> {
  const result = await qbQuery("SELECT * FROM Item WHERE Type = 'Service' MAXRESULTS 1000", book);
  if (!result) throw new Error(`QuickBooks ${book}'s item list could not be read.`);
  const groups = new Map<string, BookCatalogItem[]>();
  for (const row of result.rows as Record<string, unknown>[]) {
    const fq = String(row.FullyQualifiedName ?? row.Name ?? '');
    const service = classifyCatalogItem(fq);
    if (!fq || !service) continue;
    const group = fq.includes(':') ? fq.split(':')[0] : NO_CATEGORY;
    const list = groups.get(group) ?? [];
    list.push({
      name: String(row.Name ?? fq),
      fullyQualifiedName: fq,
      description: typeof row.Description === 'string' && row.Description.trim() ? row.Description : null,
      service,
    });
    groups.set(group, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === NO_CATEGORY ? 1 : b === NO_CATEGORY ? -1 : a.localeCompare(b)))
    .map(([group, items]) => ({ group, items: items.sort((x, y) => x.name.localeCompare(y.name)) }));
}
