'use client'

import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Desktop scroll animation for a landing section, in the same style as the Features fly-through:
 * the section pins to the screen and, as you scroll, its pieces come out of the depth (from a point
 * near the middle, small and tilted) and land in their normal places, one after another; then the
 * section lets go and the page scrolls on. The heading settles in first.
 *
 *  - pieces: a selector for what flies in (cards, visuals, rows), in page order
 *  - pin:    how much scrolling (in screens) the landing takes
 *
 * If the content can't fit one screen even at 70% size, it doesn't pin: the pieces fly in as the
 * section scrolls into view instead. Off (`on` false: phones, tablets, reduced motion), the section
 * renders as it always did. Once landed, a piece has no transform at all, so it's crisp and its own
 * hover effects work. Styles: .fly-* in app/landing.css.
 */

const NAV_H = 60                     // the sticky nav covers this much of the top of the screen
const MIN_ZOOM = 0.7                 // below this the section doesn't pin
const DEPTH = 1500                   // how far back a piece starts (px)
const SPAN = 0.5                     // share of the landing each piece spends flying
const ease = (x: number) => 1 - (1 - x) ** 3
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))

function docTop(el: HTMLElement) {
  let y = 0
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop
  return y
}

export function FlyIn({ on, pieces, pin = 0.9, from = 'centre', children }: { on: boolean; pieces: string; pin?: number; from?: 'centre' | 'above'; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const fit = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const o = outer.current, st = stage.current, f = fit.current
    if (!on || !o || !st || !f) return
    type Piece = { el: HTMLElement; dx: number; dy: number; rot: number; start: number }
    let list: Piece[] = []
    let head: HTMLElement | null = null
    let pinned = false, pinPx = 0, zoom = 1, raf = 0, last = -2

    const clear = (el: HTMLElement) => { el.style.transform = ''; el.style.opacity = ''; el.style.willChange = '' }

    // Lay out (pin or not, the zoom) and measure where each piece lands
    const measure = () => {
      list.forEach(p => clear(p.el))
      if (head) clear(head)
      f.style.zoom = ''
      o.style.height = ''
      o.classList.add('fly-pinned')                  // measure in the pinned layout (its tighter padding)
      const avail = window.innerHeight - NAV_H - 24
      const h = f.offsetHeight
      zoom = Math.min(1, avail / h)
      pinned = zoom >= MIN_ZOOM
      if (!pinned) o.classList.remove('fly-pinned')
      if (pinned) {
        f.style.zoom = zoom < 1 ? String(zoom) : ''
        pinPx = window.innerHeight * pin
        o.style.height = `${window.innerHeight - NAV_H + pinPx}px`
        o.dataset.pin = String(Math.round(pinPx))
      } else {
        delete o.dataset.pin
      }
      const box = st.getBoundingClientRect()
      const cx = box.left + box.width / 2, cy = box.top + Math.min(box.height, window.innerHeight) / 2
      head = st.querySelector<HTMLElement>('.section-head')
      const els = [...st.querySelectorAll<HTMLElement>(pieces)]
      list = els.map((el, i) => {
        const r = el.getBoundingClientRect()
        const z = pinned ? zoom : 1
        return {
          el,
          // from near the middle (pulled most of the way toward the centre of the stage), or down from
          // above the screen, a little toward the middle
          dx: -((r.left + r.width / 2) - cx) * (from === 'above' ? 0.25 : 0.62) / z,
          dy: from === 'above' ? -(r.bottom - box.top + 120) / z : -((r.top + r.height / 2) - cy) * 0.62 / z,
          rot: (i % 2 ? -1 : 1) * (4 + (i % 3) * 2),
          start: 0.1 + (els.length > 1 ? i / (els.length - 1) : 0) * (1 - SPAN - 0.12),
        }
      })
      last = -2
      update()
    }

    // How far through the landing we are (0 → 1)
    const progress = () => {
      if (pinned) return (window.scrollY + NAV_H - docTop(o)) / pinPx   // 0 when the stage pins under the nav
      const top = o.getBoundingClientRect().top
      return (window.innerHeight * 0.92 - top) / (window.innerHeight * 0.72)
    }

    const update = () => {
      raf = 0
      const r = o.getBoundingClientRect()
      if (r.bottom < -200 || r.top > window.innerHeight + 200) return   // off screen: nothing to do
      const p = progress()
      if (Math.abs(p - last) < 0.0005) return
      last = p
      if (head) {
        const e = ease(clamp01((p + 0.25) / 0.4))
        if (e >= 1) clear(head)
        else { head.style.opacity = String(0.25 + 0.75 * e); head.style.transform = `scale(${(0.92 + 0.08 * e).toFixed(4)})` }
      }
      for (const pc of list) {
        const k = clamp01((p - pc.start) / SPAN)
        if (k >= 1) { if (pc.el.style.transform) clear(pc.el); continue }
        const e = ease(k), q = 1 - e
        pc.el.style.willChange = 'transform, opacity'
        pc.el.style.opacity = String(clamp01(k * 2.4))
        pc.el.style.transform = `perspective(1200px) translate3d(${(pc.dx * q).toFixed(1)}px, ${(pc.dy * q).toFixed(1)}px, ${(-DEPTH * q).toFixed(1)}px) rotateZ(${(pc.rot * q).toFixed(2)}deg)`
      }
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }

    measure()
    const settle = setTimeout(measure, 400)       // after fonts and the page's own fit-to-screen
    document.fonts?.ready.then(measure)
    let rt = 0
    const onResize = () => { clearTimeout(rt); rt = window.setTimeout(measure, 150) }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(settle); clearTimeout(rt); cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      list.forEach(p => clear(p.el)); if (head) clear(head)
      f.style.zoom = ''; o.style.height = ''; o.classList.remove('fly-pinned'); delete o.dataset.pin
    }
  }, [on, pieces, pin, from])

  return (
    <div ref={outer} className={on ? 'fly' : undefined}>
      <div ref={stage} className="fly-stage">
        <div ref={fit} className="fly-fit">{children}</div>
      </div>
    </div>
  )
}
