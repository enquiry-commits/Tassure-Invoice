import 'server-only';

import { computeAllCompanyBilling } from '@/app/api/billing/renewals/route';
import { normalize, findUniqueBestMatch } from './company-name';
import { computeDraftLines, computeDraftTotals, type EditableLine } from './billing-draft';
import { fyeDateString } from './invoice-templates';

// Added 2026-09-08 for the assistant chat's new preview_invoice_draft tool
// (Vincent: "假设我真的要你执行，你能不能做到一步一步的引导，当遇到敏感的
// 情况，就跳出弹窗要用户确认继续"). READ-ONLY by design — calls the exact
// same computeAllCompanyBilling() Billing Drafts itself uses (extracted
// from app/api/billing/renewals/route.ts, verbatim, not a re-derived copy)
// and the ported computeDraftLines() (lib/billing-draft.ts), then narrows
// to one company the same way app/billing/page.tsx's own renewalByName
// lookup does — exact normalize() match first, fuzzy findUniqueBestMatch()
// fallback (both from lib/company-name.ts, the one shared matcher this
// codebase already uses everywhere else for this exact problem).
//
// Deliberately does NOT touch invoice_creation_reservations or generate an
// idempotency key — per docs/INVARIANTS.md INV-QB-006, a stale pending/
// uncertain reservation row blocks that DocNumber forever until manually
// cleared, so nothing calling this function may ever speculatively reserve
// or create a real invoice. This is step 1 of the agentic flow (preview
// only) — the real confirm-and-execute step is a deliberately separate,
// later piece of work, not built yet.
export type InvoicePreview = {
  companyName: string;
  // 2026-09-08: added so the real "Confirm & Generate" step (Vincent:
  // "不能直接和用户确认后弹出真正的弹窗吗") can submit to the EXACT same
  // /api/quickbooks/create-invoice payload app/billing/page.tsx itself
  // sends — companyId resolves the parent Bill-To override, pic sets the
  // TAB Secretary/XBRL Class, email is the default recipient. Preview-only
  // consumers (the assistant's text reply) can ignore these.
  companyId: number | null;
  email: string | null;
  pic: string | null;
  uen: string | null;
  fyeMonth: string | null;
  fyeCycle: string;
  lines: EditableLine[];
  totals: { tab: number; tac: number };
  alreadyInvoicedThisCycle: boolean;
  warnings: string[];
};

export type InvoicePreviewResult =
  | { found: true; preview: InvoicePreview }
  | { found: false; suggestions: string[] };

export async function previewInvoiceDraft(companyQuery: string, fyeYear?: number): Promise<InvoicePreviewResult> {
  const trimmed = companyQuery.trim();
  const { results } = await computeAllCompanyBilling(90);
  const byName = new Map(results.map(c => [normalize(c.companyName), c] as const));

  let company = byName.get(normalize(trimmed));
  if (!company) {
    const match = findUniqueBestMatch(trimmed, [...byName.entries()], entry => entry[0], 70).value;
    if (match) company = match[1];
  }
  if (!company) {
    const q = normalize(trimmed);
    const suggestions = results
      .filter(c => normalize(c.companyName).includes(q))
      .slice(0, 5)
      .map(c => c.companyName);
    return { found: false, suggestions };
  }

  const currentYear = fyeYear ?? new Date().getFullYear();
  const cycleFye = company.fyeMonth ? fyeDateString(company.fyeMonth, currentYear) : undefined;
  const lines = computeDraftLines(company, currentYear, cycleFye);
  const totals = computeDraftTotals(lines);
  const alreadyInvoicedThisCycle = !!(cycleFye && (company.billedCycles ?? []).includes(cycleFye));
  const warnings = lines
    .filter(l => l.periodNeedsReview || /⚠/.test(l.reason))
    .map(l => `${l.service}: ${l.reason}`);

  return {
    found: true,
    preview: {
      companyName: company.companyName,
      companyId: company.resolvedCompanyId,
      email: company.email,
      pic: company.pic,
      uen: company.uen,
      fyeMonth: company.fyeMonth,
      fyeCycle: cycleFye ?? '',
      lines,
      totals,
      alreadyInvoicedThisCycle,
      warnings,
    },
  };
}
