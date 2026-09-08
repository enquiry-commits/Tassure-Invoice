import type { CompanyBilling } from '@/app/api/billing/renewals/route';
import { QB_ITEM, MEDIAN_RATE, NAME_TO_INITIALS, secretaryDescription, addressDescription, arGovtFeeDescription, xbrlDescription, periodLabel, fyeDateString } from './invoice-templates';
import { rollRecurringDescriptionForward } from './invoice-period';
import { fmtDate } from './date';

// Ported 2026-09-08 from app/billing/page.tsx's ExpandedBillingRow's own
// `initialLines` useMemo (verbatim logic, verified line-by-line against the
// live component before porting) — for the assistant chat's new read-only
// invoice-preview tool (Vincent: "假设我真的要你执行，你能不能做到一步一
// 步的引导，当遇到敏感的情况，就跳出弹窗要用户确认继续"). This is
// DELIBERATELY a new, separate module rather than a change to the live
// Billing Drafts page itself — app/billing/page.tsx is untouched, a real
// revenue-critical page in daily use, and this first step only needs a
// server-side callable version of the SAME rules, not a rewrite of the
// page. The known tradeoff: two copies of the same logic exist until a
// later, separate step retrofits app/billing/page.tsx to import from here
// too (matching the precedent lib/company-name.ts's own header describes
// for consolidating exactly this kind of drift risk) — until that
// retrofit happens, a change to one must be mirrored in the other by hand;
// this file's own tests/verification must be re-run against the live
// page's real output whenever either changes.
export type EditableLine = {
  service: string;
  productService: string;
  description: string;
  qty: number;
  rate: number;
  include: boolean;
  due: boolean;
  reason: string;
  previousPeriodEnd?: string | null;
  periodNeedsReview?: boolean;
  periodReviewed?: boolean;
};

export function computeDraftLines(c: CompanyBilling, currentYear: number, cycleFye?: string): EditableLine[] {
  const out: EditableLine[] = [];
  const fyeStr = cycleFye ?? fyeDateString(c.fyeMonth, currentYear);
  const billedThisCycle = cycleFye ? (c.billedCycles ?? []).includes(cycleFye) : null;
  const ndInitials = c.ndPic ? NAME_TO_INITIALS[c.ndPic.trim().toUpperCase()] : undefined;
  const ndProductService = ndInitials ? `${QB_ITEM.ND} - ${ndInitials}` : QB_ITEM.ND;

  for (const r of c.renewals) {
    if (!r.applicable) continue;
    const due = r.status === 'expired' || r.status === 'expiring_soon';
    const last = r.history?.[0];
    const pLabel = periodLabel(r.suggestedPeriodStart, r.suggestedPeriodEnd);
    const templateDesc = r.service === 'Secretary' ? secretaryDescription(pLabel)
                       : r.service === 'Address'   ? addressDescription(pLabel)
                       : `Nominee Director for one year${pLabel ? ` (${pLabel})` : ''}`;
    const isND = r.service === 'ND';
    out.push({
      service: r.service,
      productService: isND ? (ndInitials ? ndProductService : last?.product_service ?? ndProductService) : last?.product_service ?? QB_ITEM[r.service] ?? '',
      description: templateDesc,
      qty: 1,
      rate: r.lastRate ?? MEDIAN_RATE[r.service] ?? 0,
      include: r.periodNeedsReview ? false : isND ? true : due,
      due,
      reason: r.periodNeedsReview ? 'Check latest QB period'
            : isND ? 'Active nominee per TeamWork · confirm annual fee (excl. deposit)'
            : r.status === 'expired' ? `Expired ${Math.abs(r.daysUntilExpiry ?? 0)}d ago`
            : r.status === 'expiring_soon' ? `Expiring in ${r.daysUntilExpiry}d`
            : r.status === 'active' ? `Active until ${r.lastPeriodEnd ? fmtDate(r.lastPeriodEnd) : '—'}`
            : 'No prior invoice',
      previousPeriodEnd: r.lastPeriodEnd,
      periodNeedsReview: r.periodNeedsReview,
      periodReviewed: false,
    });
  }

  for (const a of c.annuals) {
    if (!a.applicable) continue;
    const due = billedThisCycle !== null ? !billedThisCycle : a.status === 'pending';
    const last = a.history?.[0];
    const reason = billedThisCycle === true ? `Already invoiced this cycle [FYE ${cycleFye}]`
                 : billedThisCycle === false ? 'Not yet invoiced this cycle'
                 : a.status === 'billed' ? `Already billed ${a.lastTxnDate ? fmtDate(a.lastTxnDate) : ''}`
                 : a.status === 'pending' ? 'Not yet billed this cycle' : 'No prior invoice';
    if (a.service === 'AR') {
      out.push({
        service: 'AR', productService: last?.product_service ?? QB_ITEM.AR,
        description: arGovtFeeDescription(fyeStr),
        qty: 1, rate: last?.rate ?? MEDIAN_RATE.AR, include: due, due, reason,
      });
    } else {
      out.push({
        service: 'XBRL', productService: last?.product_service ?? QB_ITEM.XBRL,
        description: xbrlDescription(fyeStr),
        qty: 1, rate: a.lastAmount ?? MEDIAN_RATE.XBRL, include: due, due,
        reason: `⚠ Confirm XBRL required this FY · ${reason}`,
      });
    }
  }

  const priorDate = c.priorInvoiceDate ? fmtDate(c.priorInvoiceDate) : 'last year';
  for (const p of c.priorLines ?? []) {
    const ps = p.product_service ?? '';
    if (/Discount Given/i.test(ps)) {
      out.push({
        service: 'Discount', productService: ps,
        description: rollRecurringDescriptionForward(p.description || 'Discount Given'),
        qty: 1, rate: p.amount ?? 0, include: true, due: true,
        reason: `Discount from ${priorDate} — confirm it still applies`,
      });
    } else if (/Yearly Accounts Services|Compilation Services|Monthly Accounts Services/i.test(ps) && !/DO NOT USE/i.test(ps)) {
      out.push({
        service: 'Accounts', productService: ps,
        description: rollRecurringDescriptionForward(p.description || ps),
        qty: 1, rate: p.amount ?? MEDIAN_RATE.Accounts ?? 0, include: false, due: false,
        reason: `On ${priorDate} invoice — confirm if recurring`,
      });
    } else if (/Corporate Tax Services|Personal Income Tax Services|Other Tax Services/i.test(ps)) {
      out.push({
        service: 'Tax', productService: ps,
        description: rollRecurringDescriptionForward(p.description || ps),
        qty: 1, rate: p.amount ?? MEDIAN_RATE.Tax ?? 0, include: false, due: false,
        reason: `On ${priorDate} invoice — confirm if recurring`,
      });
    }
  }
  return out;
}

export function computeDraftTotals(lines: EditableLine[]): { tab: number; tac: number } {
  const included = lines.filter(l => l.include);
  const tab = included.filter(l => l.service !== 'ND').reduce((s, l) => s + l.qty * l.rate, 0);
  const tac = included.filter(l => l.service === 'ND').reduce((s, l) => s + l.qty * l.rate, 0);
  return { tab, tac };
}
