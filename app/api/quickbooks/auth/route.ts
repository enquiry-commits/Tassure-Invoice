import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function GET() {
  const clientId    = process.env.QB_CLIENT_ID!;
  const redirectUri = process.env.QB_REDIRECT_URI!;
  const state       = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'com.intuit.quickbooks.accounting',
    state,
  });

  const authUrl = `https://appcenter.intuit.com/connect/oauth2?${params}`;
  return NextResponse.redirect(authUrl);
}
