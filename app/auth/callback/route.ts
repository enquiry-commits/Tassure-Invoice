import { createServerClient } from '@supabase/ssr';
import { NextRequest, NextResponse } from 'next/server';
import { getApprovedAccount } from '@/lib/approved-accounts';

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const destination = new URL('/', req.url);
  let response = NextResponse.redirect(destination);

  if (!code) return NextResponse.redirect(new URL('/login?error=oauth', req.url));

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: values => {
          values.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.redirect(destination);
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return NextResponse.redirect(new URL('/login?error=oauth', req.url));
  const { data } = await supabase.auth.getUser();
  if (!getApprovedAccount(data.user?.email)) {
    await supabase.auth.signOut();
    const denied = NextResponse.redirect(new URL('/login?error=domain', req.url));
    response.cookies.getAll().forEach(cookie => denied.cookies.set(cookie));
    return denied;
  }
  return response;
}
