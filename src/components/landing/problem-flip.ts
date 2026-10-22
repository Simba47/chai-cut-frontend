'use client'

import { useEffect, type RefObject } from 'react'

/**
 * Desktop scroll story for the Problem section (markup: ProblemSection with `flip`; styles: .pf-* in
 * app/landing.css). One clock, driven by scrolling:
 *   rise   while the section slides up over the hero, the three cards come up out of it as a deck
 *          (stacked in the middle, tilted back, small)
 *   deal   the section pins; the deck deals out, each card sliding to its place
 *   flip   each card turns over, one after another, to its fix (lime back face)
 *   hand   the cards settle and a lime line grows from each down to the next section (How it works)
 * Then it lets go. Settled cards carry no transform, so they're crisp and their hovers work.
 */

const NAV_H = 60
const PIN = 2                       // screens of scrolling the deal + flips take
const ease = (x: number) => 1 - (1 - x) ** 3
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2)
const clamp01 = (x: number) => Math.max(0, Math.min(1, x))
const STACK_ROT = [-5, 3, 8]        // each card's tilt in the deck

function docTop(el: HTMLElement) {
  let y = 0
  for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop
  return y
}

export function useProblemFlip(on: boolean, outerRef: RefObject<HTMLDivElement | null>, stageRef: RefObject<HTMLDivElement | null>, fitRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const o = outerRef.current, st = stageRef.current, f = fitRef.current
    if (!on || !o || !st || !f) return
    let cards: HTMLElement[] = [], flips: HTMLElement[] = [], bridges: HTMLElement[] = []
    let head: HTMLElement | null = null
    let dx: number[] = []
    let pinPx = 0, zoom = 1, raf = 0, lastKey = ''

    const measure = () => {
      cards.forEach(c => { c.style.transform = ''; c.style.zIndex = '' })
      flips.forEach(c => { c.style.transform = '' })
      f.style.zoom = ''
      o.style.height = ''
      o.classList.add('pf-pinned')
      const avail = window.innerHeight - NAV_H - 24
      zoom = Math.min(1, avail / f.offsetHeight)
      f.style.zoom = zoom < 1 ? String(zoom) : ''
      pinPx = window.innerHeight * PIN
      o.style.height = `${window.innerHeight - NAV_H + pinPx}px`
      o.dataset.pin = String(Math.round(pinPx))
      head = st.querySelector<HTMLElement>('.section-head')
      cards = [...st.querySelectorAll<HTMLElement>('.pf-card')]
      flips = cards.map(c => c.querySelector<HTMLElement>('.pf-flip')!)
      bridges = cards.map(c => c.querySelector<HTMLElement>('.pf-bridge')!)
      // the deck sits in the middle of the row: how far each card is from there (unzoomed px)
      const box = st.getBoundingClientRect(), cx = box.left + box.width / 2
      dx = cards.map(c => { const r = c.getBoundingClientRect(); return (cx - (r.left + r.width / 2)) / zoom })
      lastKey = ''
      update()
    }

    const update = () => {
      raf = 0
      const r = o.getBoundingClientRect()
      if (r.bottom < -200 || r.top > window.innerHeight * 1.2) return
      const vh = window.innerHeight
      const rise = ease(clamp01((vh - r.top) / (vh - NAV_H)))              // 0 → 1 as the section slides up
      const p = clamp01((window.scrollY + NAV_H - docTop(o)) / pinPx)       // 0 → 1 while pinned
      const key = `${rise.toFixed(4)}|${p.toFixed(4)}`
      if (key === lastKey) return
      lastKey = key
      const out = easeInOut(clamp01((p - 0.86) / 0.14))                     // the hand-off at the end
      if (head) {
        const o2 = 0.3 + 0.7 * rise - 0.35 * out
        head.style.opacity = o2 >= 0.999 ? '' : String(o2)
      }
      cards.forEach((c, i) => {
        const deal = easeInOut(clamp01((p - 0.02 - i * 0.07) / 0.24))
        const q = 1 - deal
        const x = dx[i] * q + (i - 1) * 14 * q
        const y = -i * 10 * q + (1 - rise) * vh * 0.42 / zoom + out * 46
        const rx = (1 - rise) * 38
        const rz = STACK_ROT[i] * q
        const s = (0.84 + 0.16 * rise) * (1 - 0.05 * out)
        const still = deal >= 1 && rise >= 1 && out <= 0
        c.style.transform = still ? '' : `perspective(1400px) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotateX(${rx.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${s.toFixed(4)})`
        c.style.zIndex = deal < 1 ? String(10 - i) : ''                   // the top of the deck deals first
        // the flip, one card after another
        const fl = easeInOut(clamp01((p - 0.36 - i * 0.13) / 0.17))
        flips[i].style.transform = fl <= 0 ? '' : `rotateY(${(180 * fl).toFixed(2)}deg)`
        c.toggleAttribute('data-flipped', fl > 0.5)
        // the line down to How it works
        const b = easeInOut(clamp01((p - 0.82 - i * 0.03) / 0.15))
        bridges[i].style.transform = `scaleY(${b.toFixed(4)})`
      })
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }

    measure()
    const settle = setTimeout(measure, 400)
    document.fonts?.ready.then(measure)
    let rt = 0
    const onResize = () => { clearTimeout(rt); rt = window.setTimeout(measure, 150) }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onResize)
    return () => {
      clearTimeout(settle); clearTimeout(rt); cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onResize)
      cards.forEach(c => { c.style.transform = ''; c.style.zIndex = ''; c.removeAttribute('data-flipped') })
      flips.forEach(c => { c.style.transform = '' })
      if (head) head.style.opacity = ''
      f.style.zoom = ''; o.style.height = ''; o.classList.remove('pf-pinned'); delete o.dataset.pin
    }
  }, [on, outerRef, stageRef, fitRef])
}
