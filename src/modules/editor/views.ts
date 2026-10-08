import { getBoxPositionAtLerp, type BoxPosition } from '@/lib/interpolation'

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
  // Never after the playhead (floor, not round): a change even half a millisecond ahead leaves the
  // playhead inside the hold before it, and the box is drawn as a blend that trails the mouse
  const at = Math.max(Math.floor(t), formatStart)
  const first = changes[0]
  // Which change carries the new view: the first one (at the format's start), a cut close by
  // (one just ahead moves back to the playhead), or a new cut at the playhead
  const nearCut = changes.find(c => c !== first && c.cut && Math.abs(c.t_ms - at) <= VIEW_SNAP_MS)
  const isFirst = at - formatStart <= VIEW_SNAP_MS || at <= first.t_ms
  const target = isFirst ? first.t_ms : nearCut ? Math.min(nearCut.t_ms, at) : at
  // The view holds from there until the next cut: glide points in between (Make my clips'
  // tracking, recorded Motion) belonged to the old path and would pull the box straight back
  const nextCut = changes.find(c => c !== first && c !== nearCut && c.cut && c.t_ms > Math.max(at, target))
  const kept = changes.filter(c => c.t_ms < target || (nextCut ? c.t_ms >= nextCut.t_ms : false))
  // Up to the cut the old path plays on as it was: a point just before it keeps where it had got to
  const prev = kept.filter(c => c.t_ms < target).pop()
  if (!isFirst && prev && target - 2 > prev.t_ms) {
    const was = getBoxPositionAtLerp(target - 2, kfs as ViewKeyframe[])
    if (Math.abs(was.x - prev.x) + Math.abs(was.y - prev.y) + Math.abs(was.w - prev.w) + Math.abs(was.h - prev.h) > 0.002) {
      kept.push({ t_ms: target - 2, ...was, cut: false })
    }
  }
  return buildKeyframes([...kept, { t_ms: target, ...p, cut: !isFirst }])
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

/** Closest two view changes may be (a cut needs room for its hold keyframe) */
const MIN_APART_MS = HOLD_GAP_MS + 3

/**
 * Move the view change at `from` to `to`, anywhere in the format after its first view: it can be
 * dragged past other changes (the views then play in their new order), but never onto one — it
 * stops just beside it.
 */
export function moveViewChange(kfs: readonly ViewKeyframe[], from: number, to: number, formatStart: number, formatEnd: number): ViewKeyframe[] {
  const changes = viewChanges(kfs)
  const i = changes.findIndex(c => c.t_ms === from)
  if (i <= 0) return [...kfs] // the first view always starts with the format
  const lo = Math.max(formatStart, changes[0].t_ms) + MIN_APART_MS
  const hi = formatEnd - 1 - MIN_APART_MS
  if (hi < lo) return [...kfs]
  let t = Math.round(Math.max(lo, Math.min(hi, to)))
  // Not on top of another change: beside it, on the side it was dragged from
  const others = changes.filter((_, j) => j !== i)
  const hit = others.find(c => Math.abs(c.t_ms - t) < MIN_APART_MS)
  if (hit) {
    const before = hit.t_ms - MIN_APART_MS, after = hit.t_ms + MIN_APART_MS
    t = from < hit.t_ms ? before : after
    if (t < lo || t > hi || others.some(c => c !== hit && Math.abs(c.t_ms - t) < MIN_APART_MS)) return [...kfs]
  }
  return buildKeyframes(changes.map((c, j) => (j === i ? { ...c, t_ms: t } : c)))
}

/** How far after a view change its copy goes (or half way to the next change, if that is closer) */
export const DUPLICATE_AFTER_MS = 1000

/**
 * A copy of the view change at `t`: the same view, a moment later — DUPLICATE_AFTER_MS, or half way
 * to the next change or the format's end if that's closer. A copy of the first view (or of a cut)
 * is a cut; a copy of a motion point glides like it. Then it can be dragged anywhere
 * (moveViewChange). Null when there's no room after it.
 */
export function duplicateViewChange(kfs: readonly ViewKeyframe[], t: number, formatEnd: number): { keyframes: ViewKeyframe[]; at: number } | null {
  const changes = viewChanges(kfs)
  const i = changes.findIndex(c => c.t_ms === t)
  if (i < 0) return null
  const src = changes[i]
  const limit = Math.min(changes[i + 1]?.t_ms ?? Infinity, formatEnd - 1)
  const room = limit - t
  if (room < 2 * MIN_APART_MS + 2) return null
  const at = Math.round(t + Math.min(DUPLICATE_AFTER_MS, room / 2))
  return { keyframes: buildKeyframes([...changes, { ...pos(src), t_ms: at, cut: i === 0 ? true : src.cut }]), at }
}
