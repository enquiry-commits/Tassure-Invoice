import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';

// ── PATCH — update a staff remark on a "missing ND subrole" review row ──────
export async function PATCH(req: NextRequest) {
  const { key, remark } = await req.json();
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  const sb = createAdminClient();
  const { error } = await sb
    .from('automation_exceptions')
    .update({ remark: typeof remark === 'string' && remark.trim() ? remark : null })
    .eq('source', 'teamwork_nd')
    .eq('exception_type', 'missing_nominee_subrole')
    .eq('entity_key', key);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
