import { staffMentionCandidates } from './staff-directory';
import { canSubjectOpen, WORKSPACES, type WorkspaceId } from './workspaces';

export type ApprovedAccount = {
  name: string;
  email: string;
  // The TCS department this login belongs to — decides its page list, home
  // page and header title (lib/workspaces.ts). Required on purpose: a new
  // account that nobody placed in a department fails to compile instead of
  // silently defaulting to "every page". Not lib/staff-directory.ts's `team`
  // (there "Management" means Esther/Chelsea and Cindy is "Partners", and that
  // field drives SOA-owner and assistant logic), and not QuickBooks'
  // Department/Location (`qbLocations` below).
  workspace: WorkspaceId;
  // Shows the 切换部门 (switch department) picker next to Logout. Display
  // only: it changes the menu and title shown, never what the account may
  // open — proxy.ts, every API and the assistant keep using the real account.
  // Its own flag, not `canViewAsOthers` (View As substitutes a whole identity;
  // this only previews a menu) — Vincent, 2026-10-04: Vincent + Cindy/
  // Samuell/Yee Soon.
  canSwitchWorkspace?: boolean;
  // The QuickBooks Location (Department) an invoice this person generates is
  // tagged with, per book — Location marks WHO keyed the invoice in
  // (INV-QB-013). TAO decided 2026-10-04 (Vincent: "尽量还原QB本来有的设定"):
  // all 60 latest hand-made TAO invoices carry the operator's Location, and
  // TAO's 17 Locations are staff full names, so every account whose name is
  // one of them got its TAO entry (verified against the live TAO list).
  // TAB, same evening (Vincent: "这个要全部开放啊 为什么只设TAO", once the
  // department split let TCS ACCOUNT/TAX bill in TAB/TAC): TAB's 17 active
  // Locations are the same 17 full names, so every account named after one
  // now carries it — the 8 ACCOUNT/TAX staff and Tan Yee Soon were missing
  // (those 9 Locations had never been used on a TAB invoice). TAC has only 8
  // Locations (some short names) and none for ACCOUNT/TAX or Yee Soon:
  // giving them one means CREATING it in QuickBooks first — a configured
  // Location QuickBooks doesn't have makes create-invoice refuse the invoice
  // — and on TAC a Location becomes the SOA owner fallback (no team filter,
  // ND lines carry no Class), so that is Vincent's call, not a mapping.
  // Every value here must exist in that book (test-invoice-pic-class.ts pins
  // the live lists). Accounts with no matching Location (Vincent, Cindy,
  // Samuell, Min Quan) create invoices without one, as before.
  qbLocations?: Partial<Record<'TAB' | 'TAC' | 'TAO', string>>;
  // Gates the Appearance Settings editor (app/admin/appearance) and its
  // PATCH route. Vincent only, per his own explicit scoping.
  admin?: boolean;
  // Gates the "View as" picker on My Tasks (app/my-tasks/page.tsx,
  // app/api/my-tasks/route.ts's own ?viewAs= check) — a separate flag from
  // `admin` on purpose, added 2026-09-02 when Vincent asked to extend just
  // this one permission to Cindy/Samuell/Yee Soon: reusing `admin` for it
  // would have also silently handed them Appearance Settings editing,
  // which was explicitly scoped to Vincent only. Never conflate two
  // unrelated permissions under one flag just because they both happen to
  // be "admin-ish" — grant exactly what was asked, nothing implied.
  canViewAsOthers?: boolean;
  // Gates the /reports page and its API route — customer-profile analytics
  // for leadership (source/SSIC/flow/revenue). Kept as its own flag, not
  // folded into `canViewAsOthers`, for the exact reason stated above: the
  // two happen to be the same 4 people today (Vincent, Cindy, Samuell, Tan
  // Yee Soon) but are conceptually unrelated permissions, and collapsing
  // them would silently couple their futures together.
  canViewReports?: boolean;
  // Originally gated the Activity Insights page/nav itself (real
  // click-path/action behavioral analytics — lib/activity-data.ts,
  // user_activity_events). Added 2026-09-08, Vincent: "Vincent 和管理层，
  // 可以调用全部的数据来继续单独人员的了解，又或者是整体公司人员的了解".
  // 2026-09-09: Vincent moved that page into the Admin nav group and asked
  // that only he see it ("只有Vincent 可以看到") — app/activity-insights
  // and app/api/activity/insights/route.ts now gate on `admin` instead.
  // This flag is left as-is (still true for Cindy/Samuell/Yee Soon) because
  // it also gates a genuinely different, still-shared feature: the AI
  // Learning candidates cross-staff view (app/api/ai-learning/candidates,
  // app/ai-learning/page.tsx's bulk-approve staff list) — narrowing THIS
  // flag would have silently taken that away from them too, which Vincent
  // never asked for. If nothing ends up using this flag beyond AI Learning,
  // consider renaming it to reflect that narrower scope.
  canViewActivityInsights?: boolean;
  // Gates the new "SG Latest News" page/nav item and its API routes
  // (app/sg-news, app/api/sg-news/*) — daily ACRA/IRAS/MOM/ICA/ISCA/CSIS +
  // Straits Times/Business Times/Zaobao monitoring. Added 2026-09-23,
  // Vincent-only while the feature is still in development: "目前由于在开
  // 发阶段，我要你只开放权限给 Vincent一个人先可以看到，其他人先隐藏起
  // 来". A dedicated flag, not `admin` — same reasoning this file's own
  // comments already give for `canViewReports`/`canViewAsOthers`: this
  // happens to be Vincent-only TODAY, but is conceptually its own
  // permission, and should stay easy to hand to someone else later without
  // that silently also handing them Appearance Settings/AI Learning.
  canViewSgNews?: boolean;
  // Gates the new Billing System › Quotation page/nav item and its API routes
  // (app/billing/quotation, app/api/billing/quotation, and the manual-refresh
  // trigger of app/api/quickbooks/estimates/sync) — QuickBooks Estimates and,
  // once one is Closed, which book (TAB/TAC/TAO) its invoice was issued in.
  // Added 2026-09-24, Vincent-only while the trace was being checked against
  // real data. Opened to every department 2026-10-04 (Vincent, choosing
  // "所有部门" when the departments were split — New Quotation creates a REAL
  // QuickBooks Estimate). Kept as its own explicit per-account flag anyway: the
  // workspace page list and this flag must agree (test-account-access.ts), so
  // moving someone into a department never grants it as a side effect.
  canViewQuotation?: boolean;
  // Gates the new "Turnover AI" top-level nav group (app/turnover-ai/*) and
  // its API routes (app/api/turnover-ai/*) — reads a client's receipts/
  // invoices with Claude vision and lets Account staff confirm a reconciled
  // turnover total. Added 2026-09-28, Vincent-only while it was new. Opened to
  // TCS ACCOUNT 2026-10-04 (Vincent's department list: ACCOUNT gets Turnover
  // AI, TAX does not; MANAGEMENT kept as is). Explicit per account for the
  // same reason as `canViewQuotation` above.
  canViewTurnoverAI?: boolean;
  // Gates Admin › AI Usage (app/ai-usage) and its API (app/api/ai-usage) —
  // every person's AI token usage and estimated cost (docs/INVARIANTS.md
  // INV-AI-010). Vincent, 2026-10-05: only he sees it ("只有我"). Its own
  // flag rather than `admin`, so handing someone admin later never also
  // hands them everyone's usage.
  canViewAiUsage?: boolean;
};

// Grouped by TCS department (Vincent, 2026-10-04 — see lib/workspaces.ts for
// each department's pages). SX/SM/MQ/KY/HC resolved against
// lib/staff-directory.ts's own aliases; SHEMIN is listed separately, so SM is
// Ang Shi Ming.
export const APPROVED_ACCOUNTS: readonly ApprovedAccount[] = [
  // TCS ADMIN
  { name: 'Vincent Seow', email: 'vincent@tassure.com', workspace: 'admin', canSwitchWorkspace: true, admin: true, canViewAsOthers: true, canViewReports: true, canViewActivityInsights: true, canViewSgNews: true, canViewQuotation: true, canViewTurnoverAI: true, canViewAiUsage: true },
  // TCS MANAGEMENT
  { name: 'Cindy Zhang', email: 'cindyzhang@tassure.com', workspace: 'management', canSwitchWorkspace: true, canViewAsOthers: true, canViewReports: true, canViewActivityInsights: true, canViewQuotation: true },
  { name: 'Samuell Ng', email: 'samuellng@tassure.com', workspace: 'management', canSwitchWorkspace: true, canViewAsOthers: true, canViewReports: true, canViewActivityInsights: true, canViewQuotation: true },
  // New login account, added 2026-09-02 specifically to grant this
  // permission (Vincent confirmed the real login email directly: "准确是
  // Tan Yee Soon (yeesoon@tassure.com)") — previously only existed in
  // lib/staff-directory.ts (used for PIC-matching text, not login) with no
  // way to actually sign in at all.
  { name: 'Tan Yee Soon', email: 'yeesoon@tassure.com', workspace: 'management', canSwitchWorkspace: true, canViewAsOthers: true, canViewReports: true, canViewActivityInsights: true, canViewQuotation: true, qbLocations: { TAB: 'Tan Yee Soon', TAO: 'Tan Yee Soon' } },
  // TCS SECRETARIAL
  { name: 'Lim Hoe Chyi', email: 'hoechyi@tassure.com', workspace: 'secretarial', canViewQuotation: true, qbLocations: { TAB: 'Lim Hoe Chyi', TAC: 'Lim Hoe Chyi', TAO: 'Lim Hoe Chyi' } },
  { name: 'Hoo Seng Xin', email: 'sengxin@tassure.com', workspace: 'secretarial', canViewQuotation: true, qbLocations: { TAB: 'Hoo Seng Xin', TAC: 'Seng Xin', TAO: 'Hoo Seng Xin' } },
  { name: 'Jenny Lai', email: 'jennylai@tassure.com', workspace: 'secretarial', canViewQuotation: true, qbLocations: { TAB: 'Jenny Lai', TAC: 'Jenny Lai', TAO: 'Jenny Lai' } },
  { name: 'Chin Kah Ye', email: 'kahye@tassure.com', workspace: 'secretarial', canViewQuotation: true, qbLocations: { TAB: 'Chin Kah Ye', TAC: 'Kah Ye', TAO: 'Chin Kah Ye' } },
  { name: 'Ang Shi Ming', email: 'shiming@tassure.com', workspace: 'secretarial', canViewQuotation: true, qbLocations: { TAB: 'Ang Shi Ming', TAC: 'Shi Ming', TAO: 'Ang Shi Ming' } },
  { name: 'Tey Shemin', email: 'shemin@tassure.com', workspace: 'secretarial', canViewQuotation: true, qbLocations: { TAB: 'Tey Shemin', TAC: 'Shemin', TAO: 'Tey Shemin' } },
  { name: 'Tan Min Quan', email: 'minquan@tassure.com', workspace: 'secretarial', canViewQuotation: true },
  // TCS FINANCE
  { name: 'Esther Loo', email: 'esther@tassure.com', workspace: 'finance', canViewQuotation: true, qbLocations: { TAB: 'Esther Loo', TAC: 'Esther Loo', TAO: 'Esther Loo' } },
  { name: 'Chelsea Ang', email: 'chelsea@tassure.com', workspace: 'finance', canViewQuotation: true, qbLocations: { TAB: 'Chelsea Ang', TAC: 'Chelsea Ang', TAO: 'Chelsea Ang' } },
  // TCS ACCOUNT (Jay is the head) — AR Reminder was their only page from
  // 2026-08-17 and stays their home; TAO Billing joined 2026-10-04 ("TAO 这边
  // 就是主要给 ACC 和 TAX 去开单的"); the department split the same day opened
  // Dashboard, Companies, all of Billing Drafts, Quotation, Outstanding and
  // Turnover AI. TAB and TAO Locations exist in their names and are mapped;
  // TAC has none for them (see `qbLocations` above), so a TAC invoice they
  // generate carries no Location — same as any account without one.
  { name: 'Jay Tay', email: 'jaytay@tassure.com', workspace: 'account', canViewQuotation: true, canViewTurnoverAI: true, qbLocations: { TAB: 'Jay Tay', TAO: 'Jay Tay' } },
  { name: 'Lee Jing Fei', email: 'jingfei@tassure.com', workspace: 'account', canViewQuotation: true, canViewTurnoverAI: true, qbLocations: { TAB: 'Lee Jing Fei', TAO: 'Lee Jing Fei' } },
  { name: 'Tee Yu Heng', email: 'yuheng@tassure.com', workspace: 'account', canViewQuotation: true, canViewTurnoverAI: true, qbLocations: { TAB: 'Tee Yu Heng', TAO: 'Tee Yu Heng' } },
  { name: 'Vernice Chai', email: 'vernice@tassure.com', workspace: 'account', canViewQuotation: true, canViewTurnoverAI: true, qbLocations: { TAB: 'Vernice Chai', TAO: 'Vernice Chai' } },
  { name: 'Chee Wei En', email: 'weien@tassure.com', workspace: 'account', canViewQuotation: true, canViewTurnoverAI: true, qbLocations: { TAB: 'Chee Wei En', TAO: 'Chee Wei En' } },
  // TCS TAX (Clarence is the head; Quinnie Tan and Victoria Yap added
  // 2026-10-04 with their staff-directory emails) — same pages as TCS
  // ACCOUNT except Turnover AI.
  { name: 'Clarence Saw', email: 'clarencesaw@tassure.com', workspace: 'tax', canViewQuotation: true, qbLocations: { TAB: 'Clarence Saw', TAO: 'Clarence Saw' } },
  { name: 'Quinnie Tan', email: 'quinnietan@tassure.com', workspace: 'tax', canViewQuotation: true, qbLocations: { TAB: 'Quinnie Tan', TAO: 'Quinnie Tan' } },
  { name: 'Victoria Yap', email: 'victoriayap@tassure.com', workspace: 'tax', canViewQuotation: true, qbLocations: { TAB: 'Victoria Yap', TAO: 'Victoria Yap' } },
] as const;

const ACCOUNT_BY_EMAIL = new Map(
  APPROVED_ACCOUNTS.map(account => [account.email.toLowerCase(), account]),
);

export function getApprovedAccount(email: string | null | undefined): ApprovedAccount | null {
  return ACCOUNT_BY_EMAIL.get(String(email ?? '').trim().toLowerCase()) ?? null;
}

// Every approved account's name paired with every staff-directory string
// (name + aliases) that should resolve to it — computed once at module
// load, not per-call.
const MENTION_CANDIDATES = staffMentionCandidates();

/**
 * Finds an approved (loginable) account mentioned by name/alias/initials
 * inside a chunk of free text — e.g. a chat message: "如果我是HC，我要做
 * 什么今天？". Added 2026-09-08 for the My Tasks chat assistant's
 * cross-person lookup (Vincent: "我是最大的ADMIN，和管理层就可以问这些问
 * 题，其他人一般只能问自己相关的东西") — this function only FINDS who is
 * being asked about; the caller is responsible for checking
 * `canViewAsOthers` before actually showing that person's data (same
 * separation as getApprovedAccount, which also does no permission check
 * itself).
 *
 * Deliberately scoped to APPROVED_ACCOUNTS only — the exact same universe
 * the "View As" picker already offers (app/api/my-tasks/route.ts) — not
 * every name in the broader staff directory, most of whom have no login
 * account and nothing here could show anyway.
 *
 * Matching mirrors how these names/initials are actually typed (see
 * lib/staff-directory.ts's own comment on ad hoc initials): a short code
 * (<=4 letters, e.g. "HC", "LHC", "JF") is matched CASE-SENSITIVELY, in its
 * stored casing, so it doesn't fire on an ordinary lowercase word sitting
 * in the sentence around it; a longer name or alias matches
 * case-insensitively. Both require a whole-word boundary. Returns null,
 * never a guess, when nothing in the text matches.
 */
export function findMentionedAccount(text: string): ApprovedAccount | null {
  for (const account of APPROVED_ACCOUNTS) {
    const entry = MENTION_CANDIDATES.find(c => c.name === account.name);
    if (!entry) continue;
    for (const candidate of entry.mentions) {
      const isCode = candidate.length <= 4;
      const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`\\b${escaped}\\b`, isCode ? '' : 'i');
      if (pattern.test(text)) return account;
    }
  }
  return null;
}

export type ViewAsResolution =
  | { ok: true; account: ApprovedAccount; viewingAs: boolean }
  | { ok: false; status: 403 | 404; message: string };

/**
 * Resolves the account a request should actually operate AS: the real
 * caller by default, or — when `viewAsParam` (an email) is given and the
 * real caller has `canViewAsOthers` — the TARGET account instead. This is
 * full identity substitution, not a read-only preview: a caller acting
 * through this resolution creates/sends/pins/deletes as the target, into
 * the target's own real records. Added 2026-09-08 to extend "View As"
 * (previously Tasks-tab-only, app/api/my-tasks/route.ts) to the My Tasks
 * chat too — Vincent: "不只是还原，而且我作为最大的ADMIN 甚至是要可以带入
 * 到那个员工的身份，去开一个NEW CHAT 在她的记录...通过View as". Used by
 * the AI conversations routes and the assistant chat route; deliberately
 * NOT wired into app/api/my-tasks/route.ts itself, which already has its
 * own working, separately-verified inline version of this exact check —
 * left as is rather than refactored as a side effect of this change.
 *
 * Same permission, same shape as findMentionedAccount's own gate (both
 * ultimately check canViewAsOthers + getApprovedAccount) but this one
 * returns a definite resolution INCLUDING an explicit error the route can
 * hand back as a real 403/404, since here — unlike a chat tool result
 * Claude can phrase for the user — the caller is a plain API route that
 * needs a concrete HTTP response.
 */
export function resolveViewAsAccount(realAccount: ApprovedAccount, viewAsParam: string | null | undefined): ViewAsResolution {
  if (!viewAsParam) return { ok: true, account: realAccount, viewingAs: false };
  if (!realAccount.canViewAsOthers) {
    return { ok: false, status: 403, message: 'Your account cannot act as another staff member.' };
  }
  const target = getApprovedAccount(viewAsParam);
  if (!target) return { ok: false, status: 404, message: 'No approved account matches that email.' };
  return { ok: true, account: target, viewingAs: target.email !== realAccount.email };
}

/**
 * THE "may this account open this page" check on the server — proxy.ts, the
 * assistant's page map and billing tools, and My Tasks' sections all call
 * this, never their own copy. The rule itself lives in lib/workspaces.ts
 * (canSubjectOpen), which the client nav calls with the same data.
 */
export function canAccountOpen(account: ApprovedAccount, pathname: string, searchParams: URLSearchParams): boolean {
  return canSubjectOpen(account, pathname, searchParams);
}

/** Where proxy.ts sends an account that opens a page outside its workspace. */
export function workspaceHome(account: ApprovedAccount): string {
  return WORKSPACES[account.workspace].home;
}
