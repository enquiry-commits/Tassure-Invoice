// Who an SOA email draft is addressed to, and which invoices its body lists — the two decisions the single-company draft
// lookup (/api/client-communications/campaigns/preview GET) makes, kept here as plain functions so they can be tested
// without a database. Pure on purpose: no query, no server-only import (the route and lib/client-comms-resolve.ts load the
// data and hand it in), so `npx tsx test-soa-draft-resolution.ts` can run it. docs/INVARIANTS.md INV-MAIL-006.
import { normalize, findUniqueBestMatch } from './company-name';
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
 * used (exact normalized name, then the unique fuzzy match). `everyCompany` is given ONLY for an SOA lookup; for it the exact
 * match over every company comes FIRST, so a company that is not on the live roster is never skipped in favour of a fuzzy
 * match to a similarly named one that is.
 */
export function resolveDraftCompany(lookup: string, findActive: CompanyFinder, everyCompany?: readonly CompanyRow[]): CompanyRow | null {
  return (everyCompany ? findSoaDebtorCompany(lookup, everyCompany) : null) ?? findActive(lookup);
}

export const SOA_BOOKS: readonly QbCompany[] = ['TAB', 'TAC', 'TAO'];

function refsInBook(refs: readonly InvoiceRef[], book: QbCompany): InvoiceRef[] {
  return refs.filter(r => r.qbCompany === book);
}

/** One book: the customer the attached SOA PDF of that book is built from (app/api/billing/soa/pdf/route.ts). */
function matchedCustomerRefs(lookup: string, invoicesByCompany: ReadonlyMap<string, InvoiceRef[]>, book: QbCompany): InvoiceRef[] {
  const exact = refsInBook(invoicesByCompany.get(normalize(lookup)) ?? [], book);
  if (exact.length) return exact;
  // Only customers that have something open in THIS book are candidates, exactly as the PDF route's `byName` is built from
  // this book's open invoices; a tie is "ambiguous" and picks nothing (findUniqueBestMatch), never the first row.
  const candidates = [...invoicesByCompany.entries()].filter(([, refs]) => refs.some(r => r.qbCompany === book));
  const match = findUniqueBestMatch(lookup, candidates, entry => entry[0], 70).value;
  return match ? refsInBook(match[1], book) : [];
}

/**
 * The invoices the BODY of an SOA draft lists, so it can never list nothing while the attached statement shows a balance.
 *
 * The body is built from what sits under the company's own name (`ownKey`, the normalized name in the company list); the
 * attachment is built from QuickBooks' customer for the name that was clicked, which the PDF route finds with a fuzzy match
 * when the two spell the name differently ('SOON & GUAN MANPOWER TRAINING' vs QuickBooks' 'Soon & Guan Manpower Trading').
 * For every book in `books` where the company's own name has nothing, this adds the same customer's invoices in that book.
 * Everything the company's own name already has is kept exactly as it is, so a draft that already worked is unchanged.
 */
export function soaBodyInvoices(
  lookup: string, ownKey: string, invoicesByCompany: ReadonlyMap<string, InvoiceRef[]>, books: readonly QbCompany[],
): InvoiceRef[] {
  const own = invoicesByCompany.get(ownKey) ?? [];
  const out = [...own];
  for (const book of books) {
    if (own.some(r => r.qbCompany === book)) continue;
    out.push(...matchedCustomerRefs(lookup, invoicesByCompany, book));
  }
  return out;
}
