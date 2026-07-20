import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { mergeTemplate, formatInvoiceList, formatAmount, type InvoiceRef } from '@/lib/email-merge';

// Client Communications: generates draft emails from real system data,
// replacing the manual BULK.xlsm mail-merge. Sending stays manual (Outlook,
// via a mailto: link in Draft Review) — this route only PREPARES drafts.
//
// TAO is not yet connected as a QuickBooks company (see PROJECT_STATUS.md),
// so AR/SOA invoice lookups only see TAB/TAC for now; any TAO amount a
// company actually owes will be missing from the merged total until TAO is
// wired up the same way TAC was.

interface CompanyRow {
  id: number; company_name: string; best_email: string | null;
  primary_contact: { email?: string; contactName?: string } | null;
}

function pickContact(company: CompanyRow | null) {
  const primary = company?.primary_contact as { email?: string; contactName?: string } | null;
  return {
    email: company?.best_email ?? primary?.email ?? null,
    contactName: primary?.contactName ?? company?.company_name ?? '',
  };
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
    type, name, fyeMonth, fyeYear, senderId, templateId,
    companyNames, onlyUnsent = true, createdByEmail, createdByName,
  } = body as {
    type: 'letter' | 'ar' | 'soa'; name: string;
    fyeMonth?: string; fyeYear?: number;
    senderId?: number; templateId: number;
    companyNames?: string[]; onlyUnsent?: boolean;
    createdByEmail?: string; createdByName?: string;
  };

  if (!type || !name || !templateId) {
    return NextResponse.json({ error: 'type, name and templateId are required' }, { status: 400 });
  }
  if (!['letter', 'ar', 'soa'].includes(type)) return NextResponse.json({ error: 'invalid type' }, { status: 400 });

  const supabase = createAdminClient();

  const { data: template } = await supabase.from('email_templates').select('*').eq('id', templateId).single();
  if (!template) return NextResponse.json({ error: 'template not found' }, { status: 404 });

  const { data: companies } = await supabase
    .from('companies')
    .select('id, company_name, best_email, primary_contact')
    .eq('is_active', true);
  const companyList = (companies ?? []) as CompanyRow[];
  const findCompany = (targetName: string): CompanyRow | null => {
    const n = normalize(targetName);
    const exact = companyList.find(c => normalize(c.company_name) === n);
    if (exact) return exact;
    return findUniqueBestMatch(targetName, companyList, c => c.company_name).value;
  };

  // ── Resolve the target company set per type ──────────────────────────────
  let targetNames: string[] = [];
  if (type === 'ar') {
    if (!fyeMonth || !fyeYear) return NextResponse.json({ error: 'fyeMonth and fyeYear required for type=ar' }, { status: 400 });
    const { data: arRows } = await supabase.from('ar_reminder')
      .select('entity_name')
      .eq('fye_month', fyeMonth).eq('fye_year', fyeYear)
      .or('status.is.null,status.neq.Excluded');
    targetNames = (arRows ?? []).map(r => r.entity_name);
  } else if (type === 'soa') {
    // Companies with an outstanding (unpaid) balance on a synced invoice.
    const { data: unpaid } = await supabase.from('quickbooks_invoices')
      .select('customer_name').gt('balance', 0);
    targetNames = [...new Set((unpaid ?? []).map(r => r.customer_name))];
  } else {
    // letter: explicit company list only (no invoice/cycle data involved).
    targetNames = companyNames ?? [];
  }
  if (companyNames?.length && type !== 'letter') {
    const allow = new Set(companyNames.map(normalize));
    targetNames = targetNames.filter(n => allow.has(normalize(n)));
  }
  if (!targetNames.length) return NextResponse.json({ error: 'no target companies resolved for this selection' }, { status: 400 });

  // ── Invoice data for ar/soa (TAB/TAC only until TAO is connected) ────────
  const invoicesByCompany = new Map<string, InvoiceRef[]>();
  if (type === 'ar' && fyeMonth && fyeYear) {
    const lastDay = new Date(fyeYear, ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(fyeMonth) + 1, 0).getDate();
    const monthNum = ['January','February','March','April','May','June','July','August','September','October','November','December'].indexOf(fyeMonth) + 1;
    const fyeCycle = `${String(lastDay).padStart(2, '0')}.${String(monthNum).padStart(2, '0')}.${fyeYear}`;
    const { data: rows } = await supabase.from('generated_invoices')
      .select('company_name, qb_company, invoice_no, total_amt')
      .eq('fye_cycle', fyeCycle);
    for (const r of rows ?? []) {
      const key = normalize(r.company_name);
      if (!invoicesByCompany.has(key)) invoicesByCompany.set(key, []);
      if (r.invoice_no) invoicesByCompany.get(key)!.push({ qbCompany: r.qb_company as 'TAB' | 'TAC', invoiceNo: r.invoice_no, amount: Number(r.total_amt ?? 0) });
    }
  } else if (type === 'soa') {
    const { data: rows } = await supabase.from('quickbooks_invoices')
      .select('customer_name, qb_company, invoice_no, balance').gt('balance', 0);
    for (const r of rows ?? []) {
      const key = normalize(r.customer_name);
      if (!invoicesByCompany.has(key)) invoicesByCompany.set(key, []);
      invoicesByCompany.get(key)!.push({ qbCompany: r.qb_company as 'TAB' | 'TAC', invoiceNo: r.invoice_no, amount: Number(r.balance ?? 0) });
    }
  }

  // AR/SOA drafts need at least one invoice — skip companies with none
  // (nothing to bill/remind about yet). Letter drafts never need invoices.
  const alreadySent = new Set<string>();
  if (onlyUnsent) {
    const { data: sentRows } = await supabase.from('email_drafts')
      .select('company_name, campaign_id, status, email_campaigns!inner(type, fye_month, fye_year)')
      .eq('status', 'sent')
      .eq('email_campaigns.type', type)
      .eq('email_campaigns.fye_month', fyeMonth ?? '')
      .eq('email_campaigns.fye_year', fyeYear ?? 0);
    for (const r of sentRows ?? []) alreadySent.add(normalize(r.company_name));
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

  for (const rawName of targetNames) {
    const key = normalize(rawName);
    if (seen.has(key)) continue;
    seen.add(key);
    if (alreadySent.has(key)) { skipped.push({ name: rawName, reason: 'already sent this cycle' }); continue; }

    const company = findCompany(rawName);
    const contact = pickContact(company);
    const refs = invoicesByCompany.get(key) ?? [];

    if (type !== 'letter' && !refs.length) { skipped.push({ name: rawName, reason: 'no invoice found (TAB/TAC only — check TAO manually)' }); continue; }
    if (!contact.email) { skipped.push({ name: rawName, reason: 'no email on file' }); continue; }

    const totalAmount = refs.reduce((s, r) => s + r.amount, 0);
    const fields = {
      companyName: rawName,
      contactName: contact.contactName || rawName,
      toEmail: contact.email ?? '',
      ccEmail: '',
      totalAmount: formatAmount(totalAmount),
      invoiceList: formatInvoiceList(refs),
      dueDate: '',
      fyeMonth: fyeMonth ?? '',
      fyeYear: fyeYear ? String(fyeYear) : '',
    };

    draftRows.push({
      campaign_id: campaign.id,
      company_id: company?.id ?? null,
      company_name: rawName,
      to_email: contact.email,
      cc_email: null,
      subject: mergeTemplate(template.subject_template, fields),
      body: mergeTemplate(template.body_template, fields),
      invoice_refs: refs,
      total_amount: totalAmount || null,
      status: 'pending',
    });
  }

  if (draftRows.length) {
    const { error: draftErr } = await supabase.from('email_drafts').insert(draftRows);
    if (draftErr) return NextResponse.json({ error: draftErr.message, campaignId: campaign.id }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    campaignId: campaign.id,
    draftsCreated: draftRows.length,
    skipped,
  });
}
