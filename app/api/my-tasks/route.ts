import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { getApprovedAccount, APPROVED_ACCOUNTS } from '@/lib/approved-accounts';
import { computeMyTasks } from '@/lib/my-tasks-data';
import { generateMyTasksBrief } from '@/lib/my-tasks-brief';
import { getRecentActivity } from '@/lib/recent-activity';
import { todaySGT } from '@/lib/date';

// My Tasks — the logged-in staff member's own outstanding items,
// aggregated. `arReminder`/`lateFiling`/`counts` scope for v1: AR Reminder
// + Late Filing only — the only two areas with reliable per-person PIC
// data (see docs/FEATURE_MAP.md / PROJECT_STATUS.md 2026-08-31 entry for
// why Nominee Director review, Client Communications drafts, and
// Trademark were left out: none of them have a real assignee column to
// attribute a row to a specific person).
//
// `recentActivity` (added 2026-09-08) is a SEPARATE, deliberately broader
// lens on top of that same limitation — see lib/recent-activity.ts's own
// comment: it reads the real audit-trail ("who did this") columns that DO
// already exist across Billing Drafts, Email Drafts/Campaigns, Master
// List, Post Incorporate, Trademark and SOA, none of which have a
// personal "queue" the way AR Reminder does, but all of which DO record
// who actually did something and when.
//
// Auth via getRequestAccount (lib/request-account.ts) — the convention
// every other protected route uses (reads the session JWT off the cookie;
// proxy.ts's middleware already did a real getUser() check on this exact
// request), not app/api/auth/me/route.ts's own live getUser() re-check,
// which exists for a different reason (it's the client's own polling
// endpoint with no preceding guarantee).
//
// 2026-09-08: the actual per-account computation moved to
// lib/my-tasks-data.ts's computeMyTasks() — shared with the assistant's
// new my_tasks_summary tool (app/api/assistant/route.ts) so the two can
// never disagree about what "my tasks" are for a given account. This
// route also now returns `brief` — Vincent: "每天打开My Tasks 的时候 AI
// 助手会提醒今天可能会需要完成的任务" — a short daily-priority sentence
// (lib/my-tasks-brief.ts) generated from the exact same computed data.
export async function GET(req: NextRequest) {
  const realAccount = await getRequestAccount(req);
  if (!realAccount) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  // "View as" — Vincent asked to see what My Tasks looks like for a
  // different staff member ("我希望可以从这边看到不同权限的人看到的内容
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

  let tasks;
  try {
    tasks = await computeMyTasks(account);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
  // Never let a briefing failure break the page — generateMyTasksBrief()
  // already degrades to a rule-based sentence internally, but this is a
  // last-resort guard against something unexpected (e.g. a network error
  // mid-fallback) so My Tasks itself still loads either way.
  const brief = await generateMyTasksBrief(tasks, account.name).catch(() => null);

  // 2026-09-08: real audit-trail activity (invoices generated, AR edits,
  // campaigns, Master List edits, sent emails, ...) — see lib/recent-
  // activity.ts's own comment for why this exists (My Tasks' AR+Late-
  // Filing-only lens made a genuinely active user like Chelsea look like
  // she'd done nothing). Same graceful-degrade-never-break-the-page
  // pattern as `brief` above.
  const recentActivity = await getRecentActivity(account.email).catch(() => []);

  return NextResponse.json({
    scope: tasks.arOnly ? 'ar-only' : 'full',
    scopeNote: tasks.arOnly
      ? (viewingAs
          ? `${viewingAs.name}'s account has access to AR Reminder only — showing their AR Reminder tasks.`
          : 'Your account has access to AR Reminder only — showing your AR Reminder tasks.')
      : "My Tasks currently covers AR Reminder and Late Filing only — Nominee Director reviews, Client Communications drafts and Trademark renewals aren't aggregated here yet.",
    generatedAt: todaySGT(),
    brief,
    recentActivity,
    arReminder: tasks.arReminder,
    lateFiling: tasks.lateFiling,
    counts: tasks.counts,
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
