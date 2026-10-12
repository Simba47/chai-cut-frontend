'use client'

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * An endless row that listens to the page (styles: .vm-* in app/landing.css).
 * Scroll and it speeds up, leans into the motion and turns with the scroll direction; stop and it
 * eases back to cruising speed. Drag to scrub, flick to throw, hover slows it down, arrow keys nudge.
 * Anything with .vm-spin inside turns with the distance travelled. Paused while off-screen.
 * Reduced motion: still row, no lean, still draggable.
 */
type Props = {
  children: ReactNode
  /** 1 travels left at rest, -1 travels right */
  direction?: 1 | -1
  /** cruising speed, px per second */
  speed?: number
  /** how much page scroll speed adds */
  boost?: number
  /** maximum lean, degrees */
  skew?: number
  /** speed factor under the pointer */
  hover?: number
  className?: string
  label: string
}

export function VelocityMarquee({ children, direction = 1, speed = 60, boost = 1, skew = 8, hover = 0.25, className = '', label }: Props) {
  const rowRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const setRef = useRef<HTMLDivElement>(null)
  const [copies, setCopies] = useState(2)

  // enough copies of the set to cover twice the row, so the loop never shows a gap
  useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current, set = setRef.current
      if (!row || !set) return
      const w = set.getBoundingClientRect().width || 1
      setCopies(Math.max(2, Math.ceil((row.clientWidth * 2) / w) + 1))
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (rowRef.current) ro.observe(rowRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const row = rowRef.current, track = trackRef.current, set = setRef.current
    if (!row || !track || !set) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const spins = Array.from(track.querySelectorAll<HTMLElement>('.vm-spin'))
    let x = 0, mult = 1, hoverF = 1, isHover = false, sk = 0, skV = 0, fling = 0, flip = 1
    let drag: { id: number; x: number; t: number; v: number; moved: number } | null = null
    let lastMoved = 0, visible = false, raf = 0, last = 0, lastY = window.scrollY, velS = 0, velV = 0

    const frame = (now: number) => {
      const dt = Math.min(64, now - (last || now)) / 1000
      last = now
      if (dt > 0) {
        // spring-smoothed scroll velocity, so one wheel notch reads as a push, not a spike
        const y = window.scrollY, vel = (y - lastY) / dt
        lastY = y
        for (let h = 0; h < dt; h += 1 / 120) { const s = Math.min(1 / 120, dt - h); velV += (-140 * (velS - vel) - 24 * velV) * s; velS += velV * s }
      }
      const x0 = x
      if (!reduced) {
        if (Math.abs(velS) > 40) flip = velS > 0 ? 1 : -1
        const want = 1 + Math.min(Math.abs(velS) / 260, 9) * boost
        mult += (want - mult) * (1 - Math.exp(-dt * 6))
        hoverF += ((isHover ? hover : 1) - hoverF) * (1 - Math.exp(-dt * 5))
        if (!drag) x += speed * direction * flip * mult * hoverF * dt
      }
      if (!drag && fling) { x += fling * dt; fling *= Math.exp(-dt * 3.2); if (Math.abs(fling) < 5) fling = 0 }
      if (!reduced && dt > 0) {
        // lean into the row's own motion, top edge leading
        const rowV = (x - x0) / dt
        const target = Math.max(-skew, Math.min(skew, (Math.abs(rowV) > speed * 1.2 ? rowV - Math.sign(rowV) * speed * 1.2 : 0) * 0.018))
        for (let h = 0; h < dt; h += 1 / 120) { const st = Math.min(1 / 120, dt - h); skV += (-200 * (sk - target) - 22 * skV) * st; sk += skV * st }
      }
      const w = set.getBoundingClientRect().width || 1
      x = ((x % w) + w) % w
      track.style.transform = `translate3d(${(-x).toFixed(2)}px,0,0) skewX(${sk.toFixed(3)}deg)`
      const a = (x / w) * 360
      for (const s of spins) s.style.transform = `rotate(${a.toFixed(1)}deg)`
      const busy = drag || fling || Math.abs(sk) > 0.01
      raf = visible && (!reduced || busy) ? requestAnimationFrame(frame) : 0
    }
    const kick = () => { if (!raf) { last = 0; lastY = window.scrollY; raf = requestAnimationFrame(frame) } }

    const down = (e: PointerEvent) => {
      lastMoved = 0
      drag = { id: e.pointerId, x: e.clientX, t: performance.now(), v: 0, moved: 0 }
      row.setPointerCapture(e.pointerId); row.classList.add('is-dragging'); kick()
    }
    const move = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return
      const now = performance.now(), dx = e.clientX - drag.x, dt = Math.max(1, now - drag.t)
      x -= dx; drag.v = drag.v * 0.6 + (dx / dt) * 1000 * 0.4; drag.x = e.clientX; drag.t = now; drag.moved += Math.abs(dx)
    }
    const up = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return
      lastMoved = drag.moved; fling = -drag.v; drag = null; row.classList.remove('is-dragging')
    }
    const click = (e: MouseEvent) => { if (lastMoved > 6) { e.preventDefault(); e.stopPropagation() } }
    const enter = (e: PointerEvent) => { if (e.pointerType === 'mouse') isHover = true }
    const leave = () => { isHover = false }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') { fling = -900; kick() } else if (e.key === 'ArrowRight') { fling = 900; kick() }
    }
    row.addEventListener('pointerdown', down)
    row.addEventListener('pointermove', move)
    row.addEventListener('pointerup', up)
    row.addEventListener('pointercancel', up)
    row.addEventListener('click', click, true)
    row.addEventListener('pointerenter', enter)
    row.addEventListener('pointerleave', leave)
    row.addEventListener('keydown', key)
    window.addEventListener('scroll', kick, { passive: true })
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) kick() })
    io.observe(row)
    return () => {
      cancelAnimationFrame(raf); io.disconnect()
      window.removeEventListener('scroll', kick)
      row.removeEventListener('pointerdown', down); row.removeEventListener('pointermove', move)
      row.removeEventListener('pointerup', up); row.removeEventListener('pointercancel', up)
      row.removeEventListener('click', click, true); row.removeEventListener('pointerenter', enter)
      row.removeEventListener('pointerleave', leave); row.removeEventListener('keydown', key)
    }
  }, [copies, direction, speed, boost, skew, hover])

  return (
    <div ref={rowRef} className={`vm ${className}`} role="marquee" aria-label={label} tabIndex={0}>
      <div ref={trackRef} className="vm-track">
        {Array.from({ length: copies }, (_, i) => (
          <div key={i} ref={i === 0 ? setRef : undefined} className="vm-set" aria-hidden={i > 0 || undefined}>{children}</div>
        ))}
      </div>
    </div>
  )
}
