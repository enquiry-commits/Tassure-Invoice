import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { getApprovedAccount, APPROVED_ACCOUNTS } from '@/lib/approved-accounts';
import { computeMyTasks } from '@/lib/my-tasks-data';
import { generateMyTasksBrief } from '@/lib/my-tasks-brief';
import { getRecentActivity } from '@/lib/recent-activity';
import { todaySGT } from '@/lib/date';

// My Tasks — the logged-in staff member's own outstanding items,
// aggregated. Scope widened 2026-09-22 (Vincent, on a real screenshot of
// this exact page: "现在这部分那么简陋，根本都称不上是提醒") from the v1
// AR Reminder + Late Filing-only scope to also include SOA collections
// (via `soa_owners`/`effectiveOwner()`) and Trademark renewals (via
// `companies.pic`/`sec_pic`) — see lib/my-tasks-data.ts's own comment for
// why those two could be added safely (real existing PIC/owner data, real
// existing "needs attention" rules, nothing invented here) while Nominee
// Director review and Client Communications drafts still could not (no
// equally clean attribution or threshold exists for either yet).
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
//
// INV-PERF-001 — this route was already past the "5+ Supabase queries"
// threshold before 2026-09-22's SOA/Trademark scope widening (AR Reminder +
// Late Filing + mirrored-AR lookups) and is well past it now
// (computeAllSoaRows() alone issues several more); never had
// preferredRegion set. Added here rather than left for the next person to
// rediscover — Supabase is Tokyo-hosted, so every one of these round-trips
// was crossing the Pacific for no reason.
export const preferredRegion = 'sin1';

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
    // Rewritten to Chinese + updated for the widened scope, 2026-09-22 —
    // same "这个提醒的任务...没有做好" review. Still says plainly what's
    // NOT covered (honesty stays the point of this line, not just its
    // language) rather than implying the reminder is now complete.
    scopeNote: tasks.arOnly
      ? (viewingAs
          ? `${viewingAs.name} 的账号只有 AR Reminder 权限——只显示 TA 的 AR Reminder 任务。`
          : '你的账号只有 AR Reminder 权限——只显示你的 AR Reminder 任务。')
      : 'My Tasks 目前覆盖 AR Reminder、Late Filing、SOA 欠款催收和商标续期——Nominee Director 复核和 Client Communications 待发邮件还没有纳入。',
    generatedAt: todaySGT(),
    brief,
    recentActivity,
    arReminder: tasks.arReminder,
    lateFiling: tasks.lateFiling,
    soaCollections: tasks.soaCollections,
    trademarkRenewals: tasks.trademarkRenewals,
    counts: tasks.counts,
    everAssigned: tasks.everAssigned,
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
