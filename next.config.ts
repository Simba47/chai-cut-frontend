import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  transpilePackages: ['@chai-cut/shared'],
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
