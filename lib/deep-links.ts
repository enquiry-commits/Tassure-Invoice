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

// SOA (Statement of Account) is its own real feature — a PDF of a
// company's unpaid invoices downloaded from /billing/soa/{tab,tac,tao,all},
// with a "Draft Email" button right there to send it to the client — NOT
// the same thing as Billing Drafts (new invoice generation). Confirmed
// real bug in the assistant, 2026-09-09: asked "我要开SOA", it offered to
// preview a new Billing Draft instead.
//
// Corrected 2026-09-18 — this used to say `qbCompany` "must be a real 'TAB'
// | 'TAC' | 'TAO' (never 'ALL')", which was accurate THAT day (the combined
// "All" download didn't exist yet as a real generatable PDF, only as a
// page) but went stale once app/api/billing/soa/pdf's own `company=ALL`
// mode shipped 2026-09-17 — a real, working ONE-PDF-across-TAB/TAC/TAO
// Statement, same /billing/soa/all page this already links to. Confirmed
// real bug from that staleness, same day: a client owed on both TAB and
// TAO, the user asked the assistant for "All" the combined one, and it told
// them no combined PDF exists and to download the two separately — because
// checkOutstandingBalance() only ever built per-book links, this file's own
// stale comment having told it 'ALL' was invalid. `/billing/soa/all` reads
// the same `openCompany` deep-link param as every other SOA page (see
// app/billing/soa/_components.tsx's shared SoaBillingView), so this needed
// no new page logic — just widening this function's own type.
export function soaDeepLink(qbCompany: 'TAB' | 'TAC' | 'TAO' | 'ALL', companyName: string): string {
  return `/billing/soa/${qbCompany.toLowerCase()}?${new URLSearchParams({ openCompany: companyName }).toString()}`;
}

// Added 2026-09-16 for search_documents (lib/document-search-lookup.ts) — the
// one deep link in this file keyed by companies.id rather than a fuzzy-
// matched name. A nas_documents row already carries a resolved company_id
// (resolved once at NAS-index time, not at query time — see
// scripts/add-nas-document-index.sql), so there is no name to fuzzy-match
// here and app/companies/[id]/page.tsx already takes the real numeric id
// directly. A found document itself lives on the internal NAS, which the
// cloud can never serve — this links to the document's COMPANY page instead,
// where staff already know to go find the actual file on a machine that's on
// the office network.
export function companyDeepLink(companyId: number): string {
  return `/companies/${companyId}`;
}
