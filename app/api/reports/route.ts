import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { customerSourceLabel } from '@/lib/customer-source';

// Reports — customer-profile analytics for leadership (Vincent, Cindy,
// Samuell, Tan Yee Soon; gated on ApprovedAccount.canViewReports, see
// lib/approved-accounts.ts). Phase 1 (2026-09-03): everything here uses
// data that's already real and clean — companies.company_type (legal
// entity structure — NOT industry; SSIC is a separate, not-yet-built Phase
// 2, see PROJECT_STATUS.md), companies.has_*/uses_address (service mix),
// master_list.list_type/join_date/update_date (client flow — see the
// caveat below), quickbooks_invoices (revenue trend), ar_reminder.pic/
// acc_pic/tax_pic (workload). Aggregates the same way app/api/dashboard/
// route.ts does: pageAll() to fetch full tables, then plain in-memory
// grouping — no SQL-side aggregation anywhere in this codebase, this
// route doesn't introduce a new pattern.
export const preferredRegion = 'sin1';

type Row = Record<string, unknown>;
async function pageAll(makeQuery: () => PromiseLike<{ data: Row[] | null }>): Promise<Row[]> {
  const out: Row[] = [];
  let from = 0;
  for (;;) {
    const { data } = await (makeQuery() as unknown as { range: (a: number, b: number) => PromiseLike<{ data: Row[] | null }> }).range(from, from + 999);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

const PALETTE = ['#0f766e', '#2563eb', '#7c3aed', '#c026d3', '#0891b2', '#f59e0b', '#dc2626', '#65a30d', '#94a3b8'];

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

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewReports) return NextResponse.json({ error: 'Your account cannot view Reports.' }, { status: 403 });

  const sb = createAdminClient();
  const thisYear = new Date().getFullYear();
  const YEARS_BACK = 5;
  const years = Array.from({ length: YEARS_BACK }, (_, i) => thisYear - YEARS_BACK + 1 + i);

  const [companies, masterList, arRows, qbInvoices] = await Promise.all([
    pageAll(() => sb.from('companies').select('company_type, has_agm, has_xbrl, has_accounts, has_tax, has_nd, uses_address, is_active, customer_source')),
    pageAll(() => sb.from('master_list').select('list_type, join_date, update_date')),
    pageAll(() => sb.from('ar_reminder').select('pic, acc_pic, tax_pic, filling_date').or('status.is.null,status.neq.Excluded')),
    pageAll(() => sb.from('quickbooks_invoices').select('txn_date, total_amt')),
  ]);

  const active = companies.filter(c => c.is_active);

  // ── Client type mix (legal entity structure — company_type, NOT SSIC) ───
  const typeCount: Record<string, number> = {};
  for (const c of active) {
    const t = (c.company_type as string) || 'Unspecified';
    typeCount[t] = (typeCount[t] ?? 0) + 1;
  }
  const clientTypeDonut = Object.entries(typeCount)
    .map(([label, value], i) => ({ label, value, color: PALETTE[i % PALETTE.length] }))
    .sort((a, b) => b.value - a.value);

  // ── Service mix (active clients) ─────────────────────────────────────────
  const serviceMix = [
    { label: 'Reg. Address', value: active.filter(c => c.uses_address).length, color: '#0f766e' },
    { label: 'Nominee Dir.', value: active.filter(c => c.has_nd).length, color: '#7c3aed' },
    { label: 'AGM', value: active.filter(c => c.has_agm).length, color: '#2563eb' },
    { label: 'XBRL', value: active.filter(c => c.has_xbrl).length, color: '#c026d3' },
    { label: 'Accounts', value: active.filter(c => c.has_accounts).length, color: '#0891b2' },
    { label: 'Tax', value: active.filter(c => c.has_tax).length, color: '#f59e0b' },
  ].sort((a, b) => b.value - a.value);

  // ── Customer source (Unknown until staff tag companies going forward) ───
  const sourceCount: Record<string, number> = {};
  for (const c of active) {
    const label = customerSourceLabel(c.customer_source as string | null);
    sourceCount[label] = (sourceCount[label] ?? 0) + 1;
  }
  const sourceDonut = Object.entries(sourceCount)
    .map(([label, value], i) => ({ label, value, color: label === 'Unknown' ? '#cbd5e1' : PALETTE[i % PALETTE.length] }))
    .sort((a, b) => b.value - a.value);

  // ── Client flow: new (join_date) vs churned (update_date on terminated/
  //    strike_off — an informal proxy, not a guaranteed transition-date
  //    field; see this route's own top comment and parseFlexibleDate's). ──
  const newByYear: Record<number, number> = {};
  const churnedByYear: Record<number, number> = {};
  for (const m of masterList) {
    const jd = parseFlexibleDate(m.join_date);
    if (jd) newByYear[jd.getFullYear()] = (newByYear[jd.getFullYear()] ?? 0) + 1;
    if (m.list_type === 'terminated' || m.list_type === 'strike_off') {
      const ud = parseFlexibleDate(m.update_date);
      if (ud) churnedByYear[ud.getFullYear()] = (churnedByYear[ud.getFullYear()] ?? 0) + 1;
    }
  }
  const newClientsTrend = years.map(y => ({ label: String(y), value: newByYear[y] ?? 0 }));
  const churnedTrend = years.map(y => ({ label: String(y), value: churnedByYear[y] ?? 0 }));

  // ── Revenue / invoice-volume trend ───────────────────────────────────────
  const invoiceCountByYear: Record<number, number> = {};
  const revenueByYear: Record<number, number> = {};
  for (const inv of qbInvoices) {
    const d = typeof inv.txn_date === 'string' ? new Date(inv.txn_date) : null;
    if (!d || isNaN(d.getTime())) continue;
    const y = d.getFullYear();
    invoiceCountByYear[y] = (invoiceCountByYear[y] ?? 0) + 1;
    revenueByYear[y] = (revenueByYear[y] ?? 0) + (Number(inv.total_amt) || 0);
  }
  const invoiceCountTrend = years.map(y => ({ label: String(y), value: invoiceCountByYear[y] ?? 0 }));
  const revenueTrend = years.map(y => ({ label: String(y), value: Math.round((revenueByYear[y] ?? 0) / 1000) }));

  // ── PIC workload — open (not yet filed) AR/AGM cycles only, same fields
  //    My Tasks already reads (SEC/ACC/TAX PIC dropdowns hold plain staff
  //    names, not emails — no resolution step needed). ────────────────────
  const picCount: Record<string, number> = {};
  for (const r of arRows) {
    if (r.filling_date) continue;
    for (const name of [r.pic, r.acc_pic, r.tax_pic]) {
      if (!name || name === 'Client') continue;
      picCount[name as string] = (picCount[name as string] ?? 0) + 1;
    }
  }
  const picWorkload = Object.entries(picCount)
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  return NextResponse.json({
    generatedAt: new Date().toISOString().slice(0, 10),
    kpis: {
      activeClients: active.length,
      newThisYear: newByYear[thisYear] ?? 0,
      churnedThisYear: churnedByYear[thisYear] ?? 0,
      netGrowthThisYear: (newByYear[thisYear] ?? 0) - (churnedByYear[thisYear] ?? 0),
    },
    clientTypeDonut,
    serviceMix,
    sourceDonut,
    flow: { years: years.map(String), newClientsTrend, churnedTrend },
    revenue: { years: years.map(String), invoiceCountTrend, revenueTrendThousands: revenueTrend },
    picWorkload,
    notes: {
      clientType: 'Legal entity structure (Pte Ltd / Sole Prop / LLP, etc.) — not an industry classification. SSIC-based industry breakdown is a separate, not-yet-built addition.',
      flow: 'Based on master_list.join_date (client start) and .update_date on Terminated/Strike Off rows (an informal proxy for when status changed, not a guaranteed transition-date field) — dates are staff-typed free text in inconsistent formats, so treat this as directional, not exact.',
      source: '"Unknown" is expected for most of the existing roster — customer_source is a new field staff tag going forward from Company 360, not backfilled from history.',
    },
  });
}
