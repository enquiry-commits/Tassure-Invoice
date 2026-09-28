import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';
import { extractReceipts, findDuplicateSuspect, ensureBucket, STORAGE_BUCKET } from '@/lib/turnover-ai';

// POST /api/turnover-ai/extract — the one write path that turns an
// uploaded file into structured turnover_line_items rows. See
// lib/turnover-ai.ts and scripts/add-turnover-ai.sql for the shape and the
// 4 business rules behind it.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic']);
const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const clientName = String(form?.get('clientName') ?? '').trim();
  const clientCompanyIdRaw = form?.get('clientCompanyId');
  const clientCompanyId = clientCompanyIdRaw && !Number.isNaN(Number(clientCompanyIdRaw)) ? Number(clientCompanyIdRaw) : null;
  const periodLabel = String(form?.get('periodLabel') ?? '').trim() || null;

  if (!file || !(file instanceof File)) return NextResponse.json({ error: 'A file is required (field name "file").' }, { status: 400 });
  if (!clientName) return NextResponse.json({ error: 'A client name is required.' }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'File too large (max 15MB).' }, { status: 400 });
  const mediaType = file.type || 'application/octet-stream';
  if (!ALLOWED_MIME.has(mediaType)) return NextResponse.json({ error: `Unsupported file type: ${mediaType || 'unknown'}. Use PDF, JPG, PNG or HEIC.` }, { status: 400 });

  const supabase = createAdminClient();
  const buffer = Buffer.from(await file.arrayBuffer());

  const { data: docRow, error: docErr } = await supabase.from('turnover_documents').insert({
    client_company_id: clientCompanyId,
    client_name: clientName,
    period_label: periodLabel,
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
      const storagePath = `${documentId}/${file.name}`;
      const { error: uploadErr } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, buffer, { contentType: mediaType, upsert: true });
      if (!uploadErr) await supabase.from('turnover_documents').update({ storage_path: storagePath }).eq('id', documentId);
    } catch {
      // Losing the original is not fatal to extraction — "查看原图" just
      // won't be available for this document. Never block the actual
      // reading over a storage hiccup.
    }

    const kind = mediaType === 'application/pdf' ? 'document' : 'image';
    const receipts = await extractReceipts({ base64: buffer.toString('base64'), mediaType, kind });
    if (!receipts.length) {
      await supabase.from('turnover_documents').update({ status: 'failed', error_message: 'No receipts could be identified in this file.' }).eq('id', documentId);
      return NextResponse.json({ error: 'No receipts could be identified in this file.' }, { status: 422 });
    }

    const rows = [];
    for (const r of receipts) {
      const duplicateOfId = await findDuplicateSuspect(supabase, { clientName, vendor: r.vendor, txnDate: r.txnDate, amount: r.amount });
      rows.push({
        document_id: documentId,
        vendor_name: r.vendor,
        txn_date: r.txnDate,
        amount: r.amount ?? 0,
        currency: r.currency,
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
