'use client'

import { useId } from 'react'

// Vector Shortcut logo (replaces /logo.png) so it blends with any page and can animate.
// Styles: .brand-* in app/landing.css (global, not scoped to the landing page).
// `shine` adds a one-time light sweep (left → right) after the logo assembles.
// It uses SVG SMIL, whose clock starts at document load, so it plays on a
// full page load/refresh but not when the logo mounts later via client navigation.
export const BRAND_TOP = 'M36 2H92Q98 2 94 6L34 66A32 32 0 0 1 36 2Z'
export const BRAND_BOTTOM = 'M66 116H10Q4 116 8 112L68 52A32 32 0 0 1 66 116Z' // BRAND_TOP rotated 180° about (51, 59)

export function BrandLogo({ size = 'md', shine = false }: { size?: 'md' | 'sm'; shine?: boolean }) {
  const gradId = `brand-shine-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const shineFill = `url(#${gradId})`
  return (
    <span className={`brand brand-${size}${shine ? ' brand-shine-on' : ''}`}>
      <svg className="brand-mark" viewBox="0 0 102 118" aria-hidden>
        {shine && (
          <defs>
            <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="70" y2="-26" gradientTransform="translate(-100 0)">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.35" stopColor="#fff" stopOpacity="0.6" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="1" />
              <stop offset="0.65" stopColor="#fff" stopOpacity="0.6" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
              <animateTransform attributeName="gradientTransform" type="translate" from="-100 0" to="170 0" begin="1s" dur="0.9s" fill="freeze" />
            </linearGradient>
          </defs>
        )}
        <g className="brand-half brand-top">
          <path d={BRAND_TOP} />
          {shine && <path className="brand-shine" d={BRAND_TOP} fill={shineFill} />}
        </g>
        <g className="brand-half brand-bottom">
          <path d={BRAND_BOTTOM} />
          {shine && <path className="brand-shine" d={BRAND_BOTTOM} fill={shineFill} />}
        </g>
      </svg>
      <span className="brand-word">Shortcut</span>
    </span>
  )
}
