import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import type { QbCompany } from '@/lib/quickbooks';

const VALID_COMPANIES = new Set<QbCompany>(['TAB', 'TAC', 'TAO']);

// Kicks off OAuth for a specific QB company — TAB (default, basic services),
// TAC (Nominee Director), or TAO (Accounts). The target company rides in
// `state`, which Intuit echoes back unchanged to the callback.
//
// No `?company=` at all defaults to TAB (preserves every existing link/
// bookmark that predates TAC/TAO ever existing). An explicit but
// unrecognized value is rejected outright — silently falling back to TAB
// for a typo'd or stale company value would connect the wrong QuickBooks
// company without anyone noticing (this collapsed 'anything not TAC' into
// TAB before TAO existed, which is exactly the class of bug that would
// have silently misrouted a real TAO connection attempt).
export async function GET(req: NextRequest) {
  const companyParam = req.nextUrl.searchParams.get('company');
  const company: QbCompany = companyParam === null ? 'TAB' : (companyParam as QbCompany);
  if (!VALID_COMPANIES.has(company)) {
    return NextResponse.redirect(new URL('/?qb_error=invalid_company', req.url));
  }
  const clientId    = process.env.QB_CLIENT_ID;
  const redirectUri = process.env.QB_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.redirect(new URL('/?qb_error=oauth_not_configured', req.url));
  }
  try {
    const callback = new URL(redirectUri);
    if (process.env.NODE_ENV === 'production' && callback.protocol !== 'https:') {
      return NextResponse.redirect(new URL('/?qb_error=invalid_redirect_uri', req.url));
    }
  } catch {
    return NextResponse.redirect(new URL('/?qb_error=invalid_redirect_uri', req.url));
  }
  const state = `${company}:${crypto.randomBytes(16).toString('hex')}`;

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'com.intuit.quickbooks.accounting',
    state,
  });

  const authUrl = `https://appcenter.intuit.com/connect/oauth2?${params}`;
  const response = NextResponse.redirect(authUrl);
  response.cookies.set('qb_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 10 * 60,
    path: '/api/quickbooks/callback',
  });
  return response;
}
