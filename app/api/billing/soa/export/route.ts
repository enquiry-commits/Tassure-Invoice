import { todaySGT } from '@/lib/date';
import { NextRequest, NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import type { QbCompany } from '@/lib/quickbooks';
import { computeSoaRows } from '@/lib/soa-data';
import { buildCompanySheet } from '@/lib/soa-export';

const QB_COMPANIES: QbCompany[] = ['TAB', 'TAC', 'TAO'];

// GET /api/billing/soa/export?company=TAB|TAC|TAO — Vincent, 2026-09-07:
// "我要可以导出EXCEL，要和GOOGLE SHEET的格式一样" — matches his real sheet's
// own layout (legal name / "A/R Ageing Summary Report" / "As of ..." title
// block, then Company/aging-buckets/Total/PIC columns) rather than this
// repo's other exports' generic single-header-row shape (lib/export-
// columns.ts), which doesn't have anywhere to put a multi-line title block.
// Reuses computeSoaRows — same numbers as the on-screen list, never a
// second, differently-computed copy. Sheet-building itself lives in
// lib/soa-export.ts, shared with GET /api/billing/soa/export-all (the full
// workbook with every real tab — TAB/TAC/TAO + per-staff + Internal).
export async function GET(req: NextRequest) {
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  if (!company || !QB_COMPANIES.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO' }, { status: 400 });
  }

  let rows;
  try {
    rows = await computeSoaRows(company);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tassure';
  workbook.created = new Date();
  buildCompanySheet(workbook, company, rows);

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `${company} A-R Ageing - ${todaySGT()}.xlsx`;
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, "'")}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
