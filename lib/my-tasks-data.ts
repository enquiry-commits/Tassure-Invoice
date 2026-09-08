import 'server-only';

import { createAdminClient } from './supabase';
import { todaySGT, thisYearSGT } from './date';
import { findStaffEmails } from './staff-directory';
import type { ApprovedAccount } from './approved-accounts';

// Shared by GET /api/my-tasks (the on-screen list) and GET /api/assistant's
// new my_tasks_summary tool (2026-09-08 — Vincent: "更智能的分析和判断用户
// 要做什么，可以沟通，可以对话...每天打开My Tasks 的时候 AI助手会提醒今天
// 可能会需要完成的任务") so the passive daily banner, the conversational
// assistant, and the on-screen table can never silently disagree about
// what "my tasks" actually are for a given account — same "one shared
// computation" principle this repo already uses for lib/soa-data.ts etc.
//
// v1 scope unchanged from the original route: AR Reminder + Late Filing
// only — the only two areas with reliable per-person PIC data (see
// docs/FEATURE_MAP.md / PROJECT_STATUS.md 2026-08-31 entry).
const AR_ONLY_RESTRICTION = '/billing?tab=ar';
const DUE_SOON_DAYS = 14;

type ArRow = Record<string, unknown> & {
  id: number; fye_month: string; fye_year: number; due_date: string | null;
  filling_date: string | null; pic: string | null; acc_pic: string | null; tax_pic: string | null;
};

function daysUntil(dueDate: string | null, today: string): number | null {
  return dueDate
    ? Math.ceil((new Date(`${dueDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000)
    : null;
}

// A row is "mine" if I'm the SEC PIC, ACC PIC, or TAX PIC — checked as a
// triple, not assumed from which stage is missing, since all three are
// just columns on the same row with no stage-to-PIC mapping enforced
// anywhere in this codebase (confirmed during research for this feature).
function matchedAs(row: { pic: string | null; acc_pic: string | null; tax_pic: string | null }, email: string): ('pic' | 'acc_pic' | 'tax_pic')[] {
  const fields: ('pic' | 'acc_pic' | 'tax_pic')[] = [];
  if (findStaffEmails(row.pic).includes(email)) fields.push('pic');
  if (findStaffEmails(row.acc_pic).includes(email)) fields.push('acc_pic');
  if (findStaffEmails(row.tax_pic).includes(email)) fields.push('tax_pic');
  return fields;
}

export type MyTasksData = {
  arOnly: boolean;
  arReminder: {
    overdue: Record<string, unknown>[];
    staleOverdue: Record<string, unknown>[];
    dueSoon: Record<string, unknown>[];
  };
  lateFiling: { needsAttention: Record<string, unknown>[] } | null;
  counts: { arOverdue: number; arStaleOverdue: number; arDueSoon: number; lateFiling: number; total: number };
};

export async function computeMyTasks(account: ApprovedAccount): Promise<MyTasksData> {
  const arOnly = account.restrictedTo === AR_ONLY_RESTRICTION;
  const supabase = createAdminClient();
  const today = todaySGT();
  const thisYear = thisYearSGT();

  const { data: arRows, error: arError } = await supabase
    .from('ar_reminder')
    .select('*')
    .or('status.is.null,status.neq.Excluded');
  if (arError) throw new Error(arError.message);

  const overdue: Record<string, unknown>[] = [];
  const staleOverdue: Record<string, unknown>[] = [];
  const dueSoon: Record<string, unknown>[] = [];

  for (const row of (arRows ?? []) as ArRow[]) {
    const mine = matchedAs(row, account.email);
    if (!mine.length) continue;
    const filed = !!row.filling_date;
    if (filed) continue;
    const days = daysUntil(row.due_date, today);
    if (days === null) continue;
    const shaped = {
      id: row.id, entityName: row.entity_name, companyId: row.company_id, uen: row.uen,
      fyeMonth: row.fye_month, fyeYear: row.fye_year, dueDate: row.due_date, daysUntilDue: days,
      arStatus: row.ar_status, filed, pic: row.pic, accPic: row.acc_pic, taxPic: row.tax_pic,
      matchedAs: mine, remarks: row.remarks,
    };
    if (days < 0) {
      if ((row.fye_year as number) < thisYear) staleOverdue.push(shaped);
      else overdue.push(shaped);
    } else if (days <= DUE_SOON_DAYS) {
      dueSoon.push(shaped);
    }
  }
  const sortByDue = (a: Record<string, unknown>, b: Record<string, unknown>) => (a.daysUntilDue as number) - (b.daysUntilDue as number);
  overdue.sort(sortByDue);
  staleOverdue.sort(sortByDue);
  dueSoon.sort(sortByDue);

  let lateFiling: { needsAttention: Record<string, unknown>[] } | null = null;
  if (!arOnly) {
    const { data: lateRows, error: lateError } = await supabase
      .from('late_filing_companies')
      .select('id, company_name, uen, financial_year_end, next_agm_due_date, remarks, mirrored_ar_reminder_id')
      .not('mirrored_ar_reminder_id', 'is', null);
    if (lateError) throw new Error(lateError.message);

    const mirroredIds = [...new Set((lateRows ?? []).map(r => r.mirrored_ar_reminder_id as number))];
    const { data: mirroredArRows } = mirroredIds.length
      ? await supabase.from('ar_reminder').select('id, pic, acc_pic, tax_pic').in('id', mirroredIds)
      : { data: [] as { id: number; pic: string | null; acc_pic: string | null; tax_pic: string | null }[] };
    const picById = new Map((mirroredArRows ?? []).map(r => [r.id as number, r]));

    const needsAttention: Record<string, unknown>[] = [];
    for (const row of lateRows ?? []) {
      // "Resolved: ..." is this feature's own established convention
      // (app/late-filing/page.tsx) for a reviewed-and-retained row — it
      // still shows on /late-filing's own Resolved tab, just not here.
      if (/^Resolved:/i.test((row.remarks as string) || '')) continue;
      const picRow = picById.get(row.mirrored_ar_reminder_id as number);
      if (!picRow) continue;
      const mine = matchedAs(picRow, account.email);
      if (!mine.length) continue;
      needsAttention.push({
        id: row.id, companyName: row.company_name, uen: row.uen,
        financialYearEnd: row.financial_year_end, nextAgmDueDate: row.next_agm_due_date, remarks: row.remarks,
        mirroredArReminderId: row.mirrored_ar_reminder_id,
        pic: picRow.pic, accPic: picRow.acc_pic, taxPic: picRow.tax_pic, matchedAs: mine,
      });
    }
    lateFiling = { needsAttention };
  }

  return {
    arOnly,
    arReminder: { overdue, staleOverdue, dueSoon },
    lateFiling,
    counts: {
      arOverdue: overdue.length,
      arStaleOverdue: staleOverdue.length,
      arDueSoon: dueSoon.length,
      lateFiling: lateFiling?.needsAttention.length ?? 0,
      total: overdue.length + staleOverdue.length + dueSoon.length + (lateFiling?.needsAttention.length ?? 0),
    },
  };
}
