import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { getApprovedAccount, type ApprovedAccount } from '@/lib/approved-accounts';

export async function getRequestAccount(req: NextRequest): Promise<ApprovedAccount | null> {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  // getSession() reads the JWT straight off the cookie (no network round
  // trip) instead of getUser()'s live re-check against Supabase's Auth
  // server — safe here because proxy.ts's middleware already ran a real
  // getUser() check on this exact request before it reached this route
  // (its matcher covers every path except static assets), so a second,
  // slower re-verification here was pure duplicate latency on every save.
  const { data } = await auth.auth.getSession();
  return getApprovedAccount(data.session?.user.email);
}
