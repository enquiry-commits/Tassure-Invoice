// Next.js App Router convention — this file automatically wraps
// page.tsx's server-rendered fetch in a Suspense boundary. Added
// 2026-09-02: without this, the browser showed nothing at all (the
// previous page just sat there) for however long getCompany360's ~11
// Supabase queries took — this page is the only server-rendered one in
// the app (every other page is 'use client' + useEffect, which shows its
// own "Loading…" state immediately for free), so it was the one place
// with no visual feedback on click at all. Matches the exact "Loading…"
// style every other page in this app already uses.
export default function Loading() {
  return (
    <div>
      <div className="mb-4 text-sm text-slate-500">Dashboard › Companies</div>
      <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Loading…</div>
    </div>
  );
}
