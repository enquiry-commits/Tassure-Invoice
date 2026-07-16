'use server';

import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

export async function signInWithGoogle() {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: values => values.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    },
  );
  const origin = headerStore.get('origin') ?? `https://${headerStore.get('host')}`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${origin}/auth/callback`,
      queryParams: { access_type: 'offline', prompt: 'select_account' },
    },
  });
  if (error || !data.url) redirect('/login?error=oauth');
  redirect(data.url);
}
