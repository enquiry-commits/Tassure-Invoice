import { NextRequest, NextResponse } from 'next/server';
import { getRequestAccount } from '@/lib/request-account';
import { createAdminClient } from '@/lib/supabase';

export type TurnoverSummary = {
  totals: { currency: string; total: number; count: number }[];
  confirmedItems: { id: number; vendor: string | null; txnDate: string | null; amount: number; currency: string | null; fileName: string | null }[];
  pendingCount: number;
};

// GET /api/turnover-ai/summary?clientName=... — the number Account actually
// reports: only 'confirmed' rows are summed, grouped by currency (never
// converted/combined — see app/turnover-ai/summary/page.tsx). A row's
// edited_* value wins over the AI's own read whenever a human corrected it.
export async function GET(req: NextRequest) {
  const account = await getRequestAccount(req);
  if (!account) return NextResponse.json({ error: 'Approved login account required' }, { status: 401 });
  if (!account.canViewTurnoverAI) return NextResponse.json({ error: 'Your account cannot use Turnover AI.' }, { status: 403 });

  const clientName = new URL(req.url).searchParams.get('clientName');
  if (!clientName) return NextResponse.json({ error: 'clientName is required.' }, { status: 400 });

  const supabase = createAdminClient();
  const { data: docs, error: docsErr } = await supabase.from('turnover_documents').select('id').eq('client_name', clientName);
  if (docsErr) return NextResponse.json({ error: docsErr.message }, { status: 500 });
  const docIds = (docs ?? []).map(d => d.id);
  if (!docIds.length) return NextResponse.json({ totals: [], confirmedItems: [], pendingCount: 0 } satisfies TurnoverSummary);

  const { data: items, error: itemsErr } = await supabase.from('turnover_line_items')
    .select('*, turnover_documents(file_name)').in('document_id', docIds);
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });

  const confirmed = (items ?? []).filter(i => i.review_status === 'confirmed');
  const pendingCount = (items ?? []).filter(i => i.review_status === 'unconfirmed').length;

  const totalsByCurrency = new Map<string, { total: number; count: number }>();
  for (const i of confirmed) {
    const currency = i.edited_currency ?? i.currency ?? 'Unknown';
    const amount = Number(i.edited_amount ?? i.amount ?? 0);
    const entry = totalsByCurrency.get(currency) ?? { total: 0, count: 0 };
    entry.total += amount;
    entry.count += 1;
    totalsByCurrency.set(currency, entry);
  }

  const summary: TurnoverSummary = {
    totals: [...totalsByCurrency.entries()].map(([currency, v]) => ({ currency, total: Math.round(v.total * 100) / 100, count: v.count })),
    confirmedItems: confirmed.map(i => ({
      id: i.id,
      vendor: i.edited_vendor_name ?? i.vendor_name,
      txnDate: i.edited_txn_date ?? i.txn_date,
      amount: Number(i.edited_amount ?? i.amount ?? 0),
      currency: i.edited_currency ?? i.currency,
      fileName: (i.turnover_documents as { file_name?: string } | null)?.file_name ?? null,
    })).sort((a, b) => (a.txnDate ?? '').localeCompare(b.txnDate ?? '')),
    pendingCount,
  };
  return NextResponse.json(summary);
}
