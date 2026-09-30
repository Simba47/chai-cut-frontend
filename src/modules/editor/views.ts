import type { BoxPosition } from '@/lib/interpolation'

// ── View changes ──────────────────────────────────────────────────────────────
// A crop box's "view" can change during a format. Each change applies from its moment until the
// next one:
//   • a CUT (moving the view with Motion off) switches instantly — the previous view is held right
//     up to the cut by a "hold" keyframe 1 ms before it;
//   • a GLIDE (a point recorded with Motion on) moves smoothly from the previous point.
// Everything stays plain keyframes (t, x, y, w, h), so the database, the preview (linear between
// keyframes) and render.py (the same) need no new fields: a hold + cut pair 1 ms apart is a cut.

export type ViewKeyframe = { t_ms: number; x: number; y: number; w: number; h: number }
export type ViewChange = ViewKeyframe & { cut: boolean }

/** A keyframe this close before the next one only holds the old view up to a cut */
export const HOLD_GAP_MS = 1
/** A move within this distance of an existing change edits that change instead of adding one */
export const VIEW_SNAP_MS = 150
/** Motion recording keeps at most one point per this interval (the latest position wins) */
export const MOTION_POINT_MS = 120

const pos = (k: ViewKeyframe): BoxPosition => ({ x: k.x, y: k.y, w: k.w, h: k.h })

/** The view changes a box's keyframes describe (hold keyframes are folded into their cut) */
export function viewChanges(kfs: readonly ViewKeyframe[]): ViewChange[] {
  const sorted = [...kfs].sort((a, b) => a.t_ms - b.t_ms)
  const out: ViewChange[] = []
  for (let i = 0; i < sorted.length; i++) {
    const k = sorted[i], next = sorted[i + 1], prev = sorted[i - 1]
    if (next && next.t_ms - k.t_ms <= HOLD_GAP_MS) continue // a hold
    out.push({ t_ms: k.t_ms, ...pos(k), cut: !!prev && k.t_ms - prev.t_ms <= HOLD_GAP_MS })
  }
  return out
}

/** Keyframes for a list of view changes: each cut gets a hold keyframe just before it */
export function buildKeyframes(changes: readonly ViewChange[]): ViewKeyframe[] {
  const sorted = [...changes].sort((a, b) => a.t_ms - b.t_ms)
  const out: ViewKeyframe[] = []
  sorted.forEach((c, i) => {
    const prev = sorted[i - 1]
    if (c.cut && prev && c.t_ms - prev.t_ms > HOLD_GAP_MS + 1) out.push({ t_ms: c.t_ms - HOLD_GAP_MS, ...pos(prev) })
    out.push({ t_ms: c.t_ms, ...pos(c) })
  })
  return out
}

/**
 * Move the view at time t (Motion off). Near an existing change it edits that change; at the
 * format's start (or before its first change) it edits the first view; otherwise it adds a cut at
 * t — the view changes from t until the next change, and everything before t stays as it was.
 */
export function setViewAt(kfs: readonly ViewKeyframe[], t: number, p: BoxPosition, formatStart: number): ViewKeyframe[] {
  const changes = viewChanges(kfs)
  if (!changes.length) return [{ t_ms: formatStart, ...p }]
  const at = Math.max(Math.round(t), formatStart)
  const near = changes.find(c => Math.abs(c.t_ms - at) <= VIEW_SNAP_MS)
  if (near) return buildKeyframes(changes.map(c => (c === near ? { ...c, ...p } : c)))
  if (at - formatStart <= VIEW_SNAP_MS || at < changes[0].t_ms) {
    return buildKeyframes(changes.map((c, i) => (i === 0 ? { ...c, ...p } : c)))
  }
  return buildKeyframes([...changes, { t_ms: at, ...p, cut: true }])
}

/**
 * Record a Motion point at time t: the view glides into it from the previous point. Points closer
 * than MOTION_POINT_MS after an earlier one replace its position instead (a drag fires dozens of
 * moves a second — this keeps the path light for the renderer).
 */
export function recordMotionAt(kfs: readonly ViewKeyframe[], t: number, p: BoxPosition): ViewKeyframe[] {
  const changes = viewChanges(kfs)
  const at = Math.max(0, Math.round(t))
  const recent = changes.find(c => at - c.t_ms >= 0 && at - c.t_ms < MOTION_POINT_MS)
  if (recent) return buildKeyframes(changes.map(c => (c === recent ? { ...c, ...p } : c)))
  return buildKeyframes([...changes, { t_ms: at, ...p, cut: false }])
}

/** Remove the view change at t (the first view can't be removed while it's the only one) */
export function removeViewChangeAt(kfs: readonly ViewKeyframe[], t: number): ViewKeyframe[] {
  const changes = viewChanges(kfs)
  if (changes.length <= 1) return [...kfs]
  const i = changes.findIndex(c => c.t_ms === t)
  if (i < 0) return [...kfs]
  const rest = changes.filter((_, j) => j !== i)
  // If the first view goes, the next one takes over from the start
  if (i === 0) rest[0] = { ...rest[0], t_ms: changes[0].t_ms, cut: false }
  return buildKeyframes(rest)
}

/** Move the view change at `from` to `to`, kept between its neighbours */
export function moveViewChange(kfs: readonly ViewKeyframe[], from: number, to: number, formatStart: number, formatEnd: number): ViewKeyframe[] {
  const changes = viewChanges(kfs)
  const i = changes.findIndex(c => c.t_ms === from)
  if (i <= 0) return [...kfs] // the first view always starts with the format
  const lo = Math.max(formatStart, changes[i - 1].t_ms) + HOLD_GAP_MS + 2
  const hi = Math.min(formatEnd - 1, changes[i + 1]?.t_ms ?? Infinity) - HOLD_GAP_MS - 2
  if (hi < lo) return [...kfs]
  const t = Math.round(Math.max(lo, Math.min(hi, to)))
  return buildKeyframes(changes.map((c, j) => (j === i ? { ...c, t_ms: t } : c)))
}
