import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';

const VALID_COMPANIES = new Set<QbCompany>(['TAB', 'TAC', 'TAO']);

export async function GET(req: NextRequest) {
  // Same explicit 3-way validation as auth/route.ts — an unrecognized
  // `?company=` used to silently resolve to TAB here (a real, previously-
  // shipped bug: `?company=TAO` today would have shown TAB's connection
  // status as if it were TAO's, with no error).
  const companyParam = req.nextUrl.searchParams.get('company');
  const company: QbCompany = companyParam === null ? 'TAB' : (companyParam as QbCompany);
  if (!VALID_COMPANIES.has(company)) {
    return NextResponse.json({ error: 'invalid company' }, { status: 400 });
  }
  const verify = req.nextUrl.searchParams.get('verify') === 'true';

  // A normal status read is side-effect free. Verification is explicitly
  // requested only after the UI sees a stored OAuth failure. It exercises the
  // existing refresh token with the currently deployed credentials, allowing
  // a corrected Client ID/Secret to heal the connection without user consent.
  if (verify) await getValidToken(company, { forceRefresh: true });

  const supabase = createAdminClient();
  const exceptionType = `oauth_refresh_${company}`;
  const [{ data: initialData }, { data: oauthException }] = await Promise.all([
    supabase
    .from('quickbooks_tokens')
    .select('realm_id, expires_at, refresh_expires_at, updated_at, company_label')
    .eq('company_label', company)
    .limit(1)
    .maybeSingle(),
    supabase.from('automation_exceptions')
      .select('details, last_seen_at')
      .eq('source', 'quickbooks')
      .eq('exception_type', exceptionType)
      .eq('entity_key', company)
      .eq('status', 'open')
      .limit(1)
      .maybeSingle(),
  ]);
  let data = initialData;

  // Same pre-migration fallback as lib/quickbooks.ts getValidToken(). Must use
  // select('*') here, NOT an explicit column list naming company_label — if
  // that column doesn't exist yet, naming it in the select fails the query
  // too (not just the .eq() filter), which would defeat this exact fallback.
  if (!data && company === 'TAB') {
    const legacy = await supabase.from('quickbooks_tokens').select('*').limit(1).maybeSingle();
    if (legacy.data && !(legacy.data as { company_label?: string }).company_label) data = legacy.data as typeof data;
  }

  if (!data) return NextResponse.json({ connected: false, company });

  const now = new Date();
  const tokenExpired   = data.expires_at   ? new Date(data.expires_at)   < now : true;
  const refreshExpired = data.refresh_expires_at ? new Date(data.refresh_expires_at) < now : true;
  // Days until the REFRESH token dies — after that, invoice creation 401s
  // until someone re-authorises. Surface it so the UI can warn ahead of time.
  const refreshExpiresInDays = data.refresh_expires_at
    ? Math.ceil((new Date(data.refresh_expires_at).getTime() - now.getTime()) / 86400000)
    : null;

  return NextResponse.json({
    connected:      true,
    company,
    realmId:        data.realm_id,
    tokenExpired,
    refreshExpired,
    refreshExpiresAt: data.refresh_expires_at ?? null,
    refreshExpiresInDays,
    lastConnected:  data.updated_at,
    authError: oauthException ? {
      code: String((oauthException.details as Record<string, unknown> | null)?.code ?? 'oauth_error'),
      message: String((oauthException.details as Record<string, unknown> | null)?.message ?? 'QuickBooks OAuth needs attention.'),
      lastSeenAt: oauthException.last_seen_at,
    } : null,
  });
}
