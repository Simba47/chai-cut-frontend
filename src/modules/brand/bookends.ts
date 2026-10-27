import type { SegmentLocal } from '@chai-cut/shared'
import type { InsertBefore } from '@/lib/shared/brandOn'
import { MAX_CLIP_MS } from '@/lib/trims'
import { isInsert, rippleCut, rippleInsert } from '@/modules/editor/inserts'
import { rippleDelete, type TimedState } from '@/modules/editor/trimState'

/**
 * A kit's intro and outro (brand kit Phase 4, 2026-10-27; as the editor's brandEnds put them in before
 * 2026-10-20): a video of the user's library put in before the clip, and one after it — as "put a video
 * in between" does (EditorShell insertVideo / removeInsert): everything after it moves later, the main
 * video waits meanwhile. Pure, for the editor and the server alike.
 */

/** A clip's timed parts, its length and its main video */
export interface InsertTimeline extends TimedState {
  lengthMs: number
  mainVideoId: string | null
}

/** A video put in: its id and length */
export interface BookendVideo { id: string; ms: number }

/**
 * `video` put in at timeline `at`, the main video held at `hold` (clip ms of it) meanwhile. A reason
 * instead when it can't be: a locked part runs across there, or the clip would get too long.
 */
export function putBookend(st: InsertTimeline, at: number, hold: number, video: BookendVideo, newId: () => string = () => crypto.randomUUID()):
  { state: InsertTimeline; rec: InsertBefore } | { skip: string } {
  const ms = Math.round(video.ms)
  if (st.lengthMs + ms > MAX_CLIP_MS) return { skip: 'The clip would be longer than a clip can be (5 minutes) with the kit’s intro or outro' }
  if (st.segments.some(s => s.locked && s.start_ms < at && s.end_ms > at)) return { skip: 'A locked part is where the kit’s intro or outro goes — unlock it first' }
  const next = rippleInsert(st, at, ms, newId)
  const id = newId(), boxId = newId()
  const view = { x: 0, y: 0, w: 1, h: 1 }
  const seg: SegmentLocal = {
    id, start_ms: at, end_ms: at + ms, layout: 'vertical', sort_order: 0, video_offset_ms: Math.round(hold),
    crop_boxes: [{ id: boxId, slot_index: 0, source_video_id: video.id, source_offset_ms: 0, image_path: null, image_motion: null, volume: 1, muted: false, keyframes: [{ t_ms: at, ...view }] }],
  }
  const segments = [...next.segments, seg].sort((a, b) => a.start_ms - b.start_ms || a.sort_order - b.sort_order).map((s, i) => ({ ...s, sort_order: i }))
  return {
    state: { ...st, ...next, segments, keyframes: { ...next.keyframes, [boxId]: [{ id: newId(), box_id: boxId, t_ms: at, ...view }] }, lengthMs: st.lengthMs + ms },
    rec: { id, video: video.id, ms },
  }
}

/** The video the brand put in, if it's still there as it put it (the same video, its whole length, not locked) */
export function bookendOf(st: InsertTimeline, rec: InsertBefore): SegmentLocal | null {
  const seg = st.segments.find(s => s.id === rec.id)
  return seg && isInsert(seg, st.mainVideoId) && !seg.locked && seg.crop_boxes[0]?.source_video_id === rec.video
    && Math.abs(seg.end_ms - seg.start_ms - rec.ms) <= 1 ? seg : null
}

/** The video the brand put in taken out again, everything after it moving back up; null: not as it put it */
export function takeBookend(st: InsertTimeline, rec: InsertBefore): InsertTimeline | null {
  const seg = bookendOf(st, rec)
  if (!seg) return null
  const next = rippleCut(st, seg.start_ms, seg.end_ms, rippleDelete)
  return { ...st, ...next, lengthMs: st.lengthMs - (seg.end_ms - seg.start_ms) }
}
