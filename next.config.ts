import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['playwright', 'playwright-core', '@sparticuz/chromium'],
};

export default nextConfig;
