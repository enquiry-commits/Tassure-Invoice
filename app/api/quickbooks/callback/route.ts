import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import crypto from 'crypto';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code    = searchParams.get('code');
  const realmId = searchParams.get('realmId');
  const state   = searchParams.get('state') ?? '';
  const error   = searchParams.get('error');
  const expectedState = req.cookies.get('qb_oauth_state')?.value ?? '';

  const validState = !!state && !!expectedState
    && Buffer.byteLength(state) === Buffer.byteLength(expectedState)
    && crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState));
  if (!validState) {
    const response = NextResponse.redirect(new URL('/?qb_error=invalid_oauth_state', req.url));
    response.cookies.delete('qb_oauth_state');
    return response;
  }

  // Which company this connection is for — encoded as "TAB:<random>" /
  // "TAC:<random>" when the auth flow was started (see auth/route.ts).
  const company = state.startsWith('TAC:') ? 'TAC' : 'TAB';

  if (error || !code || !realmId) {
    return NextResponse.redirect(
      new URL(`/?qb_error=${error ?? 'missing_params'}`, req.url)
    );
  }

  // Exchange code for tokens
  const clientId     = process.env.QB_CLIENT_ID!;
  const clientSecret = process.env.QB_CLIENT_SECRET!;
  const redirectUri  = process.env.QB_REDIRECT_URI!;

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type':  'application/x-www-form-urlencoded',
      Accept:          'application/json',
    },
    body: new URLSearchParams({
      grant_type:   'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL(`/?qb_error=token_exchange_failed`, req.url));
  }

  const tokens = await tokenRes.json();
  const now = new Date();

  const supabase = createAdminClient();

  // One atomic upsert per company label; never delete the working connection
  // before the replacement token has passed validation and is ready to save.
  const { error: saveErr } = await supabase.from('quickbooks_tokens').upsert({
    realm_id:           realmId,
    company_label:      company,
    access_token:       tokens.access_token,
    refresh_token:      tokens.refresh_token,
    expires_at:         new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000).toISOString(),
    updated_at:         now.toISOString(),
  }, { onConflict: 'company_label' });

  if (saveErr) {
    console.error('QB token save error:', saveErr.message);
    return NextResponse.redirect(new URL(`/?qb_error=token_save_failed`, req.url));
  }

  const response = NextResponse.redirect(new URL(`/?qb_connected=${company}`, req.url));
  response.cookies.delete('qb_oauth_state');
  return response;
}
