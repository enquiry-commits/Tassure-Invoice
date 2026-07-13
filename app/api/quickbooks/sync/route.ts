import { NextRequest, NextResponse } from 'next/server';
import { qbQuery, type QbCompany } from '@/lib/quickbooks';
import { createAdminClient } from '@/lib/supabase';

// ── Service classification ───────────────────────────────────────────────────
// The QB Product/Service item name is authoritative — classify by it FIRST.
// Description keywords are only a fallback for lines without a mapped item.
// (The old description-first classifier mislabelled 30% of Secretary retainer
// lines as AR, because the standard retainer wording contains "…submitting the
// prescribed Annual Return as required by the Act…".)
const PRODUCT_MAP: { type: string; match: string[] }[] = [
  { type: 'Deferred',  match: ['deferred revenue'] },           // check first: "Deferred Revenue - Corp Sec" etc.
  { type: 'Secretary', match: ['corporate secretarial services', 'secretary fees - offshore'] },
  { type: 'Address',   match: ['registered address services'] },
  { type: 'ND',        match: ['nominee director fees', 'nominee director deposit', 'nominee shareholder fees'] },
  { type: 'AR',        match: ['government fee for filing annual return'] },
  { type: 'XBRL',      match: ['company xbrl services'] },
  { type: 'Accounts',  match: ['yearly accounts services', 'monthly accounts services', 'compilation services'] },
  { type: 'Tax',       match: ['corporate tax services', 'personal income tax services', 'other tax services', 'application for waiver of income tax'] },
];

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
  const p = (product || '').toLowerCase();
  for (const { type, match } of PRODUCT_MAP) {
    if (match.some(m => p.includes(m))) return type;
  }
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

export const maxDuration = 300; // full-year sync pages through 1500+ invoices (~40s)

// ── GET /api/quickbooks/sync — daily Vercel cron ─────────────────────────────
// Keeps invoice history fresh so billing drafts always see the latest "prior
// invoice" and billed-cycle markers. Syncs the current AND previous year (the
// prior year still matters to the 18–24-month lookback windows, and December
// invoices keep being edited into January) for BOTH QB companies — TAB
// (basic services) and TAC (Nominee Director only). TAC is skipped silently
// (reported, not fatal) until it's connected.
export async function GET() {
  const thisYear = new Date().getFullYear();
  const results: Record<string, unknown>[] = [];
  for (const company of ['TAB', 'TAC'] as QbCompany[]) {
    for (const year of [String(thisYear - 1), String(thisYear)]) {
      const res = await syncYear(year, company);
      results.push({ company, year, ...res });
    }
  }
  return NextResponse.json({ ok: true, results });
}

// ── POST /api/quickbooks/sync ─────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { year = new Date().getFullYear().toString(), company = 'TAB' } = await req.json().catch(() => ({}));
  const qbCompany: QbCompany = company === 'TAC' ? 'TAC' : 'TAB';
  const result = await syncYear(String(year), qbCompany);
  return NextResponse.json({ year, company: qbCompany, ...result });
}

async function syncYear(year: string, company: QbCompany) {

  // QB caps a query at 1000 results; page with STARTPOSITION so a year with
  // more than 1000 invoices doesn't silently lose the overflow.
  const PAGE = 1000;
  let allRows: Record<string, unknown>[] = [];
  let realmSeen = false;
  for (let start = 1; ; start += PAGE) {
    const page = await qbQuery(
      `SELECT * FROM Invoice WHERE TxnDate >= '${year}-01-01' AND TxnDate <= '${year}-12-31' STARTPOSITION ${start} MAXRESULTS ${PAGE}`,
      company
    );
    if (!page) {
      if (!realmSeen) return { error: `QuickBooks ${company} not connected or token expired` };
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
      qb_company:    company,
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
        qb_company:      company,
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

  // QB allows duplicate DocNumbers WITHIN a company; a batch containing the
  // same invoice_no twice makes Postgres reject the whole upsert ("cannot
  // affect row a second time"). Dedupe within the batch — keep the newest
  // TxnDate per (company, number). (Uniqueness is scoped per qb_company —
  // TAB and TAC each have their own independent DocNumber sequence.)
  const invKey = (r: Record<string, unknown>) => `${r.qb_company}|${r.invoice_no}`;
  const invByNo = new Map<string, Record<string, unknown>>();
  for (const r of invoiceRows) {
    const k = invKey(r);
    const prev = invByNo.get(k);
    if (!prev || String(r.txn_date) > String(prev.txn_date)) invByNo.set(k, r);
  }
  const dedupedInvoices = [...invByNo.values()];
  const itemByKey = new Map<string, Record<string, unknown>>();
  for (const r of itemRows) {
    // Only keep line items belonging to the invoice occurrence we kept.
    if (invByNo.get(invKey(r))?.txn_date !== r.txn_date) continue;
    itemByKey.set(`${r.qb_company}|${r.invoice_no}|${r.line_num}`, r);
  }
  const dedupedItems = [...itemByKey.values()];
  itemRows.length = 0; itemRows.push(...dedupedItems);

  // Upsert invoices
  const { error: invErr } = await supabase
    .from('quickbooks_invoices')
    .upsert(dedupedInvoices as Parameters<typeof supabase.from>[0] extends never ? never : never[], { onConflict: 'qb_company,invoice_no' });

  // Upsert line items in batches of 200
  let itemsDone = 0, itemsErr = 0;
  for (let i = 0; i < itemRows.length; i += 200) {
    const { error } = await supabase
      .from('quickbooks_invoice_items')
      .upsert(itemRows.slice(i, i + 200) as Parameters<typeof supabase.from>[0] extends never ? never : never[], { onConflict: 'qb_company,invoice_no,line_num' });
    if (error) itemsErr += Math.min(200, itemRows.length - i);
    else       itemsDone += Math.min(200, itemRows.length - i);
  }

  return {
    invoices_synced: dedupedInvoices.length,
    items_synced:    itemsDone,
    items_error:     itemsErr,
    invoice_error:   invErr?.message ?? null,
  };
}
