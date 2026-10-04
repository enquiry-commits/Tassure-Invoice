import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';
import { STORAGE_BUCKET } from '@/lib/turnover-ai';
import { documentOutcome, isUnread } from '@/lib/turnover-ai-files';

// DELETE /api/turnover-ai/documents/:id — removes a file that couldn't be
// read from its project (Vincent, 2026-10-05: "加移除按钮" — once staff have
// dropped it again, its old "couldn't be read" line needn't wait for the
// 3-day cleanup). Only a failed or interrupted file with no receipts in the
// table: never one still being read, never one that counts toward a total
// (docs/INVARIANTS.md INV-DATA-072). Its stored original goes first, as in
// the project DELETE — a row cascade never touches Storage.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const documentId = Number((await params).id);
  if (!Number.isFinite(documentId)) return NextResponse.json({ error: 'Invalid document id.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: doc, error: docErr } = await supabase.from('turnover_documents').select('id, status, uploaded_at, storage_path').eq('id', documentId).maybeSingle();
  if (docErr) return NextResponse.json({ error: docErr.message }, { status: 500 });
  if (!doc) return NextResponse.json({ error: 'This file is no longer in the project.' }, { status: 404 });
  if (!isUnread(documentOutcome(doc.status, doc.uploaded_at, Date.now()))) {
    return NextResponse.json({ error: 'Only a file that couldn’t be read can be removed.' }, { status: 409 });
  }

  const { count, error: countErr } = await supabase.from('turnover_line_items').select('id', { count: 'exact', head: true }).eq('document_id', documentId);
  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if (count) return NextResponse.json({ error: 'This file has receipts in the table — Ignore those instead.' }, { status: 409 });

  if (doc.storage_path) await supabase.storage.from(STORAGE_BUCKET).remove([doc.storage_path]);
  const { error } = await supabase.from('turnover_documents').delete().eq('id', documentId).neq('status', 'done');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
