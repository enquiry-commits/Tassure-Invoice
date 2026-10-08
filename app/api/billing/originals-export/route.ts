import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { todaySGT } from '@/lib/date';
import { getApprovedAccount, type ApprovedAccount } from '@/lib/approved-accounts';
import { EXPORT_BOOKS, canExportOriginals, isMonth, monthRange, previousMonth, type ExportBook, type ExportInvoice } from '@/lib/originals-export';

// Monthly originals export (INV-QB-040): Vincent and Chelsea only.
//   GET  ?month=YYYY-MM  — the invoices dated in that month per book (the browser then fetches each original from
//                          /api/billing/invoice-original and builds the ZIPs), plus which books were already exported.
//   GET  ?status=1       — whether last month's three ZIPs were all made (the My Tasks reminder).
//   POST {month, book, invoiceCount, missingCount} — records that a book's ZIP was made. No PDFs are stored.
export const dynamic = 'force-dynamic';
export const preferredRegion = 'sin1';

type Exported = { qb_company: ExportBook; invoice_count: number; missing_count: number; exported_by_email: string | null; exported_at: string };

async function account(req: NextRequest): Promise<ApprovedAccount | null> {
  const auth = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => req.cookies.getAll(), setAll: () => undefined } },
  );
  const { data } = await auth.auth.getUser();
  return getApprovedAccount(data.user?.email);
}

const isMissingTable = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '42P01' || error.code === 'PGRST205' || /originals_exports.*(does not exist|schema cache)/i.test(error.message ?? ''));

async function loadExported(month: string): Promise<{ ready: boolean; rows: Exported[] }> {
  const { data, error } = await createAdminClient().from('originals_exports')
    .select('qb_company, invoice_count, missing_count, exported_by_email, exported_at').eq('month', month);
  if (error) {
    if (isMissingTable(error)) return { ready: false, rows: [] };
    throw new Error(error.message);
  }
  return { ready: true, rows: (data ?? []) as Exported[] };
}

export async function GET(req: NextRequest) {
  const me = await account(req);
  if (!me) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!canExportOriginals(me.email)) return NextResponse.json({ error: 'Only Vincent and Chelsea can export originals.' }, { status: 403 });

  try {
    if (req.nextUrl.searchParams.get('status')) {
      const month = previousMonth(todaySGT());
      const exported = await loadExported(month);
      const done = EXPORT_BOOKS.filter(b => exported.rows.some(r => r.qb_company === b));
      return NextResponse.json({ month, done, pending: EXPORT_BOOKS.filter(b => !done.includes(b)), ready: exported.ready });
    }

    const month = req.nextUrl.searchParams.get('month') ?? '';
    if (!isMonth(month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    const { from, to } = monthRange(month);
    const supabase = createAdminClient();
    // pageAll() swallows query errors — probe with an error-returning head count and verify the load against it.
    const probe = await supabase.from('quickbooks_invoices').select('*', { count: 'exact', head: true }).gte('txn_date', from).lte('txn_date', to);
    if (probe.error) return NextResponse.json({ error: probe.error.message }, { status: 503 });
    const loaded = (await pageAll(() => supabase.from('quickbooks_invoices')
      .select('id, qb_company, qb_invoice_id, invoice_no, txn_date, customer_name, total_amt, status')
      .gte('txn_date', from).lte('txn_date', to))) as Array<{ id: number; qb_company: string; qb_invoice_id: string; invoice_no: string | null; txn_date: string | null; customer_name: string | null; total_amt: number | null; status: string | null }>;
    if (new Set(loaded.map(r => r.id)).size !== (probe.count ?? 0)) {
      return NextResponse.json({ error: `Invoice data incomplete: loaded ${new Set(loaded.map(r => r.id)).size} of ${probe.count}. Try again.` }, { status: 503 });
    }
    const invoices: ExportInvoice[] = loaded
      .filter(r => r.qb_company === 'TAB' || r.qb_company === 'TAC' || r.qb_company === 'TAO')
      .map(r => ({
        book: r.qb_company as ExportBook, qbInvoiceId: r.qb_invoice_id, invoiceNo: r.invoice_no ?? r.qb_invoice_id,
        txnDate: r.txn_date, customerName: r.customer_name ?? '', totalAmt: Number(r.total_amt ?? 0), status: r.status ?? 'Open',
      }))
      .sort((a, b) => (a.txnDate ?? '').localeCompare(b.txnDate ?? '') || a.invoiceNo.localeCompare(b.invoiceNo, undefined, { numeric: true }));
    const exported = await loadExported(month);
    return NextResponse.json({ month, invoices, exported: exported.rows, recordReady: exported.ready });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const me = await account(req);
  if (!me) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!canExportOriginals(me.email)) return NextResponse.json({ error: 'Only Vincent and Chelsea can export originals.' }, { status: 403 });
  const body = await req.json().catch(() => ({})) as { month?: string; book?: string; invoiceCount?: number; missingCount?: number };
  if (!isMonth(body.month)) return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
  if (!EXPORT_BOOKS.includes(body.book as ExportBook)) return NextResponse.json({ error: 'book must be TAB, TAC or TAO' }, { status: 400 });
  const { error } = await createAdminClient().from('originals_exports').upsert({
    month: body.month, qb_company: body.book,
    invoice_count: Math.max(0, Math.trunc(Number(body.invoiceCount) || 0)), missing_count: Math.max(0, Math.trunc(Number(body.missingCount) || 0)),
    exported_by_email: me.email, exported_at: new Date().toISOString(),
  }, { onConflict: 'month,qb_company' });
  if (error) {
    return NextResponse.json({ error: isMissingTable(error) ? 'Export record storage is not installed yet. Run scripts/add-originals-exports.sql in Supabase.' : error.message }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
