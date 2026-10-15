import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  // Let phones/laptops on the same Wi-Fi open the dev server (http://192.168.x.x:3000).
  // Next blocks dev scripts for non-localhost origins otherwise, so nothing is interactive.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*'],
  // The mascot picture (the loader's panda) is kept by the browser for a week, so the loader shows it at once
  async headers() {
    return [{ source: '/mascot/:path*', headers: [{ key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=2592000' }] }]
  },
experimental: {
    serverActions: {
      bodySizeLimit: '2gb',
    },
    // Raise the 10 MB default cap on incoming request bodies for route handlers.
    // Without this, uploads > 10 MB are silently truncated before busboy reads them.
    middlewareClientMaxBodySize: 2 * 1024 * 1024 * 1024,
  },
}

export default nextConfig
