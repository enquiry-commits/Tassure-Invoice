import { resolveStaffName, teamForName, type StaffTeam } from './staff-directory';
import type { QbCompany } from './quickbooks';

// Vincent, 2026-09-17 (WhatsApp, relayed via chat), pointing at real A/R
// Ageing exports: TAO's PIC filter listed Corporate Secretarial names
// ("TAO 为什么会出现sec 的人？不是讲tao只会有acc和tax的人吗") and TAB's listed
// Accounting names ("tab 要只会有sec的人，谁做就是谁的名"). TAO is Accounts/
// Tax's own QuickBooks book (docs/INVARIANTS.md INV-DATA-041) and TAB is
// Corporate Secretarial's — a real QB Class/Location tag, or `companies.pic`
// (always a Corporate Secretarial value, unioned into every book's
// picOptions below), can still resolve to a name outside that book's own
// team, and that must not surface as the book's PIC. TAC deliberately has no
// entry: its PIC is the current Nominee Director (INV-QB-008), not a
// staff-team-restricted signal, and Vincent gave no rule for it here.
const PIC_TEAMS_BY_COMPANY: Partial<Record<QbCompany, StaffTeam[]>> = {
  TAB: ['Corporate Secretarial'],
  TAO: ['Accounting', 'Tax'],
};

// Exported for lib/soa-data.ts, which also needs to filter `companies.pic`
// (a signal that never goes through computeSuggestedOwner/collectInvolvedStaff
// below) by the same per-company team rule.
export function picAllowedForCompany(resolvedName: string, company: QbCompany): boolean {
  const teams = PIC_TEAMS_BY_COMPANY[company];
  if (!teams) return true;
  const team = teamForName(resolvedName);
  return team !== null && teams.includes(team);
}

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
  company: QbCompany,
): string | null {
  const sorted = [...invoices].sort((a, b) => b.txnDate.localeCompare(a.txnDate));
  for (const inv of sorted) {
    for (const className of classNamesByInvoice.get(inv.qbInvoiceId) ?? []) {
      const resolved = resolveStaffName(className);
      if (resolved && picAllowedForCompany(resolved, company)) return resolved;
    }
    const resolvedLocation = resolveStaffName(inv.locationName);
    if (resolvedLocation && picAllowedForCompany(resolvedLocation, company)) return resolvedLocation;
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
//
// SUPERSEDED 2026-09-17: Vincent, re-examining real A/R Ageing exports,
// confirmed that a TAB invoice's Accounts line carrying an Accounting-team
// Class (like the 1V Capital/"JF" case above) is itself a mistagged real
// invoice, not a genuine cross-team co-assignment — TAB's PIC must never
// include anyone outside Corporate Secretarial, same for TAO/Accounting+Tax
// (docs/INVARIANTS.md INV-PIC-007). picAllowedForCompany() below now drops
// such a Class before it ever reaches `seen`, so a case shaped like 1V
// Capital again would show ONLY "Chin Kah Ye" on TAB, not both.
export function collectInvolvedStaff(
  invoices: OwnerInvoiceSignal[],
  classNamesByInvoice: Map<string, string[]>,
  company: QbCompany,
): string[] {
  const seen = new Set<string>();
  for (const inv of invoices) {
    for (const className of classNamesByInvoice.get(inv.qbInvoiceId) ?? []) {
      const resolved = resolveStaffName(className);
      if (resolved && picAllowedForCompany(resolved, company)) seen.add(resolved);
    }
  }
  return [...seen];
}
