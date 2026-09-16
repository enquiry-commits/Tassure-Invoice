import { todaySGT } from '@/lib/date';
import { NextResponse } from 'next/server';
import ExcelJS from 'exceljs';
import type { QbCompany } from '@/lib/quickbooks';
import { computeSoaRows, tagAndMergeSoaRows, type SoaCompanyRow } from '@/lib/soa-data';
import { buildAllSheet, buildCompanySheet } from '@/lib/soa-export';

// GET /api/billing/soa/export-all — Vincent, 2026-09-07: "另外要生成一个完
// 整版的EXCEL（和GOOGLE SHEET 那边的一样的），要有 TAB/TAC/TAO/每个人员的/
// internal的" — originally the FULL workbook mirroring every real tab in
// his sheet: TAB, TAO, TAC (his real tab order), then one sheet per staff
// code, then a single "Internal" catch-all, plus an "All" sheet added the
// same day once the on-screen combined view shipped.
//
// 2026-09-16, Vincent: "Export Excel 那边只保留 All / TAB / TAO/ TAC, 后面
// 的 PIC 和 Internal 不需要导出" — narrowed to just these 4 sheets. The
// per-person (buildPersonSheet) and Internal (buildInternalSheet) sheet
// builders in lib/soa-export.ts were removed in the same change since this
// was their only real caller — see that file's git history if a future
// request brings this back rather than re-deriving it from scratch.
export async function GET() {
  let tab: SoaCompanyRow[], tac: SoaCompanyRow[], tao: SoaCompanyRow[];
  try {
    [tab, tac, tao] = await Promise.all([computeSoaRows('TAB'), computeSoaRows('TAC'), computeSoaRows('TAO')]);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
  // Vincent, 2026-09-16: same exclusion as the on-screen SOA list — a
  // company whose net is $0 or negative has nothing to chase, so it
  // shouldn't clutter any sheet in this workbook either. See
  // app/billing/soa/_components.tsx's picScoped comment for the full
  // reasoning (including why this stays a live filter, not a stored one).
  // Filtered once here, before any sheet builder reads them.
  tab = tab.filter(r => r.totalOutstanding > 0);
  tac = tac.filter(r => r.totalOutstanding > 0);
  tao = tao.filter(r => r.totalOutstanding > 0);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Tassure';
  workbook.created = new Date();

  // Built from the same tab/tac/tao arrays already fetched above — no
  // second round trip to Supabase, and provably the same row set the
  // on-screen All page's own computeAllSoaRows() call would produce (same
  // shared tagAndMergeSoaRows() helper, see lib/soa-data.ts).
  buildAllSheet(workbook, tagAndMergeSoaRows(tab, tac, tao));

  // Real tab order on his sheet is TAB, TAO, TAC — not alphabetical.
  const byCompany: [QbCompany, SoaCompanyRow[]][] = [['TAB', tab], ['TAO', tao], ['TAC', tac]];
  for (const [company, rows] of byCompany) buildCompanySheet(workbook, company, rows);

  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const fileName = `SOA - Full Workbook - ${todaySGT()}.xlsx`;
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, "'")}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
    },
  });
}
