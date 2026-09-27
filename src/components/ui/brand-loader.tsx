'use client'

import { BRAND_BOTTOM, BRAND_TOP } from '@/components/ui/brand-logo'

/**
 * Loading indicator made from the Shortcut mark: the two slashes of the "S" drift apart,
 * snap back together with a soft lime glow, and repeat. (styles: .brand-loader in app/globals.css)
 */
export function BrandLoader({ size = 44, label }: { size?: number; label?: string }) {
  return (
    <div className="brand-loader" role="status" aria-live="polite">
      <svg viewBox="-12 -12 126 142" style={{ height: size, width: 'auto' }} aria-hidden>
        <g className="brand-loader-top"><path d={BRAND_TOP} /></g>
        <g className="brand-loader-bottom"><path d={BRAND_BOTTOM} /></g>
      </svg>
      {label ? <p className="brand-loader-label">{label}</p> : <span className="sr-only">Loading…</span>}
    </div>
  )
}
