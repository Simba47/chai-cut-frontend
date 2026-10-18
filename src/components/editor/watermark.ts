'use client'

import { useEffect, useState } from 'react'

/**
 * The Free-plan watermark (the Shortcut logo + name, no background), as the editor's preview draws
 * it. The export draws the same with the same numbers (chai-cut-backend python/render.py,
 * WATERMARK_*): its width, the gap from the right edge and from the bottom are shares of the frame,
 * so the preview shows exactly where the export will put it. The bottom gap lifts it above where
 * captions sit (their middle is at 84% of the height) and above the platforms' own caption area.
 */
export const WATERMARK_WIDTH = 0.28
export const WATERMARK_RIGHT = 0.04
export const WATERMARK_BOTTOM = 0.22
export const WATERMARK_OPACITY = 0.9
/** Its entrance: the S fades in at the mark's middle (LOGO_IN s), then over MOVE_S the S moves left
 *  to its place while the word slides out to the right from behind it, fading in (from TEXT_AT, over
 *  TEXT_S); then it holds. Shifts are shares of the mark's width (where each starts, from its place) */
const LOGO_IN = 0.35
const MOVE_AT = 0.35
const MOVE_S = 0.6
const TEXT_AT = 0.6
const TEXT_S = 0.35
const LOGO_SHIFT = 0.3503
const TEXT_SHIFT = -0.0953
/** Then, from SHINE_AT s, every SHINE_EVERY s a lime light sweeps across it (left to right, SHINE_S s):
 *  the white letters light up lime as it passes, the S brightens */
const SHINE_AT = 1.2
const SHINE_EVERY = 3.0
const SHINE_S = 0.9

type Layer = 'logo' | 'text'
const imgs: Record<Layer, HTMLImageElement | null> = { logo: null, text: null }
/** A layer's picture (public/watermark_logo.png, _text), loaded once */
function layer(k: Layer): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  if (!imgs[k]) { const im = new Image(); im.src = `/watermark_${k}.png`; imgs[k] = im }
  const im = imgs[k]!
  return im.complete && im.naturalWidth > 0 ? im : null
}

let shine: HTMLCanvasElement | null = null
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const ease = (q: number) => (q < 0.5 ? 4 * q * q * q : 1 - Math.pow(2 - 2 * q, 3) / 2)

/** Draws the mark over what is already on `ctx` (a canvas `w` × `h`) as it looks at `tMs` into the
 *  clip; nothing until its pictures have loaded */
export function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, tMs: number) {
  const logo = layer('logo'), text = layer('text')
  if (!logo || !text) return
  const T = Math.max(0, tMs / 1000)
  const mw = Math.max(2, Math.round(w * WATERMARK_WIDTH / 2) * 2), mh = Math.round(mw * logo.naturalHeight / logo.naturalWidth)
  const x = w - mw - Math.round(w * WATERMARK_RIGHT)
  const y = h - mh - Math.round(h * WATERMARK_BOTTOM)
  const rest = 1 - ease(clamp01((T - MOVE_AT) / MOVE_S))
  const ph = (T - SHINE_AT) % SHINE_EVERY
  if (T >= SHINE_AT && ph < SHINE_S && rest === 0) {
    // In place and the light passing: the mark drawn on its own, the light laid on its pixels only
    if (!shine) shine = document.createElement('canvas')
    if (shine.width !== mw || shine.height !== mh) { shine.width = mw; shine.height = mh }
    const sx = shine.getContext('2d')!
    sx.globalCompositeOperation = 'source-over'
    sx.clearRect(0, 0, mw, mh)
    sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high'
    sx.drawImage(text, 0, 0, mw, mh); sx.drawImage(logo, 0, 0, mw, mh)
    // (the band: centre line X - 0.25·Y = c, as the export's)
    const c = (-0.25 + 1.5 * ph / SHINE_S) * mw, bw = 0.22 * mw, k = 1 / (1 + 0.25 * 0.25)
    const g = sx.createLinearGradient((c - bw) * k, -(c - bw) * k * 0.25, (c + bw) * k, -(c + bw) * k * 0.25)
    g.addColorStop(0, 'rgba(200,255,30,0)'); g.addColorStop(0.5, 'rgba(200,255,30,1)'); g.addColorStop(1, 'rgba(200,255,30,0)')
    sx.globalCompositeOperation = 'source-atop'
    sx.fillStyle = g; sx.fillRect(0, 0, mw, mh)
    ctx.save(); ctx.globalAlpha = WATERMARK_OPACITY; ctx.drawImage(shine, x, y); ctx.restore()
    return
  }
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // (the word under the S: it comes out from behind it)
  ctx.globalAlpha = WATERMARK_OPACITY * clamp01((T - TEXT_AT) / TEXT_S)
  if (ctx.globalAlpha > 0) ctx.drawImage(text, x + TEXT_SHIFT * mw * rest, y, mw, mh)
  ctx.globalAlpha = WATERMARK_OPACITY * clamp01(T / LOGO_IN)
  if (ctx.globalAlpha > 0) ctx.drawImage(logo, x + LOGO_SHIFT * mw * rest, y, mw, mh)
  ctx.restore()
}

let planAsked: Promise<boolean> | null = null
/** Whether the signed-in user's plan puts the watermark on exports (the Free plan): asked once per page */
export function useFreeWatermark(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let live = true
    if (!planAsked) {
      planAsked = fetch('/api/billing/plan').then(r => r.json()).then((d: { watermark?: boolean }) => d.watermark === true).catch(() => { planAsked = null; return false })
    }
    planAsked.then(v => { if (live) setOn(v) })
    return () => { live = false }
  }, [])
  return on
}
