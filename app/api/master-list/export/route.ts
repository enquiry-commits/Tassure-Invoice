import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import { createAdminClient } from '@/lib/supabase';
import { MASTER_LIST_COLUMNS, MASTER_LIST_EXTRA_COLUMNS } from '@/lib/master-list-columns';

// GET /api/master-list/export?type=active_client&fields=company_name,roc_no,...
//
// Quarterly backup export (Vincent/Cindy, 2026-09-23: "Active client list,
// 我需要可以generate excel...每个季度要back up") — one Master List page's
// full roster (list_type filter, same sort as GET /api/master-list) as a
// single-sheet .xlsx. `fields` names the exact column set/order (the calling
// page's own `fields`/COLUMNS, from components/MasterListTable.tsx), so the
// exported header row is guaranteed to match what staff see on screen —
// labels come from lib/master-list-columns.ts, the same source that page
// uses, never a second hand-typed copy.
//
// Deliberately ignores the on-screen search/column filters: a backup export
// is meant to be the complete roster at that point in time, not whatever
// happened to be filtered when someone clicked the button.
export const preferredRegion = 'sin1';

const LABEL_BY_FIELD = new Map(
  [...MASTER_LIST_COLUMNS, ...MASTER_LIST_EXTRA_COLUMNS].map(c => [c.field, c.label]),
);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  if (!type) return NextResponse.json({ error: 'Missing type.' }, { status: 400 });

  const fieldsParam = searchParams.get('fields');
  const fields = fieldsParam
    ? fieldsParam.split(',').map(f => f.trim()).filter(Boolean)
    : MASTER_LIST_COLUMNS.map(c => c.field);

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('master_list')
    .select('*')
    .eq('list_type', type)
    .order('internal_code', { ascending: true, nullsFirst: false })
    .order('company_name', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tassure';
  workbook.created = new Date();
  // Sheet names can't exceed 31 chars or contain []:*?/\\ — list_type values
  // are all short plain snake_case today, but guard anyway.
  const sheet = workbook.addWorksheet(type.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet1');
  sheet.columns = fields.map(f => ({ header: LABEL_BY_FIELD.get(f) ?? f, key: f, width: 22 }));
  sheet.getRow(1).font = { bold: true };

  for (const row of (data ?? []) as Record<string, unknown>[]) {
    sheet.addRow(Object.fromEntries(fields.map(f => [f, row[f] ?? ''])));
  }

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `${type} - ${new Date().toISOString().slice(0, 10)}.xlsx`;
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, "'")}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
