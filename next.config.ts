import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  // Let phones/laptops on the same Wi-Fi open the dev server (http://192.168.x.x:3000).
  // Next blocks dev scripts for non-localhost origins otherwise, so nothing is interactive.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*'],
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
