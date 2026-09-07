import 'server-only';

import { createAdminClient } from './supabase';
import { pageAll } from './page-all';
import { normalize, findUniqueBestMatch } from './company-name';
import { formatStaffNameList } from './staff-directory';
import type { QbCompany } from './quickbooks';
import { agingBucket, emptyAgingTotals, type AgingTotals } from './soa';
import { computeSuggestedOwner, collectInvolvedStaff, type OwnerInvoiceSignal } from './soa-owner';

// Shared by GET /api/billing/soa (the on-screen list) and
// GET /api/billing/soa/export (the Excel download) so the two can never
// silently drift into different totals/owners for the same qbCompany —
// same reasoning as this repo's other shared-computation libs (INV-QB-012
// on correctedCustomerName being the one place customer_name gets fixed up).
export interface SoaCompanyRow {
  companyName: string;
  companyId: number | null;
  pic: string | null;
  // Every individual person decomposed out of `pic` (see
  // lib/staff-directory.ts's formatStaffNameList), UNIONED with every real
  // Class name found across this company's own unpaid invoices — `pic`
  // alone can legitimately list 2+ co-assigned people already ("Chin Kah
  // Ye, Ang Shi Ming"), and can ALSO be missing someone real: Vincent,
  // 2026-09-07, from a real example — "1V Capital Pte Ltd" only had "Chin
  // Kah Ye" here, but its own invoices show Lee Jing Fei handling its
  // Accounts lines too, matching Vincent's own tracking sheet ("真正在系统
  // 的显示应该是PIC：CKY,LJF" — see lib/soa-owner.ts's collectInvolvedStaff).
  // Backs both the PIC column's display and the dropdown Chelsea uses to
  // say which ONE of them actually owns chasing THIS outstanding balance.
  picOptions: string[];
  // Chelsea's manual pick, from soa_owners (keyed by normalized customer
  // name + qb_company, NOT companies.id — see that table's own migration
  // comments: 18% of real customers with a balance have no matching
  // `companies` row at all, and — confirmed 2026-09-07 against Vincent's
  // real 3-tab Google Sheet — 13 of 81 companies that owe on 2+ systems
  // genuinely have a DIFFERENT real person on each tab, so this can never
  // be one global value per customer name).
  soaPic: string | null;
  // Chelsea's real rule, computed automatically from THIS company's own
  // unpaid invoices — line Class first, that invoice's own Location as
  // fallback (see lib/soa-owner.ts) — so a default no longer has to wait on
  // manual Google Sheet backfill. null only when no unpaid invoice here has
  // a resolvable Class or Location at all.
  suggestedOwner: string | null;
  invoiceCount: number;
  totalOutstanding: number;
  aging: AgingTotals;
}

type UnpaidInvoice = {
  customer_name: string; qb_company: string; qb_invoice_id: string; invoice_no: string;
  txn_date: string | null; balance: number | null; location_name: string | null;
};

// The effective "who chases this" shown on screen as Owner: a human's
// confirmed pick always wins, then the real QB-Class/Location signal, then
// (only when there's exactly one and no better signal) the sole PIC name —
// same 3-tier priority app/billing/soa/_components.tsx renders.
export function effectiveOwner(row: Pick<SoaCompanyRow, 'soaPic' | 'suggestedOwner' | 'picOptions'>): string | null {
  const singlePicFallback = row.picOptions.length === 1 ? row.picOptions[0] : null;
  return row.soaPic ?? row.suggestedOwner ?? singlePicFallback;
}

export async function computeSoaRows(company: QbCompany): Promise<SoaCompanyRow[]> {
  const supabase = createAdminClient();

  const [invoices, companiesRes, ownersRes] = await Promise.all([
    pageAll(() => supabase
      .from('quickbooks_invoices')
      .select('customer_name, qb_company, qb_invoice_id, invoice_no, txn_date, balance, location_name')
      .eq('qb_company', company)
      .gt('balance', 0)) as Promise<UnpaidInvoice[]>,
    supabase.from('companies').select('id, company_name, pic'),
    supabase.from('soa_owners').select('customer_name_norm, soa_pic').eq('qb_company', company),
  ]);
  if (companiesRes.error) throw new Error(companiesRes.error.message);
  if (ownersRes.error) throw new Error(ownersRes.error.message);

  // Class is per LINE, not per invoice (Chelsea's primary signal — see
  // lib/soa-owner.ts) — a second, narrower query against just these same
  // unpaid invoices' own items, not the whole quickbooks_invoice_items
  // table (which also holds years of paid/irrelevant history).
  const unpaidInvoiceIds = [...new Set(invoices.map(inv => inv.qb_invoice_id).filter(Boolean))];
  const classNamesByInvoice = new Map<string, string[]>();
  if (unpaidInvoiceIds.length) {
    const { data: items, error: itemsError } = await supabase
      .from('quickbooks_invoice_items')
      .select('qb_invoice_id, class_name')
      .eq('qb_company', company)
      .in('qb_invoice_id', unpaidInvoiceIds)
      .not('class_name', 'is', null);
    if (itemsError) throw new Error(itemsError.message);
    for (const item of items ?? []) {
      if (!item.class_name) continue;
      const list = classNamesByInvoice.get(item.qb_invoice_id) ?? [];
      list.push(item.class_name);
      classNamesByInvoice.set(item.qb_invoice_id, list);
    }
  }

  const companies = companiesRes.data ?? [];
  const companyByNormName = new Map(companies.map(c => [normalize(c.company_name), c]));
  const wordMatch = (name: string) => {
    const exact = companyByNormName.get(name);
    if (exact) return exact;
    const match = findUniqueBestMatch(name, [...companyByNormName.entries()], entry => entry[0], 70);
    return match.value?.[1] ?? null;
  };
  const ownerByNormName = new Map((ownersRes.data ?? []).map(o => [o.customer_name_norm, o.soa_pic]));

  const today = new Date();
  const byCompany = new Map<string, {
    displayName: string; invoiceCount: number; total: number; aging: AgingTotals; signals: OwnerInvoiceSignal[];
  }>();
  for (const inv of invoices) {
    if (!inv.txn_date || !inv.balance) continue;
    const key = normalize(inv.customer_name);
    if (!key) continue;
    if (!byCompany.has(key)) byCompany.set(key, { displayName: inv.customer_name, invoiceCount: 0, total: 0, aging: emptyAgingTotals(), signals: [] });
    const entry = byCompany.get(key)!;
    entry.invoiceCount += 1;
    entry.total += inv.balance;
    entry.aging[agingBucket(inv.txn_date, today)] += inv.balance;
    entry.signals.push({ qbInvoiceId: inv.qb_invoice_id, txnDate: inv.txn_date, locationName: inv.location_name });
  }

  return [...byCompany.entries()].map(([key, entry]) => {
    const companyMatch = companyByNormName.get(key) ?? wordMatch(key);
    const picFromCompanies = formatStaffNameList(companyMatch?.pic ?? null);
    const picFromInvoices = collectInvolvedStaff(entry.signals, classNamesByInvoice);
    return {
      companyName: companyMatch?.company_name ?? entry.displayName,
      companyId: companyMatch?.id ?? null,
      pic: companyMatch?.pic ?? null,
      picOptions: [...new Set([...picFromCompanies, ...picFromInvoices])],
      soaPic: ownerByNormName.get(key) ?? null,
      suggestedOwner: computeSuggestedOwner(entry.signals, classNamesByInvoice),
      invoiceCount: entry.invoiceCount,
      totalOutstanding: Math.round(entry.total * 100) / 100,
      aging: entry.aging,
    };
  }).sort((a, b) => a.companyName.localeCompare(b.companyName)); // Vincent, 2026-09-07: "排序也是要按照ABC 的顺序排序"
}

// One row per (company, qbCompany) — the "All" view's own shape. Vincent,
// 2026-09-07: "在 Outstanding -TAB的上面加多一个3级标题（All）...举例：
// TAB/TAO 都有 1V CAPITAL PTE. LTD.，所有就要在ALL 出现2行" — deliberately
// NOT deduplicated across systems (same principle as the per-person Excel
// export sheets, lib/soa-export.ts's buildPersonSheet): a company owing on
// 2 systems is 2 real, separate rows, each tagged with which one it's from.
export interface SoaCompanyRowWithSource extends SoaCompanyRow {
  qbCompany: QbCompany;
}

// The tag+concat+sort step alone, pulled out of computeAllSoaRows() so
// GET /api/billing/soa/export-all (2026-09-07: "在 EXPORT FULL WORKBOOK那边
// 要加多一个 ALL 的 SHEET") can build the exact same "All" row set from the
// tab/tac/tao arrays it already has in memory — that route computes all 3
// anyway for its own TAB/TAC/TAO sheets, so routing through here avoids
// fetching everything from Supabase a second time while staying provably
// identical to what the on-screen All page (and its own separate
// computeAllSoaRows() call) shows.
export function tagAndMergeSoaRows(tab: SoaCompanyRow[], tac: SoaCompanyRow[], tao: SoaCompanyRow[]): SoaCompanyRowWithSource[] {
  // Array.prototype.sort is stable (guaranteed since ES2019) — concatenating
  // in this fixed order first, then sorting by name only, means same-named
  // rows across systems always land TAB-then-TAC-then-TAO, not shuffled.
  return [
    ...tab.map(r => ({ ...r, qbCompany: 'TAB' as const })),
    ...tac.map(r => ({ ...r, qbCompany: 'TAC' as const })),
    ...tao.map(r => ({ ...r, qbCompany: 'TAO' as const })),
  ].sort((a, b) => a.companyName.localeCompare(b.companyName));
}

export async function computeAllSoaRows(): Promise<SoaCompanyRowWithSource[]> {
  const [tab, tac, tao] = await Promise.all([computeSoaRows('TAB'), computeSoaRows('TAC'), computeSoaRows('TAO')]);
  return tagAndMergeSoaRows(tab, tac, tao);
}
