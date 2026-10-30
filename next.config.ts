import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  devIndicators: false,
  // React's compiler, only for components marked 'use memo' (the editor): it keeps the parts of the
  // editor that didn't change, so a drag no longer rebuilds the whole editor on every mouse move
  // (measured 2026-10-26: half the main-thread work per drag, the same saves)
  reactCompiler: { compilationMode: 'annotation' },
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
