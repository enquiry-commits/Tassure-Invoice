import { responsiblePeople } from './soa-main-pic';
import { normalize } from './company-name';
import type { SoaCompanyRowWithSource } from './soa-data';

// "Each person's sheet" in the SOA full workbook (Vincent / Chelsea, 2026-10-07) — the SAME rule as the
// on-screen "My book" filter on the All page (app/billing/soa/_components.tsx picScoped), so a person's
// sheet and their screen never disagree:
//   - a row is the person's when they are among the people responsible for it (everyone the PIC column lists,
//     INV-PIC-011 — there is no Main PIC any more; "BD" is the Bad Debt sheet);
//   - the sheet then keeps the client's WHOLE card: every source (TAB / TAC / TAO) of any client they are
//     responsible for a source of, even the sources someone else looks after ("也需要放在自己的 SHEET 内").
// Pure (no I/O) so it can be tested on its own.

const groupKey = (companyName: string) => normalize(companyName) || companyName.trim().toLowerCase();

export function ownsSoaRow(row: SoaCompanyRowWithSource, person: string): boolean {
  const people = responsiblePeople(row);
  return (people.length ? people : row.picShown).includes(person);
}

/** Everyone responsible for at least one of these rows — one sheet each. */
export function peopleWithBooks(rows: readonly SoaCompanyRowWithSource[]): string[] {
  const people = new Set<string>();
  for (const row of rows) for (const person of responsiblePeople(row)) people.add(person);
  // The status code BD ("Bad Debt") sorts last, after the real people.
  return [...people].sort((a, b) => (a === 'BD' ? 1 : b === 'BD' ? -1 : a.localeCompare(b)));
}

/** The person's whole book: every source of every client they are responsible for a source of, in the rows' own order. */
export function rowsInPersonBook(rows: readonly SoaCompanyRowWithSource[], person: string): SoaCompanyRowWithSource[] {
  const keys = new Set(rows.filter(row => ownsSoaRow(row, person)).map(row => groupKey(row.companyName)));
  return rows.filter(row => keys.has(groupKey(row.companyName)));
}

export function personLabel(person: string): string {
  return person === 'BD' ? 'Bad Debt' : person;
}

/** An Excel-safe, unique sheet name (<= 31 chars, none of \\ / ? * [ ] :). */
export function sheetNameForPerson(person: string, taken: Set<string>): string {
  const base = personLabel(person).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Person';
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  taken.add(name.toLowerCase());
  return name;
}
