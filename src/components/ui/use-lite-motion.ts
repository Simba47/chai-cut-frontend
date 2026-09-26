'use client'

import { useSyncExternalStore } from 'react'
import type { MotionStyle } from 'framer-motion'

// Phones, tablets and other touch-first screens. Scroll-linked effects (per-frame
// blur, scale, 3D tilt, clip-path reveals) stutter badly on their GPUs, so the
// landing page skips them there and scrolls plainly.
const QUERY = '(max-width: 959px), (pointer: coarse)'

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

// Resting value for every animated property the landing page uses. When effects
// are switched off we must *set* these: dropping the style prop would leave the
// last animated values (e.g. opacity .2, a blur filter, clip-path) stuck inline.
const NEUTRAL: Record<string, string | number> = {
  opacity: 1, scale: 1, x: 0, y: 0, rotateX: 0,
  filter: 'none', clipPath: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0,
}

/** The given motion style with each property replaced by its resting value. */
export function neutralStyle(style: MotionStyle): MotionStyle {
  const out: Record<string, string | number> = {}
  for (const key of Object.keys(style)) if (key in NEUTRAL) out[key] = NEUTRAL[key]
  return out as MotionStyle
}

export function useLiteMotion() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
