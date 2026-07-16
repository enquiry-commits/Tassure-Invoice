import { createAdminClient } from './supabase';
import { replaceAutomationExceptions } from './automation-sync';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

export type QbCompany = 'TAB' | 'TAC';

interface TokenRow {
  realm_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  refresh_expires_at: string;
  company_label: QbCompany;
}

interface GetValidTokenOptions {
  // Used only by the connection-health check. It proves that the stored
  // refresh token still works with the currently deployed OAuth credentials,
  // even when the one-hour access token has not expired yet.
  forceRefresh?: boolean;
}

type OAuthFailure = { code: string; message: string; httpStatus?: number };

function parseOAuthFailure(raw: string, httpStatus?: number): OAuthFailure {
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; error_description?: unknown };
    return {
      code: String(parsed.error ?? `http_${httpStatus ?? 'error'}`),
      message: String(parsed.error_description ?? parsed.error ?? 'QuickBooks OAuth request failed.').slice(0, 500),
      httpStatus,
    };
  } catch {
    return { code: `http_${httpStatus ?? 'error'}`, message: 'QuickBooks OAuth request failed.', httpStatus };
  }
}

export async function recordQuickBooksOAuthFailure(company: QbCompany, failure: OAuthFailure) {
  await replaceAutomationExceptions('quickbooks', `oauth_refresh_${company}`, [{
    key: company,
    name: `${company} QuickBooks connection`,
    details: {
      code: failure.code,
      message: failure.message,
      http_status: failure.httpStatus ?? null,
    },
  }]);
}

export async function clearQuickBooksOAuthFailure(company: QbCompany) {
  await replaceAutomationExceptions('quickbooks', `oauth_refresh_${company}`, []);
}

async function safelyRecordOAuthFailure(company: QbCompany, failure: OAuthFailure) {
  try {
    await recordQuickBooksOAuthFailure(company, failure);
  } catch (error) {
    console.error(`Unable to record QuickBooks ${company} OAuth failure:`, error instanceof Error ? error.message : error);
  }
}

async function safelyClearOAuthFailure(company: QbCompany) {
  try {
    await clearQuickBooksOAuthFailure(company);
  } catch (error) {
    console.error(`Unable to clear QuickBooks ${company} OAuth failure:`, error instanceof Error ? error.message : error);
  }
}

// Get stored tokens for a specific QB company, auto-refresh if expired.
// 'TAB' is the default company (all basic services); 'TAC' is the second
// company used only for Nominee Director invoicing.
export async function getValidToken(
  company: QbCompany = 'TAB',
  options: GetValidTokenOptions = {},
): Promise<TokenRow | null> {
  const supabase = createAdminClient();
  let { data } = await supabase
    .from('quickbooks_tokens')
    .select('*')
    .eq('company_label', company)
    .limit(1)
    .maybeSingle();

  // Backward-compat fallback for the window before the multi-company
  // migration (scripts/add-multi-company-qb-support.sql) has been run: the
  // company_label column may not exist yet, or the one legacy token row may
  // not be labelled yet. Only ever fall back for TAB — never hand TAB's
  // token to a TAC caller just because nothing is labelled.
  if (!data && company === 'TAB') {
    const legacy = await supabase.from('quickbooks_tokens').select('*').limit(1).maybeSingle();
    if (legacy.data && !(legacy.data as { company_label?: string }).company_label) data = legacy.data;
  }

  if (!data) return null;

  const now = new Date();
  const tokenExpired = new Date(data.expires_at) < now;
  const refreshExpired = new Date(data.refresh_expires_at) < now;

  if (refreshExpired) {
    await safelyRecordOAuthFailure(company, {
      code: 'refresh_token_expired',
      message: 'The QuickBooks refresh token expired. Reconnect this company.',
    });
    return null;
  }

  if (!tokenExpired && !options.forceRefresh) return data as TokenRow;

  // Intuit rotates refresh tokens. Two simultaneous serverless requests must
  // not refresh the same old token and then overwrite each other's new token.
  const lockExpiry = new Date(now.getTime() + 60_000).toISOString();
  await supabase.from('quickbooks_token_refresh_locks')
    .delete().eq('company_label', company).lt('expires_at', now.toISOString());
  const { error: lockError } = await supabase.from('quickbooks_token_refresh_locks').insert({
    company_label: company,
    locked_at: now.toISOString(),
    expires_at: lockExpiry,
  });

  if (lockError) {
    // Another invocation owns the refresh. Wait briefly for its new token
    // instead of sending the same rotating refresh token twice.
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const current = await supabase.from('quickbooks_tokens').select('*')
        .eq('company_label', company).limit(1).maybeSingle();
      if (current.data && new Date(current.data.expires_at) > new Date()) {
        if (!options.forceRefresh || current.data.access_token !== data.access_token) {
          return current.data as TokenRow;
        }
      }
    }
    return null;
  }

  try {
    // Re-read after acquiring the distributed lease. A previous owner may
    // have completed between our first read and lock acquisition.
    const latest = await supabase.from('quickbooks_tokens').select('*')
      .eq('company_label', company).limit(1).maybeSingle();
    if (
      latest.data
      && new Date(latest.data.expires_at) > new Date()
      && (!options.forceRefresh || latest.data.access_token !== data.access_token)
    ) {
      return latest.data as TokenRow;
    }
    const refreshSource = (latest.data ?? data) as TokenRow;

    // Refresh the access token
    const clientId     = process.env.QB_CLIENT_ID;
    const clientSecret = process.env.QB_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      await safelyRecordOAuthFailure(company, {
        code: 'missing_client_credentials',
        message: 'QuickBooks Production Client ID or Client Secret is not configured.',
      });
      return null;
    }
    const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    let res: Response;
    try {
      res = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
        method: 'POST',
        headers: {
          Authorization:  `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept:         'application/json',
        },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: refreshSource.refresh_token,
        }),
      });
    } catch {
      await safelyRecordOAuthFailure(company, {
        code: 'oauth_network_error',
        message: 'QuickBooks OAuth could not be reached. The existing connection was preserved.',
      });
      return null;
    }

    const responseText = await res.text();
    if (!res.ok) {
      await safelyRecordOAuthFailure(company, parseOAuthFailure(responseText, res.status));
      return null;
    }

    const tokens = JSON.parse(responseText) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      x_refresh_token_expires_in?: number;
    };
    if (!tokens.access_token || !tokens.refresh_token || !tokens.expires_in || !tokens.x_refresh_token_expires_in) {
      await safelyRecordOAuthFailure(company, {
        code: 'invalid_token_response',
        message: 'QuickBooks returned an incomplete token response. The existing connection was preserved.',
      });
      return null;
    }
    const refreshedAt = new Date();
    const updated = {
      access_token:       tokens.access_token,
      refresh_token:      tokens.refresh_token,
      expires_at:         new Date(refreshedAt.getTime() + tokens.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(refreshedAt.getTime() + tokens.x_refresh_token_expires_in * 1000).toISOString(),
      updated_at:         refreshedAt.toISOString(),
    };

    const saved = await supabase
      .from('quickbooks_tokens')
      .update({ ...updated })
      .eq('realm_id', refreshSource.realm_id)
      .eq('refresh_token', refreshSource.refresh_token)
      .select('*')
      .maybeSingle();
    if (saved.error) {
      await safelyRecordOAuthFailure(company, {
        code: 'token_save_failed',
        message: 'The refreshed QuickBooks connection could not be saved.',
      });
      return null;
    }
    if (saved.data) {
      await safelyClearOAuthFailure(company);
      return saved.data as TokenRow;
    }

    const current = await supabase.from('quickbooks_tokens').select('*')
      .eq('company_label', company).limit(1).maybeSingle();
    if (current.data && new Date(current.data.expires_at) > new Date()) await safelyClearOAuthFailure(company);
    return current.data as TokenRow | null;
  } finally {
    await supabase.from('quickbooks_token_refresh_locks').delete().eq('company_label', company);
  }
}

// Run a QB query against a specific company and return rows.
export async function qbQuery(query: string, company: QbCompany = 'TAB'): Promise<{ rows: Record<string, unknown>[]; realmId: string } | null> {
  const token = await getValidToken(company);
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
