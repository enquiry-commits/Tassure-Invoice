import { attachmentDisposition } from '@/lib/content-disposition';
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';

// GET /api/turnover-ai/export?projectId=... — every non-ignored line item,
// same ExcelJS single-sheet pattern as app/api/master-list/export/route.ts.
// Only ever shows items from documents the 3-day retention sweep hasn't
// purged yet (app/api/turnover-ai/cleanup/route.ts) — once purged, a
// line's detail is gone and only the project's running total (visible on
// the project page itself) still reflects it. Export promptly if the
// per-receipt detail is needed.
export const preferredRegion = 'sin1';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const projectId = Number(new URL(req.url).searchParams.get('projectId'));
  if (!Number.isFinite(projectId)) return NextResponse.json({ error: 'projectId is required.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: project, error: projectErr } = await supabase.from('turnover_projects').select('name, gst_enabled').eq('id', projectId).single();
  if (projectErr || !project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });

  const { data: docs, error: docsErr } = await supabase.from('turnover_documents').select('id').eq('project_id', projectId);
  if (docsErr) return NextResponse.json({ error: docsErr.message }, { status: 500 });
  const docIds = (docs ?? []).map(d => d.id);

  // Matches what the project page's own Total counts (Vincent: "不需要
  // confirm 先，直接计算出Total") — everything except an explicitly-
  // rejected line, so the export can never show a different number than
  // what's displayed on screen.
  const { data: items, error: itemsErr } = docIds.length
    ? await supabase.from('turnover_line_items').select('*, turnover_documents(file_name)').in('document_id', docIds).neq('review_status', 'rejected')
    : { data: [] as Record<string, unknown>[], error: null };
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tassure';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Turnover');
  sheet.columns = [
    { header: 'Vendor', key: 'vendor', width: 36 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Amount', key: 'amount', width: 14 },
    { header: 'Currency', key: 'currency', width: 10 },
    ...(project.gst_enabled ? [{ header: 'GST', key: 'gst', width: 14 }] : []),
    { header: 'Source File', key: 'file', width: 36 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const raw of items ?? []) {
    const i = raw as { edited_vendor_name?: string; vendor_name?: string; edited_txn_date?: string; txn_date?: string; edited_amount?: number; amount?: number; edited_currency?: string; currency?: string; edited_gst_amount?: number; gst_amount?: number; turnover_documents?: { file_name?: string } };
    sheet.addRow({
      vendor: i.edited_vendor_name ?? i.vendor_name ?? '',
      date: i.edited_txn_date ?? i.txn_date ?? '',
      amount: i.edited_amount ?? i.amount ?? 0,
      currency: i.edited_currency ?? i.currency ?? '',
      ...(project.gst_enabled ? { gst: i.edited_gst_amount ?? i.gst_amount ?? '' } : {}),
      file: i.turnover_documents?.file_name ?? '',
    });
  }

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `Turnover - ${project.name} - ${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': attachmentDisposition(fileName),
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
