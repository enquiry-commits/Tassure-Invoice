// Department workspaces — which pages each TCS department opens, and the
// header title it sees. Vincent, 2026-10-04: "按照部门去区分，显示页面给大家
// 感觉好像使用的是不同的平台，实际上还是同一个系统...重点是数据还是共通的，
// 只是显示的区别". One system, one database, six branded menus — the
// Salesforce "Lightning App" shape, not multi-tenancy: APIs are NOT gated by
// workspace (the data stays shared), only page navigation is.
//
// The 7 decisions behind these lists (AskUserQuestion, same day): AR Reminder
// stays TCS ACCOUNT/TAX's home page; their Billing Drafts (TAB/TAC + TAO) and
// Outstanding (all 4 books) are fully open; a page outside a workspace's list
// is really blocked (proxy.ts redirects to the workspace home), not just
// hidden; Quotation is open to every department; TCS FINANCE keeps Master
// List but not Post Incorporate / Proposal Generator; TCS MANAGEMENT keeps
// exactly its current pages (Turnover AI and SG News stay Vincent's); the
// "抬头" is the top-bar title only (desktop and phone).
//
// canSubjectOpen() is THE page-access rule: lib/approved-accounts.ts's
// canAccountOpen() (proxy.ts, the assistant's page map and billing tools,
// My Tasks' sections) and the client nav (Sidebar, MobileNav, Dashboard
// links) all call it — never a second copy (docs/INVARIANTS.md INV-DATA-069).
//
// A page needs BOTH its workspace's list AND, for a gated page, the account's
// own flag. The flags stay explicit per account on purpose: putting someone
// in a department must never silently hand them the power to create real
// QuickBooks Estimates (Quotation) or the like — test-account-access.ts
// fails unless page list and flag agree for every account.
//
// Deliberately NOT `server-only` and imports nothing: pure data + string
// logic, shared by the browser bundle, proxy.ts and the guard tests.

export type WorkspaceId = 'admin' | 'management' | 'finance' | 'secretarial' | 'account' | 'tax';
export type AccessGate = 'admin' | 'canViewReports' | 'canViewSgNews' | 'canViewQuotation' | 'canViewTurnoverAI' | 'canViewAiUsage';
export type AccessSubject = { workspace: WorkspaceId } & Partial<Record<AccessGate, boolean>>;

type PageRule = { key: string; patterns: readonly string[]; gate?: AccessGate };

// Every navigable route belongs to exactly one rule (test-account-access.ts
// fails on an unclassified app/**/page.tsx). A plain pattern covers its own
// sub-paths segment by segment ('/companies' → '/companies/123', never
// '/companies-x'); '/' covers only itself; a pattern with a query requires
// those params (extra params a page adds, e.g. ?openCompany=, are fine).
export const PAGE_RULES: readonly PageRule[] = [
  { key: 'dashboard', patterns: ['/'] },
  { key: 'my-tasks', patterns: ['/my-tasks'] },
  { key: 'companies', patterns: ['/companies'] },
  { key: 'master-list', patterns: ['/master-list'] },
  { key: 'nominee-directors', patterns: ['/nominee-directors'] },
  { key: 'address-service', patterns: ['/address-service'] },
  // '/ar-reminder' is the old bookmark that redirects to the AR tab.
  { key: 'ar-reminder', patterns: ['/billing?tab=ar', '/ar-reminder'] },
  { key: 'late-filing', patterns: ['/late-filing'] },
  { key: 'billing-drafts-tab-tac', patterns: ['/billing?tab=billing'] },
  { key: 'billing-drafts-tao', patterns: ['/billing/tao'] },
  { key: 'quotation', patterns: ['/billing/quotation'], gate: 'canViewQuotation' },
  { key: 'outstanding', patterns: ['/billing/soa'] },
  { key: 'email-status', patterns: ['/client-communications'] },
  { key: 'post-incorporate', patterns: ['/post-incorporate'] },
  { key: 'proposal-generator', patterns: ['/sso/proposal-generator'] },
  { key: 'reports', patterns: ['/reports'], gate: 'canViewReports' },
  { key: 'sg-news', patterns: ['/sg-news'], gate: 'canViewSgNews' },
  { key: 'turnover-ai', patterns: ['/turnover-ai'], gate: 'canViewTurnoverAI' },
  // Everyone's AI token usage — Vincent only (2026-10-05, INV-AI-010).
  { key: 'ai-usage', patterns: ['/ai-usage'], gate: 'canViewAiUsage' },
  { key: 'admin', patterns: ['/admin', '/ai-learning', '/ai-quality', '/activity-insights'], gate: 'admin' },
];

export type Workspace = { id: WorkspaceId; title: string; home: string; pages: 'all' | readonly string[] };

const BILLING_SYSTEM = [
  'nominee-directors', 'address-service', 'ar-reminder', 'late-filing',
  'billing-drafts-tab-tac', 'billing-drafts-tao', 'quotation', 'outstanding', 'email-status',
] as const;
const ACCOUNT_TAX_BILLING = ['ar-reminder', 'billing-drafts-tab-tac', 'billing-drafts-tao', 'quotation', 'outstanding'] as const;

export const WORKSPACES: Record<WorkspaceId, Workspace> = {
  admin: { id: 'admin', title: 'TCS ADMIN', home: '/', pages: 'all' },
  management: {
    id: 'management', title: 'TCS MANAGEMENT', home: '/',
    pages: ['dashboard', 'my-tasks', 'reports', 'companies', 'master-list', ...BILLING_SYSTEM, 'post-incorporate', 'proposal-generator'],
  },
  finance: {
    id: 'finance', title: 'TCS FINANCE', home: '/',
    pages: ['dashboard', 'my-tasks', 'companies', 'master-list', ...BILLING_SYSTEM],
  },
  secretarial: {
    id: 'secretarial', title: 'TCS CORPSEC', home: '/',
    pages: ['dashboard', 'my-tasks', 'companies', 'master-list', ...BILLING_SYSTEM, 'post-incorporate', 'proposal-generator'],
  },
  account: {
    id: 'account', title: 'TCS ACCOUNT', home: '/billing?tab=ar',
    pages: ['dashboard', 'my-tasks', 'companies', ...ACCOUNT_TAX_BILLING, 'turnover-ai'],
  },
  tax: {
    id: 'tax', title: 'TCS TAX', home: '/billing?tab=ar',
    pages: ['dashboard', 'my-tasks', 'companies', ...ACCOUNT_TAX_BILLING],
  },
};

export const WORKSPACE_ORDER: readonly WorkspaceId[] = ['admin', 'management', 'finance', 'secretarial', 'account', 'tax'];

// app/billing/page.tsx renders Billing Drafts for tab=billing (also the
// default when ?tab= is absent) and AR Reminder for ANY other value — mirrored
// exactly, so an odd ?tab= can never open a tab a department doesn't have.
function effectiveParams(pathname: string, searchParams: URLSearchParams): URLSearchParams {
  if (pathname !== '/billing') return searchParams;
  const params = new URLSearchParams(searchParams);
  params.set('tab', (searchParams.get('tab') ?? 'billing') === 'billing' ? 'billing' : 'ar');
  return params;
}

function matchesPattern(pattern: string, pathname: string, searchParams: URLSearchParams): boolean {
  const target = new URL(pattern, 'http://internal');
  if ([...target.searchParams.keys()].length) {
    if (pathname !== target.pathname) return false;
    for (const [key, value] of target.searchParams) {
      if (searchParams.get(key) !== value) return false;
    }
    return true;
  }
  if (target.pathname === '/') return pathname === '/';
  return pathname === target.pathname || pathname.startsWith(`${target.pathname}/`);
}

export function pageRuleFor(pathname: string, searchParams: URLSearchParams): PageRule | null {
  const params = effectiveParams(pathname, searchParams);
  return PAGE_RULES.find(rule => rule.patterns.some(p => matchesPattern(p, pathname, params))) ?? null;
}

export function workspaceIncludes(workspace: Workspace, ruleKey: string): boolean {
  return workspace.pages === 'all' || workspace.pages.includes(ruleKey);
}

/**
 * THE page-access rule. `viewWorkspace` is the 切换部门 preview: it can only
 * NARROW what is shown (the previewed department's list ∩ the viewer's own
 * access) — it never grants anything, and server-side checks never pass it.
 */
export function canSubjectOpen(subject: AccessSubject, pathname: string, searchParams: URLSearchParams, viewWorkspace?: WorkspaceId): boolean {
  const own = WORKSPACES[subject.workspace];
  if (!own) return false;
  const rule = pageRuleFor(pathname, searchParams);
  // Not a page — a static file from public/ (/my-tasks-robot.gif, /assets/…)
  // or a path that will 404. Never blocked: denying it would break those
  // files for every department (it already broke them for the old
  // AR-Reminder-only accounts). Every real page route IS classified —
  // test-account-access.ts fails on any app/**/page.tsx without a rule.
  if (!rule) return true;
  if (!workspaceIncludes(own, rule.key)) return false;
  if (rule.gate && !subject[rule.gate]) return false;
  if (viewWorkspace && viewWorkspace !== subject.workspace && !workspaceIncludes(WORKSPACES[viewWorkspace], rule.key)) return false;
  return true;
}

export function canSubjectOpenHref(subject: AccessSubject, href: string, viewWorkspace?: WorkspaceId): boolean {
  const url = new URL(href, 'http://internal');
  return canSubjectOpen(subject, url.pathname, url.searchParams, viewWorkspace);
}

// Vincent can preview all six; TCS MANAGEMENT every department but ADMIN.
export function switchableWorkspaces(subject: { workspace: WorkspaceId; canSwitchWorkspace?: boolean }): WorkspaceId[] {
  if (!subject.canSwitchWorkspace) return [];
  return WORKSPACE_ORDER.filter(id => subject.workspace === 'admin' || id !== 'admin');
}

export function resolveViewWorkspace(subject: { workspace: WorkspaceId; canSwitchWorkspace?: boolean }, requested: string | null | undefined): WorkspaceId {
  return switchableWorkspaces(subject).find(id => id === requested) ?? subject.workspace;
}

export const VIEW_WORKSPACE_COOKIE = 'tcs_view_workspace';
