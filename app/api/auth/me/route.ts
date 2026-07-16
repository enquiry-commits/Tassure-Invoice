import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getApprovedAccount } from '@/lib/approved-accounts';

export async function GET() {
  const cookieStore = await cookies();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: { getAll: () => cookieStore.getAll(), setAll: () => undefined },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return NextResponse.json({ user: null }, { status: 401 });
  const account = getApprovedAccount(data.user.email);
  if (!account) return NextResponse.json({ user: null }, { status: 403 });

  return NextResponse.json({
    user: {
      email: account.email,
      name: account.name,
    },
  });
}
