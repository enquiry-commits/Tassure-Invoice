import 'server-only';

import { getLateFilingList, type LateRow } from '@/app/api/late-filing/route';
import { normalize, findUniqueBestMatch } from './company-name';
import { categorizeLateFilingRow, type LateCategory } from './late-filing-categorize';

// Added 2026-09-09, phase 2 of the agentic-chat direction (Vincent: "可以
// 把上面的4项分阶段进行吗？我觉得都需要" — after invoicing, next up is
// Late Filing). Same shape as lib/billing-lookup.ts: calls the EXACT same
// computation app/late-filing/page.tsx's own "Resolve" button relies on
// (getLateFilingList(), extracted verbatim from GET() in the same route
// file), narrows to one company via the same normalize()/
// findUniqueBestMatch() matcher used everywhere else in this codebase, and
// reproduces the real page's own resolve() logic for what the new remarks
// value would be (app/late-filing/page.tsx:318-337) — never a second,
// differently-worded guess at that rule.
export type LateFilingResolvePreview = {
  companyName: string;
  uen: string;
  financialYearEnd: string;
  lateFy: number;
  nextAgmDueDate: string | null;
  currentRemarks: string | null;
  proposedRemarks: string;
  alreadyResolved: boolean;
};

export type LateFilingResolveResult =
  | { found: true; preview: LateFilingResolvePreview }
  | { found: false; suggestions: string[] };

// Verbatim port of app/late-filing/page.tsx's resolve() remarks logic.
function computeResolvedRemarks(currentRemarks: string | null): string {
  const previous = currentRemarks?.trim() ?? '';
  const remarks = /^Review:/i.test(previous)
    ? previous.replace(/^Review:/i, 'Resolved:')
    : `Resolved: ${previous || 'Reviewed and completed'}`;
  return remarks;
}

export async function previewLateFilingResolve(companyQuery: string): Promise<LateFilingResolveResult> {
  const trimmed = companyQuery.trim();
  const rows = await getLateFilingList();
  const byName = new Map(rows.map(r => [normalize(r.company_name), r] as const));

  let row: LateRow | undefined = byName.get(normalize(trimmed));
  if (!row) {
    const match = findUniqueBestMatch(trimmed, [...byName.entries()], entry => entry[0], 70).value;
    if (match) row = match[1];
  }
  if (!row) {
    const q = normalize(trimmed);
    const suggestions = rows
      .filter(r => normalize(r.company_name).includes(q))
      .slice(0, 5)
      .map(r => r.company_name);
    return { found: false, suggestions };
  }

  return {
    found: true,
    preview: {
      companyName: row.company_name,
      uen: row.uen,
      financialYearEnd: row.financial_year_end,
      lateFy: row.late_fy,
      nextAgmDueDate: row.next_agm_due_date,
      currentRemarks: row.remarks,
      proposedRemarks: computeResolvedRemarks(row.remarks),
      alreadyResolved: /^Resolved:/i.test(row.remarks ?? ''),
    },
  };
}

// Added 2026-09-09 — a real gap Vincent flagged: the Late Filing chat tool
// could only ever preview ONE named company (above); there was no way to
// answer "目前一共有多少家迟报" or "谁PIC压的最多" without opening the real
// page. Reuses getLateFilingList() (the exact same "still relevant" set the
// page's own default/ALL view shows) and categorizeLateFilingRow() (the
// exact same serious/recent/review/resolved split the page's own metric
// cards use) — no second, divergent computation.
export type LateFilingSummary = {
  totalRows: number;
  activeOverdue: number; // excludes 'resolved' — a resolved row isn't really "on someone's plate" anymore
  byCategory: { category: LateCategory; count: number }[];
  byPic: { pic: string; count: number }[]; // ACTIVE (non-resolved) rows only, sorted largest-first; 'Unassigned' for a null PIC
};

export async function getLateFilingSummary(): Promise<LateFilingSummary> {
  const rows = await getLateFilingList();
  const categoryCounts = new Map<LateCategory, number>();
  const picCounts = new Map<string, number>();
  let activeOverdue = 0;

  for (const row of rows) {
    const category = categorizeLateFilingRow(row);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    if (category !== 'resolved') {
      activeOverdue += 1;
      const pic = row.pic || 'Unassigned';
      picCounts.set(pic, (picCounts.get(pic) ?? 0) + 1);
    }
  }

  return {
    totalRows: rows.length,
    activeOverdue,
    byCategory: [...categoryCounts.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    byPic: [...picCounts.entries()].map(([pic, count]) => ({ pic, count })).sort((a, b) => b.count - a.count),
  };
}
