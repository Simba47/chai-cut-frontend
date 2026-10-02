'use client'

import { create } from 'zustand'
import type { BoxKeyframe, SegmentLocal, CropBoxLocal, LayoutType, FrameBand, FrameItem, FrameLane, FrameSettings } from '@chai-cut/shared'
import { LAYOUT_SLOT_COUNT } from '@chai-cut/shared'
import { getBoxPositionAtLerp, type BoxPosition } from '@/lib/interpolation'
import { makeBox, defaultCropForSlot } from './utils'
import { isFrameLayout, DEFAULT_BAND, defaultFrame, frameOf, placeNewItem } from './frames'
import { setViewAt, recordMotionAt, removeViewChangeAt, moveViewChange, type ViewKeyframe } from './views'

export type KeyframeMap = Record<string, BoxKeyframe[]>  // boxId → sorted keyframes

// getPositionAt reads only the keyframe map, so every box created locally must be registered
// here too — otherwise a new box falls back to full frame until the user drags it.
function withBoxes(map: KeyframeMap, boxes: CropBoxLocal[]): KeyframeMap {
  const next = { ...map }
  for (const b of boxes) {
    next[b.id] = b.keyframes.map(k => ({ id: crypto.randomUUID(), box_id: b.id, ...k })).sort((a, c) => a.t_ms - c.t_ms)
  }
  return next
}

/** Keyframes (as views.ts builds them) with the ids the store keeps */
function withIds(boxId: string, kfs: ViewKeyframe[]): BoxKeyframe[] {
  return kfs.map(k => ({ id: crypto.randomUUID(), box_id: boxId, t_ms: k.t_ms, x: k.x, y: k.y, w: k.w, h: k.h }) as BoxKeyframe)
    .sort((a, b) => a.t_ms - b.t_ms)
}

interface EditorState {
  segments: SegmentLocal[]
  keyframes: KeyframeMap
  activeSegmentId: string | null
  activeBoxId: string | null
}

interface EditorActions {
  hydrate: (segments: SegmentLocal[], keyframes: KeyframeMap) => void
  reset: () => void
  // Segments
  addSegment: (seg: Omit<SegmentLocal, 'id' | 'crop_boxes'>, onCreate?: (id: string) => void, initialBoxes?: CropBoxLocal[]) => void
  updateSegment: (id: string, updates: Partial<Omit<SegmentLocal, 'id'>>) => void
  removeSegment: (id: string) => void
  splitAtMs: (segId: string, tMs: number, getPos: (boxId: string, t: number) => BoxPosition) => string | null
  /** Change a format's layout. Each slot starts from `framing[slot]` when given, else its default framing. */
  applyLayout: (segId: string, layout: LayoutType, videoAR?: number, framing?: (BoxPosition | undefined)[]) => void
  /**
   * Framing for a format of `layout` over [startMs, endMs]: the crop of the nearest other format
   * with the same (non-frame) layout — the one touching on the left first, then on the right, then
   * the closest in time. Undefined slots mean "use the default".
   */
  neighbourFraming: (layout: LayoutType, startMs: number, endMs: number, excludeId?: string) => (BoxPosition | undefined)[] | undefined
  /**
   * Join the format with its touching neighbours that have the same (non-frame) layout, so
   * switching Split → Vertical doesn't leave separate pieces. Each part keeps its own views (the
   * crop cuts where the parts met). Skipped for B-roll, frames, and a join that has a transition.
   * Returns the id of the joined format.
   */
  joinSameLayoutNeighbours: (segId: string, transitionAfter?: Set<string>) => string
  // View changes (see views.ts)
  /** Move a box's view at time t (Motion off): edits the change there, or adds a cut at t */
  setViewAt: (boxId: string, t: number, pos: BoxPosition, formatStart: number) => void
  /** Record a Motion point at time t (the view glides into it) */
  recordMotionAt: (boxId: string, t: number, pos: BoxPosition) => void
  removeViewChange: (boxId: string, t: number) => void
  moveViewChange: (boxId: string, from: number, to: number, formatStart: number, formatEnd: number) => void
  /** Frame slots: change what a slot shows (source video, photo, motion, volume, mute) */
  updateSlot: (segId: string, boxId: string, patch: Partial<Pick<CropBoxLocal, 'source_video_id' | 'source_offset_ms' | 'image_path' | 'image_url' | 'image_motion' | 'volume' | 'muted'>>) => void
  /** Frame layouts: change the letterbox band's look */
  updateFrameBand: (segId: string, patch: Partial<FrameBand>) => void
  /** Frame layouts: main video's slots and sound */
  updateFrame: (segId: string, patch: Partial<Pick<FrameSettings, 'main_slots' | 'main_volume' | 'main_muted' | 'main_volumes' | 'main_mutes' | 'main_corners'>>) => void
  /** Put something on a frame lane at time t (see placeNewItem). Returns its id, or null if there's no room. */
  addFrameItem: (segId: string, lane: FrameLane, t: number, item: Omit<FrameItem, 'id' | 'lane' | 'start_ms' | 'end_ms'>) => string | null
  updateFrameItem: (segId: string, itemId: string, patch: Partial<Omit<FrameItem, 'id'>>) => void
  removeFrameItem: (segId: string, itemId: string) => void
  /** Move one edge of a format. Formats are independent: the neighbour never moves, the edge
   *  just stops at it (no overlap). Uncovered time uses the default framing. */
  setSegmentEdge: (segId: string, edge: 'start' | 'end', tMs: number, durationMs: number) => void
  /** Move the shared edge of two touching formats together (one grows, the other shrinks). */
  moveJunction: (leftId: string, rightId: string, tMs: number) => void
  /** A join dragged onto the next one: `removeId` goes and the touching `keepId` takes its time */
  absorbSection: (removeId: string, keepId: string) => void
  /** Create a format over [startMs, endMs] (an uncovered stretch). `pos` frames slot 0, or each slot when a list. Returns its id. */
  addFormat: (startMs: number, endMs: number, layout: LayoutType, videoAR?: number, pos?: BoxPosition | (BoxPosition | undefined)[]) => string
  updateBoxSource: (segId: string, boxId: string, source_video_id: string | null, source_offset_ms: number) => void
  insertBrollAtMs: (videoId: string, atMs: number, durationMs: number, getPos: (boxId: string, t: number) => BoxPosition) => string | null
  /** A muted B-roll shot (cutaway) over [startMs, endMs), across any formats it covers */
  placeBroll: (videoId: string, startMs: number, endMs: number, getPos: (boxId: string, t: number) => BoxPosition) => string
  /** Take a B-roll shot out: the format before it (or after it) takes its time back */
  removeBroll: (id: string) => void
  // Keyframes
  upsertKeyframe: (boxId: string, kf: Omit<BoxKeyframe, 'id' | 'box_id'>) => void
  /** Replace all of a box's keyframes (e.g. one static framing for the whole position). */
  setBoxKeyframes: (boxId: string, kfs: Omit<BoxKeyframe, 'id' | 'box_id'>[]) => void
  removeKeyframe: (boxId: string, t_ms: number) => void
  // Derived — stable reference, always reads latest keyframes via get()
  getPositionAt: (boxId: string, t_ms: number) => BoxPosition
  // Selection
  setActiveSegmentId: (id: string | null) => void
  setActiveBoxId: (id: string | null) => void
}

// Shortest a format can be dragged to
export const MIN_FORMAT_MS = 300

// For main-video boxes source_offset_ms is where in the video the position starts, so it must
// move with start_ms — render.py trims from it. B-roll boxes keep their own offset.
function withStart(seg: SegmentLocal, start_ms: number): SegmentLocal {
  const delta = start_ms - seg.start_ms
  if (!delta) return seg
  return {
    ...seg,
    start_ms,
    crop_boxes: seg.crop_boxes.map(b => b.source_video_id ? b : { ...b, source_offset_ms: Math.max(0, b.source_offset_ms + delta) }),
  }
}

// Frame items that reach an edge of their frame stay attached to it when that edge is dragged
// (a ◆ key or a join), so a video filling "the rest of the frame" keeps filling it. A video's
// start in its source moves too, so what's on screen doesn't jump.
function withFrameEdges(prev: SegmentLocal, next: SegmentLocal): SegmentLocal {
  const items = next.frame?.items
  if (!items?.length || (prev.start_ms === next.start_ms && prev.end_ms === next.end_ms)) return next
  return {
    ...next,
    frame: {
      ...next.frame,
      items: items.map(it => {
        let out = it
        if (next.start_ms !== prev.start_ms && it.start_ms <= prev.start_ms + 1 && it.end_ms > prev.start_ms) {
          const d = next.start_ms - it.start_ms
          out = { ...out, start_ms: next.start_ms, ...(it.kind === 'video' ? { source_offset_ms: Math.max(0, (it.source_offset_ms ?? 0) + d) } : {}) }
        }
        if (next.end_ms !== prev.end_ms && it.end_ms >= prev.end_ms - 1 && it.start_ms < prev.end_ms) out = { ...out, end_ms: next.end_ms }
        return out
      }),
    },
  }
}

/**
 * What each video (B-roll) shot covered when it went in, so taking it out — or moving it, which
 * takes it out and puts it in again — gives the sections under it back exactly as they were:
 * their edges, and any section it covered whole. Without this a shot dragged across a section
 * edge would move that edge, and a section it passed over would be lost.
 * Kept for this session only: after a reload a removed shot gives its time to the section before it.
 */
const brollUnder = new Map<string, { covered: SegmentLocal[]; afterId: string | null }>()

export const useEditorStore = create<EditorState & EditorActions>()((set, get) => ({
  segments: [],
  keyframes: {},
  activeSegmentId: null,
  activeBoxId: null,

  hydrate: (segments, keyframes) => set({ segments, keyframes, activeSegmentId: null, activeBoxId: null }),
  reset: () => set({ segments: [] as SegmentLocal[], keyframes: {} as KeyframeMap, activeSegmentId: null, activeBoxId: null }),

  addSegment: (seg, onCreate, initialBoxes) => {
    const id = crypto.randomUUID()
    const slotCount = LAYOUT_SLOT_COUNT[seg.layout]
    const crop_boxes = initialBoxes ?? Array.from({ length: slotCount }, (_, i) => makeBox(i, seg.layout as LayoutType, seg.start_ms))
    set(s => ({
      segments: [...s.segments, { id, ...seg, crop_boxes }].sort((a, b) => a.sort_order - b.sort_order),
      keyframes: withBoxes(s.keyframes, crop_boxes),
    }))
    onCreate?.(id)
  },

  updateSegment: (id, updates) => set(s => {
    let added: CropBoxLocal[] = []
    const segments = s.segments.map(seg => {
      if (seg.id !== id) return seg
      const { start_ms, ...rest } = updates
      const next = { ...(start_ms !== undefined ? withStart(seg, start_ms) : seg), ...rest }
      if (updates.layout && updates.layout !== seg.layout) {
        const slotCount = LAYOUT_SLOT_COUNT[updates.layout as LayoutType]
        const existing = seg.crop_boxes.slice(0, slotCount)
        added = Array.from(
          { length: Math.max(0, slotCount - existing.length) },
          (_, i) => makeBox(existing.length + i, updates.layout as LayoutType, seg.start_ms),
        )
        next.crop_boxes = [...existing, ...added]
      }
      return next
    })
    return added.length ? { segments, keyframes: withBoxes(s.keyframes, added) } : { segments }
  }),

  setSegmentEdge: (segId, edge, tMs, durationMs) => set(s => {
    const byTime = [...s.segments].sort((a, b) => a.start_ms - b.start_ms)
    const i = byTime.findIndex(x => x.id === segId)
    if (i < 0) return s
    const seg = byTime[i], prev = byTime[i - 1], next = byTime[i + 1]
    if (edge === 'start') {
      const t = Math.round(Math.max(prev?.end_ms ?? 0, Math.min(seg.end_ms - MIN_FORMAT_MS, tMs)))
      if (t === seg.start_ms) return s
      return { segments: s.segments.map(x => x.id === seg.id ? withFrameEdges(x, withStart(x, t)) : x) }
    }
    const t = Math.round(Math.min(next?.start_ms ?? durationMs, Math.max(seg.start_ms + MIN_FORMAT_MS, tMs)))
    if (t === seg.end_ms) return s
    return { segments: s.segments.map(x => x.id === seg.id ? withFrameEdges(x, { ...x, end_ms: t }) : x) }
  }),

  moveJunction: (leftId, rightId, tMs) => set(s => {
    const left = s.segments.find(x => x.id === leftId), right = s.segments.find(x => x.id === rightId)
    if (!left || !right) return s
    const t = Math.round(Math.max(left.start_ms + MIN_FORMAT_MS, Math.min(right.end_ms - MIN_FORMAT_MS, tMs)))
    if (t === left.end_ms && t === right.start_ms) return s
    return {
      segments: s.segments.map(x => x.id === leftId ? withFrameEdges(x, { ...x, end_ms: t }) : x.id === rightId ? withFrameEdges(x, withStart(x, t)) : x),
    }
  }),

  absorbSection: (removeId, keepId) => set(s => {
    const gone = s.segments.find(x => x.id === removeId), keep = s.segments.find(x => x.id === keepId)
    if (!gone || !keep) return s
    const keepBefore = keep.end_ms <= gone.start_ms + 1
    return {
      segments: s.segments.filter(x => x.id !== removeId).map(x => x.id !== keepId ? x
        // Before it: runs on to its end. After it: starts where it started (its video from there too)
        : keepBefore ? withFrameEdges(x, { ...x, end_ms: gone.end_ms }) : withFrameEdges(x, withStart(x, gone.start_ms))),
      activeSegmentId: s.activeSegmentId === removeId ? keepId : s.activeSegmentId,
      activeBoxId: s.activeSegmentId === removeId ? null : s.activeBoxId,
    }
  }),

  addFormat: (startMs, endMs, layout, videoAR, pos) => {
    const id = crypto.randomUUID()
    const start = Math.round(startMs), end = Math.round(endMs)
    const slotPos = (i: number) => Array.isArray(pos) ? pos[i] : i === 0 ? pos : undefined
    const crop_boxes: CropBoxLocal[] = Array.from({ length: LAYOUT_SLOT_COUNT[layout] }, (_, i) => ({
      ...makeBox(i, layout, start, [{ t_ms: start, ...(slotPos(i) ?? defaultCropForSlot(layout, i, videoAR)) }]),
      source_offset_ms: start, // main video: where in the video this format starts
    }))
    set(s => {
      const before = [...s.segments].filter(x => x.start_ms < start).sort((a, b) => b.start_ms - a.start_ms)[0]
      return {
        segments: [...s.segments, {
          id, start_ms: start, end_ms: end, layout, sort_order: (before?.sort_order ?? -1) + 0.5, crop_boxes,
          frame: isFrameLayout(layout) ? defaultFrame(layout) : null,
        }]
          .sort((a, b) => a.start_ms - b.start_ms),
        keyframes: withBoxes(s.keyframes, crop_boxes),
      }
    })
    return id
  },

  applyLayout: (segId, layout, videoAR, framing) => set(s => {
    const seg = s.segments.find(x => x.id === segId)
    if (!seg) return s
    const first = seg.crop_boxes[0]
    // Going to Vertical keeps the crop centred where the user had already framed the subject
    const prev = first ? getBoxPositionAtLerp(seg.start_ms, s.keyframes[first.id] ?? first.keyframes) : null
    const centerX = layout === 'vertical' && prev && seg.layout !== 'horizontal' ? prev.x + prev.w / 2 : undefined
    const toFrame = isFrameLayout(layout)
    const crop_boxes: CropBoxLocal[] = Array.from({ length: LAYOUT_SLOT_COUNT[layout] }, (_, i) => {
      const keyframes = [{ t_ms: seg.start_ms, ...(framing?.[i] ?? defaultCropForSlot(layout, i, videoAR, i === 0 ? centerX : undefined)) }]
      const old = seg.crop_boxes[i]
      // Frame crop boxes always frame the main video — other media sits on the frame's lanes
      const kept = old && toFrame
        ? { ...old, source_video_id: null, source_offset_ms: seg.start_ms, image_path: null, image_url: null, image_motion: null }
        : old ? { ...old, image_path: null, image_url: null, image_motion: null } : old
      // New boxes show the main video from this format's own point in it
      return kept ? { ...kept, keyframes } : { ...makeBox(i, layout, seg.start_ms, keyframes), source_offset_ms: seg.start_ms, volume: 1, muted: false }
    })
    // Switching between frames keeps what's on the lanes the new frame still has. Leaving frames
    // keeps the frame settings unused, so switching back brings them back.
    const frame = toFrame ? defaultFrame(layout, isFrameLayout(seg.layout) ? frameOf(seg) : seg.frame) : seg.frame ?? null
    return {
      segments: s.segments.map(x => x.id === segId ? { ...x, layout, crop_boxes, frame } : x),
      keyframes: withBoxes(s.keyframes, crop_boxes),
    }
  }),

  neighbourFraming: (layout, startMs, endMs, excludeId) => {
    if (isFrameLayout(layout)) return undefined
    const { segments, keyframes } = get()
    const same = segments.filter(x => x.id !== excludeId && x.layout === layout && !x.crop_boxes.some(b => b.source_video_id))
    if (!same.length) return undefined
    // Touching on the left, then on the right, then the closest in time
    const left = same.find(x => Math.abs(x.end_ms - startMs) <= 1)
    const right = same.find(x => Math.abs(x.start_ms - endMs) <= 1)
    const gap = (x: SegmentLocal) => x.end_ms <= startMs ? startMs - x.end_ms : x.start_ms >= endMs ? x.start_ms - endMs : 0
    const src = left ?? right ?? [...same].sort((a, b) => gap(a) - gap(b))[0]
    // The view where it meets this format: its end when it's before, its start when it's after
    const at = src.end_ms <= startMs + 1 ? src.end_ms - 1 : src.start_ms
    return Array.from({ length: LAYOUT_SLOT_COUNT[layout] }, (_, i) => {
      const box = src.crop_boxes.find(b => b.slot_index === i)
      return box ? getBoxPositionAtLerp(at, keyframes[box.id] ?? box.keyframes) : undefined
    })
  },

  joinSameLayoutNeighbours: (segId, transitionAfter) => {
    let id = segId
    set(s => {
      const byTime = [...s.segments].sort((a, b) => a.start_ms - b.start_ms)
      const kf = { ...s.keyframes }
      const joinable = (a: SegmentLocal, b: SegmentLocal) =>
        a.layout === b.layout && !isFrameLayout(a.layout) && !a.locked && !b.locked
        && Math.abs(b.start_ms - a.end_ms) <= 1
        && !transitionAfter?.has(a.id)
        && a.crop_boxes.length === b.crop_boxes.length
        // Main video only, playing on without a jump (B-roll and inserts keep their own sections)
        && a.crop_boxes.every(box => {
          const other = b.crop_boxes.find(x => x.slot_index === box.slot_index)
          return !!other && !box.source_video_id && !other.source_video_id
            && Math.abs((box.source_offset_ms + (b.start_ms - a.start_ms)) - other.source_offset_ms) <= 2
        })
      // Glue b onto a: a's boxes carry both parts' views. a's view is held right up to where b
      // began (a cut there), so each part keeps the view it had instead of panning across.
      const glue = (a: SegmentLocal, b: SegmentLocal): SegmentLocal => {
        for (const box of a.crop_boxes) {
          const other = b.crop_boxes.find(x => x.slot_index === box.slot_index)!
          const mine = (kf[box.id] ?? box.keyframes).filter(k => k.t_ms < b.start_ms - 1)
          const theirs = (kf[other.id] ?? other.keyframes).filter(k => k.t_ms >= b.start_ms)
          const hold = getBoxPositionAtLerp(b.start_ms - 1, kf[box.id] ?? box.keyframes)
          const firstTheirs = theirs[0] ? getBoxPositionAtLerp(b.start_ms, theirs) : null
          const same = firstTheirs && (['x', 'y', 'w', 'h'] as const).every(k => Math.abs(firstTheirs[k] - hold[k]) < 1e-4)
          const merged = [
            ...mine,
            ...(firstTheirs && !same ? [{ id: crypto.randomUUID(), box_id: box.id, t_ms: b.start_ms - 1, ...hold }] : []),
            ...theirs.map(k => ({ ...k, id: crypto.randomUUID(), box_id: box.id })),
          ].sort((p, q) => p.t_ms - q.t_ms)
          kf[box.id] = merged.length ? merged : [{ id: crypto.randomUUID(), box_id: box.id, t_ms: a.start_ms, ...hold }]
          delete kf[other.id]
        }
        return { ...a, end_ms: b.end_ms }
      }
      let i = byTime.findIndex(x => x.id === segId)
      if (i < 0) return s
      let cur = byTime[i]
      const removed = new Set<string>()
      // Join the one before first (the earlier format's id and settings win), then any after
      if (i > 0 && joinable(byTime[i - 1], cur)) {
        cur = glue(byTime[i - 1], cur); removed.add(byTime[i].id)
        byTime.splice(i, 1); i -= 1
      }
      while (i + 1 < byTime.length && joinable(cur, byTime[i + 1])) {
        cur = glue(cur, byTime[i + 1]); removed.add(byTime[i + 1].id)
        byTime.splice(i + 1, 1)
      }
      if (!removed.size) return s
      id = cur.id
      return {
        segments: s.segments.filter(x => !removed.has(x.id)).map(x => x.id === cur.id ? cur : x),
        keyframes: kf,
        activeSegmentId: s.activeSegmentId && removed.has(s.activeSegmentId) ? cur.id : s.activeSegmentId,
        activeBoxId: null,
      }
    })
    return id
  },

  setViewAt: (boxId, t, pos, formatStart) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: withIds(boxId, setViewAt(s.keyframes[boxId] ?? [], t, pos, formatStart)) },
  })),
  recordMotionAt: (boxId, t, pos) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: withIds(boxId, recordMotionAt(s.keyframes[boxId] ?? [], t, pos)) },
  })),
  removeViewChange: (boxId, t) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: withIds(boxId, removeViewChangeAt(s.keyframes[boxId] ?? [], t)) },
  })),
  moveViewChange: (boxId, from, to, formatStart, formatEnd) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: withIds(boxId, moveViewChange(s.keyframes[boxId] ?? [], from, to, formatStart, formatEnd)) },
  })),

  removeSegment: (id) => set(s => {
    // Formats are independent: deleting one leaves its time to the default framing
    if (!s.segments.some(seg => seg.id === id)) return s
    return {
      segments: s.segments.filter(seg => seg.id !== id),
      activeSegmentId: s.activeSegmentId === id ? null : s.activeSegmentId,
      activeBoxId: s.activeSegmentId === id ? null : s.activeBoxId,
    }
  }),

  splitAtMs: (segId, tMs, getPos) => {
    const seg = get().segments.find(s => s.id === segId)
    if (!seg || tMs <= seg.start_ms + 100 || tMs >= seg.end_ms - 100) return null
    const newId = crypto.randomUUID()
    set(s => {
      const seg = s.segments.find(s => s.id === segId)
      if (!seg || tMs <= seg.start_ms + 100 || tMs >= seg.end_ms - 100) return s
      const newBoxes: CropBoxLocal[] = seg.crop_boxes.map(box => ({
        ...makeBox(box.slot_index, seg.layout, tMs, [{ t_ms: tMs, ...getPos(box.id, tMs) }]),
        source_video_id: box.source_video_id,
        source_offset_ms: box.source_offset_ms + (tMs - seg.start_ms),
      }))
      return {
        segments: [
          ...s.segments.map(s => s.id === segId ? { ...s, end_ms: tMs } : s),
          {
            id: newId, start_ms: tMs, end_ms: seg.end_ms, layout: seg.layout, sort_order: seg.sort_order + 0.5, crop_boxes: newBoxes,
            // Each half keeps its own copy of the frame; items are cut to each half's range when shown
            frame: seg.frame ? { ...seg.frame, items: seg.frame.items?.map(it => ({ ...it, id: crypto.randomUUID() })) } : seg.frame,
          },
        ].sort((a, b) => a.sort_order - b.sort_order),
        keyframes: withBoxes(s.keyframes, newBoxes),
      }
    })
    return newId
  },

  updateSlot: (segId, boxId, patch) => set(s => ({
    segments: s.segments.map(seg => seg.id !== segId ? seg : {
      ...seg,
      crop_boxes: seg.crop_boxes.map(b => b.id === boxId ? { ...b, ...patch } : b),
    }),
  })),

  updateFrameBand: (segId, patch) => set(s => ({
    segments: s.segments.map(seg => seg.id !== segId ? seg : {
      ...seg,
      frame: { ...seg.frame, band: { ...DEFAULT_BAND, ...seg.frame?.band, ...patch } },
    }),
  })),

  updateFrame: (segId, patch) => set(s => ({
    segments: s.segments.map(seg => seg.id !== segId ? seg : { ...seg, frame: { ...frameOf(seg), ...patch } }),
  })),

  addFrameItem: (segId, lane, t, item) => {
    const seg = get().segments.find(x => x.id === segId)
    if (!seg || !isFrameLayout(seg.layout)) return null
    const frame = frameOf(seg)
    const spot = placeNewItem(frame, lane, t, seg)
    if (!spot) return null
    const id = crypto.randomUUID()
    const items = (frame.items ?? [])
      .filter(it => it.id !== spot.replace)
      .map(it => it.id === spot.trim?.id ? { ...it, end_ms: spot.trim.end_ms } : it)
    items.push({ ...item, id, lane, start_ms: spot.start_ms, end_ms: spot.end_ms })
    set(s => ({ segments: s.segments.map(x => x.id === segId ? { ...x, frame: { ...frame, items } } : x) }))
    return id
  },

  updateFrameItem: (segId, itemId, patch) => set(s => ({
    segments: s.segments.map(seg => {
      if (seg.id !== segId) return seg
      const frame = frameOf(seg)
      return { ...seg, frame: { ...frame, items: (frame.items ?? []).map(it => it.id === itemId ? { ...it, ...patch } : it) } }
    }),
  })),

  removeFrameItem: (segId, itemId) => set(s => ({
    segments: s.segments.map(seg => {
      if (seg.id !== segId) return seg
      const frame = frameOf(seg)
      return { ...seg, frame: { ...frame, items: (frame.items ?? []).filter(it => it.id !== itemId) } }
    }),
  })),

  updateBoxSource: (segId, boxId, source_video_id, source_offset_ms) => set(s => ({
    segments: s.segments.map(seg => seg.id !== segId ? seg : {
      ...seg,
      crop_boxes: seg.crop_boxes.map(b => b.id === boxId ? { ...b, source_video_id, source_offset_ms } : b),
    }),
  })),

  insertBrollAtMs: (videoId, atMs, durationMs, getPos) => {
    const segments = get().segments
    const sorted = [...segments].sort((a, b) => a.sort_order - b.sort_order)
    let seg = sorted.find(s => atMs >= s.start_ms && atMs <= s.end_ms)
    if (seg && atMs >= seg.end_ms - 50) {
      const next = sorted.find(s => s.start_ms >= seg!.end_ms)
      if (next && next.start_ms - atMs < 50) seg = next
    }
    if (!seg) {
      // Uncovered time: the B-roll becomes a format of its own, up to the next format
      const nextStart = sorted.find(s => s.start_ms > atMs)?.start_ms ?? Infinity
      const end = Math.min(atMs + durationMs, nextStart)
      if (end - atMs < 100) return null
      const id = crypto.randomUUID()
      const box: CropBoxLocal = { id: crypto.randomUUID(), slot_index: 0, source_video_id: videoId, source_offset_ms: 0, keyframes: [{ t_ms: atMs, x: 0, y: 0, w: 1, h: 1 }] }
      set(s => ({
        segments: [...s.segments, { id, start_ms: atMs, end_ms: end, layout: 'vertical' as LayoutType, sort_order: 0.5, crop_boxes: [box] }].sort((a, b) => a.start_ms - b.start_ms),
        keyframes: withBoxes(s.keyframes, [box]),
      }))
      return id
    }

    const brollId = crypto.randomUUID()
    const brollBox: CropBoxLocal = {
      id: crypto.randomUUID(),
      slot_index: 0,
      source_video_id: videoId,
      source_offset_ms: 0,
      keyframes: [{ t_ms: atMs, x: 0, y: 0, w: 1, h: 1 }],
    }
    const brollEnd = Math.min(atMs + durationMs, seg.end_ms - 100)

    set(s => {
      const sorted = [...s.segments].sort((a, b) => a.sort_order - b.sort_order)
      let seg = sorted.find(s => atMs >= s.start_ms && atMs <= s.end_ms)
      if (seg && atMs >= seg.end_ms - 50) {
        const next = sorted.find(s => s.start_ms >= seg!.end_ms)
        if (next) seg = next
      }
      if (!seg) return s

      if (atMs <= seg.start_ms + 100) {
        const brollSeg: SegmentLocal = {
          id: brollId,
          start_ms: seg.start_ms,
          end_ms: Math.min(seg.start_ms + durationMs, seg.end_ms - 100),
          layout: 'vertical',
          sort_order: seg.sort_order - 0.5,
          crop_boxes: [brollBox],
        }
        if (brollSeg.end_ms <= brollSeg.start_ms) return s
        return {
          segments: [
            // withStart: the main video carries on from where the B-roll ends (a cutaway), as it
            // does for a B-roll placed mid-format
            ...s.segments.map(s => s.id === seg!.id ? withStart(s, brollSeg.end_ms) : s),
            brollSeg,
          ].sort((a, b) => a.sort_order - b.sort_order),
          keyframes: withBoxes(s.keyframes, [brollBox]),
        }
      }

      if (brollEnd <= atMs) return s

      const brollSeg: SegmentLocal = {
        id: brollId, start_ms: atMs, end_ms: brollEnd,
        layout: 'vertical', sort_order: seg.sort_order + 0.5, crop_boxes: [brollBox],
      }
      const result: SegmentLocal[] = [
        ...s.segments.map(s => s.id === seg!.id ? { ...s, end_ms: atMs } : s),
        brollSeg,
      ]
      let contBoxes: CropBoxLocal[] = []
      if (brollEnd < seg.end_ms - 100) {
        contBoxes = seg.crop_boxes.map(box => ({
          id: crypto.randomUUID(), slot_index: box.slot_index,
          source_video_id: box.source_video_id,
          source_offset_ms: box.source_offset_ms + (brollEnd - seg!.start_ms),
          // The framing carries on after the B-roll: its position there, then its later keyframes
          keyframes: [
            { t_ms: brollEnd, ...getPos(box.id, brollEnd) },
            ...(s.keyframes[box.id] ?? box.keyframes ?? []).filter(k => k.t_ms > brollEnd).map(k => ({ t_ms: k.t_ms, x: k.x, y: k.y, w: k.w, h: k.h })),
          ],
        }))
        result.push({ id: crypto.randomUUID(), start_ms: brollEnd, end_ms: seg.end_ms, layout: seg.layout, sort_order: seg.sort_order + 1, crop_boxes: contBoxes })
      }
      return {
        segments: result.sort((a, b) => a.sort_order - b.sort_order),
        keyframes: withBoxes(s.keyframes, [brollBox, ...contBoxes]),
      }
    })

    return brollId
  },

  placeBroll: (videoId, startMs, endMs, getPos) => {
    const id = crypto.randomUUID()
    set(s => {
      const brollBox: CropBoxLocal = {
        id: crypto.randomUUID(), slot_index: 0, source_video_id: videoId, source_offset_ms: 0,
        image_path: null, image_motion: null, volume: 1, muted: true,
        keyframes: [{ t_ms: startMs, x: 0, y: 0, w: 1, h: 1 }],
      } as CropBoxLocal
      const added: CropBoxLocal[] = [brollBox]
      const out: SegmentLocal[] = []
      const covered = s.segments.filter(seg => !(seg.end_ms <= startMs || seg.start_ms >= endMs)).sort((a, b) => a.start_ms - b.start_ms)
      let afterId: string | null = null
      for (const seg of s.segments) {
        if (seg.end_ms <= startMs || seg.start_ms >= endMs) { out.push(seg); continue }
        // The part before the shot keeps its framing as it was
        if (seg.start_ms < startMs) out.push({ ...seg, end_ms: startMs })
        // The part after carries on: its video from where the shot ends, its later keyframes
        if (seg.end_ms > endMs) {
          const boxes = seg.crop_boxes.map(box => ({
            ...box,
            id: crypto.randomUUID(),
            source_offset_ms: box.source_offset_ms + (endMs - seg.start_ms),
            keyframes: [
              { t_ms: endMs, ...getPos(box.id, endMs) },
              ...(s.keyframes[box.id] ?? box.keyframes ?? []).filter(k => k.t_ms > endMs).map(k => ({ t_ms: k.t_ms, x: k.x, y: k.y, w: k.w, h: k.h })),
            ],
          }))
          added.push(...boxes)
          afterId = crypto.randomUUID()
          out.push({ ...seg, id: afterId, start_ms: endMs, crop_boxes: boxes })
        }
      }
      out.push({ id, start_ms: startMs, end_ms: endMs, layout: 'vertical', sort_order: 0, crop_boxes: [brollBox] })
      brollUnder.set(id, { covered, afterId })
      const segments = out.sort((a, b) => a.start_ms - b.start_ms).map((seg, i) => ({ ...seg, sort_order: i }))
      return { segments, keyframes: withBoxes(s.keyframes, added) }
    })
    return id
  },

  removeBroll: (id) => set(s => {
    const seg = s.segments.find(x => x.id === id)
    if (!seg) return s
    const rest = s.segments.filter(x => x.id !== id)
    const clearSel = {
      activeSegmentId: s.activeSegmentId === id ? null : s.activeSegmentId,
      activeBoxId: s.activeSegmentId === id ? null : s.activeBoxId,
    }

    // Put back what the shot covered, if its neighbours are still the pieces it cut and nothing
    // else was put in its time since
    const rec = brollUnder.get(id)
    brollUnder.delete(id)
    if (rec && rec.covered.length) {
      const first = rec.covered[0]
      const last = rec.covered[rec.covered.length - 1]
      const before = first.start_ms < seg.start_ms ? rest.find(x => x.id === first.id && Math.abs(x.end_ms - seg.start_ms) <= 1) : undefined
      const after = rec.afterId ? rest.find(x => x.id === rec.afterId && Math.abs(x.start_ms - seg.end_ms) <= 1) : undefined
      const free = !rest.some(x => x.start_ms < seg.end_ms - 1 && x.end_ms > seg.start_ms + 1)
      if ((first.start_ms < seg.start_ms ? !!before : true) && (rec.afterId ? !!after : true) && free) {
        const sameSection = first.id === last.id
        const restored: SegmentLocal[] = []
        for (const c of rec.covered) {
          if (before && c.id === first.id) continue                     // extended below
          if (c.id === last.id && after) {
            if (sameSection && before) continue                          // the part before takes it back
            // The section after the shot: its original framing, unless its layout was changed since
            restored.push(after.layout === c.layout ? { ...c, end_ms: after.end_ms } : withStart(after, c.start_ms))
            continue
          }
          restored.push(c)                                               // covered whole: back as it was
        }
        const segments = [
          ...rest
            .filter(x => x.id !== rec.afterId)
            .map(x => before && x.id === before.id ? { ...x, end_ms: sameSection && after ? after.end_ms : first.end_ms } : x),
          ...restored,
        ].sort((a, b) => a.start_ms - b.start_ms).map((x, i) => ({ ...x, sort_order: i }))
        // Boxes put back keep their keyframes (added again only if they were dropped)
        const keyframes = { ...s.keyframes }
        for (const box of restored.flatMap(x => x.crop_boxes)) {
          if (!keyframes[box.id]) keyframes[box.id] = (box.keyframes ?? []).map(k => ({ id: crypto.randomUUID(), box_id: box.id, ...k })).sort((a, b) => a.t_ms - b.t_ms)
        }
        return { segments, keyframes, ...clearSel }
      }
    }

    const prev = rest.find(x => x.end_ms === seg.start_ms)
    const next = rest.find(x => x.start_ms === seg.end_ms)
    return {
      segments: rest.map(x =>
        prev && x.id === prev.id ? { ...x, end_ms: seg.end_ms }
          : !prev && next && x.id === next.id ? withStart(x, seg.start_ms)
            : x),
      activeSegmentId: s.activeSegmentId === id ? null : s.activeSegmentId,
      activeBoxId: s.activeSegmentId === id ? null : s.activeBoxId,
    }
  }),

  upsertKeyframe: (boxId, kf) => set(s => {
    const existing = s.keyframes[boxId] ?? []
    const idx = existing.findIndex(k => k.t_ms === kf.t_ms)
    const updated = idx >= 0
      ? existing.map((k, i) => i === idx ? { ...k, ...kf } : k)
      : [...existing, { id: crypto.randomUUID(), box_id: boxId, ...kf }].sort((a, b) => a.t_ms - b.t_ms)
    return { keyframes: { ...s.keyframes, [boxId]: updated } }
  }),

  setBoxKeyframes: (boxId, kfs) => set(s => ({
    keyframes: {
      ...s.keyframes,
      [boxId]: kfs.map(k => ({ id: crypto.randomUUID(), box_id: boxId, ...k })).sort((a, b) => a.t_ms - b.t_ms),
    },
  })),

  removeKeyframe: (boxId, t_ms) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: (s.keyframes[boxId] ?? []).filter(k => k.t_ms !== t_ms) },
  })),

  // Stable function — always reads latest keyframes via get(), never goes stale.
  // Linear between keyframes, exactly like render.py, so the preview matches the export.
  getPositionAt: (boxId, t_ms) => getBoxPositionAtLerp(t_ms, get().keyframes[boxId] ?? []),

  setActiveSegmentId: (id) => set({ activeSegmentId: id }),
  setActiveBoxId: (id) => set({ activeBoxId: id }),
}))
