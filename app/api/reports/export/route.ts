import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { pageAll } from '@/lib/page-all';
import { customerSourceLabel } from '@/lib/customer-source';
import { buildReportsCompanyRows, REPORTS_COMPANY_SELECT, REPORTS_MASTER_LIST_SELECT } from '@/lib/reports-data';
import { type DataRow, REPORTS_EXPORT_COLUMNS, buildWorkbook } from '@/lib/export-columns';

// Full-roster .xlsx download for Reports (2026-09-03) — "让老板自己做分析"
// (let the boss do his own analysis): exports every active company with
// every Explore dimension, unfiltered by whatever's currently selected on
// screen, since Excel's own filter/pivot tools are more capable than
// anything built here — handing over everything once beats forcing a
// re-export on every dropdown change.
//
// Mirrors app/api/export/company-data/route.ts's structure (pageAll ->
// buildWorkbook -> Content-Disposition) but does NOT copy that route's own
// gap: company-data has no auth check at all. Reports is a leadership-only
// page (ApprovedAccount.canViewReports) — an unauthenticated download URL
// here would silently reopen that boundary, so this route checks it
// explicitly, same as app/api/reports/route.ts itself does.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewReports) return NextResponse.json({ error: 'Your account cannot export Reports.' }, { status: 403 });

  try {
    const supabase = createAdminClient();
    const [companies, masterList] = await Promise.all([
      pageAll<DataRow>(() => supabase.from('companies').select(REPORTS_COMPANY_SELECT)),
      pageAll<DataRow>(() => supabase.from('master_list').select(`company_name, ${REPORTS_MASTER_LIST_SELECT}`)),
    ]);

    const rows = buildReportsCompanyRows(companies, masterList)
      .filter(r => r.isActive)
      .map(r => ({
        companyName: r.companyName,
        uen: r.uen,
        companyType: r.companyType,
        ssicDescription1: r.ssicDescription1,
        customerSource: customerSourceLabel(r.customerSource),
        twStatus: r.twStatus,
        pic: r.pic,
        usesAddress: r.usesAddress ? 'Yes' : '',
        hasNd: r.hasNd ? 'Yes' : '',
        hasAgm: r.hasAgm ? 'Yes' : '',
        hasXbrl: r.hasXbrl ? 'Yes' : '',
        hasAccounts: r.hasAccounts ? 'Yes' : '',
        hasTax: r.hasTax ? 'Yes' : '',
        joinDate: r.joinDate,
      }));

    const file = await buildWorkbook(
      [{ name: 'Active Clients', rows, columns: REPORTS_EXPORT_COLUMNS }],
      { title: 'Tassure Reports Export', subject: 'Active client dataset for Reports' },
    );
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Tassure-Reports-${date}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Reports export failed:', error);
    return NextResponse.json({ error: 'Unable to export Reports data.' }, { status: 500 });
  }
}
