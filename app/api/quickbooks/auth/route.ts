import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

// Kicks off OAuth for a specific QB company — TAB (default, basic services) or
// TAC (Nominee Director only). The target company rides in `state`, which
// Intuit echoes back unchanged to the callback.
export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company') === 'TAC' ? 'TAC' : 'TAB';
  const clientId    = process.env.QB_CLIENT_ID!;
  const redirectUri = process.env.QB_REDIRECT_URI!;
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
