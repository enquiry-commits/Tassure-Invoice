import 'server-only';

import { createAdminClient } from './supabase';
import { todaySGT, thisYearSGT } from './date';
import { findStaffEmails } from './staff-directory';
import { normalize } from './company-name';
import { computeAllSoaRows, responsiblePeople, peopleLabel } from './soa-data';
import { loadSoaReminderHistory, resolveSoaReminderProgress, type SoaReminderProgress } from './soa-reminder-progress';
import { loadSoaRemarks, soaRemarksForCompany } from './soa-remarks';
import { getTrademarkSummary } from './trademark-lookup';
import { canAccountOpen, type ApprovedAccount } from './approved-accounts';
import type { QbCompany } from './quickbooks';

// Shared by GET /api/my-tasks (the on-screen list) and GET /api/assistant's
// new my_tasks_summary tool (2026-09-08 — Vincent: "更智能的分析和判断用户
// 要做什么，可以沟通，可以对话...每天打开My Tasks 的时候 AI助手会提醒今天
// 可能会需要完成的任务") so the passive daily banner, the conversational
// assistant, and the on-screen table can never silently disagree about
// what "my tasks" actually are for a given account — same "one shared
// computation" principle this repo already uses for lib/soa-data.ts etc.
//
// Scope widened 2026-09-22 (Vincent, looking at a real screenshot of this
// exact page: "现在这部分那么简陋，根本都称不上是提醒") — v1's AR
// Reminder + Late Filing-only scope (2026-08-31: "the only two areas with
// reliable per-person PIC data") was true on the day it was written, but
// this codebase has since built real per-person attribution for more
// domains that this function never went back to pick up: `soa_owners`
// (dedicated PIC table, added 2026-09-06) and `companies.pic`/`sec_pic`
// (already the established fallback-PIC pattern — see INV-DATA-049). Added
// SOA collections (real money owed, attributed via the exact same
// `responsiblePeople()` the SOA pages themselves use — everyone the PIC column lists, never a
// new rule) and Trademark renewals (attributed via the same
// company_name→companies.pic join Late Filing's own PIC fallback already
// uses, `getTrademarkSummary()`'s own existing 180-day "expiring soon"
// window — never a new threshold invented here). Nominee Director subrole
// review and Client Communications drafts are NOT added in this same pass
// — neither has an equally clean existing per-person attribution rule
// (ND review is company-scoped but not obviously "whose job", and a draft
// sitting unsent has no defined "needs attention" threshold anywhere in
// this codebase yet) — see docs/CURRENT_STATE.md's Pending improvements
// for why those still need a real decision from Vincent before being added
// the same way.
//
// Each section beyond AR Reminder appears only when the account's
// department opens that section's own page (the 2026-08-31 rule: My Tasks is
// scoped "to only the areas their account already has access to") — read
// through canAccountOpen() since the department split (2026-10-04), not a
// string comparison against the old AR-only `restrictedTo`, which would have
// silently handed TCS ACCOUNT/TAX every section the moment that field went.
const DUE_SOON_DAYS = 14;
const TRADEMARK_EXPIRING_SOON_DAYS = 180;

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

// reminderProgress / remarks: the same Reminder status and shared Remarks note the SOA Outstanding
// pages show for this company (2026-10-07: My Tasks' SOA table now lists them too).
export type SoaTask = { companyName: string; qbCompany: QbCompany; totalOutstanding: number; owner: string | null; reminderProgress: SoaReminderProgress; remarks: string | null };
export type TrademarkTask = { companyName: string; applicationNumber: string | null; markExpiredDate: string; daysUntilDue: number };

export type MyTasksData = {
  arReminder: {
    overdue: Record<string, unknown>[];
    staleOverdue: Record<string, unknown>[];
    dueSoon: Record<string, unknown>[];
  };
  // Each of these three is null (not computed at all — no extra queries)
  // when the account's department can't open that section's page: Late
  // Filing, Outstanding, Trademark.
  lateFiling: { needsAttention: Record<string, unknown>[] } | null;
  soaCollections: SoaTask[] | null;
  trademarkRenewals: TrademarkTask[] | null;
  counts: {
    arOverdue: number; arStaleOverdue: number; arDueSoon: number; lateFiling: number;
    soaCollections: number; trademarkRenewals: number; total: number;
  };
  // 2026-09-08 — Vincent, on his own account's Tasks tab: "还是很像摆设，
  // 不知道是不是没有数据支撑" — checked against all 911 ar_reminder rows
  // ever: his account has NEVER been PIC on a single one (he's the owner,
  // not a caseworker — this is structurally correct, not missing data).
  // "0 outstanding" and "never been assigned anything" are different
  // situations and deserve different copy — "you're all caught up" implies
  // the former. True whenever the account has EVER matched as PIC/owner on
  // ANY of the domains this function tracks (AR Reminder, Late Filing, SOA
  // collections, Trademark renewals — widened 2026-09-22 alongside the
  // scope above) — independent of the currently-open counts, which only
  // reflect CURRENTLY-relevant rows.
  everAssigned: boolean;
};

export async function computeMyTasks(account: ApprovedAccount): Promise<MyTasksData> {
  const opens = (href: string) => {
    const url = new URL(href, 'https://app.local');
    return canAccountOpen(account, url.pathname, url.searchParams);
  };
  const showLateFiling = opens('/late-filing');
  const showSoa = opens('/billing/soa/all');
  const showTrademark = opens('/master-list/trademark/master-records');
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
  let everAssigned = false;

  for (const row of (arRows ?? []) as ArRow[]) {
    const mine = matchedAs(row, account.email);
    if (!mine.length) continue;
    everAssigned = true;
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
  if (showLateFiling) {
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
      everAssigned = true;
      needsAttention.push({
        id: row.id, companyName: row.company_name, uen: row.uen,
        financialYearEnd: row.financial_year_end, nextAgmDueDate: row.next_agm_due_date, remarks: row.remarks,
        mirroredArReminderId: row.mirrored_ar_reminder_id,
        pic: picRow.pic, accPic: picRow.acc_pic, taxPic: picRow.tax_pic, matchedAs: mine,
      });
    }
    lateFiling = { needsAttention };
  }

  // SOA collections — attributed via responsiblePeople(), the EXACT function
  // the SOA pages themselves use (INV-PIC-011): EVERYONE the PIC column lists
  // is responsible, so each of them sees the company here — never a new rule.
  // computeAllSoaRows() is the one shared computation 6+ other SOA-facing
  // features already fan out from (docs/FEATURE_MAP.md), so this can never
  // silently disagree with what the SOA/Outstanding pages themselves show.
  let soaCollections: SoaTask[] | null = null;
  if (showSoa) {
    const [allSoaRows, reminderHistory, soaRemarks] = await Promise.all([computeAllSoaRows(), loadSoaReminderHistory(supabase), loadSoaRemarks(supabase)]);
    soaCollections = allSoaRows
      // EVERYONE responsible (the PIC column's people) gets the chase on their list (INV-PIC-011)
      .filter(row => row.totalOutstanding > 0 && responsiblePeople(row).some(person => findStaffEmails(person).includes(account.email)))
      .map(row => ({
        companyName: row.companyName, qbCompany: row.qbCompany, totalOutstanding: row.totalOutstanding, owner: peopleLabel(responsiblePeople(row)) || null,
        reminderProgress: resolveSoaReminderProgress(reminderHistory, row, row.qbCompany),
        remarks: soaRemarksForCompany(soaRemarks, row.companyName),
      }))
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    if (soaCollections.length) everAssigned = true;
  }

  // Trademark renewals — attributed via companies.pic/sec_pic, the EXACT
  // same company_name→companies fallback join Late Filing's own PIC
  // resolution already relies on (INV-DATA-049), matched with normalize()
  // for the same reason that invariant exists (a trailing-dot/casing
  // mismatch must not silently drop a real match). "Expiring soon" is
  // getTrademarkSummary()'s own existing 180-day window, not a new
  // threshold invented here.
  let trademarkRenewals: TrademarkTask[] | null = null;
  if (showTrademark) {
    const { expiringSoon } = await getTrademarkSummary(TRADEMARK_EXPIRING_SOON_DAYS);
    if (expiringSoon.length) {
      const { data: companyRows } = await supabase.from('companies').select('company_name, pic, sec_pic');
      const picByNormName = new Map((companyRows ?? []).map(c => [normalize(c.company_name as string), { pic: c.pic as string | null, sec_pic: c.sec_pic as string | null }]));
      trademarkRenewals = expiringSoon
        .filter(row => {
          const company = picByNormName.get(normalize(row.companyName));
          return company && findStaffEmails(company.sec_pic ?? company.pic).includes(account.email);
        })
        .map(row => ({ ...row, daysUntilDue: daysUntil(row.markExpiredDate, today) ?? 0 }))
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue);
      if (trademarkRenewals.length) everAssigned = true;
    } else {
      trademarkRenewals = [];
    }
  }

  return {
    arReminder: { overdue, staleOverdue, dueSoon },
    lateFiling,
    soaCollections,
    trademarkRenewals,
    counts: {
      arOverdue: overdue.length,
      arStaleOverdue: staleOverdue.length,
      arDueSoon: dueSoon.length,
      lateFiling: lateFiling?.needsAttention.length ?? 0,
      soaCollections: soaCollections?.length ?? 0,
      trademarkRenewals: trademarkRenewals?.length ?? 0,
      total: overdue.length + staleOverdue.length + dueSoon.length
        + (lateFiling?.needsAttention.length ?? 0) + (soaCollections?.length ?? 0) + (trademarkRenewals?.length ?? 0),
    },
    everAssigned,
  };
}
