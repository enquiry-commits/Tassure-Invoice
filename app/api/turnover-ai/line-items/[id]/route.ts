import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';

// PATCH /api/turnover-ai/line-items/:id — the human-review step. Nothing
// here counts toward a client's turnover until review_status becomes
// 'confirmed' (see app/api/turnover-ai/summary/route.ts). `edit` always
// also confirms — there is no "corrected but still unconfirmed" state, a
// staff member typing a real number in is itself the confirmation.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const { id } = await params;
  const lineItemId = Number(id);
  if (!Number.isFinite(lineItemId)) return NextResponse.json({ error: 'Invalid line item id.' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as {
    action?: 'confirm' | 'reject' | 'edit';
    vendor?: string; txnDate?: string | null; amount?: number; currency?: string; gstAmount?: number | null;
  };

  const patch: Record<string, unknown> = { reviewed_by: account.email, reviewed_at: new Date().toISOString() };
  if (body.action === 'confirm') {
    patch.review_status = 'confirmed';
  } else if (body.action === 'reject') {
    patch.review_status = 'rejected';
  } else if (body.action === 'edit') {
    patch.review_status = 'confirmed';
    if (typeof body.vendor === 'string') patch.edited_vendor_name = body.vendor.trim() || null;
    if (body.txnDate !== undefined) patch.edited_txn_date = body.txnDate || null;
    if (typeof body.amount === 'number' && Number.isFinite(body.amount)) patch.edited_amount = body.amount;
    if (typeof body.currency === 'string') patch.edited_currency = body.currency.trim().toUpperCase() || null;
    if (body.gstAmount !== undefined) patch.edited_gst_amount = typeof body.gstAmount === 'number' && Number.isFinite(body.gstAmount) ? body.gstAmount : null;
  } else {
    return NextResponse.json({ error: 'action must be confirm, reject or edit.' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.from('turnover_line_items').update(patch).eq('id', lineItemId).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lineItem: data });
}
