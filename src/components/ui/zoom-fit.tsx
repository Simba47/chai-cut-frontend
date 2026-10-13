'use client'

import { useLayoutEffect, useRef, type ReactNode } from 'react'

/**
 * Lays its content out at a fixed design width and zooms it to whatever width it gets, so a
 * px-sized mockup keeps its proportions in a narrower column (CSS zoom shrinks the layout too).
 * `max` above 1 lets it grow into a wider column too (zoom re-lays out, so it stays sharp).
 */
export function ZoomFit({ width, max = 1, className = '', children }: { width: number; max?: number; className?: string; children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const o = outer.current, i = inner.current
    if (!o || !i) return
    const fit = () => { i.style.zoom = String(Math.min(max, o.clientWidth / width)) }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(o)
    return () => ro.disconnect()
  }, [width, max])
  return (
    <div ref={outer} className={className}>
      <div ref={inner} style={{ width }}>{children}</div>
    </div>
  )
}
