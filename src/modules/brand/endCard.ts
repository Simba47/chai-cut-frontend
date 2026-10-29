import type { BoxKeyframe, SegmentLocal, Transition } from '@chai-cut/shared'
import { LAYOUT_SLOT_COUNT } from '@/lib/shared/types'
import type { EndCardBefore } from '@/lib/shared/brandOn'
import { defaultFrame } from '@/modules/editor/frames'
import { insertsOf, isInsert, videoAt } from '@/modules/editor/inserts'
import { isShot } from '@/modules/editor/shots'

/**
 * A kit's end card (brand kit Phase 4, 2026-10-27; as the editor's brandEndCard made it before
 * 2026-10-20): the clip's last seconds made one Branded card — the video keeps playing in it, with
 * the kit's title and @handle (the engine brands it as any Branded card). Pure, for the editor and
 * the server alike: the card's view of the video starts unset, which the preview and the export both
 * draw as the middle of the picture filling the card's video area (VideoPreview coverCrop, render.py
 * _crop_filter), so neither needs the video's shape.
 *
 * What was there goes into the brand's record (EndCardBefore) and comes back when it comes off — as
 * long as the card is as the brand left it.
 */

/** The parts of a clip an end card changes */
export interface CardTimeline {
  segments: SegmentLocal[]
  /** The views of each part's boxes (box id → keyframes), as the editor keeps them */
  keyframes: Record<string, BoxKeyframe[]>
  transitions: Transition[]
  lengthMs: number
  mainVideoId: string | null
}

const speedOf = (s: SegmentLocal) => (s.speed && s.speed > 0 ? s.speed : 1)
const byStart = (a: SegmentLocal, b: SegmentLocal) => a.start_ms - b.start_ms || a.sort_order - b.sort_order
/** The box showing the main video in a part, if one does */
const mainBox = (s: SegmentLocal) => s.crop_boxes.find(b => !b.source_video_id && !b.image_path)

/**
 * The clip's last `seconds` made its end card — the last before `endMs` (the kit's outro, when the clip
 * ends with it; else the clip's end). A reason instead when it can't be: the clip is too
 * short, already ends on a Branded card, or that stretch is locked, plays another video put in between,
 * or plays at more than one speed.
 */
export function makeEndCard(tl: CardTimeline, seconds: number, newId: () => string = () => crypto.randomUUID(), endMs = tl.lengthMs):
  { timeline: CardTimeline; rec: EndCardBefore } | { skip: string } {
  const end = endMs
  const t = Math.round(end - seconds * 1000)
  if (t < 1000) return { skip: 'The clip is too short for its end card' }
  const main = tl.segments.filter(s => !isShot(s, tl.mainVideoId)).sort(byStart)
  if (main.some(s => s.layout === 'frame_brand_card' && s.start_ms < end && s.end_ms >= end - 1)) return { skip: 'The clip already ends on a Branded card' }
  const over = main.filter(s => s.start_ms < end && s.end_ms > t)
  if (over.some(s => s.locked)) return { skip: 'The end of the clip is locked — unlock it for the end card' }
  if (over.some(s => isInsert(s, tl.mainVideoId))) return { skip: 'A video put in between plays at the end of the clip' }
  if (new Set(over.map(speedOf)).size > 1) return { skip: 'The end of the clip plays at more than one speed' }

  // The part running across the card's start is cut there; the parts after it make way
  const cut = over.find(s => s.start_ms < t) ?? null
  const replaced = over.filter(s => s.start_ms >= t)
  const gone = new Set(replaced.map(s => s.id))
  const first = cut ?? replaced[0]
  const box = first && mainBox(first)
  // (where the main video is at the card's start: as a part cut there carries on; in a gap, as the clip plays it)
  const mainAt = first && box
    ? Math.round((box.source_offset_ms ?? 0) + Math.max(0, t - first.start_ms) * speedOf(first))
    : Math.round(videoAt(insertsOf(tl.segments, tl.mainVideoId), t))
  const speed = first ? speedOf(first) : 1
  const sortBefore = Math.max(-1, ...main.filter(s => s.start_ms < t).map(s => s.sort_order))
  const card: SegmentLocal = {
    id: newId(), start_ms: t, end_ms: end, layout: 'frame_brand_card', sort_order: sortBefore + 0.5,
    crop_boxes: Array.from({ length: LAYOUT_SLOT_COUNT.frame_brand_card }, (_, i) => ({
      id: newId(), slot_index: i, source_video_id: null, source_offset_ms: mainAt, keyframes: [], volume: 1, muted: false,
    })),
    frame: defaultFrame('frame_brand_card'),
    ...(speed !== 1 ? { speed, ...(first?.smooth ? { smooth: true } : {}), ...(first?.pitch ? { pitch: true } : {}) } : {}),
  }
  const segments = [
    ...tl.segments.filter(s => !gone.has(s.id)).map(s => (cut && s.id === cut.id ? { ...s, end_ms: t } : s)),
    card,
  ]
  const keyframes = { ...tl.keyframes }, kept: Record<string, BoxKeyframe[]> = {}
  for (const s of replaced) for (const b of s.crop_boxes) {
    if (keyframes[b.id]) kept[b.id] = keyframes[b.id]
    delete keyframes[b.id]
  }
  for (const b of card.crop_boxes) keyframes[b.id] = []
  // (a cut after a part that's now inside the card has nothing to join)
  const dropped = tl.transitions.filter(x => gone.has(x.after_segment_id) || (cut && x.after_segment_id === cut.id))
  return {
    timeline: { ...tl, segments, keyframes, transitions: tl.transitions.filter(x => !dropped.includes(x)) },
    rec: { id: card.id, at: t, cut: cut ? { id: cut.id, end_ms: cut.end_ms } : null, replaced, keyframes: kept, transitions: dropped },
  }
}

/**
 * The end card taken off: what was there comes back. Null when the card isn't as the brand left it
 * (another layout, moved, locked): it stays the user's. A card already gone gives the timeline as it is.
 */
export function removeEndCard(tl: CardTimeline, rec: EndCardBefore): CardTimeline | null {
  const card = tl.segments.find(s => s.id === rec.id)
  if (!card) return tl
  if (card.locked || card.layout !== 'frame_brand_card' || (rec.at >= 0 && Math.abs(card.start_ms - rec.at) > 1)) return null
  const keyframes = { ...tl.keyframes }
  for (const b of card.crop_boxes) delete keyframes[b.id]
  const wasEnd = Math.max(rec.cut?.end_ms ?? -1, ...rec.replaced.map(s => s.end_ms))
  // What was there can't come back as it was (a card from before Phase 4 kept no record of it, or the
  // clip's end moved since): the card becomes a plain part of the clip, the middle of the picture
  if (rec.at < 0 || (wasEnd >= 0 && Math.abs(card.end_ms - wasEnd) > 1)) {
    const plain: SegmentLocal = {
      ...card, layout: 'vertical',
      crop_boxes: [{ ...card.crop_boxes[0], id: card.crop_boxes[0]?.id ?? crypto.randomUUID(), slot_index: 0, keyframes: [] }],
    }
    keyframes[plain.crop_boxes[0].id] = []
    return { ...tl, segments: tl.segments.map(s => (s.id === card.id ? plain : s)), keyframes }
  }
  const ids = new Set(tl.segments.map(s => s.id))
  const back = rec.replaced.filter(s => !ids.has(s.id))
  const segments = [
    ...tl.segments.filter(s => s.id !== card.id).map(s => (rec.cut && s.id === rec.cut.id && Math.abs(s.end_ms - card.start_ms) <= 1 ? { ...s, end_ms: rec.cut.end_ms } : s)),
    ...back,
  ].sort(byStart)
  for (const s of back) for (const b of s.crop_boxes) if (rec.keyframes[b.id]) keyframes[b.id] = rec.keyframes[b.id]
  const has = new Set(segments.map(s => s.id)), known = new Set(tl.transitions.map(x => x.id))
  return { ...tl, segments, keyframes, transitions: [...tl.transitions, ...rec.transitions.filter(x => has.has(x.after_segment_id) && !known.has(x.id))] }
}
