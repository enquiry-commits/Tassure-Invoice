// WHO IS RESPONSIBLE for an SOA row — ONE copy for the server (lib/soa-data.ts, My Tasks, exports, Company
// 360, the assistant) and the SOA page's filters (docs/INVARIANTS.md INV-PIC-011). Pure: safe in the browser.
//
// Vincent, 2026-10-07, on CO-OPERATE ASSOCIATES (PIC column: Ang Shi Ming, Jay Tay, Clarence Saw): "过后就没有
// Main PIC 了 … PIC 就是 Main PIC … 3 个人都是 MAIN PIC，不管我在上面选择 3 个人的其中一个人，这个公司都要出现".
// This REPLACES the single-person "Main PIC" rule of INV-PIC-009 (same day): there is no Main PIC any more —
// everyone the PIC column lists is responsible, and picking any ONE of them shows the company.
//
// Who is responsible, in order:
//   1. "BD" (Bad Debt) — a stored STATUS, not a person, kept even when the Sept import wrote it ("BD 保留"). It
//      is the only stored value still read; any other soa_owners pick is ignored (Vincent chose that).
//   2. a TAC row whose unpaid invoices are ALL Nominee Director services (INV-PIC-010) has no PIC of its own:
//      it is the responsibility of the same company's TAB people (tabPeople);
//   3. everyone in the PIC column (picShown, INV-PIC-008: QuickBooks' Classes on the unpaid invoices, else the
//      company's TeamWork PIC);
//   4. nobody there: the invoice Location's suggestion (who keyed it), so a company is not left unowned.

export type MainPicRow = {
  soaPic: string | null;
  soaPicSource: 'person' | 'import' | null;
  classOwner: string | null;
  suggestedOwner: string | null;
  picShown: string[];
  picOptions: string[];
  ndFollowsTab: boolean;
  tabPeople: string[];
};

// Stored values that are a status, not a person.
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

/** True when this balance carries the Bad Debt status (whoever stored it). */
export function isBadDebt(row: Pick<MainPicRow, 'soaPic'>): boolean {
  return !!row.soaPic && STATUS_CODES.has(row.soaPic);
}

/** Everyone responsible for this row (see the order above); 'BD' means Bad Debt, not a person. */
export function responsiblePeople(row: Pick<MainPicRow, 'soaPic' | 'suggestedOwner' | 'picShown' | 'ndFollowsTab' | 'tabPeople'>): string[] {
  if (isBadDebt(row)) return ['BD'];
  if (row.ndFollowsTab) return [...row.tabPeople];
  if (row.picShown.length) return [...new Set(row.picShown)];
  return row.suggestedOwner ? [row.suggestedOwner] : [];
}

/** For display: "Ang Shi Ming, Jay Tay" (BD reads "Bad Debt"). */
export function peopleLabel(people: readonly string[]): string {
  return people.map(p => (p === 'BD' ? 'Bad Debt' : p)).join(', ');
}
