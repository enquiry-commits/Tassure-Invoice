import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';

// POST /api/turnover-ai/line-items/bulk-confirm — "批量确认高置信度" on the
// Review Queue. Only ever moves rows OUT of 'unconfirmed' (the .eq guard
// below), so re-clicking it never un-rejects or re-confirms something a
// human already made a decision on.
export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { ids?: unknown[] };
  const ids = Array.isArray(body.ids) ? body.ids.filter((n): n is number => typeof n === 'number' && Number.isFinite(n)) : [];
  if (!ids.length) return NextResponse.json({ error: 'ids is required and must be a non-empty array of numbers.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.from('turnover_line_items')
    .update({ review_status: 'confirmed', reviewed_by: account.email, reviewed_at: new Date().toISOString() })
    .in('id', ids)
    .eq('review_status', 'unconfirmed')
    .select('id');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ confirmed: data?.length ?? 0 });
}
