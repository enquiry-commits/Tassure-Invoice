import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { qbQuery, type QbCompany } from '@/lib/quickbooks';
import { mergeTemplate, formatInvoiceList, formatAmount, type InvoiceRef } from '@/lib/email-merge';

// Re-verifies a prepared draft's invoice amount(s) against live QuickBooks
// data right before it's opened in Outlook. Handles the case where an
// invoice was corrected directly in QuickBooks after the draft was
// prepared here — without this, the email text would keep showing the old
// amount while the attached PDF (always fetched live) shows the corrected
// one, a confusing mismatch sent to a real client. Only re-verifies
// invoices already referenced (TAB/TAC with a qbInvoiceId); does not
// re-run recipient/invoice-set resolution.
export async function POST(req: NextRequest) {
  const { id } = await req.json();
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = createAdminClient();

  const { data: draft, error: draftErr } = await supabase.from('email_drafts')
    .select('id, campaign_id, contact_name, company_name, to_email, cc_email, invoice_refs, total_amount, version')
    .eq('id', id).single();
  if (draftErr || !draft) return NextResponse.json({ error: draftErr?.message ?? 'Draft not found.' }, { status: 404 });

  const { data: campaign } = await supabase.from('email_campaigns')
    .select('template_id, fye_month, fye_year').eq('id', draft.campaign_id).single();
  if (!campaign) return NextResponse.json({ error: 'Campaign for this draft was not found.' }, { status: 404 });

  const { data: template } = await supabase.from('email_templates')
    .select('subject_template, body_template').eq('id', campaign.template_id).single();
  if (!template) return NextResponse.json({ error: 'Template for this draft was not found.' }, { status: 404 });

  const refs = (draft.invoice_refs ?? []) as InvoiceRef[];
  const refreshedRefs = await Promise.all(refs.map(async (ref) => {
    if (!ref.qbInvoiceId || (ref.qbCompany !== 'TAB' && ref.qbCompany !== 'TAC')) return ref;
    try {
      const result = await qbQuery(`SELECT Id, TotalAmt FROM Invoice WHERE Id = '${ref.qbInvoiceId}'`, ref.qbCompany as QbCompany);
      const live = result?.rows?.[0]?.TotalAmt;
      if (typeof live === 'number') return { ...ref, amount: live };
      return ref;
    } catch {
      return ref; // Keep the last-known amount rather than failing the whole request.
    }
  }));

  const newTotal = refreshedRefs.reduce((sum, r) => sum + (r.amount ?? 0), 0);
  const oldTotal = draft.total_amount ?? 0;

  if (newTotal === oldTotal) {
    return NextResponse.json({ ok: true, changed: false, draft });
  }

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
