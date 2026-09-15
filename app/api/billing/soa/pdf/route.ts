import { todaySGT } from '@/lib/date';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument } from 'pdf-lib';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';

const QB_BASE = process.env.QB_ENVIRONMENT === 'sandbox'
  ? 'https://sandbox-quickbooks.api.intuit.com'
  : 'https://quickbooks.api.intuit.com';

async function fetchInvoicePdf(company: QbCompany, invoiceId: string): Promise<ArrayBuffer> {
  const token = await getValidToken(company);
  if (!token) throw new Error(`QuickBooks ${company} not connected`);
  const res = await fetch(`${QB_BASE}/v3/company/${token.realm_id}/invoice/${invoiceId}/pdf?minorversion=65`, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/pdf' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`QuickBooks ${company} PDF request failed for invoice ${invoiceId}`);
  return res.arrayBuffer();
}

// Same pattern as fetchInvoicePdf, QuickBooks' own symmetric endpoint for a
// CreditMemo's official PDF. Added 2026-09-15 so an unapplied Credit Note
// merges into the same statement as its own real, official QuickBooks
// document — not a number we computed ourselves — the client sees exactly
// what QuickBooks itself would show. See docs/INVARIANTS.md.
async function fetchCreditMemoPdf(company: QbCompany, creditMemoId: string): Promise<ArrayBuffer> {
  const token = await getValidToken(company);
  if (!token) throw new Error(`QuickBooks ${company} not connected`);
  const res = await fetch(`${QB_BASE}/v3/company/${token.realm_id}/creditmemo/${creditMemoId}/pdf?minorversion=65`, {
    headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/pdf' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`QuickBooks ${company} PDF request failed for credit memo ${creditMemoId}`);
  return res.arrayBuffer();
}

const QB_COMPANIES: QbCompany[] = ['TAB', 'TAC', 'TAO'];

// GET /api/billing/soa/pdf?companyName=...&company=TAB|TAC|TAO — Vincent,
// 2026-09-05: "关于那个PDF合并是存在的，只是每次都是要CHELSEA自己一张一张的
// 合并成一个PDF内，其实也花费了大量的时间" — this is that exact manual step,
// automated. Fetches every real unpaid invoice's PDF for the company IN ONE
// QuickBooks system (same `company` scoping as /api/billing/soa/detail, see
// its comment) and merges every page into one PDF.
export async function GET(req: NextRequest) {
  const companyName = req.nextUrl.searchParams.get('companyName')?.trim();
  if (!companyName) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });
  const company = req.nextUrl.searchParams.get('company') as QbCompany | null;
  if (!company || !QB_COMPANIES.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO' }, { status: 400 });
  }

  const supabase = createAdminClient();
  const target = normalize(companyName);

  const [invoices, creditMemos] = await Promise.all([
    pageAll(() => supabase
      .from('quickbooks_invoices')
      .select('customer_name, qb_company, qb_invoice_id, invoice_no, txn_date, balance')
      .eq('qb_company', company)
      .gt('balance', 0)) as Promise<Array<{
        customer_name: string; qb_company: string; qb_invoice_id: string; invoice_no: string; txn_date: string | null;
      }>>,
    // Unapplied CreditMemos — merged into the same PDF as their own real
    // QuickBooks document, see fetchCreditMemoPdf's comment.
    pageAll(() => supabase
      .from('quickbooks_credit_memos')
      .select('customer_name, qb_company, qb_credit_memo_id, doc_number, txn_date, balance')
      .eq('qb_company', company)
      .gt('balance', 0)) as Promise<Array<{
        customer_name: string; qb_company: string; qb_credit_memo_id: string; doc_number: string | null; txn_date: string | null;
      }>>,
  ]);

  const byName = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const key = normalize(inv.customer_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(inv);
  }
  const creditByName = new Map<string, typeof creditMemos>();
  for (const cm of creditMemos) {
    const key = normalize(cm.customer_name);
    if (!key) continue;
    if (!creditByName.has(key)) creditByName.set(key, []);
    creditByName.get(key)!.push(cm);
  }

  let matched = byName.get(target);
  if (!matched) {
    const match = findUniqueBestMatch(companyName, [...byName.entries()], entry => entry[0], 70);
    matched = match.value?.[1];
  }
  let matchedCredits = creditByName.get(target);
  if (!matchedCredits) {
    const match = findUniqueBestMatch(companyName, [...creditByName.entries()], entry => entry[0], 70);
    matchedCredits = match.value?.[1];
  }
  if ((!matched || !matched.length) && (!matchedCredits || !matchedCredits.length)) {
    return NextResponse.json({ error: `No outstanding invoices found for "${companyName}".` }, { status: 404 });
  }
  matched = matched ?? [];
  matchedCredits = matchedCredits ?? [];

  // Oldest first, so the statement reads like a running account, same order
  // the detail view sorts by. Invoices and credit notes are interleaved by
  // date, not grouped, so the merged PDF reads as one chronological account.
  type MergeItem = { qbCompany: string; docLabel: string; txnDate: string | null; kind: 'invoice' | 'credit'; id: string };
  const mergeItems: MergeItem[] = [
    ...matched.map(inv => ({ qbCompany: inv.qb_company, docLabel: inv.invoice_no, txnDate: inv.txn_date, kind: 'invoice' as const, id: inv.qb_invoice_id })),
    ...matchedCredits.map(cm => ({ qbCompany: cm.qb_company, docLabel: cm.doc_number ?? cm.qb_credit_memo_id, txnDate: cm.txn_date, kind: 'credit' as const, id: cm.qb_credit_memo_id })),
  ].sort((a, b) => (a.txnDate ?? '').localeCompare(b.txnDate ?? ''));

  const merged = await PDFDocument.create();
  const errors: string[] = [];
  for (const item of mergeItems) {
    try {
      const buf = item.kind === 'invoice'
        ? await fetchInvoicePdf(item.qbCompany as QbCompany, item.id)
        : await fetchCreditMemoPdf(item.qbCompany as QbCompany, item.id);
      const src = await PDFDocument.load(buf);
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) merged.addPage(page);
    } catch (err) {
      errors.push(`${item.qbCompany} #${item.docLabel}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (merged.getPageCount() === 0) {
    return NextResponse.json({ error: `Could not fetch any invoice PDFs. ${errors.join(' ')}` }, { status: 502 });
  }

  const bytes = Buffer.from(await merged.save());
  const fileName = `SOA - ${companyName} - ${todaySGT()}.pdf`;
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${fileName.replace(/"/g, "'")}"`,
      'Content-Length': String(bytes.byteLength),
      'Cache-Control': 'private, no-store',
      // Surfaced so the UI can warn if some (but not all) invoices failed to
      // merge, without failing the whole download.
      'X-Soa-Merge-Errors': String(errors.length),
    },
  });
}
