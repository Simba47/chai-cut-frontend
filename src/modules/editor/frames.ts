import type { FrameLayout, FrameBand, FrameItem, FrameLane, FrameSettings, LayoutType, SegmentLocal } from '@chai-cut/shared'

// Frame templates: the 9:16 reel divided top-to-bottom into media slots and (optionally) one
// letterbox band for text. Heights are shares of the 1920 px frame. render.py mirrors these
// numbers — keep the two in step.

export type FrameRow = { kind: 'slot'; slot: number; h: number } | { kind: 'band'; h: number }

export interface FrameTemplate {
  name: string
  description: string
  rows: FrameRow[]
  /** What each slot starts as when the frame is applied */
  defaults: ('video' | 'photo')[]
}

export const FRAME_TEMPLATES: Record<FrameLayout, FrameTemplate> = {
  frame_single: {
    name: 'Single', description: 'One video with a top letterbox for text.',
    rows: [{ kind: 'band', h: 0.2 }, { kind: 'slot', slot: 0, h: 0.8 }],
    defaults: ['video'],
  },
  frame_video_photo: {
    name: 'Video + Photo', description: 'One video and one photo with a letterbox in the middle.',
    rows: [{ kind: 'slot', slot: 0, h: 0.42 }, { kind: 'band', h: 0.16 }, { kind: 'slot', slot: 1, h: 0.42 }],
    defaults: ['video', 'photo'],
  },
  frame_dual: {
    name: 'Dual Video', description: 'Two videos in one frame.',
    rows: [{ kind: 'slot', slot: 0, h: 0.5 }, { kind: 'slot', slot: 1, h: 0.5 }],
    defaults: ['video', 'video'],
  },
  frame_dual_letterbox: {
    name: 'Dual + Letterbox', description: 'Two videos with a letterbox in the middle for text.',
    rows: [{ kind: 'slot', slot: 0, h: 0.42 }, { kind: 'band', h: 0.16 }, { kind: 'slot', slot: 1, h: 0.42 }],
    defaults: ['video', 'video'],
  },
  frame_triple: {
    name: 'Triple', description: 'Three videos or a mix of videos and photos.',
    rows: [{ kind: 'slot', slot: 0, h: 1 / 3 }, { kind: 'slot', slot: 1, h: 1 / 3 }, { kind: 'slot', slot: 2, h: 1 / 3 }],
    defaults: ['video', 'video', 'photo'],
  },
}

export const FRAME_LAYOUTS = Object.keys(FRAME_TEMPLATES) as FrameLayout[]

export function isFrameLayout(layout: LayoutType | string | null | undefined): layout is FrameLayout {
  return !!layout && layout in FRAME_TEMPLATES
}

/**
 * Rows of a frame with their top edge, as shares of the frame height. The text band only exists
 * once the frame has text on it (`showBand`); without it the slots share the whole height.
 */
export function frameRows(layout: FrameLayout, showBand = true): (FrameRow & { y: number })[] {
  const rows = FRAME_TEMPLATES[layout].rows.filter(r => showBand || r.kind !== 'band')
  const total = rows.reduce((a, r) => a + r.h, 0) || 1
  let y = 0
  return rows.map(r => { const h = r.h / total, row = { ...r, h, y }; y += h; return row })
}

/** Height (share of the frame) of one media slot — every slot in a template is the same height */
export function frameSlotHeight(layout: FrameLayout, showBand = true): number {
  return frameRows(layout, showBand).find(r => r.kind === 'slot')?.h ?? 1
}

export function frameHasBand(layout: FrameLayout): boolean {
  return FRAME_TEMPLATES[layout].rows.some(r => r.kind === 'band')
}

export const DEFAULT_BAND: FrameBand = { text: '', bg: '#000000', color: '#ffffff', size: 64, font: null }

/** Top-to-bottom names for a frame's slots, e.g. Top / Bottom */
export function frameSlotLabels(layout: FrameLayout): string[] {
  const n = FRAME_TEMPLATES[layout].rows.filter(r => r.kind === 'slot').length
  return n === 1 ? ['Video'] : n === 2 ? ['Top', 'Bottom'] : ['Top', 'Middle', 'Bottom']
}

// ── Lanes and timed items ─────────────────────────────────────────────────────
// Each slot and the band is a lane. The main video fills its slots for the whole format; items
// sit on lanes for part of it, one after another. render.py (frames.py) mirrors these rules.

export interface FrameLaneInfo { lane: FrameLane; label: string; y: number; h: number }

/** A frame's lanes, top to bottom, the same order as the preview */
export function frameLanes(layout: FrameLayout, showBand = true): FrameLaneInfo[] {
  const names = frameSlotLabels(layout)
  return frameRows(layout, showBand).map(r => r.kind === 'band'
    ? { lane: 'band' as const, label: 'Text', y: r.y, h: r.h }
    : { lane: r.slot, label: names[r.slot] ?? `Slot ${r.slot + 1}`, y: r.y, h: r.h })
}

export const MIN_ITEM_MS = 200

/** The text band shows only while the frame has text on it (render.py: frame_band_shown) */
export function frameBandShown(seg: Pick<SegmentLocal, 'layout' | 'frame' | 'crop_boxes' | 'start_ms' | 'end_ms'>): boolean {
  if (!isFrameLayout(seg.layout) || !frameHasBand(seg.layout)) return false
  return laneItems(frameOf(seg), 'band', seg).length > 0
}

/** The lanes a frame has right now (no band lane until text is added) */
export function frameLanesFor(seg: SegmentLocal): FrameLaneInfo[] {
  return frameLanes(seg.layout as FrameLayout, frameBandShown(seg))
}

export function defaultFrame(layout: FrameLayout, prev?: FrameSettings | null): FrameSettings {
  const slots = FRAME_TEMPLATES[layout].rows.filter(r => r.kind === 'slot').length
  const band = frameHasBand(layout)
  return {
    band: { ...DEFAULT_BAND, ...prev?.band },
    main_slots: prev?.main_slots ? prev.main_slots.filter(i => i < slots) : [0],
    main_volume: prev?.main_volume ?? 1,
    main_muted: prev?.main_muted ?? false,
    // Items stay on lanes the new template still has
    items: (prev?.items ?? []).filter(it => it.lane === 'band' ? band : it.lane < slots),
  }
}

/**
 * A frame's settings with items. Frames saved before lanes existed kept one photo or video per
 * slot for the whole format (on its crop box) and one band text; those become full-length items.
 */
export function frameOf(seg: Pick<SegmentLocal, 'layout' | 'frame' | 'crop_boxes' | 'start_ms' | 'end_ms'>): FrameSettings {
  const f = seg.frame ?? {}
  if (f.items) return { ...f, main_slots: f.main_slots ?? [0] }
  const items: FrameItem[] = []
  const main: number[] = []
  let mainVolume = 1, mainMuted = false, sawMain = false
  for (const b of seg.crop_boxes) {
    const span = { start_ms: seg.start_ms, end_ms: seg.end_ms, lane: b.slot_index }
    if (b.image_path) items.push({ id: `legacy-${b.id}`, kind: 'photo', ...span, image_path: b.image_path, image_url: b.image_url, motion: b.image_motion ?? 'none' })
    else if (b.source_video_id) items.push({ id: `legacy-${b.id}`, kind: 'video', ...span, source_video_id: b.source_video_id, source_offset_ms: b.source_offset_ms, volume: b.volume ?? 1, muted: !!b.muted })
    else {
      main.push(b.slot_index)
      if (!sawMain) { sawMain = true; mainVolume = b.volume ?? 1; mainMuted = !!b.muted }
    }
  }
  const text = f.band?.text?.trim()
  if (text && isFrameLayout(seg.layout) && frameHasBand(seg.layout)) {
    items.push({ id: 'legacy-band', kind: 'text', lane: 'band', start_ms: seg.start_ms, end_ms: seg.end_ms, text: f.band!.text, bg: f.band!.bg, color: f.band!.color, size: f.band!.size, font: f.band!.font })
  }
  return {
    band: { ...DEFAULT_BAND, ...f.band, text: '' },
    main_slots: main,
    main_volume: mainVolume,
    main_muted: mainMuted,
    items,
  }
}

/** Items of one lane in time order, cut to the format's range (fully outside ones dropped) */
export function laneItems(frame: FrameSettings, lane: FrameLane, seg: { start_ms: number; end_ms: number }): FrameItem[] {
  return (frame.items ?? [])
    .filter(it => it.lane === lane && it.end_ms > seg.start_ms && it.start_ms < seg.end_ms)
    .sort((a, b) => a.start_ms - b.start_ms)
}

/** What a lane shows at time t (the latest-starting item wins if two ever overlap) */
export function itemAt(frame: FrameSettings, lane: FrameLane, t: number, seg: { start_ms: number; end_ms: number }): FrameItem | null {
  let hit: FrameItem | null = null
  for (const it of laneItems(frame, lane, seg)) if (t >= Math.max(it.start_ms, seg.start_ms) && t < Math.min(it.end_ms, seg.end_ms)) hit = it
  return hit
}

/**
 * Where a new item goes when "+" is pressed on a lane with the playhead at t. On an empty stretch
 * it fills all of it (from the previous item, or the frame's start, to the next item or the
 * frame's end). If an item is showing at t, it now ends at t and the new one takes over the rest
 * of its time — so pressing "+" mid-photo makes a slideshow.
 */
export function placeNewItem(frame: FrameSettings, lane: FrameLane, t: number, seg: { start_ms: number; end_ms: number }):
  { start_ms: number; end_ms: number; trim?: { id: string; end_ms: number }; replace?: string } | null {
  const items = laneItems(frame, lane, seg)
  // Snap to the format's start when the playhead is right at it
  let start = Math.max(seg.start_ms, Math.round(t))
  if (start - seg.start_ms < 250) start = seg.start_ms
  const under = items.find(it => start >= it.start_ms && start < it.end_ms)
  if (under) {
    const end = Math.min(under.end_ms, seg.end_ms)
    // Too close to the item's start: take its whole place instead of leaving a sliver
    if (start - Math.max(under.start_ms, seg.start_ms) < MIN_ITEM_MS) return { start_ms: Math.max(under.start_ms, seg.start_ms), end_ms: end, replace: under.id }
    if (end - start < MIN_ITEM_MS) return null
    return { start_ms: start, end_ms: end, trim: { id: under.id, end_ms: start } }
  }
  // Nothing showing here: fill the whole free stretch around the playhead (e.g. the rest of the frame)
  const prev = items.filter(it => it.end_ms <= start).pop()
  const next = items.find(it => it.start_ms > start)
  const from = Math.max(prev ? prev.end_ms : seg.start_ms, seg.start_ms)
  const end = Math.min(next ? next.start_ms : seg.end_ms, seg.end_ms)
  return end - from >= MIN_ITEM_MS ? { start_ms: from, end_ms: end } : null
}

/** How far an item may move or stretch on its lane without covering its neighbours */
export function itemBounds(frame: FrameSettings, item: FrameItem, seg: { start_ms: number; end_ms: number }): { min: number; max: number } {
  const items = laneItems(frame, item.lane, seg).filter(it => it.id !== item.id)
  const prev = items.filter(it => it.start_ms < item.start_ms).pop()
  const next = items.find(it => it.start_ms >= item.start_ms)
  return { min: Math.max(seg.start_ms, prev?.end_ms ?? -Infinity), max: Math.min(seg.end_ms, next?.start_ms ?? Infinity) }
}

/** Frame text-band item showing live captions at t, if any */
export function captionBandAt(seg: SegmentLocal | null, t: number): { y: number; h: number } | null {
  if (!seg || !isFrameLayout(seg.layout) || !frameHasBand(seg.layout)) return null
  const it = itemAt(frameOf(seg), 'band', t, seg)
  if (!it?.captions) return null
  const row = frameRows(seg.layout).find(r => r.kind === 'band')!
  return { y: row.y, h: row.h }
}

/**
 * Stretches of a frame where a media slot shows nothing (no main video, no item). Stretches
 * shorter than `minMs` are ignored. Each stretch lists the slots that are empty during it.
 */
export function emptySlotStretches(seg: SegmentLocal, minMs = 300): { start_ms: number; end_ms: number; slots: number[] }[] {
  if (!isFrameLayout(seg.layout)) return []
  const frame = frameOf(seg)
  const main = frame.main_slots ?? [0]
  // Cut the frame at every item edge; each piece is either empty or filled for every slot
  const cuts = new Set<number>([seg.start_ms, seg.end_ms])
  for (const it of frame.items ?? []) {
    if (it.start_ms > seg.start_ms && it.start_ms < seg.end_ms) cuts.add(it.start_ms)
    if (it.end_ms > seg.start_ms && it.end_ms < seg.end_ms) cuts.add(it.end_ms)
  }
  const pts = [...cuts].sort((a, b) => a - b)
  const slotLanes = frameRows(seg.layout).filter(r => r.kind === 'slot').map(r => (r as { slot: number }).slot)
  const out: { start_ms: number; end_ms: number; slots: number[] }[] = []
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], mid = (a + b) / 2
    const empty = slotLanes.filter(slot => !main.includes(slot) && !itemAt(frame, slot, mid, seg))
    if (!empty.length) continue
    const last = out[out.length - 1]
    // Neighbouring pieces with the same empty slots join up
    if (last && last.end_ms === a && last.slots.join() === empty.join()) last.end_ms = b
    else out.push({ start_ms: a, end_ms: b, slots: empty })
  }
  return out.filter(s => s.end_ms - s.start_ms >= minMs)
}
