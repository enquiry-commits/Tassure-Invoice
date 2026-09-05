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

// GET /api/billing/soa/pdf?companyName=... — Vincent, 2026-09-05: "关于那个
// PDF合并是存在的，只是每次都是要CHELSEA自己一张一张的合并成一个PDF内，其实
// 也花费了大量的时间" — this is that exact manual step, automated. Fetches
// every real unpaid invoice's PDF for the company (across TAB/TAC/TAO, same
// source as /api/billing/soa/detail) and merges every page into one PDF.
export async function GET(req: NextRequest) {
  const companyName = req.nextUrl.searchParams.get('companyName')?.trim();
  if (!companyName) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });

  const supabase = createAdminClient();
  const target = normalize(companyName);

  const invoices = await pageAll(() => supabase
    .from('quickbooks_invoices')
    .select('customer_name, qb_company, qb_invoice_id, invoice_no, txn_date, balance')
    .gt('balance', 0)) as Array<{
      customer_name: string; qb_company: string; qb_invoice_id: string; invoice_no: string; txn_date: string | null;
    }>;

  const byName = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const key = normalize(inv.customer_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(inv);
  }
  let matched = byName.get(target);
  if (!matched) {
    const match = findUniqueBestMatch(companyName, [...byName.entries()], entry => entry[0], 70);
    matched = match.value?.[1];
  }
  if (!matched || !matched.length) return NextResponse.json({ error: `No outstanding invoices found for "${companyName}".` }, { status: 404 });

  // Oldest first, so the statement reads like a running account, same order
  // the detail view sorts by.
  matched.sort((a, b) => (a.txn_date ?? '').localeCompare(b.txn_date ?? ''));

  const merged = await PDFDocument.create();
  const errors: string[] = [];
  for (const inv of matched) {
    try {
      const buf = await fetchInvoicePdf(inv.qb_company as QbCompany, inv.qb_invoice_id);
      const src = await PDFDocument.load(buf);
      const pages = await merged.copyPages(src, src.getPageIndices());
      for (const page of pages) merged.addPage(page);
    } catch (err) {
      errors.push(`${inv.qb_company} #${inv.invoice_no}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (merged.getPageCount() === 0) {
    return NextResponse.json({ error: `Could not fetch any invoice PDFs. ${errors.join(' ')}` }, { status: 502 });
  }

  const bytes = Buffer.from(await merged.save());
  const fileName = `SOA - ${companyName} - ${new Date().toISOString().slice(0, 10)}.pdf`;
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
