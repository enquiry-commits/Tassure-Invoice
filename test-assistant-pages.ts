// The assistant's map of the app (lib/assistant-pages.ts, INV-AI-009). Added
// 2026-09-28 after the assistant told Vincent the Quotation page didn't exist
// — it had simply never been added to this map. Pins:
//   1. every real app/**/page.tsx has an entry (a new page that isn't added
//      fails here instead of being silently denied by the assistant);
//   2. every flag-gated page rule (lib/workspaces.ts — the rule proxy.ts
//      enforces) carries the SAME gate in `access`, and only those do;
//   3. real accounts see exactly the pages their department opens;
//   4. keyword navigation picks the most specific page.
//
// Run: npx tsx test-assistant-pages.ts
import fs from 'fs';
import path from 'path';
import { PAGES, canOpenPage, pagesFor, matchPage, pageAccessLine } from './lib/assistant-pages';
import { getApprovedAccount, type ApprovedAccount } from './lib/approved-accounts';
import { pageRuleFor } from './lib/workspaces';

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

console.log('\n--- each entry\'s access gate matches the page rule proxy.ts enforces ---');
// An admin-workspace test account, so only the page's own flag decides.
const bare: ApprovedAccount = { name: 'Test Staff', email: 'test@example.com', workspace: 'admin' };
for (const p of PAGES) {
  const url = new URL(p.href, 'https://app.local');
  const gate = pageRuleFor(url.pathname, url.searchParams)?.gate;
  if (gate) {
    check(`${p.href}: marked restricted (${gate})`, !!p.access);
    check(`${p.href}: blocked without ${gate}`, !canOpenPage(p, bare));
    check(`${p.href}: open with ${gate}`, canOpenPage(p, { ...bare, [gate]: true }));
  } else {
    check(`${p.href}: not marked restricted (no per-account flag)`, !p.access);
  }
}

console.log('\n--- real accounts ---');
const vincent = getApprovedAccount('vincent@tassure.com');
const chelsea = getApprovedAccount('chelsea@tassure.com');
const cindy = getApprovedAccount('cindyzhang@tassure.com');
const jay = getApprovedAccount('jaytay@tassure.com');
const clarence = getApprovedAccount('clarencesaw@tassure.com');
check('test accounts exist', !!vincent && !!chelsea && !!cindy && !!jay && !!clarence);
const labels = (a: ApprovedAccount | null) => pagesFor(a).map(p => p.href);
check('Vincent can open every page', pagesFor(vincent).length === PAGES.length);
// TCS FINANCE (2026-10-04): Billing System (incl. Quotation) + Master List, not Post Incorporate / Proposal Generator.
check('Chelsea (Finance) opens Companies, Outstanding, TAO, Master List, Quotation, My Tasks', ['/companies', '/billing/soa/all', '/billing/tao', '/master-list/eot', '/billing/quotation', '/my-tasks'].every(h => labels(chelsea).includes(h)));
check('Chelsea cannot open Post Incorporate, Proposal Generator, Reports, SG News, Turnover AI or the admin pages', ['/post-incorporate', '/sso/proposal-generator', '/reports', '/sg-news', '/turnover-ai', '/admin/appearance', '/ai-learning', '/ai-quality', '/activity-insights'].every(h => !labels(chelsea).includes(h)), labels(chelsea).join(', '));
check('Cindy (Management) opens Reports and Quotation', labels(cindy).includes('/reports') && labels(cindy).includes('/billing/quotation'));
check('Cindy cannot open Turnover AI, SG News or Activity Insights', ['/turnover-ai', '/sg-news', '/activity-insights'].every(h => !labels(cindy).includes(h)));
const ACC_TAX_PAGES = ['/', '/billing/quotation', '/billing/soa/all', '/billing/soa/tab', '/billing/soa/tac', '/billing/soa/tao', '/billing/tao', '/billing?tab=ar', '/billing?tab=billing', '/companies', '/my-tasks'];
check('Jay (TCS ACCOUNT) sees exactly Dashboard, Companies, AR Reminder, Billing Drafts, Quotation, Outstanding, My Tasks, Turnover AI', JSON.stringify(labels(jay).sort()) === JSON.stringify([...ACC_TAX_PAGES, '/turnover-ai'].sort()), labels(jay).join(', '));
check('Clarence (TCS TAX) sees the same minus Turnover AI', JSON.stringify(labels(clarence).sort()) === JSON.stringify([...ACC_TAX_PAGES].sort()), labels(clarence).join(', '));
check('unidentified caller sees no gated page', pagesFor(null).every(p => !p.access));

console.log('\n--- page-access line ---');
check('Vincent: nothing blocked', pageAccessLine(vincent).includes('TCS ADMIN') && pageAccessLine(vincent).includes('CANNOT open none'));
check('Chelsea: department named, Post Incorporate blocked', pageAccessLine(chelsea).includes('TCS FINANCE') && /CANNOT open .*Post Incorporate/.test(pageAccessLine(chelsea)));
check('Jay: department named, AR Reminder and TAO Billing open, Late Filing blocked', pageAccessLine(jay).includes('TCS ACCOUNT') && /CAN open .*AR Reminder.*TAO Billing.*; CANNOT/.test(pageAccessLine(jay)) && /CANNOT open .*Late Filing/.test(pageAccessLine(jay)));

console.log('\n--- keyword navigation picks the most specific page ---');
const nav = (t: string, a: ApprovedAccount | null, min = 1) => matchPage(t, a, min)?.href ?? null;
check('"turnover summary" → Turnover AI, not AR Reminder via "ar"', nav('turnover summary', vincent) === '/turnover-ai');
check('"soa tab" → the TAB book', nav('soa tab', vincent) === '/billing/soa/tab');
check('"soa" → All', nav('打开 soa', vincent) === '/billing/soa/all');
check('"tao billing" → TAO Billing, not Billing Drafts', nav('tao billing', vincent) === '/billing/tao');
check('"trademark in progress" → In Progress', nav('trademark in progress', vincent) === '/master-list/trademark/in-progress');
check('"开单草稿" still → Billing Drafts', nav('开单草稿', chelsea) === '/billing?tab=billing');
check('"late filing" still → Late Filing', nav('late filing', chelsea) === '/late-filing');
check('Chelsea asking for quotation gets it (open to every department since 2026-10-04)', nav('quotation 怎么用', chelsea, 2) === '/billing/quotation');
check('Vincent asking for quotation gets it', nav('quotation 怎么用', vincent, 2) === '/billing/quotation');
check('Jay asking for late filing gets no link to it (not a TCS ACCOUNT page)', nav('late filing', jay) !== '/late-filing');
check('Clarence asking for turnover gets no Turnover AI link (TCS TAX has none)', nav('turnover ai', clarence) !== '/turnover-ai');
check('Jay asking for turnover gets Turnover AI', nav('turnover ai', jay) === '/turnover-ai');

console.log(`\n=== ${fail === 0 ? 'ALL PASSED' : `${fail} FAILURE(S)`} ===`);
process.exit(fail === 0 ? 0 : 1);
