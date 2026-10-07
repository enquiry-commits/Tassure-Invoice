import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { qbQuery, type QbCompany } from '@/lib/quickbooks';
import { mergeTemplate, formatInvoiceList, formatAmount, computeDaysOverdue, type InvoiceRef } from '@/lib/email-merge';
import { refreshInvoiceRef, amountsAreRefreshable, type RefreshCampaignType } from '@/lib/draft-refresh';
import { loadLastReminderSentAt } from '@/lib/client-comms-resolve';
import { normalize } from '@/lib/company-name';
import { fmtDate, currentMonthUpperSGT } from '@/lib/date';

// Re-verifies a prepared draft's invoice amount(s) against live QuickBooks
// data right before it's opened in Outlook. Handles the case where an
// invoice was corrected directly in QuickBooks after the draft was
// prepared here — without this, the email text would keep showing the old
// amount while the attached PDF (always fetched live) shows the corrected
// one, a confusing mismatch sent to a real client. Only re-verifies
// invoices already referenced with a qbInvoiceId; does not re-run
// recipient/invoice-set resolution.
//
// WHICH live amount depends on the email (lib/draft-refresh.ts, INV-MAIL-007): an
// SOA quotes what is still OWED on each invoice (QuickBooks' Balance), AR and
// letters quote the whole invoice (TotalAmt). Reading TotalAmt for an SOA wrote
// a partly paid invoice at its full total into the body (Vincent, 2026-10-07).
export async function POST(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();

  const { data: draft, error: draftErr } = await supabase.from('email_drafts')
    .select('id, campaign_id, contact_name, company_name, to_email, cc_email, invoice_refs, total_amount, version')
    .eq('id', id).single();
  if (draftErr || !draft) return NextResponse.json({ error: draftErr?.message ?? 'Draft not found.' }, { status: 404 });

  const { data: campaign } = await supabase.from('email_campaigns')
    .select('type, template_id, fye_month, fye_year').eq('id', draft.campaign_id).single();
  if (!campaign) return NextResponse.json({ error: 'Campaign for this draft was not found.' }, { status: 404 });

  const { data: template } = await supabase.from('email_templates')
    .select('subject_template, body_template').eq('id', campaign.template_id).single();
  if (!template) return NextResponse.json({ error: 'Template for this draft was not found.' }, { status: 404 });

  const refs = (draft.invoice_refs ?? []) as InvoiceRef[];
  // An SOA with a credit note / payment / journal entry among its lines keeps its amounts: those lines cannot be re-read, and
  // re-pricing only the invoices would double count a credit applied since (lib/draft-refresh.ts amountsAreRefreshable).
  const reprice = amountsAreRefreshable(refs, campaign.type as RefreshCampaignType);
  // Number AND amount: staff can renumber an invoice in QuickBooks as well as
  // re-price it, and the email must quote the invoice the client will
  // actually find (INV-QB-030; amounts were the only check before).
  const refreshedRefs = await Promise.all(refs.map(async (ref) => {
    if (!ref.qbInvoiceId) return ref;
    try {
      const result = await qbQuery(`SELECT Id, DocNumber, TotalAmt, Balance, ExchangeRate FROM Invoice WHERE Id = '${ref.qbInvoiceId}'`, ref.qbCompany as QbCompany);
      const row = result?.rows?.[0];
      return refreshInvoiceRef(ref, row, campaign.type as RefreshCampaignType, reprice);
    } catch {
      return ref; // Keep the last-known values rather than failing the whole request.
    }
  }));

  const newTotal = refreshedRefs.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const oldTotal = draft.total_amount ?? 0;
  const numberChanged = refreshedRefs.some((r, i) => r.invoiceNo !== refs[i].invoiceNo);

  if (newTotal === oldTotal && !numberChanged) {
    return NextResponse.json({ ok: true, changed: false, draft });
  }

  // Recomputed fresh rather than carried over from creation — daysOverdue is
  // inherently a live figure (more time may have passed since the draft was
  // first prepared), and lastReminderDate excludes THIS draft by
  // construction (loadLastReminderSentAt only looks at already-`sent` rows,
  // and this one is still pending). Only meaningful for 'soa' — the other
  // two types never populate these merge fields, so skip the extra query.
  const lastReminderSentAt = campaign.type === 'soa'
    ? (await loadLastReminderSentAt(supabase, 'soa')).get(normalize(draft.company_name)) ?? null
    : null;
  const fields = {
    companyName: draft.company_name,
    contactName: draft.contact_name || draft.company_name,
    toEmail: draft.to_email ?? '',
    ccEmail: draft.cc_email ?? '',
    totalAmount: formatAmount(newTotal),
    invoiceList: formatInvoiceList(refreshedRefs),
    dueDate: '',
    fyeMonth: campaign.fye_month ?? '',
    fyeYear: campaign.fye_year ? String(campaign.fye_year) : '',
    daysOverdue: computeDaysOverdue(refreshedRefs),
    lastReminderDate: lastReminderSentAt ? fmtDate(lastReminderSentAt) : '',
    sendMonth: currentMonthUpperSGT(),
  };

  const update = {
    subject: mergeTemplate(template.subject_template, fields),
    body: mergeTemplate(template.body_template, fields),
    invoice_refs: refreshedRefs,
    total_amount: newTotal,
    version: draft.version + 1,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error: updateErr } = await supabase.from('email_drafts')
    .update(update).eq('id', id).eq('version', draft.version).select('*').single();
  if (updateErr || !updated) {
    return NextResponse.json({ error: updateErr?.message ?? 'Someone else already updated this draft. Refresh and try again.' }, { status: 409 });
  }

  return NextResponse.json({ ok: true, changed: true, draft: updated, oldTotal, newTotal });
}
