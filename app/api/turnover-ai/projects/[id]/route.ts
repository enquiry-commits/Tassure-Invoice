import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';
import { computeCurrencyTotals, mergeCurrencyTotals, STORAGE_BUCKET, type CurrencyTotal } from '@/lib/turnover-ai';
import { documentOutcome, type DocumentOutcome } from '@/lib/turnover-ai-files';

export type TurnoverProjectDocument = {
  id: number;
  file_name: string;
  status: 'processing' | 'done' | 'failed';
  error_message: string | null;
  uploaded_at: string;
  // status as staff should read it — a read cut off mid-way shows as
  // 'interrupted' (lib/turnover-ai-files.ts documentOutcome), display only.
  outcome: DocumentOutcome;
};

export type TurnoverProjectLineItem = {
  id: number;
  document_id: number;
  vendor_name: string | null;
  txn_date: string | null;
  amount: number;
  currency: string | null;
  gst_amount: number | null;
  confidence: 'high' | 'medium' | 'low';
  confidence_reason: string | null;
  review_status: 'unconfirmed' | 'confirmed' | 'rejected';
  edited_vendor_name: string | null;
  edited_txn_date: string | null;
  edited_amount: number | null;
  edited_currency: string | null;
  edited_gst_amount: number | null;
  is_duplicate_suspect: boolean;
  file_name: string;
};

// GET /api/turnover-ai/projects/:id — everything the project detail page
// needs in one round trip (upload area + review table + totals all live on
// one page now — see app/turnover-ai/project/[id]/page.tsx's own header
// comment for why Projects replaced the earlier 3-tab layout).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const projectId = Number((await params).id);
  if (!Number.isFinite(projectId)) return NextResponse.json({ error: 'Invalid project id.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: project, error: projectError } = await supabase.from('turnover_projects').select('*').eq('id', projectId).single();
  if (projectError || !project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  const { data: documents, error: docsError } = await supabase.from('turnover_documents')
    .select('id, file_name, status, error_message, uploaded_at').eq('project_id', projectId).order('uploaded_at', { ascending: false });
  if (docsError) return NextResponse.json({ error: docsError.message }, { status: 500 });

  const docIds = (documents ?? []).map(d => d.id);
  const { data: items, error: itemsError } = docIds.length
    ? await supabase.from('turnover_line_items').select('*, turnover_documents(file_name)').in('document_id', docIds).order('created_at', { ascending: false })
    : { data: [], error: null };
  if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 });

  const lineItems: TurnoverProjectLineItem[] = (items ?? []).map(i => ({
    ...i,
    file_name: (i.turnover_documents as { file_name?: string } | null)?.file_name ?? '',
  }));

  // Vincent, 2026-10-04: "不需要confirm 先，直接计算出Total 如果各别算出的
  // 数字不对，员工也可以自己再随时手动修改某个金额" — every extracted line
  // counts toward the total immediately; only an explicitly-rejected
  // (duplicate/mistake) line is excluded. Confirm was removed from the UI
  // entirely in the same change (see app/turnover-ai/project/[id]/
  // page.tsx) — editing a value no longer gates or flags anything either,
  // it just overwrites the edited_* columns in place. `pendingCount` below
  // is kept only because review_status itself (unconfirmed/confirmed/
  // rejected) is unchanged in the DB; the UI no longer surfaces it.
  const countable = lineItems.filter(i => i.review_status !== 'rejected');
  const pendingCount = lineItems.filter(i => i.review_status === 'unconfirmed').length;
  const liveTotals = computeCurrencyTotals(countable);
  const snapshotTotals = (project.confirmed_totals ?? []) as CurrencyTotal[];
  const totals = mergeCurrencyTotals(snapshotTotals, liveTotals);

  return NextResponse.json({
    project,
    documents: (documents ?? []).map(d => ({ ...d, outcome: documentOutcome(d.status, d.uploaded_at, Date.now()) })) as TurnoverProjectDocument[],
    lineItems,
    pendingCount,
    totals,
  });
}

// PATCH /api/turnover-ai/projects/:id — Vincent: "文件夹名字可以随时更改
// 的". Rename only, for now — gst_enabled is deliberately left set-once-
// at-creation (changing it mid-project would silently change what future
// uploads get checked for without re-processing already-extracted lines).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const projectId = Number((await params).id);
  if (!Number.isFinite(projectId)) return NextResponse.json({ error: 'Invalid project id.' }, { status: 400 });

  const body = await req.json().catch(() => ({})) as { name?: string };
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: 'A project name is required.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data, error } = await supabase.from('turnover_projects').update({ name }).eq('id', projectId).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: data });
}

// DELETE /api/turnover-ai/projects/:id — Vincent: "要设置给员工可以自己删除
// 文件夹的功能". Removes the project's original files from Storage first
// (ON DELETE CASCADE only ever touches Postgres rows, never the Storage
// objects they pointed to), then the project row — turnover_documents/
// turnover_line_items cascade automatically.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const projectId = Number((await params).id);
  if (!Number.isFinite(projectId)) return NextResponse.json({ error: 'Invalid project id.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: documents } = await supabase.from('turnover_documents').select('storage_path').eq('project_id', projectId);
  const paths = (documents ?? []).map(d => d.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length) await supabase.storage.from(STORAGE_BUCKET).remove(paths);

  const { error } = await supabase.from('turnover_projects').delete().eq('id', projectId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
