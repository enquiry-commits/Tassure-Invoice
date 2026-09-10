import 'server-only';

import { createAdminClient } from './supabase';
import { normalize, resolveCompany } from './company-name';
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
  | { found: false; ambiguous: true; message: string; candidates: string[] }
  | { found: false; ambiguous?: false; message: string; suggestions: string[] };

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
  // Ambiguity is ASKED about, never reported as "not found" — see
  // resolveCompany()'s own comment on the real failure that motivated this.
  const resolved = resolveCompany(trimmed, rows, r => r.company_name as string, 70);
  if (resolved.kind === 'ambiguous') {
    return {
      found: false, ambiguous: true,
      message: `"${companyQuery}" matches ${resolved.candidates.length} companies — ask the user which one they mean, do NOT say it wasn't found.`,
      candidates: resolved.candidates.map(c => c.company_name as string),
    };
  }
  if (resolved.kind === 'none') {
    return { found: false, message: `No company matched "${companyQuery}".`, suggestions: [] };
  }
  const match = resolved.value;

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

// Added 2026-09-10 — a collections person's single most common question
// ("我手上有哪些欠款要催" / "Chelsea 要催哪些公司") had no answer, even
// though it is the SOA page's own headline feature. Vincent, in that page's
// own code comment: "我选择某个PIC,她就能看到和自己相关的所有欠款公司".
// summarizeOutstandingBalance's topDebtors deliberately carries no owner
// (it answers "how big is the book"), so this is a separate, owner-centric
// view over the SAME computeSoaRows() every other outstanding view uses —
// with effectiveOwner() (soa_owners override → Class/Location suggestion →
// sole PIC fallback), the exact ownership rule the page itself applies.
export type CollectionsWorklistRow = {
  qbCompany: QbCompany;
  companyName: string;
  totalOutstanding: number;
  invoiceCount: number;
  oldestAgingBucketLabel: string | null;
  owner: string | null;
};

export type CollectionsWorklist = {
  owner: string | null; // null = every owner (whole-firm view)
  totalOutstanding: number;
  companyCount: number;
  rows: CollectionsWorklistRow[];
  unassignedCount: number;
};

export async function getCollectionsWorklist(ownerQuery: string | null, qbCompanies: QbCompany[], limit = 40): Promise<CollectionsWorklist> {
  const perBook = await Promise.all(
    qbCompanies.map(async qbCompany => {
      const rows = await computeSoaRows(qbCompany).catch(() => [] as SoaCompanyRow[]);
      return rows.filter(r => r.totalOutstanding > 0).map(r => ({
        qbCompany,
        companyName: r.companyName,
        totalOutstanding: r.totalOutstanding,
        invoiceCount: r.invoiceCount,
        oldestAgingBucketLabel: bucketLabel(oldestAgingBucket(r.aging)),
        owner: effectiveOwner(r),
      }));
    }),
  );
  const all = perBook.flat();

  // Owner names are stored inconsistently across this system's own fields
  // ("Kah Ye Chin" vs "Chin Kah Ye" vs initials), so match on any word
  // overlap rather than an exact string — same reasoning as
  // lib/company-list-lookup.ts's PIC filter.
  let scoped = all;
  if (ownerQuery && ownerQuery.trim()) {
    const wanted = normalize(ownerQuery).split(' ').filter(w => w.length > 1);
    scoped = all.filter(r => {
      if (!r.owner) return false;
      const have = normalize(r.owner);
      return wanted.some(w => have.includes(w));
    });
  }

  const sorted = scoped.slice().sort((a, b) => b.totalOutstanding - a.totalOutstanding);
  return {
    owner: ownerQuery?.trim() || null,
    totalOutstanding: sorted.reduce((sum, r) => sum + r.totalOutstanding, 0),
    companyCount: sorted.length,
    rows: sorted.slice(0, limit),
    unassignedCount: all.filter(r => !r.owner).length,
  };
}
