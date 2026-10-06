import { canAccountOpen, type ApprovedAccount } from './approved-accounts';
import { WORKSPACES } from './workspaces';

// The My Tasks assistant's map of the app (app/api/assistant/route.ts renders
// it into the static prompt's "System map" and uses it for the keyword
// engine's navigation). It is the assistant's ONLY map: a page missing here
// is a page Claude will confidently say doesn't exist (Quotation, 2026-09-28 —
// docs/INVARIANTS.md INV-AI-009). test-assistant-pages.ts fails when a real
// app/**/page.tsx has no entry here.
//
// Who can open a page is decided by canAccountOpen() — the account's
// department workspace plus, for a flag-gated page, its own flag (the same
// rule proxy.ts enforces). `access` repeats a page's flag so the static,
// shared map can mark it "(restricted)"; pageAccessLine() states per request
// exactly which pages THIS account opens, and pagesFor() hides every other
// one from the keyword engine's navigation. `desc` is what the model tells a
// user the page is for — keep it to what the page actually does.
//
// Deliberately NOT `server-only`: pure data + string logic, so the test can
// import it (same as lib/client-comms-sop.ts).

export type SystemPage = { label: string; href: string; kw: string[]; desc: string; access?: (account: ApprovedAccount) => boolean };

const isAdmin = (account: ApprovedAccount) => !!account.admin;

export const PAGES: SystemPage[] = [
  { label: 'Dashboard 总览',        href: '/',                          kw: ['dashboard', '总览', '首页', 'overview', '主页'], desc: 'home: live KPIs (active clients, ND appointments, address service, upcoming AR, late-filing watch), the Action Centre, and Automation Health (whether the daily syncs ran)' },
  { label: 'Companies 公司库',      href: '/companies',                 kw: ['companies', '公司库', '公司列表', '所有公司'], desc: 'every company with TeamWork Internal CSS Status = Active, with client type and services; open one for its Company 360 page' },
  { label: 'Active Client 在任客户', href: '/master-list/active-clients', kw: ['active client', '在任客户', 'master list', '主名单'], desc: 'the client master list (UEN, FYE, PIC, service ticks); its Move menu sends a company to Strike Off / Terminated Services' },
  { label: 'Ad-Hoc',                href: '/master-list/ad-hoc',        kw: ['ad-hoc', 'ad hoc', '临时'], desc: 'master list of ad-hoc clients' },
  { label: 'MAS',                   href: '/master-list/mas',           kw: ['mas'], desc: 'master list of MAS-tagged clients (FYE, last accounts date, next AGM due)' },
  { label: 'Strike Off',            href: '/master-list/strike-off',    kw: ['strike off', 'strike-off', '除名'], desc: 'companies being struck off (shows "Striking Off" until TeamWork confirms the final status)' },
  { label: 'Terminated Services',   href: '/master-list/terminated',    kw: ['terminated', '终止'], desc: 'companies whose services with Tassure were terminated' },
  { label: 'EOT 延期',              href: '/master-list/eot',           kw: ['eot', 'extension of time', '延期'], desc: 'AR/AGM cycles granted an Extension of Time — original vs revised due dates; edits here are the same edits as on AR Reminder' },
  { label: 'Change Co Name',        href: '/master-list/name-change',   kw: ['name change', '改名', 'change co name'], desc: 'companies that changed their registered name' },
  { label: 'Trademark Master Records 商标记录', href: '/master-list/trademark/master-records', kw: ['trademark', '商标'], desc: 'filed trademarks with their IPOS application number, dates and expiry' },
  { label: 'Trademark In Progress 商标申请中', href: '/master-list/trademark/in-progress', kw: ['trademark in progress', '商标申请中'], desc: 'trademark filings not yet given an application number, tracked by logo/classes' },
  { label: 'Nominee Directors 提名董事', href: '/nominee-directors',    kw: ['nominee', 'nd', '提名董事', '挂名董事'], desc: 'each nominee director and their active appointments, plus a TeamWork review panel' },
  { label: 'Address Service 地址服务', href: '/address-service',        kw: ['address', '地址'], desc: "companies using Tassure's registered-address service" },
  { label: 'AR Reminder 年报提醒',  href: '/billing?tab=ar',            kw: ['ar reminder', 'ar', '年报', 'annual return', '提醒'], desc: 'annual return / AGM cycles by FYE batch: prepared, sent, received, AGM held, filed, PICs, remarks' },
  { label: 'Late Filing 迟报监控',  href: '/late-filing',               kw: ['late filing', '迟报', 'late'], desc: 'companies flagged overdue on AR/AGM filing, with PIC and a resolve action' },
  { label: 'Billing Drafts 开单草稿', href: '/billing?tab=billing',     kw: ['billing', '开单', '发票', 'invoice', 'draft', '账单'], desc: 'TAB/TAC renewal invoice drafts per company, pre-filled from last year; Generate creates the invoice in QuickBooks' },
  { label: 'TAO Billing TAO 开单',  href: '/billing/tao',               kw: ['tao billing', 'tao 开单', 'tao开单'], desc: "invoicing in the TAO book (Accounts/Tax services): each company's last TAO invoice, and building a new one from the TAO service list" },
  { label: 'Quotation 报价单',      href: '/billing/quotation',         kw: ['quotation', '报价单'], access: account => !!account.canViewQuotation, desc: 'every QuickBooks Estimate across TAB/TAC/TAO with the invoice trace; New Quotation creates one (see QUOTATION PAGE below)' },
  { label: 'Outstanding (SOA) — All 欠款总览', href: '/billing/soa/all', kw: ['soa', 'statement of account', '对账单', 'outstanding'], desc: 'everyone who owes money across TAB/TAC/TAO with aging, owner and remarks; a Source badge downloads the SOA PDF, the mail icon drafts the client email; on All a multi-book customer gets one combined statement' },
  { label: 'Outstanding (SOA) — TAB', href: '/billing/soa/tab',         kw: ['soa tab'], desc: 'the same, for the TAB book only' },
  { label: 'Outstanding (SOA) — TAC', href: '/billing/soa/tac',         kw: ['soa tac'], desc: 'the same, for the TAC book only' },
  { label: 'Outstanding (SOA) — TAO', href: '/billing/soa/tao',         kw: ['soa tao'], desc: 'the same, for the TAO book only' },
  { label: 'Invoice Originals 发票原版', href: '/billing/soa/originals', kw: ['invoice originals', 'originals', '发票原版', '原版发票', '原版'], desc: 'the open invoices accounting has split (Deferred Revenue lines) and, for each, whether the original invoice PDF is attached in QuickBooks and in use or the system redraws it (read-only; INV-QB-037)' },
  { label: 'Email Drafts 邮件草稿', href: '/client-communications/campaigns', kw: ['email drafts', '邮件草稿', 'client communications', 'campaign', 'outlook helper'], desc: 'review-first workbench that prepares client emails as Outlook drafts through the Outlook Helper; staff send them from Outlook' },
  { label: 'Email Activity 邮件记录', href: '/client-communications/history', kw: ['email activity', '邮件记录', 'delivery history', 'history', 'prepared'], desc: 'record of prepared client emails; view one or reopen its Outlook draft' },
  { label: 'Email Templates 邮件模板', href: '/client-communications/templates', kw: ['email template', '邮件模板', 'templates'], desc: 'the client email templates Email Drafts uses' },
  { label: 'Post Incorporate 新公司文件', href: '/post-incorporate',   kw: ['post incorporate', 'post-incorporate'], desc: "generates a newly incorporated company's document set from its Bizfile extract, cross-checked with TeamWork" },
  { label: 'My Tasks 我的任务',     href: '/my-tasks',                  kw: ['my tasks', '我的任务'], desc: "the user's own tasks (AR, Late Filing, SOA collections, trademarks) and this AI chat" },
  { label: 'Reports 报表',          href: '/reports',                   kw: ['reports', '报表'], access: account => !!account.canViewReports, desc: 'management analytics: client profile and mix, revenue and workload trends, with a weekly AI analysis' },
  { label: 'SG Latest News 新加坡资讯', href: '/sg-news',               kw: ['sg news', 'sg latest news', '新闻'], access: account => !!account.canViewSgNews, desc: 'daily digest of ACRA/IRAS/MOM/ICA/ISCA/CSIS updates and Straits Times/Business Times/Zaobao news, for Tassure staff' },
  { label: 'Turnover AI 流水', href: '/turnover-ai', kw: ['turnover ai', 'turnover', '流水', '项目', '上传单据', '复核队列', '流水汇总'], access: account => !!account.canViewTurnoverAI, desc: "Projects list (searchable by name) — one folder per client/job, renamable. Easiest start: drop a client's receipts/invoices anywhere on this page, name the client in the pop-up (and tick GST if needed — set once), and the files are read straight into that new project; if a project for the same client already exists, the pop-up offers to add the files there instead. More can be dropped inside a project any time (AI reads each file into individual receipts, up to 100 per round, any number of rounds); every receipt counts toward the project's running turnover total the moment it is read — no confirm step. Staff fix any field directly in the table (it saves on its own) and Ignore a duplicate/mistake to exclude it (Restore undoes that); High/Medium/Low confidence is only a hint where to double-check. Files: PDF up to 4.4MB (a bigger PDF must be split first), JPG/PNG/WEBP/HEIC photos of any size (converted and shrunk automatically); a file that couldn't be read is listed above the table with the reason — fix it, drop it again, then Remove the old line. Originals and per-receipt detail are kept 3 days then cleared automatically; the total stays in the folder. A project can be deleted by staff; optional per-project GST breakout" },
  { label: 'Proposal Generator',    href: '/sso/proposal-generator',    kw: ['proposal generator'], desc: 'opens the separate Proposal Generator app in a new tab, signed in automatically' },
  { label: 'Appearance Settings 外观设置', href: '/admin/appearance',  kw: ['appearance settings', '外观设置'], access: isAdmin, desc: 'system appearance settings' },
  { label: 'AI Learning',           href: '/ai-learning',               kw: ['ai learning'], access: isAdmin, desc: "review the assistant's learned-preference candidates before they become memories" },
  { label: 'AI Quality',            href: '/ai-quality',                kw: ['ai quality'], access: isAdmin, desc: "automated spot-check of the assistant's replies (behaviour, not fact-checking)" },
  { label: 'AI Usage AI 用量',       href: '/ai-usage',                  kw: ['ai usage', 'ai 用量', 'token 用量', 'token usage'], access: account => !!account.canViewAiUsage, desc: "every staff member's AI token usage and estimated cost in USD — today, the last 7 days and this month, per person and per feature, automatic calls shown apart, refreshing live; recorded per AI call since the ledger started" },
  { label: 'Activity Insights',     href: '/activity-insights',         kw: ['activity insights'], access: isAdmin, desc: 'staff usage analytics from recorded page visits and actions' },
];

// Mirrors proxy.ts exactly: canAccountOpen() (department pages + flags), and
// a gated entry's own `access` on top as a belt-and-braces repeat of its flag.
export function canOpenPage(page: SystemPage, account: ApprovedAccount | null | undefined): boolean {
  if (!account) return !page.access;
  const url = new URL(page.href, 'https://app.local');
  if (!canAccountOpen(account, url.pathname, url.searchParams)) return false;
  return page.access ? page.access(account) : true;
}

export function pagesFor(account: ApprovedAccount | null | undefined): SystemPage[] {
  return PAGES.filter(p => canOpenPage(p, account));
}

// The most specific keyword wins, so the bare 'ar' can't claim "turnover
// summary" and "soa tab" can't lose to 'soa' just because of list order.
export function matchPage(t: string, account: ApprovedAccount | null | undefined, minKeywordLength = 1): SystemPage | null {
  let best: { page: SystemPage; length: number } | null = null;
  for (const page of pagesFor(account)) {
    for (const k of page.kw) {
      if (k.length >= minKeywordLength && t.includes(k) && (!best || k.length > best.length)) best = { page, length: k.length };
    }
  }
  return best?.page ?? null;
}

export function pageAccessLine(account: ApprovedAccount | null | undefined): string {
  if (!account) return 'Page access: this user could not be identified — only link pages not marked (restricted).';
  const can = pagesFor(account).map(p => p.label);
  const cannot = PAGES.filter(p => !canOpenPage(p, account)).map(p => p.label);
  return `Page access — this account is in ${WORKSPACES[account.workspace].title}: CAN open ${can.join(', ') || 'none'}; CANNOT open ${cannot.join(', ') || 'none'} (blocked for this account — never link or suggest those).`;
}
