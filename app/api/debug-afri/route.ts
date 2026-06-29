import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

export async function GET() {
  const supabase = createAdminClient();

  // Check existing tokens
  const { data: existing, error: readErr } = await supabase
    .from('quickbooks_tokens')
    .select('realm_id, expires_at, refresh_expires_at, updated_at');

  // Test insert with a dummy record
  const testRealm = 'debug_test_realm_' + Date.now();
  const { error: insertErr } = await supabase.from('quickbooks_tokens').insert({
    realm_id:           testRealm,
    access_token:       'test_access',
    refresh_token:      'test_refresh',
    expires_at:         new Date(Date.now() + 3600000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 86400000 * 100).toISOString(),
    updated_at:         new Date().toISOString(),
  });

  // Clean up test record
  if (!insertErr) {
    await supabase.from('quickbooks_tokens').delete().eq('realm_id', testRealm);
  }

  return NextResponse.json({
    tokens_in_db: existing ?? [],
    read_error: readErr?.message ?? null,
    insert_test: insertErr ? { success: false, error: insertErr.message, code: insertErr.code } : { success: true },
    env_check: {
      has_secret_key: !!process.env.SUPABASE_SECRET_KEY,
      secret_key_prefix: process.env.SUPABASE_SECRET_KEY?.slice(0, 20) ?? 'missing',
      has_url: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    },
  });
}
