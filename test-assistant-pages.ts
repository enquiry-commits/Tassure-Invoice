// The assistant's map of the app (lib/assistant-pages.ts, INV-AI-009). Added
// 2026-09-28 after the assistant told Vincent the Quotation page didn't exist
// — it had simply never been added to this map. Pins:
//   1. every real app/**/page.tsx has an entry (a new page that isn't added
//      fails here instead of being silently denied by the assistant);
//   2. every page proxy.ts hard-blocks carries the SAME gate in `access`;
//   3. real accounts see exactly the pages they can open (incl. the
//      AR-Reminder-only accounts);
//   4. keyword navigation picks the most specific page.
//
// Run: npx tsx test-assistant-pages.ts
import fs from 'fs';
import path from 'path';
import { PAGES, canOpenPage, pagesFor, matchPage, pageAccessLine } from './lib/assistant-pages';
import { getApprovedAccount, type ApprovedAccount } from './lib/approved-accounts';

let fail = 0;
const check = (label: string, cond: boolean, detail = '') => {
  console.log((cond ? 'OK   ' : 'FAIL ') + label + (cond || !detail ? '' : ` -- ${detail}`));
  if (!cond) fail++;
};
const pathnameOf = (href: string) => new URL(href, 'https://app.local').pathname;

console.log('--- every real page is on the map ---');
function pageRoutes(dir: string, route = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...pageRoutes(path.join(dir, entry.name), `${route}/${entry.name}`));
    else if (entry.name === 'page.tsx') out.push(route || '/');
  }
  return out;
}
// Not navigable pages in their own right: the login screen, redirect-only
// routes kept for old bookmarks, Company 360 (one per company, described
// in the prompt as /companies/<its id>), and a Turnover AI project's own
// detail page (one per project, same shape — the assistant points users
// at /turnover-ai, the Projects list, and they click into their own).
const NOT_ON_MAP = new Set(['/login', '/billing/soa', '/ar-reminder', '/client-communications/drafts', '/companies/[id]', '/turnover-ai/project/[id]']);
const mapped = new Set(PAGES.map(p => pathnameOf(p.href)));
const routes = pageRoutes(path.join(process.cwd(), 'app'));
for (const route of routes) {
  if (NOT_ON_MAP.has(route)) continue;
  check(`${route} is on the map`, mapped.has(route));
}
for (const p of PAGES) {
  const pathname = pathnameOf(p.href);
  const exists = routes.includes(pathname) || fs.existsSync(path.join(process.cwd(), 'app', ...pathname.split('/').filter(Boolean), 'route.ts'));
  check(`map entry ${p.href} points at a real route`, exists);
  check(`map entry ${p.href} has label, desc and keywords`, !!p.label.trim() && !!p.desc.trim() && p.kw.length > 0);
}
check('hrefs are unique', new Set(PAGES.map(p => p.href)).size === PAGES.length);

console.log('\n--- proxy.ts hard-blocks match each entry\'s access gate ---');
const proxySource = fs.readFileSync(path.join(process.cwd(), 'proxy.ts'), 'utf8');
const gates = [
  ...[...proxySource.matchAll(/path === '([^']+)' && !account\.(\w+)/g)].map(m => ({ path: m[1], flag: m[2], prefix: false })),
  ...[...proxySource.matchAll(/path\.startsWith\('([^']+)'\) && !account\.(\w+)/g)].map(m => ({ path: m[1], flag: m[2], prefix: true })),
];
check('found the proxy.ts gates to compare against', gates.length >= 4, `${gates.length}`);
const bare: ApprovedAccount = { name: 'Test Staff', email: 'test@example.com' };
for (const gate of gates) {
  const entries = PAGES.filter(p => gate.prefix ? pathnameOf(p.href).startsWith(gate.path) : pathnameOf(p.href) === gate.path);
  check(`${gate.path} (${gate.flag}) has a map entry`, entries.length > 0);
  for (const e of entries) {
    check(`${e.href}: blocked without ${gate.flag}`, !canOpenPage(e, bare));
    check(`${e.href}: open with ${gate.flag}`, canOpenPage(e, { ...bare, [gate.flag]: true } as ApprovedAccount));
  }
}

console.log('\n--- real accounts ---');
const vincent = getApprovedAccount('vincent@tassure.com');
const chelsea = getApprovedAccount('chelsea@tassure.com');
const cindy = getApprovedAccount('cindyzhang@tassure.com');
const jay = getApprovedAccount('jaytay@tassure.com');
check('test accounts exist', !!vincent && !!chelsea && !!cindy && !!jay);
const labels = (a: ApprovedAccount | null) => pagesFor(a).map(p => p.href);
check('Vincent can open every page', pagesFor(vincent).length === PAGES.length);
const GATED_FOR_STAFF = ['/billing/quotation', '/reports', '/sg-news', '/turnover-ai', '/admin/appearance', '/ai-learning', '/ai-quality', '/activity-insights'];
check('Chelsea cannot open any gated page', GATED_FOR_STAFF.every(h => !labels(chelsea).includes(h)), labels(chelsea).filter(h => GATED_FOR_STAFF.includes(h)).join(', '));
check('Chelsea can open the ordinary pages', ['/companies', '/billing/soa/all', '/billing/tao', '/master-list/eot', '/post-incorporate', '/my-tasks'].every(h => labels(chelsea).includes(h)));
check('Cindy can open Reports', labels(cindy).includes('/reports'));
check('Cindy cannot open Quotation or Activity Insights (admin-only page)', !labels(cindy).includes('/billing/quotation') && !labels(cindy).includes('/activity-insights'));
// Accounting/Tax team (2026-10-04): AR Reminder + TAO Billing, where they issue TAO invoices.
check('Jay (Accounting) sees exactly AR Reminder + TAO Billing + My Tasks', JSON.stringify(labels(jay).sort()) === JSON.stringify(['/billing/tao', '/billing?tab=ar', '/my-tasks']), labels(jay).join(', '));
check('unidentified caller sees no gated page', pagesFor(null).every(p => !p.access));

console.log('\n--- page-access line ---');
check('Vincent: nothing blocked', pageAccessLine(vincent).includes('CANNOT open none'));
check('Chelsea: nothing gated open', pageAccessLine(chelsea).includes('CAN open none'));
check('Jay: confined line names both pages', pageAccessLine(jay).includes('confined to') && pageAccessLine(jay).includes('AR Reminder') && pageAccessLine(jay).includes('TAO Billing'));

console.log('\n--- keyword navigation picks the most specific page ---');
const nav = (t: string, a: ApprovedAccount | null, min = 1) => matchPage(t, a, min)?.href ?? null;
check('"turnover summary" → Turnover AI, not AR Reminder via "ar"', nav('turnover summary', vincent) === '/turnover-ai');
check('"soa tab" → the TAB book', nav('soa tab', vincent) === '/billing/soa/tab');
check('"soa" → All', nav('打开 soa', vincent) === '/billing/soa/all');
check('"tao billing" → TAO Billing, not Billing Drafts', nav('tao billing', vincent) === '/billing/tao');
check('"trademark in progress" → In Progress', nav('trademark in progress', vincent) === '/master-list/trademark/in-progress');
check('"开单草稿" still → Billing Drafts', nav('开单草稿', chelsea) === '/billing?tab=billing');
check('"late filing" still → Late Filing', nav('late filing', chelsea) === '/late-filing');
check('Chelsea asking for quotation gets no link to it', nav('quotation 怎么用', chelsea, 2) !== '/billing/quotation');
check('Vincent asking for quotation gets it', nav('quotation 怎么用', vincent, 2) === '/billing/quotation');

console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
process.exit(fail === 0 ? 0 : 1);
