import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium'],
  outputFileTracingIncludes: {
    '/api/late-filing/sync': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
    ],
    // Same real error as /api/late-filing/sync above ("Cannot find module
    // .../playwright-core/browsers.json") hit in production 2026-09-23 on
    // this route's very first 3 real cron attempts — Next.js's automatic
    // file-tracing doesn't reliably pick up playwright-core's own
    // non-import asset files for every route that dynamically imports it
    // (lib/teamwork-nd.ts's identical import happens to get traced
    // correctly; this one didn't), so needs the same explicit include.
    '/api/sg-news/sync': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
    ],
    '/api/post-incorporate/generate': [
      './templates/post-incorporate/**',
    ],
    // pdfjs-dist (used by pdf-parse internally, and directly by
    // lib/bizfile-parse.ts for coordinate-based table extraction) resolves
    // its worker script's path at runtime via a dynamic require().resolve()
    // — not statically analyzable — so it needs an explicit include or the
    // deployed function won't actually have pdf.worker.mjs on disk.
    '/api/post-incorporate/parse-bizfile': [
      './node_modules/pdf-parse/**',
      './node_modules/pdfjs-dist/**',
    ],
  },
};

export default nextConfig;
