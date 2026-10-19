'use client'

import { useEffect, useState } from 'react'

/**
 * The Free-plan watermark ("MADE WITH" over the Shortcut logo + name, no background), as the
 * editor's preview draws it. The export draws the same with the same numbers (chai-cut-backend python/render.py,
 * WATERMARK_*): its width and where it sits are shares of the frame, so the preview shows exactly
 * where the export will put it. Top left, below the apps' own top bar: the right side and the bottom
 * of a Reel / TikTok / Short are under the apps' buttons and caption. A soft shadow under it keeps
 * it readable on bright video.
 */
export const WATERMARK_WIDTH = 0.22
/** The left of the S from the frame's left; the top of "MADE WITH" from the frame's top */
export const WATERMARK_LEFT = 0.05
export const WATERMARK_TOP = 0.12
export const WATERMARK_OPACITY = 0.9
/** The shadow: black at this opacity, blurred (sigma) and dropped by these shares of the mark's width */
const SHADOW_A = 0.55
const SHADOW_BLUR = 0.014
const SHADOW_Y = 0.008
/** It plays in a loop of LOOP_S s (the times below are into each loop), as the sign-in page's heading
 *  does (components/auth/AuthSlider.tsx PanelTitle): the S pops in at the word's middle (grows from
 *  POP_FROM with a little overshoot, over POP_S), then from SPLIT_AT, over SPLIT_S, it splits: its top
 *  half slides left to the S's place, its bottom half slides right to the word's end, and the word
 *  opens from its middle between them. Then the bottom half fades away at the end of the word as the
 *  S's bottom fades in at its place (from SETTLE_AT, over SETTLE_S), and "MADE WITH" fades in above
 *  (from MADE_AT, over MADE_S). Places are shares of the mark's width or height (the layers are
 *  641 x 216): the S's centre, the word's middle and half its width */
const POP_S = 0.45
const POP_FROM = 0.4
const SPLIT_AT = 0.6
const SPLIT_S = 0.75
const SETTLE_AT = 1.35
const SETTLE_S = 0.35
const MADE_AT = 1.6
const MADE_S = 0.4
const S_CX = 97 / 641, S_CY = 115 / 216
const WORD_CX = 382 / 641, WORD_HALF = 230 / 641
/** "MADE WITH" (public/watermark_made.png, the mark's width, its letters starting where the word
 *  does) has its top this share of the mark's width above the mark's top */
const MADE_RISE = 0.08
/** While it is all in, from SHINE_AT, SHINE_N times every SHINE_EVERY s a lime light sweeps across the
 *  logo and name (left to right, SHINE_S s): the white letters light up lime as it passes */
const SHINE_AT = 2.2
const SHINE_EVERY = 2.4
const SHINE_N = 2
const SHINE_S = 0.9
/** Fully in for 5 s (to OUT_AT), it all fades out over OUT_S, stays away until the loop starts again */
const OUT_AT = 7.0
const OUT_S = 0.6
const LOOP_S = 9.1

type Layer = 'logo_top' | 'logo_bottom' | 'text' | 'made'
const imgs: Record<Layer, HTMLImageElement | null> = { logo_top: null, logo_bottom: null, text: null, made: null }
/** A layer's picture (public/watermark_logo_top.png, _logo_bottom, _text, _made), loaded once */
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
  const top = layer('logo_top'), bottom = layer('logo_bottom'), text = layer('text'), made = layer('made')
  if (!top || !bottom || !text || !made) return
  const T = Math.max(0, tMs / 1000) % LOOP_S
  const out = 1 - clamp01((T - OUT_AT) / OUT_S)
  if (out <= 0) return
  const mw = Math.max(2, Math.round(w * WATERMARK_WIDTH / 2) * 2), mh = Math.round(mw * top.naturalHeight / top.naturalWidth)
  // (the layers are 641 wide: the S starts at 39, "MADE WITH"'s letters at y 43)
  const x = Math.round(w * WATERMARK_LEFT) - Math.round(mw * 39 / 641)
  const madeY = Math.round(h * WATERMARK_TOP) - Math.round(mw * 43 / 641)
  const y = madeY + Math.round(mw * MADE_RISE)
  const A = WATERMARK_OPACITY * out
  ctx.save()
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  // (a canvas shadow's blur is twice the export's sigma)
  ctx.shadowColor = `rgba(0,0,0,${SHADOW_A})`
  ctx.shadowBlur = 2 * Math.max(1, mw * SHADOW_BLUR)
  ctx.shadowOffsetY = Math.max(1, Math.round(mw * SHADOW_Y))
  // "MADE WITH", above (never in the light)
  ctx.globalAlpha = A * clamp01((T - MADE_AT) / MADE_S)
  if (ctx.globalAlpha > 0) ctx.drawImage(made, x, madeY, mw, Math.round(mw * made.naturalHeight / made.naturalWidth))
  const e = ease(clamp01((T - SPLIT_AT) / SPLIT_S))
  const settle = clamp01((T - SETTLE_AT) / SETTLE_S)
  const ph = (T - SHINE_AT) % SHINE_EVERY
  if (T >= SHINE_AT && T < SHINE_AT + SHINE_N * SHINE_EVERY && ph < SHINE_S && settle === 1) {
    // All in place and the light passing: the mark drawn on its own, the light laid on its pixels only
    if (!shine) shine = document.createElement('canvas')
    if (shine.width !== mw || shine.height !== mh) { shine.width = mw; shine.height = mh }
    const sx = shine.getContext('2d')!
    sx.globalCompositeOperation = 'source-over'
    sx.clearRect(0, 0, mw, mh)
    sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high'
    sx.drawImage(text, 0, 0, mw, mh); sx.drawImage(top, 0, 0, mw, mh); sx.drawImage(bottom, 0, 0, mw, mh)
    // (the band: centre line X - 0.25·Y = c, as the export's)
    const c = (-0.25 + 1.5 * ph / SHINE_S) * mw, bw = 0.22 * mw, k = 1 / (1 + 0.25 * 0.25)
    const g = sx.createLinearGradient((c - bw) * k, -(c - bw) * k * 0.25, (c + bw) * k, -(c + bw) * k * 0.25)
    g.addColorStop(0, 'rgba(200,255,30,0)'); g.addColorStop(0.5, 'rgba(200,255,30,1)'); g.addColorStop(1, 'rgba(200,255,30,0)')
    sx.globalCompositeOperation = 'source-atop'
    sx.fillStyle = g; sx.fillRect(0, 0, mw, mh)
    ctx.globalAlpha = A; ctx.drawImage(shine, x, y)
    ctx.restore()
    return
  }
  // The word, opening from its middle as the halves part
  if (e > 0) {
    ctx.save()
    ctx.beginPath(); ctx.rect(x + (WORD_CX - e * WORD_HALF) * mw, y - mh, 2 * e * WORD_HALF * mw, 3 * mh); ctx.clip()
    ctx.globalAlpha = A; ctx.drawImage(text, x, y, mw, mh)
    ctx.restore()
  }
  // The S's halves: the pop's size (POP_FROM -> 1, a little past 1 and back) about the S's centre
  const pp = clamp01(T / POP_S)
  const size = POP_FROM + (1 - POP_FROM) * (1 + 2.2 * Math.pow(pp - 1, 3) + 1.2 * Math.pow(pp - 1, 2))
  const popA = Math.min(1, 2 * pp)
  const half = (im: HTMLImageElement, shift: number, alpha: number, popped: boolean) => {
    ctx.globalAlpha = A * alpha
    if (ctx.globalAlpha <= 0) return
    const sz = popped ? size : 1
    const lx = x + shift * mw, cx = lx + S_CX * mw, cy = y + S_CY * mh
    ctx.drawImage(im, cx - S_CX * mw * sz, cy - S_CY * mh * sz, mw * sz, mh * sz)
  }
  const start = WORD_CX - S_CX, end = WORD_CX + WORD_HALF - S_CX
  half(top, start * (1 - e), popA, true)
  half(bottom, start + (end - start) * e, popA * (1 - settle), true)
  half(bottom, 0, settle, false)
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
