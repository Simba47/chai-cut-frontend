import type { FrameLayout, FrameBand, FrameItem, FrameLane, FrameSettings, LayoutType, SegmentLocal, CornerStyle } from '@chai-cut/shared'

// Frame templates. Most divide the 9:16 reel top-to-bottom into rows (media slots, a letterbox
// band for text, a caption strip) whose lines can be dragged; the others place areas anywhere —
// side by side, a grid, a floating picture-in-picture, a comment bubble over the video. Sizes are
// shares of the 1080×1920 frame. render.py (frames.py) mirrors these numbers — keep them in step.

/** A text lane: the frame's main band, or a second text area (a name tag, a badge, a ticker) */
export type TextLane = 'band' | 'band2'
export const isTextLane = (lane: FrameLane): lane is TextLane => typeof lane === 'string'

/** How a slot shows its media: cover (fills it, cropping) or contain (whole, on its fill colour) */
type SlotLook = { label?: string; fit?: 'contain'; fill?: string; radius?: number | 'circle' }
/** A text area's own look: its colour when empty ('none': see-through), and new text's colour and size */
type TextLook = { label?: string; bg?: string; color?: string; size?: number; radius?: number; ticker?: boolean }

// 'caption': a plain strip (no lane) where the clip's captions sit while this frame shows
export type FrameRow =
  | ({ kind: 'slot'; slot: number; h: number } & SlotLook)
  | ({ kind: 'band'; h: number } & TextLook)
  | { kind: 'caption'; h: number; bg?: string }

/** A free area: anywhere in the frame (x, y, w, h: shares of the frame), drawn in list order */
export type FrameAreaDef =
  | ({ kind: 'slot'; slot: number; x: number; y: number; w: number; h: number } & SlotLook)
  | ({ kind: 'band'; lane: TextLane; x: number; y: number; w: number; h: number } & TextLook)
  | { kind: 'caption'; x: number; y: number; w: number; h: number; bg?: string }
  /** A moving sound wave of the clip's audio */
  | { kind: 'wave'; x: number; y: number; w: number; h: number; color?: string }

/** An area of a frame, wherever it came from (a row or a free area) */
export type FrameArea = FrameAreaDef

export interface FrameTemplate {
  name: string
  description: string
  /** Stacked templates: full-width rows, top to bottom (their lines can be dragged) */
  rows?: FrameRow[]
  /** Free templates: areas anywhere, drawn in this order (later ones on top) */
  areas?: FrameAreaDef[]
  /** Under the areas: a blurred copy of the main video, or the band's colour (default black) */
  base?: 'blur' | 'band'
  /** The band's colour a new frame of this kind starts with */
  bandBg?: string
  /** What each slot starts as when the frame is applied */
  defaults: ('video' | 'photo')[]
  /** Slots that show the main video when the frame is applied (default: the first video slot) */
  mainSlots?: number[]
  /** No slot shows the main video to start with; it's heard under the frame (photo frames) */
  mainUnder?: boolean
  /** Rounded corners the main video starts with (default DEFAULT_CORNERS; 0: square) */
  corners?: number
  /** What each slot's "+" offers (default: derived from the template) */
  offers?: { video: boolean; photo: boolean; text?: boolean }[]
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

  // ── Added 2026-10 ──
  frame_blur_fill: {
    name: 'Blur fill', description: 'The whole wide video, nothing cropped, on a blurred copy of itself — a title above, captions below.',
    base: 'blur',
    areas: [
      { kind: 'band', lane: 'band', x: 0, y: 0, w: 1, h: 0.22, bg: 'none', label: 'Title' },
      { kind: 'slot', slot: 0, x: 0, y: 0.22, w: 1, h: 0.56, fit: 'contain', fill: 'none', label: 'Video' },
      { kind: 'caption', x: 0, y: 0.78, w: 1, h: 0.22, bg: 'none' },
    ],
    defaults: ['video'],
  },
  frame_gameplay: {
    name: 'Gameplay split', description: 'The speaker on top, gameplay or satisfying footage below to hold attention (it loops).',
    rows: [{ kind: 'slot', slot: 0, h: 0.5, label: 'Speaker' }, { kind: 'slot', slot: 1, h: 0.5, label: 'Gameplay' }],
    defaults: ['video', 'video'], mainSlots: [0],
    offers: [{ video: true, photo: false }, { video: true, photo: true }],
  },
  frame_pip: {
    name: 'Picture in picture', description: 'Your content full screen, the speaker in a small box in the corner.',
    areas: [
      { kind: 'slot', slot: 0, x: 0, y: 0, w: 1, h: 1, label: 'Content' },
      { kind: 'slot', slot: 1, x: 0.58, y: 0.66, w: 0.36, h: 0.2025, radius: 36, label: 'Face cam' },
    ],
    defaults: ['video', 'video'], mainSlots: [1],
    offers: [{ video: true, photo: true }, { video: true, photo: true }],
  },
  frame_screenshot: {
    name: 'Pic + Vid', description: 'A picture on top (shown whole: a photo, tweet, headline or article), the video below.',
    rows: [
      { kind: 'slot', slot: 0, h: 0.42, fit: 'contain', fill: '#111111', label: 'Pic' },
      { kind: 'slot', slot: 1, h: 0.58, label: 'Video' },
    ],
    // The Pic slot takes a picture only (user 2026-10-17: its "+" asked for a video too)
    defaults: ['photo', 'video'], mainSlots: [1],
    offers: [{ video: false, photo: true }, { video: true, photo: false }],
  },
  frame_comment: {
    name: 'Comment reply', description: 'A comment bubble over the video, like TikTok\u2019s "reply to comment".',
    areas: [
      { kind: 'slot', slot: 0, x: 0, y: 0, w: 1, h: 1, label: 'Video' },
      { kind: 'band', lane: 'band', x: 0.07, y: 0.1, w: 0.86, h: 0.13, radius: 28, bg: '#ffffff', color: '#111111', size: 46, label: 'Comment' },
    ],
    defaults: ['video'],
  },
  frame_letterbox_wide: {
    name: 'Letterbox wide', description: 'The full wide video with black bars: the headline above, captions below.',
    rows: [{ kind: 'band', h: 0.34, label: 'Headline' }, { kind: 'slot', slot: 0, h: 0.32, label: 'Video' }, { kind: 'caption', h: 0.34 }],
    defaults: ['video'],
  },
  frame_two_crops: {
    name: 'Close-up + wide', description: 'The same video twice: a tight close-up on top, the wide shot below.',
    rows: [{ kind: 'slot', slot: 0, h: 0.5, label: 'Close-up' }, { kind: 'slot', slot: 1, h: 0.5, label: 'Wide' }],
    defaults: ['video', 'video'], mainSlots: [0, 1],
  },
  frame_side_by_side: {
    name: 'Side by side', description: 'Two videos in columns, left and right — duets and comparisons.',
    areas: [
      { kind: 'band', lane: 'band', x: 0, y: 0, w: 1, h: 0.18, label: 'Title' },
      { kind: 'slot', slot: 0, x: 0, y: 0.18, w: 0.5, h: 0.64, label: 'Left' },
      { kind: 'slot', slot: 1, x: 0.5, y: 0.18, w: 0.5, h: 0.64, label: 'Right' },
      { kind: 'caption', x: 0, y: 0.82, w: 1, h: 0.18 },
    ],
    defaults: ['video', 'video'], mainSlots: [0],
    offers: [{ video: true, photo: true }, { video: true, photo: true }],
  },
  frame_name_tags: {
    name: 'Speaker names', description: 'Two speakers stacked, each with a name tag.',
    areas: [
      { kind: 'slot', slot: 0, x: 0, y: 0, w: 1, h: 0.5, label: 'Top' },
      { kind: 'slot', slot: 1, x: 0, y: 0.5, w: 1, h: 0.5, label: 'Bottom' },
      { kind: 'band', lane: 'band', x: 0.04, y: 0.41, w: 0.56, h: 0.065, radius: 14, bg: '#111111', size: 44, label: 'Name 1' },
      { kind: 'band', lane: 'band2', x: 0.04, y: 0.91, w: 0.56, h: 0.065, radius: 14, bg: '#111111', size: 44, label: 'Name 2' },
    ],
    defaults: ['video', 'video'], mainSlots: [0, 1],
  },
  frame_brand_card: {
    name: 'Branded card', description: 'The video as a rounded card on your colour, with a title and your @handle.',
    base: 'band', bandBg: '#1c1c22',
    areas: [
      { kind: 'band', lane: 'band', x: 0.06, y: 0.05, w: 0.88, h: 0.15, bg: 'none', label: 'Title' },
      { kind: 'slot', slot: 0, x: 0.06, y: 0.21, w: 0.88, h: 0.6, radius: 40, label: 'Video' },
      { kind: 'band', lane: 'band2', x: 0.06, y: 0.83, w: 0.88, h: 0.1, bg: 'none', size: 40, label: 'Handle' },
    ],
    defaults: ['video'],
  },
  frame_top_list: {
    name: 'Top list', description: 'A "Top 5" header and a number badge you change for each part.',
    areas: [
      { kind: 'band', lane: 'band', x: 0, y: 0, w: 1, h: 0.16, label: 'Title' },
      { kind: 'slot', slot: 0, x: 0, y: 0.16, w: 1, h: 0.84, label: 'Video' },
      { kind: 'band', lane: 'band2', x: 0.05, y: 0.19, w: 0.2, h: 0.1, radius: 24, bg: '#c8ff00', color: '#000000', size: 96, label: 'Number' },
    ],
    defaults: ['video'],
  },
  frame_screen_face: {
    name: 'Screen + face cam', description: 'A screen recording on top (shown whole), the speaker in a circle below.',
    areas: [
      { kind: 'slot', slot: 0, x: 0, y: 0, w: 1, h: 0.62, fit: 'contain', fill: '#000000', label: 'Screen' },
      { kind: 'slot', slot: 1, x: 0.3, y: 0.66, w: 0.4, h: 0.225, radius: 'circle', label: 'Face' },
      { kind: 'caption', x: 0, y: 0.89, w: 1, h: 0.11 },
    ],
    defaults: ['video', 'video'], mainSlots: [1],
    offers: [{ video: true, photo: true }, { video: true, photo: true }],
  },
  frame_audiogram: {
    name: 'Audiogram', description: 'A cover picture, a moving sound wave and captions — for audio-only clips.',
    areas: [
      { kind: 'band', lane: 'band', x: 0, y: 0, w: 1, h: 0.16, label: 'Title' },
      { kind: 'slot', slot: 0, x: 0.15, y: 0.18, w: 0.7, h: 0.39375, radius: 32, label: 'Cover' },
      { kind: 'wave', x: 0.1, y: 0.6, w: 0.8, h: 0.12, color: '#c8ff00' },
      { kind: 'caption', x: 0, y: 0.76, w: 1, h: 0.2 },
    ],
    defaults: ['photo'], mainUnder: true,
    offers: [{ video: true, photo: true }],
  },
  frame_grid: {
    name: '2×2 grid', description: 'Four clips at once — recaps and montages.',
    areas: [
      { kind: 'slot', slot: 0, x: 0, y: 0, w: 0.5, h: 0.5, label: 'Top left' },
      { kind: 'slot', slot: 1, x: 0.5, y: 0, w: 0.5, h: 0.5, label: 'Top right' },
      { kind: 'slot', slot: 2, x: 0, y: 0.5, w: 0.5, h: 0.5, label: 'Bottom left' },
      { kind: 'slot', slot: 3, x: 0.5, y: 0.5, w: 0.5, h: 0.5, label: 'Bottom right' },
    ],
    defaults: ['video', 'video', 'video', 'video'], mainSlots: [0],
    offers: [{ video: true, photo: true }, { video: true, photo: true }, { video: true, photo: true }, { video: true, photo: true }],
  },
  frame_news: {
    name: 'News', description: 'A breaking-news headline bar and a scrolling ticker over the video.',
    areas: [
      { kind: 'slot', slot: 0, x: 0, y: 0, w: 1, h: 1, label: 'Video' },
      { kind: 'band', lane: 'band', x: 0, y: 0.7, w: 1, h: 0.09, bg: '#dc2626', color: '#ffffff', size: 56, label: 'Headline' },
      { kind: 'band', lane: 'band2', x: 0, y: 0.79, w: 1, h: 0.05, bg: '#111111', color: '#ffffff', size: 38, ticker: true, label: 'Ticker' },
    ],
    defaults: ['video'],
  },
}

/**
 * The frames the gallery offers, the most used first (user 2026-10-12; cut down to these eight
 * 2026-10-13). The others (Gameplay split, Close-up + wide, Picture in picture, Comment reply,
 * Big + Small, Top list, Letterbox wide, Dual + Letterbox, Video + Photo, News, Audiogram, Photo
 * Story, 2×2 grid, Triple) stay defined above so clips that already use them still show, edit and
 * export as before; they just aren't offered for new frames. Branded card is kept for the brand kit
 * planned later (a saved colour, title and @handle for every clip), not offered as a frame.
 */
export const FRAME_LAYOUTS: FrameLayout[] = [
  'frame_single', 'frame_title_caption', 'frame_blur_fill', 'frame_dual', 'frame_screenshot', 'frame_name_tags',
  'frame_side_by_side', 'frame_screen_face',
]

export function isFrameLayout(layout: LayoutType | string | null | undefined): layout is FrameLayout {
  return !!layout && layout in FRAME_TEMPLATES
}

/**
 * Rows of a frame with their top edge, as shares of the frame height. The text band only exists
 * once the frame has text on it (`showBand`); without it the slots share the whole height.
 */
/**
 * How a stacked frame's rows are laid out when changed in the editor: their heights (the bar,
 * one per template row) and their order top to bottom (the bar's swap: template row numbers).
 * A plain list is just the heights.
 */
export type RowLayout = number[] | Pick<FrameSettings, 'row_h' | 'row_order'> | null | undefined
const rowHeightsOf = (custom: RowLayout) => (Array.isArray(custom) ? custom : custom?.row_h ?? null)

/** The rows' order top to bottom (template row numbers), when swapped and it fits the template; else null */
export function validRowOrder(layout: FrameLayout, custom: RowLayout): number[] | null {
  const order = Array.isArray(custom) ? null : custom?.row_order
  const n = FRAME_TEMPLATES[layout].rows?.length ?? 0
  if (!Array.isArray(order) || order.length !== n || new Set(order).size !== n || !order.every(i => Number.isInteger(i) && i >= 0 && i < n)) return null
  return order.every((v, i) => v === i) ? null : order
}

export function frameRows(layout: FrameLayout, showBand = true, custom?: RowLayout): (FrameRow & { y: number })[] {
  const tplRows = FRAME_TEMPLATES[layout].rows
  if (!tplRows) return []   // a free template has no rows (its areas don't resize)
  const hs = validRowHeights(layout, rowHeightsOf(custom))
  const sized = tplRows.map((r, i) => hs ? { ...r, h: hs[i] } : r)
  // Swapped with the bar's swap: the rows in that order, each keeping its own size and look
  const order = validRowOrder(layout, custom)
  const rows = (order ? order.map(i => sized[i]) : sized).filter(r => showBand || r.kind !== 'band')
  const total = rows.reduce((a, r) => a + r.h, 0) || 1
  let y = 0
  return rows.map(r => { const h = r.h / total, row = { ...r, h, y }; y += h; return row })
}

/**
 * Every area of a frame with its place (shares of the frame), in drawing order: a stacked
 * template's rows as full-width areas, or a free template's areas as they are.
 */
export function frameAreas(layout: FrameLayout, showBand = true, custom?: RowLayout): FrameArea[] {
  const tpl = FRAME_TEMPLATES[layout]
  if (tpl.areas) return tpl.areas.filter(a => showBand || a.kind !== 'band')
  return frameRows(layout, showBand, custom).map((r): FrameArea => r.kind === 'band'
    ? { ...r, lane: 'band', x: 0, w: 1 }
    : { ...r, x: 0, w: 1 })
}

/** The area of one slot */
export function frameSlotArea(layout: FrameLayout, slot: number, showBand = true, custom?: RowLayout): FrameArea | null {
  return frameAreas(layout, showBand, custom).find(a => a.kind === 'slot' && a.slot === slot) ?? null
}

/** The area of a text lane (the band, or a second text area) */
export function frameTextArea(layout: FrameLayout, lane: TextLane, custom?: RowLayout): Extract<FrameArea, { kind: 'band' }> | null {
  return (frameAreas(layout, true, custom).find(a => a.kind === 'band' && a.lane === lane) as Extract<FrameArea, { kind: 'band' }>) ?? null
}

/** Corner radius of an area in px at 1080 wide ('circle': half its shorter side) */
export function areaRadius(a: { w: number; h: number; radius?: number | 'circle' }): number {
  if (a.radius === 'circle') return Math.min(a.w * 1080, a.h * 1920) / 2
  return a.radius ?? 0
}

/** What's under a frame's areas: a blurred copy of the main video, a colour, or black */
export function frameBase(layout: FrameLayout): 'blur' | 'band' | null {
  return FRAME_TEMPLATES[layout].base ?? null
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
  const tplRows = FRAME_TEMPLATES[layout].rows
  if (!tplRows) return null
  const n = tplRows.length
  if (!Array.isArray(custom) || custom.length !== n || !custom.every(h => typeof h === 'number' && isFinite(h) && h >= 0.03)) return null
  const total = custom.reduce((a, h) => a + h, 0)
  return custom.map(h => h / total)
}

/**
 * Size (shares of the frame) of one media slot, or null when the slot shows its media whole
 * ("contain": the main video isn't cropped to a shape there)
 */
export function frameSlotSize(layout: FrameLayout, showBand = true, slot = 0, custom?: RowLayout): { w: number; h: number } | null {
  const areas = frameAreas(layout, showBand, custom)
  const a = areas.find(x => x.kind === 'slot' && x.slot === slot) ?? areas.find(x => x.kind === 'slot')
  if (!a) return { w: 1, h: 1 }
  if (a.kind === 'slot' && a.fit === 'contain') return null
  return { w: a.w, h: a.h }
}

/** Whether the frame has a text area (the band) */
export function frameHasBand(layout: FrameLayout): boolean {
  return frameAreas(layout).some(a => a.kind === 'band')
}

/** The frame's text lanes, top to bottom ('band', and 'band2' where it has a second text area) */
export function frameTextLanes(layout: FrameLayout): TextLane[] {
  return frameAreas(layout).flatMap(a => a.kind === 'band' ? [a.lane] : [])
}

/** New text on a lane: the frame's band look, with the text area's own colours and size where it has them */
export function textLaneLook(seg: Pick<SegmentLocal, 'layout' | 'frame'>, lane: FrameLane): { bg: string; color: string; size: number } {
  const band = { ...DEFAULT_BAND, ...seg.frame?.band }
  if (!isFrameLayout(seg.layout) || !isTextLane(lane)) return { bg: '#000000', color: band.color, size: 80 }
  const a = frameTextArea(seg.layout, lane, seg.frame)
  return { bg: a?.bg ?? band.bg, color: a?.color ?? band.color, size: a?.size ?? band.size }
}

/**
 * Rounded corners a video or photo starts with when it's put in a frame (the Corners slider, 0–100).
 * Every frame starts rounded (user 2026-10-17), media shown whole too — rounded on its own edges.
 * Only an area that has its own shape (a circle, a rounded box) starts square: see newItemCorners.
 */
export const DEFAULT_CORNERS = 80

/**
 * Corners a photo or video put in a slot starts with: the frame's own (square in the frames drawn
 * square, like its main video), and none in an area that has its own shape (a circle, a rounded
 * box) — a rounded inset there would show a black ring inside it.
 */
export function newItemCorners(layout: FrameLayout, slot: number): number {
  const area = frameAreas(layout).find(a => a.kind === 'slot' && a.slot === slot)
  if (area && area.kind === 'slot' && area.radius) return 0
  return FRAME_TEMPLATES[layout].corners ?? DEFAULT_CORNERS
}

/** The slot whose picture, blurred, fills a 'blur' frame's background (render.py frames.py BLUR_SOURCE_SLOT) */
export const BLUR_SOURCE_SLOT = 0

export const DEFAULT_BAND: FrameBand = { text: '', bg: '#000000', color: '#ffffff', size: 64, font: null }

/**
 * Names for a frame's slots by slot number, e.g. Top / Bottom (the template's own where it names
 * them). Top / Bottom go by where the slot is: after a swap the slot now at the top is Top.
 */
export function frameSlotLabels(layout: FrameLayout, custom?: RowLayout): string[] {
  const slots = frameAreas(layout, true, custom).filter(a => a.kind === 'slot') as Extract<FrameArea, { kind: 'slot' }>[]
  const n = slots.length
  const plain = n === 1 ? ['Video'] : n === 2 ? ['Top', 'Bottom'] : ['Top', 'Middle', 'Bottom']
  const out: string[] = []
  slots.forEach((a, k) => { out[a.slot] = a.label ?? plain[k] ?? `Slot ${a.slot + 1}` })
  return out
}

/** How many media slots a frame has */
export function frameSlotCount(layout: FrameLayout): number {
  return frameAreas(layout).filter(a => a.kind === 'slot').length
}

// ── Lanes and timed items ─────────────────────────────────────────────────────
// Each slot and the band is a lane. The main video fills its slots for the whole format; items
// sit on lanes for part of it, one after another. render.py (frames.py) mirrors these rules.

export interface FrameLaneInfo { lane: FrameLane; label: string; x: number; y: number; w: number; h: number }

/** A frame's lanes in the order its areas are listed (top to bottom for stacked frames) */
export function frameLanes(layout: FrameLayout, showBand = true, custom?: RowLayout): FrameLaneInfo[] {
  const names = frameSlotLabels(layout, custom)
  return frameAreas(layout, showBand, custom).flatMap((a): FrameLaneInfo[] => a.kind === 'band'
    ? [{ lane: a.lane, label: a.label ?? 'Text', x: a.x, y: a.y, w: a.w, h: a.h }]
    : a.kind === 'slot' ? [{ lane: a.slot, label: names[a.slot] ?? `Slot ${a.slot + 1}`, x: a.x, y: a.y, w: a.w, h: a.h }]
      : [])   // the caption strip and the sound wave aren't lanes: they fill themselves
}

export const MIN_ITEM_MS = 200

/**
 * What a slot's "+" offers in each frame. Video slots offer the same (main) video or a different
 * one; photo slots a photo; Triple's slots both. Text goes on the band — offered from a slot's "+"
 * only where the frame has no other way to add it on the timeline (Single, Video + Photo); in
 * Dual + Letterbox the middle band has its own "Add text".
 */
export function slotOffers(layout: FrameLayout, slot: number): { video: boolean; photo: boolean; text: boolean } {
  const own = FRAME_TEMPLATES[layout].offers?.[slot]
  if (own) return { video: own.video, photo: own.photo, text: !!own.text }
  switch (layout) {
    case 'frame_single': return { video: true, photo: true, text: true }
    case 'frame_video_photo': return { video: slot === 0, photo: slot !== 0, text: true }
    case 'frame_dual': return { video: true, photo: true, text: false }
    case 'frame_dual_letterbox': return { video: true, photo: false, text: false }
    case 'frame_triple': return { video: true, photo: true, text: false }
    case 'frame_title_caption': return { video: true, photo: true, text: true }
    // Blur fill: a photo shows whole on its own blurred copy; Speaker names: a speaker's photo
    case 'frame_blur_fill': return { video: true, photo: true, text: false }
    case 'frame_name_tags': return { video: true, photo: true, text: false }
    case 'frame_big_small': return { video: true, photo: true, text: false }
    case 'frame_photo_story': return { video: false, photo: true, text: true }
    default: {
      const d = FRAME_TEMPLATES[layout].defaults[slot]
      return { video: d !== 'photo', photo: d === 'photo', text: false }
    }
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
// (radius 96 until 2026-10-17: the user asked for rounder corners)
export const CORNER_MAX = { inset: 44, radius: 140 }
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
  return frameLanes(seg.layout as FrameLayout, frameBandShown(seg), seg.frame)
}

/**
 * The lanes a frame shows on the timeline, top to bottom as its preview shows them. The band's lane
 * appears once text is on it (the band itself is always in the preview, with its own "Add text"
 * button). A Single frame's slot is just the main video — the film strip already shows that — so it
 * only gets a lane once something is put on it. `asTemplate`: in the template's own order (unswapped).
 */
export function timelineLanes(seg: SegmentLocal, asTemplate = false): FrameLaneInfo[] {
  const frame = frameOf(seg)
  const main = frame.main_slots ?? [0]
  const slots = frameSlotCount(seg.layout as FrameLayout)
  const all = asTemplate ? frameLanes(seg.layout as FrameLayout, frameBandShown(seg), { row_h: seg.frame?.row_h }) : frameLanesFor(seg)
  return all.filter(r => {
    const empty = laneItems(frame, r.lane, seg).length === 0
    if (isTextLane(r.lane)) return !empty
    return !(slots === 1 && main.includes(r.lane) && empty)
  })
}

/**
 * The timeline's lane rows are shared by every frame on the clip, one row per lane of the templates
 * (in their own order). A frame swapped with the bar's swap shows its lanes in its own order — its
 * top area in the top row — without moving any other frame's lanes: the row `rowLane` shows this
 * frame's lane at the same place in its order. Unswapped, that is the lane itself.
 */
export function laneInRow(seg: SegmentLocal, rowLane: FrameLane): FrameLaneInfo | null {
  const k = timelineLanes(seg, true).findIndex(r => r.lane === rowLane)
  return k < 0 ? null : timelineLanes(seg)[k] ?? null
}

/** The row a timeline row key names (`frame:<key>`) is, for this frame: its lane there */
export function laneInRowKey(seg: SegmentLocal, key: string): FrameLaneInfo | null {
  const row = timelineLanes(seg, true).find(r => String(r.lane) === key)
  return row ? laneInRow(seg, row.lane) : null
}

export function defaultFrame(layout: FrameLayout, prev?: FrameSettings | null): FrameSettings {
  const tpl = FRAME_TEMPLATES[layout]
  const slots = frameSlotCount(layout)
  const textLanes = frameTextLanes(layout)
  const under = !!tpl.mainUnder
  // The main video stays in the slots that still take a video; a frame for videos never starts
  // without it. A template that says where the main video goes (e.g. the face cam) puts it there.
  const kept = (prev?.main_slots ?? [0]).filter(i => i < slots && slotOffers(layout, i).video)
  const main = under ? [] : tpl.mainSlots ?? (kept.length ? kept : [0])
  const corners = tpl.corners ?? DEFAULT_CORNERS
  const prevBand = { ...DEFAULT_BAND, ...prev?.band }
  return {
    // A template with its own colour (Branded card) starts with it, unless a colour was already picked
    band: { ...prevBand, ...(tpl.bandBg && prevBand.bg.toLowerCase() === DEFAULT_BAND.bg ? { bg: tpl.bandBg } : {}) },
    main_slots: main,
    main_under: under,
    main_volume: prev?.main_volume ?? 1,
    main_muted: prev?.main_muted ?? false,
    // The main video keeps the corners picked for each slot; a slot without its own starts as the
    // template says (DEFAULT_CORNERS), and an area shown whole or with its own shape (the face cam's
    // circle) is always square (newItemCorners). Before 2026-10-17 a frame kept the old one's corners
    // as a whole — a slot the old frame had square came up with none, so drawn square
    main_corners: Object.fromEntries(Array.from({ length: Math.max(3, slots) }, (_, i) => {
      const own = i < slots ? newItemCorners(layout, i) : corners
      // (only a rounded slot carries over: a square one may have been square only because the old
      // frame showed it whole — Pic + Vid's Pic — not because it was picked)
      const was = prev?.main_corners?.[String(i)]
      const kept = tpl.corners === undefined && own > 0 && cornerGeometry(was) ? was : undefined
      return [String(i), kept ?? own]
    })),
    // Items stay on lanes the new template still has, and only if that slot can show them
    // (e.g. a photo in Video + Photo's bottom slot doesn't carry into Dual Video, whose slots are
    // video-only, so that slot comes up empty with its "+")
    items: (prev?.items ?? []).filter(it => {
      if (isTextLane(it.lane)) return textLanes.includes(it.lane)
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
  if (text && isFrameLayout(seg.layout) && frameTextLanes(seg.layout).includes('band')) {
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
  const areas = frameAreas(seg.layout, true, seg.frame)
  const band = areas.find(a => a.kind === 'band' && a.lane === 'band')
  const it = band ? itemAt(frameOf(seg), 'band', t, seg) : null
  if (band && it?.captions && !it.hidden) return { y: band.y, h: band.h }
  // A frame with a caption strip: the captions sit there
  const strip = areas.find(a => a.kind === 'caption')
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
  const slotLanes = frameAreas(seg.layout).flatMap(a => a.kind === 'slot' ? [a.slot] : [])
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
