'use client'

import { useEffect, useState } from 'react'

/**
 * The Free-plan watermark (the Shortcut logo + name, no background), as the editor's preview draws it. The export draws
 * the same badge with the same numbers (chai-cut-backend python/render.py, WATERMARK_*): its width,
 * the gap from the right edge and from the bottom are shares of the frame, so the preview shows
 * exactly where the export will put it. The bottom gap lifts it above where captions sit (their
 * middle is at 84% of the height) and above the platforms' own caption area.
 */
export const WATERMARK_WIDTH = 0.24
export const WATERMARK_RIGHT = 0.04
export const WATERMARK_BOTTOM = 0.22
export const WATERMARK_OPACITY = 0.75
/** Its motion: in the first INTRO_S it rises by INTRO_RISE of its height and fades in; from
 *  SHINE_FIRST_S on, every SHINE_EVERY_S a light (BAND of its width each side, GAIN brightness)
 *  takes SHINE_S to sweep across it */
const INTRO_S = 0.6
const INTRO_RISE = 0.35
const SHINE_FIRST_S = 1.0
const SHINE_EVERY_S = 5.0
const SHINE_S = 0.9
const SHINE_BAND = 0.12
const SHINE_GAIN = 70

let markImg: HTMLImageElement | null = null
/** The badge's picture (public/watermark.png), loaded once */
function mark(): HTMLImageElement | null {
  if (typeof Image === 'undefined') return null
  if (!markImg) { markImg = new Image(); markImg.src = '/watermark.png' }
  return markImg.complete && markImg.naturalWidth > 0 ? markImg : null
}

let work: HTMLCanvasElement | null = null, light: HTMLCanvasElement | null = null, glint: HTMLCanvasElement | null = null
const canvasOf = (c: HTMLCanvasElement | null, w: number, h: number) => {
  const el = c ?? document.createElement('canvas')
  if (el.width !== w || el.height !== h) { el.width = w; el.height = h }
  return el
}

/** Draws the badge over what is already on `ctx` (a canvas `w` × `h`) as it looks at `tMs` into
 *  the clip; nothing until its picture has loaded */
export function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, tMs: number) {
  const img = mark()
  if (!img) return
  const T = Math.max(0, tMs / 1000)
  const mw = Math.max(2, Math.round(w * WATERMARK_WIDTH / 2) * 2), mh = Math.round(mw * img.naturalHeight / img.naturalWidth)
  const p = Math.min(1, T / INTRO_S), ease = 1 - Math.pow(1 - p, 3)
  const x = w - mw - Math.round(w * WATERMARK_RIGHT)
  const y = h - mh - Math.round(h * WATERMARK_BOTTOM) + mh * INTRO_RISE * Math.pow(1 - p, 3)

  let src: CanvasImageSource = img, shine: CanvasImageSource | null = null
  const phase = (T - SHINE_FIRST_S) % SHINE_EVERY_S
  if (T >= SHINE_FIRST_S && phase < SHINE_S) {
    // the light: a soft diagonal band (along X - 0.35·Y). It brightens the colour (seen on the lime
    // logo) and lifts the mark to fully solid (seen on the white word): a glint running along it.
    // Weighted by the mark's own alpha, so its soft shadow stays as it is.
    work = canvasOf(work, mw, mh); light = canvasOf(light, mw, mh); glint = canvasOf(glint, mw, mh)
    const wc = work.getContext('2d')!, lc = light.getContext('2d')!, gc = glint.getContext('2d')!
    wc.globalCompositeOperation = 'copy'; wc.drawImage(img, 0, 0, mw, mh)
    const band = SHINE_BAND * mw, centre = -band + (mw * (1 + 2 * SHINE_BAND) + 0.35 * mh) * phase / SHINE_S
    const k = 1 / (1 + 0.35 * 0.35)
    const bandOf = (peak: number) => {
      const g = lc.createLinearGradient((centre - band) * k, -(centre - band) * k * 0.35, (centre + band) * k, -(centre + band) * k * 0.35)
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, `rgba(255,255,255,${peak})`); g.addColorStop(1, 'rgba(255,255,255,0)')
      return g
    }
    // the brighter colour
    lc.globalCompositeOperation = 'copy'; lc.fillStyle = bandOf(SHINE_GAIN / 255); lc.fillRect(0, 0, mw, mh)
    lc.globalCompositeOperation = 'destination-in'; lc.drawImage(work, 0, 0); lc.drawImage(work, 0, 0)
    wc.globalCompositeOperation = 'lighter'; wc.drawImage(light, 0, 0)
    // the lift to solid: the lit mark again, only under the band, drawn fully over the first pass
    gc.globalCompositeOperation = 'copy'; gc.fillStyle = bandOf(1); gc.fillRect(0, 0, mw, mh)
    gc.globalCompositeOperation = 'source-in'; gc.drawImage(work, 0, 0)
    gc.globalCompositeOperation = 'destination-in'; gc.drawImage(work, 0, 0)
    src = work; shine = glint
  }
  ctx.save()
  ctx.globalAlpha = WATERMARK_OPACITY * ease
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, x, y, mw, mh)
  if (shine) { ctx.globalAlpha = 1; ctx.drawImage(shine, x, y, mw, mh) }
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
