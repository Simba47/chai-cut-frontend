'use client'

import { memo, useRef, type ComponentType } from 'react'

// ── A heavy editor part that redraws only when what it shows changed ─────────────
// The editor rebuilds most props on every render (lists made with .map(), handlers written inline),
// so a part like the timeline used to redraw on every mouse move of any drag (user, 2026-10-26: the
// editor felt heavy). memoStable(Component) skips the redraw when the props are the same in value:
// - handlers (any function prop) are passed as stable wrappers that call the latest one, so a click
//   never runs an old handler with old state;
// - lists and plain objects are compared by their contents, a few levels deep (a list of tracks
//   rebuilt with the same tracks is the same).
// A function the part calls WHILE DRAWING must come with a data prop that changes along with it (the
// timeline's sourceAt has sourceKey), else the part keeps showing what the old function gave.

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype

/** Equal in value, comparing lists and plain objects `depth` levels into their contents */
function same(a: unknown, b: unknown, depth: number): boolean {
  if (Object.is(a, b)) return true
  if (depth <= 0) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!same(a[i], b[i], depth - 1)) return false
    return true
  }
  if (isPlain(a) && isPlain(b)) {
    const ka = Object.keys(a), kb = Object.keys(b)
    if (ka.length !== kb.length) return false
    for (const k of ka) if (!same(a[k], b[k], depth - 1)) return false
    return true
  }
  return false
}

function sameProps(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!same(a[k], b[k], 3)) return false
  return true
}

export function memoStable<P extends object>(Part: ComponentType<P>): ComponentType<P> {
  const Inner = memo(Part, (a, b) => sameProps(a as Record<string, unknown>, b as Record<string, unknown>))
  function Stable(props: P) {
    const latest = useRef(props)
    latest.current = props
    const wrappers = useRef(new Map<string, (...args: unknown[]) => unknown>())
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(props)) {
      if (typeof v === 'function') {
        let w = wrappers.current.get(k)
        if (!w) {
          w = (...args: unknown[]) => (latest.current as Record<string, (...a: unknown[]) => unknown>)[k]?.(...args)
          wrappers.current.set(k, w)
        }
        out[k] = w
      } else out[k] = v
    }
    return <Inner {...(out as P)} />
  }
  Stable.displayName = `Stable(${Part.displayName ?? Part.name ?? 'Part'})`
  return Stable
}
