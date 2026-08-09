import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium'],
  outputFileTracingIncludes: {
    '/api/late-filing/sync': [
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
