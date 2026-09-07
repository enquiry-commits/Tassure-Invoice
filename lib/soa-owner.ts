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

// Vincent, 2026-09-07, from a real example: "1V Capital Pte Ltd" — his own
// A/R Ageing sheet lists BOTH "CKY" and "JF" on its PIC column, and a real
// invoice confirms why: its Accounts lines carry Class="Lee Jing Fei" while
// a separate, more recent invoice carries Class="Chin Kah Ye" — genuinely
// two different people have touched this account's real billing over time,
// not one. "确实最终PIC 是CKY，但是LJF也是负责人之一，真正在系统的显示应该
// 是PIC：CKY,LJF" — computeSuggestedOwner() (above) still correctly picks
// ONE most-likely current owner for the Owner column (most-recent-invoice-
// first), but the PIC column needs the full set, not just the winner.
// Scans every line's Class across ALL of a customer's invoices (not just
// the most recent) — Location is deliberately excluded here (unlike the
// Owner fallback above): it's a per-*operator* QB-login tag (INV-QB-013),
// so pooling it into "everyone who touched this account" would flood PIC
// with whoever happened to key the invoice in, not who the service is for.
export function collectInvolvedStaff(
  invoices: OwnerInvoiceSignal[],
  classNamesByInvoice: Map<string, string[]>,
): string[] {
  const seen = new Set<string>();
  for (const inv of invoices) {
    for (const className of classNamesByInvoice.get(inv.qbInvoiceId) ?? []) {
      const resolved = resolveStaffName(className);
      if (resolved) seen.add(resolved);
    }
  }
  return [...seen];
}
