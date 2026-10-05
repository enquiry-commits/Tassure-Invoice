// Accounting's "Deferred Revenue" twins (docs/INVARIANTS.md INV-QB-029).
//
// After an invoice has gone to the client, Chelsea splits a service's fee in
// QuickBooks into this-year + a "Deferred Revenue" line (e.g. Secretary 175 +
// "Deferred Revenue - Corp Sec" 525). That split is accounting's and STAYS in
// QuickBooks. Everything the SYSTEM shows for the service — the Billing Drafts
// invoice editor (Vincent, 2026-10-05: "在编辑页面显示 Secretary 服务 700 就可以
// 了") and, next, the invoice PDF clients receive — shows it ONCE at its full
// amount. This module decides which deferred line belongs to which service
// line. Pure (no I/O), shared by the browser editor and the server.
//
// Pairing is by item NAME family, never by position or by equal amounts —
// measured on 2026's 526 split invoices: most twins sit right under their
// service, but 56 are the invoice's first line, 23 follow another deferred
// line, 3 sit under an unrelated line, and the two halves are equal in only
// 124 of 657 pairs. When anything is unclear the result is not ok and callers
// show / send QuickBooks' lines unchanged (Vincent: fall back, and tell staff).

export type PairableLine = {
  productService: string;
  description: string;
  qty: number;
  rate: number;
};

type Family = 'corpsec' | 'regaddr' | 'nd' | 'payroll' | 'cpf';
type FamilyKey = { family: Family; ndInitials: string | null };

export const isDeferredItem = (productService: string | null | undefined): boolean =>
  /\bdeferred\b/i.test(productService ?? '');

// ND initials as written on the item ("… - WYD", "… - LXM." → "LXM").
const initialsAfterDash = (s: string): string | null => {
  const m = s.match(/-\s*([A-Za-z]{1,6})\.?\s*$/);
  return m ? m[1].toUpperCase() : null;
};

function deferredFamily(productService: string): FamilyKey | null {
  const p = productService;
  if (/Deferred(?: Revenue)?\s*-\s*Corp Sec/i.test(p)) return { family: 'corpsec', ndInitials: null };
  if (/Deferred(?: Revenue)?\s*-\s*Reg(?:istered)? Addr/i.test(p)) return { family: 'regaddr', ndInitials: null };
  if (/Deferred(?: Revenue)?\s*-\s*ND\b/i.test(p)) {
    const rest = p.replace(/^.*Deferred(?: Revenue)?\s*-\s*ND(?:\s*Fees)?/i, '');
    return { family: 'nd', ndInitials: rest.trim() ? initialsAfterDash(rest) : null };
  }
  if (/Deferred(?: Revenue)?\s*-\s*Payroll/i.test(p)) return { family: 'payroll', ndInitials: null };
  if (/Deferred(?: Revenue)?\s*-\s*CPF/i.test(p)) return { family: 'cpf', ndInitials: null };
  return null;
}

function primaryFamily(productService: string): FamilyKey | null {
  const p = productService;
  if (isDeferredItem(p)) return null;
  if (/Co(?:r)?porate Secretarial Services|Secretary Fees - Offshore/i.test(p)) return { family: 'corpsec', ndInitials: null };
  if (/Registered Address Services/i.test(p)) return { family: 'regaddr', ndInitials: null };
  if (/Nominee Director Fees/i.test(p)) {
    const rest = p.replace(/^.*Nominee Director Fees/i, '');
    return { family: 'nd', ndInitials: rest.trim() ? initialsAfterDash(rest) : null };
  }
  if (/Payroll/i.test(p)) return { family: 'payroll', ndInitials: null };
  if (/CPF Submission/i.test(p)) return { family: 'cpf', ndInitials: null };
  return null;
}

const sameFamily = (d: FamilyKey, p: FamilyKey): boolean =>
  d.family === p.family && (d.family !== 'nd' || d.ndInitials === null || d.ndInitials === p.ndInitials);

export type DeferredGroup = { primary: number; deferred: number[] };

export type DeferredPairing =
  | { ok: true; groups: DeferredGroup[] }
  | { ok: false; reasons: string[] };

const cents = (n: number) => Math.round(n * 100);
const lineAmount = (l: PairableLine) => cents(l.qty * l.rate) / 100;

export function pairDeferredLines(lines: readonly PairableLine[]): DeferredPairing {
  const reasons: string[] = [];
  const byPrimary = new Map<number, number[]>();
  lines.forEach((line, i) => {
    if (!isDeferredItem(line.productService)) return;
    const label = `"${line.productService}"`;
    const fam = deferredFamily(line.productService);
    if (!fam) { reasons.push(`${label} is not a deferred item this system knows how to pair`); return; }
    const candidates: number[] = [];
    lines.forEach((other, j) => {
      const pf = primaryFamily(other.productService);
      if (pf && sameFamily(fam, pf)) candidates.push(j);
    });
    let primary: number | null = null;
    if (candidates.length === 1) primary = candidates[0];
    else if (candidates.length > 1) {
      // Several lines of the same service: the nearest one ABOVE the twin.
      const above = candidates.filter(j => j < i);
      primary = above.length ? above[above.length - 1] : null;
      if (primary === null) { reasons.push(`${label} has several possible service lines and none above it`); return; }
    } else {
      reasons.push(`${label} has no matching service line on this invoice`);
      return;
    }
    const p = lines[primary];
    // A twin may repeat (part of) its service's own text — Mandi Capital TAB
    // #02610362's twin carries the service line's first sentence — and is
    // still just its deferred half. Text the service line does NOT contain
    // means something else: Anmed TAC #02680138's twin covers "Jan 2027 -
    // Mar 2027" while its service line says "Apr 2026 - Dec 2026", and one
    // merged line could not describe both honestly.
    const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
    const ownText = norm(line.description);
    if (ownText && !norm(p.description).includes(ownText)) {
      reasons.push(`${label} has its own description, so it is not just the deferred half of "${p.productService}"`);
      return;
    }
    if (line.qty !== 1 || p.qty !== 1) {
      reasons.push(`${label} or its service line has a quantity other than 1`);
      return;
    }
    byPrimary.set(primary, [...(byPrimary.get(primary) ?? []), i]);
  });
  if (reasons.length) return { ok: false, reasons };
  const groups = [...byPrimary.entries()].sort((a, b) => a[0] - b[0]).map(([primary, deferred]) => ({ primary, deferred }));
  return { ok: true, groups };
}

// The lines a person should see: each service once, its deferred twin(s)
// folded into it. Every input line lands in exactly one output entry, so the
// amounts always add up to the invoice's own total.
export function mergeDeferredForDisplay<T extends PairableLine>(
  lines: readonly T[],
): { ok: true; lines: Array<{ line: T; amount: number; parts: { primary: T; deferred: T[] } | null }> } | { ok: false; reasons: string[] } {
  const pairing = pairDeferredLines(lines);
  if (!pairing.ok) return pairing;
  const twinOf = new Map<number, number[]>(pairing.groups.map(g => [g.primary, g.deferred]));
  const folded = new Set(pairing.groups.flatMap(g => g.deferred));
  const out: Array<{ line: T; amount: number; parts: { primary: T; deferred: T[] } | null }> = [];
  lines.forEach((line, i) => {
    if (folded.has(i)) return;
    const twins = (twinOf.get(i) ?? []).map(k => lines[k]);
    const amountCents = cents(lineAmount(line)) + twins.reduce((s, d) => s + cents(lineAmount(d)), 0);
    out.push({ line, amount: amountCents / 100, parts: twins.length ? { primary: line, deferred: twins } : null });
  });
  return { ok: true, lines: out };
}

// Turns a merged service line back into QuickBooks' real lines on save.
// Unchanged amount → the service line and its twin(s) exactly as they were.
// A changed amount moves the difference onto the service line and leaves the
// twins untouched — Chelsea re-splits in QuickBooks herself (Vincent,
// 2026-10-05: "这个你不需要操心，Chelsea 会自己到QB额外修改"). A new amount at or
// below the deferred part would make the service line zero or negative, so
// it is refused.
export function expandMergedAmount<T extends PairableLine>(
  primary: T,
  deferred: readonly T[],
  newAmount: number,
): { ok: true; primary: T; deferred: readonly T[] } | { ok: false; error: string } {
  const deferredCents = deferred.reduce((s, d) => s + cents(lineAmount(d)), 0);
  const originalCents = cents(lineAmount(primary)) + deferredCents;
  const nextCents = cents(newAmount);
  if (nextCents === originalCents) return { ok: true, primary, deferred };
  const primaryCents = nextCents - deferredCents;
  if (primaryCents <= 0) {
    return {
      ok: false,
      error: `"${primary.productService}" can't be set to S$${(nextCents / 100).toFixed(2)}: accounting has S$${(deferredCents / 100).toFixed(2)} of it on a Deferred Revenue line in QuickBooks. Ask Chelsea to change it there.`,
    };
  }
  return { ok: true, primary: { ...primary, qty: 1, rate: primaryCents / 100 }, deferred };
}
