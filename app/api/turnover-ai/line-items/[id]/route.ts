import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';

// PATCH /api/turnover-ai/line-items/:id. Vincent, removing the review
// workflow entirely: "不需要 Peding 和 Confirm 就把他当成最简单的计算功能
// ...如果高风险的他们自己会去查看原始的账单，直接修改金额就好，不需要多一
// 步 SAVE，或者confirm" — every line counts toward the total the moment
// it's extracted, confidence is reference only, and editing a value saves
// immediately with no separate confirm step. `reject`/`restore` are the
// only two actions left: Ignore excludes a line from the total (duplicate
// or mistake), Restore undoes that. `edit` no longer touches
// review_status at all — it just overwrites the edited_* values in place.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const { id } = await params;
  const lineItemId = Number(id);
  if (!Number.isFinite(lineItemId)) return NextResponse.json({ error: 'Invalid line item id.' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as {
    action?: 'reject' | 'restore' | 'edit';
    vendor?: string; txnDate?: string | null; amount?: number; currency?: string; gstAmount?: number | null;
  };

  const patch: Record<string, unknown> = { reviewed_by: account.email, reviewed_at: new Date().toISOString() };
  if (body.action === 'reject') {
    patch.review_status = 'rejected';
  } else if (body.action === 'restore') {
    patch.review_status = 'unconfirmed';
  } else if (body.action === 'edit') {
    if (typeof body.vendor === 'string') patch.edited_vendor_name = body.vendor.trim() || null;
    if (body.txnDate !== undefined) patch.edited_txn_date = body.txnDate || null;
    if (typeof body.amount === 'number' && Number.isFinite(body.amount)) patch.edited_amount = body.amount;
    if (typeof body.currency === 'string') patch.edited_currency = body.currency.trim().toUpperCase() || null;
    if (body.gstAmount !== undefined) patch.edited_gst_amount = typeof body.gstAmount === 'number' && Number.isFinite(body.gstAmount) ? body.gstAmount : null;
  } else {
    return NextResponse.json({ error: 'action must be reject, restore or edit.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.from('turnover_line_items').update(patch).eq('id', lineItemId).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lineItem: data });
}
