import { createAdminClient } from './supabase';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

interface TokenRow {
  realm_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
}

// Get stored tokens, auto-refresh if expired
export async function getValidToken(): Promise<TokenRow | null> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('quickbooks_tokens')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const now = new Date();
  const tokenExpired = new Date(data.expires_at) < now;
  const refreshExpired = new Date(data.refresh_expires_at) < now;

  if (refreshExpired) return null; // must re-auth

  if (!tokenExpired) return data as TokenRow;

  // Refresh the access token
  const clientId     = process.env.QB_CLIENT_ID!;
  const clientSecret = process.env.QB_CLIENT_SECRET!;
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      Authorization:  `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept:         'application/json',
    },
    body: new URLSearchParams({
      grant_type:    'refresh_token',
      refresh_token: data.refresh_token,
    }),
  });

  if (!res.ok) return null;

  const tokens = await res.json();
  const updated = {
    access_token:       tokens.access_token,
    refresh_token:      tokens.refresh_token,
    expires_at:         new Date(now.getTime() + tokens.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(now.getTime() + tokens.x_refresh_token_expires_in * 1000).toISOString(),
    updated_at:         now.toISOString(),
  };

  await supabase
    .from('quickbooks_tokens')
    .update({ ...updated })
    .eq('realm_id', data.realm_id);

  return { ...data, ...updated } as TokenRow;
}

// Run a QB query and return rows
export async function qbQuery(query: string): Promise<{ rows: Record<string, unknown>[]; realmId: string } | null> {
  const token = await getValidToken();
  if (!token) return null;

  const url = `${QB_BASE}/v3/company/${token.realm_id}/query?query=${encodeURIComponent(query)}&minorversion=65`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept:        'application/json',
    },
  });

  if (!res.ok) {
    console.error('QB API error:', res.status, await res.text());
    return null;
  }

  const json = await res.json();
  const entityName = Object.keys(json.QueryResponse ?? {})[0];
  const rows = json.QueryResponse?.[entityName] ?? [];

  return { rows, realmId: token.realm_id };
}
