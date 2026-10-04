import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { qbQuery } from '@/lib/quickbooks';

// GET /api/billing/tao/service-history?companyName=... — every DISTINCT
// product/service this company has ever been billed under a real TAO
// invoice, most recent occurrence of each. Vincent, 2026-09-05: "不管周期，
// 是判断之前开过的所有服务，然后用户才来自己打勾自己要开的单" — deliberately
// NOT a due-date/period-rolling mechanism like TAB/TAC's renewal cycle (no
// periodicity data model exists for Accounts/Tax services) — just surface
// what this company has been billed for before, as candidates ACC ticks on
// or off, prefilled with the last known rate/description as a starting point.
export interface TaoServiceHistoryItem {
  productService: string;
  service: string;
  description: string | null;
  rate: number | null;
  qty: number | null;
  lastInvoiceNo: string;
  lastTxnDate: string | null;
  // The PIC (QuickBooks Class) that most recent line carried — restored as
  // the line's starting PIC (lib/invoice-pic-class.ts taoDefaultPicName).
  picClassName: string | null;
}

// 2026-10-04 (Vincent: "尽量还原QB本来有的设定"): besides each service's
// last line, the builder restores two more QuickBooks settings every
// hand-made TAO invoice has — the client's current PIC per service, and the
// invoice's Statement memo (QuickBooks' PrivateNote, e.g. "Yearly
// accounting services,Compilation report,Tax YA 2027"; on all 60 latest
// hand-made TAO invoices).
export interface TaoServiceHistory {
  services: TaoServiceHistoryItem[];
  /** Most recent non-empty Class per service type ("Accounts", "Tax"). */
  picByService: Record<string, string>;
  /** The client's most recent TAO invoice's Statement memo — read live; null if none / unreadable. */
  lastStatementMemo: { text: string; invoiceNo: string } | null;
}

export async function GET(req: NextRequest) {
  const companyName = req.nextUrl.searchParams.get('companyName')?.trim();
  if (!companyName) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });

  const supabase = createAdminClient();
  const target = normalize(companyName);

  const items = await pageAll(() => supabase
    .from('quickbooks_invoice_items')
    .select('customer_name, invoice_no, qb_invoice_id, txn_date, product_service, description, service_type, rate, qty, class_name')
    .eq('qb_company', 'TAO')
    .order('txn_date', { ascending: false })
    .order('invoice_no', { ascending: true })
    .order('line_num', { ascending: true })) as Array<{
      customer_name: string; invoice_no: string; qb_invoice_id: string | null; txn_date: string | null;
      product_service: string | null; description: string | null; service_type: string;
      rate: number | null; qty: number | null; class_name: string | null;
    }>;

  const byName = new Map<string, typeof items>();
  for (const item of items) {
    const key = normalize(item.customer_name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(item);
  }

  let matched = byName.get(target);
  if (!matched) {
    const match = findUniqueBestMatch(companyName, [...byName.entries()], entry => entry[0], 70);
    matched = match.value?.[1];
  }
  if (!matched) return NextResponse.json({ services: [], picByService: {}, lastStatementMemo: null } satisfies TaoServiceHistory);

  // Rows are already ordered most-recent-first — first occurrence of each
  // distinct product_service wins; likewise the first Class seen per service.
  const byProduct = new Map<string, TaoServiceHistoryItem>();
  const picByService: Record<string, string> = {};
  for (const item of matched) {
    if (item.class_name && !picByService[item.service_type]) picByService[item.service_type] = item.class_name;
    const key = item.product_service ?? item.description ?? '';
    if (!key || byProduct.has(key)) continue;
    byProduct.set(key, {
      productService: item.product_service ?? '',
      service: item.service_type,
      description: item.description,
      rate: item.rate,
      qty: item.qty,
      lastInvoiceNo: item.invoice_no,
      lastTxnDate: item.txn_date,
      picClassName: item.class_name ?? null,
    });
  }

  // The Statement memo isn't mirrored locally, so read the latest invoice
  // live. Best-effort: a QuickBooks hiccup only means no pre-filled memo.
  let lastStatementMemo: TaoServiceHistory['lastStatementMemo'] = null;
  const latestId = matched[0]?.qb_invoice_id;
  if (latestId && /^\d+$/.test(String(latestId))) {
    try {
      const live = await qbQuery(`SELECT * FROM Invoice WHERE Id = '${latestId}'`, 'TAO');
      const note = String((live?.rows?.[0] as { PrivateNote?: string } | undefined)?.PrivateNote ?? '').trim();
      if (note) lastStatementMemo = { text: note, invoiceNo: matched[0].invoice_no };
    } catch {
      // leave null
    }
  }

  const services = [...byProduct.values()].sort((a, b) => (b.lastTxnDate ?? '').localeCompare(a.lastTxnDate ?? ''));
  return NextResponse.json({ services, picByService, lastStatementMemo } satisfies TaoServiceHistory);
}
