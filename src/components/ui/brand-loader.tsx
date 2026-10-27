'use client'

import { BRAND_BOTTOM, BRAND_TOP } from '@/components/ui/brand-logo'
import { PandaLoader } from '@/components/ui/panda-loader'
import type { MascotScene } from '@/components/ui/mascot'

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

/**
 * Full-screen loader: page loads, and the moment between clicking and the next page appearing.
 * The mark sits in a soft lime glow, over a faint dot grid; under the label a lime streak with a
 * glowing head sweeps along a hairline track (styles: .bls-* in globals.css).
 * `mascot`: the Shortcut panda instead of the mark alone — true / 'editor': it lounges while its
 * laptop makes clips (opening the editing board); 'clipboard': it walks along, typing (opening the
 * clip board) — on a black page, as its walk is filmed on black; 'dashboard': it naps at its desk
 * (loading the videos), on black too.
 */
export function BrandLoaderScreen({ label, overlay = false, mascot = false }: { label: string; overlay?: boolean; mascot?: boolean | MascotScene }) {
  return (
    <div className={`bls ${overlay ? 'fixed inset-0 z-[200]' : 'relative h-dvh'}`} data-mascot={mascot === true ? 'editor' : mascot || undefined} role={mascot ? 'status' : undefined}>
      <div className="bls-grid" aria-hidden="true" />
      <div className="bls-glow" aria-hidden="true" />
      {mascot ? (
        // (nothing in its place until the panda's picture has loaded — not the plain mark: a mark
        // that then turns into the panda looked like two loaders — the panda fades in on its own)
        <div className="bls-mascot"><PandaLoader scene={mascot === true ? 'editor' : mascot} /></div>
      ) : (
        <div className="bls-center">
          <BrandLoader size={52} />
        </div>
      )}
      <p className="bls-label">{label}</p>
      <div className="bls-bar" aria-hidden="true"><span /></div>
    </div>
  )
}
