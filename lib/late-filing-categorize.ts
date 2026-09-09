// Moved here from app/late-filing/page.tsx's own local categorize()/
// LateCategory (2026-09-09) so a server-side aggregate (a new late_filing_
// summary chat tool) can classify rows the EXACT same way the real page
// does, instead of re-deriving the rule a second time. Deliberately NOT in
// lib/late-filing-lookup.ts (which is `server-only`, since it queries
// Supabase) — this is a pure function with no I/O, so it can be imported
// from BOTH the client page and server-side chat tool code without
// breaking either bundle (the same class of client/server module-boundary
// bug already documented in docs/INVARIANTS.md INV-DOC-006 — a real
// build-breaking mistake made once this same day importing something with
// server-only dependencies into client code, not repeated here on purpose).
// Behavior is byte-for-byte unchanged from the original local function.
export type LateFilingCategoryRow = { remarks: string | null; next_agm_due_date: string | null };

// Classify a late-filing row into one of four buckets, so the count can be
// broken down instead of a single "Total". Signal comes from the auto-detection
// remark plus (for manual/strike-off rows) the outstanding due date:
//   serious  — genuinely, badly overdue (> 1 year) or actively being struck off
//   recent   — overdue, but only recently (<= 1 year past due)
//   review   — manually flagged as possibly-resolved, pending human check
// Vincent, 2026-08-20: dropped the old "habitual" bucket (a bad historical
// average alone, with no cycle actually overdue right now) — too easy to
// confuse with companies genuinely late today. A bad average is still
// shown as supplementary text on a row that IS currently overdue; it's
// just never the reason a row gets flagged at all on its own anymore
// (see app/api/late-filing/sync/route.ts's isLate).
export type LateCategory = 'serious' | 'recent' | 'review' | 'resolved';
export function categorizeLateFilingRow(row: LateFilingCategoryRow): LateCategory {
  const r = row.remarks ?? '';
  if (/^Resolved:/i.test(r)) return 'resolved';
  if (/^Review:/i.test(r)) return 'review';

  const overdueMatch = r.match(/Overdue (\d+) days/);
  const isStrikeOff = /STRIKE OFF/i.test(r);

  let overdueDays: number | null = overdueMatch ? parseInt(overdueMatch[1], 10) : null;
  // Manual strike-off rows (no "Overdue N" remark): derive from the due date.
  if (overdueDays === null && row.next_agm_due_date) {
    overdueDays = Math.round((Date.now() - new Date(row.next_agm_due_date + 'T00:00:00').getTime()) / 86400000);
  }

  if (isStrikeOff) return 'serious';
  if (overdueDays !== null && overdueDays > 365) return 'serious';
  return 'recent';
}
