// Who an SOA email draft is addressed to, and which invoices its body lists — the two decisions the single-company draft
// lookup (/api/client-communications/campaigns/preview GET) makes, kept here as plain functions so they can be tested
// without a database. Pure on purpose: no query, no server-only import (the route and lib/client-comms-resolve.ts load the
// data and hand it in), so `npx tsx test-soa-draft-resolution.ts` can run it. docs/INVARIANTS.md INV-MAIL-006.
import { normalize, findUniqueBestMatch, matchScore } from './company-name';
import { isActiveCompany } from './company-lifecycle';
import type { CompanyRow } from './client-comms-resolve';
import type { InvoiceRef } from './email-merge';
import type { QbCompany } from './quickbooks';

export type CompanyFinder = (name: string) => CompanyRow | null;

/**
 * A debt outlives the client relationship, and an SOA is how it is chased. Vincent, 2026-10-07: the company can be inactive,
 * Terminated, Striking Off or no longer in TeamWork at all — "我们还是需要发SOA 去追债". So the SOA draft lookup (and ONLY
 * that: AR, letters and Campaign Centre's bulk list keep their active-only rule, INV-TW-024 / INV-AR-017 / INV-AR-018) may
 * resolve a company that is not on the live roster.
 *
 * EXACT (normalized) name, never a fuzzy match: a fuzzy match could hand an inactive company's draft to a similarly named
 * ACTIVE company's contacts, with the wrong statement attached — a collections email to the wrong client. Among rows that
 * share the name the live one wins; otherwise the lowest id (the list arrives ordered by id).
 */
export function findSoaDebtorCompany(lookup: string, everyCompany: readonly CompanyRow[]): CompanyRow | null {
  const wanted = normalize(lookup);
  if (!wanted) return null;
  const sameName = everyCompany.filter(c => normalize(c.company_name) === wanted);
  return sameName.find(isActiveCompany) ?? sameName[0] ?? null;
}

/**
 * The company a single-company draft lookup resolves to. `findActive` is the live-roster finder every draft lookup always
 * used (exact normalized name, then the unique fuzzy match (>= 70)). `everyCompany` is given ONLY for an SOA lookup; for it
 * the exact match over every company comes FIRST, so a company that is not on the live roster is never skipped in favour of
 * a fuzzy match to a similarly named one that is.
 */
export function resolveDraftCompany(lookup: string, findActive: CompanyFinder, everyCompany?: readonly CompanyRow[]): CompanyRow | null {
  return (everyCompany ? findSoaDebtorCompany(lookup, everyCompany) : null) ?? findActive(lookup);
}

export const SOA_BOOKS: readonly QbCompany[] = ['TAB', 'TAC', 'TAO'];

function refsInBook(refs: readonly InvoiceRef[], book: QbCompany): InvoiceRef[] {
  return refs.filter(r => r.qbCompany === book);
}

/**
 * The customers the attached statement of `book` can be built from: the SOA PDF route (app/api/billing/soa/pdf/route.ts) matches
 * the name against customers with an open INVOICE in that book (a journal entry, payment or credit note alone is no candidate;
 * only invoice refs carry a `qbInvoiceId`).
 */
function statementCandidates(invoicesByCompany: ReadonlyMap<string, InvoiceRef[]>, book: QbCompany): Array<[string, InvoiceRef[]]> {
  return [...invoicesByCompany.entries()].filter(([, refs]) => refs.some(r => r.qbCompany === book && !!r.qbInvoiceId));
}

/** The customer the statement of `book` takes through its fuzzy step (unique best >= 70; a tie picks nothing), or null. */
function fuzzyCustomer(lookup: string, invoicesByCompany: ReadonlyMap<string, InvoiceRef[]>, book: QbCompany): [string, InvoiceRef[]] | null {
  return findUniqueBestMatch(lookup, statementCandidates(invoicesByCompany, book), entry => entry[0], 70).value;
}

/**
 * The customer keys the body would take through the fuzzy step — one per book where the lookup's own name has nothing. The route
 * uses it to load the company list only when it is needed.
 */
export function soaBodyFuzzyKeys(lookup: string, invoicesByCompany: ReadonlyMap<string, InvoiceRef[]>, books: readonly QbCompany[]): string[] {
  const exact = invoicesByCompany.get(normalize(lookup)) ?? [];
  const keys: string[] = [];
  for (const book of books) {
    if (exact.some(r => r.qbCompany === book)) continue;
    const match = fuzzyCustomer(lookup, invoicesByCompany, book);
    if (match) keys.push(match[0]);
  }
  return keys;
}

/**
 * True when the QuickBooks customer `customerKey` fits ANOTHER company in the company list at least as well as it fits this one — so
 * it is that company's customer, not ours. This is the guard against the look-alike: "Yu An (SGP) Holding" and "Yu An Bulk Holding"
 * are two clients, but score 75 against each other, so in a book where only the second has an invoice the statement's fuzzy step
 * hands the first one the second's invoice (real data, 2026-10-07: TAB #02610643 S$800). A tie counts as "theirs": a draft that
 * refuses is safe, one that lists another client's invoice is not. This company's own row, a duplicate row with the same name and
 * the lookup's own spelling are never "another company" (they all normalize to one of the two names kept in `mine`).
 */
export function customerBelongsToAnotherCompany(
  customerKey: string, lookup: string, own: Pick<CompanyRow, 'company_name'>, everyCompany: readonly Pick<CompanyRow, 'company_name'>[],
): boolean {
  const ours = Math.max(matchScore(customerKey, lookup), matchScore(customerKey, own.company_name));
  const mine = new Set([normalize(lookup), normalize(own.company_name)]);
  return everyCompany.some(c => !mine.has(normalize(c.company_name)) && matchScore(customerKey, c.company_name) >= ours);
}

/**
 * The invoices the BODY of an SOA draft lists, so it can never list nothing — or something else — while the attached statement shows
 * a balance. The statement is built from the QuickBooks customer found for the name that was clicked: exact normalized name, else the
 * unique best fuzzy match among that book's customers with an open invoice. The body used only the company's own exact name, so when
 * the two are spelled differently ('SOON & GUAN MANPOWER TRAINING' vs QuickBooks' 'Soon & Guan Manpower Trading') it listed
 * "(no invoices)" and S$0.00 beside a statement with a balance.
 *
 * Everything the lookup's own name already has is kept exactly as it is (every book, in its order); for each book in `books` where
 * it has nothing, the statement's fuzzy customer's invoices of that book are added — unless `belongsToOther` says that customer is
 * really another company's (customerBelongsToAnotherCompany), in which case nothing is added for that book.
 */
export function soaBodyInvoices(
  lookup: string, invoicesByCompany: ReadonlyMap<string, InvoiceRef[]>, books: readonly QbCompany[],
  belongsToOther?: (customerKey: string) => boolean,
): InvoiceRef[] {
  const exact = invoicesByCompany.get(normalize(lookup)) ?? [];
  const out = [...exact];
  for (const book of books) {
    if (exact.some(r => r.qbCompany === book)) continue;
    const match = fuzzyCustomer(lookup, invoicesByCompany, book);
    if (!match || belongsToOther?.(match[0])) continue;
    out.push(...refsInBook(match[1], book));
  }
  return out;
}
