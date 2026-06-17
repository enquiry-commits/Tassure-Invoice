import { NextResponse } from 'next/server';

export async function GET() {
  const clientId   = process.env.QB_CLIENT_ID ?? '';
  const redirectUri = process.env.QB_REDIRECT_URI ?? '';

  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         'com.intuit.quickbooks.accounting',
    state:         'test',
  });

  const authUrl = `https://appcenter.intuit.com/connect/oauth2?${params}`;

  return NextResponse.json({
    QB_CLIENT_ID:      clientId ? `${clientId.slice(0, 20)}... (length: ${clientId.length})` : 'MISSING',
    QB_CLIENT_SECRET:  process.env.QB_CLIENT_SECRET  ? `${process.env.QB_CLIENT_SECRET.slice(0, 6)}... (length: ${process.env.QB_CLIENT_SECRET.length})` : 'MISSING',
    QB_REDIRECT_URI:   redirectUri || 'MISSING',
    QB_ENVIRONMENT:    process.env.QB_ENVIRONMENT    ?? 'MISSING',
    oauth_url_preview: authUrl.slice(0, 200),
  });
}
