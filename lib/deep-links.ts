// Shared URL-format contract for the chat assistant's "smart" deep links
// into the real pages — added 2026-09-09, Vincent: "当用户点击去开单的时
// 候你应该是带用户去到开单的接口，并且协助好找到对应的公司和点击好打开
// 了那个发票编辑的弹窗，不只是带到 Billing draft 的接口页面就停了". No
// `server-only` guard: used from BOTH the server (app/api/assistant/
// route.ts, building a link to hand back in a tool result when a company
// couldn't be confidently matched) and the client (app/my-tasks/page.tsx's
// preview cards, linking off an already-found preview) — one shared format
// instead of two copies that could quietly drift apart.
//
// `openCompany` is always a company NAME, never a numeric id — the ids
// used inside app/billing/page.tsx (AR-Reminder-row-scoped) and this
// system's various `companies.id` values are NOT the same thing and are
// not stable across a fresh fetch; only the name survives the trip. The
// target page fuzzy-matches it via the same lib/company-name.ts matcher
// this whole codebase already uses for exactly this problem.
export function billingDeepLink(companyName: string, fyeMonth: string | null, fyeCycle: string): string {
  const params = new URLSearchParams({ tab: 'billing', openCompany: companyName });
  if (fyeMonth) params.set('month', fyeMonth);
  const year = fyeCycle.split('.')[2];
  if (year) params.set('year', year);
  return `/billing?${params.toString()}`;
}

export function lateFilingDeepLink(companyName: string): string {
  return `/late-filing?${new URLSearchParams({ openCompany: companyName }).toString()}`;
}
