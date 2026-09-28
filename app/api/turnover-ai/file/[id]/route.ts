import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';
import { STORAGE_BUCKET } from '@/lib/turnover-ai';

// GET /api/turnover-ai/file/:id — "查看原图" on the Review Queue. Redirects
// to a short-lived signed URL rather than proxying the bytes itself or
// ever returning a public URL — the bucket is private (receipts can carry
// partial card/account info).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const { id } = await params;
  const documentId = Number(id);
  if (!Number.isFinite(documentId)) return NextResponse.json({ error: 'Invalid document id.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: doc, error: docErr } = await supabase.from('turnover_documents').select('storage_path').eq('id', documentId).single();
  if (docErr || !doc?.storage_path) return NextResponse.json({ error: 'No stored original for this document.' }, { status: 404 });

  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(doc.storage_path, 300);
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'Could not create a link to the original file.' }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
