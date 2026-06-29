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

  return NextResponse.json({
    connected:      true,
    realmId:        data.realm_id,
    tokenExpired,
    refreshExpired,
    lastConnected:  data.updated_at,
  });
}
