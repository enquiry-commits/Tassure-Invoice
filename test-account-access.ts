// Which pages a login account may open. Since 2026-10-04 every account
// belongs to a TCS department workspace (lib/workspaces.ts — Vincent: "按照
// 部门去区分，显示页面给大家感觉好像使用的是不同的平台...数据还是共通的，只是
// 显示的区别"), and canSubjectOpen() is THE rule: proxy.ts (through
// lib/approved-accounts.ts's canAccountOpen), the assistant's page map and
// billing tools, My Tasks' sections, and the client menus all call it.
//
// The expected access below is written out route by route, independently of
// lib/workspaces.ts's own lists, from Vincent's 7 decisions — so a change to
// those lists that nobody approved fails here instead of shipping.
//
// Run: npx tsx test-account-access.ts
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { APPROVED_ACCOUNTS, getApprovedAccount, canAccountOpen, workspaceHome, type ApprovedAccount } from './lib/approved-accounts';
import { PAGE_RULES, WORKSPACES, WORKSPACE_ORDER, pageRuleFor, workspaceIncludes, switchableWorkspaces, canSubjectOpen, type WorkspaceId } from './lib/workspaces';
import { NAV_TREE, navLeaves } from './lib/nav-tree';
import { staffByTeam } from './lib/staff-directory';

const ROOT = process.env.ACCESS_GUARD_ROOT ?? process.cwd();
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (cond ? '' : `\n       ${detail}`));
  if (!cond) fail++;
};
const can = (a: ApprovedAccount | null, href: string) => {
  const u = new URL(href, 'https://app.local');
  return !!a && canAccountOpen(a, u.pathname, u.searchParams);
};
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

function pageRoutes(dir: string, route = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...pageRoutes(join(dir, entry.name), `${route}/${entry.name}`));
    else if (entry.name === 'page.tsx') out.push(route || '/');
  }
  return out;
}
const PAGE_ROUTES = pageRoutes(join(ROOT, 'app')).filter(r => r !== '/login');
// Every navigable URL: each page (a dynamic [id] filled in), both /billing
// tabs plus the bare and an odd ?tab=, and the one non-API route handler a
// browser opens (Proposal Generator's SSO hand-off).
const ROUTES = [
  ...PAGE_ROUTES.map(r => r.replace('[id]', '1')).flatMap(r => (r === '/billing' ? ['/billing', '/billing?tab=ar', '/billing?tab=billing', '/billing?tab=xyz'] : [r])),
  '/sso/proposal-generator',
].sort();

console.log('--- every account is in the department Vincent listed (2026-10-04) ---');
const EXPECTED_MEMBERS: Record<WorkspaceId, string[]> = {
  admin: ['vincent@tassure.com'],
  management: ['cindyzhang@tassure.com', 'samuellng@tassure.com', 'yeesoon@tassure.com'],
  finance: ['esther@tassure.com', 'chelsea@tassure.com'],
  secretarial: ['hoechyi@tassure.com', 'sengxin@tassure.com', 'shiming@tassure.com', 'shemin@tassure.com', 'minquan@tassure.com', 'jennylai@tassure.com', 'kahye@tassure.com'],
  account: ['jaytay@tassure.com', 'jingfei@tassure.com', 'vernice@tassure.com', 'yuheng@tassure.com', 'weien@tassure.com'],
  tax: ['clarencesaw@tassure.com', 'quinnietan@tassure.com', 'victoriayap@tassure.com'],
};
for (const ws of WORKSPACE_ORDER) {
  const actual = APPROVED_ACCOUNTS.filter(a => a.workspace === ws).map(a => a.email).sort();
  check(`${WORKSPACES[ws].title}: exactly ${EXPECTED_MEMBERS[ws].length} accounts`, JSON.stringify(actual) === JSON.stringify([...EXPECTED_MEMBERS[ws]].sort()), actual.join(', '));
}
check('all 21 accounts are placed', APPROVED_ACCOUNTS.length === 21 && Object.values(EXPECTED_MEMBERS).flat().length === 21);
const accTax = staffByTeam().filter(t => t.team === 'Accounting' || t.team === 'Tax').flatMap(t => t.members);
const missing = accTax.filter(s => !getApprovedAccount(s.email)).map(s => s.name);
check('no Accounting/Tax staff member is left without a login', missing.length === 0, missing.join(', '));

console.log('\n--- the access table, route by route ---');
const NOT_FOR_MANAGEMENT = ['/sg-news', '/turnover-ai', '/turnover-ai/project/1', '/admin/appearance', '/ai-learning', '/ai-quality', '/ai-usage', '/activity-insights'];
const ACCOUNT_ROUTES = [
  '/', '/my-tasks', '/companies', '/companies/1',
  '/billing?tab=ar', '/ar-reminder', '/billing?tab=xyz', // AR Reminder (an odd ?tab= renders AR too)
  '/billing', '/billing?tab=billing', '/billing/tao', // Billing Drafts: TAB/TAC and TAO
  '/billing/quotation',
  '/billing/soa', '/billing/soa/all', '/billing/soa/tab', '/billing/soa/tac', '/billing/soa/tao', // Outstanding, all 4 books
  '/billing/soa/originals', // Invoice Originals (INV-QB-037): the same departments as Outstanding
  '/billing/soa/originals-export', // Monthly Originals Export (INV-QB-040): same page rule as Outstanding; the API is Vincent + Chelsea only
  '/turnover-ai', '/turnover-ai/project/1',
];
const EXPECTED_ROUTES: Record<WorkspaceId, string[]> = {
  admin: ROUTES,
  management: ROUTES.filter(r => !NOT_FOR_MANAGEMENT.includes(r)),
  secretarial: ROUTES.filter(r => !NOT_FOR_MANAGEMENT.includes(r) && r !== '/reports'),
  finance: ROUTES.filter(r => !NOT_FOR_MANAGEMENT.includes(r) && !['/reports', '/post-incorporate', '/sso/proposal-generator'].includes(r)),
  account: ACCOUNT_ROUTES,
  tax: ACCOUNT_ROUTES.filter(r => !r.startsWith('/turnover-ai')),
};
check(`the table covers ${ROUTES.length} routes`, ROUTES.length >= 40, String(ROUTES.length));
for (const a of APPROVED_ACCOUNTS) {
  const opens = ROUTES.filter(r => can(a, r));
  const expected = [...EXPECTED_ROUTES[a.workspace]].sort();
  const extra = opens.filter(r => !expected.includes(r));
  const lost = expected.filter(r => !opens.includes(r));
  check(`${a.name} (${WORKSPACES[a.workspace].title}) opens exactly its ${expected.length} routes`, !extra.length && !lost.length, `extra: ${extra.join(', ') || '-'}; missing: ${lost.join(', ') || '-'}`);
}

console.log('\n--- rules that keep the table honest ---');
const unclassified = PAGE_ROUTES.filter(r => !pageRuleFor(r.replace('[id]', '1'), new URLSearchParams()));
check('every app/**/page.tsx belongs to a page rule (an unclassified page would be open to everyone)', unclassified.length === 0, unclassified.join(', '));
check('every page rule matches at least one real route', PAGE_RULES.every(rule => ROUTES.some(r => { const u = new URL(r, 'https://app.local'); return pageRuleFor(u.pathname, u.searchParams)?.key === rule.key; })));
check('every workspace lists only real rule keys', WORKSPACE_ORDER.every(ws => { const p = WORKSPACES[ws].pages; return p === 'all' || p.every(k => PAGE_RULES.some(r => r.key === k)); }));
check('every account can open its own home page (no redirect loop)', APPROVED_ACCOUNTS.every(a => can(a, workspaceHome(a))));
check('TCS ACCOUNT / TAX land on AR Reminder, everyone else on the Dashboard', APPROVED_ACCOUNTS.every(a => workspaceHome(a) === (a.workspace === 'account' || a.workspace === 'tax' ? '/billing?tab=ar' : '/')));
check('static files are never blocked (/my-tasks-robot.gif, /assets/...)', APPROVED_ACCOUNTS.every(a => can(a, '/my-tasks-robot.gif') && can(a, '/assets/x.png')));
check('a prefix never leaks into a sibling path (/companies-x is not Companies)', pageRuleFor('/companies-x', new URLSearchParams()) === null);
// A gated page needs the department's list AND the account's own flag; the
// two must agree, so moving someone into a department never silently grants
// (say) the power to create real QuickBooks Estimates.
for (const a of APPROVED_ACCOUNTS.filter(x => x.workspace !== 'admin')) {
  const mismatched = PAGE_RULES.filter(rule => rule.gate && workspaceIncludes(WORKSPACES[a.workspace], rule.key) !== !!a[rule.gate]).map(r => `${r.key}/${r.gate}`);
  check(`${a.name}: page list and permission flags agree`, mismatched.length === 0, mismatched.join(', '));
}
check('Quotation (creates real QuickBooks Estimates) is open to every account — Vincent chose 所有部门', APPROVED_ACCOUNTS.every(a => a.canViewQuotation && can(a, '/billing/quotation')));
check('AI Usage (everyone\'s AI tokens and cost): Vincent only — his choice, "只有我"', JSON.stringify(APPROVED_ACCOUNTS.filter(a => a.canViewAiUsage).map(a => a.email)) === JSON.stringify(['vincent@tassure.com']) && APPROVED_ACCOUNTS.every(a => can(a, '/ai-usage') === (a.email === 'vincent@tassure.com')));
check('Turnover AI: Vincent + the 5 TCS ACCOUNT staff only', JSON.stringify(APPROVED_ACCOUNTS.filter(a => a.canViewTurnoverAI).map(a => a.email).sort()) === JSON.stringify(['vincent@tassure.com', ...EXPECTED_MEMBERS.account].sort()));

console.log('\n--- 切换部门: display only, never a grant ---');
const switchers = APPROVED_ACCOUNTS.filter(a => a.canSwitchWorkspace).map(a => a.email).sort();
check('exactly Vincent, Cindy, Samuell and Yee Soon can switch', JSON.stringify(switchers) === JSON.stringify(['cindyzhang@tassure.com', 'samuellng@tassure.com', 'vincent@tassure.com', 'yeesoon@tassure.com']), switchers.join(', '));
const vincent = getApprovedAccount('vincent@tassure.com')!;
const cindy = getApprovedAccount('cindyzhang@tassure.com')!;
check('Vincent can preview all 6 departments; TCS MANAGEMENT all but ADMIN', switchableWorkspaces(vincent).length === 6 && JSON.stringify(switchableWorkspaces(cindy)) === JSON.stringify(['management', 'finance', 'secretarial', 'account', 'tax']));
check('nobody else can switch', APPROVED_ACCOUNTS.filter(a => !a.canSwitchWorkspace).every(a => switchableWorkspaces(a).length === 0));
const preview = (a: ApprovedAccount, ws: WorkspaceId) => ROUTES.filter(r => { const u = new URL(r, 'https://app.local'); return canSubjectOpen(a, u.pathname, u.searchParams, ws); });
for (const ws of WORKSPACE_ORDER) {
  const member = APPROVED_ACCOUNTS.find(a => a.workspace === ws)!;
  check(`Vincent previewing ${WORKSPACES[ws].title} sees exactly what ${member.name} sees`, JSON.stringify(preview(vincent, ws)) === JSON.stringify(ROUTES.filter(r => can(member, r))));
}
check('a preview can only narrow: Cindy previewing TCS ACCOUNT never sees Turnover AI (not hers to open)', !preview(cindy, 'account').includes('/turnover-ai') && preview(cindy, 'account').every(r => can(cindy, r)));

console.log('\n--- the menus are the same tree, filtered by the same rule ---');
const leaves = navLeaves(NAV_TREE).map(l => l.node.href!);
const unclassifiedLeaves = leaves.filter(h => { const u = new URL(h, 'https://app.local'); return !pageRuleFor(u.pathname, u.searchParams); });
check('every menu entry belongs to a page rule', unclassifiedLeaves.length === 0, unclassifiedLeaves.join(', '));
check('menu entries are unique', new Set(leaves).size === leaves.length);

console.log('\n--- source guards: one rule, used everywhere ---');
{
  const walk = (d: string, out: string[] = []): string[] => {
    for (const f of readdirSync(d)) {
      if (['node_modules', '.next', '.git'].includes(f)) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(f)) out.push(p);
    }
    return out;
  };
  const files = [...['app', 'lib', 'components'].flatMap(d => walk(join(ROOT, d))), join(ROOT, 'proxy.ts')].map(f => relative(ROOT, f).replace(/\\/g, '/'));
  // Comments may still tell the history; code may not use the old rule.
  const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const legacy = files.filter(f => /\brestrictedTo\b|\balsoAllowed\b|allowedPagesFor|isWithinRestriction/.test(code(f)));
  check('no code still reads the old restrictedTo / alsoAllowed rule', legacy.length === 0, legacy.join(', '));
  const proxy = read('proxy.ts');
  check('proxy.ts blocks pages through canAccountOpen() only — no hand-written flag blocks left', /canAccountOpen\(account,/.test(proxy) && !/!account\.(admin|canView\w+)/.test(proxy));
  for (const f of ['lib/assistant-pages.ts', 'app/api/assistant/route.ts', 'app/api/assistant/export/route.ts', 'app/api/billing/renewals/company/route.ts']) {
    check(`${f} uses canAccountOpen()`, /canAccountOpen\(account,/.test(read(f)));
  }
  check('My Tasks decides its sections with canAccountOpen()', /canAccountOpen\(account, url\.pathname/.test(read('lib/my-tasks-data.ts')));
  const sidebar = read('components/Sidebar.tsx');
  const mobile = read('components/MobileNav.tsx');
  check('Sidebar and MobileNav both draw lib/nav-tree.ts through filterNav()', [sidebar, mobile].every(s => /from '@\/lib\/nav-tree'/.test(s) && /filterNav\(NAV_TREE, canOpen\)/.test(s)));
  check('neither keeps its own list of links', [sidebar, mobile].every(s => !/href: '\//.test(s)));
  check('AppShell feeds both menus the same canOpen', /<MobileNav[^>]*canOpen=\{canOpen\}/.test(read('components/AppShell.tsx')) && /<Sidebar[^>]*canOpen=\{canOpen\}/.test(read('components/AppShell.tsx')));
}

console.log(fail === 0 ? '\nALL OK' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
