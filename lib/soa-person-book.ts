import { derivedOwner } from './soa-main-pic';
import { normalize } from './company-name';
import type { SoaCompanyRowWithSource } from './soa-data';

// "Each person's sheet" in the SOA full workbook (Vincent / Chelsea, 2026-10-07) — the SAME rule as the
// on-screen "My book" filter on the All page (app/billing/soa/_components.tsx picScoped), so a person's
// sheet and their screen never disagree:
//   - a row is the person's when its Main PIC (derivedOwner, INV-PIC-009) is them, or — when it has no Main
//     PIC at all — when they are among its PIC options;
//   - the sheet then keeps the client's WHOLE card: every source (TAB / TAC / TAO) of any client they own a
//     source of, even the sources someone else owns ("也需要放在自己的 SHEET 内").
// Pure (no I/O) so it can be tested on its own.

const groupKey = (companyName: string) => normalize(companyName) || companyName.trim().toLowerCase();

export function ownsSoaRow(row: SoaCompanyRowWithSource, person: string): boolean {
  const owner = derivedOwner(row);
  return owner ? owner === person : row.picOptions.includes(person);
}

/** Everyone who owns, or could own, at least one of these rows — one sheet each. */
export function peopleWithBooks(rows: readonly SoaCompanyRowWithSource[]): string[] {
  const people = new Set<string>();
  for (const row of rows) {
    const owner = derivedOwner(row);
    if (owner) people.add(owner);
    else for (const option of row.picOptions) people.add(option);
  }
  // The status code BD ("Bad Debt") sorts last, after the real people.
  return [...people].sort((a, b) => (a === 'BD' ? 1 : b === 'BD' ? -1 : a.localeCompare(b)));
}

/** The person's whole book: every source of every client they own a source of, in the rows' own order. */
export function rowsInPersonBook(rows: readonly SoaCompanyRowWithSource[], person: string): SoaCompanyRowWithSource[] {
  const keys = new Set(rows.filter(row => ownsSoaRow(row, person)).map(row => groupKey(row.companyName)));
  return rows.filter(row => keys.has(groupKey(row.companyName)));
}

export function personLabel(person: string): string {
  return person === 'BD' ? 'Bad Debt' : person;
}

/** An Excel-safe, unique sheet name (<= 31 chars, none of \ / ? * [ ] :). */
export function sheetNameForPerson(person: string, taken: Set<string>): string {
  const base = personLabel(person).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Person';
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}
