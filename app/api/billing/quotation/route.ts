import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { loadLiveQuotations, loadQuotationData, QuotationDataError } from '@/lib/quotation-data';
import { createAdminClient } from '@/lib/supabase';
import { canComplete, cleanRemarks } from '@/lib/quotation-reviews';

export type { QuotationData, QuotationBookStatus } from '@/lib/quotation-data';
export type { QuotationRow, QuotationTraceInvoice, QuotationStatusGroup } from '@/lib/quotation-trace';
export type { QuotationRowView, QuotationReview } from '@/lib/quotation-reviews';

// GET /api/billing/quotation — backs app/billing/quotation/page.tsx: every
// QuickBooks Estimate ("Quotation") across TAB/TAC/TAO, read live, and — for a
// Closed one — which book(s) its invoice(s) were issued in. Gated on
// canViewQuotation (Vincent-only for now): proxy.ts guards the PAGE path, but
// never API routes by permission, so this route must check for itself.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const preferredRegion = 'sin1';

export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewQuotation) return NextResponse.json({ error: 'Your account cannot view quotations.' }, { status: 403 });

  try {
    const data = await loadQuotationData();
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: err instanceof QuotationDataError ? 503 : 500 });
  }
}

// PATCH /api/billing/quotation — the Remarks box and the Completed / Reopen buttons
// (table: scripts/add-quotation-reviews.sql, rules: lib/quotation-reviews.ts).
//   { book, estimateId, action: 'remarks', remarks }  any PI, any time, completed or not
//   { book, estimateId, action: 'complete' }          a Closed PI only; the server re-reads QuickBooks and freezes
//                                                     the trace exactly as it is NOW (the client sends no snapshot)
//   { book, estimateId, action: 'reopen' }            back to the main list and live matching; remarks are kept
export async function PATCH(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewQuotation) return NextResponse.json({ error: 'Your account cannot change quotations.' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as { book?: string; estimateId?: string; action?: string; remarks?: unknown };
  const { book, estimateId, action } = body;
  if (book !== 'TAB' && book !== 'TAC' && book !== 'TAO') return NextResponse.json({ error: 'book must be TAB, TAC or TAO' }, { status: 400 });
  if (!estimateId || typeof estimateId !== 'string') return NextResponse.json({ error: 'estimateId is required' }, { status: 400 });

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const fail = (error: { message: string; code?: string } | null) => {
    const missing = error?.code === '42P01' || error?.code === 'PGRST205' || /quotation_reviews/i.test(error?.message ?? '');
    return NextResponse.json({ error: missing ? 'Quotation Completed/Remarks storage is not installed yet. Run scripts/add-quotation-reviews.sql in Supabase.' : (error?.message ?? 'Save failed') }, { status: 503 });
  };

  try {
    if (action === 'remarks') {
      const remarks = cleanRemarks(body.remarks);
      const { error } = await supabase.from('quotation_reviews').upsert({
        qb_company: book, qb_estimate_id: estimateId, remarks, remarks_updated_at: now, remarks_updated_by_email: account.email, updated_at: now,
      }, { onConflict: 'qb_company,qb_estimate_id' });
      if (error) return fail(error);
      return NextResponse.json({ ok: true, remarks });
    }

    if (action === 'complete') {
      const live = await loadLiveQuotations();
      const row = live.rows.find(r => r.source === book && r.qbEstimateId === estimateId);
      if (!row) return NextResponse.json({ error: 'That quotation is not in the current list (older than 12 months, or not found in QuickBooks).' }, { status: 404 });
      if (!canComplete(row)) return NextResponse.json({ error: 'Only a Closed quotation can be marked Completed.' }, { status: 409 });
      const { error } = await supabase.from('quotation_reviews').upsert({
        qb_company: book, qb_estimate_id: estimateId, doc_number: row.docNumber, txn_date: row.txnDate,
        completed_at: now, completed_by_email: account.email, completed_trace: row.trace, updated_at: now,
      }, { onConflict: 'qb_company,qb_estimate_id' });
      if (error) return fail(error);
      return NextResponse.json({ ok: true, completedAt: now, completedBy: account.email });
    }

    if (action === 'reopen') {
      const { error } = await supabase.from('quotation_reviews')
        .update({ completed_at: null, completed_by_email: null, completed_trace: null, updated_at: now })
        .eq('qb_company', book).eq('qb_estimate_id', estimateId);
      if (error) return fail(error);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'action must be remarks, complete or reopen' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: err instanceof QuotationDataError ? 503 : 400 });
  }
}
