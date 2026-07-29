'use client'

import { create } from 'zustand'
import type { BoxKeyframe, SegmentLocal, CropBoxLocal, LayoutType } from '@chai-cut/shared'
import { LAYOUT_SLOT_COUNT } from '@chai-cut/shared'
import { getBoxPositionAt, type BoxPosition } from '@/lib/interpolation'
import { makeBox } from './utils'

export type KeyframeMap = Record<string, BoxKeyframe[]>  // boxId → sorted keyframes

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
  updateBoxSource: (segId: string, boxId: string, source_video_id: string | null, source_offset_ms: number) => void
  insertBrollAtMs: (videoId: string, atMs: number, durationMs: number, getPos: (boxId: string, t: number) => BoxPosition) => string | null
  // Keyframes
  upsertKeyframe: (boxId: string, kf: Omit<BoxKeyframe, 'id' | 'box_id'>) => void
  removeKeyframe: (boxId: string, t_ms: number) => void
  // Derived — stable reference, always reads latest keyframes via get()
  getPositionAt: (boxId: string, t_ms: number) => BoxPosition
  // Selection
  setActiveSegmentId: (id: string | null) => void
  setActiveBoxId: (id: string | null) => void
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
    set(s => ({ segments: [...s.segments, { id, ...seg, crop_boxes }].sort((a, b) => a.sort_order - b.sort_order) }))
    onCreate?.(id)
  },

  updateSegment: (id, updates) => set(s => ({
    segments: s.segments.map(seg => {
      if (seg.id !== id) return seg
      const next = { ...seg, ...updates }
      if (updates.layout && updates.layout !== seg.layout) {
        const slotCount = LAYOUT_SLOT_COUNT[updates.layout as LayoutType]
        const existing = seg.crop_boxes.slice(0, slotCount)
        const extra = Array.from(
          { length: Math.max(0, slotCount - existing.length) },
          (_, i) => makeBox(existing.length + i, updates.layout as LayoutType, seg.start_ms),
        )
        next.crop_boxes = [...existing, ...extra]
      }
      return next
    }),
  })),

  removeSegment: (id) => set(s => {
    const sorted = [...s.segments].sort((a, b) => a.sort_order - b.sort_order)
    const idx = sorted.findIndex(seg => seg.id === id)
    if (idx === -1) return s
    const removed = sorted[idx]
    const prev = sorted[idx - 1]
    const next = sorted[idx + 1]
    const newActiveId = s.activeSegmentId === id
      ? (prev?.id ?? next?.id ?? null)
      : s.activeSegmentId
    return {
      segments: s.segments
        .filter(seg => seg.id !== id)
        .map(seg => {
          if (prev && seg.id === prev.id) return { ...seg, end_ms: removed.end_ms }
          if (!prev && next && seg.id === next.id) return { ...seg, start_ms: removed.start_ms }
          return seg
        }),
      activeSegmentId: newActiveId,
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
          { id: newId, start_ms: tMs, end_ms: seg.end_ms, layout: seg.layout, sort_order: seg.sort_order + 0.5, crop_boxes: newBoxes },
        ].sort((a, b) => a.sort_order - b.sort_order),
      }
    })
    return newId
  },

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
      if (next) seg = next
    }
    if (!seg) return null

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
      if (brollEnd < seg.end_ms - 100) {
        const contBoxes: CropBoxLocal[] = seg.crop_boxes.map(box => ({
          id: crypto.randomUUID(), slot_index: box.slot_index,
          source_video_id: box.source_video_id,
          source_offset_ms: box.source_offset_ms + (brollEnd - seg!.start_ms),
          keyframes: [{ t_ms: brollEnd, ...getPos(box.id, brollEnd) }],
        }))
        result.push({ id: crypto.randomUUID(), start_ms: brollEnd, end_ms: seg.end_ms, layout: seg.layout, sort_order: seg.sort_order + 1, crop_boxes: contBoxes })
      }
      return { segments: result.sort((a, b) => a.sort_order - b.sort_order) }
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

  removeKeyframe: (boxId, t_ms) => set(s => ({
    keyframes: { ...s.keyframes, [boxId]: (s.keyframes[boxId] ?? []).filter(k => k.t_ms !== t_ms) },
  })),

  // Stable function — always reads latest keyframes via get(), never goes stale
  getPositionAt: (boxId, t_ms) => getBoxPositionAt(t_ms, get().keyframes[boxId] ?? []),

  setActiveSegmentId: (id) => set({ activeSegmentId: id }),
  setActiveBoxId: (id) => set({ activeBoxId: id }),
}))
