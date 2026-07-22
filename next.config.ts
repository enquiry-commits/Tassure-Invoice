import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium'],
  outputFileTracingIncludes: {
    '/api/late-filing/sync': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
    ],
    // TEMPORARY — remove alongside the route once used
    '/api/teamwork/debug-company-status': [
      './node_modules/playwright-core/**',
      './node_modules/@sparticuz/chromium/**',
    ],
  },
};

export default nextConfig;
