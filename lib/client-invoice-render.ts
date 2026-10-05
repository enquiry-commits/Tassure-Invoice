// Draws the invoice PDF a client receives, laid out like QuickBooks' own
// invoice template (positions, sizes and colours measured on real TAB/TAC
// PDFs, 2026-10-05) but from lib/client-invoice-model.ts's rows — each
// service once at its full amount (INV-QB-029). The letterhead (it carries the
// Chinese company name), the service banner and the PayNow QR are pixel crops
// of QuickBooks' own PDF (scripts/extract-client-invoice-assets.py); every
// other word is real, selectable text. Pure apart from pdf-lib: the caller
// passes the image and font bytes in. Throws ClientInvoiceRenderError when
// something can't be drawn faithfully (e.g. a character neither PDF font has a
// glyph for) — the caller then sends QuickBooks' own PDF instead, never a
// degraded copy.

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { ClientBook, ClientInvoiceModel } from './client-invoice-model';

export class ClientInvoiceRenderError extends Error {}

// cjkFont: a TrueType font with Chinese glyphs (templates/client-invoice/
// NotoSansSC-Regular.ttf, a static Regular instance of Google's Noto Sans SC,
// OFL). Loaded only when a client's name or a line has characters Helvetica
// can't print — 14 of the 154 open split invoices on 2026-10-05 (Chinese
// company names, full-width （）【】) — and used for those characters only.
// Only the glyphs used are embedded: pdf-lib's subsetter halves the glyph
// offsets, so the font file must keep every glyph an even number of bytes
// long (the shipped file is padded to 4) or characters come out corrupted.
export type ClientInvoiceAssets = { header: Uint8Array; footer: Uint8Array; qr: Uint8Array; cjkFont?: () => Promise<Uint8Array> };

// Static per-book text, copied from QuickBooks' own PDFs (TAB #02610986,
// TAC #02680320). If QuickBooks' template changes, update here and re-run
// scripts/extract-client-invoice-assets.py.
const PAYMENT_NOTE = [
  'Payment is due seven (7) days from the invoice date.',
  '* Kindly quote our invoice number and notify us after payment.',
  '* All bank charges (local and overseas) shall be borne by the remitter.',
];
const PAYMENT_DETAILS: Record<ClientBook, [string, string][]> = {
  TAB: [
    ['Account Name', 'TASSURE ASIA BIZSERVICES PTE. LTD.'],
    ['Account Number (SGD)', '374-310-831-9'],
    ['Account Number (USD)', '374-903-291-8'],
    ['Bank Name', 'UNITED OVERSEAS BANK LIMITED'],
    ['Bank Address', '10 ANSON ROAD #01-01, INTERNATIONAL PLAZA, SINGAPORE 079903'],
    ['Bank Swift Code', 'UOVBSGSG'],
    ['Paynow (UEN)', '201325157G (SGD only)'],
  ],
  TAC: [
    ['Account Name', 'TASSURE ASIA CONSULTANCY PTE. LTD.'],
    ['Account Number (SGD)', '374-319-542-4'],
    ['Bank Name', 'UNITED OVERSEAS BANK LIMITED'],
    ['Bank Address', '10 ANSON ROAD #01-01, INTERNATIONAL PLAZA, SINGAPORE 079903'],
    ['Bank Swift Code', 'UOVBSGSG'],
    ['Paynow (UEN)', '201936395C (SGD only)'],
  ],
};

// QuickBooks' page: US Letter, coordinates below are distances from the TOP.
const PAGE_W = 612;
const PAGE_H = 792;
const LINE = 12.2;
const SIZE = 10;
const LEFT = 39.3;
const RIGHT = 578;
const AMOUNT_RIGHT = 568;
const DESC_X = 46.5;
const DESC_MAX_W = 405;
const FOOTER_TOP = 742;
const CONTENT_BOTTOM = 735;
const HEADER = { top: 15, height: 115 };

const ink = (hex: number) => rgb(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
const C = { purple: ink(0x4e2778), dark: ink(0x3b3838), body: ink(0x262626), text: ink(0x1f2229), note: ink(0x767171), black: ink(0x000000), bar: rgb(0.29, 0.29, 0.29), white: rgb(1, 1, 1), rule: ink(0x808080) };

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function wrap(text: string, widthOf: (s: string) => number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').replace(/\t/g, ' ').split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) out.push(line);
      // A single word wider than the column (or Chinese text, which has no
      // spaces) is broken by characters.
      let rest = word;
      while (widthOf(rest) > maxWidth) {
        let n = rest.length - 1;
        while (n > 1 && widthOf(rest.slice(0, n)) > maxWidth) n--;
        out.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      line = rest;
    }
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  return out;
}

export async function renderClientInvoicePdf(model: ClientInvoiceModel, assets: ClientInvoiceAssets): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Invoice ${model.invoiceNo}`);
  pdf.setProducer('Tassure');
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const helveticaCan = (s: string) => { try { regular.widthOfTextAtSize(s, SIZE); return true; } catch { return false; } };
  // Characters Helvetica can't print are drawn in the Chinese font, the rest
  // of the line stays Helvetica; without that font — or for a character it
  // lacks too — the text is refused (the caller sends QuickBooks' own PDF).
  let cjk: PDFFont | null = null;
  let cjkChars = new Set<number>();
  const needsCjk = [...model.billTo, ...model.rows.map(r => r.description)].some(t => !helveticaCan(t.replace(/[\r\n\t]/g, ' ')));
  if (needsCjk && assets.cjkFont) {
    try {
      pdf.registerFontkit(fontkit);
      cjk = await pdf.embedFont(await assets.cjkFont(), { subset: true });
      cjkChars = new Set(cjk.getCharacterSet());
    } catch (err) {
      throw new ClientInvoiceRenderError(`the Chinese font could not be loaded (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  // s split into runs of one font each.
  const runs = (s: string, preferred: PDFFont): [string, PDFFont][] => {
    if (!cjk || helveticaCan(s)) return [[s, preferred]];
    const out: [string, PDFFont][] = [];
    for (const ch of s) {
      let font = preferred;
      if (!helveticaCan(ch)) {
        if (!cjkChars.has(ch.codePointAt(0)!)) throw new ClientInvoiceRenderError(`"${s.slice(0, 40)}" has a character (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}) no PDF font can print`);
        font = cjk;
      }
      const last = out[out.length - 1];
      if (last && last[1] === font) last[0] += ch; else out.push([ch, font]);
    }
    return out;
  };
  // What a viewer actually advances. pdf-lib's Helvetica width subtracts
  // kerning (e.g. "Tr") that drawText never applies, so a run following
  // Helvetica text would overlap it — sum the characters instead.
  const advance = (t: string, font: PDFFont, size: number) => (font === cjk ? font.widthOfTextAtSize(t, size) : [...t].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size), 0));
  const widthOf = (s: string, preferred: PDFFont, size: number) => {
    try { return runs(s, preferred).reduce((w, [t, font]) => w + advance(t, font, size), 0); } catch (err) {
      if (err instanceof ClientInvoiceRenderError) throw err;
      throw new ClientInvoiceRenderError(`"${s.slice(0, 40)}" has characters the PDF font can't print`);
    }
  };
  let header: PDFImage, footer: PDFImage, qr: PDFImage;
  try {
    [header, footer, qr] = await Promise.all([pdf.embedPng(assets.header), pdf.embedPng(assets.footer), pdf.embedPng(assets.qr)]);
  } catch (err) {
    throw new ClientInvoiceRenderError(`the invoice template images could not be read (${err instanceof Error ? err.message : String(err)})`);
  }

  let page: PDFPage = pdf.addPage([PAGE_W, PAGE_H]);
  const text = (s: string, x: number, top: number, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; alignRight?: boolean } = {}) => {
    const size = opts.size ?? SIZE;
    const width = widthOf(s, opts.font ?? regular, size); // refuses text no font can print
    let cx = opts.alignRight ? x - width : x;
    for (const [t, font] of runs(s, opts.font ?? regular)) {
      page.drawText(t, { x: cx, y: PAGE_H - top - size * 0.8, size, font, color: opts.color ?? C.text });
      cx += advance(t, font, size);
    }
  };
  const footerOnPage = () => page.drawImage(footer, { x: 0, y: PAGE_H - FOOTER_TOP - 30, width: PAGE_W, height: 30 });
  const newPage = () => { footerOnPage(); page = pdf.addPage([PAGE_W, PAGE_H]); return 28; };
  const fits = (top: number, height: number) => top + height <= CONTENT_BOTTOM;

  // Letterhead, title, BILL TO and the invoice facts.
  page.drawImage(header, { x: 0, y: PAGE_H - HEADER.top - HEADER.height, width: PAGE_W, height: HEADER.height });
  text('INVOICE', LEFT, 142, { font: bold, size: 22, color: C.purple });
  text('BILL TO:', LEFT, 179.2, { color: C.dark });
  model.billTo.forEach((line, i) => text(line, LEFT, 191.4 + i * LINE, { color: C.black }));
  const facts: [string, string][] = [['INVOICE NO.', model.invoiceNo], ['TERMS', model.terms], ['DATE', model.date], ['DUE DATE', model.dueDate]];
  facts.forEach(([label, value], i) => {
    text(label, 407.8, 179.2 + i * LINE, { color: C.body });
    text(`: ${value}`, 478.7, 179.2 + i * LINE, { color: C.body });
  });

  // DESCRIPTION / AMOUNT bar, then one row per service.
  const barTop = Math.max(248.8, 191.4 + model.billTo.length * LINE + 8);
  page.drawRectangle({ x: LEFT, y: PAGE_H - barTop - 16.6, width: RIGHT - LEFT, height: 16.6, color: C.bar });
  text('DESCRIPTION', DESC_X, barTop + 2.2, { font: bold, color: C.white });
  text('AMOUNT (S$)', AMOUNT_RIGHT, barTop + 2.2, { font: bold, color: C.white, alignRight: true });
  let top = barTop + 16.6;
  for (const row of model.rows) {
    const lines = row.description.trim() ? wrap(row.description, s => widthOf(s, regular, SIZE), DESC_MAX_W) : [''];
    if (!fits(top, lines.length * LINE)) top = newPage();
    lines.forEach((l, i) => { if (l) text(l, DESC_X, top + i * LINE); });
    text(money(row.amount), AMOUNT_RIGHT, top, { color: C.black, alignRight: true });
    top += lines.length * LINE + LINE;
  }

  // Rule, payment note and TOTAL.
  if (!fits(top, 6 + PAYMENT_NOTE.length * LINE + 6)) top = newPage();
  page.drawLine({ start: { x: LEFT, y: PAGE_H - top - 2 }, end: { x: RIGHT, y: PAGE_H - top - 2 }, thickness: 0.6, color: C.rule });
  const noteTop = top + 6.4;
  PAYMENT_NOTE.forEach((l, i) => text(l, 46.4, noteTop + i * LINE, { color: C.note }));
  text('TOTAL', 465.9, noteTop, { font: bold, color: C.black });
  text(money(model.total), AMOUNT_RIGHT, noteTop, { font: bold, color: C.text, alignRight: true });
  top = noteTop + PAYMENT_NOTE.length * LINE + 10.8;

  // PAYMENT DETAILS, then the PayNow QR (which QuickBooks too carries over
  // to page 2 when it doesn't fit).
  if (!fits(top, 2 * LINE)) top = newPage();
  text('PAYMENT DETAILS:', 44.7, top, { font: bold, color: C.black });
  top += LINE;
  for (const [label, value] of PAYMENT_DETAILS[model.book]) {
    if (!fits(top, LINE)) top = newPage();
    text(label, 44.7, top, { color: C.body });
    text(`: ${value}`, 165.2, top, { color: C.body });
    top += LINE;
  }
  if (!fits(top, 84)) top = newPage();
  text('Paynow (QR)', 44.7, top, { color: C.body });
  text(':', 165.2, top, { color: C.body });
  page.drawImage(qr, { x: 172.5, y: PAGE_H - top - 4.8 - 80, width: 79, height: 80 });
  footerOnPage();

  return pdf.save();
}
