import 'server-only';

import { createAdminClient } from './supabase';
import { pageAll } from './page-all';
import { normalize, findUniqueBestMatch, significantWord } from './company-name';
import { formatStaffNameList } from './staff-directory';
import type { QbCompany } from './quickbooks';
import { agingBucket, dueDate, emptyAgingTotals, type AgingBucket, type AgingTotals } from './soa';
import { computeSuggestedOwner, collectInvolvedStaff, picAllowedForCompany, type OwnerInvoiceSignal } from './soa-owner';

// Shared by GET /api/billing/soa (the on-screen list) and
// GET /api/billing/soa/export (the Excel download) so the two can never
// silently drift into different totals/owners for the same qbCompany —
// same reasoning as this repo's other shared-computation libs (INV-QB-012
// on correctedCustomerName being the one place customer_name gets fixed up).

// Vincent, 2026-09-15, confirming a real discrepancy found while verifying
// the CreditMemo fix (see docs/INVARIANTS.md INV-QB-015): "PAC是我们公司内部
// 的交易主要为主，因为TAB/TAO/TAC都是不同的3家公司，有时候会提供PAC去支付一
// 些公司费用" — TASSURE PAC is an internal inter-company settlement account
// between TAB/TAC/TAO (one entity covering another's costs), not a real
// external client, and must never appear as an "outstanding balance" a
// client owes — showing up in the on-screen Outstanding list, an SOA email,
// or the AI assistant's collections worklist would all be wrong. Excluded
// here, the one shared computation (INV-DATA-022), so every consumer
// inherits the exclusion. Matched on the normalized name (case/whitespace-
// insensitive) — real production data has both "TASSURE PAC" and "Tassure
// PAC" spellings across the 3 books. If Vincent identifies another internal
// account later, add its normalized name here rather than inventing a new
// mechanism for one more entry.
const INTERNAL_ACCOUNT_NORM_NAMES = new Set(['tassure pac']);
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
  // Every unpaid invoice behind this row's total, its own number + due
  // date — Vincent, 2026-09-08, on Company 360's Outstanding section only
  // ("我刚才说的全部是针对 Company 360"): "Company Name列 换成Invoice 列"
  // (that section already knows which company it's on, so the real
  // invoice number is more useful there than a repeated company name),
  // then "把PIC 换成这个 Due Date". Sorted oldest-due-first — same "the
  // oldest one matters most" framing as oldestAgingBucket() below. Kept
  // here rather than a second query so this stays covered by the same
  // "one shared computation" guarantee as everything else on this row —
  // every existing consumer of SoaCompanyRow ignores an added field it
  // doesn't ask for.
  //
  // Deliberately Invoice-only, unchanged since 2026-09-08 — DO NOT widen
  // this to include Credit Note/Payment/Journal Entry/etc. Two existing
  // consumers phrase this specifically as "invoices" and would read wrong
  // with a non-invoice reference mixed in: components/assistant/
  // ChatCards.tsx renders it as "#X、#Y 等N张" (a classifier that only
  // makes sense for invoice-shaped documents) via lib/outstanding-lookup.ts
  // — see `lineItems` below for the full-detail field added for that
  // purpose instead.
  unpaidInvoices: { invoiceNo: string; dueDate: string }[];
  // The full line-item detail behind this row's total — EVERY transaction
  // type (Invoice, Credit Note, Payment, Journal Entry, Deposit, ...), not
  // just invoices (contrast unpaidInvoices above). Added 2026-09-15 so
  // Company 360's Outstanding section can show a complete breakdown (e.g.
  // Cyber Quantum Pte Ltd's Journal Entry) instead of only ever listing
  // Invoice-type rows while silently folding everything else into the
  // Total Balance number with no visible line for it. Sorted oldest-
  // due-first, same convention as unpaidInvoices. `bucket` is the exact
  // same AgingBucket this item was folded into for the row's own `aging`
  // totals (computed once here, never re-derived in the UI) — lets a
  // consumer explain WHY a specific bucket cell went negative instead of
  // just that it did (see lib/soa.ts's TXN_TYPE_TAGS and its own comment on
  // the 2026-09-15 incident this prevents — a hardcoded "(CN)" tag on every
  // negative bucket regardless of real type).
  //
  // `txnDate` added 2026-09-17 for the Statement PDF's own itemized DATE
  // column (lib/statement-pdf.ts) — Vincent, comparing against the ORIGINAL
  // reference PDF file side-by-side: its own DATE column shows the
  // transaction date ("24/07/2026"), not the due date this field used to be
  // the only date available for. Falls back to dueDate when a real txnDate
  // genuinely isn't available (matches this field's own pre-2026-09-17
  // behavior exactly), so no existing consumer's date display changes.
  lineItems: { docNumber: string; dueDate: string; txnDate: string; txnType: string; amount: number; bucket: AgingBucket }[];
}

type UnpaidInvoice = {
  customer_name: string; qb_company: string; qb_invoice_id: string; invoice_no: string;
  txn_date: string | null; balance: number | null; location_name: string | null;
};

// An unapplied CreditMemo (Credit Note) — QuickBooks does not reduce an
// Invoice's own Balance when a CreditMemo is left "Unapplied", but
// QuickBooks' own official Aged Receivables report nets it into the
// customer's total anyway. See scripts/add-quickbooks-credit-memos.sql and
// docs/INVARIANTS.md for the full incident this fixes. Still used by
// legacyComputeSoaRows() (the report-unavailable fallback) below.
type UnappliedCreditMemo = {
  customer_name: string; qb_company: string; txn_date: string | null; balance: number | null; doc_number: string | null;
};

// ── QuickBooks Aged Receivable Detail report snapshot ───────────────────
// Added 2026-09-15 — supersedes Invoice+CreditMemo netting as the TOTAL/
// aging source. Live verification found the Invoice+CreditMemo approach
// could never be assumed complete: this business's real QuickBooks data
// also has Payment, Journal Entry, and (TAB) Deposit transactions
// affecting AR, none of which this app synced, plus multi-currency
// balances never converted to SGD. This report is comprehensive BY
// CONSTRUCTION (QuickBooks' own accounting engine enumerates every entity
// type relevant to AR, including ones not yet seen in this business's
// data) and already SGD-converts. See docs/INVARIANTS.md INV-QB-017 and
// scripts/add-quickbooks-ar-aging-detail.sql for the full incident.
export interface ArAgingDetailRow {
  txnType: string;
  qbTxnId: string | null;
  docNumber: string | null;
  customerName: string;
  txnDate: string | null;
  dueDate: string | null;
  amount: number | null;
  openBalance: number;
  agingBucket: AgingBucket;
}

// Matches the daily-cron cadence already tolerated elsewhere (INV-QB-014/
// 015/017: "up to a day stale until the next sync").
const AR_AGING_FALLBACK_STALE_MS = 36 * 60 * 60 * 1000;

// Exported so the SOA detail modal / PDF route / Client Communications can
// each gate their OWN fresh-vs-legacy branch on the exact same check
// computeSoaRows() uses below — none of them can ever disagree with the
// total about which mode is active for a given qbCompany.
export async function loadArAgingSnapshot(
  company: QbCompany, customerNamePrefilter?: string,
): Promise<{ fresh: true; rows: ArAgingDetailRow[] } | { fresh: false }> {
  const supabase = createAdminClient();
  const { data: state } = await supabase
    .from('quickbooks_ar_aging_sync_state')
    .select('last_status, last_synced_at')
    .eq('qb_company', company)
    .maybeSingle();
  const fresh = state?.last_status === 'success' && !!state.last_synced_at
    && (Date.now() - new Date(state.last_synced_at).getTime()) < AR_AGING_FALLBACK_STALE_MS;
  if (!fresh) return { fresh: false };

  // 2026-09-15: MUST reduce to significantWord() here, not use the raw
  // string as-is — a caller passing a full, already-fuzzy-matched display
  // name (e.g. "/detail" and "/pdf" routes both pass their ?companyName=
  // query param verbatim) can differ from the real QuickBooks customer_name
  // in ways a literal ilike substring won't survive (e.g. "&" vs "and",
  // "Pte. Ltd." vs "Pte Ltd") even though the two names fuzzy-match fine
  // everywhere else in this app. significantWord() is idempotent, so a
  // caller that already pre-reduced its own input (lib/company-360.ts,
  // lib/outstanding-lookup.ts) is unaffected. Real bug found via ACG
  // Interior & Exhibition Pte Ltd's SOA detail modal coming back empty.
  const safePrefilter = customerNamePrefilter ? (significantWord(customerNamePrefilter) ?? customerNamePrefilter) : undefined;
  const rows = await pageAll(() => {
    let query = supabase
      .from('quickbooks_ar_aging_detail')
      .select('txn_type, qb_txn_id, doc_number, customer_name, txn_date, due_date, amount, open_balance, aging_bucket')
      .eq('qb_company', company);
    if (safePrefilter) query = query.ilike('customer_name', `%${safePrefilter}%`);
    return query;
  }) as Array<{
    txn_type: string; qb_txn_id: string | null; doc_number: string | null; customer_name: string;
    txn_date: string | null; due_date: string | null; amount: number | null; open_balance: number;
    aging_bucket: AgingBucket;
  }>;

  // Correct Invoice doc_number against its own authoritative source — found
  // live 2026-09-17 building the Statement PDF's own itemized description
  // (Vincent: "这部分为什么生成出来的没有像这个那么完整"), then confirmed
  // this is NOT a one-off: QuickBooks' AgedReceivableDetail REPORT API
  // (this table's own source) silently drops a purely-numeric DocNumber's
  // leading zero — the same real invoice is "02610894" in the Invoice
  // entity itself (quickbooks_invoices.invoice_no, synced separately via
  // the Invoice entity API, never the Report API) but "2610894" here.
  // Checked against real data: 433 of this app's 541 real unpaid invoices
  // across TAB/TAC/TAO (72-92% per book) have a leading zero and are
  // affected. This table is computeSoaRows()'s fresh-path source for
  // EVERY consumer — Company 360's Outstanding section
  // (app/companies/[id]/_components.tsx renders item.docNumber directly),
  // the Excel export (lib/soa-export.ts), the on-screen SOA list, and this
  // PDF — so left uncorrected here, every one of them would (and, before
  // this fix, did) show the wrong invoice number to staff and clients.
  // Credit Note doc numbers (e.g. "CN240023", "JV24-138") are untouched —
  // never purely numeric, so the Report API never reformats them; this only
  // ever needs to correct Invoice rows. Best-effort: an unmatched/failed
  // lookup just leaves the report's own value, same as before this fix.
  const invoiceTxnIds = [...new Set(
    rows.filter(r => r.txn_type === 'Invoice' && r.qb_txn_id).map(r => r.qb_txn_id as string),
  )];
  const authoritativeDocNumber = new Map<string, string>();
  if (invoiceTxnIds.length) {
    try {
      const invoiceRows = await pageAll(() => supabase
        .from('quickbooks_invoices')
        .select('qb_invoice_id, invoice_no')
        .eq('qb_company', company)
        .in('qb_invoice_id', invoiceTxnIds)) as Array<{ qb_invoice_id: string; invoice_no: string | null }>;
      for (const inv of invoiceRows) if (inv.invoice_no) authoritativeDocNumber.set(inv.qb_invoice_id, inv.invoice_no);
    } catch {
      // Correction is best-effort — a failed lookup here must never break
      // the whole snapshot read, it just leaves doc_number uncorrected.
    }
  }

  return {
    fresh: true,
    rows: rows.map(r => ({
      txnType: r.txn_type,
      qbTxnId: r.qb_txn_id,
      docNumber: (r.qb_txn_id && authoritativeDocNumber.get(r.qb_txn_id)) || r.doc_number,
      customerName: r.customer_name,
      txnDate: r.txn_date,
      dueDate: r.due_date,
      amount: r.amount,
      openBalance: r.open_balance,
      agingBucket: r.aging_bucket,
    })),
  };
}

// The effective "who chases this" shown on screen as Owner: a human's
// confirmed pick always wins, then the real QB-Class/Location signal, then
// (only when there's exactly one and no better signal) the sole PIC name —
// same 3-tier priority app/billing/soa/_components.tsx renders.
export function effectiveOwner(row: Pick<SoaCompanyRow, 'soaPic' | 'suggestedOwner' | 'picOptions'>): string | null {
  const singlePicFallback = row.picOptions.length === 1 ? row.picOptions[0] : null;
  return row.soaPic ?? row.suggestedOwner ?? singlePicFallback;
}

// `customerNamePrefilter`: narrows the initial unpaid-invoices query down
// to one company's own rows — used by lib/company-360.ts's Outstanding
// section so it isn't scanning every unpaid invoice across all customers
// just to show one company's own balance. Omitted (the on-screen Outstanding
// pages' own call), this behaves exactly as before — every company. Any
// value passed here is reduced to significantWord() before use, whether or
// not the caller already did that themselves (idempotent) — see
// loadArAgingSnapshot() and legacyComputeSoaRows()'s own comments for why
// that reduction is load-bearing, not cosmetic.
//
// Primary path (report fresh): totals/aging come entirely from the
// AgedReceivableDetail snapshot (loadArAgingSnapshot) — the report is
// authoritative for both the NUMBER and which customers even have a row.
// Owner-suggestion (picOptions/suggestedOwner) still reads
// quickbooks_invoices/quickbooks_invoice_items directly, exactly as
// before — this signal is structurally independent of totals (confirmed
// by reading the pre-report code: the CreditMemo-netting loop never fed
// entry.signals either, proving these were always two separate concerns
// sharing one loop only incidentally).
//
// Fallback path (report stale/never synced): legacyComputeSoaRows() below
// — today's exact pre-report Invoice+CreditMemo computation, kept
// verbatim as the concrete degraded-mode behavior for a real failure mode
// (report sync down), so a bad sync run never shows $0 for an entire book.
export async function computeSoaRows(company: QbCompany, opts?: { customerNamePrefilter?: string }): Promise<SoaCompanyRow[]> {
  const snapshot = await loadArAgingSnapshot(company, opts?.customerNamePrefilter);
  if (!snapshot.fresh) return legacyComputeSoaRows(company, opts);

  const supabase = createAdminClient();

  const [invoicesForSignals, companiesRes, ownersRes] = await Promise.all([
    pageAll(() => {
      let query = supabase
        .from('quickbooks_invoices')
        .select('customer_name, qb_company, qb_invoice_id, txn_date, balance, location_name')
        .eq('qb_company', company)
        .gt('balance', 0);
      if (opts?.customerNamePrefilter) query = query.ilike('customer_name', `%${opts.customerNamePrefilter}%`);
      return query;
    }) as Promise<Array<Pick<UnpaidInvoice, 'customer_name' | 'qb_company' | 'qb_invoice_id' | 'txn_date' | 'balance' | 'location_name'>>>,
    supabase.from('companies').select('id, company_name, pic'),
    supabase.from('soa_owners').select('customer_name_norm, soa_pic').eq('qb_company', company),
  ]);
  if (companiesRes.error) throw new Error(companiesRes.error.message);
  if (ownersRes.error) throw new Error(ownersRes.error.message);

  const unpaidInvoiceIds = [...new Set(invoicesForSignals.map(inv => inv.qb_invoice_id).filter(Boolean))];
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

  const byCompany = new Map<string, {
    displayName: string; invoiceCount: number; total: number; aging: AgingTotals; signals: OwnerInvoiceSignal[];
    unpaidInvoices: { invoiceNo: string; dueDate: string }[];
    lineItems: { docNumber: string; dueDate: string; txnDate: string; txnType: string; amount: number; bucket: AgingBucket }[];
  }>();

  // Seed from the report snapshot — authoritative for row EXISTENCE and for
  // total/aging. PAC excluded here on the same normalize()'d key the
  // exclusion has always used (the report supplies customer_name the same
  // way quickbooks_invoices/quickbooks_credit_memos always did).
  for (const row of snapshot.rows) {
    const key = normalize(row.customerName);
    if (!key || INTERNAL_ACCOUNT_NORM_NAMES.has(key)) continue;
    if (!byCompany.has(key)) byCompany.set(key, { displayName: row.customerName, invoiceCount: 0, total: 0, aging: emptyAgingTotals(), signals: [], unpaidInvoices: [], lineItems: [] });
    const entry = byCompany.get(key)!;
    entry.total += row.openBalance;
    entry.aging[row.agingBucket] += row.openBalance;
    // Same "CreditMemo/other rows never populate unpaidInvoices" precedent
    // as before — only genuine Invoice-type report rows count here.
    if (/invoice/i.test(row.txnType)) {
      entry.invoiceCount += 1;
      if (row.docNumber) entry.unpaidInvoices.push({ invoiceNo: row.docNumber, dueDate: row.dueDate ?? row.txnDate ?? '' });
    }
    // Every row, every type — see SoaCompanyRow.lineItems' own comment.
    entry.lineItems.push({
      docNumber: row.docNumber ?? row.qbTxnId ?? row.txnType,
      dueDate: row.dueDate ?? row.txnDate ?? '',
      txnDate: row.txnDate ?? row.dueDate ?? '',
      txnType: row.txnType,
      amount: row.openBalance,
      bucket: row.agingBucket,
    });
  }

  // Owner-suggestion signal only — deliberately never creates a byCompany
  // entry the report snapshot didn't already seed; the report is
  // authoritative for existence in this fresh path.
  for (const inv of invoicesForSignals) {
    if (!inv.txn_date) continue;
    const key = normalize(inv.customer_name);
    const entry = byCompany.get(key);
    if (!entry) continue;
    entry.signals.push({ qbInvoiceId: inv.qb_invoice_id, txnDate: inv.txn_date, locationName: inv.location_name });
  }

  return [...byCompany.entries()].map(([key, entry]) => {
    const companyMatch = companyByNormName.get(key) ?? wordMatch(key);
    const picFromCompanies = formatStaffNameList(companyMatch?.pic ?? null).filter(name => picAllowedForCompany(name, company));
    const picFromInvoices = collectInvolvedStaff(entry.signals, classNamesByInvoice, company);
    return {
      companyName: companyMatch?.company_name ?? entry.displayName,
      companyId: companyMatch?.id ?? null,
      pic: companyMatch?.pic ?? null,
      picOptions: [...new Set([...picFromCompanies, ...picFromInvoices])],
      soaPic: ownerByNormName.get(key) ?? null,
      suggestedOwner: computeSuggestedOwner(entry.signals, classNamesByInvoice, company),
      invoiceCount: entry.invoiceCount,
      totalOutstanding: Math.round(entry.total * 100) / 100,
      aging: entry.aging,
      unpaidInvoices: entry.unpaidInvoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      lineItems: entry.lineItems.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    };
  }).sort((a, b) => a.companyName.localeCompare(b.companyName)); // Vincent, 2026-09-07: "排序也是要按照ABC 的顺序排序"
}

// The pre-report (2026-09-15) computation, kept verbatim as
// computeSoaRows()'s fallback for when the AgedReceivableDetail snapshot
// is missing/stale for this company (see docs/INVARIANTS.md INV-QB-017) —
// not a vestige, the named, deliberate degraded-mode behavior for a real
// failure mode (report sync down), so that scenario shows a real
// (slightly less complete) number rather than $0 for an entire book.
async function legacyComputeSoaRows(company: QbCompany, opts?: { customerNamePrefilter?: string }): Promise<SoaCompanyRow[]> {
  const supabase = createAdminClient();

  // Same significantWord() reduction as loadArAgingSnapshot() above, and
  // for the exact same reason — this function has its own independent
  // ilike prefilter usage (not routed through loadArAgingSnapshot at all),
  // so it needed the identical fix, not just a shared helper call.
  const safePrefilter = opts?.customerNamePrefilter ? (significantWord(opts.customerNamePrefilter) ?? opts.customerNamePrefilter) : undefined;

  const [invoices, creditMemos, companiesRes, ownersRes] = await Promise.all([
    pageAll(() => {
      let query = supabase
        .from('quickbooks_invoices')
        .select('customer_name, qb_company, qb_invoice_id, invoice_no, txn_date, balance, location_name')
        .eq('qb_company', company)
        .gt('balance', 0);
      if (safePrefilter) query = query.ilike('customer_name', `%${safePrefilter}%`);
      return query;
    }) as Promise<UnpaidInvoice[]>,
    pageAll(() => {
      let query = supabase
        .from('quickbooks_credit_memos')
        .select('customer_name, qb_company, txn_date, balance, doc_number')
        .eq('qb_company', company)
        .gt('balance', 0);
      if (safePrefilter) query = query.ilike('customer_name', `%${safePrefilter}%`);
      return query;
    }) as Promise<UnappliedCreditMemo[]>,
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
    unpaidInvoices: { invoiceNo: string; dueDate: string }[];
    lineItems: { docNumber: string; dueDate: string; txnDate: string; txnType: string; amount: number; bucket: AgingBucket }[];
  }>();
  for (const inv of invoices) {
    if (!inv.txn_date || !inv.balance) continue;
    const key = normalize(inv.customer_name);
    if (!key || INTERNAL_ACCOUNT_NORM_NAMES.has(key)) continue;
    if (!byCompany.has(key)) byCompany.set(key, { displayName: inv.customer_name, invoiceCount: 0, total: 0, aging: emptyAgingTotals(), signals: [], unpaidInvoices: [], lineItems: [] });
    const entry = byCompany.get(key)!;
    entry.invoiceCount += 1;
    entry.total += inv.balance;
    const invBucket = agingBucket(inv.txn_date, today);
    entry.aging[invBucket] += inv.balance;
    entry.signals.push({ qbInvoiceId: inv.qb_invoice_id, txnDate: inv.txn_date, locationName: inv.location_name });
    const invDueDate = dueDate(inv.txn_date).toISOString().slice(0, 10);
    if (inv.invoice_no) entry.unpaidInvoices.push({ invoiceNo: inv.invoice_no, dueDate: invDueDate });
    entry.lineItems.push({ docNumber: inv.invoice_no, dueDate: invDueDate, txnDate: inv.txn_date, txnType: 'Invoice', amount: inv.balance, bucket: invBucket });
  }

  // Net unapplied CreditMemos into the SAME customer bucket, keyed the same
  // way (normalize(customer_name) — no separate matching scheme invented for
  // CreditMemo). A CreditMemo is bucketed into the aging bucket matching its
  // OWN txn_date, not merged into whichever invoice it might be "for" — this
  // exactly matches QuickBooks' own Aged Receivables report (confirmed
  // 2026-09-15 against a real example: Ligang Limited's $1,760 CreditMemo
  // landed in the 31-60 bucket, its $790 invoice separately in 91+over, only
  // the Total column net at -970). A company can appear here with ONLY a
  // credit and no unpaid invoice at all (net negative total, meaning we owe
  // them) — shown rather than silently dropped, matching QuickBooks' own
  // report rather than only ever showing customers who owe us.
  for (const cm of creditMemos) {
    if (!cm.txn_date || !cm.balance) continue;
    const key = normalize(cm.customer_name);
    if (!key || INTERNAL_ACCOUNT_NORM_NAMES.has(key)) continue;
    if (!byCompany.has(key)) byCompany.set(key, { displayName: cm.customer_name, invoiceCount: 0, total: 0, aging: emptyAgingTotals(), signals: [], unpaidInvoices: [], lineItems: [] });
    const entry = byCompany.get(key)!;
    entry.total -= cm.balance;
    const cmBucket = agingBucket(cm.txn_date, today);
    entry.aging[cmBucket] -= cm.balance;
    entry.lineItems.push({ docNumber: cm.doc_number ?? 'Credit Note', dueDate: cm.txn_date, txnDate: cm.txn_date, txnType: 'Credit Note', amount: -cm.balance, bucket: cmBucket });
  }

  return [...byCompany.entries()].map(([key, entry]) => {
    const companyMatch = companyByNormName.get(key) ?? wordMatch(key);
    const picFromCompanies = formatStaffNameList(companyMatch?.pic ?? null).filter(name => picAllowedForCompany(name, company));
    const picFromInvoices = collectInvolvedStaff(entry.signals, classNamesByInvoice, company);
    return {
      companyName: companyMatch?.company_name ?? entry.displayName,
      companyId: companyMatch?.id ?? null,
      pic: companyMatch?.pic ?? null,
      picOptions: [...new Set([...picFromCompanies, ...picFromInvoices])],
      soaPic: ownerByNormName.get(key) ?? null,
      suggestedOwner: computeSuggestedOwner(entry.signals, classNamesByInvoice, company),
      invoiceCount: entry.invoiceCount,
      totalOutstanding: Math.round(entry.total * 100) / 100,
      aging: entry.aging,
      // Oldest due date first — same "the oldest one matters most" framing
      // as the Aging bucket, and gives Company 360's Invoice/Due Date
      // columns a stable, meaningful order (not raw DB fetch order).
      unpaidInvoices: entry.unpaidInvoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
      lineItems: entry.lineItems.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')),
    };
  }).sort((a, b) => a.companyName.localeCompare(b.companyName)); // Vincent, 2026-09-07: "排序也是要按照ABC 的顺序排序"
}

// One row per (company, qbCompany) — the "All" view's own shape. Vincent,
// 2026-09-07: "在 Outstanding -TAB的上面加多一个3级标题（All）...举例：
// TAB/TAO 都有 1V CAPITAL PTE. LTD.，所有就要在ALL 出现2行" — deliberately
// NOT deduplicated across systems: a company owing on 2 systems is 2 real,
// separate rows, each tagged with which one it's from.
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
