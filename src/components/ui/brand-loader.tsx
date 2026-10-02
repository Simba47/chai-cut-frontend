'use client'

import { useEffect, useState } from 'react'
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

/** Short tips shown one after another while a page loads */
const TIPS = [
  'Press Space to play or pause',
  'Press S to trim at the playhead',
  'Click a section on the timeline to select it',
  'Check Instagram or YouTube view in Preview before you export',
  'Make my clips finds the best moments for you',
  'Extract the audio to set the volume of each part',
]

/**
 * Full-screen loader: page loads, and the moment between clicking and the next page appearing.
 * The mark sits in a turning lime ring with a soft glow, over a faint dot grid; under the label a
 * thin bar sweeps like progress and a tip changes every few seconds (styles: .bls-* in globals.css)
 */
export function BrandLoaderScreen({ label, overlay = false }: { label: string; overlay?: boolean }) {
  // Starts on the first tip (same on the server and in the browser), then picks a random one
  const [tip, setTip] = useState(0)
  useEffect(() => {
    setTip(Math.floor(Math.random() * TIPS.length))
    const t = setInterval(() => setTip(i => (i + 1) % TIPS.length), 3200)
    return () => clearInterval(t)
  }, [])
  return (
    <div className={`bls ${overlay ? 'fixed inset-0 z-[200]' : 'relative h-dvh'}`}>
      <div className="bls-grid" aria-hidden="true" />
      <div className="bls-glow" aria-hidden="true" />
      <div className="bls-center">
        <div className="bls-orbit" aria-hidden="true">
          <span className="bls-ring" />
          <span className="bls-ring bls-ring-2" />
        </div>
        <BrandLoader size={52} />
      </div>
      <p className="bls-label">{label}</p>
      <div className="bls-bar" aria-hidden="true"><span /></div>
      <p key={tip} className="bls-tip"><span>Tip</span>{TIPS[tip]}</p>
    </div>
  )
}
