import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';
import { type DataRow, AR_REMINDER_EXPORT_COLUMNS, buildWorkbook } from '@/lib/export-columns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MONTH_ABBR: Record<string, string> = {
  January: 'JAN', February: 'FEB', March: 'MAR', April: 'APR', May: 'MAY', June: 'JUN',
  July: 'JUL', August: 'AUG', September: 'SEP', October: 'OCT', November: 'NOV', December: 'DEC',
};

// One sheet, one FYE cycle — the same rows currently on screen in the AR
// Reminder table for whatever month/year is selected there (Vincent,
// 2026-08-17: "导出选中月份的 AR TABLE 内容"). Filtering matches GET
// /api/ar-reminder exactly (fye_month/fye_year, exclude soft-deleted rows)
// so the export is never out of sync with what's actually visible.
export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const { searchParams } = req.nextUrl;
  // Vincent, 2026-08-20: comma-separated, matching GET /api/ar-reminder's
  // own multi-month support — export always matches whatever's on screen.
  const months = (searchParams.get('month') ?? '').split(',').map(m => m.trim()).filter(Boolean);
  const year = parseInt(searchParams.get('year') ?? '', 10);
  if (!months.length || !Number.isInteger(year)) {
    return NextResponse.json({ error: 'month and year are required' }, { status: 400 });
  }

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('ar_reminder')
      .select('*')
      .in('fye_month', months)
      .eq('fye_year', year)
      .or('status.is.null,status.neq.Excluded')
      .order('entity_name');
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const monthAbbrs = months.map(m => MONTH_ABBR[m] ?? m.slice(0, 3).toUpperCase());
    const fyeLabel = `${monthAbbrs.join('/')} ${year}`;
    const monthsForName = months.length <= 3 ? months.join('-') : `${months.length}months`;
    const file = await buildWorkbook(
      [{
        name: 'AR Reminder',
        rows: (data ?? []) as DataRow[],
        columns: AR_REMINDER_EXPORT_COLUMNS,
        titleRow: `ANNUAL RETURN REMINDER (FYE: ${fyeLabel})`,
      }],
      { title: `Tassure AR Reminder — ${months.join(', ')} ${year}`, subject: 'AR Reminder' },
    );
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="AR-Reminder-${monthsForName}-${year}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('AR Reminder export failed:', error);
    return NextResponse.json({ error: 'Unable to export AR Reminder data.' }, { status: 500 });
  }
}
