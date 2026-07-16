import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { getApprovedAccount, type ApprovedAccount } from '@/lib/approved-accounts';

export async function getRequestAccount(req: NextRequest): Promise<ApprovedAccount | null> {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data } = await auth.auth.getUser();
  return getApprovedAccount(data.user?.email);
}
