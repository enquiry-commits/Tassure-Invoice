import { todaySGT } from '@/lib/date';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { createAdminClient } from '@/lib/supabase';
import { pageAll } from '@/lib/page-all';
import { normalize, findUniqueBestMatch } from '@/lib/company-name';
import { getValidToken, type QbCompany } from '@/lib/quickbooks';
import { loadArAgingSnapshot, computeSoaRows, type SoaCompanyRow } from '@/lib/soa-data';
import { LEGAL_NAME } from '@/lib/soa-export';
import { AGING_BUCKETS, TXN_TYPE_TAGS, emptyAgingTotals } from '@/lib/soa';

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

// pdf-lib's StandardFonts (Helvetica) only encode WinAnsi — page.drawText()
// throws SYNCHRONOUSLY for any character outside it (confirmed against
// @pdf-lib/standard-fonts' Encoding.js), which is a real, not theoretical,
// risk here: row.companyName/item.docNumber below are raw QuickBooks/
// companies-table text, and this app's own real client base includes
// Chinese-registered names (see lib/quickbooks.ts's CUSTOMER_NAME_CORRECTIONS
// — 吉木锌国际贸易等). A throw here would leave whatever pages were already
// added to `merged` (via prior addPage() calls) silently shipped in the
// final client PDF, half-drawn — this must never happen for a document going
// out to a real paying client. Filters to only what the given font can
// actually encode; a name that's entirely unencodable renders as the
// fallback rather than a blank line, so it's visibly a gap, not invisible.
// Full CJK glyph rendering would need a real embedded font (pdf-lib +
// fontkit + a bundled font file) — deliberately out of scope for this round.
function safeText(font: PDFFont, text: string): string {
  try { font.encodeText(text); return text; } catch { /* fall through */ }
  let out = '';
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { /* drop this one character */ }
  }
  out = out.trim();
  return out || '(name unavailable)';
}

const TASSURE_CONTACT_LINES = [
  '10 Anson Road',
  '#12-08 International Plaza',
  'Singapore 079903',
  '+6565701965',
  'enquiry@tassure.com',
];

// Colors/fonts below are NOT eyeballed — Vincent, 2026-09-17: "你要用那个
// PDF的模板要一模一样的，包括颜色和排版和字体大小和字型" (must match that
// reference PDF exactly — colors, layout, font size, font style). He'd
// supplied a real QuickBooks-native Statement PDF for "1V Capital Pte Ltd"
// as the target. QuickBooks' own Statement feature is web-UI-only (no API
// endpoint — verified against Intuit's own developer docs/community, see
// PROJECT_STATUS.md), so it can't be called directly; instead these exact
// values were extracted straight from that real PDF's own content stream
// (inflated the Flate-compressed page stream, read its literal `rg` fill-
// color operators and `/BaseFont` declarations) — not approximated from the
// screenshot. `#4F90BB` is its heading/table-header text color, `#DCE9F1`
// its table-header fill, and its fonts are plain `Helvetica`/`Helvetica-
// Bold` — the exact same StandardFonts this route already embeds, so no new
// font asset is needed to match it.
const QB_STATEMENT_BLUE = rgb(0.30980393, 0.56470591, 0.73333335); // #4F90BB
const QB_STATEMENT_HEADER_BG = rgb(0.86274511, 0.9137255, 0.94509804); // #DCE9F1

// Vincent, 2026-09-17: this merged PDF used to be nothing but raw invoice/
// credit-memo pages concatenated together — no cover page at all, so a
// client received what looked like a stray invoice, not a real "Statement
// of Account" ("而且不是soa 是inv"). Draws a genuine Statement page —
// Tassure's own letterhead, the aging-bucket summary (top AND bottom, same
// as the reference), and the itemized outstanding list — using EXACTLY the
// same computed row (computeSoaRows(), the same shared computation the
// on-screen SOA list/Excel export already use) so its numbers can never
// drift from what staff see elsewhere. Always added to `merged` BEFORE the
// real invoice/credit-memo pages get merged in below (matches Vincent's own
// framing: "inv 我们会放在soa 下面，在一个pdf 里面"). Still scoped to ONE QB
// company when called this way — the "All" page's combined-books mode
// builds its own row via computeCombinedSoaRow() below and passes that in
// instead, same function either way.
//
// Two honest simplifications versus the real reference (both because this
// route's existing data model doesn't carry the field, not a design
// choice): (1) no "STATEMENT NO." — that's QuickBooks' own internal
// numbering; inventing one here would be a fabricated business record, not
// a display tweak. (2) the itemized table's "AMOUNT"/"OPEN AMOUNT" columns
// both show the same open-balance figure — SoaCompanyRow.lineItems doesn't
// separately carry each item's original (pre-payment) amount.
type StatementRow = Pick<SoaCompanyRow, 'companyName' | 'aging' | 'totalOutstanding' | 'lineItems'>;

async function drawStatementCoverPage(pdfDoc: PDFDocument, legalName: string, row: StatementRow) {
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const left = 50;

  let page = pdfDoc.addPage();
  let { width, height } = page.getSize();
  let right = width - 50;
  let y = height - 50;
  const newPage = () => {
    page = pdfDoc.addPage();
    ({ width, height } = page.getSize());
    right = width - 50;
    y = height - 50;
  };
  const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // DD/MM/YYYY — matches the reference PDF's own "DATE 17/09/2026" exactly
  // (todaySGT() itself returns ISO YYYY-MM-DD, this app's usual convention
  // everywhere else; this page alone reformats it for that visual match).
  const ddMmYyyy = todaySGT().split('-').reverse().join('/');

  // Aging-bucket summary table — 6 columns (5 buckets + Total), light-blue
  // header fill with blue regular-weight header text, matching the
  // reference's own proportions: the first/last columns run wider than the
  // 4 middle ones (114.4/85.75/85.8/85.7/85.8/118.55 of 576pt there).
  const drawAgingTable = () => {
    const tableWidth = right - left;
    const midW = tableWidth / 6.6;
    const endW = midW * 1.3;
    const colWidths = [endW, midW, midW, midW, midW, endW];
    const labels = [['Current', 'Due'], ['1-30 Days', 'Past Due'], ['31-60 Days', 'Past Due'], ['61-90 Days', 'Past Due'], ['90+ Days', 'Past Due'], ['Amount', 'Due']];
    const headerH = 22;
    let cx = left;
    for (let i = 0; i < colWidths.length; i++) {
      page.drawRectangle({ x: cx, y: y - headerH, width: colWidths[i], height: headerH, color: QB_STATEMENT_HEADER_BG });
      page.drawText(labels[i][0], { x: cx + 6, y: y - 10, size: 8, font, color: QB_STATEMENT_BLUE });
      page.drawText(labels[i][1], { x: cx + 6, y: y - 20, size: 8, font, color: QB_STATEMENT_BLUE });
      cx += colWidths[i];
    }
    y -= headerH + 16;
    const values = [row.aging.current, row.aging.d1_30, row.aging.d31_60, row.aging.d61_90, row.aging.d91_plus, row.totalOutstanding];
    cx = left;
    for (let i = 0; i < colWidths.length; i++) {
      const isTotal = i === colWidths.length - 1;
      const text = isTotal ? `SGD ${money(values[i])}` : money(values[i]);
      const f = isTotal ? boldFont : font;
      page.drawText(text, { x: cx + 6, y, size: 9, font: f });
      cx += colWidths[i];
    }
    y -= 24;
  };

  drawAgingTable();

  // Letterhead — Tassure's own legal name (bold) + fixed contact block
  // (regular), left-aligned. The reference also carries the T Assure logo
  // image here; skipped — this app's own public/logo.png is a different,
  // unrelated icon (a generic handshake graphic), not that wordmark, and
  // using the wrong logo would be worse than none.
  page.drawText(legalName, { x: left, y, size: 12, font: boldFont });
  y -= 15;
  for (const line of TASSURE_CONTACT_LINES) {
    page.drawText(line, { x: left, y, size: 10, font });
    y -= 13;
  }
  y -= 10;

  // "Statement" — 20pt, regular weight (not bold — matches the reference
  // exactly, confirmed from its own Tf operator), in the same blue.
  page.drawText('Statement', { x: left, y, size: 20, font, color: QB_STATEMENT_BLUE });
  y -= 34;

  // TO block (left) + Date/Total Due (right) — bold labels, regular values,
  // same two-column arrangement as the reference's TO / STATEMENT NO.-DATE-
  // TOTAL DUE-ENCLOSED block (STATEMENT NO./ENCLOSED omitted, see header
  // comment).
  const metaX = left + 300;
  page.drawText('TO', { x: left, y, size: 10, font: boldFont });
  const metaLabelW = 70;
  const drawMetaRow = (label: string, value: string, atY: number) => {
    page.drawText(label, { x: metaX + metaLabelW - boldFont.widthOfTextAtSize(label, 10), y: atY, size: 10, font: boldFont });
    page.drawText(value, { x: metaX + metaLabelW + 10, y: atY, size: 10, font });
  };
  drawMetaRow('DATE', ddMmYyyy, y);
  drawMetaRow('TOTAL DUE', `SGD ${money(row.totalOutstanding)}`, y - 16);
  y -= 15;
  // maxWidth guards against a long real company name running into the
  // DATE/TOTAL DUE column beside it (metaX) — wraps to a 2nd line instead
  // of overlapping.
  page.drawText(safeText(boldFont, row.companyName), { x: left, y, size: 10, font: boldFont, maxWidth: metaX - left - 20, lineHeight: 12 });
  y -= 40;

  // Itemized list — every real transaction behind the total (Invoice/
  // Credit Note/Payment/Journal Entry/Deposit — same TXN_TYPE_TAGS
  // shorthand as the on-screen list/detail modal, lib/soa.ts), oldest due
  // date first (SoaCompanyRow.lineItems is already sorted that way). Same
  // light-blue-header styling as the aging table above.
  const itemColWidths = [80, 220, 90, 90];
  const itemCols = [left, left + itemColWidths[0], left + itemColWidths[0] + itemColWidths[1], left + itemColWidths[0] + itemColWidths[1] + itemColWidths[2]];
  const drawItemHeader = () => {
    const headerH = 18;
    const labels = ['DATE', 'DESCRIPTION', 'AMOUNT', 'OPEN AMOUNT'];
    for (let i = 0; i < itemCols.length; i++) {
      const w = i < itemColWidths.length ? itemColWidths[i] : right - itemCols[i];
      page.drawRectangle({ x: itemCols[i], y: y - headerH, width: w, height: headerH, color: QB_STATEMENT_HEADER_BG });
      page.drawText(labels[i], { x: itemCols[i] + 6, y: y - 13, size: 8, font, color: QB_STATEMENT_BLUE });
    }
    y -= headerH + 14;
  };
  drawItemHeader();
  for (const item of row.lineItems) {
    if (y < 90) { newPage(); drawAgingTable(); drawItemHeader(); }
    // The DATE column already shows item.dueDate — SoaCompanyRow.lineItems
    // doesn't carry a separate transaction date the way the reference's own
    // "DATE" column (invoice date, not due date) does, so this reuses due
    // date for both rather than showing it twice.
    const description = `${safeText(font, item.docNumber)} (${safeText(font, TXN_TYPE_TAGS[item.txnType] ?? item.txnType)})`;
    const amountText = money(item.amount);
    page.drawText(item.dueDate || '—', { x: itemCols[0], y, size: 9, font });
    page.drawText(description, { x: itemCols[1], y, size: 9, font, maxWidth: itemColWidths[1] - 8 });
    page.drawText(amountText, { x: itemCols[2], y, size: 9, font });
    page.drawText(amountText, { x: itemCols[3], y, size: 9, font });
    y -= 16;
  }
  y -= 16;

  // Bottom aging-bucket summary — the reference repeats the exact same
  // table as a footer; matched here rather than a plain "Total Outstanding"
  // line.
  if (y < 60) newPage();
  drawAgingTable();
}

// 'ALL' mode's own aggregation — sums each of TAB/TAC/TAO's own computeSoaRows()
// result for this one customer into a single synthetic row. Never a second,
// independently-computed total: every number here is the plain sum of the
// exact same per-book rows the individual TAB/TAC/TAO pages already show,
// so a combined statement can never disagree with what staff see by adding
// the 3 single-book pages up by hand.
function combineStatementRows(rows: SoaCompanyRow[], fallbackName: string): StatementRow {
  const aging = emptyAgingTotals();
  let totalOutstanding = 0;
  const lineItems: SoaCompanyRow['lineItems'] = [];
  for (const r of rows) {
    for (const b of AGING_BUCKETS) aging[b.key] += r.aging[b.key];
    totalOutstanding += r.totalOutstanding;
    lineItems.push(...r.lineItems);
  }
  lineItems.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return {
    companyName: rows[0]?.companyName ?? fallbackName,
    aging,
    totalOutstanding: Math.round(totalOutstanding * 100) / 100,
    lineItems,
  };
}

const QB_COMPANIES: QbCompany[] = ['TAB', 'TAC', 'TAO'];

// Vincent, 2026-09-17, re-examining the "1V Capital" example that started
// this whole feature: "当我在All 那边点 Draft 是要一起附带上 TAB/TAO/TAC的
// 就和之前的一样...Total 也是TAB/TAO/TAC的 加在一起" — the All page's own
// Draft/PDF action is deliberately the ONE place this route combines all 3
// books into a single Statement (aging/total/line-items/merged invoice
// pages all summed across TAB+TAC+TAO for one customer) — every single-book
// page (TAB/TAC/TAO) stays exactly as scoped today. 'ALL' is this route's
// own pseudo-company for that mode, never a real QbCompany value stored
// anywhere.
type CompanySelector = QbCompany | 'ALL';
const COMPANY_SELECTORS: CompanySelector[] = ['TAB', 'TAC', 'TAO', 'ALL'];

// GET /api/billing/soa/pdf?companyName=...&company=TAB|TAC|TAO|ALL — Vincent,
// 2026-09-05: "关于那个PDF合并是存在的，只是每次都是要CHELSEA自己一张一张的
// 合并成一个PDF内，其实也花费了大量的时间" — this is that exact manual step,
// automated. Fetches every real unpaid invoice's PDF for the company IN ONE
// QuickBooks system (same `company` scoping as /api/billing/soa/detail, see
// its comment) and merges every page into one PDF — or, in 'ALL' mode,
// every unpaid invoice across ALL THREE systems for that one customer name.
export async function GET(req: NextRequest) {
  const companyName = req.nextUrl.searchParams.get('companyName')?.trim();
  if (!companyName) return NextResponse.json({ error: 'companyName is required' }, { status: 400 });
  const company = req.nextUrl.searchParams.get('company') as CompanySelector | null;
  if (!company || !COMPANY_SELECTORS.includes(company)) {
    return NextResponse.json({ error: 'company must be one of TAB, TAC, TAO, ALL' }, { status: 400 });
  }
  const combineAllBooks = company === 'ALL';

  const supabase = createAdminClient();
  const target = normalize(companyName);

  const [invoices, creditMemos] = await Promise.all([
    pageAll(() => {
      const q = supabase.from('quickbooks_invoices')
        .select('customer_name, qb_company, qb_invoice_id, invoice_no, txn_date, balance')
        .gt('balance', 0);
      return combineAllBooks ? q.in('qb_company', QB_COMPANIES) : q.eq('qb_company', company);
    }) as Promise<Array<{
        customer_name: string; qb_company: string; qb_invoice_id: string; invoice_no: string; txn_date: string | null;
      }>>,
    // Unapplied CreditMemos — merged into the same PDF as their own real
    // QuickBooks document, see fetchCreditMemoPdf's comment.
    pageAll(() => {
      const q = supabase.from('quickbooks_credit_memos')
        .select('customer_name, qb_company, qb_credit_memo_id, doc_number, txn_date, balance')
        .gt('balance', 0);
      return combineAllBooks ? q.in('qb_company', QB_COMPANIES) : q.eq('qb_company', company);
    }) as Promise<Array<{
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

  // Cover page first (see drawStatementCoverPage's own comment). Resolves
  // against the EXACT raw customer_name the invoice/credit-memo matching
  // above already settled on (not the free-text `companyName` query param
  // again) — computeSoaRows() runs its own independent match, and re-running
  // it against the same ambiguous free text risked resolving to a DIFFERENT
  // real customer than the one whose invoices are being merged below (two
  // real companies with similar/overlapping names both scoring a fuzzy
  // match). Using the already-resolved raw name as both the prefilter and
  // the match target means this can only land on the same customer's row,
  // or (if the snapshot/companies-table pipeline genuinely has no matching
  // entry for that exact name) no row at all — never someone else's. A
  // failure/no-match here must never break the pre-existing, working
  // invoice-PDF merge below — it degrades to no cover page rather than
  // failing the whole download.
  const resolvedRawName = matched[0]?.customer_name ?? matchedCredits[0]?.customer_name ?? companyName;
  const resolveOneBookRow = async (book: QbCompany): Promise<SoaCompanyRow | undefined> => {
    const soaRows = await computeSoaRows(book, { customerNamePrefilter: resolvedRawName });
    const resolvedTarget = normalize(resolvedRawName);
    const exact = soaRows.find(r => normalize(r.companyName) === resolvedTarget);
    if (exact) return exact;
    return findUniqueBestMatch(resolvedRawName, soaRows, r => r.companyName, 70).value ?? undefined;
  };
  let coverPageAdded = false;
  const pageCountBeforeCover = merged.getPageCount();
  try {
    // "Tassure Group" for the combined letterhead — TAB/TAC/TAO are 3
    // separate legal entities, so no single one of their names is accurate
    // here; this is the exact umbrella term Vincent's own real reminder
    // emails already use ("GENTLE REMINDER FROM TASSURE GROUP").
    let statementRow: StatementRow | null;
    let legalName: string;
    if (combineAllBooks) {
      const bookRows = (await Promise.all(QB_COMPANIES.map(resolveOneBookRow))).filter((r): r is SoaCompanyRow => !!r);
      statementRow = bookRows.length ? combineStatementRows(bookRows, resolvedRawName) : null;
      legalName = 'Tassure Group';
    } else {
      statementRow = (await resolveOneBookRow(company)) ?? null;
      legalName = LEGAL_NAME[company];
    }
    if (statementRow) {
      await drawStatementCoverPage(merged, legalName, statementRow);
      coverPageAdded = true;
    }
  } catch {
    // Remove any pages drawStatementCoverPage managed to add before
    // throwing (e.g. mid-draw) — this must never ship a half-drawn page
    // silently merged into a real client PDF, regardless of WHY it failed.
    for (let i = merged.getPageCount() - 1; i >= pageCountBeforeCover; i--) merged.removePage(i);
    coverPageAdded = false;
  }

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
  // Was `merged.getPageCount() === 0` — no longer a valid check now that the
  // cover page above can already occupy page 1. Only hard-fail when there is
  // truly nothing useful to send: every real invoice/credit-memo PDF fetch
  // failed AND the cover page itself didn't make it in either. When the
  // cover page DID succeed, a real (if incomplete — missing the underlying
  // invoice documents) Statement is still more useful to staff than an
  // outright error, so fall through and return it.
  if (mergeItems.length > 0 && errors.length === mergeItems.length && !coverPageAdded) {
    return NextResponse.json({ error: `Could not fetch any invoice PDFs. ${errors.join(' ')}` }, { status: 502 });
  }

  // Added 2026-09-15 (docs/INVARIANTS.md INV-QB-017) — Payment/Journal
  // Entry/Deposit/anything else QuickBooks' own AgedReceivableDetail report
  // counts against this customer's balance has no client-facing document
  // to merge (unlike Invoice/CreditMemo, which always do) — appending
  // nothing for these would leave the merged PDF's own total quietly short
  // of what the rest of the system shows for this customer. When the
  // report is fresh, list them on one appended summary page instead, so
  // the merged PDF's total always foots. Omitted entirely when there are
  // none (today's exact behavior, unchanged for the common case) or when
  // the report is stale for this company (falls back to exactly today's
  // behavior, same as the detail modal/collections email paths). In 'ALL'
  // mode this loops all 3 books, same "only a fresh book's snapshot counts"
  // rule applied per book, and tags each row with its own book since they
  // now come from more than one.
  const otherBooks = combineAllBooks ? QB_COMPANIES : [company as QbCompany];
  const otherRows: { book: QbCompany; txnDate: string | null; txnType: string; docNumber: string | null; qbTxnId: string | null; openBalance: number }[] = [];
  for (const book of otherBooks) {
    const snapshot = await loadArAgingSnapshot(book, companyName);
    if (!snapshot.fresh) continue;
    for (const row of snapshot.rows) {
      if (normalize(row.customerName) !== target || /invoice|credit/i.test(row.txnType)) continue;
      otherRows.push({ book, txnDate: row.txnDate, txnType: row.txnType, docNumber: row.docNumber, qbTxnId: row.qbTxnId, openBalance: row.openBalance });
    }
  }
  if (otherRows.length) {
    const font = await merged.embedFont(StandardFonts.Helvetica);
    const boldFont = await merged.embedFont(StandardFonts.HelveticaBold);
    const page = merged.addPage();
    const { width, height } = page.getSize();
    let y = height - 60;
    const left = 50;
    page.drawText('Other Adjustments', { x: left, y, size: 14, font: boldFont });
    y -= 20;
    page.drawText(`Not represented by an individual invoice/credit note document above.`, { x: left, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 24;
    const cols = combineAllBooks
      ? { book: left, date: left + 40, type: left + 120, doc: left + 260, amount: width - 50 }
      : { book: null, date: left, type: left + 80, doc: left + 220, amount: width - 50 };
    if (cols.book !== null) page.drawText('Book', { x: cols.book, y, size: 9, font: boldFont });
    page.drawText('Date', { x: cols.date, y, size: 9, font: boldFont });
    page.drawText('Type', { x: cols.type, y, size: 9, font: boldFont });
    page.drawText('No.', { x: cols.doc, y, size: 9, font: boldFont });
    page.drawText('Amount', { x: cols.amount - 50, y, size: 9, font: boldFont });
    y -= 16;
    let subtotal = 0;
    for (const row of otherRows.sort((a, b) => (a.txnDate ?? '').localeCompare(b.txnDate ?? ''))) {
      subtotal += row.openBalance;
      if (cols.book !== null) page.drawText(row.book, { x: cols.book, y, size: 9, font });
      page.drawText(row.txnDate ?? '—', { x: cols.date, y, size: 9, font });
      page.drawText(row.txnType, { x: cols.type, y, size: 9, font });
      page.drawText(safeText(font, row.docNumber ?? row.qbTxnId ?? '—'), { x: cols.doc, y, size: 9, font });
      const amountText = row.openBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      page.drawText(amountText, { x: width - 50 - font.widthOfTextAtSize(amountText, 9), y, size: 9, font });
      y -= 14;
    }
    y -= 6;
    page.drawText('Subtotal', { x: cols.type, y, size: 10, font: boldFont });
    const subtotalText = subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    page.drawText(subtotalText, { x: width - 50 - boldFont.widthOfTextAtSize(subtotalText, 10), y, size: 10, font: boldFont });
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
