// What a PDF says and what it is, for checking that an invoice attached in
// QuickBooks really is the original (lib/original-copy.ts, INV-QB-037).
//
// The text is read the way lib/bizfile-parse.ts reads Bizfile PDFs, which is
// proven in production:
// - pdfjs-dist's Node build needs a `DOMMatrix` at import time (its native
//   canvas addon fails to load in the deployed bundle); text extraction never
//   draws, so the small `dommatrix` polyfill is enough;
// - its worker script cannot be found by pdfjs itself inside the bundled
//   serverless output, so it is resolved next to pdf-parse's entry and given
//   as a file:// URL (a bare "C:\…" path is not a valid URL scheme on Windows).
// Routes that call this must trace ./node_modules/pdf-parse/** and
// ./node_modules/pdfjs-dist/** (next.config.ts outputFileTracingIncludes).
//
// The file is ALSO loaded with pdf-lib, which is what the SOA merges it with
// (app/api/billing/soa/pdf/route.ts): pdf.js reads a file that has only an
// owner password, pdf-lib refuses it, and that invoice would silently drop out
// of the SOA. So a file pdf-lib cannot load is an error here, not a candidate.
// updateMetadata: false is essential — by default pdf-lib overwrites the
// Producer with its own name on load, which would hide "Tassure" (the system's
// own drawing) behind "pdf-lib".

import { PDFDocument } from 'pdf-lib';
import type { PdfFacts } from './original-copy';

const PAGE_LIMIT = 6; // an invoice is one to three pages; never read a huge file in full

export async function readPdf(bytes: Uint8Array): Promise<PdfFacts> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });

  if (!('DOMMatrix' in globalThis)) {
    const { default: DOMMatrixPolyfill } = await import('dommatrix');
    (globalThis as unknown as { DOMMatrix: unknown }).DOMMatrix = DOMMatrixPolyfill;
  }
  const path = await import('path');
  const { pathToFileURL } = await import('url');
  const { createRequire } = await import('module');
  const entry = createRequire(process.cwd() + '/package.json').resolve('pdf-parse');
  const workerSrc = pathToFileURL(path.default.resolve(path.default.dirname(entry), 'pdf.worker.mjs')).href;

  const { PDFParse } = await import('pdf-parse');
  PDFParse.setWorker(workerSrc);
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const result = await parser.getText({ first: PAGE_LIMIT });
    if (result.total !== doc.getPageCount()) throw new Error(`the two PDF readers disagree on the page count (${result.total} and ${doc.getPageCount()})`);
    const pages = result.pages.map(page => page.text);
    return { text: pages.join('\n'), pages, totalPages: result.total, producer: doc.getProducer() ?? null };
  } finally {
    await parser.destroy();
  }
}
