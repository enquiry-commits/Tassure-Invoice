import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { getApprovedAccount, APPROVED_ACCOUNTS } from '@/lib/approved-accounts';
import { todaySGT, thisYearSGT } from '@/lib/date';
import { findStaffEmails } from '@/lib/staff-directory';

// My Tasks — the logged-in staff member's own outstanding items,
// aggregated. Scope for v1: AR Reminder + Late Filing only — the only two
// areas with reliable per-person PIC data (see docs/FEATURE_MAP.md /
// PROJECT_STATUS.md 2026-08-31 entry for why Nominee Director review,
// Client Communications drafts, and Trademark were left out: none of them
// have a real assignee column to attribute a row to a specific person).
//
// Auth via getRequestAccount (lib/request-account.ts) — the convention
// every other protected route uses (reads the session JWT off the cookie;
// proxy.ts's middleware already did a real getUser() check on this exact
// request), not app/api/auth/me/route.ts's own live getUser() re-check,
// which exists for a different reason (it's the client's own polling
// endpoint with no preceding guarantee).
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

export async function GET(req: NextRequest) {
  const realAccount = await getRequestAccount(req);
  if (!realAccount) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  // 2026-09-02: "View as" — Vincent asked to see what My Tasks looks like
  // for a different staff member ("我希望可以从这边看到不同权限的人看到的内容
  // 是什么...方便我优化调整"). Gated on its own `canViewAsOthers` flag
  // (lib/approved-accounts.ts), not `admin` — `admin` also gates
  // Appearance Settings editing, explicitly scoped to Vincent only by an
  // earlier decision; reusing it here would have silently handed
  // Appearance Settings access to whoever gets View-As next (Vincent
  // extended this same day to Cindy/Samuell — see that file's own
  // comment). Enforced server-side, not just hidden in the UI — an
  // account without the flag passing ?viewAs= gets a real 403, since this
  // is a genuine permission boundary (seeing another named person's PIC
  // assignments), not just a display preference.
  const viewAsParam = req.nextUrl.searchParams.get('viewAs');
  let account = realAccount;
  let viewingAs: { email: string; name: string } | null = null;
  if (viewAsParam) {
    if (!realAccount.canViewAsOthers) {
      return NextResponse.json({ error: 'Your account cannot view another staff member’s tasks.' }, { status: 403 });
    }
    const target = getApprovedAccount(viewAsParam);
    if (!target) return NextResponse.json({ error: 'No approved account matches that email.' }, { status: 404 });
    account = target;
    viewingAs = { email: target.email, name: target.name };
  }

  const arOnly = account.restrictedTo === AR_ONLY_RESTRICTION;
  const supabase = createAdminClient();
  const today = todaySGT();
  const thisYear = thisYearSGT();

  const { data: arRows, error: arError } = await supabase
    .from('ar_reminder')
    .select('*')
    .or('status.is.null,status.neq.Excluded');
  if (arError) return NextResponse.json({ error: arError.message }, { status: 500 });

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
    if (lateError) return NextResponse.json({ error: lateError.message }, { status: 500 });

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

  const counts = {
    arOverdue: overdue.length,
    arStaleOverdue: staleOverdue.length,
    arDueSoon: dueSoon.length,
    lateFiling: lateFiling?.needsAttention.length ?? 0,
    total: overdue.length + staleOverdue.length + dueSoon.length + (lateFiling?.needsAttention.length ?? 0),
  };

  return NextResponse.json({
    scope: arOnly ? 'ar-only' : 'full',
    scopeNote: arOnly
      ? (viewingAs
          ? `${viewingAs.name}'s account has access to AR Reminder only — showing their AR Reminder tasks.`
          : 'Your account has access to AR Reminder only — showing your AR Reminder tasks.')
      : "My Tasks currently covers AR Reminder and Late Filing only — Nominee Director reviews, Client Communications drafts and Trademark renewals aren't aggregated here yet.",
    generatedAt: today,
    arReminder: { overdue, staleOverdue, dueSoon },
    lateFiling,
    counts,
    viewingAs,
    // Only ever sent to a viewer with canViewAsOthers, regardless of whose
    // tasks are currently being shown — an account without the flag
    // passing ?viewAs= never gets this list back (403 above, before this
    // point).
    viewableAccounts: realAccount.canViewAsOthers
      ? APPROVED_ACCOUNTS.map(a => ({ email: a.email, name: a.name, restrictedTo: a.restrictedTo ?? null }))
      : undefined,
  });
}
