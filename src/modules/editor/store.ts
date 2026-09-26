'use client'

import { create } from 'zustand'
import type { BoxKeyframe, SegmentLocal, CropBoxLocal, LayoutType, FrameBand, FrameItem, FrameLane, FrameSettings } from '@chai-cut/shared'
import { LAYOUT_SLOT_COUNT } from '@chai-cut/shared'
import { getBoxPositionAtLerp, type BoxPosition } from '@/lib/interpolation'
import { makeBox, defaultCropForSlot } from './utils'
import { isFrameLayout, DEFAULT_BAND, defaultFrame, frameOf, placeNewItem } from './frames'

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
  /** Change a crop position's layout; every slot restarts from its default framing. */
  applyLayout: (segId: string, layout: LayoutType, videoAR?: number) => void
  /** Frame slots: change what a slot shows (source video, photo, motion, volume, mute) */
  updateSlot: (segId: string, boxId: string, patch: Partial<Pick<CropBoxLocal, 'source_video_id' | 'source_offset_ms' | 'image_path' | 'image_url' | 'image_motion' | 'volume' | 'muted'>>) => void
  /** Frame layouts: change the letterbox band's look */
  updateFrameBand: (segId: string, patch: Partial<FrameBand>) => void
  /** Frame layouts: main video's slots and sound */
  updateFrame: (segId: string, patch: Partial<Pick<FrameSettings, 'main_slots' | 'main_volume' | 'main_muted'>>) => void
  /** Put something on a frame lane at time t (see placeNewItem). Returns its id, or null if there's no room. */
  addFrameItem: (segId: string, lane: FrameLane, t: number, item: Omit<FrameItem, 'id' | 'lane' | 'start_ms' | 'end_ms'>) => string | null
  updateFrameItem: (segId: string, itemId: string, patch: Partial<Omit<FrameItem, 'id'>>) => void
  removeFrameItem: (segId: string, itemId: string) => void
  /** Move one edge of a format. Formats are independent: the neighbour never moves, the edge
   *  just stops at it (no overlap). Uncovered time uses the default framing. */
  setSegmentEdge: (segId: string, edge: 'start' | 'end', tMs: number, durationMs: number) => void
  /** Move the shared edge of two touching formats together (one grows, the other shrinks). */
  moveJunction: (leftId: string, rightId: string, tMs: number) => void
  /** Create a format over [startMs, endMs] (an uncovered stretch). Returns its id. */
  addFormat: (startMs: number, endMs: number, layout: LayoutType, videoAR?: number, pos?: BoxPosition) => string
  updateBoxSource: (segId: string, boxId: string, source_video_id: string | null, source_offset_ms: number) => void
  insertBrollAtMs: (videoId: string, atMs: number, durationMs: number, getPos: (boxId: string, t: number) => BoxPosition) => string | null
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

  addFormat: (startMs, endMs, layout, videoAR, pos) => {
    const id = crypto.randomUUID()
    const start = Math.round(startMs), end = Math.round(endMs)
    const crop_boxes: CropBoxLocal[] = Array.from({ length: LAYOUT_SLOT_COUNT[layout] }, (_, i) => ({
      ...makeBox(i, layout, start, [{ t_ms: start, ...(i === 0 && pos ? pos : defaultCropForSlot(layout, i, videoAR)) }]),
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

  applyLayout: (segId, layout, videoAR) => set(s => {
    const seg = s.segments.find(x => x.id === segId)
    if (!seg) return s
    const first = seg.crop_boxes[0]
    // Going to Vertical keeps the crop centred where the user had already framed the subject
    const prev = first ? getBoxPositionAtLerp(seg.start_ms, s.keyframes[first.id] ?? first.keyframes) : null
    const centerX = layout === 'vertical' && prev && seg.layout !== 'horizontal' ? prev.x + prev.w / 2 : undefined
    const toFrame = isFrameLayout(layout)
    const crop_boxes: CropBoxLocal[] = Array.from({ length: LAYOUT_SLOT_COUNT[layout] }, (_, i) => {
      const keyframes = [{ t_ms: seg.start_ms, ...defaultCropForSlot(layout, i, videoAR, i === 0 ? centerX : undefined) }]
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
            ...s.segments.map(s => s.id === seg!.id ? { ...s, start_ms: brollSeg.end_ms } : s),
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
          keyframes: [{ t_ms: brollEnd, ...getPos(box.id, brollEnd) }],
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
