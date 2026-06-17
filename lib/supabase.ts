import { createClient } from '@supabase/supabase-js';

const supabaseUrl  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser / Server Component client (anon key)
export const supabase = createClient(supabaseUrl, supabaseAnon);

// Server-only admin client (secret key) — only import in API routes / Server Actions
export function createAdminClient() {
  const secretKey = process.env.SUPABASE_SECRET_KEY!;
  return createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false },
  });
}
