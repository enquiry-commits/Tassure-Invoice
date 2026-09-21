import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { mergeTemplate, formatInvoiceList, formatAmount, formatContactName, daysOverdueFromDate, type InvoiceRef } from '@/lib/email-merge';
import { normalizeRecipientLines } from '@/lib/campaign-recipients';
import { fmtDate, currentMonthUpperSGT } from '@/lib/date';
import { soaReminderStageFromTemplate, type SoaReminderScope } from '@/lib/soa-reminder-progress';

// Client Communications: generates draft emails from real system data,
// replacing the manual BULK.xlsm mail-merge. Sending stays manual (Outlook,
// via a mailto: link in Draft Review) — this route only PREPARES drafts.
//
// The candidate company set is resolved separately by
// /api/client-communications/campaigns/preview and reviewed/edited by a
// human first (Campaign Centre's review step) — this route trusts the
// `companies` array it is given and does not recompute anything, so what
// gets written always matches exactly what the reviewer confirmed.

interface FinalizedCompany {
  companyName: string; companyId: number | null;
  toEmail: string; ccEmail?: string | null; contactName?: string;
  invoiceRefs?: InvoiceRef[]; totalAmount?: number | null;
  // Added 2026-09-17 — see lib/email-merge.ts's MergeFields.daysOverdue/
  // lastReminderDate comments. Both come pre-resolved from
  // /api/client-communications/campaigns/preview (lib/client-comms-
  // resolve.ts's buildRow()) — this route trusts them like everything else
  // in this array, per its own header comment.
  oldestDueDate?: string | null; lastReminderSentAt?: string | null;
}

export async function GET(req: NextRequest) {
  const supabase = createAdminClient();
  const status = req.nextUrl.searchParams.get('status');
  let q = supabase.from('email_campaigns').select('*, email_drafts(count)').order('created_at', { ascending: false });
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ data: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    type, name, fyeMonth, fyeYear, senderId, templateId, companies,
    createdByEmail, createdByName, soaQbCompany,
  } = body as {
    type: 'letter' | 'ar' | 'soa'; name: string;
    fyeMonth?: string; fyeYear?: number;
    senderId?: number; templateId: number;
    companies: FinalizedCompany[];
    createdByEmail?: string; createdByName?: string;
    soaQbCompany?: SoaReminderScope;
  };

  if (!type || !name || !templateId) {
    return NextResponse.json({ error: 'type, name and templateId are required' }, { status: 400 });
  }
  if (!['letter', 'ar', 'soa'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  if (!Array.isArray(companies) || !companies.length) {
    return NextResponse.json({ error: 'companies is required — preview and confirm a company list first' }, { status: 400 });
  }

  const supabase = createAdminClient();

  const { data: template } = await supabase.from('email_templates').select('*').eq('id', templateId).single();
  if (!template) return NextResponse.json({ error: 'template not found' }, { status: 404 });
  if (template.type !== type) return NextResponse.json({ error: 'template type does not match campaign type' }, { status: 400 });
  const soaReminderStage = type === 'soa' ? soaReminderStageFromTemplate(template.name) : null;
  if (type === 'soa' && !soaReminderStage) {
    return NextResponse.json({ error: 'SOA campaigns must use 1st Reminder, 2nd Reminder or 3rd Reminder.' }, { status: 400 });
  }
  if (soaQbCompany && !['TAB', 'TAC', 'TAO', 'ALL'].includes(soaQbCompany)) {
    return NextResponse.json({ error: 'invalid SOA QuickBooks scope' }, { status: 400 });
  }

  const { data: campaign, error: campaignErr } = await supabase.from('email_campaigns').insert({
    type, name, fye_month: fyeMonth ?? null, fye_year: fyeYear ?? null,
    sender_id: senderId ?? null, template_id: templateId, status: 'draft',
    created_by_email: createdByEmail ?? null, created_by_name: createdByName ?? null,
  }).select().single();
  if (campaignErr || !campaign) return NextResponse.json({ error: campaignErr?.message ?? 'failed to create campaign' }, { status: 500 });

  const draftRows: Record<string, unknown>[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const seen = new Set<string>();

  for (const c of companies) {
    if (!c.companyName) continue;
    const key = c.companyName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const toEmail = normalizeRecipientLines(c.toEmail);
    const ccEmail = normalizeRecipientLines(c.ccEmail);
    if (!toEmail) { skipped.push({ name: c.companyName, reason: 'no valid external recipient' }); continue; }

    const refs = c.invoiceRefs ?? [];
    const totalAmount = c.totalAmount ?? refs.reduce((s, r) => s + r.amount, 0);
    const contactName = formatContactName(c.contactName || c.companyName);
    const fields = {
      companyName: c.companyName,
      contactName,
      toEmail,
      ccEmail,
      totalAmount: formatAmount(totalAmount),
      invoiceList: formatInvoiceList(refs),
      dueDate: '',
      fyeMonth: fyeMonth ?? '',
      fyeYear: fyeYear ? String(fyeYear) : '',
      daysOverdue: daysOverdueFromDate(c.oldestDueDate),
      lastReminderDate: c.lastReminderSentAt ? fmtDate(c.lastReminderSentAt) : '',
      sendMonth: currentMonthUpperSGT(),
    };

    draftRows.push({
      campaign_id: campaign.id,
      company_id: c.companyId ?? null,
      company_name: c.companyName,
      contact_name: contactName,
      to_email: toEmail,
      cc_email: ccEmail || null,
      subject: mergeTemplate(template.subject_template, fields),
      body: mergeTemplate(template.body_template, fields),
      invoice_refs: refs,
      total_amount: totalAmount || null,
      status: 'pending',
      ...(type === 'soa' ? {
        soa_reminder_stage: soaReminderStage,
        soa_qb_company: soaQbCompany ?? null,
      } : {}),
    });
  }

  let createdDrafts: Record<string, unknown>[] = [];
  if (draftRows.length) {
    const { data, error: draftErr } = await supabase.from('email_drafts').insert(draftRows).select('*');
    if (draftErr) return NextResponse.json({ error: draftErr.message, campaignId: campaign.id }, { status: 500 });
    createdDrafts = data ?? [];
  }

  return NextResponse.json({
    ok: true,
    campaignId: campaign.id,
    draftsCreated: createdDrafts.length,
    drafts: createdDrafts,
    skipped,
  });
}
