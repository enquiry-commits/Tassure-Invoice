import * as XLSX from 'xlsx';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type DataRow = Record<string, unknown>;
type ExportColumn = { key: string; label: string; width: number };

const ACTIVE_CLIENT_COLUMNS: ExportColumn[] = [
  { key: 'internal_code', label: 'Code', width: 12 },
  { key: 'company_name', label: 'Company Name', width: 42 },
  { key: 'roc_no', label: 'UEN / ROC No.', width: 18 },
  { key: 'status', label: 'Active', width: 12 },
  { key: 'join_date', label: 'Join Date', width: 14 },
  { key: 'add_here', label: 'Address Service', width: 18 },
  { key: 'invoice_address', label: 'Invoice / Registered Address', width: 42 },
  { key: 'contact_window', label: 'Contact Window', width: 24 },
  { key: 'email', label: 'Email', width: 34 },
  { key: 'tel', label: 'Telephone', width: 18 },
  { key: 'nominee_director', label: 'Nominee Director', width: 22 },
  { key: 'secretary', label: 'Secretary', width: 22 },
  { key: 'annual_return', label: 'Annual Return', width: 18 },
  { key: 'fye', label: 'FYE', width: 14 },
  { key: 'last_ar_date', label: 'Last AR Date', width: 16 },
  { key: 'last_agm_date', label: 'Last AGM Date', width: 16 },
  { key: 'last_accounts_date', label: 'Last Accounts Date', width: 18 },
  { key: 'next_agm_due_date', label: 'Next AGM Due Date', width: 19 },
  { key: 'months_from_last_accounts', label: '>13M Accounts', width: 16 },
  { key: 'remark', label: 'Remark', width: 36 },
  { key: 'referral', label: 'Referral', width: 18 },
  { key: 'risk_level', label: 'Risk Level', width: 14 },
  { key: 'incorp_with_us', label: 'Incorporated With Us', width: 20 },
  { key: 'mas', label: 'MAS', width: 14 },
  { key: 'grade', label: 'Grade', width: 12 },
];

const AR_REMINDER_COLUMNS: ExportColumn[] = [
  { key: 'entity_name', label: 'Company Name', width: 42 },
  { key: 'uen', label: 'UEN', width: 18 },
  { key: 'fye_month', label: 'FYE Month', width: 14 },
  { key: 'fye_year', label: 'FYE Year', width: 12 },
  { key: 'fye_date', label: 'FYE Date', width: 14 },
  { key: 'due_date', label: 'Due Date', width: 14 },
  { key: 'reminder_note', label: 'Reminder', width: 18 },
  { key: 'prepared_date', label: 'Report Ready', width: 16 },
  { key: 'date_of_agm', label: 'AGM', width: 14 },
  { key: 'sent_date', label: 'To Client', width: 14 },
  { key: 'received_date', label: 'Signed', width: 14 },
  { key: 'filling_date', label: 'AR', width: 14 },
  { key: 'xbrl', label: 'XBRL', width: 14 },
  { key: 'software_update', label: 'TW Update', width: 16 },
  { key: 'dpo', label: 'DPO', width: 14 },
  { key: 'ond_ron', label: 'ROND RONS', width: 16 },
  { key: 'pic', label: 'SEC PIC', width: 18 },
  { key: 'acc_pic', label: 'ACC PIC', width: 18 },
  { key: 'tax_pic', label: 'TAX PIC', width: 18 },
  { key: 'remarks', label: 'Remarks', width: 36 },
  { key: 'status', label: 'Status', width: 16 },
  { key: 'updated_at', label: 'Last Updated', width: 22 },
];

function makeSheet(rows: DataRow[], columns: ExportColumn[]) {
  const values = [
    columns.map(column => column.label),
    ...rows.map(row => columns.map(column => row[column.key] ?? '')),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(values);
  sheet['!cols'] = columns.map(column => ({ wch: column.width }));
  sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(columns.length - 1)}${Math.max(1, values.length)}` };
  return sheet;
}

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
