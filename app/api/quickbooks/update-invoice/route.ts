import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getApprovedAccount } from '@/lib/approved-accounts';
import { createAdminClient } from '@/lib/supabase';
import { getValidToken, qbQuery, type QbCompany } from '@/lib/quickbooks';
import { getItemMap, findPicClass, buildInvoiceLineArray, type DraftLineItem } from '@/lib/qb-invoice-conventions';
import { normalize } from '@/lib/company-name';
import { syncQuickBooksInvoiceChanges } from '@/lib/quickbooks-invoice-incremental';
import type { InvoiceRef } from '@/lib/email-merge';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

// PATCH /api/quickbooks/update-invoice — edits an invoice's line items in
// place. Deliberately narrow: only an invoice THIS system created, that
// hasn't been referenced by a sent AR email yet, and has no payment
// recorded against it in QuickBooks. Every check re-verified live here —
// nothing about "is this safe to edit" is trusted from the client.
export async function PATCH(req: NextRequest) {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data: authData } = await auth.auth.getUser();
  const account = getApprovedAccount(authData.user?.email);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });

  const body = await req.json();
  const { qbCompany, qbInvoiceId, pic, lines } = body as {
    qbCompany: QbCompany;
    qbInvoiceId: string;
    pic?: string;
    lines: DraftLineItem[];
  };

  if (qbCompany !== 'TAB' && qbCompany !== 'TAC') {
    return NextResponse.json({ error: 'qbCompany must be TAB or TAC.' }, { status: 400 });
  }
  // QB invoice Ids are always plain positive integers — reject anything
  // else outright rather than interpolating it into the QBQL query below.
  if (!qbInvoiceId || !/^\d+$/.test(qbInvoiceId)) {
    return NextResponse.json({ error: 'qbInvoiceId must be a valid QuickBooks invoice id.' }, { status: 400 });
  }
  if (!lines?.length) return NextResponse.json({ error: 'At least one line is required.' }, { status: 400 });
  if (lines.some(line =>
    !line.description?.trim()
    || !Number.isFinite(Number(line.rate))
    || !Number.isFinite(Number(line.qty ?? 1))
    || Number(line.qty ?? 1) <= 0
    || Math.abs(Number(line.rate)) > 10_000_000
  )) {
    return NextResponse.json({ error: 'Every invoice line requires a description, finite rate and positive quantity.' }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Structural gate: this route can only ever touch an invoice the system
  // itself has a creation record for — a manually-created QB invoice has no
  // generated_invoices row and can never reach the QB write below.
  const { data: genInv, error: genErr } = await supabase
    .from('generated_invoices')
    .select('company_name, fye_month, fye_year')
    .eq('qb_company', qbCompany)
    .eq('qb_invoice_id', qbInvoiceId)
    .maybeSingle();
  if (genErr) return NextResponse.json({ error: genErr.message }, { status: 500 });
  if (!genInv) {
    return NextResponse.json({
      error: "This invoice wasn't created by this system — edit it directly in QuickBooks.",
    }, { status: 404 });
  }

  // Sent gate: refuse if any AR email already sent this cycle references
  // this exact invoice (not just "some email went to this company this
  // cycle" — a company can have a TAB invoice already emailed and a
  // separate TAC invoice that isn't, and only the latter should stay
  // editable).
  if (genInv.fye_month && genInv.fye_year) {
    const { data: sentDrafts, error: sentErr } = await supabase
      .from('email_drafts')
      .select('company_name, invoice_refs, email_campaigns!inner(type, fye_month, fye_year)')
      .eq('status', 'sent')
      .eq('email_campaigns.type', 'ar')
      .eq('email_campaigns.fye_month', genInv.fye_month)
      .eq('email_campaigns.fye_year', genInv.fye_year);
    if (sentErr) return NextResponse.json({ error: sentErr.message }, { status: 500 });
    const targetName = normalize(genInv.company_name);
    const alreadySent = (sentDrafts ?? []).some(draft =>
      normalize(draft.company_name) === targetName
      && ((draft.invoice_refs as InvoiceRef[] | null) ?? []).some(ref => ref.qbInvoiceId === qbInvoiceId),
    );
    if (alreadySent) {
      return NextResponse.json({
        alreadySent: true,
        error: 'An AR reminder referencing this invoice has already been sent.',
      }, { status: 403 });
    }
  }

  const tokenRow = await getValidToken(qbCompany);
  if (!tokenRow) return NextResponse.json({ error: `QuickBooks ${qbCompany} not connected` }, { status: 503 });
  const { access_token: token, realm_id: realmId } = tokenRow;

  // Live read: the invoice's current SyncToken (QB's optimistic-concurrency
  // token — required for the sparse update below) and its current
  // Balance/TotalAmt, to refuse an invoice with any payment recorded
  // against it, in any channel this system doesn't track.
  const live = await qbQuery(`SELECT * FROM Invoice WHERE Id = '${qbInvoiceId}'`, qbCompany);
  const invoice = live?.rows?.[0];
  if (!invoice) return NextResponse.json({ error: 'Invoice not found in QuickBooks.' }, { status: 404 });
  const syncToken = String(invoice.SyncToken ?? '');
  const totalAmt = Number(invoice.TotalAmt ?? 0);
  const balance = Number(invoice.Balance ?? 0);
  if (totalAmt === 0 && balance === 0) {
    return NextResponse.json({ error: 'This invoice has been voided in QuickBooks and cannot be edited here.' }, { status: 409 });
  }
  if (balance !== totalAmt) {
    return NextResponse.json({
      error: 'A payment has been recorded against this invoice in QuickBooks; it can no longer be edited here.',
    }, { status: 409 });
  }

  const [itemMap, picClass] = await Promise.all([
    getItemMap(token, realmId),
    qbCompany === 'TAB' && pic ? findPicClass(token, realmId, pic) : Promise.resolve(null),
  ]);
  const invoiceLines = buildInvoiceLineArray(lines, itemMap, picClass);

  // Sparse update — CustomerRef/TxnDate/DocNumber are deliberately never
  // included, so QB can't change them regardless of what's sent here;
  // sparse:true keeps every other field at its current QB value. Line is
  // always fully replaced (QB's own behavior, not a merge).
  const updateUrl = new URL(`${QB_BASE}/v3/company/${realmId}/invoice`);
  updateUrl.searchParams.set('minorversion', '75');
  const updateRes = await fetch(updateUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ Id: qbInvoiceId, SyncToken: syncToken, sparse: true, Line: invoiceLines }),
  });
  if (!updateRes.ok) {
    const errText = await updateRes.text();
    const staleSyncToken = /stale object/i.test(errText);
    return NextResponse.json({
      error: staleSyncToken
        ? 'This invoice changed in QuickBooks since you opened it. Reload and try again.'
        : `QB ${qbCompany} update failed: ${errText.slice(0, 300)}`,
      staleSyncToken,
    }, { status: 409 });
  }

  const updated = await updateRes.json();
  const inv = updated.Invoice ?? {};

  const { error: recordError } = await supabase
    .from('generated_invoices')
    .update({
      total_amt: inv.TotalAmt ?? null,
      services: [...new Set(lines.map(l => l.service))],
    })
    .eq('qb_company', qbCompany)
    .eq('qb_invoice_id', qbInvoiceId);

  // Best-effort — the webhook will independently reconcile the local mirror
  // shortly after regardless; this just avoids the UI waiting on it.
  try {
    await syncQuickBooksInvoiceChanges(qbCompany, new Date(Date.now() - 60_000).toISOString());
  } catch {
    // ignore
  }

  return NextResponse.json({
    success: true,
    invoiceNo: inv.DocNumber,
    qbId: inv.Id,
    total: inv.TotalAmt,
    syncToken: inv.SyncToken,
    persistenceWarning: recordError ? recordError.message : null,
  });
}
