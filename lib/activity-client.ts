// Fire-and-forget client-side call to POST /api/activity/log — imported by
// components/AppShell.tsx (page_view on every route change) and a handful
// of action pages (a named key action after something meaningful actually
// succeeds — see each call site's own comment for why that particular
// action was picked). `keepalive: true` lets the request survive a
// same-tick navigation (e.g. logging an action right before a redirect).
//
// Deliberately never awaited by its callers, and swallows its own
// failures — see app/api/activity/log/route.ts's comment for why a
// tracking call must never affect the real action it's attached to.
export function logActivity(eventType: string, detail?: Record<string, unknown>) {
  try {
    void fetch('/api/activity/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventType, pathname: window.location.pathname, detail: detail ?? null }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // window/fetch unavailable (shouldn't happen in a browser context, but
    // this must never throw into a caller's own success path)
  }
}
