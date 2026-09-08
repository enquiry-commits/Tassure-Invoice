import { staffMentionCandidates } from './staff-directory';

export type ApprovedAccount = {
  name: string;
  email: string;
  // TAO added to the key type 2026-09-04 for type-consistency with the
  // widened QbCompany (lib/quickbooks.ts) — no staff has a TAO Location set
  // yet (Phase 2: deciding whether TAO invoices even use QB Locations is
  // Vincent's call, not made yet), this is purely so create-invoice/
  // route.ts's `account.qbLocations?.[company]` still type-checks now that
  // `company` can be 'TAO'.
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
  // Gates /admin/activity — real click-path/action behavioral analytics
  // (lib/activity-data.ts, user_activity_events), per-person and
  // company-wide. Added 2026-09-08, Vincent: "Vincent 和管理层，可以调用
  // 全部的数据来继续单独人员的了解，又或者是整体公司人员的了解" — kept as
  // its own flag rather than folded into canViewAsOthers/canViewReports
  // for the exact reason those two were kept separate from each other
  // (see canViewAsOthers' own comment): same 4 people today, conceptually
  // unrelated permission, don't couple their futures together.
  canViewActivityInsights?: boolean;
  // When set, this account is confined to exactly this one page (path +
  // required query params, e.g. AR Reminder is the 'ar' tab on /billing —
  // see components/Sidebar.tsx's tree for the canonical href). Enforced in
  // proxy.ts (redirects away from anything else, page navigation only —
  // API routes are unaffected) and mirrored in the sidebar (only that one
  // nav item renders) — see isWithinRestriction() below.
  restrictedTo?: string;
};

export const APPROVED_ACCOUNTS: readonly ApprovedAccount[] = [
  { name: 'Vincent Seow', email: 'vincent@tassure.com', admin: true, canViewAsOthers: true, canViewReports: true, canViewActivityInsights: true },
  { name: 'Cindy Zhang', email: 'cindyzhang@tassure.com', canViewAsOthers: true, canViewReports: true, canViewActivityInsights: true },
  { name: 'Samuell Ng', email: 'samuellng@tassure.com', canViewAsOthers: true, canViewReports: true, canViewActivityInsights: true },
  // New login account, added 2026-09-02 specifically to grant this
  // permission (Vincent confirmed the real login email directly: "准确是
  // Tan Yee Soon (yeesoon@tassure.com)") — previously only existed in
  // lib/staff-directory.ts (used for PIC-matching text, not login) with no
  // way to actually sign in at all.
  { name: 'Tan Yee Soon', email: 'yeesoon@tassure.com', canViewAsOthers: true, canViewReports: true, canViewActivityInsights: true },
  { name: 'Lim Hoe Chyi', email: 'hoechyi@tassure.com', qbLocations: { TAB: 'Lim Hoe Chyi', TAC: 'Lim Hoe Chyi' } },
  { name: 'Hoo Seng Xin', email: 'sengxin@tassure.com', qbLocations: { TAB: 'Hoo Seng Xin', TAC: 'Seng Xin' } },
  { name: 'Jenny Lai', email: 'jennylai@tassure.com', qbLocations: { TAB: 'Jenny Lai', TAC: 'Jenny Lai' } },
  { name: 'Chin Kah Ye', email: 'kahye@tassure.com', qbLocations: { TAB: 'Chin Kah Ye', TAC: 'Kah Ye' } },
  { name: 'Ang Shi Ming', email: 'shiming@tassure.com', qbLocations: { TAB: 'Ang Shi Ming', TAC: 'Shi Ming' } },
  { name: 'Tey Shemin', email: 'shemin@tassure.com', qbLocations: { TAB: 'Tey Shemin', TAC: 'Shemin' } },
  { name: 'Tan Min Quan', email: 'minquan@tassure.com' },
  { name: 'Esther Loo', email: 'esther@tassure.com', qbLocations: { TAB: 'Esther Loo', TAC: 'Esther Loo' } },
  { name: 'Chelsea Ang', email: 'chelsea@tassure.com', qbLocations: { TAB: 'Chelsea Ang', TAC: 'Chelsea Ang' } },
  // Vincent, 2026-08-17 (Clarence Saw added 2026-08-27): these 6 only see
  // AR Reminder — everything else in the system is hidden/blocked for them.
  { name: 'Jay Tay', email: 'jaytay@tassure.com', restrictedTo: '/billing?tab=ar' },
  { name: 'Lee Jing Fei', email: 'jingfei@tassure.com', restrictedTo: '/billing?tab=ar' },
  { name: 'Tee Yu Heng', email: 'yuheng@tassure.com', restrictedTo: '/billing?tab=ar' },
  { name: 'Vernice Chai', email: 'vernice@tassure.com', restrictedTo: '/billing?tab=ar' },
  { name: 'Chee Wei En', email: 'weien@tassure.com', restrictedTo: '/billing?tab=ar' },
  { name: 'Clarence Saw', email: 'clarencesaw@tassure.com', restrictedTo: '/billing?tab=ar' },
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

// Shared by proxy.ts (server-side enforcement) and the sidebar (which nav
// item to show) so the two never drift apart on what "within the
// restriction" means. Only requires the restricted href's OWN query params
// to match — extra params the target page adds itself (a permalink, a
// filter) don't count as "leaving" the allowed page.
export function isWithinRestriction(restrictedTo: string, pathname: string, searchParams: URLSearchParams): boolean {
  const allowed = new URL(restrictedTo, 'http://internal');
  if (pathname !== allowed.pathname) return false;
  for (const [key, value] of allowed.searchParams) {
    if (searchParams.get(key) !== value) return false;
  }
  return true;
}
