import { thisYearSGT } from '@/lib/date';
import 'server-only';

import { computeAllCompanyBilling } from '@/app/api/billing/renewals/route';
import { normalize, findUniqueBestMatch } from './company-name';
import { fyeDateString } from './invoice-templates';
import { getLiveInvoice, type LiveInvoiceLine } from './quickbooks-invoice-lines';
import type { QbCompany } from './quickbooks';

// Phase 3 of the agentic-chat direction (2026-09-09, after invoicing and
// Late Filing) — this one is genuinely different in shape: unlike a new
// invoice draft, there is no algorithmic way to compute "what the edit
// should be." The human has to STATE the change (e.g. "change the TAB
// Secretary line to $700"); this module's job is to find the real current
// invoice, apply the stated change(s) to a COPY of its real lines, and
// produce a before/after diff for the UI — the actual write still goes
// through the exact same /api/quickbooks/update-invoice endpoint
// app/billing/page.tsx's own saveInvoiceEdit() calls, with all its real
// gates (structural/sent/payment/void/SyncToken) unchanged.
export type InvoiceEditChange = {
  // Which existing line to target — matched case-insensitively against
  // the line's `service` (e.g. "Secretary", "Address", "ND", "AR", "XBRL")
  // first; if that doesn't match anything, falls back to a substring match
  // against the line's real description. Never invents a new line — a
  // change that matches nothing is reported back as unmatched, not
  // silently dropped or appended.
  service?: string;
  matchDescription?: string;
  newRate?: number;
  newQty?: number;
  newDescription?: string;
};

export type InvoiceEditPreview = {
  companyName: string;
  qbCompany: QbCompany;
  qbInvoiceId: string;
  docNumber: string;
  pic: string | null;
  currentLines: LiveInvoiceLine[];
  proposedLines: LiveInvoiceLine[];
  changesSummary: string[];
  unmatchedChanges: string[];
  currentTotal: number;
  proposedTotal: number;
  // Added 2026-09-09 so the frontend's "Open in Billing Drafts" deep link
  // (app/my-tasks/page.tsx) can load the SAME FYE cycle this invoice
  // belongs to before searching for the company — without this, the page
  // would search whatever cycle it happens to have loaded (usually the
  // latest one) and silently fail to find an older/different cycle.
  fyeMonth: string | null;
  fyeCycle: string;
};

export type InvoiceEditResult =
  | { found: true; preview: InvoiceEditPreview }
  | { found: false; message: string; suggestions?: string[] };

export async function previewInvoiceEdit(
  companyQuery: string,
  qbCompanyHint: QbCompany | undefined,
  changes: InvoiceEditChange[],
): Promise<InvoiceEditResult> {
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
    const suggestions = results.filter(c => normalize(c.companyName).includes(q)).slice(0, 5).map(c => c.companyName);
    return { found: false, message: `No company matched "${companyQuery}".`, suggestions };
  }

  const currentYear = thisYearSGT();
  const cycleFye = company.fyeMonth ? fyeDateString(company.fyeMonth, currentYear) : undefined;
  const thisCycleInvoices = (company.generatedInvoices ?? []).filter(g => g.fyeCycle === cycleFye);
  if (!thisCycleInvoices.length) {
    return { found: false, message: `${company.companyName} has no generated invoice for the current cycle (FYE ${cycleFye ?? 'unknown'}) to edit — only an already-created invoice can be edited here.` };
  }
  const target = qbCompanyHint
    ? thisCycleInvoices.find(g => g.qbCompany === qbCompanyHint)
    : thisCycleInvoices[0];
  if (!target?.qbId) {
    return { found: false, message: `No ${qbCompanyHint ?? 'TAB/TAC'} invoice found for ${company.companyName} this cycle.` };
  }

  const live = await getLiveInvoice(target.qbCompany as QbCompany, target.qbId);
  if (!live) return { found: false, message: `Invoice #${target.invoiceNo} no longer exists in QuickBooks.` };

  const proposedLines = live.lines.map(l => ({ ...l }));
  const changesSummary: string[] = [];
  const unmatchedChanges: string[] = [];
  for (const change of changes) {
    const idx = proposedLines.findIndex(l =>
      (change.service && l.service.toLowerCase() === change.service.trim().toLowerCase())
      || (change.matchDescription && l.description.toLowerCase().includes(change.matchDescription.trim().toLowerCase())),
    );
    if (idx === -1) {
      unmatchedChanges.push(`No line matched "${change.service ?? change.matchDescription ?? '(unspecified)'}"`);
      continue;
    }
    const before = { ...proposedLines[idx] };
    if (change.newRate !== undefined) proposedLines[idx].rate = change.newRate;
    if (change.newQty !== undefined) proposedLines[idx].qty = change.newQty;
    if (change.newDescription !== undefined) proposedLines[idx].description = change.newDescription;
    const parts: string[] = [];
    if (before.rate !== proposedLines[idx].rate) parts.push(`rate $${before.rate} → $${proposedLines[idx].rate}`);
    if (before.qty !== proposedLines[idx].qty) parts.push(`qty ${before.qty} → ${proposedLines[idx].qty}`);
    if (before.description !== proposedLines[idx].description) parts.push('description changed');
    changesSummary.push(`${proposedLines[idx].service}: ${parts.join(', ') || 'no actual change'}`);
  }

  const currentTotal = live.lines.reduce((s, l) => s + l.qty * l.rate, 0);
  const proposedTotal = proposedLines.reduce((s, l) => s + l.qty * l.rate, 0);

  return {
    found: true,
    preview: {
      companyName: company.companyName,
      qbCompany: target.qbCompany as QbCompany,
      qbInvoiceId: target.qbId,
      docNumber: live.docNumber,
      pic: company.pic,
      currentLines: live.lines,
      proposedLines,
      changesSummary,
      unmatchedChanges,
      currentTotal,
      proposedTotal,
      fyeMonth: company.fyeMonth,
      fyeCycle: cycleFye ?? '',
    },
  };
}
