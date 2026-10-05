import { classifyRenewalFeeProduct } from './invoice-period';

// The ONE place a TAB/TAC QuickBooks item (as picked from Billing Drafts'
// live item list) is mapped to the draft line's `service`. `service` drives
// real behaviour there — the default PIC (INV-QB-007: Secretary/XBRL only),
// the renewal-period check (INV-QB-033: renewal items only), the AR/XBRL
// statement-memo wording and which line counts as the AR fee — so it must not
// simply be the item's QuickBooks category (a council finding, 2026-10-05:
// "Secretary:ACRA Fees" filed as Secretary would demand a PIC and read as
// "Sec" in the memo). Pure: safe in the browser and in tests.
//
// Returns null for an item Billing Drafts must never offer: accounting's
// Deferred Revenue twins (INV-QB-029).
export function classifyCatalogItem(fullyQualifiedName: string): string | null {
  const name = fullyQualifiedName.trim();
  if (/(^|:)Deferred/i.test(name)) return null;
  const renewal = classifyRenewalFeeProduct(name);
  if (renewal?.role === 'primary') return renewal.service;          // Secretary / Address / ND
  if (/Nominee Director (Fees|Deposit)/i.test(name)) return 'ND';    // e.g. "Nominee Director Fees - EL" (top-level), deposits
  if (/xbrl/i.test(name)) return 'XBRL';
  if (/Government fee for filing Annual Return/i.test(name)) return 'AR';
  if (/discount/i.test(name)) return 'Discount';
  if (/^Accounts:/i.test(name)) return 'Accounts';
  if (/^Tax:/i.test(name)) return 'Tax';
  // Government/ACRA fees and every disbursement are pass-through charges:
  // no PIC, named by their item in the memo.
  if (/^Disbursement:/i.test(name) || /acra fees|government fee/i.test(name)) return 'Other';
  if (/^Secretary:/i.test(name)) return 'Secretary';                // one-off secretarial work
  return 'Other';                                                    // Contra, Sales, Reimbursement, Rental…
}
