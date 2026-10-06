// Plain text of a PDF, for checking what a PDF actually says (e.g. that an
// invoice attached in QuickBooks really is the unsplit original,
// lib/original-copy.ts). Set up exactly the way lib/bizfile-parse.ts does,
// which is proven in production:
// - pdfjs-dist's Node build needs a `DOMMatrix` at import time (its native
//   canvas addon fails to load in the deployed bundle); text extraction never
//   draws, so the small `dommatrix` polyfill is enough;
// - its worker script cannot be found by pdfjs itself inside the bundled
//   serverless output, so it is resolved next to pdf-parse's entry and given
//   as a file:// URL (a bare "C:\…" path is not a valid URL scheme on Windows).
// Routes that call this must trace ./node_modules/pdf-parse/** and
// ./node_modules/pdfjs-dist/** (next.config.ts outputFileTracingIncludes).

const PAGE_LIMIT = 6; // an invoice is one to three pages; never read a huge file in full

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
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
    return result.pages.map(page => page.text).join('\n');
  } finally {
    await parser.destroy();
  }
}
