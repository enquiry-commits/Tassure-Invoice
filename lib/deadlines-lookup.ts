import 'server-only';

import { createAdminClient } from './supabase';
import { pageAll } from './page-all';
import { todaySGT } from './date';

// Added 2026-09-09 — "下个月有哪些deadline" had no answer at all: AR filing
// deadlines, AGM deadlines and trademark renewals each live in a different
// table and no tool crossed them. This unifies the three into one
// forward-looking view, plus what is ALREADY overdue (which matters more
// than what's upcoming and was equally unreachable).
//
// Deadline dates are taken from the fields the system itself treats as
// authoritative — verified against real data before relying on it:
// ar_reminder.due_date ALREADY carries the revised (extension-of-time) date
// where an EOT was granted (checked across every row that has one), so it
// is used directly rather than re-deriving "original vs revised"; the
// original/revised pair is still reported alongside as context so an
// extended deadline is visibly an extension, not silently a later date.
export type DeadlineItem = {
  kind: 'ar_filing' | 'agm' | 'trademark_renewal';
  companyName: string;
  dueDate: string;
  daysUntilDue: number; // negative = already overdue
  pic: string | null;
  extendedFrom: string | null; // original due date when an EOT moved it
  detail: string | null;
};

export type DeadlinesResult = {
  rangeDays: number;
  today: string;
  overdue: DeadlineItem[];
  upcoming: DeadlineItem[];
  countsByKind: { kind: string; overdue: number; upcoming: number }[];
};

const dayDiff = (from: string, to: string) =>
  Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000);

const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

export async function getUpcomingDeadlines(rangeDays = 30, limitPerKind = 40): Promise<DeadlinesResult> {
  const sb = createAdminClient();
  const today = todaySGT();
  const horizon = new Date(new Date(`${today}T00:00:00Z`).getTime() + rangeDays * 86_400_000).toISOString().slice(0, 10);

  const [arRows, tmRows] = await Promise.all([
    pageAll<Record<string, unknown>>(() => sb.from('ar_reminder')
      .select('entity_name, due_date, pic, status, filling_date, agm_held_date, fye_month, fye_year, ar_original_due_date, ar_revised_due_date, agm_original_due_date, agm_revised_due_date')
      .or('status.is.null,status.neq.Excluded')),
    sb.from('trademark_records').select('company_name, mark_expired_date, application_number, category')
      .eq('category', 'master')
      .then(r => r.data ?? []),
  ]);

  const items: DeadlineItem[] = [];

  for (const r of arRows) {
    const pic = (r.pic as string | null) ?? null;
    const cycle = r.fye_month && r.fye_year ? `FYE ${r.fye_month} ${r.fye_year}` : null;

    // AR filing — only cycles not yet filed.
    if (!r.filling_date && isIsoDate(r.due_date)) {
      const orig = r.ar_original_due_date;
      items.push({
        kind: 'ar_filing',
        companyName: r.entity_name as string,
        dueDate: r.due_date,
        daysUntilDue: dayDiff(today, r.due_date),
        pic,
        extendedFrom: isIsoDate(orig) && orig !== r.due_date ? orig : null,
        detail: cycle,
      });
    }

    // AGM — only where the AGM has not been held yet.
    const agmDue = isIsoDate(r.agm_revised_due_date) ? r.agm_revised_due_date
      : isIsoDate(r.agm_original_due_date) ? r.agm_original_due_date : null;
    if (!r.agm_held_date && agmDue) {
      const agmOrig = r.agm_original_due_date;
      items.push({
        kind: 'agm',
        companyName: r.entity_name as string,
        dueDate: agmDue,
        daysUntilDue: dayDiff(today, agmDue),
        pic,
        extendedFrom: isIsoDate(agmOrig) && agmOrig !== agmDue ? agmOrig : null,
        detail: cycle,
      });
    }
  }

  for (const t of tmRows as Record<string, unknown>[]) {
    if (!isIsoDate(t.mark_expired_date)) continue;
    items.push({
      kind: 'trademark_renewal',
      companyName: t.company_name as string,
      dueDate: t.mark_expired_date,
      daysUntilDue: dayDiff(today, t.mark_expired_date),
      pic: null,
      extendedFrom: null,
      detail: (t.application_number as string | null) ?? null,
    });
  }

  const byDate = (a: DeadlineItem, b: DeadlineItem) => a.dueDate.localeCompare(b.dueDate);
  const overdueAll = items.filter(i => i.dueDate < today).sort(byDate);
  const upcomingAll = items.filter(i => i.dueDate >= today && i.dueDate <= horizon).sort(byDate);

  const kinds: DeadlineItem['kind'][] = ['ar_filing', 'agm', 'trademark_renewal'];
  const capPerKind = (list: DeadlineItem[]) =>
    kinds.flatMap(k => list.filter(i => i.kind === k).slice(0, limitPerKind)).sort(byDate);

  return {
    rangeDays,
    today,
    overdue: capPerKind(overdueAll),
    upcoming: capPerKind(upcomingAll),
    countsByKind: kinds.map(k => ({
      kind: k,
      overdue: overdueAll.filter(i => i.kind === k).length,
      upcoming: upcomingAll.filter(i => i.kind === k).length,
    })),
  };
}
