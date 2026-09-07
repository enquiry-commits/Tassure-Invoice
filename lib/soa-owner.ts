import { resolveStaffName } from './staff-directory';

// Chelsea's real-world rule (relayed by Vincent, 2026-09-07): "PIC不是说谁
// 开单的 location那边，一般是服务的 class 那边的备注人员，如果class 没有才
// 是看location的" — a customer's real collections owner is whoever is
// tagged on their invoice LINE's Class (the primary signal); only when NO
// line on an invoice carries a resolvable Class does that invoice's own
// Location (set once per whole invoice) count as a fallback signal. This
// replaces manual Google Sheet backfill (`soa_owners` still exists as the
// explicit human OVERRIDE — this function only computes the DEFAULT when
// nobody has picked one).
export interface OwnerInvoiceSignal {
  qbInvoiceId: string;
  txnDate: string;
  locationName: string | null;
}

// Looks at a customer's own real invoices within ONE QuickBooks company,
// most recent first — whoever currently handles the account is more likely
// reflected by their LATEST invoice than an average across their history
// (a staff handoff should show up immediately, not get diluted by old
// invoices tagged to whoever had it before).
export function computeSuggestedOwner(
  invoices: OwnerInvoiceSignal[],
  classNamesByInvoice: Map<string, string[]>,
): string | null {
  const sorted = [...invoices].sort((a, b) => b.txnDate.localeCompare(a.txnDate));
  for (const inv of sorted) {
    for (const className of classNamesByInvoice.get(inv.qbInvoiceId) ?? []) {
      const resolved = resolveStaffName(className);
      if (resolved) return resolved;
    }
    const resolvedLocation = resolveStaffName(inv.locationName);
    if (resolvedLocation) return resolvedLocation;
  }
  return null;
}
