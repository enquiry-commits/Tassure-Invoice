import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { makeAutoPaginatingFetch } from './supabase-auto-page';

// One shared instance: completes any plain read that PostgREST silently
// truncated at its 1,000-row cap (see lib/supabase-auto-page.ts and
// docs/INVARIANTS.md INV-DATA-066). Applied to createAdminClient() only — the
// service-role client every server-side table read goes through. The anon
// client below is left alone (it serves a single small, filtered client-side
// read), as are the auth-only createServerClient() calls elsewhere.
const autoPaginatingFetch = makeAutoPaginatingFetch();

// Lazy singleton — createClient is NOT called at module load time.
// Vercel build phase has no env vars, calling createClient() top-level crashes the build.
let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _client;
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    return getClient()[prop as keyof SupabaseClient];
  },
});

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false }, global: { fetch: autoPaginatingFetch } }
  );
}
