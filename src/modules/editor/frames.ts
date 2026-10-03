import type { FrameLayout, FrameBand, FrameItem, FrameLane, FrameSettings, LayoutType, SegmentLocal, CornerStyle } from '@chai-cut/shared'

// Frame templates: the 9:16 reel divided top-to-bottom into media slots and (optionally) one
// letterbox band for text. Heights are shares of the 1920 px frame. render.py mirrors these
// numbers — keep the two in step.

// 'caption': a plain strip (no lane) where the clip's captions sit while this frame shows
export type FrameRow = { kind: 'slot'; slot: number; h: number } | { kind: 'band'; h: number } | { kind: 'caption'; h: number }

export interface FrameTemplate {
  name: string
  description: string
  rows: FrameRow[]
  /** What each slot starts as when the frame is applied */
  defaults: ('video' | 'photo')[]
  /** No slot shows the main video to start with; it's heard under the frame (photo frames) */
  mainUnder?: boolean
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
  frame_title_caption: {
    name: 'Title + Caption', description: 'A title on top, the video, and a strip below for captions.',
    rows: [{ kind: 'band', h: 0.16 }, { kind: 'slot', slot: 0, h: 0.68 }, { kind: 'caption', h: 0.16 }],
    defaults: ['video'],
  },
  frame_big_small: {
    name: 'Big + Small', description: 'A large video on top and a smaller video or photo below.',
    rows: [{ kind: 'slot', slot: 0, h: 0.7 }, { kind: 'slot', slot: 1, h: 0.3 }],
    defaults: ['video', 'video'],
  },
  frame_photo_story: {
    name: 'Photo Story', description: 'Two photos under a title — before/after or a slideshow, with the video\u2019s sound.',
    rows: [{ kind: 'band', h: 0.16 }, { kind: 'slot', slot: 0, h: 0.42 }, { kind: 'slot', slot: 1, h: 0.42 }],
    defaults: ['photo', 'photo'],
    mainUnder: true,
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
export function frameRows(layout: FrameLayout, showBand = true, custom?: number[] | null): (FrameRow & { y: number })[] {
  const hs = validRowHeights(layout, custom)
  const rows = FRAME_TEMPLATES[layout].rows.map((r, i) => hs ? { ...r, h: hs[i] } : r).filter(r => showBand || r.kind !== 'band')
  const total = rows.reduce((a, r) => a + r.h, 0) || 1
  let y = 0
  return rows.map(r => { const h = r.h / total, row = { ...r, h, y }; y += h; return row })
}

/** The smallest the main video's box can be made (share of its slot, each way) */
export const MIN_BOX = 0.15

/** The main video's box inside a slot (shares of the slot), kept inside it; null = the whole slot. render.py mirrors this. */
export function mainRect(frame: FrameSettings, slot: number): { x: number; y: number; w: number; h: number } | null {
  return boxRect(frame.main_rects?.[String(slot)])
}

/** A media box inside its slot (shares of the slot), kept inside it; null = the whole slot */
export function boxRect(r: { x: number; y: number; w: number; h: number } | null | undefined): { x: number; y: number; w: number; h: number } | null {
  if (!r || ![r.x, r.y, r.w, r.h].every(v => typeof v === 'number' && isFinite(v))) return null
  const w = Math.max(MIN_BOX, Math.min(1, r.w)), h = Math.max(MIN_BOX, Math.min(1, r.h))
  const x = Math.max(0, Math.min(1 - w, r.x)), y = Math.max(0, Math.min(1 - h, r.y))
  return w > 0.999 && h > 0.999 ? null : { x, y, w, h }
}

/** The smallest a row can be dragged to (share of the frame) */
export const MIN_ROW_H = 0.08

/** A frame's resized row heights if they fit its template (one per row, none too small); else null. render.py (frames.py) mirrors this. */
export function validRowHeights(layout: FrameLayout, custom?: number[] | null): number[] | null {
  const n = FRAME_TEMPLATES[layout].rows.length
  if (!Array.isArray(custom) || custom.length !== n || !custom.every(h => typeof h === 'number' && isFinite(h) && h >= 0.03)) return null
  const total = custom.reduce((a, h) => a + h, 0)
  return custom.map(h => h / total)
}

/** Height (share of the frame) of one media slot (slots differ in Big + Small) */
export function frameSlotHeight(layout: FrameLayout, showBand = true, slot = 0, custom?: number[] | null): number {
  const rows = frameRows(layout, showBand, custom)
  return (rows.find(r => r.kind === 'slot' && r.slot === slot) ?? rows.find(r => r.kind === 'slot'))?.h ?? 1
}

export function frameHasBand(layout: FrameLayout): boolean {
  return FRAME_TEMPLATES[layout].rows.some(r => r.kind === 'band')
}

/** Rounded corners a video or photo starts with when it's put in a frame (the Corners slider, 0–100) */
export const DEFAULT_CORNERS = 80

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
export function frameLanes(layout: FrameLayout, showBand = true, custom?: number[] | null): FrameLaneInfo[] {
  const names = frameSlotLabels(layout)
  return frameRows(layout, showBand, custom).flatMap((r): FrameLaneInfo[] => r.kind === 'band'
    ? [{ lane: 'band' as const, label: 'Text', y: r.y, h: r.h }]
    : r.kind === 'slot' ? [{ lane: r.slot, label: names[r.slot] ?? `Slot ${r.slot + 1}`, y: r.y, h: r.h }]
      : [])   // the caption strip isn't a lane: the captions go there by themselves
}

export const MIN_ITEM_MS = 200

/**
 * What a slot's "+" offers in each frame. Video slots offer the same (main) video or a different
 * one; photo slots a photo; Triple's slots both. Text goes on the band — offered from a slot's "+"
 * only where the frame has no other way to add it on the timeline (Single, Video + Photo); in
 * Dual + Letterbox the middle band has its own "Add text".
 */
export function slotOffers(layout: FrameLayout, slot: number): { video: boolean; photo: boolean; text: boolean } {
  switch (layout) {
    case 'frame_single': return { video: true, photo: false, text: true }
    case 'frame_video_photo': return { video: slot === 0, photo: slot !== 0, text: true }
    case 'frame_dual': return { video: true, photo: false, text: false }
    case 'frame_dual_letterbox': return { video: true, photo: false, text: false }
    case 'frame_triple': return { video: true, photo: true, text: false }
    case 'frame_title_caption': return { video: true, photo: false, text: true }
    case 'frame_big_small': return { video: true, photo: true, text: false }
    case 'frame_photo_story': return { video: false, photo: true, text: true }
  }
}

/**
 * Sound of the main video in one slot. Each slot has its own volume and mute. A slot without its
 * own setting: the first slot showing the main video uses the frame's older main setting; any
 * other starts muted (it's the same sound as the first). render.py (frames.py) mirrors this.
 */
export function mainSlotSound(frame: FrameSettings, slot: number): { volume: number; muted: boolean } {
  const key = String(slot)
  const first = Math.min(...(frame.main_slots ?? [0]))
  const volume = frame.main_volumes?.[key] ?? (slot === first ? frame.main_volume ?? 1 : 1)
  const muted = frame.main_mutes?.[key] ?? (slot === first ? !!frame.main_muted : true)
  return { volume, muted }
}

/** How loud the main video plays in a frame: every slot showing it adds its own sound */
export function mainAudioVolume(frame: FrameSettings): number {
  // Heard under a frame no slot shows it in (Photo Story)
  if (frame.main_under && !(frame.main_slots ?? [0]).length) return frame.main_muted ? 0 : frame.main_volume ?? 1
  return (frame.main_slots ?? [0]).reduce((sum, slot) => {
    const s = mainSlotSound(frame, slot)
    return sum + (s.muted ? 0 : s.volume)
  }, 0)
}

/**
 * Rounded corners of frame media from the Corners slider (0–100), in px at 1080 wide: the black
 * border (inset) around the media and the corner radius. render.py (frames.py corner_geometry)
 * uses the same numbers. Values saved as 's'/'m'/'l' by the first version map onto the slider.
 */
export const CORNER_MAX = { inset: 44, radius: 96 }
export function cornerGeometry(v: CornerStyle | string | null | undefined): { inset: number; radius: number } | null {
  const n = typeof v === 'number' ? v : v === 's' ? 35 : v === 'm' ? 60 : v === 'l' ? 100 : 0
  const k = Math.max(0, Math.min(100, n)) / 100
  return k > 0 ? { inset: CORNER_MAX.inset * k, radius: CORNER_MAX.radius * k } : null
}

/**
 * Whether the frame shows its band: always, for templates that have one — a black space ready
 * for text (render.py: frame_band_shown). Its timeline lane only appears once text is added.
 */
export function frameBandShown(seg: Pick<SegmentLocal, 'layout'>): boolean {
  return isFrameLayout(seg.layout) && frameHasBand(seg.layout)
}

/** The lanes a frame has, top to bottom (the same rows as the preview) */
export function frameLanesFor(seg: SegmentLocal): FrameLaneInfo[] {
  return frameLanes(seg.layout as FrameLayout, frameBandShown(seg), seg.frame?.row_h)
}

export function defaultFrame(layout: FrameLayout, prev?: FrameSettings | null): FrameSettings {
  const slots = FRAME_TEMPLATES[layout].rows.filter(r => r.kind === 'slot').length
  const band = frameHasBand(layout)
  const under = !!FRAME_TEMPLATES[layout].mainUnder
  // The main video stays in the slots that still take a video; a frame for videos never starts without it
  const kept = (prev?.main_slots ?? [0]).filter(i => i < slots && slotOffers(layout, i).video)
  return {
    band: { ...DEFAULT_BAND, ...prev?.band },
    main_slots: under ? [] : kept.length ? kept : [0],
    main_under: under,
    main_volume: prev?.main_volume ?? 1,
    main_muted: prev?.main_muted ?? false,
    // The main video keeps its corners; put in a frame for the first time, it starts rounded
    main_corners: prev?.main_corners ?? { '0': DEFAULT_CORNERS, '1': DEFAULT_CORNERS, '2': DEFAULT_CORNERS },
    // Items stay on lanes the new template still has, and only if that slot can show them
    // (e.g. a photo in Video + Photo's bottom slot doesn't carry into Dual Video, whose slots are
    // video-only, so that slot comes up empty with its "+")
    items: (prev?.items ?? []).filter(it => {
      if (it.lane === 'band') return band
      if (it.lane >= slots) return false
      const offers = slotOffers(layout, it.lane)
      return it.kind === 'photo' ? offers.photo : it.kind === 'video' ? offers.video : offers.text
    }),
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
  if (!seg || !isFrameLayout(seg.layout)) return null
  const rows = frameRows(seg.layout, true, seg.frame?.row_h)
  const it = frameHasBand(seg.layout) ? itemAt(frameOf(seg), 'band', t, seg) : null
  if (it?.captions && !it.hidden) { const row = rows.find(r => r.kind === 'band')!; return { y: row.y, h: row.h } }
  // A frame with a caption strip: the captions sit there
  const strip = rows.find(r => r.kind === 'caption')
  return strip ? { y: strip.y, h: strip.h } : null
}

/**
 * Stretches of a frame where a media slot shows nothing (no main video, no item). Stretches
 * shorter than `minMs` are ignored. Each stretch lists the slots that are empty during it.
 */
export function emptySlotStretches(seg: SegmentLocal, minMs = 300): { start_ms: number; end_ms: number; slots: number[] }[] {
  if (!isFrameLayout(seg.layout)) return []
  const all = frameOf(seg)
  // A hidden item doesn't fill its slot (only its sound may play)
  const frame = { ...all, items: (all.items ?? []).filter(it => !it.hidden) }
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
