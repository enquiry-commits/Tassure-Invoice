import { todaySGT } from '@/lib/date';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import { promises as fs } from 'fs';
import path from 'path';
import { AGING_BUCKETS, TXN_TYPE_LABELS, emptyAgingTotals } from '@/lib/soa';
import type { SoaCompanyRow } from '@/lib/soa-data';

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
export function safeText(font: PDFFont, text: string): string {
  try { font.encodeText(text); return text; } catch { /* fall through */ }
  let out = '';
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { /* drop this one character */ }
  }
  out = out.trim();
  return out || '(name unavailable)';
}

// Greedy word-wrap against real font metrics — see drawStatementCoverPage's
// TO-block comment on why the TO block wraps address lines manually rather
// than through pdf-lib's own drawText maxWidth auto-wrap.
function wrapLine(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
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
// Tassure's own letterhead+logo, the aging-bucket summary, and the itemized
// outstanding list — using EXACTLY the same computed row (computeSoaRows(),
// the same shared computation the on-screen SOA list/Excel export already
// use) so its numbers can never drift from what staff see elsewhere. Always
// added to `merged` BEFORE the real invoice/credit-memo pages get merged in
// below (matches Vincent's own framing: "inv 我们会放在soa 下面，在一个pdf
// 里面"). Still scoped to ONE QB company when called this way — the "All"
// page's combined-books mode builds its own row via combineStatementRows()
// below and passes that in instead, same function either way.
//
// Corrected 2026-09-17, comparing side-by-side screenshots of this function's
// own output against Vincent's real reference PDF: (1) the aging-bucket
// table appears ONCE, as a footer at the very bottom, not duplicated before
// the letterhead too — an earlier version of this function misread the
// reference's raw PDF content-stream operator ORDER as top-to-bottom visual
// position, which is wrong for a PDF (operators execute in stream order, not
// layout order); the actual page starts straight at the letterhead. (2) the
// T Assure logo IS included — extracted directly from the reference PDF's
// own embedded XObject image (public/assets/tassure-statement-logo.png;
// this app's OTHER logo, public/logo.png, is a different, unrelated icon).
//
// Corrected again 2026-09-17, same day, second round — Vincent caught the
// TO block itself was still wrong against the same reference: "地址都没有
// 看到" (the client's own mailing address wasn't printed at all) and "你最
// 新版的位置不对" (the block's position/spacing was off — a direct symptom
// of the missing address leaving a wrong-looking gap). Two real fixes: (1)
// the client's real QuickBooks BillAddr now prints under their name, fetched
// live by the caller (see resolveBillAddrLines in the route) and passed in
// as `billAddrLines` — never fabricated, never stored redundantly in this
// app's own tables, best-effort (an unreachable QuickBooks customer record
// just means the address block is skipped, never a failed Statement). (2)
// the printed name itself switched from `row.companyName` (which can be the
// `companies` table's own ALL-CAPS convention, e.g. "1V CAPITAL PTE. LTD.")
// to the caller-supplied `customerDisplayName` — the exact raw QuickBooks
// DisplayName string, mixed case, matching the reference's own "1V Capital
// Pte. Ltd." exactly.
//
// Corrected a third time 2026-09-17, same day — Vincent, after the position/
// width fixes: "这个你没有部分重现吗？" (pointing at STATEMENT NO./DATE/
// TOTAL DUE/ENCLOSED as a block — didn't any of this get reproduced?).
// "ENCLOSED" IS now reproduced — on closer look it's fixed boilerplate on
// every real QuickBooks-printed Statement regardless of what's actually
// being sent, never a per-Statement data value, so there was nothing to
// fabricate by printing it (the earlier round's own reasoning for omitting
// it — "showing the label with no value would look like a bug" — was
// simply wrong: the reference itself shows the label with no value next to
// it, that IS the correct look).
//
// One honest simplification remains: "STATEMENT NO." — that's QuickBooks'
// own internal Statement-numbering sequence, assigned only by its web-UI
// "Create statements" flow with no API equivalent. Unlike ENCLOSED, this
// one genuinely varies per real Statement (the reference shows 10498) and
// this app has no real value for it — printing anything here (blank,
// zero, a self-generated counter) would be either misleading or a new
// business record invented without Vincent's say-so, so it stays omitted
// pending his decision on whether Tassure should mint its own internal
// Statement-numbering sequence.
export type StatementRow = Pick<SoaCompanyRow, 'companyName' | 'aging' | 'totalOutstanding' | 'lineItems'>;

const STATEMENT_LOGO_PATH = path.join(process.cwd(), 'public', 'assets', 'tassure-statement-logo.png');
// Real aspect ratio of the extracted logo file (283x200px) — used to size it
// on the page without distorting it.
const STATEMENT_LOGO_ASPECT = 283 / 200;

export async function drawStatementCoverPage(
  pdfDoc: PDFDocument,
  legalName: string,
  row: StatementRow,
  customerDisplayName: string,
  qbCompanyName: string | null,
  billAddrLines: string[],
  invoiceDetails: Map<string, { invoiceNo: string; description: string | null }> = new Map(),
) {
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

  // Letterhead (left) + T Assure logo (right), side by side on the same
  // row — matches the reference exactly, no aging table above it.
  const letterheadTop = y;
  page.drawText(legalName, { x: left, y, size: 12, font: boldFont });
  y -= 15;
  for (const line of TASSURE_CONTACT_LINES) {
    page.drawText(line, { x: left, y, size: 10, font });
    y -= 13;
  }
  try {
    const logoBytes = await fs.readFile(STATEMENT_LOGO_PATH);
    const logoImage = await pdfDoc.embedPng(logoBytes);
    const logoWidth = 130;
    const logoHeight = logoWidth / STATEMENT_LOGO_ASPECT;
    page.drawImage(logoImage, { x: right - logoWidth, y: letterheadTop - logoHeight + 12, width: logoWidth, height: logoHeight });
  } catch {
    // Missing/unreadable asset must never break the whole Statement — degrade to no logo.
  }
  y -= 10;

  // "Statement" — 20pt, regular weight (not bold — matches the reference
  // exactly, confirmed from its own Tf operator), in the same blue.
  page.drawText('Statement', { x: left, y, size: 20, font, color: QB_STATEMENT_BLUE });
  y -= 34;

  // TO block (left) + DATE/TOTAL DUE/ENCLOSED (right) — see this function's
  // own header comment for why STATEMENT NO. alone stays omitted (ENCLOSED
  // reproduced below — it's fixed boilerplate on every real QuickBooks-
  // printed Statement, not a data field, so there's nothing to fabricate)
  // and why the printed name/address changed in the second 2026-09-17 round.
  const metaX = left + 300;
  const metaLabelW = 70;
  const drawMetaRow = (label: string, value: string, atY: number) => {
    page.drawText(label, { x: metaX + metaLabelW - boldFont.widthOfTextAtSize(label, 10), y: atY, size: 10, font: boldFont });
    page.drawText(value, { x: metaX + metaLabelW + 10, y: atY, size: 10, font });
  };
  page.drawText('TO', { x: left, y, size: 10, font: boldFont });
  drawMetaRow('DATE', ddMmYyyy, y);
  drawMetaRow('TOTAL DUE', `SGD ${money(row.totalOutstanding)}`, y - 16);
  y -= 15;
  // maxWidth guards against a long real company name running into the
  // DATE/TOTAL DUE column beside it (metaX) — wraps to a 2nd line instead
  // of overlapping.
  page.drawText(safeText(boldFont, customerDisplayName), { x: left, y, size: 10, font: boldFont, maxWidth: metaX - left - 20, lineHeight: 12 });
  y -= 15;
  // The customer's real QuickBooks Customer.CompanyName field — a distinct
  // field from DisplayName, printed a second time right below it. Vincent,
  // 2026-09-17, fifth round on this same page, side-by-side with the ORIGINAL
  // reference PDF file (not a screenshot this time): "1V Capital Pte. Ltd."
  // visually appears TWICE in the TO block — this is why: QuickBooks' own
  // Statement template always prints DisplayName then CompanyName stacked,
  // and for this customer the two happen to be identical, which reads as a
  // plain repeat but is genuinely two separate real fields. Printed
  // unconditionally whenever QuickBooks has a real value for it (never
  // deduplicated against customerDisplayName — the reference shows both
  // even when they're equal, so hiding a genuine repeat would itself be a
  // mismatch), regular weight like the address lines below it, not bold.
  if (qbCompanyName) {
    page.drawText(safeText(font, qbCompanyName), { x: left, y, size: 10, font, maxWidth: metaX - left - 20 });
  }
  // ENCLOSED — same fixed label on every real QuickBooks Statement
  // regardless of what's being sent, printed one row below TOTAL DUE (same
  // relative position as the reference, just shifted up one row overall
  // since STATEMENT NO. above it has no real value to print).
  page.drawText('ENCLOSED', { x: metaX + metaLabelW - boldFont.widthOfTextAtSize('ENCLOSED', 10), y, size: 10, font: boldFont });
  y -= 15;
  // Wrapped manually (word-by-word against the actual font metrics) instead
  // of relying on drawText's own maxWidth auto-wrap — a real QuickBooks
  // BillAddr can arrive as ONE long Line1 with the whole address jammed in
  // (confirmed against real data: TAB's own record for "1V Capital Pte.
  // Ltd." has no separate Line2/City/PostalCode at all), and auto-wrap
  // draws its extra visual line(s) internally without this function's own
  // `y` tracker knowing they happened — every following y -= 13 then
  // undercounts by a line, crowding or overlapping whatever prints next.
  // Wrapping here first means every visual line this function draws is a
  // single real drawText() call this function itself advances `y` for.
  for (const line of billAddrLines) {
    for (const subLine of wrapLine(font, safeText(font, line), 10, metaX - left - 20)) {
      page.drawText(subLine, { x: left, y, size: 10, font });
      y -= 13;
    }
  }
  y -= 20;

  // Itemized list — every real transaction behind the total (Invoice/
  // Credit Note/Payment/Journal Entry/Deposit — full-word TXN_TYPE_LABELS,
  // lib/soa.ts, NOT the same 2-letter TXN_TYPE_TAGS the on-screen list/
  // detail modal use; see that map's own comment for why this page needs
  // different wording), oldest due date first (SoaCompanyRow.lineItems is
  // already sorted that way). Same
  // light-blue-header styling as the aging table above. Only the first 3
  // column widths are fixed — OPEN AMOUNT stretches to `right`, same
  // "last column reaches the true right margin" rule the aging table above
  // already follows. Vincent, 2026-09-17, third round on this same page:
  // "宽度也很重要...蓝色的宽度，是否有对齐" (width matters too — the blue
  // header's width, whether it lines up) — a fixed 4th-column width of 90pt
  // left a ~32pt gap of unfilled white space past OPEN AMOUNT's blue header
  // before the page's actual right margin, so this table's own blue bar
  // was narrower than the aging table's directly below it and the two
  // didn't align on the right edge at all.
  const itemColWidths = [80, 220, 90];
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
    // DATE column shows the transaction date (item.txnDate), matching the
    // reference's own DATE column exactly — confirmed 2026-09-17 against the
    // ORIGINAL reference PDF file (not a screenshot): its DATE column reads
    // "24/07/2026" (the invoice's txn_date), while "Due 31/07/2026" appears
    // separately inside the DESCRIPTION text. Both reformatted DD/MM/YYYY
    // from plain ISO (YYYY-MM-DD).
    const itemDate = item.txnDate ? item.txnDate.split('-').reverse().join('/') : '—';
    const dueDateFmt = item.dueDate ? item.dueDate.split('-').reverse().join('/') : '—';
    const amountText = money(item.amount);
    // Vincent, 2026-09-17, fourth round: "这部分为什么生成出来的没有像这个
    // 那么完整" (pointing at the reference's rich "Invoice No.02610894: Due
    // 31/07/2026. XBRL for the year (FYE 31.12.2025)" description) — for a
    // real Invoice line where the caller found a matching real
    // qb_invoice_items row (see resolveInvoiceDetails in the route),
    // reproduce that same real format; the invoice number printed here is
    // `details.invoiceNo` (the caller's own real, correctly-padded value),
    // never `item.docNumber` — see resolveInvoiceDetails' own comment on
    // why that field can arrive with a stripped leading zero. Falls back to
    // the plain "docNumber (Type)" form for anything else (Credit Note/
    // Payment/Journal Entry/Deposit, or an Invoice this lookup didn't find)
    // — never fabricated, only ever a real matched row's own text.
    const numKey = /^\d+$/.test(item.docNumber ?? '') ? String(Number(item.docNumber)) : null;
    const details = item.txnType === 'Invoice' && numKey ? invoiceDetails.get(numKey) : undefined;
    const firstDescLine = details?.description?.split('\n').map(l => l.trim()).find(Boolean);
    const description = firstDescLine
      ? `Invoice No.${safeText(font, details!.invoiceNo)}: Due ${dueDateFmt}. ${safeText(font, firstDescLine)}`
      : `${safeText(font, item.docNumber)} (${safeText(font, TXN_TYPE_LABELS[item.txnType] ?? item.txnType)})`;
    // Manually wrapped (same reasoning as the TO block's billAddrLines
    // above) so a long real description's extra visual line(s) are
    // reflected in `y` before the NEXT item row is drawn, instead of
    // silently overlapping it.
    const descLines = wrapLine(font, description, 9, itemColWidths[1] - 8);
    page.drawText(itemDate, { x: itemCols[0], y, size: 9, font });
    descLines.forEach((descLine, i) => page.drawText(descLine, { x: itemCols[1], y: y - i * 11, size: 9, font }));
    page.drawText(amountText, { x: itemCols[2], y, size: 9, font });
    page.drawText(amountText, { x: itemCols[3], y, size: 9, font });
    y -= Math.max(16, descLines.length * 11 + 5);
  }

  // Aging-bucket summary as a footer — matches the reference's own single
  // instance of this table (see this function's header comment on the
  // earlier top+bottom misreading), used here instead of a plain "Total
  // Outstanding" line. Pinned near the page's bottom margin rather than
  // drawn immediately under the last item row — Vincent, 2026-09-17, third
  // round: "位置很重要...上下的位置" (position matters — top-to-bottom
  // position). The reference's own footer sits at a fixed distance from the
  // bottom regardless of how few line items came before it (a 1-invoice
  // statement still has most of the page blank in the middle); drawing it
  // right after the last row instead made a short statement look crowded
  // and positioned nothing like the reference. Only pins DOWN into empty
  // space — if the item list already runs past this point (a long
  // statement), it's left to flow naturally rather than overlapping already-
  // drawn rows, and only spills to a new page if there truly isn't room.
  const AGING_TABLE_Y = 140;
  if (y > AGING_TABLE_Y) y = AGING_TABLE_Y;
  else if (y < 60) { newPage(); y = AGING_TABLE_Y; }
  drawAgingTable();
}

// 'ALL' mode's own aggregation — sums each of TAB/TAC/TAO's own computeSoaRows()
// result for this one customer into a single synthetic row. Never a second,
// independently-computed total: every number here is the plain sum of the
// exact same per-book rows the individual TAB/TAC/TAO pages already show,
// so a combined statement can never disagree with what staff see by adding
// the 3 single-book pages up by hand.
export function combineStatementRows(rows: SoaCompanyRow[], fallbackName: string): StatementRow {
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
