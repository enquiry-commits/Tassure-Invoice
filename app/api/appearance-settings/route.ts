import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getApprovedAccount } from '@/lib/approved-accounts';
import { createAdminClient } from '@/lib/supabase';
import { THEME_TOKENS, THEME_TOKEN_KEYS, FONT_OPTIONS } from '@/lib/theme-tokens';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FONT_KEYS = new Set(FONT_OPTIONS.map(f => f.key));

// proxy.ts already requires an authenticated session for every non-public
// path, so GET needs no extra check here — any logged-in account can read
// the live theme (every page applies it). Merges DB overrides over the
// lib/theme-tokens.ts defaults; an empty/missing row just means "default".
export async function GET() {
  const supabase = createAdminClient();
  const { data, error } = await supabase.from('app_theme_tokens').select('key, value');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const overrides = new Map((data ?? []).map(row => [row.key, row.value as string]));
  const tokens: Record<string, string> = {};
  for (const def of THEME_TOKENS) tokens[def.key] = overrides.get(def.key) ?? def.default;
  return NextResponse.json({ tokens });
}

// Editing is restricted to the one approved account with admin:true (see
// lib/approved-accounts.ts) — re-derived from the session cookie here,
// never trusted from the client.
export async function PATCH(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.admin) return NextResponse.json({ error: 'Not authorized to edit appearance settings' }, { status: 403 });

  const body = await req.json();
  const updates = body?.tokens as Record<string, string> | undefined;
  if (!updates || typeof updates !== 'object') {
    return NextResponse.json({ error: 'tokens object required' }, { status: 400 });
  }

  const tokenByKey = new Map(THEME_TOKENS.map(t => [t.key, t]));
  const rows: { key: string; value: string; updated_by: string }[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (!THEME_TOKEN_KEYS.has(key)) {
      return NextResponse.json({ error: `Unknown token: ${key}` }, { status: 400 });
    }
    const def = tokenByKey.get(key)!;
    if (typeof value !== 'string') {
      return NextResponse.json({ error: `${key}: value must be a string` }, { status: 400 });
    }
    if (def.type === 'color' && !HEX_RE.test(value)) {
      return NextResponse.json({ error: `${key}: must be a 6-digit hex color` }, { status: 400 });
    }
    if (def.type === 'font' && !FONT_KEYS.has(value)) {
      return NextResponse.json({ error: `${key}: not a recognised font option` }, { status: 400 });
    }
    rows.push({ key, value, updated_by: account.email });
  }
  if (!rows.length) return NextResponse.json({ error: 'No valid tokens provided' }, { status: 400 });

  const supabase = createAdminClient();
  const { error } = await supabase.from('app_theme_tokens').upsert(rows, { onConflict: 'key' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
