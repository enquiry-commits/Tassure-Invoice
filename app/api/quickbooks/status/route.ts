import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function GET() {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from('quickbooks_tokens')
    .select('realm_id, expires_at, refresh_expires_at, updated_at')
    .limit(1)
    .maybeSingle();

  if (!data) return NextResponse.json({ connected: false });

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
    realmId:        data.realm_id,
    tokenExpired,
    refreshExpired,
    refreshExpiresAt: data.refresh_expires_at ?? null,
    refreshExpiresInDays,
    lastConnected:  data.updated_at,
  });
}
