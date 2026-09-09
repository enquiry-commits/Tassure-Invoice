import 'server-only';

import { createAdminClient } from './supabase';
import { normalize, findUniqueBestMatch } from './company-name';
import { computeSoaRows, effectiveOwner, type SoaCompanyRow } from './soa-data';
import { significantWord } from './company-360';
import { AGING_BUCKETS, oldestAgingBucket } from './soa';
import type { QbCompany } from './quickbooks';

// Added 2026-09-09 after a real, serious mistake: Vincent asked the chat
// widget about "1V Capital" and it answered "这家公司也没有欠款标记" (this
// company has no arrears marker either) — while Company 360's own real
// Outstanding section, open in the next tab, showed 2 real unpaid invoices
// totalling S$3,650 (S$1,000 TAB + S$2,650 TAO). Vincent: "这个回复就不对
// 了" / "明明有outstanding". Root cause: search_company's own `ar_reminders`
// field is Annual Return FILING status ("Pending"/"Filed") — a completely
// different concept from money owed — and no tool existed at all for real
// outstanding-balance data, so the model had nothing to check and answered
// from an unrelated field it misread as "no arrears" instead of saying it
// didn't know. This tool exists specifically so that mistake has a real,
// checkable answer available instead of a guess: it calls the EXACT SAME
// computeSoaRows() (lib/soa-data.ts) Company 360's own Outstanding section
// and the real /billing/soa pages use — never a second, re-derived notion
// of "outstanding" — narrowed to one company across all 3 QuickBooks
// companies (TAB/TAC/TAO), the same customerNamePrefilter + companyId/
// normalized-name match lib/company-360.ts's own Outstanding section uses,
// so a chat answer about arrears can never again diverge from what the
// real page shows.
export type OutstandingLine = {
  qbCompany: QbCompany;
  totalOutstanding: number;
  invoiceCount: number;
  oldestAgingBucketLabel: string | null;
  owner: string | null;
  unpaidInvoices: { invoiceNo: string; dueDate: string }[];
};

export type OutstandingLookupResult =
  | { found: true; companyName: string; hasOutstanding: boolean; totalOutstanding: number; lines: OutstandingLine[] }
  | { found: false; message: string; suggestions: string[] };

const bucketLabel = (bucket: ReturnType<typeof oldestAgingBucket>) =>
  bucket ? (AGING_BUCKETS.find(b => b.key === bucket)?.label ?? null) : null;

export async function lookupOutstandingBalance(companyQuery: string): Promise<OutstandingLookupResult> {
  const sb = createAdminClient();
  const trimmed = companyQuery.trim();

  // Full id+name fetch, matched in-memory — same "one small, cheap column
  // pair, matched via the one shared normalize()/findUniqueBestMatch()"
  // pattern this codebase already uses for every other single-company chat
  // lookup (lib/billing-lookup.ts, lib/late-filing-lookup.ts,
  // lib/invoice-edit-lookup.ts) rather than a fragile ilike-substring guess.
  const { data: companies } = await sb.from('companies').select('id, company_name');
  const rows = companies ?? [];
  let match = rows.find(c => normalize(c.company_name as string) === normalize(trimmed));
  if (!match) {
    const best = findUniqueBestMatch(trimmed, rows, r => r.company_name as string, 70).value;
    if (best) match = best;
  }
  if (!match) {
    const q = normalize(trimmed);
    const suggestions = rows.filter(c => normalize(c.company_name as string).includes(q)).slice(0, 5).map(c => c.company_name as string);
    return { found: false, message: `No company matched "${companyQuery}".`, suggestions };
  }

  const companyId = match.id as number;
  const companyName = match.company_name as string;
  const word = significantWord(companyName);
  const normName = normalize(companyName);
  const matchesThisCompany = (r: SoaCompanyRow) => (r.companyId != null ? r.companyId === companyId : normalize(r.companyName) === normName);

  const [tab, tac, tao] = await Promise.all(
    (['TAB', 'TAC', 'TAO'] as QbCompany[]).map(company =>
      word ? computeSoaRows(company, { customerNamePrefilter: word }).catch(() => [] as SoaCompanyRow[]) : Promise.resolve([] as SoaCompanyRow[]),
    ),
  );

  const lines: OutstandingLine[] = ([['TAB', tab], ['TAC', tac], ['TAO', tao]] as const)
    .map(([qbCompany, soaRows]) => {
      const row = soaRows.find(matchesThisCompany);
      if (!row) return null;
      return {
        qbCompany,
        totalOutstanding: row.totalOutstanding,
        invoiceCount: row.invoiceCount,
        oldestAgingBucketLabel: bucketLabel(oldestAgingBucket(row.aging)),
        owner: effectiveOwner(row),
        unpaidInvoices: row.unpaidInvoices,
      };
    })
    .filter((l): l is OutstandingLine => l !== null && l.totalOutstanding > 0);

  const totalOutstanding = lines.reduce((sum, l) => sum + l.totalOutstanding, 0);

  return { found: true, companyName, hasOutstanding: lines.length > 0, totalOutstanding, lines };
}

// Added 2026-09-09 — a second real gap the same day: "目前 TAB 的欠款总数
// 是多少？" (what's TAB's current total outstanding?) is a COMPANY-WIDE
// question, not a one-company question — lookupOutstandingBalance() above
// can't answer it (by design, it narrows to one company). This calls the
// exact same computeSoaRows() with NO prefilter — the exact real query
// GET /api/billing/soa?company=X uses for its own on-screen list — and
// sums it, so the real page and this chat answer can never diverge.
export type QbOutstandingSummary = {
  qbCompany: QbCompany;
  totalOutstanding: number;
  companyCount: number;
  topDebtors: { companyName: string; totalOutstanding: number; oldestAgingBucketLabel: string | null }[];
};

export async function summarizeOutstandingBalance(qbCompanies: QbCompany[]): Promise<QbOutstandingSummary[]> {
  const results = await Promise.all(
    qbCompanies.map(async (qbCompany): Promise<QbOutstandingSummary> => {
      const rows = await computeSoaRows(qbCompany).catch(() => [] as SoaCompanyRow[]);
      const totalOutstanding = rows.reduce((sum, r) => sum + r.totalOutstanding, 0);
      const topDebtors = [...rows]
        .sort((a, b) => b.totalOutstanding - a.totalOutstanding)
        .slice(0, 5)
        .map(r => ({ companyName: r.companyName, totalOutstanding: r.totalOutstanding, oldestAgingBucketLabel: bucketLabel(oldestAgingBucket(r.aging)) }));
      return { qbCompany, totalOutstanding, companyCount: rows.length, topDebtors };
    }),
  );
  return results;
}
