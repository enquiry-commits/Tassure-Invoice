// Chinese text on the system's client-facing PDFs (the client invoice,
// INV-QB-029; the SOA cover page, INV-DOC-011). pdf-lib's StandardFonts
// (Helvetica) only encode WinAnsi, so characters outside it — Chinese client
// names, full-width （）【】 — are drawn one by one in an embedded subset of
// templates/client-invoice/NotoSansSC-Regular.ttf (a static Regular instance
// of Google's Noto Sans SC, OFL licence beside it); everything else stays in
// the caller's Helvetica. The font is only embedded when some text needs it.
//
// Two pdf-lib traps live here so no caller meets them again:
// - its subsetter writes halved (short) glyph offsets, so the font file must
//   keep every glyph an even number of bytes long — the shipped file is
//   padded to 4; an unpadded one embeds corrupted characters while the page
//   still "renders";
// - its Helvetica widthOfTextAtSize subtracts kerning (e.g. "Tr") that
//   drawText never applies, so text placed after a Helvetica run would
//   overlap it — positions use summed character widths instead.

import { promises as fs } from 'fs';
import path from 'path';
import fontkit from '@pdf-lib/fontkit';
import { TextRenderingMode, popGraphicsState, pushGraphicsState, rgb, setLineWidth, setStrokingColor, setTextRenderingMode, type Color, type PDFDocument, type PDFFont, type PDFPage } from 'pdf-lib';

export class UnprintableTextError extends Error {}

// Read once, and only when a PDF needs it; a failed read isn't cached, so
// the next PDF tries again. Callers' routes must trace
// ./templates/client-invoice/** (next.config.ts outputFileTracingIncludes).
let fontBytes: Promise<Uint8Array> | null = null;
export const loadChineseFont = () => (fontBytes ??= fs.readFile(path.join(process.cwd(), 'templates', 'client-invoice', 'NotoSansSC-Regular.ttf')).then(
  b => new Uint8Array(b),
  err => { fontBytes = null; throw err; },
));

export type ChineseText = {
  // True when every character prints, in Helvetica or the Chinese font.
  canPrint(s: string): boolean;
  // What a viewer advances for s (throws UnprintableTextError if it can't print).
  widthOf(s: string, preferred: PDFFont, size: number): number;
  // Draws s from x on baseline y, Chinese characters in the Chinese font.
  draw(page: PDFPage, s: string, x: number, y: number, size: number, font: PDFFont, color?: Color): void;
};

// `texts` are all the strings the caller may draw; the Chinese font is
// embedded only if one of them needs it and `loadFont` is given. Throws
// UnprintableTextError when the font is needed but can't be loaded.
export async function prepareChineseText(pdf: PDFDocument, helvetica: PDFFont, texts: string[], loadFont?: () => Promise<Uint8Array>): Promise<ChineseText> {
  const helveticaCan = (s: string) => { try { helvetica.widthOfTextAtSize(s, 10); return true; } catch { return false; } };
  let cjk: PDFFont | null = null;
  let cjkChars = new Set<number>();
  if (loadFont && texts.some(t => !helveticaCan(t.replace(/[\r\n\t]/g, ' ')))) {
    try {
      pdf.registerFontkit(fontkit);
      cjk = await pdf.embedFont(await loadFont(), { subset: true });
      cjkChars = new Set(cjk.getCharacterSet());
    } catch (err) {
      throw new UnprintableTextError(`the Chinese font could not be loaded (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  // s split into runs of one font each.
  const runs = (s: string, preferred: PDFFont): [string, PDFFont][] => {
    if (!cjk || helveticaCan(s)) return [[s, preferred]];
    const out: [string, PDFFont][] = [];
    for (const ch of s) {
      let font = preferred;
      if (!helveticaCan(ch)) {
        if (!cjkChars.has(ch.codePointAt(0)!)) throw new UnprintableTextError(`"${s.slice(0, 40)}" has a character (U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}) no PDF font can print`);
        font = cjk;
      }
      const last = out[out.length - 1];
      if (last && last[1] === font) last[0] += ch; else out.push([ch, font]);
    }
    return out;
  };
  const advance = (t: string, font: PDFFont, size: number) => (font === cjk ? font.widthOfTextAtSize(t, size) : [...t].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size), 0));
  const widthOf = (s: string, preferred: PDFFont, size: number) => {
    try { return runs(s, preferred).reduce((w, [t, font]) => w + advance(t, font, size), 0); } catch (err) {
      if (err instanceof UnprintableTextError) throw err;
      throw new UnprintableTextError(`"${s.slice(0, 40)}" has characters the PDF font can't print`);
    }
  };
  return {
    canPrint: s => { try { widthOf(s, helvetica, 10); return true; } catch { return false; } },
    widthOf,
    draw: (page, s, x, y, size, font, color) => {
      widthOf(s, font, size); // refuses text no font can print before drawing any of it
      // The Chinese font is Regular only: inside bold text its characters are
      // drawn filled plus a thin outline (a faux bold, as word processors do
      // for fonts without a bold; the text itself is unchanged).
      const fauxBold = font.name.includes('Bold');
      let cx = x;
      for (const [t, f] of runs(s, font)) {
        const outline = fauxBold && f === cjk;
        if (outline) page.pushOperators(pushGraphicsState(), setTextRenderingMode(TextRenderingMode.FillAndOutline), setLineWidth(size * 0.035), setStrokingColor(color ?? rgb(0, 0, 0)));
        page.drawText(t, { x: cx, y, size, font: f, color });
        if (outline) page.pushOperators(popGraphicsState());
        cx += advance(t, f, size);
      }
    },
  };
}

// Word-wraps text to maxWidth as measured by widthOf; a word wider than the
// column (or Chinese text, which has no spaces) is broken by characters.
export function wrapText(text: string, widthOf: (s: string) => number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.replace(/\r/g, '').replace(/\t/g, ' ').split('\n')) {
    const words = paragraph.split(' ');
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (widthOf(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) out.push(line);
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
