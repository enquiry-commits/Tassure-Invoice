import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getApprovedAccount, type ApprovedAccount } from '@/lib/approved-accounts';

// The one place a Route Handler should derive "who is making this request" —
// always from the Supabase session cookie server-side, never from a client-
// supplied field, so an audit log entry can't be spoofed by whoever's
// calling the API. Mirrors the exact lookup proxy.ts already does to decide
// whether a request is authenticated at all.
export async function getCurrentUser(): Promise<ApprovedAccount | null> {
  const cookieStore = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => undefined },
  });
  const { data } = await supabase.auth.getUser();
  return getApprovedAccount(data.user?.email);
}
