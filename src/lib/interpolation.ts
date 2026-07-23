import type { BoxKeyframe } from '@chai-cut/shared'

export interface BoxPosition {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Step interpolation: returns the position from the last keyframe at or before t_ms.
 * This gives instant hard cuts at each keyframe — no gradual panning between positions.
 */
export function getBoxPositionAt(
  t_ms: number,
  keyframes: Pick<BoxKeyframe, 't_ms' | 'x' | 'y' | 'w' | 'h'>[],
): BoxPosition {
  if (keyframes.length === 0) {
    return { x: 0, y: 0, w: 1, h: 1 }
  }

  const sorted = [...keyframes].sort((a, b) => a.t_ms - b.t_ms)

  // Use the last keyframe whose time is ≤ t_ms (step, not lerp)
  let active = sorted[0]
  for (const kf of sorted) {
    if (kf.t_ms <= t_ms) active = kf
    else break
  }

  const { x, y, w, h } = active
  return { x, y, w, h }
}
