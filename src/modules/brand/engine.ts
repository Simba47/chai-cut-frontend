import type { CaptionStyle, FrameItem, FrameSettings, Overlay, SegmentLocal, TextOverlay } from '@chai-cut/shared'
import { brandCaptionStyle, cardLookOf, isBrandLogo, logoBox, logoSpan, showHandle, type BrandKit, type BrandKitData } from '@/lib/shared/brandKit'
import type { BrandBefore, FrameBefore } from '@/lib/shared/brandOn'
import { DEFAULT_BAND, frameOf, frameSlotCount, isFrameLayout, isTextLane, newItemCorners, textLaneLook } from '@/modules/editor/frames'
import { isShot } from '@/modules/editor/shots'

/**
 * The brand engine (brand kit rebuild, Phase 0, 2026-10-27): the one place that says what a brand
 * kit does to a clip. Pure — it takes a clip's parts and gives new ones — so the editor and the
 * server use the same rules.
 *
 *  - putBrandOn: the kit goes on (its logo, title style on text, caption look, frame colours and
 *    corners, Branded cards), and what it changed is kept to put back
 *  - brandNewFrames: while it's on, frames picked later get it too
 *  - takeBrandOff: it comes off; what it changed goes back where the user hasn't changed it since
 *  - updateBrand: the kit changed since it went on (a new logo, other colours): the clip follows it
 *    live — but only where the clip still shows what the kit put there; the user's own changes stay
 *
 * Locked things are never touched.
 */

/** The parts of a clip the brand works on */
export interface BrandTarget {
  clipId: string
  lengthMs: number
  mainVideoId: string | null
  overlays: Overlay[]
  texts: TextOverlay[]
  /** The caption style as the editor keeps it (only the fields set) */
  caption: Partial<CaptionStyle>
  /** The captions' letter case ('upper', 'title', …) */
  textCase: string
  segments: SegmentLocal[]
}

export const NO_BEFORE: BrandBefore = { texts: {}, caption: null, text_case: null, progress_bar: null, frames: {}, end_card: null }

/** What the brand puts on the clip's own text */
const titleFont = (d: BrandKitData) => d.title.font ?? 'sans-serif'
/** The caption case a kit's captions give */
const caseOf = (d: BrandKitData) => (d.captions.uppercase ? 'upper' : 'title')
/** A frame's band colour under a kit (a Branded card has its own) */
const bandBgOf = (d: BrandKitData, card: boolean) => (card ? d.card.bg.color : d.colors.main)
/** The colour a kit gives a frame's text item */
const itemColourOf = (d: BrandKitData, card: boolean, lane: FrameItem['lane']) =>
  card && lane === 'band2' ? d.card.handle.color : card && lane === 'band' ? d.card.title.color : d.title.color
const near = (a: number, b: number) => Math.abs(a - b) < 0.002
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const brandLogos = (o: Overlay) => o.type === 'image' && isBrandLogo(o.storage_path) && !o.locked

// ── Frames ────────────────────────────────────────────────────────────────────

/** A frame with the kit's corners on its main video and its photos and videos (not on areas drawn square or with their own shape) */
function withKitCorners(seg: SegmentLocal, corners: number): SegmentLocal {
  if (!isFrameLayout(seg.layout) || seg.locked) return seg
  const layout = seg.layout, f = frameOf(seg), slots = frameSlotCount(layout)
  const rounded = (slot: number) => slot < slots && newItemCorners(layout, slot) > 0
  return {
    ...seg,
    frame: {
      ...f,
      // (slots this frame doesn't use take them too: a frame picked later that has them carries them over)
      main_corners: Object.fromEntries(Object.entries(f.main_corners ?? {}).map(([k, v]) => [k, Number(k) >= slots || rounded(Number(k)) ? corners : v])),
      items: (f.items ?? []).map(it => (it.kind !== 'text' && typeof it.lane === 'number' && rounded(it.lane) && !it.locked ? { ...it, corners } : it)),
    },
  }
}

/** A Branded card's text from a kit's card settings: its title and @handle (each when it shows), over the whole card */
export function brandCardItems(seg: SegmentLocal, kit: Pick<BrandKit, 'name' | 'data'>): FrameItem[] {
  const d = kit.data, c = d.card, span = { start_ms: seg.start_ms, end_ms: seg.end_ms }
  const title = d.card_title.trim() || kit.name, handle = showHandle(d.handle)
  const out: FrameItem[] = []
  if (title && c.title.show) out.push({ id: crypto.randomUUID(), lane: 'band', kind: 'text', ...span, text: title, bg: textLaneLook(seg, 'band').bg, color: c.title.color, size: c.title.size })
  if (handle && c.handle.show) out.push({ id: crypto.randomUUID(), lane: 'band2', kind: 'text', ...span, text: handle, bg: textLaneLook(seg, 'band2').bg, color: c.handle.color, size: c.handle.size })
  return out
}

/** A Branded card as the kit's card settings make it: its look, and its title and @handle when it has no text yet */
export function fillBrandCard(seg: SegmentLocal, kit: Pick<BrandKit, 'name' | 'data'>): SegmentLocal {
  const f = frameOf(seg), c = kit.data.card
  const hasText = (f.items ?? []).some(it => it.kind === 'text')
  return { ...seg, frame: { ...f, card: cardLookOf(c), band: { ...DEFAULT_BAND, ...f.band, bg: c.bg.color }, items: hasText ? f.items : [...(f.items ?? []), ...brandCardItems(seg, kit)] } }
}

/** The brand on one frame section, and what it was before (to put back when switched off) */
export function brandFrame(seg: SegmentLocal, kit: Pick<BrandKit, 'name' | 'data'>): { seg: SegmentLocal; before: FrameBefore } {
  const d = kit.data, f = frameOf(seg), band = { ...DEFAULT_BAND, ...f.band }
  const card = seg.layout === 'frame_brand_card'
  const before: FrameBefore = { layout: seg.layout, band: { bg: band.bg, color: band.color }, items: {}, main_corners: f.main_corners ?? null, item_corners: {} }
  const bandBg = bandBgOf(d, card)
  const items = (f.items ?? []).map(it => {
    if (it.locked) return it
    if (it.kind === 'text' && !it.captions) {
      before.items[it.id] = { color: it.color ?? null, bg: it.bg ?? null }
      // (a band's text carries the band's colour: it follows it; a see-through or own colour stays)
      return { ...it, color: itemColourOf(d, card, it.lane), ...(isTextLane(it.lane) && it.bg === band.bg ? { bg: bandBg } : {}) }
    }
    if (it.kind !== 'text') before.item_corners![it.id] = it.corners ?? null
    return it
  })
  let next: SegmentLocal = { ...seg, frame: { ...f, band: { ...band, bg: bandBg, color: d.title.color }, items } }
  if (card) {
    before.card = f.card ?? null
    const had = new Set((next.frame?.items ?? []).map(it => it.id))
    next = fillBrandCard(next, kit)
    before.added = (next.frame?.items ?? []).filter(it => !had.has(it.id)).map(it => it.id)
  }
  if (d.frames.corners !== null) next = withKitCorners(next, d.frames.corners)
  return { seg: next, before }
}

/** The frames the brand goes on: frame sections that aren't locked and aren't videos on a row */
const brandable = (seg: SegmentLocal, mainVideoId: string | null) => isFrameLayout(seg.layout) && !seg.locked && !isShot(seg, mainVideoId)

// ── On ────────────────────────────────────────────────────────────────────────

/** The kit's logo as a photo on the clip (where and when the kit says), on top of everything */
function logoOverlay(t: BrandTarget, kit: Pick<BrandKit, 'data' | 'logo_url'>, rest: Overlay[]): Overlay | null {
  const d = kit.data
  if (!d.logo.path) return null
  const [start, end] = logoSpan(d.logo, t.lengthMs)
  return {
    id: crypto.randomUUID(), clip_id: t.clipId, type: 'image',
    storage_path: d.logo.path, preview_url: kit.logo_url ?? undefined,
    source_video_id: null, source_offset_ms: 0, ...logoBox(d.logo),
    start_ms: start, end_ms: end, z_index: Math.max(0, ...rest.map(o => o.z_index)) + 1,
    created_at: new Date().toISOString(), opacity: d.logo.opacity < 0.999 ? d.logo.opacity : null,
  }
}

/**
 * The kit put on the clip: its logo (in place of a kit's logo put on before), its title font, colour
 * and size on the clip's text, its caption look when its captions are on (the captions themselves
 * aren't switched on or made), the brand on every frame. Returns what it changed, to put back.
 */
export function putBrandOn(t: BrandTarget, kit: BrandKit): { target: BrandTarget; before: BrandBefore } {
  const d = kit.data
  const before: BrandBefore = {
    ...NO_BEFORE,
    texts: Object.fromEntries(t.texts.filter(x => !x.locked).map(x => [x.id, { font: x.font ?? null, color: x.color ?? null, size: x.size ?? null }])),
    caption: d.captions.on ? Object.fromEntries(Object.keys(brandCaptionStyle(d.captions)).map(k => [k, (t.caption as unknown as Record<string, unknown>)[k] ?? null])) as Partial<CaptionStyle> : null,
    text_case: d.captions.on ? t.textCase : null,
    frames: {},
  }
  const rest = t.overlays.filter(o => !brandLogos(o))
  const logo = logoOverlay(t, kit, rest)
  const segments = t.segments.map(seg => {
    if (!brandable(seg, t.mainVideoId)) return seg
    const r = brandFrame(seg, kit)
    before.frames[seg.id] = r.before
    return r.seg
  })
  return {
    target: {
      ...t,
      overlays: logo ? [...rest, logo] : rest,
      texts: t.texts.map(x => (x.locked ? x : { ...x, font: titleFont(d), color: d.title.color, size: d.title.size })),
      caption: d.captions.on ? { ...t.caption, ...brandCaptionStyle(d.captions) } : t.caption,
      textCase: d.captions.on ? caseOf(d) : t.textCase,
      segments,
    },
    before,
  }
}

/**
 * While the brand is on: frames picked since (a new section, or a section given another frame) get
 * it too, and a logo the kit shows throughout keeps covering the whole clip as it gets longer or
 * shorter. Null when there's nothing to do.
 */
export function brandNewFrames(t: BrandTarget, kit: BrandKit, before: BrandBefore | null): { target: BrandTarget; before: BrandBefore } | null {
  const known = before?.frames ?? {}
  const add: Record<string, FrameBefore> = {}
  const segments = t.segments.map(seg => {
    if (!brandable(seg, t.mainVideoId) || known[seg.id]?.layout === seg.layout) return seg
    const r = brandFrame(seg, kit)
    add[seg.id] = r.before
    return r.seg
  })
  let overlays = t.overlays
  if (kit.data.logo.show === 'all') {
    const short = overlays.find(o => brandLogos(o) && (Math.abs(o.start_ms) > 1 || Math.abs(o.end_ms - t.lengthMs) > 1))
    if (short) overlays = overlays.map(o => (o.id === short.id ? { ...o, start_ms: 0, end_ms: t.lengthMs } : o))
  }
  if (!Object.keys(add).length && overlays === t.overlays) return null
  return { target: { ...t, segments, overlays }, before: { ...(before ?? NO_BEFORE), frames: { ...known, ...add } } }
}

// ── Off ───────────────────────────────────────────────────────────────────────

/**
 * The brand taken off: its logo comes off; text, captions, frame colours and corners go back as they
 * were — each only where it's still as the brand left it, so the user's changes since are kept; the
 * Branded card text it added goes. `d`: the kit's settings when it was on (null: the kit is gone — the
 * logo and frames still come off, texts and captions stay). (An end card made by an older kit is the
 * editor's to turn back: it needs the editor's layouts.)
 */
export function takeBrandOff(t: BrandTarget, d: BrandKitData | null, b: BrandBefore | null): BrandTarget {
  const overlays = t.overlays.filter(o => !brandLogos(o))
  let texts = t.texts, caption = t.caption, textCase = t.textCase
  if (d && b) {
    texts = t.texts.map(x => {
      const was = b.texts[x.id]
      if (!was || x.locked || x.font !== titleFont(d) || x.color !== d.title.color) return x
      // (its size too, where the brand set it and it's still the brand's; a clip branded before sizes were kept has none)
      return { ...x, font: was.font, color: was.color, ...(was.size !== undefined && x.size === d.title.size ? { size: was.size } : {}) }
    })
    if (b.caption && d.captions.on && t.caption.template === d.captions.template && t.caption.color === d.captions.color) {
      caption = { ...t.caption, ...b.caption }
      if (b.text_case) textCase = b.text_case
    }
  }
  const segments = !b ? t.segments : t.segments.map(seg => {
    const was = b.frames[seg.id]
    if (!was || seg.locked || was.layout !== seg.layout || !isFrameLayout(seg.layout)) return seg
    const f = frameOf(seg)
    const added = new Set(was.added ?? [])
    const items = (f.items ?? []).filter(it => it.locked || !added.has(it.id)).map(it => {
      if (it.locked) return it
      const w = was.items[it.id]
      if (w) return { ...it, color: w.color ?? undefined, bg: w.bg ?? undefined }
      if (was.item_corners && it.id in was.item_corners) return { ...it, corners: was.item_corners[it.id] ?? undefined }
      return it
    })
    return {
      ...seg,
      frame: {
        ...f, items, band: { ...DEFAULT_BAND, ...f.band, bg: was.band.bg, color: was.band.color },
        ...(d && d.frames.corners !== null ? { main_corners: was.main_corners ?? undefined } : {}),
        ...(seg.layout === 'frame_brand_card' ? { card: (was.card as FrameSettings['card']) ?? null } : {}),
      },
    }
  })
  return { ...t, overlays, texts, caption, textCase, segments }
}

// ── Live ──────────────────────────────────────────────────────────────────────

/** Whether a kit's settings changed in a way the clip shows (its name and default mark don't) */
export function brandChanged(a: BrandKitData, b: BrandKitData): boolean {
  const shown = (d: BrandKitData) => ({ ...d, is_default: false, lock: false })
  return !sameJson(shown(a), shown(b))
}

/**
 * The kit changed since it went on the clip (`old`: its settings then; `kit`: now). The clip follows
 * it: each thing the brand put on is updated where the clip still shows what the kit put there.
 *  - the logo: a new picture, place, size, see-through and timing — a logo the user moved keeps its
 *    place and width (its height follows the new picture's shape); one they deleted stays deleted
 *  - text: the new title font, colour and size where it still has the old ones
 *  - captions: the new look's fields where they're still the old look's
 *  - frames: band colour, text colours, corners and the Branded card's look and words, likewise
 */
export function updateBrand(t: BrandTarget, old: BrandKitData, kit: BrandKit): BrandTarget {
  const n = kit.data

  // The logo
  let overlays = t.overlays
  const had = t.overlays.filter(brandLogos)
  if (had.length) {
    overlays = n.logo.path ? t.overlays.map(o => {
      if (!brandLogos(o)) return o
      const was = logoBox(old.logo), box = logoBox(n.logo)
      const placed = near(o.x, was.x) && near(o.y, was.y) && near(o.w, was.w) && near(o.h, was.h)
      const h = Math.min(0.9, (o.w * 1080 * (n.logo.ratio ?? 1)) / 1920)
      const [s0, e0] = logoSpan(old.logo, t.lengthMs)
      const timed = Math.abs(o.start_ms - s0) <= 1 && Math.abs(o.end_ms - e0) <= 1
      const [s1, e1] = logoSpan(n.logo, t.lengthMs)
      const oldOpacity = old.logo.opacity < 0.999 ? old.logo.opacity : null
      return {
        ...o, storage_path: n.logo.path, preview_url: kit.logo_url ?? o.preview_url,
        ...(placed ? box : { h }),
        ...(timed ? { start_ms: s1, end_ms: e1 } : {}),
        ...((o.opacity ?? null) === oldOpacity ? { opacity: n.logo.opacity < 0.999 ? n.logo.opacity : null } : {}),
      }
    }) : t.overlays.filter(o => !brandLogos(o))
  } else if (!old.logo.path && n.logo.path) {
    // (the kit had no logo when it went on: its new one goes on now)
    const logo = logoOverlay(t, kit, t.overlays)
    if (logo) overlays = [...t.overlays, logo]
  }

  // Text on the clip
  const texts = t.texts.map(x => {
    if (x.locked) return x
    const font = x.font === titleFont(old) ? titleFont(n) : x.font
    const color = x.color === old.title.color ? n.title.color : x.color
    const size = x.size === old.title.size ? n.title.size : x.size
    return font === x.font && color === x.color && size === x.size ? x : { ...x, font, color, size }
  })

  // Captions: the fields still as the old look left them
  let caption = t.caption, textCase = t.textCase
  if (n.captions.on) {
    const was = old.captions.on ? brandCaptionStyle(old.captions) as Record<string, unknown> : null
    const now = brandCaptionStyle(n.captions) as Record<string, unknown>
    const cur = t.caption as unknown as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const k of Object.keys(now)) if (!was || (cur[k] ?? null) === (was[k] ?? null)) patch[k] = now[k]
    caption = { ...t.caption, ...patch } as Partial<CaptionStyle>
    if (!old.captions.on || t.textCase === caseOf(old)) textCase = caseOf(n)
  }

  // Frames the brand is on
  const segments = t.segments.map(seg => {
    if (!brandable(seg, t.mainVideoId)) return seg
    const card = seg.layout === 'frame_brand_card'
    const f = frameOf(seg), band = { ...DEFAULT_BAND, ...f.band }
    const oldBg = bandBgOf(old, card), newBg = bandBgOf(n, card)
    const oldTitle = old.card_title.trim(), newTitle = n.card_title.trim()
    const items = (f.items ?? []).map(it => {
      if (it.locked) return it
      if (it.kind === 'text' && !it.captions) {
        let next = it
        if (it.color === itemColourOf(old, card, it.lane)) next = { ...next, color: itemColourOf(n, card, it.lane) }
        if (isTextLane(it.lane) && it.bg === oldBg) next = { ...next, bg: newBg }
        if (card && it.lane === 'band' && oldTitle && it.text === oldTitle && newTitle) next = { ...next, text: newTitle }
        if (card && it.lane === 'band2' && it.text === showHandle(old.handle) && n.handle) next = { ...next, text: showHandle(n.handle) }
        if (card && it.lane === 'band' && it.size === old.card.title.size) next = { ...next, size: n.card.title.size }
        if (card && it.lane === 'band2' && it.size === old.card.handle.size) next = { ...next, size: n.card.handle.size }
        return next
      }
      if (it.kind !== 'text' && old.frames.corners !== null && n.frames.corners !== null && it.corners === old.frames.corners) return { ...it, corners: n.frames.corners }
      return it
    })
    const frame: FrameSettings = {
      ...f, items,
      band: { ...band, ...(band.bg === oldBg ? { bg: newBg } : {}), ...(band.color === old.title.color ? { color: n.title.color } : {}) },
      ...(card && sameJson(f.card, cardLookOf(old.card)) ? { card: cardLookOf(n.card) } : {}),
      ...(old.frames.corners !== null && n.frames.corners !== null && f.main_corners
        ? { main_corners: Object.fromEntries(Object.entries(f.main_corners).map(([k, v]) => [k, v === old.frames.corners ? n.frames.corners! : v])) }
        : {}),
    }
    return sameJson(frame, f) ? seg : { ...seg, frame }
  })

  return { ...t, overlays, texts, caption, textCase, segments }
}
