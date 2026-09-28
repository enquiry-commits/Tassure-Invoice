import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';

export type TurnoverLineItem = {
  id: number;
  document_id: number;
  vendor_name: string | null;
  txn_date: string | null;
  amount: number;
  currency: string | null;
  confidence: 'high' | 'medium' | 'low';
  confidence_reason: string | null;
  review_status: 'unconfirmed' | 'confirmed' | 'rejected';
  edited_vendor_name: string | null;
  edited_txn_date: string | null;
  edited_amount: number | null;
  edited_currency: string | null;
  is_duplicate_suspect: boolean;
  duplicate_of_id: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  turnover_documents: { id: number; client_name: string; client_company_id: number | null; file_name: string } | null;
};

// GET /api/turnover-ai/line-items?status=all|unconfirmed|confirmed|rejected&clientName=
// Powers the Review Queue page — every extracted receipt across every
// uploaded document (optionally scoped to one client), joined back to its
// source file for the "来源文件" column.
export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const clientName = searchParams.get('clientName');

  const supabase = createAdminClient();
  let query = supabase.from('turnover_line_items')
    .select('*, turnover_documents!inner(id, client_name, client_company_id, file_name)')
    .order('created_at', { ascending: false })
    .limit(500);
  if (status && status !== 'all') query = query.eq('review_status', status);
  if (clientName) query = query.eq('turnover_documents.client_name', clientName);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ lineItems: (data ?? []) as unknown as TurnoverLineItem[] });
}
