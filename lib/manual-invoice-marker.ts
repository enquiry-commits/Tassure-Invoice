// Manual "already invoiced outside the system" marker (2026-09-03, Vincent
// re: WOLVEZ CAPITAL — Chelsea invoiced two FYE cycles ahead of a client's
// request, one through this system (generated_invoices has it) and one
// typed straight into QuickBooks to avoid confusing the two — so
// billedCyclesMap's own QB-description parsing (app/api/billing/renewals/
// route.ts) never picked it up, and this cycle kept showing "not invoiced"
// every time the page loaded. A plain Remarks note alone doesn't stop that
// — nothing reads remarks for this check — so this is a real, parseable
// marker in the SAME Remarks field AR Reminder already lets staff free-type
// into (REMARKS_OPTIONS' presets don't preclude custom text), not a new
// field/button. Format: "MANUALLY INVOICED: TAB #02611029" (or TAC).
//
// Shared by app/api/ar-reminder/route.ts (server-side, the AR Reminder tab's
// own Invoice column) and app/billing/page.tsx (client-side, Billing
// Drafts' TAB/TAC Invoice columns) — extracted here 2026-09-04 after the
// AR Reminder tab's Invoice column turned out to have its own,
// marker-unaware `tab_invoice_no`/`tac_invoice_no` computation that never
// saw this marker at all (only app/billing/page.tsx's separate Billing
// Drafts tab did) — one shared definition so the two can't drift apart on
// what counts as a valid marker again.
const MANUAL_INVOICE_MARKER_RE = /MANUALLY INVOICED:\s*(TAB|TAC)\s*#?\s*(\S+)/gi;

export function manualInvoiceOverrides(remarks: string | null | undefined): { company: 'TAB' | 'TAC'; invoiceNo: string }[] {
  if (!remarks) return [];
  const out: { company: 'TAB' | 'TAC'; invoiceNo: string }[] = [];
  const re = new RegExp(MANUAL_INVOICE_MARKER_RE);
  let m: RegExpExecArray | null;
  while ((m = re.exec(remarks))) out.push({ company: m[1].toUpperCase() as 'TAB' | 'TAC', invoiceNo: m[2] });
  return out;
}
