import type { CropBoxLocal, BoxKeyframeLocal, LayoutType, SegmentLocal, Segment, CropBox, BoxKeyframe } from '@chai-cut/shared'

// ── Crop defaults ──────────────────────────────────────────────────────────────

// 9:16 window centred in a 16:9 source
const REEL_W = (9 * 9) / (16 * 16)
const REEL_X = (1 - REEL_W) / 2

export function defaultCropForSlot(layout: LayoutType, slotIdx: number) {
  switch (layout) {
    case 'vertical':
    case 'spotlight':
    case 'centered':
      return { x: REEL_X, y: 0, w: REEL_W, h: 1 }
    case 'horizontal':
      return { x: 0, y: 0, w: 1, h: 1 }
    case 'split':
      return slotIdx === 0 ? { x: 0, y: 0, w: 1, h: 0.5 } : { x: 0, y: 0.5, w: 1, h: 0.5 }
    case 'trio':
      if (slotIdx === 0) return { x: 0, y: 0, w: 1, h: 0.55 }
      if (slotIdx === 1) return { x: 0, y: 0.5, w: 0.5, h: 0.5 }
      return { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }
    default:
      return { x: 0, y: 0, w: 1, h: 1 }
  }
}

export function makeBox(
  slotIndex: number,
  layout: LayoutType = 'vertical',
  startMs = 0,
  keyframes?: BoxKeyframeLocal[],
): CropBoxLocal {
  return {
    id: crypto.randomUUID(),
    slot_index: slotIndex,
    source_video_id: null,
    source_offset_ms: 0,
    keyframes: keyframes ?? [{ t_ms: startMs, ...defaultCropForSlot(layout, slotIndex) }],
  }
}

// ── DB row → local type ────────────────────────────────────────────────────────

interface SegmentRow extends Omit<Segment, never> {
  crop_boxes: (CropBox & { box_keyframes: BoxKeyframe[] })[]
}

export function rowsToLocal(rows: SegmentRow[]): SegmentLocal[] {
  return rows.map(s => ({
    id: s.id,
    start_ms: s.start_ms,
    end_ms: s.end_ms,
    layout: s.layout,
    sort_order: s.sort_order,
    crop_boxes: s.crop_boxes.map(b => ({
      id: b.id,
      slot_index: b.slot_index,
      source_video_id: b.source_video_id ?? null,
      source_offset_ms: b.source_offset_ms ?? 0,
      keyframes: b.box_keyframes,
    })),
  }))
}

export function msToLabel(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
