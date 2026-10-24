import type { LayoutType } from '@chai-cut/shared'
import type { BoxPosition } from '@/lib/interpolation'
import { defaultCropForSlot, normalizedSlotAspect } from './utils'

// ── Auto format (Subjects tool) ───────────────────────────────────────────────
// After Detect, one button lays the clip out (user, 2026-10-24): each scene gets the format its people
// call for, with its views on them — 1 person: Vertical on their face; 2: Split, the left one on top;
// 3: Trio, left to right from the top; 4 or more: Split by halves (the top view on the left half of
// the picture, the bottom one on the right half). Split and Trio stack their views top to bottom.

type Face = { x: number; y: number; w: number; h: number }
export interface AutoLayout { layout: LayoutType; framing: BoxPosition[]; halves?: boolean }

/** A view's height, in face heights: a Split view shows head and shoulders, a Trio view (wider, shorter) a little closer */
const FACE_TO_VIEW: Partial<Record<LayoutType, number>> = { split: 3.2, trio: 2.6 }
/** The face sits this far down its view (its middle, as a share of the view's height): headroom above */
const FACE_DOWN = 0.4
/** A view is never narrower than this many face widths, even when the people sit close together */
const MIN_FACE_WIDTHS = 1.6

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** A view of aspect `a` (width / height in the picture's own units) `h` high round (cx, cy), inside the picture */
function viewAt(a: number, cx: number, cy: number, h: number): BoxPosition {
  let w = a * h
  if (w > 1) { w = 1; h = 1 / a }
  if (h > 1) { h = 1; w = a }
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h * FACE_DOWN, 0, 1 - h), w, h }
}

/**
 * The format for a scene from its faces (fractions of the picture; any order), or null with none.
 * `videoAR`: the picture's width / height (16:9 when not known yet).
 */
export function autoLayoutFor(faces: readonly Face[], videoAR?: number): AutoLayout | null {
  const byX = [...faces].sort((p, q) => p.x + p.w / 2 - (q.x + q.w / 2))
  const mid = (f: Face) => [f.x + f.w / 2, f.y + f.h / 2] as const
  if (!byX.length) return null
  if (byX.length === 1) return { layout: 'vertical', framing: [defaultCropForSlot('vertical', 0, videoAR, mid(byX[0])[0])] }
  if (byX.length <= 3) {
    const layout: LayoutType = byX.length === 2 ? 'split' : 'trio'
    const a = normalizedSlotAspect(layout, videoAR) ?? 1
    const framing = byX.map((f, i) => {
      const [cx, cy] = mid(f)
      // Not so wide that it shows half the person beside them: at most the gap to the nearest one
      const gaps = [byX[i - 1], byX[i + 1]].filter(Boolean).map(g => Math.abs(mid(g!)[0] - cx))
      let h = f.h * (FACE_TO_VIEW[layout] ?? 3)
      if (gaps.length) h = Math.min(h, Math.min(...gaps) / a)
      h = Math.max(h, (f.w * MIN_FACE_WIDTHS) / a)
      return viewAt(a, cx, cy, h)
    })
    return { layout, framing }
  }
  // Four or more: the picture's two halves, each at the height of the faces in it
  const a = normalizedSlotAspect('split', videoAR) ?? 1
  const framing = [0.25, 0.75].map(cx => {
    const inHalf = byX.filter(f => (mid(f)[0] < 0.5) === (cx < 0.5))
    const cy = inHalf.length ? inHalf.reduce((t, f) => t + mid(f)[1], 0) / inHalf.length : 0.5
    return viewAt(a, cx, cy, 0.5 / a)
  })
  return { layout: 'split', framing, halves: true }
}
