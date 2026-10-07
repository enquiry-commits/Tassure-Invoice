// The SOA "Main PIC" rule — ONE copy for the server (lib/soa-data.ts, My
// Tasks, exports, Company 360, the assistant) and the SOA page's own dropdown
// and filters, which used to carry their own copies (docs/INVARIANTS.md
// INV-PIC-009). Pure: safe in the browser.
//
// Vincent, 2026-10-07, on FINSIGHTS MEDIA: "TAB 的 PIC 已经变成默认是 Jenny
// 了 那么Main PIC 也应该是默认是 Jenny, 而不是还放着 Kah yE". Its "Chin Kah Ye"
// was a soa_owners row written by the one-off 2026-09-07 Google-Sheet import
// (updated_by_email 'backfill@internal' — 305 of the table's 308 rows), not a
// pick anyone made in the app, yet it beat QuickBooks' own Class. Then:
// "最新一轮的直接按照系统逻辑走了，以后要手动才手动，现在先全部走一轮系统匹配
// Main PIC" — so the import no longer names an owner. Order now:
//   1. a pick a PERSON made in this app (always wins), or a stored STATUS
//      code such as "BD" (Bad Debt) — a status, not a person, kept even when
//      the import wrote it (3 owing companies carry it);
//   2. the person QuickBooks' own Classes name (the PIC column's source);
//   3. the PIC column's only person (Main PIC follows the PIC column);
//   4. the auto-suggestion — the invoice Location, i.e. who keyed it — only
//      when the PIC column can't decide (several people, or none);
//   5. a lone TeamWork PIC (effectiveOwner only).
// The import rows stay in soa_owners untouched (nothing is deleted).

export type MainPicRow = {
  soaPic: string | null;
  soaPicSource: 'person' | 'import' | null;
  classOwner: string | null;
  suggestedOwner: string | null;
  picShown: string[];
  picOptions: string[];
};

// Stored values that are a status, not a person (the SOA page's "Other"
// options) — honoured whoever stored them.
const STATUS_CODES = new Set(['BD']);

export function storedOwnerSource(updatedByEmail: string | null | undefined): 'person' | 'import' {
  return updatedByEmail === 'backfill@internal' ? 'import' : 'person';
}

// The person QuickBooks' Classes name: the auto-suggestion when it is one of
// them, else the only one; null when none (or several and none suggested).
export function classOwnerFor(suggestedOwner: string | null, fromInvoices: readonly string[]): string | null {
  if (suggestedOwner && fromInvoices.includes(suggestedOwner)) return suggestedOwner;
  return fromInvoices.length === 1 ? fromInvoices[0] : null;
}

// The stored value that still counts: a person's pick in this app, or a status code.
export function personPick(row: Pick<MainPicRow, 'soaPic' | 'soaPicSource'>): string | null {
  if (!row.soaPic) return null;
  return row.soaPicSource === 'person' || STATUS_CODES.has(row.soaPic) ? row.soaPic : null;
}

// Steps 1-4 (no lone-TeamWork fallback) — what the SOA page's filters use.
export function derivedOwner(row: Pick<MainPicRow, 'soaPic' | 'soaPicSource' | 'classOwner' | 'suggestedOwner' | 'picShown'>): string | null {
  return personPick(row) ?? row.classOwner ?? (row.picShown.length === 1 ? row.picShown[0] : null) ?? row.suggestedOwner;
}

export function effectiveOwner(row: MainPicRow): string | null {
  return derivedOwner(row) ?? (row.picOptions.length === 1 ? row.picOptions[0] : null);
}
