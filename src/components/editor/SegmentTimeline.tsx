'use client'

import { useRef, useState, useEffect, Fragment } from 'react'
import type { SegmentLocal, LayoutType, TextOverlay, FrameItem, FrameLane, FrameLayout } from '@chai-cut/shared'
import { isFrameLayout, FRAME_TEMPLATES, frameLanesFor, frameOf, laneItems, itemBounds, MIN_ITEM_MS } from '@/modules/editor/frames'

export const LAYOUT_COLORS: Record<LayoutType, string> = {
  vertical:   '#22c55e',
  split:      '#3b82f6',
  trio:       '#f59e0b',
  spotlight:  '#ef4444',
  centered:   '#06b6d4',
  horizontal: '#ec4899',
  // Frames share one colour so they read as "a frame" on the timeline
  frame_single: '#2dd4bf',
  frame_video_photo: '#2dd4bf',
  frame_dual: '#2dd4bf',
  frame_dual_letterbox: '#2dd4bf',
  frame_triple: '#2dd4bf',
}

// Frame lane items: one colour per kind of media
export const FRAME_ITEM_COLORS = { video: '#60a5fa', photo: '#34d399', text: '#f472b6', captions: '#facc15', main: '#2dd4bf' } as const
export const frameItemColor = (it: FrameItem) => it.captions ? FRAME_ITEM_COLORS.captions : FRAME_ITEM_COLORS[it.kind]
const FRAME_LANE_H = 26
// Frames not under the playhead keep their lanes, shrunk to thin lines
const THIN_H = 4, THIN_GAP = 2

/**
 * The lanes a frame shows on the timeline. The band's lane appears once text is on it (the band
 * itself is always in the preview, with its own "Add text" button). A Single frame's slot is just
 * the main video — the film strip already shows that — so it only gets a lane once something is
 * put on it.
 */
function visibleLanes(seg: SegmentLocal) {
  const frame = frameOf(seg)
  const main = frame.main_slots ?? [0]
  const slots = FRAME_TEMPLATES[seg.layout as FrameLayout].rows.filter(r => r.kind === 'slot').length
  return frameLanesFor(seg).filter(r => {
    const empty = laneItems(frame, r.lane, seg).length === 0
    if (r.lane === 'band') return !empty
    return !(slots === 1 && main.includes(r.lane) && empty)
  })
}

function isBroll(seg: SegmentLocal): boolean {
  return seg.crop_boxes.some(b => b.source_video_id != null)
}

const THUMB_W = 80
const THUMB_H = 56
const THUMB_COUNT = 24

// Frames sampled across the clip's own range of the source video, so each thumbnail sits under
// the moment it shows (the video file is the whole source, not just this clip)
function VideoThumbnails({ videoUrl, startMs, durationMs, count = THUMB_COUNT, radius = 8, dim = true }: {
  videoUrl: string; startMs: number; durationMs: number
  /** Frames across the width, the corner radius, and the dark veil over them */
  count?: number; radius?: number; dim?: boolean
}) {
  const [thumbs, setThumbs] = useState<string[]>([])

  useEffect(() => {
    if (!videoUrl) return
    setThumbs([])
    let cancelled = false
    const vid = document.createElement('video')
    vid.crossOrigin = 'anonymous'
    vid.preload = 'auto'
    vid.muted = true
    vid.src = videoUrl
    const canvas = document.createElement('canvas')
    canvas.width = THUMB_W
    canvas.height = THUMB_H
    const ctx = canvas.getContext('2d')!

    async function captureAll() {
      if (cancelled) return
      const durSec = vid.duration
      if (!durSec || !isFinite(durSec) || durSec < 1) return
      const fromSec = Math.min(startMs / 1000, durSec)
      const spanSec = Math.max(0.1, Math.min(durationMs / 1000 || durSec, durSec - fromSec))
      for (let i = 0; i < count; i++) {
        if (cancelled) return
        const targetSec = fromSec + ((i + 0.5) / count) * spanSec
        vid.currentTime = targetSec
        await new Promise<void>(r => {
          if (Math.abs(vid.currentTime - targetSec) < 0.05 && vid.readyState >= 2) { r(); return }
          const tid = setTimeout(r, 3000)
          vid.addEventListener('seeked', () => { clearTimeout(tid); r() }, { once: true })
        })
        if (cancelled) return
        try {
          ctx.drawImage(vid, 0, 0, THUMB_W, THUMB_H)
          const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
          setThumbs(prev => { const next = [...prev]; next[i] = dataUrl; return next })
        } catch { continue }
      }
    }

    function start() { if (!cancelled) captureAll() }
    if (vid.readyState >= 1) { start() }
    else { vid.addEventListener('loadedmetadata', start, { once: true }) }
    return () => { cancelled = true; vid.src = ''; vid.load() }
  }, [videoUrl, startMs, durationMs, count])

  return (
    <div className="absolute inset-0 flex overflow-hidden" style={{ borderRadius: radius }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, overflow: 'hidden', background: 'rgb(var(--ed-fg) / 0.03)' }}>
          {thumbs[i] && (
            <img src={thumbs[i]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0, transition: 'opacity 0.3s ease' }}
              onLoad={e => { (e.currentTarget as HTMLImageElement).style.opacity = '1' }} />
          )}
        </div>
      ))}
      {dim && <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(0,0,0,0.25)', borderRadius: radius }} />}
    </div>
  )
}

// Friendly name of a format, shown on its block and in its handles' labels
function formatName(seg: SegmentLocal): string {
  if (isBroll(seg)) return 'B-roll'
  if (isFrameLayout(seg.layout)) return `Frame · ${FRAME_TEMPLATES[seg.layout].name}`
  if (seg.layout === 'split') return 'Split screen'
  return seg.layout.charAt(0).toUpperCase() + seg.layout.slice(1)
}

/** Seconds as "12.4s" under a minute, else "1:05" */
function durLabel(ms: number): string {
  return ms < 60000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` : msToLabel(ms)
}

const ACCENT = '#c8ff00'
const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }

function msToLabel(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8]

/** Zoom out · Fit · Zoom in, for the timeline (inside it, or in the editor's control bar) */
export function TimelineZoom({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const i = ZOOM_STEPS.indexOf(zoom)
  const step = (dir: 1 | -1) => onZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))])
  const btn = 'w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 hover:bg-[rgb(var(--ed-fg)/0.08)]'
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-xl" role="group" aria-label="Timeline zoom"
      style={{ background: 'rgb(var(--ed-fg) / 0.04)', border: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
      <button onClick={() => step(-1)} disabled={zoom === ZOOM_STEPS[0]} aria-label="Zoom out timeline" title="Zoom out"
        className={btn} style={{ color: 'rgb(var(--ed-fg) / 0.8)' }}>
        <svg {...iconProps}><circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-4-4" /></svg>
      </button>
      <button onClick={() => onZoom(1)} disabled={zoom === 1} title="Fit the whole clip"
        className="h-8 min-w-[48px] px-2 flex items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)] disabled:hover:bg-transparent"
        style={{ color: zoom === 1 ? 'rgb(var(--ed-fg) / 0.6)' : ACCENT }}>
        {zoom === 1 ? 'Fit' : `${zoom}×`}
      </button>
      <button onClick={() => step(1)} disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]} aria-label="Zoom in timeline" title="Zoom in"
        className={btn} style={{ color: 'rgb(var(--ed-fg) / 0.8)' }}>
        <svg {...iconProps}><circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M20 20l-4-4" /></svg>
      </button>
    </div>
  )
}
// Major tick spacing candidates and how many minor ticks sit between two majors
const TICK_STEPS: [number, number][] = [
  [1000, 5], [2000, 4], [5000, 5], [10000, 5], [15000, 3], [30000, 6], [60000, 6], [120000, 4], [300000, 5], [600000, 5],
]
const MIN_LABEL_GAP_PX = 64

interface Props {
  segments: SegmentLocal[]
  clipStartMs: number
  clipEndMs: number
  currentTimeMs: number
  activeSegmentId: string | null
  videoUrl?: string
  safeDurationMs?: number
  onSeek: (ms: number) => void
  onSelectSegment: (id: string) => void
  onUpdateSegment: (id: string, updates: { start_ms?: number; end_ms?: number }) => void
  /** Move one edge of a format. Formats are independent: neighbours never move. */
  onSetEdge?: (segId: string, edge: 'start' | 'end', tMs: number) => void
  /** Move the shared edge of two touching formats together. */
  onMoveJunction?: (leftId: string, rightId: string, tMs: number) => void
  onInsertBrollAfter?: (afterSegId: string) => void
  textOverlays?: TextOverlay[]
  activeTextOverlayId?: string | null
  onSelectTextOverlay?: (id: string) => void
  onTextOverlayUpdate?: (id: string, updates: { start_ms?: number; end_ms?: number }) => void
  /** Frame section under the playhead: its lanes are shown under the film strip */
  frameSeg?: SegmentLocal | null
  /** Selected lane item, or `main:<slot>` for a slot's main video */
  activeFrameItemId?: string | null
  /** Bumped to point the user at a lane (e.g. after clicking "+" in the preview) */
  laneHighlight?: { lane: FrameLane; n: number; focusPlus?: boolean; openMenu?: boolean } | null
  videoTitles?: Record<string, string>
  onSelectFrameItem?: (id: string | null) => void
  onUpdateFrameItem?: (id: string, patch: Partial<Pick<FrameItem, 'start_ms' | 'end_ms' | 'source_offset_ms'>>) => void
  /** "+" on a lane: open the add menu next to it */
  onAddFrameItem?: (lane: FrameLane, anchor: DOMRect) => void
  /** A thin line of another frame clicked: go there and select it */
  onJumpToFrameItem?: (segId: string, itemId: string) => void
  /** View changes (◆) of the selected crop box in the format under the playhead (see views.ts) */
  viewMarkers?: { t_ms: number; cut: boolean }[]
  selectedViewT?: number | null
  /** Click a ◆: select it and jump there */
  onSelectView?: (t: number) => void
  /** Drag a ◆ in time; returns where it landed */
  onMoveView?: (from: number, to: number) => number | void
  onRemoveView?: (t: number) => void
  /** Playable URLs of the videos B-roll shots show, by video id (for their thumbnails) */
  videoUrls?: Record<string, string>
  /** B-roll shots (shown on their own lane over the film strip): moved or trimmed to a new time */
  onBrollChange?: (segId: string, startMs: number, endMs: number) => void
  /** Bin on the section the user clicked on the strip: delete that section */
  onDeleteSegment?: (id: string) => void
  /** The section the user clicked on the film strip (its bin shows only then); null when none */
  pickedSegmentId?: string | null
  /** Clicking the strip picks the section under the pointer; clicking anywhere else clears it */
  onPickSegment?: (id: string | null) => void
  /** Background music, one bar per track on a Music lane (drag a bar to change when it starts) */
  musicTracks?: { id: string; name: string; start_ms: number; duration_ms?: number }[]
  onMusicMove?: (id: string, startMs: number) => void
  /** The music bar selected for Trim / Delete (it gets a white ring), and clicking a bar selects it */
  selectedMusicId?: string | null
  onSelectMusic?: (id: string) => void
  /** "+" at the start / end of the strip: open the Add menu (photos, videos, music, text) there */
  onAddAt?: (where: 'start' | 'end', anchor: DOMRect) => void
  /** Controlled zoom (e.g. when the zoom buttons live in the editor's control bar) */
  zoom?: number
  onZoomChange?: (z: number) => void
  /** Show the timeline's own zoom row (off when the zoom buttons live elsewhere) */
  showToolbar?: boolean
}

export function SegmentTimeline({
  segments,
  clipStartMs,
  clipEndMs,
  currentTimeMs,
  activeSegmentId,
  videoUrl,
  safeDurationMs,
  onSeek,
  onSelectSegment,
  onUpdateSegment,
  onSetEdge,
  onMoveJunction,
  textOverlays = [],
  musicTracks = [],
  onMusicMove,
  selectedMusicId = null,
  onSelectMusic,
  activeTextOverlayId,
  onSelectTextOverlay,
  onTextOverlayUpdate,
  frameSeg,
  activeFrameItemId,
  laneHighlight,
  videoTitles = {},
  onSelectFrameItem,
  onUpdateFrameItem,
  onAddFrameItem,
  onJumpToFrameItem,
  viewMarkers = [],
  selectedViewT = null,
  onSelectView,
  onMoveView,
  onRemoveView,
  onBrollChange,
  videoUrls = {},
  zoom: zoomProp,
  onZoomChange,
  onDeleteSegment,
  onAddAt,
  pickedSegmentId = null,
  onPickSegment,
  showToolbar = true,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [zoomState, setZoomState] = useState(1)
  const zoom = zoomProp ?? zoomState
  const setZoom = (z: number) => { if (onZoomChange) onZoomChange(z); else setZoomState(z) }
  const [viewW, setViewW] = useState(0)
  const [dragging, setDragging] = useState<string | null>(null)
  const [snapLine, setSnapLine] = useState<number | null>(null)
  // A B-roll shot being dragged: where it would land
  const [brollGhost, setBrollGhost] = useState<{ id: string; start: number; end: number } | null>(null)
  // Lane pointed at from the preview: scroll to it, focus its "+", and pulse it for a moment
  const [pulseLane, setPulseLane] = useState<FrameLane | null>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const plusRefs = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => {
    if (!laneHighlight) return
    setPulseLane(laneHighlight.lane)
    // Opening the lane's menu needs the "+" to have stopped moving, so jump instead of gliding
    lanesRef.current?.scrollIntoView({ block: 'nearest', behavior: laneHighlight.openMenu ? 'auto' : 'smooth' })
    const plus = plusRefs.current.get(String(laneHighlight.lane))
    if (laneHighlight.focusPlus !== false) plus?.focus({ preventScroll: true })
    if (laneHighlight.openMenu && plus) onAddFrameItem?.(laneHighlight.lane, plus.getBoundingClientRect())
    const t = setTimeout(() => setPulseLane(null), 1800)
    return () => clearTimeout(t)
  }, [laneHighlight])
  // Latest playhead for drag handlers (their closures outlive renders)
  const nowRef = useRef(currentTimeMs)
  nowRef.current = currentTimeMs
  const duration = (clipEndMs - clipStartMs) || safeDurationMs || 0

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Mouse wheel scrolls the zoomed timeline sideways (the scrollbar is hidden)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!d) return
      e.preventDefault()
      el.scrollLeft += d
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // Keep the playhead in view when zoomed in (after seeking or while playing)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || zoom === 1 || duration <= 0) return
    const x = (currentTimeMs / duration) * el.scrollWidth
    if (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 24) {
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.2)
    }
  }, [currentTimeMs, zoom, duration])


  function msFromClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return 0
    return Math.max(0, Math.min(((clientX - rect.left) / rect.width) * duration, duration))
  }

  function handleTrackDrag(e: React.PointerEvent) {
    if (e.button !== 0) return
    // A click on the film strip picks the section under it (showing its bin); anywhere else clears it
    if (onPickSegment) {
      const rect = trackRef.current?.getBoundingClientRect()
      const y = rect ? e.clientY - rect.top : -1
      const onStrip = y >= STRIP_TOP && y <= STRIP_TOP + STRIP_H
      const t = msFromClientX(e.clientX)
      const hit = onStrip ? mains.find(m => t >= m.start_ms && t < m.end_ms) : undefined
      onPickSegment(hit?.id ?? null)
    }
    onSeek(msFromClientX(e.clientX))
    const move = (ev: PointerEvent) => onSeek(msFromClientX(ev.clientX))
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const MIN_FORMAT_MS = 300
  const SNAP_PX = 8

  // Clamp an edge so formats never overlap and never get shorter than MIN_FORMAT_MS
  function clampEdge(seg: SegmentLocal, edge: 'start' | 'end', t: number) {
    const byT = [...segments].sort((a, b) => a.start_ms - b.start_ms)
    const i = byT.findIndex(x => x.id === seg.id)
    if (edge === 'start') return Math.max(byT[i - 1]?.end_ms ?? 0, Math.min(seg.end_ms - MIN_FORMAT_MS, t))
    return Math.min(byT[i + 1]?.start_ms ?? duration, Math.max(seg.start_ms + MIN_FORMAT_MS, t))
  }

  // Snap to the playhead, other formats' edges and the clip ends when within a few pixels
  function snap(t: number, seg: SegmentLocal, alsoIgnore?: SegmentLocal) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return t
    const tol = (SNAP_PX / rect.width) * duration
    const targets = [0, duration, nowRef.current]
    for (const x of segments) if (x.id !== seg.id && x.id !== alsoIgnore?.id) targets.push(x.start_ms, x.end_ms)
    let best = t, bestD = tol
    for (const target of targets) { const d = Math.abs(target - t); if (d < bestD) { best = target; bestD = d } }
    return best
  }

  function setEdge(seg: SegmentLocal, edge: 'start' | 'end', t: number) {
    if (onSetEdge) { onSetEdge(seg.id, edge, t); return }
    onUpdateSegment(seg.id, edge === 'start' ? { start_ms: clampEdge(seg, 'start', t) } : { end_ms: clampEdge(seg, 'end', t) })
  }

  // Junction handle: where two formats touch, drag to move their shared edge together —
  // one grows, the other shrinks, and no default-framing gap appears between them
  function clampJunction(left: SegmentLocal, right: SegmentLocal, t: number) {
    return Math.max(left.start_ms + MIN_FORMAT_MS, Math.min(right.end_ms - MIN_FORMAT_MS, t))
  }
  function moveJunction(left: SegmentLocal, right: SegmentLocal, t: number) {
    if (onMoveJunction) { onMoveJunction(left.id, right.id, t); return }
    const c = clampJunction(left, right, t)
    onUpdateSegment(left.id, { end_ms: c })
    onUpdateSegment(right.id, { start_ms: c })
  }
  function handleJunctionDown(e: React.PointerEvent, left: SegmentLocal, right: SegmentLocal) {
    e.stopPropagation()
    e.preventDefault()
    const sx = e.clientX
    let moved = false
    const now0 = nowRef.current
    const side = now0 >= left.start_ms && now0 < left.end_ms ? 'left' : now0 >= right.start_ms && now0 < right.end_ms ? 'right' : null
    setDragging(`join-${left.id}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const t = clampJunction(left, right, snap(msFromClientX(ev.clientX), left, right))
      // Keep the playhead in the format it was in, so the selection doesn't flip mid-drag
      if (side === 'left' && t <= nowRef.current) onSeek(Math.max(left.start_ms, t - 50))
      if (side === 'right' && t >= nowRef.current) onSeek(Math.min(right.end_ms - 50, t + 50))
      moveJunction(left, right, t)
      setSnapLine(t)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setSnapLine(null)
      if (!moved) onSeek(left.end_ms)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ◆ key: drag to trim that edge of the format, click to jump to it
  function handleEdgeDown(e: React.PointerEvent, seg: SegmentLocal, edge: 'start' | 'end') {
    e.stopPropagation()
    e.preventDefault()
    onSelectSegment(seg.id)
    const sx = e.clientX
    let moved = false
    // Only carry the playhead along if it started inside the format being trimmed
    const playheadInside = nowRef.current >= seg.start_ms && nowRef.current < seg.end_ms
    setDragging(`${edge}-${seg.id}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const t = clampEdge(seg, edge, snap(msFromClientX(ev.clientX), seg))
      // Keep the playhead inside the format being trimmed, so the selection stays on it
      if (playheadInside && edge === 'start' && t >= nowRef.current) onSeek(Math.min(seg.end_ms - 50, t + 50))
      if (playheadInside && edge === 'end' && t <= nowRef.current) onSeek(Math.max(t - 50, 0))
      setEdge(seg, edge, t)
      setSnapLine(t)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setSnapLine(null)
      if (!moved) onSeek(edge === 'start' ? seg.start_ms : Math.max(seg.start_ms, seg.end_ms - 100))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Music bar: drag to move where the track starts (it keeps its length; never before the clip starts)
  function handleMusicDrag(e: React.PointerEvent, id: string, origStart: number) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectMusic?.(id)
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return
    const sx = e.clientX
    setDragging(`music-${id}`)
    const move = (ev: PointerEvent) => {
      const d = ((ev.clientX - sx) / rect.width) * duration
      onMusicMove?.(id, Math.round(Math.max(0, Math.min(duration - 200, origStart + d))))
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDragging(null) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function handleTextOverlayBodyDrag(e: React.PointerEvent, id: string, origStart: number, origEnd: number) {
    e.stopPropagation()
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = e.clientX
    const dur = origEnd - origStart
    function move(ev: PointerEvent) {
      const dMs = ((ev.clientX - sx) / rect!.width) * duration
      const newStart = Math.round(Math.max(0, Math.min(duration - dur, origStart + dMs)))
      onTextOverlayUpdate?.(id, { start_ms: newStart, end_ms: newStart + dur })
    }
    function up() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function handleTextOverlayEdgeDrag(e: React.PointerEvent, id: string, origStart: number, origEnd: number, side: 'left' | 'right') {
    e.stopPropagation()
    function move(ev: PointerEvent) {
      const ms = Math.round(msFromClientX(ev.clientX))
      if (side === 'right') onTextOverlayUpdate?.(id, { end_ms: Math.max(ms, origStart + 200) })
      else onTextOverlayUpdate?.(id, { start_ms: Math.min(ms, origEnd - 200) })
    }
    function up() { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Frame lane items: drag the body to move, the ends to trim. Items stay inside their format
  // and never cover a neighbour on the same lane.
  function handleFrameItemDown(e: React.PointerEvent, item: FrameItem, mode: 'move' | 'start' | 'end') {
    if (e.button !== 0 || !frameSeg) return
    e.stopPropagation()
    e.preventDefault()
    onSelectFrameItem?.(item.id)
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return
    const frame = frameOf(frameSeg)
    const { min, max } = itemBounds(frame, item, frameSeg)
    // Work with the part that's actually inside the format
    const s0 = Math.max(item.start_ms, frameSeg.start_ms), e0 = Math.min(item.end_ms, frameSeg.end_ms)
    const len = Math.min(e0 - s0, max - min)
    const tol = (SNAP_PX / rect.width) * duration
    const targets = [nowRef.current, frameSeg.start_ms, frameSeg.end_ms]
    for (const it of frame.items ?? []) if (it.id !== item.id) targets.push(it.start_ms, it.end_ms)
    const snapT = (t: number) => {
      let best = t, bestD = tol
      for (const x of targets) { const d = Math.abs(x - t); if (d < bestD) { best = x; bestD = d } }
      return best
    }
    const sx = e.clientX
    let moved = false
    setDragging(`item-${item.id}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const d = ((ev.clientX - sx) / rect.width) * duration
      if (mode === 'move') {
        // Snap whichever end is near something
        const a = snapT(s0 + d), b = snapT(s0 + d + len) - len
        const ns = Math.round(Math.max(min, Math.min(max - len, a !== s0 + d ? a : b)))
        onUpdateFrameItem?.(item.id, { start_ms: ns, end_ms: ns + len })
      } else if (mode === 'start') {
        const ns = Math.round(Math.max(min, Math.min(e0 - MIN_ITEM_MS, snapT(s0 + d))))
        // A video keeps showing the same moment under its other end: move where it starts in the source too
        const off = item.kind === 'video' ? { source_offset_ms: Math.max(0, (item.source_offset_ms ?? 0) + (ns - item.start_ms)) } : {}
        onUpdateFrameItem?.(item.id, { start_ms: ns, ...off })
        setSnapLine(ns)
      } else {
        const ne = Math.round(Math.min(max, Math.max(s0 + MIN_ITEM_MS, snapT(e0 + d))))
        onUpdateFrameItem?.(item.id, { end_ms: ne })
        setSnapLine(ne)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setSnapLine(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ◆ view change: click selects it and jumps there; drag moves it in time (kept between its
  // neighbours by the store). The first view starts with the format and doesn't move.
  function handleViewDown(e: React.PointerEvent, t: number, first: boolean) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onSelectView?.(t)
    if (first || !onMoveView) return
    const sx = e.clientX
    let cur = t, moved = false
    setDragging(`view-${t}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const landed = onMoveView(cur, Math.round(msFromClientX(ev.clientX)))
      if (typeof landed === 'number') { cur = landed; setSnapLine(landed) }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setSnapLine(null)
      if (moved) onSelectView?.(cur)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const pct = (ms: number) => (duration > 0 ? (ms / duration) * 100 : 0)
  const playheadPct = pct(currentTimeMs)
  const byTime = [...segments].sort((a, b) => a.start_ms - b.start_ms)

  // Ruler: pick the smallest spacing that keeps labels readable at this zoom
  const contentW = Math.max(1, viewW * zoom)
  const [majorMs, minorPerMajor] = TICK_STEPS.find(([ms]) => (ms / Math.max(duration, 1)) * contentW >= MIN_LABEL_GAP_PX) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const minorMs = majorMs / minorPerMajor
  const ticks: { t: number; major: boolean }[] = []
  for (let i = 0; i * minorMs <= duration; i++) ticks.push({ t: i * minorMs, major: i % minorPerMajor === 0 })

  const colorOf = (seg: SegmentLocal) => (isBroll(seg) ? '#f97316' : LAYOUT_COLORS[seg.layout])
  // B-roll shots sit on their own lane over the film strip (the speaker carries on under them);
  // the strip, its ◆ keys and joins are about the formats that frame the main video
  const brolls = byTime.filter(sg => isBroll(sg) && !isFrameLayout(sg.layout))
  const mains = byTime.filter(sg => !brolls.includes(sg))
  // One lane over the strip holds the joins between touching formats and the B-roll shots
  const RULER_H = 30, LANE_H = brolls.length ? 42 : 22, STRIP_H = 52
  /** The format a B-roll shot sits over (the one before it, else after): the strip keeps its colour there */
  const underBroll = (seg: SegmentLocal) =>
    [...mains].reverse().find(m => m.end_ms <= seg.start_ms + 1) ?? mains.find(m => m.start_ms >= seg.end_ms - 1)
  const STRIP_TOP = RULER_H + LANE_H

  // Places where one format ends exactly where the next begins
  const junctions: { left: SegmentLocal; right: SegmentLocal }[] = []
  for (let i = 0; i + 1 < mains.length; i++) {
    if (Math.abs(mains[i + 1].start_ms - mains[i].end_ms) <= 1) junctions.push({ left: mains[i], right: mains[i + 1] })
  }

  /**
   * Drag a B-roll shot: its body moves it, its ends trim it. The shot follows the pointer on its
   * lane and takes its new time when released (the formats around it are re-made once, then).
   */
  function handleBrollDown(e: React.PointerEvent, seg: SegmentLocal, part: 'body' | 'start' | 'end') {
    e.stopPropagation(); e.preventDefault()
    onSelectSegment(seg.id)
    const sx = e.clientX
    const grab = msFromClientX(e.clientX) - seg.start_ms
    const len = seg.end_ms - seg.start_ms
    let moved = false
    let next = { start: seg.start_ms, end: seg.end_ms }
    setDragging(`broll-${part}-${seg.id}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const t = msFromClientX(ev.clientX)
      if (part === 'body') { const st = Math.max(0, Math.min(duration - len, t - grab)); next = { start: st, end: st + len } }
      else if (part === 'start') next = { start: Math.max(0, Math.min(seg.end_ms - 500, t)), end: seg.end_ms }
      else next = { start: seg.start_ms, end: Math.min(duration, Math.max(seg.start_ms + 500, t)) }
      setBrollGhost({ id: seg.id, ...next })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setBrollGhost(null)
      if (!moved) { onSeek(seg.start_ms); return }
      onBrollChange?.(seg.id, Math.round(next.start), Math.round(next.end))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Music rows: tracks that don't overlap in time share a row (so a trimmed song stays on one
  // line, like the video); music playing at the same time as other music gets the next row
  const musicEnd = (m: { start_ms: number; duration_ms?: number }) => Math.min(duration, m.start_ms + (m.duration_ms ?? duration))
  const musicRows: (typeof musicTracks)[] = []
  {
    const ends: number[] = []
    for (const m of [...musicTracks].sort((a, b) => a.start_ms - b.start_ms)) {
      let r = ends.findIndex(e => e <= m.start_ms + 1)
      if (r === -1) { r = ends.length; ends.push(0); musicRows.push([]) }
      musicRows[r].push(m)
      ends[r] = musicEnd(m)
    }
  }

  // Stretches with no format — rendered with the default framing
  const gaps: { start_ms: number; end_ms: number }[] = []
  {
    let cursor = 0
    for (const seg of byTime) {
      if (seg.start_ms - cursor >= 50) gaps.push({ start_ms: cursor, end_ms: seg.start_ms })
      cursor = Math.max(cursor, seg.end_ms)
    }
    if (duration - cursor >= 50) gaps.push({ start_ms: cursor, end_ms: duration })
  }

  return (
    <div className="flex flex-col select-none" style={{ gap: 6 }}>
      {/* ── Toolbar: zoom (hidden when the editor's control bar holds the zoom buttons) ── */}
      {showToolbar && (
        <div className="flex items-center gap-3">
          <TimelineZoom zoom={zoom} onZoom={setZoom} />
        </div>
      )}

      {/* "+" on the left of the strip (lined up with it) opens the Add menu */}
      <div className="flex items-start gap-2">
      {onAddAt && <AddEndButton where="start" top={STRIP_TOP + 1} height={STRIP_H} onAdd={onAddAt} />}
      {/* No visible scrollbar: when zoomed in, the wheel scrolls sideways and the view follows the playhead */}
      <div ref={scrollRef} className="relative flex-1 min-w-0 overflow-x-auto overflow-y-hidden rounded-2xl no-scrollbar"
        style={{
          background: 'linear-gradient(180deg, rgb(var(--ed-fg) / 0.035), rgb(var(--ed-fg) / 0.01)), var(--ed-ruler)',
          border: '1px solid rgb(var(--ed-fg) / 0.08)',
          boxShadow: 'inset 0 1px 0 rgb(var(--ed-fg) / 0.05), 0 12px 32px -18px rgba(0,0,0,0.8)',
          scrollbarWidth: 'none',
        }}>
        {/* Side padding keeps the handles at the very ends of the clip clear of the rounded border */}
        <div className="relative" style={{ width: `${zoom * 100}%`, minWidth: '100%', padding: '0 14px' }}>
          <div ref={trackRef} className="relative" style={{ cursor: 'pointer', paddingBottom: 10 }} onPointerDown={handleTrackDrag}>

            {/* ── Ruler ─────────────────────────────────────────────── */}
            <div className="relative" style={{ height: RULER_H }}>
              {ticks.map(({ t, major }) => {
                const p = pct(t)
                return (
                  <div key={t} className="absolute pointer-events-none" style={major
                    ? { left: `${p}%`, bottom: 2, width: 1, height: 7, marginLeft: -0.5, background: 'rgb(var(--ed-fg) / 0.28)', borderRadius: 1 }
                    : { left: `${p}%`, bottom: 4, width: 2, height: 2, marginLeft: -1, background: 'rgb(var(--ed-fg) / 0.16)', borderRadius: 999 }}>
                    {major && (
                      <span className="absolute tabular-nums" style={{
                        bottom: 11, fontSize: 10, fontWeight: 500, letterSpacing: '0.03em', color: 'rgb(var(--ed-fg) / 0.42)', whiteSpace: 'nowrap',
                        transform: p < 2 ? 'translateX(2px)' : p > 98 ? 'translateX(-100%)' : 'translateX(-50%)',
                      }}>{msToLabel(t)}</span>
                    )}
                  </div>
                )
              })}
            </div>


            {/* ── Overlay lane: B-roll shots, and a handle wherever two formats touch ── */}
            <div className="relative" style={{ height: LANE_H }}>
              {junctions.length === 0 && brolls.length === 0 && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1.5 text-[10px] pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.24)' }}>
                  <span className="w-1 h-1 rounded-full" style={{ background: '#f97316', boxShadow: '0 0 6px #f97316' }} />
                  B-roll and joins between formats show up here
                </span>
              )}
                {brolls.map(seg => {
                  const active = seg.id === activeSegmentId
                  const at = brollGhost?.id === seg.id ? { start_ms: brollGhost.start, end_ms: brollGhost.end } : seg
                  const box = seg.crop_boxes[0]
                  const name = (videoTitles[box?.source_video_id ?? ''] ?? 'B-roll').replace(/^(Pixabay|Pexels): /, '').split(',')[0]
                  const url = videoUrls[box?.source_video_id ?? '']
                  return (
                    <div key={seg.id} onPointerDown={e => handleBrollDown(e, seg, 'body')}
                      title={`B-roll · ${name} · ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)} · drag to move, drag the ends to trim`}
                      className="absolute overflow-hidden"
                      style={{
                        left: `${pct(at.start_ms)}%`, width: `${pct(at.end_ms - at.start_ms)}%`, top: 4, bottom: 4,
                        borderRadius: 6, background: '#1a1a1a',
                        boxShadow: active ? '0 0 0 2px #fff, 0 2px 6px rgba(0,0,0,0.6)' : '0 0 0 1.5px #f97316, 0 2px 6px rgba(0,0,0,0.5)',
                        cursor: dragging === `broll-body-${seg.id}` ? 'grabbing' : 'grab', touchAction: 'none', zIndex: 33,
                      }}>
                      {/* The shot itself: frames of the stock clip */}
                      {url && <VideoThumbnails videoUrl={url} startMs={box?.source_offset_ms ?? 0} durationMs={seg.end_ms - seg.start_ms} count={4} radius={6} dim={false} />}
                      <span className="absolute left-1.5 bottom-1 max-w-[calc(100%-12px)] px-1 rounded text-[9px] font-semibold truncate pointer-events-none"
                        style={{ background: 'rgba(0,0,0,0.65)', color: '#fff' }}>
                        B-roll · {name}
                      </span>
                      {/* Trim grips */}
                      <span onPointerDown={e => handleBrollDown(e, seg, 'start')} aria-label="Trim start"
                        className="absolute left-0 inset-y-0 flex items-center justify-center" style={{ width: 7, cursor: 'ew-resize', background: '#f97316' }}>
                        <span style={{ width: 1.5, height: 12, background: 'rgba(0,0,0,0.5)', borderRadius: 1 }} />
                      </span>
                      <span onPointerDown={e => handleBrollDown(e, seg, 'end')} aria-label="Trim end"
                        className="absolute right-0 inset-y-0 flex items-center justify-center" style={{ width: 7, cursor: 'ew-resize', background: '#f97316' }}>
                        <span style={{ width: 1.5, height: 12, background: 'rgba(0,0,0,0.5)', borderRadius: 1 }} />
                      </span>
                    </div>
                  )
                })}
              {junctions.map(({ left, right }) => {
                const key = `join-${left.id}`
                const active = dragging === key
                const cl = colorOf(left), cr = colorOf(right)
                const li = byTime.indexOf(left) + 1
                return (
                  <button key={key}
                    onPointerDown={e => handleJunctionDown(e, left, right)}
                    onKeyDown={e => {
                      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                      e.preventDefault(); e.stopPropagation()
                      const step = (e.shiftKey ? 1000 : 100) * (e.key === 'ArrowLeft' ? -1 : 1)
                      moveJunction(left, right, clampJunction(left, right, left.end_ms + step))
                    }}
                    aria-label={`Join between format ${li} and ${li + 1} at ${msToLabel(left.end_ms)}. Drag or use arrow keys to move both`}
                    title={`Join · format ${li} → ${li + 1} · ${msToLabel(left.end_ms)} · drag to move both together`}
                    className="absolute flex items-center justify-center"
                    style={{
                      left: `${pct(left.end_ms)}%`, top: '50%', transform: 'translate(-50%, -50%)',
                      width: 26, height: 14, borderRadius: 7,
                      background: `linear-gradient(90deg, ${cl} 0 50%, ${cr} 50% 100%)`,
                      border: '1.5px solid rgba(0,0,0,0.6)',
                      boxShadow: active ? `0 0 0 3px rgb(var(--ed-fg) / 0.35)` : '0 1px 3px rgba(0,0,0,0.6)',
                      cursor: 'ew-resize', touchAction: 'none', zIndex: 34,
                    }}>
                    <svg width="14" height="8" viewBox="0 0 14 8" aria-hidden="true">
                      <path d="M4 1L1 4l3 3M10 1l3 3-3 3M1 4h12" stroke="#000" strokeOpacity="0.7" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )
              })}
            </div>

            {/* ── Film strip: tinted per format, hatched where no format is set ── */}
            <div className="relative overflow-hidden" style={{ height: STRIP_H, borderRadius: 12, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.1), 0 10px 24px -12px rgba(0,0,0,0.9)' }}>
              {videoUrl
                ? <VideoThumbnails videoUrl={videoUrl} startMs={clipStartMs} durationMs={duration} radius={12} dim={false} />
                : <div className="absolute inset-0" style={{ background: 'var(--ed-raise)' }} />}

              {gaps.map(g => (
                <div key={`gap-${g.start_ms}`} className="absolute inset-y-0 pointer-events-none flex items-center justify-center overflow-hidden"
                  title={`${msToLabel(g.start_ms)}–${msToLabel(g.end_ms)} · no format: default Vertical framing`}
                  style={{
                    left: `${pct(g.start_ms)}%`, width: `${pct(g.end_ms - g.start_ms)}%`,
                    background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.6) 0 6px, rgba(0,0,0,0.4) 6px 12px)',
                    boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)',
                  }}>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: 'rgba(255,255,255,0.8)', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.12)' }}>Default framing</span>
                </div>
              ))}

              {brolls.map(seg => {
                const under = underBroll(seg)
                if (!under) return null
                const color = colorOf(under)
                return (
                  <div key={`under-${seg.id}`} className="absolute inset-y-0 pointer-events-none"
                    style={{ left: `${pct(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`, background: `${color}2a`, borderTop: `3px solid ${color}aa` }} />
                )
              })}
              {/* Each format: the selected one stays bright inside a lime trim frame (its handles are the
                  frame's sides), the others are dimmed. Its colour only shows as the dot on its chip. */}
              {mains.map(seg => {
                const isActive = seg.id === (pickedSegmentId ?? (selectedMusicId ? null : activeSegmentId))
                const widthPx = (pct(seg.end_ms - seg.start_ms) / 100) * contentW
                return (
                  <div key={seg.id} className="absolute inset-y-0 pointer-events-none"
                    style={{
                      left: `${pct(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`,
                      background: isActive
                        ? 'linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.45))'
                        : 'linear-gradient(180deg, rgba(0,0,0,0.3), rgba(0,0,0,0.5))',
                      boxShadow: isActive
                        ? `inset 0 2px 0 ${ACCENT}, inset 0 -2px 0 ${ACCENT}, 0 0 10px -3px rgba(200,255,0,0.4)`
                        : 'inset 0 0 0 1px rgba(255,255,255,0.12)',
                      borderRadius: 12,
                      transition: 'box-shadow .25s, background .25s',
                    }}>
                  </div>
                )
              })}
            </div>

            {/* ── Views: one ◆ per view change of the format under the playhead ── */}
            <div className="relative" style={{ height: 24, marginTop: 6 }}>
              {/* Faint guide the markers sit on */}
              <div className="absolute inset-x-0 top-1/2 pointer-events-none" style={{ height: 1, background: 'rgb(var(--ed-fg) / 0.06)' }} />
              {viewMarkers.length === 0 && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pr-2 text-[10px] font-medium pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.3)', background: 'var(--ed-ruler)' }}>
                  <span className="w-1.5 h-1.5 rotate-45" style={{ background: 'rgb(var(--ed-fg) / 0.35)', borderRadius: 1 }} />
                  Move the view at any moment — each change shows here
                </span>
              )}
              {viewMarkers.map((v, i) => {
                const on = selectedViewT === v.t_ms
                const first = i === 0
                const size = on ? 13 : 10
                return (
                  <Fragment key={`view-${v.t_ms}`}>
                    <button
                      type="button"
                      onPointerDown={e => handleViewDown(e, v.t_ms, first)}
                      onKeyDown={e => {
                        if ((e.key === 'Delete' || e.key === 'Backspace') && !first) { e.preventDefault(); e.stopPropagation(); onRemoveView?.(v.t_ms) }
                      }}
                      aria-label={`${first ? 'First view' : v.cut ? 'View change' : 'Motion point'} at ${msToLabel(v.t_ms)}${first ? '' : '. Drag to move, Delete to remove'}`}
                      title={`${first ? 'First view' : v.cut ? 'View change (cut)' : 'Motion point (glide)'} · ${msToLabel(v.t_ms)}${first ? '' : ' · drag to move · Delete to remove'}`}
                      className="absolute top-1/2"
                      style={{
                        left: `${pct(v.t_ms)}%`, width: size, height: size,
                        transform: `translate(${v.t_ms <= 0 ? '0' : '-50%'}, -50%) rotate(45deg)`,
                        borderRadius: v.cut || first ? 3 : 999,
                        background: on ? ACCENT : v.cut || first ? 'rgb(var(--ed-fg) / 0.9)' : 'rgb(var(--ed-fg) / 0.5)',
                        border: '1.5px solid rgba(0,0,0,0.7)',
                        boxShadow: dragging === `view-${v.t_ms}` ? '0 0 0 4px rgba(200,255,0,0.35)' : on ? '0 0 10px rgba(200,255,0,0.6)' : '0 1px 3px rgba(0,0,0,0.6)',
                        cursor: first ? 'pointer' : 'ew-resize', touchAction: 'none', zIndex: on ? 36 : 35,
                      }} />
                    {on && !first && onRemoveView && (
                      <button type="button" onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); onRemoveView(v.t_ms) }}
                        aria-label={`Remove the view change at ${msToLabel(v.t_ms)}`} title="Remove this view change (Delete)"
                        className="absolute top-1/2 flex items-center justify-center rounded-full"
                        style={{ left: `calc(${pct(v.t_ms)}% + 10px)`, transform: 'translateY(-50%)', width: 16, height: 16, zIndex: 37, background: '#ef4444', color: '#fff', fontSize: 10, lineHeight: 1 }}>
                        ✕
                      </button>
                    )}
                  </Fragment>
                )
              })}
            </div>

            {/* ── Trim handles: the start and end of every format ── */}
            {mains.flatMap((seg, i) => {
              const selected = seg.id === activeSegmentId
              const label = formatName(seg)
              return (['start', 'end'] as const).map(edge => {
                const t = edge === 'start' ? seg.start_ms : seg.end_ms
                const key = `${edge}-${seg.id}`
                const active = dragging === key
                return (
                  <button key={key}
                    onPointerDown={e => handleEdgeDown(e, seg, edge)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSeek(edge === 'start' ? seg.start_ms : Math.max(seg.start_ms, seg.end_ms - 100)); return }
                      // Arrow keys nudge the edge by 0.1 s (1 s with Shift)
                      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                      e.preventDefault(); e.stopPropagation()
                      const step = (e.shiftKey ? 1000 : 100) * (e.key === 'ArrowLeft' ? -1 : 1)
                      setEdge(seg, edge, clampEdge(seg, edge, t + step))
                    }}
                    aria-label={`${edge === 'start' ? 'Start' : 'End'} of format ${i + 1} (${label}) at ${msToLabel(t)}. Drag or use arrow keys to trim`}
                    title={`${edge === 'start' ? 'Start' : 'End'} of format ${i + 1} · ${label} · ${msToLabel(t)} · drag to trim`}
                    // Grip bars sit just inside their format, so where two formats touch the end
                    // of one and the start of the next stand side by side instead of overlapping
                    className="group absolute flex items-center justify-center transition-[background,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    style={{
                      left: `${pct(t)}%`, top: STRIP_TOP, height: STRIP_H, width: selected || active ? 10 : 6,
                      transform: edge === 'start' ? 'translateX(0)' : 'translateX(-100%)',
                      borderRadius: edge === 'start' ? '12px 3px 3px 12px' : '3px 12px 12px 3px',
                      background: selected || active ? ACCENT : 'transparent',
                      boxShadow: active ? '0 0 0 2px rgba(200,255,0,0.3), 0 0 10px rgba(200,255,0,0.6)' : 'none',
                      cursor: 'ew-resize', touchAction: 'none', zIndex: selected ? 32 : 30,
                    }}>
                    {selected || active ? (
                      <svg width="5" height="9" viewBox="0 0 8 12" aria-hidden="true" style={{ transform: edge === 'start' ? 'none' : 'scaleX(-1)' }}>
                        <path d="M6 1.5L1.8 6 6 10.5" stroke="#000" strokeOpacity="0.8" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <span className="transition-colors group-hover:bg-white" style={{ width: 2, height: 14, borderRadius: 2, background: 'rgba(255,255,255,0.45)' }} />
                    )}
                  </button>
                )
              })
            })}

            {/* Single frame: its slot is the main video on this strip, so its "+" sits here */}
            {frameSeg && isFrameLayout(frameSeg.layout) && !visibleLanes(frameSeg).some(r => r.lane === 0)
              && currentTimeMs >= frameSeg.start_ms && currentTimeMs < frameSeg.end_ms && (
              <button
                ref={el => { if (el) plusRefs.current.set('0', el); else plusRefs.current.delete('0') }}
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); onAddFrameItem?.(0, e.currentTarget.getBoundingClientRect()) }}
                aria-label={`Add to this frame at ${msToLabel(currentTimeMs)}`}
                title="Add text, or a video on top of the main video"
                className="absolute flex items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none"
                style={{
                  left: `${playheadPct}%`, top: STRIP_TOP + STRIP_H / 2, transform: 'translate(-50%, -50%)', width: 20, height: 20, zIndex: 41,
                  background: '#c8ff00', color: '#000', border: '1.5px solid rgba(0,0,0,0.7)',
                  boxShadow: pulseLane === 0 ? '0 0 0 4px rgba(200,255,0,0.35), 0 0 12px rgba(200,255,0,0.8)' : '0 1px 4px rgba(0,0,0,0.6)',
                }}>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              </button>
            )}

            {/* Snap guide while trimming */}
            {snapLine !== null && (
              <div className="absolute top-0 bottom-0 pointer-events-none z-20" style={{ left: `${pct(snapLine)}%`, width: 1, background: 'rgb(var(--ed-fg) / 0.6)' }} />
            )}

            {/* ── Playhead ─────────────────────────────────────────── */}
            {/* White line with the current time on a pill at the top (the pill stays on screen at the ends).
                White keeps it distinct from the lime trim frame. */}
            <div className="absolute top-0 bottom-0 pointer-events-none z-40" style={{ left: `${playheadPct}%` }}>
              <div className="absolute" style={{ top: 18, bottom: 0, left: -1, width: 2, borderRadius: 2, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 0 12px rgba(255,255,255,0.35)' }} />
              <div className="absolute rounded-full" style={{ top: 15, left: -4, width: 8, height: 8, background: '#fff', boxShadow: '0 0 0 2px rgba(0,0,0,0.5)' }} />
              <div className="absolute" style={{ top: 0, transform: playheadPct < 3 ? 'translateX(-8px)' : playheadPct > 97 ? 'translateX(calc(-100% + 8px))' : 'translateX(-50%)' }}>
                <span className="block px-2 rounded-full text-[10px] font-bold tabular-nums leading-[16px]" style={{ background: '#fff', color: '#0a0a0a', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                  {msToLabel(currentTimeMs)}
                </span>
              </div>
            </div>
          </div>


          {/* ── Frame lanes: what each slot and the text band shows over this frame's time ── */}
          {(() => {
            const active = frameSeg && isFrameLayout(frameSeg.layout) ? frameSeg : null
            const others = byTime.filter(x => isFrameLayout(x.layout) && x.id !== active?.id)
            const activeRows = active ? visibleLanes(active) : []
            const thinRows = Math.max(0, ...others.map(x => visibleLanes(x).length))
            if (!activeRows.length && !thinRows) return null
            const seg = active
            const frame = seg ? frameOf(seg) : null
            const main = frame?.main_slots ?? [0]
            const inSection = !!seg && currentTimeMs >= seg.start_ms && currentTimeMs < seg.end_ms
            const plusAt = seg ? (inSection ? currentTimeMs : seg.start_ms) : 0
            return (
              <div ref={lanesRef} className="relative flex flex-col pb-1.5"
                style={{ gap: 2, paddingTop: 4, borderTop: '1px solid rgb(var(--ed-fg) / 0.05)', minHeight: 4 + thinRows * (THIN_H + THIN_GAP) + 6 }}>
                {/* Other frames: the same lanes as thin lines (blue video, green photo, pink text) */}
                {others.flatMap(o => {
                  const of = frameOf(o)
                  const om = of.main_slots ?? [0]
                  return visibleLanes(o).flatMap((row, li) => {
                    const top = 4 + li * (THIN_H + THIN_GAP)
                    const bars: React.ReactNode[] = []
                    if (row.lane !== 'band' && om.includes(row.lane)) {
                      bars.push(
                        <button key={`${o.id}-main-${row.lane}`} aria-label={`${row.label} · Main video, ${msToLabel(o.start_ms)}–${msToLabel(o.end_ms)}`}
                          title={`${row.label} · Main video · ${msToLabel(o.start_ms)}–${msToLabel(o.end_ms)}`}
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); onSeek(o.start_ms) }}
                          className="absolute rounded-full hover:brightness-150"
                          style={{ top, height: THIN_H, left: `${pct(o.start_ms)}%`, width: `${pct(o.end_ms - o.start_ms)}%`, background: `${FRAME_ITEM_COLORS.main}66`, zIndex: 5 }} />,
                      )
                    }
                    for (const it of laneItems(of, row.lane, o)) {
                      const from = Math.max(it.start_ms, o.start_ms), to = Math.min(it.end_ms, o.end_ms)
                      const name = it.kind === 'video' ? (videoTitles[it.source_video_id ?? ''] ?? 'Video')
                        : it.kind === 'photo' ? 'Photo' : it.captions ? 'Captions' : (it.text?.trim() || 'Text')
                      bars.push(
                        <button key={`${o.id}-${it.id}`} aria-label={`${name}, ${row.label}, ${msToLabel(from)}–${msToLabel(to)}`}
                          title={`${name} · ${row.label} · ${msToLabel(from)}–${msToLabel(to)}`}
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); onJumpToFrameItem?.(o.id, it.id) }}
                          className="absolute rounded-full hover:brightness-125"
                          style={{ top, height: THIN_H, left: `${pct(from)}%`, width: `max(4px, ${pct(to - from)}%)`, background: frameItemColor(it), zIndex: 6 }} />,
                      )
                    }
                    return bars
                  })
                })}
                {seg && frame && activeRows.map(row => {
                  const laneKey = String(row.lane)
                  const isMain = row.lane !== 'band' && main.includes(row.lane)
                  const mainId = `main:${row.lane}`
                  const pulsing = pulseLane === row.lane
                  return (
                    <div key={laneKey} className="relative" style={{ height: FRAME_LANE_H, cursor: 'pointer' }}
                      onPointerDown={e => { onSelectFrameItem?.(null); handleTrackDrag(e) }}>
                      {/* This frame's stretch of the lane */}
                      <div className="absolute inset-y-0.5 pointer-events-none" style={{
                        left: `${pct(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`, borderRadius: 5,
                        background: pulsing ? 'rgba(200,255,0,0.12)' : 'rgb(var(--ed-fg) / 0.045)',
                        boxShadow: pulsing ? 'inset 0 0 0 1.5px #c8ff00' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)',
                        transition: 'background 0.3s, box-shadow 0.3s',
                      }}>
                        <span className="absolute top-1/2 -translate-y-1/2 text-[10px] font-semibold whitespace-nowrap" style={{ left: 8, color: 'rgb(var(--ed-fg) / 0.3)' }}>
                          {row.label}{row.lane === 'band' ? ' band' : ''}
                        </span>
                      </div>
                      {/* The main video under this slot's items */}
                      {isMain && (() => {
                        const on = activeFrameItemId === mainId
                        return (
                          <div className="absolute inset-y-0.5 flex items-center overflow-hidden"
                            onPointerDown={e => { e.stopPropagation(); onSelectFrameItem?.(mainId); handleTrackDrag(e) }}
                            title="Main video · select it to change its sound or take it out of this slot"
                            style={{
                              left: `${pct(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`, borderRadius: 5,
                              background: `${FRAME_ITEM_COLORS.main}${on ? '40' : '24'}`,
                              boxShadow: on ? `inset 0 0 0 1.5px ${FRAME_ITEM_COLORS.main}` : `inset 2px 0 0 ${FRAME_ITEM_COLORS.main}`,
                            }}>
                            <span className="px-2 truncate text-[10px] font-semibold pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>{row.label} · Main video</span>
                          </div>
                        )
                      })()}
                      {/* Items */}
                      {laneItems(frame, row.lane, seg).map(it => {
                        const from = Math.max(it.start_ms, seg.start_ms), to = Math.min(it.end_ms, seg.end_ms)
                        const on = it.id === activeFrameItemId
                        const color = frameItemColor(it)
                        const name = it.kind === 'video' ? (videoTitles[it.source_video_id ?? ''] ?? 'Video')
                          : it.kind === 'photo' ? 'Photo'
                          : it.captions ? 'Captions' : (it.text?.trim() || 'Text')
                        return (
                          <div key={it.id} className="absolute inset-y-0.5 flex items-center overflow-hidden"
                            onPointerDown={e => handleFrameItemDown(e, it, 'move')}
                            title={`${name} · ${msToLabel(from)}–${msToLabel(to)} · drag to move, drag the ends to trim`}
                            style={{
                              left: `${pct(from)}%`, width: `max(8px, ${pct(to - from)}%)`, borderRadius: 5, zIndex: on ? 3 : 2,
                              background: `${color}${on ? '55' : '38'}`,
                              boxShadow: on ? `inset 0 0 0 1.5px ${color}, 0 0 0 1px rgba(0,0,0,0.5)` : `inset 0 0 0 1px ${color}88`,
                              cursor: dragging === `item-${it.id}` ? 'grabbing' : 'grab', touchAction: 'none',
                            }}>
                            <div className="absolute left-0 inset-y-0 w-2 cursor-col-resize z-10" style={{ background: 'rgba(0,0,0,0.25)' }}
                              onPointerDown={e => handleFrameItemDown(e, it, 'start')} />
                            {it.kind === 'photo' && it.image_url && (
                              // crossOrigin must match FrameMediaPool's <img> for the same URL (frameMedia.ts) —
                              // a mismatched second request for the same URL fails as a CORS error, not a fresh fetch.
                              <img src={it.image_url} alt="" crossOrigin="anonymous" className="h-full w-7 object-cover shrink-0 pointer-events-none" style={{ marginLeft: 8, opacity: 0.9 }} />
                            )}
                            <span className="px-2.5 truncate text-[10px] font-semibold pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.92)' }}>
                              {it.kind === 'text' && !it.captions ? 'T · ' : ''}{name}
                            </span>
                            <div className="absolute right-0 inset-y-0 w-2 cursor-col-resize z-10" style={{ background: 'rgba(0,0,0,0.25)' }}
                              onPointerDown={e => handleFrameItemDown(e, it, 'end')} />
                          </div>
                        )
                      })}
                      {/* "+" rides on the playhead: adds from here (splitting an item that's showing) */}
                      <button
                        ref={el => { if (el) plusRefs.current.set(laneKey, el); else plusRefs.current.delete(laneKey) }}
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); onAddFrameItem?.(row.lane, e.currentTarget.getBoundingClientRect()) }}
                        aria-label={`Add to the ${row.label.toLowerCase()} ${row.lane === 'band' ? 'band' : 'slot'} at ${msToLabel(plusAt)}`}
                        title={row.lane === 'band' ? 'Add text or captions here' : 'Add a photo, video or text here'}
                        className="absolute top-1/2 flex items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none"
                        style={{
                          left: `${pct(plusAt)}%`, transform: 'translate(-50%, -50%)', width: 18, height: 18, zIndex: 41,
                          background: '#c8ff00', color: '#000', border: '1.5px solid rgba(0,0,0,0.7)',
                          boxShadow: pulsing ? '0 0 0 4px rgba(200,255,0,0.35), 0 0 12px rgba(200,255,0,0.8)' : '0 1px 4px rgba(0,0,0,0.6)',
                        }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                      </button>
                    </div>
                  )
                })}
                {/* Playhead through the lanes */}
                <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${playheadPct}%`, width: 2, marginLeft: -1, background: 'rgba(200,255,0,0.5)', zIndex: 40 }} />
              </div>
            )
          })()}

          {/* ── Music lane: one purple bar per background track, from where it starts to where it ends
              (or the clip's end when its length isn't known). Drag a bar to move it. ── */}
          {musicTracks.length > 0 && (
            <div className="relative flex flex-col pb-1.5" style={{ gap: 4, paddingTop: 6, borderTop: '1px solid rgb(var(--ed-fg) / 0.05)' }}>
              {musicRows.map((row, ri) => (
                <div key={ri} className="relative" style={{ height: 26 }}>
              {row.map(m => {
                const end = musicEnd(m)
                const on = dragging === `music-${m.id}`
                const sel = selectedMusicId === m.id
                return (
                  <Fragment key={m.id}>
                    <div onPointerDown={e => handleMusicDrag(e, m.id, m.start_ms)}
                      title={`Music · ${m.name} · starts at ${msToLabel(m.start_ms)} · drag to move`}
                      className="absolute inset-y-0 flex items-center gap-1.5 px-2 overflow-hidden"
                      style={{
                        left: `${pct(m.start_ms)}%`, width: `max(24px, ${pct(end - m.start_ms)}%)`, borderRadius: 7,
                        background: on || sel ? 'rgba(192,132,252,0.42)' : 'rgba(192,132,252,0.24)',
                        // Selected: a white ring and glow, matching the "Music selected" label in the bar above
                        boxShadow: sel ? 'inset 0 0 0 2px #fff, 0 0 14px rgba(192,132,252,0.7)' : on ? 'inset 0 0 0 1.5px #c084fc, 0 0 12px rgba(192,132,252,0.5)' : 'inset 0 0 0 1px rgba(192,132,252,0.55)',
                        cursor: on ? 'grabbing' : 'grab', touchAction: 'none',
                      }}>
                      {/* A little sound-wave pattern so it reads as audio at a glance */}
                      <span className="absolute inset-0 pointer-events-none opacity-40" aria-hidden="true"
                        style={{ background: 'repeating-linear-gradient(90deg, transparent 0 3px, rgba(255,255,255,0.35) 3px 4px)', WebkitMaskImage: 'linear-gradient(180deg, transparent 20%, #000 50%, transparent 80%)', maskImage: 'linear-gradient(180deg, transparent 20%, #000 50%, transparent 80%)' }} />
                      <svg className="relative shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#e9d5ff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                      </svg>
                      <span className="relative truncate text-[10px] font-semibold" style={{ color: '#f3e8ff' }}>{m.name}</span>
                    </div>
                  </Fragment>
                )
              })}
                  <div className="absolute inset-y-0 w-px pointer-events-none" style={{ left: `${playheadPct}%`, background: 'rgba(255,255,255,0.6)' }} />
                </div>
              ))}
            </div>
          )}

          {/* ── Text overlay rows ─────────────────────────────────── */}
          {textOverlays.length > 0 && (
            <div className="flex flex-col pb-1.5" style={{ gap: 2, paddingTop: 4, borderTop: '1px solid rgb(var(--ed-fg) / 0.05)' }}>
              {textOverlays.map(o => {
                const isActive = o.id === activeTextOverlayId
                return (
                  <div key={o.id} className="relative" style={{ height: 24 }}>
                    <div className="absolute inset-y-0.5 flex items-center overflow-hidden"
                      style={{ left: `${pct(o.start_ms)}%`, width: `${Math.max(pct(o.end_ms - o.start_ms), 1)}%`, borderRadius: 5, background: isActive ? 'rgba(200,255,0,0.22)' : 'rgb(var(--ed-fg) / 0.12)', border: `1.5px solid ${isActive ? '#c8ff00' : 'rgb(var(--ed-fg) / 0.22)'}`, cursor: 'grab', minWidth: 6, touchAction: 'none' }}
                      onPointerDown={e => handleTextOverlayBodyDrag(e, o.id, o.start_ms, o.end_ms)}
                      onClick={e => { e.stopPropagation(); onSelectTextOverlay?.(o.id) }}>
                      <div className="absolute left-0 inset-y-0 w-2.5 cursor-col-resize z-10" style={{ background: 'rgba(0,0,0,0.25)' }}
                        onPointerDown={e => handleTextOverlayEdgeDrag(e, o.id, o.start_ms, o.end_ms, 'left')} />
                      <span className="px-3.5 truncate pointer-events-none" style={{ fontSize: 10, fontWeight: 600, color: 'rgb(var(--ed-fg) / 0.92)' }}>T · {o.text}</span>
                      <div className="absolute right-0 inset-y-0 w-2.5 cursor-col-resize z-10" style={{ background: 'rgba(0,0,0,0.25)' }}
                        onPointerDown={e => handleTextOverlayEdgeDrag(e, o.id, o.start_ms, o.end_ms, 'right')} />
                    </div>
                    <div className="absolute inset-y-0 w-px pointer-events-none" style={{ left: `${playheadPct}%`, background: 'rgba(200,255,0,0.4)' }} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

/** The big "+" beside the strip: adds photos, videos, music or text at the clip's start or end */
function AddEndButton({ where, top, height, onAdd }: {
  where: 'start' | 'end'; top: number; height: number
  onAdd: (where: 'start' | 'end', anchor: DOMRect) => void
}) {
  return (
    <button type="button" onClick={e => onAdd(where, e.currentTarget.getBoundingClientRect())}
      aria-label={`Add photos, videos, music or text at the ${where} of the clip`}
      title={`Add at the ${where}: photos, videos, music or text`}
      className="shrink-0 w-12 flex items-center justify-center rounded-xl transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(200,255,0,0.6)]"
      style={{ marginTop: top, height, color: 'rgb(var(--ed-fg) / 0.7)', background: 'rgb(var(--ed-fg) / 0.04)', border: '1px dashed rgb(var(--ed-fg) / 0.2)' }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  )
}
