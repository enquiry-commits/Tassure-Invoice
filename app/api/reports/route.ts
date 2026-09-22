import { todaySGT, thisYearSGT } from '@/lib/date';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { customerSourceLabel } from '@/lib/customer-source';
import { buildReportsCompanyRows, computeRevenueTrend, computePicWorkload, REPORTS_COMPANY_SELECT, REPORTS_MASTER_LIST_SELECT } from '@/lib/reports-data';
import { pageAll } from '@/lib/page-all';
import { normalize } from '@/lib/company-name';
import { REPORT_COLORS, REPORT_PALETTE } from '@/lib/chart-colors';

// Reports — customer-profile analytics for leadership (Vincent, Cindy,
// Samuell, Tan Yee Soon; gated on ApprovedAccount.canViewReports, see
// lib/approved-accounts.ts). Phase 1 (2026-09-03): everything here uses
// data that's already real and clean — companies.company_type (legal
// entity structure — NOT industry; SSIC is a separate, not-yet-built Phase
// 2, see PROJECT_STATUS.md), companies.has_nd/has_xbrl/uses_address (service
// mix — these three are reliably kept in sync elsewhere, unlike
// has_accounts/has_tax below), real QuickBooks Accounts/Tax invoice history
// for the Accounts/Tax service-mix counts specifically (added 2026-09-22 —
// companies.has_accounts/has_tax turned out to be a near-dead column, true
// for 1-2 of 911 active companies, so those two counts used to read almost
// entirely wrong; see the Promise.all below), master_list.list_type/
// join_date/update_date (client flow — see the
// caveat below), quickbooks_invoices (revenue trend), ar_reminder.pic/
// acc_pic/tax_pic (workload). Aggregates the same way app/api/dashboard/
// route.ts does: pageAll() to fetch full tables, then plain in-memory
// grouping — no SQL-side aggregation anywhere in this codebase, this
// route doesn't introduce a new pattern.
//
// Extended same day (2026-09-03) with `companyRows` — a flat, enriched
// per-company array — after Vincent reviewed the fixed-chart version above
// and said it "看起来更像是一个摆设" (looks more like a decoration) and
// asked for something he can genuinely operate himself: filters, a
// dimension×metric picker, drill-down, export. Rather than a second,
// parameterized aggregation endpoint, this route just ships the raw
// per-company dataset once and app/reports/page.tsx's new "Explore" section
// does all grouping/filtering/pivoting client-side — the same idiom
// app/companies/page.tsx already uses (fetch the full active roster once,
// filter in JS), and the only way to make dimension/filter switching
// instant with zero network round-trip per change. SSIC is now real data
// (companies.ssic_description_1, backfilled for the whole roster this same
// day via scripts/backfill-ssic-full-roster.js) so it's a real dimension
// here, not a placeholder. See lib/reports-data.ts for the join logic
// shared with app/api/reports/export/route.ts.
export const preferredRegion = 'sin1';

type Row = Record<string, unknown>;
type Pt = { label: string; value: number; color?: string };
type FlowRow = { companyName: string; uen: string | null };

// Exported shape of computeReportsData()'s return — kept in sync BY HAND
// with app/reports/page.tsx's own identical `ReportsData` interface (that
// file is a separate 'use client' component and doesn't import server-only
// route code), same convention every other route/page pair in this app
// already uses. lib/reports-narrative.ts imports this type, not the page's
// copy, since it runs server-side.
export interface ReportsData {
  generatedAt: string;
  kpis: { activeClients: number; newThisYear: number; churnedThisYear: number; netGrowthThisYear: number };
  clientTypeDonut: Pt[];
  serviceMix: Pt[];
  sourceDonut: Pt[];
  flow: { years: string[]; newClientsTrend: Pt[]; churnedTrend: Pt[]; newByYearRows: Record<string, FlowRow[]>; churnedByYearRows: Record<string, FlowRow[]> };
  revenue: { years: string[]; invoiceCountTrend: Pt[]; revenueTrendThousands: Pt[] };
  picWorkload: Pt[];
  companyRows: ReturnType<typeof buildReportsCompanyRows>;
  notes: { clientType: string; flow: string; source: string; revenue: string };
}

// master_list.join_date/update_date are free text typed by staff over the
// years — confirmed via live sampling (see the 2026-09-02 direction-
// analysis conversation) to mix M/D/Y ("4/21/22"), D/M/Y-ish with dots
// ("24.05.2024") and "DD Mon YYYY" ("07 Jul 2026"), with no single
// consistent format. This is a best-effort parser, not a guarantee — the
// Reports UI labels the flow chart accordingly rather than presenting it
// as exact. Ambiguous D/M vs M/D slash dates are read as M/D/Y (US-style),
// matching the one unambiguous sample seen during research ("4/21/22" —
// 21 can only be a day).
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function parseFlexibleDate(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();

  const named = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (named) {
    const mi = MONTH_ABBR.indexOf(named[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return new Date(Number(named[3]), mi, Number(named[1]));
  }
  const dotted = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (dotted) {
    const yr = dotted[3].length === 2 ? 2000 + Number(dotted[3]) : Number(dotted[3]);
    return new Date(yr, Number(dotted[2]) - 1, Number(dotted[1]));
  }
  const slashed = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashed) {
    const yr = slashed[3].length === 2 ? 2000 + Number(slashed[3]) : Number(slashed[3]);
    return new Date(yr, Number(slashed[1]) - 1, Number(slashed[2]));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// Extracted 2026-09-22 from GET's own body (mechanical move, behavior
// unchanged) so lib/reports-narrative.ts's AI narrative generator can call
// the SAME computation the page itself renders, rather than a second,
// divergent re-derivation — the auto-generated analysis must never disagree
// with the numbers sitting right next to it on the same page. GET below
// keeps the auth checks (a route-level concern); this only computes.
export async function computeReportsData(): Promise<ReportsData> {
  const sb = createAdminClient();
  const thisYear = thisYearSGT();
  const YEARS_BACK = 5;
  const years = Array.from({ length: YEARS_BACK }, (_, i) => thisYear - YEARS_BACK + 1 + i);

  const [companies, masterList, arRows, qbInvoices, taoServiceItems] = await Promise.all([
    pageAll<Row>(() => sb.from('companies').select(REPORTS_COMPANY_SELECT)),
    pageAll<Row>(() => sb.from('master_list').select(`list_type, update_date, company_name, ${REPORTS_MASTER_LIST_SELECT}`)),
    pageAll<Row>(() => sb.from('ar_reminder').select('pic, acc_pic, tax_pic, filling_date').or('status.is.null,status.neq.Excluded')),
    pageAll<Row>(() => sb.from('quickbooks_invoices').select('txn_date, total_amt')),
    pageAll<Row>(() => sb.from('quickbooks_invoice_items').select('customer_name, service_type').in('service_type', ['Accounts', 'Tax']).gte('txn_date', `${thisYear - 3}-01-01`)),
  ]);
  // Accounts/Tax eligibility, real signal — same real-history check the TAO
  // billing page's own "807 Accounts/Tax Clients" metric uses
  // (app/api/billing/tao/route.ts's computeTaoCompanies, not reused directly
  // here since it merges Accounts+Tax into one combined roster and this
  // chart needs them kept separate). companies.has_accounts/has_tax alone is
  // a near-dead column — confirmed live 2026-09-22, true for 1-2 of 911
  // active companies (of the ~1 company anywhere with any services_manual
  // override at all, none happened to be accounts/tax), so reading it
  // directly here previously showed "Accounts: 1, Tax: 2" on a client base
  // where real QuickBooks history shows roughly half billed for one or both.
  const accountsNames = new Set(taoServiceItems.filter(i => i.service_type === 'Accounts').map(i => normalize(i.customer_name as string)));
  const taxNames = new Set(taoServiceItems.filter(i => i.service_type === 'Tax').map(i => normalize(i.customer_name as string)));

  const companyRows = buildReportsCompanyRows(companies, masterList);

  const active = companies.filter(c => c.is_active);

  // ── Client type mix (legal entity structure — company_type, NOT SSIC) ───
  const typeCount: Record<string, number> = {};
  for (const c of active) {
    const t = (c.company_type as string) || 'Unspecified';
    typeCount[t] = (typeCount[t] ?? 0) + 1;
  }
  const clientTypeDonut = Object.entries(typeCount)
    .map(([label, value], i) => ({ label, value, color: REPORT_PALETTE[i % REPORT_PALETTE.length] }))
    .sort((a, b) => b.value - a.value);

  // ── Service mix (active clients) ─────────────────────────────────────────
  // Colors fixed per SERVICE (not assigned by sorted rank/position below) —
  // "color follows the entity, never its rank": re-sorting this list on
  // every data refresh must never make a service's own color jump to a
  // different hue just because its count moved up or down one place.
  // Muted palette (was hardcoded bright/saturated colors until 2026-09-22,
  // round 2 — Vincent: "颜色不要鲜艳色" — this array was the one place the
  // color-palette-unification pass earlier the same day missed).
  const serviceMix = [
    { label: 'Reg. Address', value: active.filter(c => c.uses_address).length, color: REPORT_COLORS.teal },
    { label: 'Nominee Dir.', value: active.filter(c => c.has_nd).length, color: REPORT_COLORS.plum },
    { label: 'AGM', value: active.filter(c => c.has_agm).length, color: REPORT_COLORS.blue },
    { label: 'XBRL', value: active.filter(c => c.has_xbrl).length, color: REPORT_PALETTE[8] },
    { label: 'Accounts', value: active.filter(c => accountsNames.has(normalize(c.company_name as string))).length, color: REPORT_PALETTE[5] },
    { label: 'Tax', value: active.filter(c => taxNames.has(normalize(c.company_name as string))).length, color: REPORT_COLORS.gold },
  ].sort((a, b) => b.value - a.value);

  // ── Customer source (Unknown until staff tag companies going forward) ───
  const sourceCount: Record<string, number> = {};
  for (const c of active) {
    const label = customerSourceLabel(c.customer_source as string | null);
    sourceCount[label] = (sourceCount[label] ?? 0) + 1;
  }
  const sourceDonut = Object.entries(sourceCount)
    .map(([label, value], i) => ({ label, value, color: label === 'Unknown' ? '#cbd5e1' : REPORT_PALETTE[i % REPORT_PALETTE.length] }))
    .sort((a, b) => b.value - a.value);

  // ── Client flow: new (join_date) vs churned (update_date on terminated/
  //    strike_off — an informal proxy, not a guaranteed transition-date
  //    field; see this route's own top comment and parseFlexibleDate's). ──
  const newByYear: Record<number, number> = {};
  const churnedByYear: Record<number, number> = {};
  // Per-year row lists for the "New This Year"/"Churned This Year" KPI-card
  // drill-down (2026-09-03) — sourced straight from master_list, never by
  // joining back to companies, because a struck-off company can be fully
  // ABSENT from companies (confirmed live in app/api/late-filing/route.ts's
  // own comment: "a company fully struck off and removed from `companies`
  // entirely" — e.g. ADVANCE BRIGHT GLOBAL, FULLRICH INTERNATIONAL). Joining
  // back for company_type/SSIC would silently under-populate exactly the
  // churned rows most likely to need it.
  const newRowsByYear: Record<number, { companyName: string; uen: string | null }[]> = {};
  const churnedRowsByYear: Record<number, { companyName: string; uen: string | null }[]> = {};
  for (const m of masterList) {
    const jd = parseFlexibleDate(m.join_date);
    if (jd) {
      const y = jd.getFullYear();
      newByYear[y] = (newByYear[y] ?? 0) + 1;
      (newRowsByYear[y] ??= []).push({ companyName: m.company_name as string, uen: (m.roc_no as string | null) ?? null });
    }
    if (m.list_type === 'terminated' || m.list_type === 'strike_off') {
      const ud = parseFlexibleDate(m.update_date);
      if (ud) {
        const y = ud.getFullYear();
        churnedByYear[y] = (churnedByYear[y] ?? 0) + 1;
        (churnedRowsByYear[y] ??= []).push({ companyName: m.company_name as string, uen: (m.roc_no as string | null) ?? null });
      }
    }
  }
  const newClientsTrend = years.map(y => ({ label: String(y), value: newByYear[y] ?? 0 }));
  const churnedTrend = years.map(y => ({ label: String(y), value: churnedByYear[y] ?? 0 }));

  // ── Revenue / invoice-volume trend + PIC workload — extracted 2026-09-09
  //    into lib/reports-data.ts (computeRevenueTrend/computePicWorkload) so
  //    a chat-assistant tool can reuse the exact same computation; behavior
  //    here is unchanged. ────────────────────────────────────────────────
  const { invoiceCountTrend, revenueTrendThousands: revenueTrend } = computeRevenueTrend(qbInvoices, years);
  const picWorkload = computePicWorkload(arRows);

  return {
    generatedAt: todaySGT(),
    kpis: {
      activeClients: active.length,
      newThisYear: newByYear[thisYear] ?? 0,
      churnedThisYear: churnedByYear[thisYear] ?? 0,
      netGrowthThisYear: (newByYear[thisYear] ?? 0) - (churnedByYear[thisYear] ?? 0),
    },
    clientTypeDonut,
    serviceMix,
    sourceDonut,
    flow: {
      years: years.map(String), newClientsTrend, churnedTrend,
      newByYearRows: newRowsByYear, churnedByYearRows: churnedRowsByYear,
    },
    revenue: { years: years.map(String), invoiceCountTrend, revenueTrendThousands: revenueTrend },
    picWorkload,
    companyRows,
    notes: {
      clientType: 'Legal entity structure (Pte Ltd / Sole Prop / LLP, etc.) — not an industry classification. See the Explore section below for a real SSIC industry breakdown.',
      flow: 'Based on master_list.join_date (client start) and .update_date on Terminated/Strike Off rows (an informal proxy for when status changed, not a guaranteed transition-date field) — dates are staff-typed free text in inconsistent formats, so treat this as directional, not exact.',
      source: '"Unknown" is expected for most of the existing roster — customer_source is a new field staff tag going forward from Company 360, not backfilled from history.',
      revenue: 'Per-company revenue is not offered as an Explore metric — attributing quickbooks_invoices to a specific company reliably needs the same fuzzy company-name matching lib/company-360.ts uses for one company at a time (docs/FEATURE_MAP.md flags that matching as high-risk shared logic); running it across the whole roster for a leadership-facing aggregate risks misattributed figures in a way a single Company 360 lookup does not. The Revenue/Invoice Volume chart above stays company-agnostic (a plain by-year total) for that reason.',
    },
  };
}

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewReports) return NextResponse.json({ error: 'Your account cannot view Reports.' }, { status: 403 });
  try {
    return NextResponse.json(await computeReportsData());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}
