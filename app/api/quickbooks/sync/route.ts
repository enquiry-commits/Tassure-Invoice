import { NextRequest, NextResponse } from 'next/server';
import { qbQuery } from '@/lib/quickbooks';
import { createAdminClient } from '@/lib/supabase';

// ── Service classification (mirrors scrape-qb-line-items.js) ─────────────────
const SERVICE_PATTERNS = [
  { type: 'AR',        kw: ['annual return', 'ar filing', 'ar fee', 'a/r filing', 'acra annual', 'government fee for acra', 'government fee of'] },
  { type: 'AGM',       kw: ['agm', 'annual general meeting'] },
  { type: 'XBRL',      kw: ['xbrl', 'ixbrl', 'tagged financial'] },
  { type: 'Address',   kw: ['registered address', 'reg address', 'virtual office', 'address service', 'registered office'] },
  { type: 'ND',        kw: ['nominee director', 'nd service', 'nd fee', 'local director', 'resident director'] },
  { type: 'Secretary', kw: ['secretarial', 'secretary', 'corp sec', 'statutory', 'board resolution', 'share allot', 'share transfer', 'change of director', 'change of officer'] },
  { type: 'Accounts',  kw: ['bookkeeping', 'accounts preparation', 'management accounts', 'unaudited', 'financial statement', 'accounting fee', 'compilation'] },
  { type: 'Tax',       kw: ['tax return', 'tax filing', 'income tax', 'iras', 'form c', 'form cs', 'gst return', 'tax computation', 'corporate tax', 'eci'] },
  { type: 'Audit',     kw: ['audit', 'statutory audit', 'auditor'] },
  { type: 'Deferred',  kw: ['deferred revenue'] },
];

function classify(desc: string, product: string): string {
  const t = `${desc || ''} ${product || ''}`.toLowerCase();
  for (const { type, kw } of SERVICE_PATTERNS) {
    if (kw.some(k => t.includes(k))) return type;
  }
  return 'Other';
}

// ── Period date parser (mirrors parse-qb-periods.js) ─────────────────────────
const MONTH_MAP: Record<string, number> = {
  jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12,
};
function monthNum(s: string) { return MONTH_MAP[s.toLowerCase().slice(0,3)] ?? null; }
function lastDay(y: number, m: number) { return new Date(y, m, 0).getDate(); }
function toISO(y: number, m: number, d?: number) {
  const day = d ?? lastDay(y, m);
  return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

const M = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const PERIOD_PATTERNS = [
  // [from Apr 2026 - Mar 2027]  or  (Apr 2026 - Mar 2027)
  new RegExp(`[\\[(]\\s*(?:from\\s+)?(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s*[-–]\\s*(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s*[\\])]`, 'i'),
  // [from Apr 2026 to Mar 2027]
  new RegExp(`[\\[(]\\s*(?:from\\s+)?(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s+to\\s+(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s*[\\])]`, 'i'),
  // [from May 2026 Apr 2027]  or  (May 2026 Apr 2027) — no separator
  new RegExp(`[\\[(]\\s*(?:from\\s+)?(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s+(?:\\d{1,2}\\s+)?${M}\\s+(\\d{4})\\s*[\\])]`, 'i'),
  // single-year: (Jan - Dec 2026)
  new RegExp(`[\\[(]\\s*(?:from\\s+)?${M}\\s*-\\s*${M}\\s+(\\d{4})\\s*[\\])]`, 'i'),
];
const FYE_PATTERNS = [
  /[[【](?:FYE\s*|YE\s*)(\d{1,2})[.\s](\d{1,2})[.\s](\d{4})[\]】]/i,
  new RegExp(`[\\[\\u3010](?:FYE\\s*|YE\\s*)(\\d{1,2})\\s+${M}\\s+(\\d{4})[\\]\\u3011]`, 'i'),
  /FYE\s*(\d{1,2})[.\s](\d{1,2})[.\s](\d{4})/i,
];

function parsePeriod(raw: string | null): { period_start?: string; period_end?: string; fye_date?: string } | null {
  if (!raw) return null;
  const desc = raw.replace(/[【［]/g,'[').replace(/[】］]/g,']').replace(/\s+/g,' ');

  for (const re of PERIOD_PATTERNS) {
    const m = re.exec(desc);
    if (!m) continue;
    // single-year pattern has 3 captures, others have 4
    if (m.length === 4) {
      const mn1 = monthNum(m[1]), mn2 = monthNum(m[2]), y = +m[3];
      if (!mn1 || !mn2) continue;
      const sy = mn1 > mn2 ? y - 1 : y;
      return { period_start: toISO(sy, mn1, 1), period_end: toISO(y, mn2) };
    }
    const mn1 = monthNum(m[1]), mn2 = monthNum(m[3]);
    if (!mn1 || !mn2) continue;
    return { period_start: toISO(+m[2], mn1, 1), period_end: toISO(+m[4], mn2) };
  }
  for (const re of FYE_PATTERNS) {
    const m = re.exec(desc);
    if (!m) continue;
    if (m.length === 4 && !isNaN(+m[2])) return { fye_date: toISO(+m[3], +m[2], +m[1]) };
    const mn = monthNum(m[2]);
    if (mn) return { fye_date: toISO(+m[3], mn, +m[1]) };
  }
  return null;
}

// ── POST /api/quickbooks/sync ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { year = new Date().getFullYear().toString() } = await req.json().catch(() => ({}));

  // QB caps a query at 1000 results; page with STARTPOSITION so a year with
  // more than 1000 invoices doesn't silently lose the overflow.
  const PAGE = 1000;
  let allRows: Record<string, unknown>[] = [];
  let realmSeen = false;
  for (let start = 1; ; start += PAGE) {
    const page = await qbQuery(
      `SELECT * FROM Invoice WHERE TxnDate >= '${year}-01-01' AND TxnDate <= '${year}-12-31' STARTPOSITION ${start} MAXRESULTS ${PAGE}`
    );
    if (!page) {
      if (!realmSeen) return NextResponse.json({ error: 'QuickBooks not connected or token expired' }, { status: 401 });
      break;
    }
    realmSeen = true;
    allRows = allRows.concat(page.rows);
    if (page.rows.length < PAGE) break;
  }
  const result = { rows: allRows };

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const invoiceRows: Record<string, unknown>[] = [];
  const itemRows:    Record<string, unknown>[] = [];

  for (const inv of result.rows) {
    const customer = (inv.CustomerRef as Record<string, unknown>) ?? {};
    const docNo    = inv.DocNumber as string;
    const txnDate  = inv.TxnDate  as string;
    const balance  = inv.Balance  as number;

    invoiceRows.push({
      invoice_no:    docNo,
      customer_name: (customer.name as string) ?? '',
      txn_date:      txnDate,
      total_amt:     inv.TotalAmt ?? 0,
      balance,
      status:        balance === 0 ? 'Paid' : 'Open',
      scraped_at:    now,
    });

    const lines = (inv.Line as Record<string, unknown>[]) ?? [];
    let lineNum = 0;
    for (const line of lines) {
      if (line.DetailType !== 'SalesItemLineDetail') continue;
      lineNum++;
      const detail  = (line.SalesItemLineDetail as Record<string, unknown>) ?? {};
      const itemRef = (detail.ItemRef as Record<string, unknown>) ?? {};
      const product = (itemRef.name as string) ?? '';
      const desc    = (line.Description as string) ?? '';
      const parsed  = parsePeriod(desc) ?? {};

      itemRows.push({
        invoice_no:      docNo,
        qb_invoice_id:   String(inv.Id),
        customer_name:   (customer.name as string) ?? '',
        txn_date:        txnDate,
        line_num:        lineNum,
        description:     desc || null,
        product_service: product || null,
        qty:             (detail.Qty as number) ?? null,
        rate:            (detail.UnitPrice as number) ?? null,
        amount:          (line.Amount as number) ?? null,
        service_type:    classify(desc, product),
        period_start:    parsed.period_start ?? null,
        period_end:      parsed.period_end   ?? null,
        fye_date:        parsed.fye_date     ?? null,
        scraped_at:      now,
      });
    }
  }

  // Upsert invoices
  const { error: invErr } = await supabase
    .from('quickbooks_invoices')
    .upsert(invoiceRows as Parameters<typeof supabase.from>[0] extends never ? never : never[], { onConflict: 'invoice_no' });

  // Upsert line items in batches of 200
  let itemsDone = 0, itemsErr = 0;
  for (let i = 0; i < itemRows.length; i += 200) {
    const { error } = await supabase
      .from('quickbooks_invoice_items')
      .upsert(itemRows.slice(i, i + 200) as Parameters<typeof supabase.from>[0] extends never ? never : never[], { onConflict: 'invoice_no,line_num' });
    if (error) itemsErr += Math.min(200, itemRows.length - i);
    else       itemsDone += Math.min(200, itemRows.length - i);
  }

  return NextResponse.json({
    year,
    invoices_synced: invoiceRows.length,
    items_synced:    itemsDone,
    items_error:     itemsErr,
    invoice_error:   invErr?.message ?? null,
  });
}
