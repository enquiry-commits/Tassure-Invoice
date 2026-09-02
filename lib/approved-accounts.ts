export type ApprovedAccount = {
  name: string;
  email: string;
  qbLocations?: Partial<Record<'TAB' | 'TAC', string>>;
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
  // When set, this account is confined to exactly this one page (path +
  // required query params, e.g. AR Reminder is the 'ar' tab on /billing —
  // see components/Sidebar.tsx's tree for the canonical href). Enforced in
  // proxy.ts (redirects away from anything else, page navigation only —
  // API routes are unaffected) and mirrored in the sidebar (only that one
  // nav item renders) — see isWithinRestriction() below.
  restrictedTo?: string;
};

export const APPROVED_ACCOUNTS: readonly ApprovedAccount[] = [
  { name: 'Vincent Seow', email: 'vincent@tassure.com', admin: true, canViewAsOthers: true },
  { name: 'Cindy Zhang', email: 'cindyzhang@tassure.com', canViewAsOthers: true },
  { name: 'Samuell Ng', email: 'samuellng@tassure.com', canViewAsOthers: true },
  // New login account, added 2026-09-02 specifically to grant this
  // permission (Vincent confirmed the real login email directly: "准确是
  // Tan Yee Soon (yeesoon@tassure.com)") — previously only existed in
  // lib/staff-directory.ts (used for PIC-matching text, not login) with no
  // way to actually sign in at all.
  { name: 'Tan Yee Soon', email: 'yeesoon@tassure.com', canViewAsOthers: true },
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
