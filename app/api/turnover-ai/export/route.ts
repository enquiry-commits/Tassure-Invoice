import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';

// GET /api/turnover-ai/export?clientName=... — confirmed line items only,
// same ExcelJS single-sheet pattern as app/api/master-list/export/route.ts.
export const preferredRegion = 'sin1';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const clientName = new URL(req.url).searchParams.get('clientName');
  if (!clientName) return NextResponse.json({ error: 'clientName is required.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: docs, error: docsErr } = await supabase.from('turnover_documents').select('id').eq('client_name', clientName);
  if (docsErr) return NextResponse.json({ error: docsErr.message }, { status: 500 });
  const docIds = (docs ?? []).map(d => d.id);

  const { data: items, error: itemsErr } = docIds.length
    ? await supabase.from('turnover_line_items').select('*, turnover_documents(file_name)').in('document_id', docIds).eq('review_status', 'confirmed')
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
    { header: 'Source File', key: 'file', width: 36 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const raw of items ?? []) {
    const i = raw as { edited_vendor_name?: string; vendor_name?: string; edited_txn_date?: string; txn_date?: string; edited_amount?: number; amount?: number; edited_currency?: string; currency?: string; turnover_documents?: { file_name?: string } };
    sheet.addRow({
      vendor: i.edited_vendor_name ?? i.vendor_name ?? '',
      date: i.edited_txn_date ?? i.txn_date ?? '',
      amount: i.edited_amount ?? i.amount ?? 0,
      currency: i.edited_currency ?? i.currency ?? '',
      file: i.turnover_documents?.file_name ?? '',
    });
  }

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `Turnover - ${clientName} - ${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, "'")}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
