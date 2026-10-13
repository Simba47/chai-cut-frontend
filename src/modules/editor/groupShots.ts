import { LAYOUT_SLOT_COUNT, type LayoutType } from '@chai-cut/shared'
import { useEditorStore } from './store'
import { isShot } from './shots'

// ── Group subjects: a marked camera shot keeps its format ──────────────────────
// The user marks a shot with the format and views they gave it (say Split: two people in the top
// view, one in the bottom). The worker finds wherever the clip shows that shot again
// (chai-cut-backend jobs/track_subjects.ts shotSpans); here each of those stretches becomes its own
// section with that format and those views — over the views following whoever is talking.

export interface GroupShot {
  layout: LayoutType
  /** Each view where the user put it (fractions of the source picture) */
  boxes: Array<{ slot_index: number; x: number; y: number; w: number; h: number }>
  /** Where the clip shows the shot (clip ms) */
  spans: Array<[number, number]>
}

/** A stretch shorter than this isn't given its own section */
const MIN_MS = 300

/**
 * Give each group's stretches its format: split off the sections around them (an uncovered part
 * gets a section of its own), then that format with the group's views. Locked sections and videos
 * on top are left alone; a stretch already given to an earlier group isn't taken again. Returns the
 * stretches given a group's format (clip ms).
 */
export function applyGroupShots(groups: GroupShot[], clipLengthMs: number, videoAR: number | undefined, mainVideoId: string | null): Array<[number, number]> {
  const store = useEditorStore.getState()
  const sectionsNow = () => useEditorStore.getState().segments
    .filter(x => !isShot(x, mainVideoId)).sort((a, b) => a.start_ms - b.start_ms)
  const held: Array<[number, number]> = []
  for (const g of groups) {
    const framing = Array.from({ length: LAYOUT_SLOT_COUNT[g.layout] }, (_, i) => {
      const b = g.boxes.find(x => x.slot_index === i)
      return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : undefined
    })
    for (const [sa, sb] of g.spans) {
      let a = Math.max(0, Math.round(sa)), b = Math.min(clipLengthMs, Math.round(sb))
      for (const [x, y] of held) if (a < y && b > x) { if (a >= x) a = y; else b = Math.min(b, x) }
      if (b - a < MIN_MS) continue
      for (const sec of sectionsNow().filter(x => x.end_ms > a && x.start_ms < b)) {
        if (sec.locked) continue
        let id = sec.id
        if (a > sec.start_ms + 100) {
          const piece = store.splitAtMs(id, a, store.getPositionAt)
          if (!piece) continue
          id = piece
        }
        const cur = useEditorStore.getState().segments.find(x => x.id === id)
        if (cur && b < cur.end_ms - 100) store.splitAtMs(id, b, store.getPositionAt)
        store.applyLayout(id, g.layout, videoAR, framing)
      }
      // A part with no section yet gets one
      let at = a
      for (const sec of sectionsNow().filter(x => x.end_ms > a && x.start_ms < b)) {
        if (sec.start_ms - at >= MIN_MS) store.addFormat(at, sec.start_ms, g.layout, videoAR, framing)
        at = Math.max(at, sec.end_ms)
      }
      if (b - at >= MIN_MS) store.addFormat(at, b, g.layout, videoAR, framing)
      held.push([a, b])
    }
  }
  return held
}
