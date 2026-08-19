import type { BoxKeyframe } from '@chai-cut/shared'

export interface BoxPosition {
  x: number
  y: number
  w: number
  h: number
}

type KF = Pick<BoxKeyframe, 't_ms' | 'x' | 'y' | 'w' | 'h'>

/** Step interpolation: instant hard cut at each keyframe. */
export function getBoxPositionAt(t_ms: number, keyframes: KF[]): BoxPosition {
  if (keyframes.length === 0) return { x: 0, y: 0, w: 1, h: 1 }
  const sorted = [...keyframes].sort((a, b) => a.t_ms - b.t_ms)
  let active = sorted[0]
  for (const kf of sorted) {
    if (kf.t_ms <= t_ms) active = kf
    else break
  }
  return { x: active.x, y: active.y, w: active.w, h: active.h }
}

/** Linear interpolation: smooth pan between keyframes — used for motion recording playback. */
export function getBoxPositionAtLerp(t_ms: number, keyframes: KF[]): BoxPosition {
  if (keyframes.length === 0) return { x: 0, y: 0, w: 1, h: 1 }
  const sorted = [...keyframes].sort((a, b) => a.t_ms - b.t_ms)
  if (t_ms <= sorted[0].t_ms) return { x: sorted[0].x, y: sorted[0].y, w: sorted[0].w, h: sorted[0].h }
  const last = sorted[sorted.length - 1]
  if (t_ms >= last.t_ms) return { x: last.x, y: last.y, w: last.w, h: last.h }
  let a = sorted[0], b = sorted[1]
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].t_ms <= t_ms && sorted[i + 1].t_ms > t_ms) {
      a = sorted[i]; b = sorted[i + 1]; break
    }
  }
  const alpha = (t_ms - a.t_ms) / (b.t_ms - a.t_ms)
  return {
    x: a.x + (b.x - a.x) * alpha,
    y: a.y + (b.y - a.y) * alpha,
    w: a.w + (b.w - a.w) * alpha,
    h: a.h + (b.h - a.h) * alpha,
  }
}
