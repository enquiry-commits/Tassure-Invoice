import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAccount, isWithinRestriction } from '@/lib/approved-accounts';

// Intuit cannot carry a Tassure Google session. The webhook route is public at
// the session layer and authenticates the exact raw request body with Intuit's
// HMAC signature before accepting any event.
const PUBLIC_PATHS = new Set(['/login', '/auth/callback', '/api/quickbooks/webhook']);
const CRON_PATHS = new Set([
  '/api/teamwork/sync-nd',
  '/api/teamwork/sync',
  '/api/teamwork/sync-secretary',
  '/api/ar-reminder/generate',
  '/api/quickbooks/sync',
  '/api/ar-reminder/sync-workflow',
  '/api/late-filing/sync',
]);

export async function proxy(req: NextRequest) {
  const path = req.nextUrl.pathname;
  // Staff installing the Helper on a new/different computer have no Tassure
  // session yet on that machine — the installer itself must be reachable
  // before login is even possible, same reasoning as the QuickBooks webhook.
  if (path.startsWith('/downloads/')) return NextResponse.next();
  const isPublic = PUBLIC_PATHS.has(path);
  const isApi = path.startsWith('/api/');
  const cronSecret = process.env.CRON_SECRET;
  if (
    cronSecret
    && req.method === 'GET'
    && CRON_PATHS.has(path)
    && req.headers.get('authorization') === `Bearer ${cronSecret}`
  ) return NextResponse.next();

  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: values => {
        values.forEach(({ name, value }) => req.cookies.set(name, value));
        response = NextResponse.next({ request: req });
        values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const account = getApprovedAccount(data.user?.email);
  const authenticated = !!account;

  if (isPublic) {
    if (path === '/login' && authenticated) return NextResponse.redirect(new URL('/', req.url));
    return response;
  }
  if (!authenticated) {
    if (isApi) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    return NextResponse.redirect(new URL('/login', req.url));
  }
  // Some accounts only see one page (Vincent, 2026-08-17 — an Accounting-team
  // group confined to AR Reminder). Page navigation only, same as the rest of
  // this file: API routes stay reachable so the allowed page's own fetches
  // (and shared ones like /api/auth/me) keep working.
  if (!isApi && account.restrictedTo && !isWithinRestriction(account.restrictedTo, path, req.nextUrl.searchParams)) {
    return NextResponse.redirect(new URL(account.restrictedTo, req.url));
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|logo.png|nav/).*)'],
};
