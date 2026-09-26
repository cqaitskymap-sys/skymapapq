/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Webpack worker inherits NODE_OPTIONS from scripts/next-build.mjs
    // (isolatedMemory is false). Static page-data workers stay at 1 CPU.
    webpackBuildWorker: true,
    webpackMemoryOptimizations: true,
    cpus: 1,
  },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    }];
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'apq-skymap.firebasestorage.app' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
    ],
  },
};

module.exports = nextConfig;
