import * as XLSX from 'xlsx';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { type DataRow, ACTIVE_CLIENT_COLUMNS, AR_REMINDER_COLUMNS, makeSheet } from '@/lib/export-columns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const [activeClients, arReminder] = await Promise.all([
      pageAll<DataRow>(() => supabase
        .from('master_list')
        .select('*')
        .eq('list_type', 'active_client')
        .order('row_order', { ascending: true })),
      pageAll<DataRow>(() => supabase
        .from('ar_reminder')
        .select('*')
        .or('status.is.null,status.neq.Excluded')
        .order('fye_year', { ascending: false })
        .order('fye_month', { ascending: true })
        .order('entity_name', { ascending: true })),
    ]);

    const workbook = XLSX.utils.book_new();
    workbook.Props = {
      Title: 'Tassure Latest Company Data',
      Subject: 'Active Clients and AR Reminder',
      Author: 'Tassure',
      CreatedDate: new Date(),
    };
    XLSX.utils.book_append_sheet(workbook, makeSheet(activeClients, ACTIVE_CLIENT_COLUMNS), 'Active Clients');
    XLSX.utils.book_append_sheet(workbook, makeSheet(arReminder, AR_REMINDER_COLUMNS), 'AR Reminder');

    const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());

    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Tassure-Company-Data-${date}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Company data export failed:', error);
    return Response.json({ error: 'Unable to export company data.' }, { status: 500 });
  }
}
