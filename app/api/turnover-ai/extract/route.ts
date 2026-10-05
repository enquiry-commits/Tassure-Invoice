import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';
import { extractReceipts, findDuplicateSuspect, ensureBucket, STORAGE_BUCKET } from '@/lib/turnover-ai';
import { sniffKind, MEDIA_TYPE, EXTENSION, UPLOAD_MAX_BYTES, megabytes } from '@/lib/turnover-ai-files';

// POST /api/turnover-ai/extract — the one write path that turns an
// uploaded file into structured turnover_line_items rows, scoped to a
// project (Vincent: "员工可以先开一个项目，点击项目后，再导入PDF"). One
// file per request — the client's own up-to-100-at-once batching
// (app/turnover-ai/project/[id]/page.tsx) just calls this in a loop, so
// this route itself needs no special handling for large batches.
//
// 2026-10-05 (docs/INVARIANTS.md INV-DATA-072): the size ceiling is Vercel's
// ~4.5MB request body, not the old 15MB check (which could never run); the
// file's type comes from its own first bytes, not the browser's claim (a
// .heic often arrives with no type at all); HEIC is converted to JPEG in the
// browser before it gets here, since Claude can't read it; 300s instead of
// 60s, so a long multi-page PDF isn't killed mid-read.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const projectIdRaw = form?.get('projectId');
  const projectId = projectIdRaw ? Number(projectIdRaw) : NaN;

  if (!file || !(file instanceof File)) return NextResponse.json({ error: 'A file is required (field name "file").' }, { status: 400 });
  if (!Number.isFinite(projectId)) return NextResponse.json({ error: 'A valid projectId is required.' }, { status: 400 });
  if (file.size > UPLOAD_MAX_BYTES) return NextResponse.json({ error: `File too large (${megabytes(file.size)}; uploads are limited to ${megabytes(UPLOAD_MAX_BYTES)}).` }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const kind = sniffKind(new Uint8Array(buffer.subarray(0, 16)));
  if (!kind) return NextResponse.json({ error: 'This file is not a PDF or a supported photo (JPG, PNG, WEBP).' }, { status: 400 });
  if (kind === 'heic') return NextResponse.json({ error: 'HEIC photos are converted to JPG in the browser before upload — reload the page and drop it again.' }, { status: 415 });
  const mediaType = MEDIA_TYPE[kind];

  const supabase = createAdminClient();
  const { data: project, error: projectErr } = await supabase.from('turnover_projects').select('id, name, client_company_id, gst_enabled').eq('id', projectId).single();
  if (projectErr || !project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  // client_name is still NOT NULL in production (scripts/add-turnover-ai.sql
  // — the Projects migration never relaxed it). Leaving it out after the
  // Projects restructure made every upload fail at this insert
  // (docs/INVARIANTS.md INV-DATA-071); it records the project's name at
  // upload time.
  const { data: docRow, error: docErr } = await supabase.from('turnover_documents').insert({
    project_id: projectId,
    client_name: project.name,
    client_company_id: project.client_company_id,
    file_name: file.name,
    mime_type: mediaType,
    status: 'processing',
    uploaded_by: account.email,
  }).select('id').single();
  if (docErr || !docRow) return NextResponse.json({ error: docErr?.message ?? 'Could not create the document record.' }, { status: 500 });
  const documentId = docRow.id as number;

  try {
    try {
      await ensureBucket(supabase);
      // ASCII-only key: Supabase Storage rejects non-ASCII keys, and this
      // catch used to swallow that — a Chinese-named e-invoice's original
      // was silently never stored ("View original" → 404). The real name
      // stays in turnover_documents.file_name.
      const storagePath = `${documentId}/original.${EXTENSION[kind]}`;
      const { error: uploadErr } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, { contentType: mediaType, upsert: true });
      if (!uploadErr) await supabase.from('turnover_documents').update({ storage_path: storagePath }).eq('id', documentId);
    } catch {
      // Losing the original is not fatal to extraction — "查看原图" just
      // won't be available for this document. Never block the actual
      // reading over a storage hiccup.
    }

    const receipts = await extractReceipts({
      base64: buffer.toString('base64'), mediaType, kind: kind === 'pdf' ? 'document' : 'image', gstEnabled: project.gst_enabled,
      usage: { feature: 'turnover_ai', trigger: 'upload', actorEmail: account.email },
    });
    if (!receipts.length) {
      await supabase.from('turnover_documents').update({ status: 'failed', error_message: 'No receipts could be identified in this file.' }).eq('id', documentId);
      return NextResponse.json({ error: 'No receipts could be identified in this file.' }, { status: 422 });
    }

    const rows = [];
    for (const r of receipts) {
      const duplicateOfId = await findDuplicateSuspect(supabase, { projectId, vendor: r.vendor, txnDate: r.txnDate, amount: r.amount });
      rows.push({
        document_id: documentId,
        vendor_name: r.vendor,
        txn_date: r.txnDate,
        amount: r.amount ?? 0,
        currency: r.currency,
        gst_amount: r.gstAmount,
        confidence: r.confidence,
        confidence_reason: r.confidenceReason,
        is_duplicate_suspect: duplicateOfId !== null,
        duplicate_of_id: duplicateOfId,
        raw_extraction: r,
      });
    }
    const { data: inserted, error: insErr } = await supabase.from('turnover_line_items').insert(rows).select('*');
    if (insErr) throw new Error(insErr.message);

    await supabase.from('turnover_documents').update({ status: 'done' }).eq('id', documentId);
    return NextResponse.json({ documentId, lineItems: inserted ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Extraction failed.';
    await supabase.from('turnover_documents').update({ status: 'failed', error_message: message }).eq('id', documentId);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
