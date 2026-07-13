import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code    = searchParams.get('code');
  const realmId = searchParams.get('realmId');
  const state   = searchParams.get('state') ?? '';
  const error   = searchParams.get('error');

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

  // One row per company_label — replace whatever was previously connected as
  // this company (by label, not by realm, so re-authorising the same company
  // under a different realm still replaces the old row cleanly).
  await supabase.from('quickbooks_tokens').delete().eq('company_label', company);

  const { error: saveErr } = await supabase.from('quickbooks_tokens').insert({
    realm_id:           realmId,
    company_label:      company,
    access_token:       tokens.access_token,
    refresh_token:      tokens.refresh_token,
    expires_at:         new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000).toISOString(),
    updated_at:         now.toISOString(),
  });

  if (saveErr) {
    console.error('QB token save error:', saveErr.message);
    return NextResponse.redirect(new URL(`/?qb_error=token_save_failed`, req.url));
  }

  return NextResponse.redirect(new URL(`/?qb_connected=${company}`, req.url));
}
