import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';

export type TurnoverDocument = {
  id: number;
  client_company_id: number | null;
  client_name: string;
  period_label: string | null;
  file_name: string;
  status: 'processing' | 'done' | 'failed';
  error_message: string | null;
  uploaded_by: string;
  uploaded_at: string;
  lineItemCount: number;
  unconfirmedCount: number;
  duplicateSuspectCount: number;
};

// GET /api/turnover-ai/documents — recent uploads for the Inbox page, most
// recent first, each carrying its own line-item counts so the page doesn't
// need a second round trip per row.
export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const supabase = createAdminClient();
  const { data: docs, error } = await supabase.from('turnover_documents')
    .select('*').order('uploaded_at', { ascending: false }).limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const docIds = (docs ?? []).map(d => d.id);
  const { data: items } = docIds.length
    ? await supabase.from('turnover_line_items').select('id, document_id, review_status, is_duplicate_suspect').in('document_id', docIds)
    : { data: [] as { id: number; document_id: number; review_status: string; is_duplicate_suspect: boolean }[] };

  const documents: TurnoverDocument[] = (docs ?? []).map(d => {
    const mine = (items ?? []).filter(i => i.document_id === d.id);
    return {
      ...d,
      lineItemCount: mine.length,
      unconfirmedCount: mine.filter(i => i.review_status === 'unconfirmed').length,
      duplicateSuspectCount: mine.filter(i => i.is_duplicate_suspect).length,
    };
  });
  return NextResponse.json({ documents });
}
