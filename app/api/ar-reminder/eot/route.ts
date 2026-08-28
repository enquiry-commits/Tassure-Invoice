import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { getRequestAccount } from '@/lib/request-account';

/**
 * EOT (Extension of Time) — a filtered view of ar_reminder, not a separate
 * list. An EOT company is an already-tracked AR Reminder cycle whose AGM/AR
 * due date TeamWork shows as extended (see app/api/late-filing/sync/route.ts's
 * Pass 3, which writes the four eot_* columns this route reads). Returns
 * every row with at least one of those four columns set, across every
 * month/year — unlike the main /api/ar-reminder GET, which is scoped to one
 * cycle at a time and does far more QuickBooks/ND enrichment EOT doesn't need.
 */
export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const supabase = createAdminClient();
  const { data: rows, error } = await supabase
    .from('ar_reminder')
    .select(`
      id, entity_name, uen, fye_month, fye_year,
      reminder_note, reminder_note_manual, prepared_date,
      sent_date, received_date,
      ar_original_due_date, ar_revised_due_date,
      agm_original_due_date, agm_revised_due_date,
      xbrl, dpo, ond_ron,
      pic, acc_pic, acc_pic_manual, tax_pic, tax_pic_manual,
      remarks, company_id, updated_at, version
    `)
    .or('ar_original_due_date.not.is.null,ar_revised_due_date.not.is.null,agm_original_due_date.not.is.null,agm_revised_due_date.not.is.null')
    .or('status.is.null,status.neq.Excluded')
    .order('entity_name');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const companyIds = [...new Set((rows ?? []).map(r => r.company_id).filter((id): id is number => id != null))];
  const { data: companies, error: companiesError } = companyIds.length
    ? await supabase.from('companies').select('id, internal_code').in('id', companyIds)
    : { data: [] as { id: number; internal_code: string | null }[], error: null };
  if (companiesError) return NextResponse.json({ error: companiesError.message }, { status: 500 });
  const codeByCompanyId = new Map((companies ?? []).map(c => [c.id, c.internal_code]));

  const out = (rows ?? []).map(row => ({
    ...row,
    internal_code: row.company_id ? (codeByCompanyId.get(row.company_id) ?? null) : null,
  }));

  return NextResponse.json({ total: out.length, rows: out }, { headers: { 'Cache-Control': 'private, no-store' } });
}
