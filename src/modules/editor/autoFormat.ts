import type { LayoutType } from '@chai-cut/shared'
import type { BoxPosition } from '@/lib/interpolation'
import { defaultCropForSlot, normalizedSlotAspect } from './utils'

// ── Auto format: which format a scene gets (Subjects tool) ─────────────────────
// The user's decision table (2026-10-24), checked in this order, for one place of a scene (one of the
// stretches where its shot comes back — who talks can differ between them):
//   1. Short pieces: nothing special for now (every piece gets its own format).
//   2. Faces too small to blow up sharply (a wide shot): Split / Trio anyway — 2 people: Split; 3:
//      Trio, one person a view; 4: Trio, the middle two together in the middle view; 5 or more: Split,
//      each view framing all of its side.
//   3. Everyone fits in one 9:16 view: Vertical framing them all.
//   4. One person: Vertical on them.
//   5. Two: Split — the speaker at the bottom, the listener (reactions) on top.
//   6. Three: all three talk → Trio; else Split — the speaker at the bottom, the other two together on
//      top; with the speaker in the middle seat (the other two don't fit one view) → Trio.
//   7. Four: Trio, the middle two together in the middle view. Five or more: Split at the biggest gap,
//      each view framing all of its side.
// "Talks": at least ACTIVE_SHARE of the talking in that place; the speaker: whoever talks most. Not
// known (no transcript, or nobody talks there): two → Split, the left one on top; three → Trio.
// Split and Trio stack their views top to bottom. Each view is placed on its people here; the
// following (Follow) keeps a one-person view on its person as they move.

type Face = { x: number; y: number; w: number; h: number }
export interface AutoLayout {
  layout: LayoutType
  framing: BoxPosition[]
  /** Which rule decided it (for the notice and the tests) */
  why: 'small' | 'fits' | 'one' | 'two' | 'three-all' | 'three-split' | 'three-middle' | 'three' | 'four' | 'many'
}

/** A face narrower than this share of the picture is too small to blow up sharply (≈70 px of a 1080p picture) */
export const SMALL_FACE = 70 / 1920
/** "Talks" in a place: this share of the talking there or more */
export const ACTIVE_SHARE = 0.2
/** Everyone fits one Vertical view when they take up at most this share of its width (room either side) */
const FITS_SHARE = 0.85
/** A one-person view's height, in face heights: a Split view shows head and shoulders, a Trio view a little closer */
const FACE_TO_VIEW: Partial<Record<LayoutType, number>> = { split: 3.2, trio: 2.6 }
/** A view of several people: this much room either side of them (a share of their width) */
const GROUP_ROOM = 0.15
/** The faces sit this far down their view (a share of its height): headroom above */
const FACE_DOWN = 0.4
/**
 * …and the view's top at least this many face heights above the faces' top: the face box runs from
 * the forehead to the chin, the hair above it (user, 2026-10-24: a tight Trio view put the face's middle
 * 40% down and cut the top of the head off; their own framing had the view's top half a face above)
 */
export const HEAD_ROOM = 0.5
/** A one-person view is never narrower than this many face widths, even when people sit close together */
const MIN_FACE_WIDTHS = 1.6
/** …nor shorter than this many face heights (the whole head, some shoulders: the user's own 2.9× Trio views) */
const MIN_FACE_HEIGHTS = 1.55

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const midX = (f: Face) => f.x + f.w / 2
const midY = (f: Face) => f.y + f.h / 2

/**
 * A view of aspect `a` (width / height in the picture's own units) `h` high, centred on cx, its faces'
 * middle at cy and their top at `top` (room for the hair above), inside the picture
 */
function viewAt(a: number, cx: number, cy: number, h: number, top: number, faceH: number): BoxPosition {
  let w = a * h
  if (w > 1) { w = 1; h = 1 / a }
  if (h > 1) { h = 1; w = a }
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(Math.min(cy - h * FACE_DOWN, top - HEAD_ROOM * faceH), 0, 1 - h), w, h }
}

/** A view on one person; `others`: the people beside them (the view stops short of showing them) */
function personView(layout: LayoutType, a: number, f: Face, others: Face[]): BoxPosition {
  const gaps = others.map(g => Math.abs(midX(g) - midX(f)))
  let h = f.h * (FACE_TO_VIEW[layout] ?? 3)
  if (gaps.length) h = Math.min(h, Math.min(...gaps) / a)
  h = Math.max(h, (f.w * MIN_FACE_WIDTHS) / a, f.h * MIN_FACE_HEIGHTS)
  return viewAt(a, midX(f), midY(f), h, f.y, f.h)
}

/** A view framing all of `group` (with room either side) */
function groupView(layout: LayoutType, a: number, group: Face[]): BoxPosition {
  if (group.length === 1) return viewAt(a, midX(group[0]), midY(group[0]), group[0].h * (FACE_TO_VIEW[layout] ?? 3), group[0].y, group[0].h)
  const left = Math.min(...group.map(f => f.x)), right = Math.max(...group.map(f => f.x + f.w))
  const width = (right - left) * (1 + 2 * GROUP_ROOM)
  const tallest = Math.max(...group.map(f => f.h))
  const h = Math.max(width / a, tallest * (FACE_TO_VIEW[layout] ?? 3))
  return viewAt(a, (left + right) / 2, group.reduce((t, f) => t + midY(f), 0) / group.length, h, Math.min(...group.map(f => f.y)), tallest)
}

/**
 * The format for one place of a scene. `faces`: its people (fractions of the picture; any order);
 * `talk`: how long each of them talks there (ms, in the same order), or null when not known;
 * `videoAR`: the picture's width / height (16:9 when not known yet). Null with no faces.
 */
export function decideFormat(faces: readonly Face[], talk: readonly number[] | null, videoAR?: number): AutoLayout | null {
  if (!faces.length) return null
  // Left to right, each with how much they talk
  const order = faces.map((f, i) => ({ f, t: talk?.[i] ?? 0 })).sort((p, q) => midX(p.f) - midX(q.f))
  const byX = order.map(o => o.f)
  const n = byX.length
  const total = order.reduce((s, o) => s + o.t, 0)
  const known = !!talk && total > 0
  const share = (i: number) => (known ? order[i].t / total : 0)
  // The speaker: whoever talks most (null: not known)
  const speaker = known ? order.reduce((best, o, i) => (o.t > order[best].t ? i : best), 0) : null
  const aSplit = normalizedSlotAspect('split', videoAR) ?? 1, aTrio = normalizedSlotAspect('trio', videoAR) ?? 1
  const vertical = (cx: number, why: AutoLayout['why']): AutoLayout => ({ layout: 'vertical', framing: [defaultCropForSlot('vertical', 0, videoAR, cx)], why })

  /** Split: `top` and `bottom` people (each view framing its people) */
  const split = (top: Face[], bottom: Face[], why: AutoLayout['why']): AutoLayout => ({
    layout: 'split', why,
    framing: [top, bottom].map(g => (g.length === 1 ? personView('split', aSplit, g[0], byX.filter(f => f !== g[0])) : groupView('split', aSplit, g))),
  })
  /** Trio: the views from the top, each framing its people */
  const trio = (views: Face[][], why: AutoLayout['why']): AutoLayout => ({
    layout: 'trio', why,
    framing: views.map(g => (g.length === 1 ? personView('trio', aTrio, g[0], byX.filter(f => f !== g[0])) : groupView('trio', aTrio, g))),
  })
  /** Two people: the speaker at the bottom (not known: the left one on top) */
  const two = (why: AutoLayout['why']) => (speaker === 1 || speaker === null ? split([byX[0]], [byX[1]], why) : split([byX[1]], [byX[0]], why))
  /** Four: the middle two together in the middle view */
  const four = (why: AutoLayout['why']) => trio([[byX[0]], [byX[1], byX[2]], [byX[3]]], why)
  /** Five or more: two sides, cut at the biggest gap between neighbours */
  const many = (why: AutoLayout['why']) => {
    let cut = 1
    for (let i = 1; i < n; i++) if (midX(byX[i]) - midX(byX[i - 1]) > midX(byX[cut]) - midX(byX[cut - 1])) cut = i
    return split(byX.slice(0, cut), byX.slice(cut), why)
  }

  // 1 person
  if (n === 1) return vertical(midX(byX[0]), 'one')
  // 2. Faces too small to blow up sharply: Split / Trio anyway
  if (Math.min(...byX.map(f => f.w)) < SMALL_FACE) {
    if (n === 2) return two('small')
    if (n === 3) return trio(byX.map(f => [f]), 'small')
    if (n === 4) return four('small')
    return many('small')
  }
  // 3. Everyone fits one Vertical view
  const vw = defaultCropForSlot('vertical', 0, videoAR).w
  const left = Math.min(...byX.map(f => f.x)), right = Math.max(...byX.map(f => f.x + f.w))
  if (right - left <= FITS_SHARE * vw) return vertical((left + right) / 2, 'fits')
  // 5. Two
  if (n === 2) return two('two')
  // 6. Three
  if (n === 3) {
    if (!known) return trio(byX.map(f => [f]), 'three')
    if (order.every((_, i) => share(i) >= ACTIVE_SHARE)) return trio(byX.map(f => [f]), 'three-all')
    // The speaker in the middle seat: the other two don't fit one view without them
    if (speaker === 1) return trio(byX.map(f => [f]), 'three-middle')
    return split(byX.filter((_, i) => i !== speaker), [byX[speaker!]], 'three-split')
  }
  // 7. Four; five or more
  if (n === 4) return four('four')
  return many('many')
}
