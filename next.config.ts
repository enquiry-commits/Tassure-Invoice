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
  },
};

export default nextConfig;
