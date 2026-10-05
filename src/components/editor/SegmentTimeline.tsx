'use client'

import { useRef, useState, useEffect, useLayoutEffect, Fragment } from 'react'
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
  frame_title_caption: '#2dd4bf',
  frame_big_small: '#2dd4bf',
  frame_photo_story: '#2dd4bf',
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

export const ZOOM_STEPS = [1, 1.25, 1.5, 2, 3, 4]

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
  /** A join dragged onto the next one: the section between goes, the one dragged from takes its time */
  onSwallowSection?: (removeId: string, keepId: string) => void
  /** Background music, one bar per track on a Music lane (drag a bar to change when it starts) */
  musicTracks?: { id: string; name: string; start_ms: number; duration_ms?: number; /** the main video's own sound, detached: shown over the strip */ original?: boolean; muted?: boolean; locked?: boolean }[]
  onMusicMove?: (id: string, startMs: number) => void
  /** A music bar's end dragged: the start cuts into the song (its end stays put), the end shortens or lengthens it */
  onMusicTrim?: (id: string, edge: 'start' | 'end', ms: number) => void
  /** The music bar selected for Trim / Delete (it gets a white ring), and clicking a bar selects it */
  selectedMusicId?: string | null
  onSelectMusic?: (id: string) => void
  /** A sub timeline's icon (or its empty row): add that kind of media at the playhead */
  onAddKind?: (kind: 'video' | 'photo' | 'music' | 'text') => void
  /** Photos over the clip, on their own lane: drag to move, drag the ends to trim, click to pick */
  photos?: { id: string; start_ms: number; end_ms: number; url?: string; hidden?: boolean; locked?: boolean }[]
  activePhotoId?: string | null
  onSelectPhoto?: (id: string) => void
  onPhotoTimeChange?: (id: string, updates: { start_ms: number; end_ms: number }) => void
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
  onSwallowSection,
  textOverlays = [],
  photos = [],
  activePhotoId = null,
  onSelectPhoto,
  onPhotoTimeChange,
  musicTracks = [],
  onMusicMove,
  onMusicTrim,
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
  onAddKind,
  pickedSegmentId = null,
  onPickSegment,
  showToolbar = true,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // The icon column on the left: where each kind of lane sits (top / height, px within the timeline)
  const [laneSpans, setLaneSpans] = useState<{ kind: string; top: number; h: number }[]>([])
  const measureLanes = () => {
    const box = scrollRef.current
    if (!box) return
    const base = box.getBoundingClientRect().top
    const by = new Map<string, { top: number; bottom: number }>()
    box.querySelectorAll<HTMLElement>('[data-lane]').forEach(el => {
      const r = el.getBoundingClientRect(), k = el.dataset.lane!
      const cur = by.get(k)
      by.set(k, { top: Math.min(cur?.top ?? Infinity, r.top - base), bottom: Math.max(cur?.bottom ?? -Infinity, r.bottom - base) })
    })
    const next = [...by].map(([kind, v]) => ({ kind, top: Math.round(v.top), h: Math.round(v.bottom - v.top) }))
    setLaneSpans(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next)
  }
  useLayoutEffect(measureLanes)
  useEffect(() => {
    const box = scrollRef.current?.firstElementChild
    if (!box) return
    const ro = new ResizeObserver(() => measureLanes())
    ro.observe(box)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const trackRef = useRef<HTMLDivElement>(null)
  const [zoomState, setZoomState] = useState(1)
  const zoom = zoomProp ?? zoomState
  const setZoom = (z: number) => { if (onZoomChange) onZoomChange(z); else setZoomState(z) }
  const [viewW, setViewW] = useState(0)
  const [dragging, setDragging] = useState<string | null>(null)
  const [snapLine, setSnapLine] = useState<number | null>(null)
  // A join dragged onto the next join: the section that goes when it's released
  const [doomed, setDoomed] = useState<{ id: string; label: string; start: number; end: number } | null>(null)
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
      // The strip under a video (B-roll) section picks that section too
      const hit = onStrip ? mains.find(m => t >= m.start_ms && t < m.end_ms) ?? brolls.find(b => t >= b.start_ms && t < b.end_ms) : undefined
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
    if (left.locked || right.locked) { onSeek(left.end_ms); return }
    const sx = e.clientX
    let moved = false
    const now0 = nowRef.current
    const side = now0 >= left.start_ms && now0 < left.end_ms ? 'left' : now0 >= right.start_ms && now0 < right.end_ms ? 'right' : null
    const orig = left.end_ms
    // Dragged (nearly) onto the far edge of a section: that section would go. It stays as it was,
    // in red, until release; pulling back makes it an ordinary drag again.
    let doom: { removeId: string; keepId: string } | null = null
    const DOOM_PX = 14
    setDragging(`join-${left.id}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const raw = msFromClientX(ev.clientX)
      if (onSwallowSection) {
        const rect = trackRef.current?.getBoundingClientRect()
        const tol = rect ? (DOOM_PX / rect.width) * duration : 0
        const gone = raw >= right.end_ms - MIN_FORMAT_MS - tol ? right : raw <= left.start_ms + MIN_FORMAT_MS + tol ? left : null
        if (gone) {
          if (!doom) moveJunction(left, right, orig)   // the edge goes back: the whole section shows as going
          doom = { removeId: gone.id, keepId: (gone === right ? left : right).id }
          setDoomed({ id: gone.id, start: gone.start_ms, end: gone.end_ms,
            label: `Release to remove ${formatName(gone)} ${msToLabel(gone.start_ms)}–${msToLabel(gone.end_ms)}` })
          setSnapLine(gone === right ? right.end_ms : left.start_ms)
          return
        }
        if (doom) { doom = null; setDoomed(null) }
      }
      const t = clampJunction(left, right, snap(raw, left, right))
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
      setDoomed(null)
      if (doom) { onSwallowSection?.(doom.removeId, doom.keepId); return }
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
    if (seg.locked) { onSeek(edge === 'start' ? seg.start_ms : Math.max(seg.start_ms, seg.end_ms - 100)); return }
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

  /**
   * Snapping for everything dragged on the lanes (video, photo, text, music): an edge close to a
   * section edge (or the playhead, or the clip's ends) jumps onto it, so an item lines up with a
   * section exactly. A guide line shows where. `ignoreId`: a section not to snap to (a video shot
   * is a section itself).
   */
  const LANE_SNAP_PX = 10
  // Alt held while dragging: no snapping, the item goes exactly where the pointer is
  const noSnapRef = useRef(false)
  function edgeSnap(t: number, ignoreId?: string): number | null {
    if (noSnapRef.current) return null
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return null
    const tol = (LANE_SNAP_PX / rect.width) * duration
    let best: number | null = null, bestD = tol
    for (const x of [0, duration, nowRef.current, ...segments.filter(sg => sg.id !== ignoreId).flatMap(sg => [sg.start_ms, sg.end_ms])]) {
      const d = Math.abs(x - t)
      if (d < bestD) { best = x; bestD = d }
    }
    return best
  }
  /** One edge dragged: snapped (guide shown), or left where the pointer is */
  function snapEdgeAt(t: number, ignoreId?: string): number {
    const sn = edgeSnap(t, ignoreId)
    setSnapLine(sn)
    return sn ?? t
  }
  /** A whole item moved (length kept): whichever of its ends is closer to an edge snaps */
  function snapSpanAt(st: number, len: number, ignoreId?: string): number {
    const a = edgeSnap(st, ignoreId), b = edgeSnap(st + len, ignoreId)
    const da = a === null ? Infinity : Math.abs(a - st), db = b === null ? Infinity : Math.abs(b - (st + len))
    if (a !== null && da <= db) { setSnapLine(a); return a }
    if (b !== null) { setSnapLine(b); return Math.max(0, b - len) }
    setSnapLine(null)
    return st
  }
  /** "Fits section 2" / "Fits sections 1–2" when an item lines up exactly with sections */
  function fitLabel(startMs: number, endMs: number): string | null {
    const sections = byTime.filter(x => x.end_ms - x.start_ms > 50)
    const first = sections.findIndex(x => Math.abs(x.start_ms - startMs) <= 1)
    const last = sections.findIndex(x => Math.abs(x.end_ms - endMs) <= 1)
    if (first === -1 || last < first) return null
    return first === last ? `Fits section ${first + 1}` : `Fits sections ${first + 1}–${last + 1}`
  }
  /** Drag that follows the pointer until it's released */
  function follow(move: (ev: PointerEvent) => void, done?: () => void) {
    const up = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up)
      setDragging(null); setSnapLine(null); done?.()
    }
    const onMove = (ev: PointerEvent) => { noSnapRef.current = ev.altKey; move(ev) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
  }
  const msPerPx = () => { const r = trackRef.current?.getBoundingClientRect(); return r && r.width > 0 ? duration / r.width : 0 }

  // Music bar: drag to move where the track starts (it keeps its length; never before the clip starts)
  function handleMusicDrag(e: React.PointerEvent, m: { id: string; start_ms: number; duration_ms?: number; locked?: boolean }) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectMusic?.(m.id)
    if (m.locked) return
    const k = msPerPx()
    if (!k) return
    const sx = e.clientX
    const len = musicEnd(m) - m.start_ms
    setDragging(`music-${m.id}`)
    follow(ev => {
      const st = Math.max(0, Math.min(duration - 200, m.start_ms + (ev.clientX - sx) * k))
      onMusicMove?.(m.id, Math.round(snapSpanAt(st, len)))
    })
  }

  // Music bar ends: drag to trim; picks the track too
  function handleMusicTrim(e: React.PointerEvent, m: { id: string; start_ms: number; duration_ms?: number; locked?: boolean }, edge: 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectMusic?.(m.id)
    if (m.locked) return
    const k = msPerPx()
    if (!k) return
    const sx = e.clientX
    const orig = edge === 'start' ? m.start_ms : musicEnd(m)
    setDragging(`music-${m.id}`)
    follow(ev => onMusicTrim?.(m.id, edge, Math.round(snapEdgeAt(orig + (ev.clientX - sx) * k))))
  }

  // Photo bar: the body moves it, the ends trim it (at least 0.2 s, inside the clip); picks it too
  function handlePhotoDrag(e: React.PointerEvent, ph: { id: string; start_ms: number; end_ms: number; locked?: boolean }, part: 'body' | 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectPhoto?.(ph.id)
    if (ph.locked) return
    const k = msPerPx()
    if (!k) return
    const sx = e.clientX
    const len = ph.end_ms - ph.start_ms
    setDragging(`photo-${ph.id}`)
    follow(ev => {
      const d = (ev.clientX - sx) * k
      if (part === 'body') {
        const st = Math.round(snapSpanAt(Math.max(0, Math.min(duration - len, ph.start_ms + d)), len))
        onPhotoTimeChange?.(ph.id, { start_ms: st, end_ms: Math.min(duration, st + len) })
      } else if (part === 'start') {
        onPhotoTimeChange?.(ph.id, { start_ms: Math.round(Math.max(0, Math.min(ph.end_ms - 200, snapEdgeAt(ph.start_ms + d)))), end_ms: ph.end_ms })
      } else {
        onPhotoTimeChange?.(ph.id, { start_ms: ph.start_ms, end_ms: Math.round(Math.min(duration, Math.max(ph.start_ms + 200, snapEdgeAt(ph.end_ms + d)))) })
      }
    })
  }

  // Text bar: the body moves it, the ends trim it (at least 0.2 s, inside the clip)
  function handleTextOverlayBodyDrag(e: React.PointerEvent, id: string, origStart: number, origEnd: number) {
    e.stopPropagation()
    if (textOverlays.find(t => t.id === id)?.locked) return
    const k = msPerPx()
    if (!k) return
    const sx = e.clientX
    const len = origEnd - origStart
    setDragging(`text-${id}`)
    follow(ev => {
      const st = Math.round(snapSpanAt(Math.max(0, Math.min(duration - len, origStart + (ev.clientX - sx) * k)), len))
      onTextOverlayUpdate?.(id, { start_ms: st, end_ms: Math.min(duration, st + len) })
    })
  }

  function handleTextOverlayEdgeDrag(e: React.PointerEvent, id: string, origStart: number, origEnd: number, side: 'left' | 'right') {
    e.stopPropagation()
    if (textOverlays.find(t => t.id === id)?.locked) return
    setDragging(`text-${id}`)
    follow(ev => {
      const ms = Math.round(snapEdgeAt(msFromClientX(ev.clientX)))
      if (side === 'right') onTextOverlayUpdate?.(id, { end_ms: Math.min(duration, Math.max(ms, origStart + 200)) })
      else onTextOverlayUpdate?.(id, { start_ms: Math.max(0, Math.min(ms, origEnd - 200)) })
    })
  }

  /** An empty media lane: a faint row that adds that kind at the playhead (as in CapCut) */
  const emptyLane = (kind: 'video' | 'photo' | 'music' | 'text', hint: string) => onAddKind ? (
    <div data-lane={kind} className="relative" style={{ height: MEDIA_ROW_H }}>
      <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => onAddKind(kind)}
        className="lane-empty absolute inset-0 flex items-center px-2.5 rounded-[5px] text-[10.5px] font-medium">
        {hint}
      </button>
    </div>
  ) : null

  /** Dashed guide through a lane while one of its items sits on an edge */
  const laneGuide = (prefix: string) => snapLine !== null && dragging?.startsWith(prefix) ? (
    <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `calc(${pct(snapLine)}% - 0.5px)`, width: 0, borderLeft: `1.5px dashed ${ACCENT}`, zIndex: 20 }} />
  ) : null
  /** The lime tag on a bar that lines up with sections */
  const fitTag = (label: string | null) => label ? (
    <span className="relative shrink-0 px-1.5 rounded-full text-[9px] font-bold whitespace-nowrap pointer-events-none" style={{ background: ACCENT, color: '#000' }}>{label}</span>
  ) : null

  // Frame lane items: drag the body to move, the ends to trim. Items stay inside their format
  // and never cover a neighbour on the same lane.
  function handleFrameItemDown(e: React.PointerEvent, item: FrameItem, mode: 'move' | 'start' | 'end') {
    if (e.button !== 0 || !frameSeg) return
    e.stopPropagation()
    e.preventDefault()
    onSelectFrameItem?.(item.id)
    if (frameSeg.locked) return
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
  // The joins lane: just tall enough for its handles, and a thin gap when there are none
  const RULER_H = 30, STRIP_H = 52
  const LANE_H = mains.some((m, i) => i + 1 < mains.length && Math.abs(mains[i + 1].start_ms - m.end_ms) <= 1) ? 18 : 6
  /** The format a B-roll shot sits over (the one before it, else after): the strip keeps its colour there */
  const underBroll = (seg: SegmentLocal) =>
    [...mains].reverse().find(m => m.end_ms <= seg.start_ms + 1) ?? mains.find(m => m.start_ms >= seg.end_ms - 1)
  // The main video's own sound, when detached, sits in a row right over the strip
  const originals = musicTracks.filter(m => m.original)
  const ORIG_H = originals.length ? 24 : 0
  const STRIP_TOP = RULER_H + LANE_H + ORIG_H

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
    if (seg.locked) { onSeek(seg.start_ms); onPickSegment?.(seg.id); return }
    const sx = e.clientX
    const grab = msFromClientX(e.clientX) - seg.start_ms
    const len = seg.end_ms - seg.start_ms
    let moved = false
    let next = { start: seg.start_ms, end: seg.end_ms }
    setDragging(`broll-${part}-${seg.id}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      noSnapRef.current = ev.altKey
      const t = msFromClientX(ev.clientX)
      if (part === 'body') { const st = snapSpanAt(Math.max(0, Math.min(duration - len, t - grab)), len, seg.id); next = { start: st, end: Math.min(duration, st + len) } }
      else if (part === 'start') next = { start: Math.max(0, Math.min(seg.end_ms - 500, snapEdgeAt(t, seg.id))), end: seg.end_ms }
      else next = { start: seg.start_ms, end: Math.min(duration, Math.max(seg.start_ms + 500, snapEdgeAt(t, seg.id))) }
      setBrollGhost({ id: seg.id, ...next })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setBrollGhost(null)
      setSnapLine(null)
      if (!moved) { onSeek(seg.start_ms); onPickSegment?.(seg.id); return }
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
    for (const m of musicTracks.filter(x => !x.original).sort((a, b) => a.start_ms - b.start_ms)) {
      let r = ends.findIndex(e => e <= m.start_ms + 1)
      if (r === -1) { r = ends.length; ends.push(0); musicRows.push([]) }
      musicRows[r].push(m)
      ends[r] = musicEnd(m)
    }
  }

  // Photo rows: photos that overlap in time go on separate rows
  const photoRows: (typeof photos)[] = []
  {
    const ends: number[] = []
    for (const ph of [...photos].sort((a, b) => a.start_ms - b.start_ms)) {
      let r = ends.findIndex(e => e <= ph.start_ms + 1)
      if (r === -1) { r = ends.length; ends.push(0); photoRows.push([]) }
      photoRows[r].push(ph)
      ends[r] = ph.end_ms
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

  // Text rows: texts that don't overlap in time share a row
  const textRows: (typeof textOverlays)[] = []
  {
    const ends: number[] = []
    for (const o of [...textOverlays].sort((a, b) => a.start_ms - b.start_ms)) {
      let r = ends.findIndex(e => e <= o.start_ms + 1)
      if (r === -1) { r = ends.length; ends.push(0); textRows.push([]) }
      textRows[r].push(o)
      ends[r] = o.end_ms
    }
  }
  // Media bars always show at full size, wherever the playhead is
  const inFocus = (_startMs: number, _endMs: number) => true
  const THIN_ROW_H = 6
  /** A thin media line (outside the section under the playhead) */
  const thinBar = (color: string, startMs: number, endMs: number): React.CSSProperties => ({
    left: `${pct(startMs)}%`, width: `max(6px, ${pct(endMs - startMs)}%)`, top: '50%', height: 4, transform: 'translateY(-50%)',
    borderRadius: 2, backgroundColor: `${color}b3`, cursor: 'pointer', touchAction: 'none',
  })
  /** A media bar on its row: tinted with its kind's colour, a solid edge on the left; picked = white ring */
  const mediaBar = (color: string, startMs: number, endMs: number, sel: boolean, on: boolean, fits: boolean, st?: { hidden?: boolean; locked?: boolean }): React.CSSProperties => ({
    left: `${pct(startMs)}%`, width: `max(12px, ${pct(endMs - startMs)}%)`, borderRadius: 5, paddingRight: 8,
    backgroundColor: `${color}${sel || on ? '55' : '30'}`,
    boxShadow: fits && on ? `inset 0 0 0 1.5px ${ACCENT}, 0 0 10px rgba(200,255,0,0.35)`
      : sel ? `inset 0 0 0 1.5px #fff, 0 0 8px ${color}88`
        : `inset 0 0 0 1px ${color}80`,
    cursor: on ? 'grabbing' : 'grab', touchAction: 'none',
    ...(st?.hidden ? { opacity: 0.45, backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.35) 0 4px, transparent 4px 8px)' } : {}),
    ...(st?.locked ? { cursor: 'pointer' } : {}),
  })

  return (
    <div className="flex flex-col select-none" style={{ gap: 6 }}>
      {/* ── Toolbar: zoom (hidden when the editor's control bar holds the zoom buttons) ── */}
      {showToolbar && (
        <div className="flex items-center gap-3">
          <TimelineZoom zoom={zoom} onZoom={setZoom} />
        </div>
      )}

      <div className="flex items-start gap-3">
      {/* Lane icons, lined up with their rows: what each sub-timeline is. Media icons add that kind at the playhead. */}
      <div className="relative shrink-0 self-stretch" style={{ width: 40 }} aria-label="Timeline lanes">
        {laneSpans.map(sp => {
          const meta = LANE_META[sp.kind]
          if (!meta) return null
          // Room around each icon: it's a little smaller than its lane
          const size = Math.max(14, Math.min(26, sp.h - 2))
          const add = meta.add && onAddKind ? () => onAddKind(meta.add!) : undefined
          return (
            <button key={sp.kind} type="button" onClick={add} disabled={!add}
              title={add ? `${meta.label} — click to add at the playhead` : meta.label}
              aria-label={add ? `Add ${meta.label.toLowerCase()} at the playhead` : meta.label}
              className="lane-ico group absolute left-0 flex items-center justify-center rounded-lg"
              style={{ top: sp.top + sp.h / 2 - size / 2, left: 4, width: 32, height: size, cursor: add ? 'pointer' : 'default', '--lane-c': meta.color } as React.CSSProperties}>
              <svg width={Math.min(15, size - 4)} height={Math.min(15, size - 4)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{meta.icon}</svg>
              {add && size >= 16 && (
                <svg className="absolute pointer-events-none" style={{ right: 3, bottom: size >= 22 ? 1 : -1 }} width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            </button>
          )
        })}
      </div>
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
          <div ref={trackRef} className="relative" style={{ cursor: 'pointer', paddingBottom: 4 }} onPointerDown={handleTrackDrag}>

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


            {/* ── Joins lane: a handle wherever two sections touch ── */}
            <div className="relative" style={{ height: LANE_H }}>
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

            {/* ── Original sound (the main video's sound, detached): right over the video it comes from ── */}
            {originals.length > 0 && (
              <div data-lane="original" className="relative" style={{ height: ORIG_H, paddingBottom: 4 }}>
                <div className="relative h-full">
                  {originals.map(m => {
                    const end = musicEnd(m)
                    const on = dragging === `music-${m.id}`
                    const sel = selectedMusicId === m.id
                    return (
                      <div key={m.id} onPointerDown={e => handleMusicDrag(e, m)}
                        title={`Original sound · ${msToLabel(m.start_ms)}–${msToLabel(end)} · click to change it, drag to move, drag the ends to trim`}
                        className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden"
                        style={{ ...mediaBar(MEDIA_COLORS.music, m.start_ms, end, sel, on, false, m), zIndex: 33 }}>
                        {/* A faint sound wave so it reads as audio at a glance */}
                        <span className="absolute inset-0 pointer-events-none opacity-30" aria-hidden="true"
                          style={{ background: 'repeating-linear-gradient(90deg, transparent 0 3px, rgba(255,255,255,0.35) 3px 4px)', WebkitMaskImage: 'linear-gradient(180deg, transparent 25%, #000 50%, transparent 75%)', maskImage: 'linear-gradient(180deg, transparent 25%, #000 50%, transparent 75%)' }} />
                        {onMusicTrim && <MediaGrip onPointerDown={e => handleMusicTrim(e, m, 'start')} side="left" label="Trim the start of the original sound" />}
                        <MediaIcon kind="music" />
                        <span className="relative truncate text-[10px] font-semibold pointer-events-none" style={{ color: '#f3e8ff' }}>{m.name}</span>
                        <StateBadges st={m} />
                        {onMusicTrim && <MediaGrip onPointerDown={e => handleMusicTrim(e, m, 'end')} side="right" label="Trim the end of the original sound" />}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Film strip: tinted per format, hatched where no format is set ── */}
            <div data-lane="main" className="relative overflow-hidden" style={{ height: STRIP_H, borderRadius: 12, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.1), 0 10px 24px -12px rgba(0,0,0,0.9)' }}>
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
                const picked = seg.id === pickedSegmentId
                return (
                  <div key={`under-${seg.id}`} className="absolute inset-y-0 pointer-events-none"
                    style={{
                      left: `${pct(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`, background: `${color}2a`, borderTop: `3px solid ${color}aa`,
                      // Picked: the same lime frame a format gets
                      ...(picked ? { boxShadow: `inset 0 2px 0 ${ACCENT}, inset 0 -2px 0 ${ACCENT}, inset 2px 0 0 ${ACCENT}, inset -2px 0 0 ${ACCENT}`, borderRadius: 12 } : {}),
                    }} />
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
                    <StateBadges st={seg} corner />
                  </div>
                )
              })}
            </div>

            {/* A section about to go (its join dragged onto the next one): red, with what releasing does */}
            {doomed && (
              <>
                <div className="absolute pointer-events-none" style={{
                  left: `${pct(doomed.start)}%`, width: `${pct(doomed.end - doomed.start)}%`, top: STRIP_TOP, height: STRIP_H, zIndex: 31,
                  borderRadius: 12, background: 'repeating-linear-gradient(135deg, rgba(239,68,68,0.55) 0 8px, rgba(239,68,68,0.38) 8px 16px)',
                  boxShadow: 'inset 0 0 0 2px #ef4444',
                }} />
                <span className="absolute pointer-events-none px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                  style={{ left: `${pct((doomed.start + doomed.end) / 2)}%`, top: RULER_H + LANE_H / 2, transform: 'translate(-50%, -50%)', zIndex: 45, background: '#ef4444', color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                  {doomed.label}
                </span>
              </>
            )}

            {/* ── Views: one ◆ per view change of the format under the playhead ── */}
            <div className="relative" style={{ height: 20, marginTop: 4 }}>
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
              <div ref={lanesRef} data-lane="frame" className="relative flex flex-col pb-1.5"
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

          {/* ── Media lanes under the main video: everything added from outside it — videos, photos,
              music, text. Slim rows, one colour per kind; items that don't overlap share a row ── */}
          {(onAddKind || brolls.length > 0 || photos.length > 0 || musicRows.length > 0 || textOverlays.length > 0) && (
            <div className="relative flex flex-col" style={{ gap: MEDIA_GAP, paddingTop: 6, paddingBottom: 4, borderTop: '1px solid rgb(var(--ed-fg) / 0.05)' }}>
              {laneGuide('broll-') ?? laneGuide('photo-') ?? laneGuide('music-') ?? laneGuide('text-')}
              {/* Playhead through all the media rows */}
              <div className="absolute top-0 bottom-0 w-px pointer-events-none" style={{ left: `${playheadPct}%`, background: 'rgba(255,255,255,0.55)', zIndex: 15 }} />

              {/* Videos (B-roll and inserted videos): they play instead of the main video for their time */}
              {brolls.length === 0 && emptyLane('video', 'Tap to add a video')}
              {brolls.length > 0 && (
                <div data-lane="video" className="lane-track relative" style={{ height: brolls.some(sg => sg.id === activeSegmentId || sg.id === pickedSegmentId || (dragging?.startsWith('broll-') && dragging.endsWith(sg.id)) || inFocus(sg.start_ms, sg.end_ms)) ? MEDIA_ROW_H : THIN_ROW_H, transition: 'height .2s' }}>
                  {brolls.map(seg => {
                    const sel = seg.id === activeSegmentId || seg.id === pickedSegmentId
                    const on = !!dragging?.startsWith('broll-') && dragging.endsWith(seg.id)
                    const at = brollGhost?.id === seg.id ? { start_ms: brollGhost.start, end_ms: brollGhost.end } : seg
                    const box = seg.crop_boxes[0]
                    const name = (videoTitles[box?.source_video_id ?? ''] ?? 'Video').replace(/^(Pixabay|Pexels): /, '').split(',')[0]
                    const url = videoUrls[box?.source_video_id ?? '']
                    if (!sel && !on && !inFocus(seg.start_ms, seg.end_ms)) return (
                      <div key={seg.id} onPointerDown={e => handleBrollDown(e, seg, 'body')} className="absolute"
                        title={`Video · ${name} · ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)}`}
                        style={thinBar(MEDIA_COLORS.video, at.start_ms, at.end_ms)} />
                    )
                    return (
                      <div key={seg.id} onPointerDown={e => handleBrollDown(e, seg, 'body')}
                        title={`Video · ${name} · ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)} · click to pick it, drag to move, drag the ends to trim`}
                        className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden"
                        style={mediaBar(MEDIA_COLORS.video, at.start_ms, at.end_ms, sel, on, false, { hidden: seg.crop_boxes[0]?.hidden, locked: seg.locked })}>
                        {/* Frames of the video, faint behind its name */}
                        {url && <span className="absolute inset-0 pointer-events-none opacity-40"><VideoThumbnails videoUrl={url} startMs={box?.source_offset_ms ?? 0} durationMs={seg.end_ms - seg.start_ms} count={4} radius={5} dim={false} /></span>}
                        <MediaGrip onPointerDown={e => handleBrollDown(e, seg, 'start')} side="left" label="Trim the start of the video" />
                        <MediaIcon kind="video" />
                        <span className="relative truncate text-[10px] font-semibold pointer-events-none" style={{ color: '#fff7ed' }}>{name}</span>
                        <StateBadges st={{ hidden: seg.crop_boxes[0]?.hidden, locked: seg.locked }} />
                        <MediaGrip onPointerDown={e => handleBrollDown(e, seg, 'end')} side="right" label="Trim the end of the video" />
                      </div>
                    )
                  })}
                </div>
              )}

              {photoRows.length === 0 && emptyLane('photo', 'Tap to add a photo')}
              {photoRows.map((row, ri) => (
                <div key={`p${ri}`} data-lane="photo" className="lane-track relative" style={{ height: row.some(ph => inFocus(ph.start_ms, ph.end_ms) || ph.id === activePhotoId || dragging === `photo-${ph.id}`) ? MEDIA_ROW_H : THIN_ROW_H, transition: 'height .2s' }}>
                  {row.map(ph => {
                    const sel = ph.id === activePhotoId
                    const on = dragging === `photo-${ph.id}`
                    const fits = fitLabel(ph.start_ms, ph.end_ms)
                    if (!sel && !on && !inFocus(ph.start_ms, ph.end_ms)) return (
                      <div key={ph.id} onPointerDown={e => handlePhotoDrag(e, ph, 'body')} className="absolute"
                        title={`Photo · ${msToLabel(ph.start_ms)}–${msToLabel(ph.end_ms)}`} style={thinBar(MEDIA_COLORS.photo, ph.start_ms, ph.end_ms)} />
                    )
                    return (
                      <div key={ph.id} onPointerDown={e => handlePhotoDrag(e, ph, 'body')}
                        title={`Photo · ${msToLabel(ph.start_ms)}–${msToLabel(ph.end_ms)} · click to change it, drag to move, drag the ends to trim`}
                        className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden"
                        style={mediaBar(MEDIA_COLORS.photo, ph.start_ms, ph.end_ms, sel, on, !!fits, ph)}>
                        <MediaGrip onPointerDown={e => handlePhotoDrag(e, ph, 'start')} side="left" label="Trim the start of the photo" />
                        {ph.url
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={ph.url} alt="" className="shrink-0 rounded-[3px] object-cover pointer-events-none" style={{ width: 22, height: MEDIA_ROW_H - 6, marginLeft: 8 }} />
                          : <MediaIcon kind="photo" />}
                        <StateBadges st={ph} />
                        {(sel || on) && fitTag(fits)}
                        <MediaGrip onPointerDown={e => handlePhotoDrag(e, ph, 'end')} side="right" label="Trim the end of the photo" />
                      </div>
                    )
                  })}
                </div>
              ))}

              {musicRows.length === 0 && emptyLane('music', 'Tap to add music')}
              {musicRows.map((row, ri) => (
                <div key={`m${ri}`} data-lane="music" className="lane-track relative" style={{ height: row.some(m => inFocus(m.start_ms, musicEnd(m)) || selectedMusicId === m.id || dragging === `music-${m.id}`) ? MEDIA_ROW_H : THIN_ROW_H, transition: 'height .2s' }}>
                  {row.map(m => {
                    const end = musicEnd(m)
                    const on = dragging === `music-${m.id}`
                    const sel = selectedMusicId === m.id
                    const fits = fitLabel(m.start_ms, end)
                    if (!sel && !on && !inFocus(m.start_ms, end)) return (
                      <div key={m.id} onPointerDown={e => handleMusicDrag(e, m)} className="absolute"
                        title={`Music · ${m.name} · ${msToLabel(m.start_ms)}–${msToLabel(end)}`} style={thinBar(MEDIA_COLORS.music, m.start_ms, end)} />
                    )
                    return (
                      <div key={m.id} onPointerDown={e => handleMusicDrag(e, m)}
                        title={`Music · ${m.name} · ${msToLabel(m.start_ms)}–${msToLabel(end)} · click to change it, drag to move, drag the ends to trim`}
                        className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden"
                        style={mediaBar(MEDIA_COLORS.music, m.start_ms, end, sel, on, !!fits, m)}>
                        {/* A faint sound wave so it reads as audio at a glance */}
                        <span className="absolute inset-0 pointer-events-none opacity-30" aria-hidden="true"
                          style={{ background: 'repeating-linear-gradient(90deg, transparent 0 3px, rgba(255,255,255,0.35) 3px 4px)', WebkitMaskImage: 'linear-gradient(180deg, transparent 25%, #000 50%, transparent 75%)', maskImage: 'linear-gradient(180deg, transparent 25%, #000 50%, transparent 75%)' }} />
                        {onMusicTrim && <MediaGrip onPointerDown={e => handleMusicTrim(e, m, 'start')} side="left" label="Trim the start of the music" />}
                        <MediaIcon kind="music" />
                        <span className="relative truncate text-[10px] font-semibold pointer-events-none" style={{ color: '#f3e8ff' }}>{m.name}</span>
                        <StateBadges st={m} />
                        {(sel || on) && fitTag(fits)}
                        {onMusicTrim && <MediaGrip onPointerDown={e => handleMusicTrim(e, m, 'end')} side="right" label="Trim the end of the music" />}
                      </div>
                    )
                  })}
                </div>
              ))}

              {textRows.length === 0 && emptyLane('text', 'Tap to add text')}
              {textRows.map((row, ri) => (
                <div key={`t${ri}`} data-lane="text" className="lane-track relative" style={{ height: row.some(o => inFocus(o.start_ms, o.end_ms) || o.id === activeTextOverlayId || dragging === `text-${o.id}`) ? MEDIA_ROW_H : THIN_ROW_H, transition: 'height .2s' }}>
                  {row.map(o => {
                    const sel = o.id === activeTextOverlayId
                    const on = dragging === `text-${o.id}`
                    const fits = fitLabel(o.start_ms, o.end_ms)
                    if (!sel && !on && !inFocus(o.start_ms, o.end_ms)) return (
                      <div key={o.id} onPointerDown={e => { onSelectTextOverlay?.(o.id); handleTextOverlayBodyDrag(e, o.id, o.start_ms, o.end_ms) }} className="absolute"
                        title={`Text · “${o.text}” · ${msToLabel(o.start_ms)}–${msToLabel(o.end_ms)}`} style={thinBar(MEDIA_COLORS.text, o.start_ms, o.end_ms)} />
                    )
                    return (
                      <div key={o.id}
                        onPointerDown={e => { onSelectTextOverlay?.(o.id); handleTextOverlayBodyDrag(e, o.id, o.start_ms, o.end_ms) }}
                        title={`Text · “${o.text}” · ${msToLabel(o.start_ms)}–${msToLabel(o.end_ms)} · click to change it, drag to move, drag the ends to trim`}
                        className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden"
                        style={mediaBar(MEDIA_COLORS.text, o.start_ms, o.end_ms, sel, on, !!fits, o)}>
                        <MediaGrip onPointerDown={e => { onSelectTextOverlay?.(o.id); handleTextOverlayEdgeDrag(e, o.id, o.start_ms, o.end_ms, 'left') }} side="left" label="Trim the start of the text" />
                        <MediaIcon kind="text" />
                        <span className="truncate text-[10px] font-semibold pointer-events-none" style={{ color: '#fdf2f8' }}>{o.text}</span>
                        <StateBadges st={o} />
                        {(sel || on) && fitTag(fits)}
                        <MediaGrip onPointerDown={e => { onSelectTextOverlay?.(o.id); handleTextOverlayEdgeDrag(e, o.id, o.start_ms, o.end_ms, 'right') }} side="right" label="Trim the end of the text" />
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

// The icon column next to the timeline: one per kind of lane
type LaneMeta = { label: string; color: string; icon: React.ReactNode; add?: 'video' | 'photo' | 'music' | 'text' }
const LANE_META: Record<string, LaneMeta> = {
  original: { label: 'Original sound', color: '#c084fc', icon: <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7" /></> },
  main: { label: 'Main video', color: 'rgb(var(--ed-fg) / 0.75)', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></> },
  frame: { label: 'Frame slots', color: '#2dd4bf', icon: <><rect x="6" y="2.5" width="12" height="19" rx="2" /><path d="M6 9.5h12M6 14.5h12" /></> },
  video: { label: 'Videos', color: '#f97316', add: 'video' as const, icon: <><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></> },
  photo: { label: 'Photos', color: '#60a5fa', add: 'photo' as const, icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></> },
  music: { label: 'Music', color: '#c084fc', add: 'music' as const, icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></> },
  text: { label: 'Text', color: '#f472b6', add: 'text' as const, icon: <path d="M4 7V4h16v3M9 20h6M12 4v16" /> },
}

// Media rows under the strip: one colour per kind (video is the orange bar over the strip)
const MEDIA_COLORS = { video: '#f97316', photo: '#60a5fa', text: '#f472b6', music: '#c084fc' } as const
const MEDIA_ROW_H = 24
const MEDIA_GAP = 8

/** Little marks on a bar (or a section's corner on the strip): hidden, muted, locked */
function StateBadges({ st, corner }: { st?: { hidden?: boolean; muted?: boolean; locked?: boolean }; corner?: boolean }) {
  if (!st || !(st.hidden || st.muted || st.locked)) return null
  const mark = (key: string, title: string, d: React.ReactNode) => (
    <span key={key} title={title} className="flex items-center justify-center rounded-full" style={{ width: 14, height: 14, background: 'rgba(0,0,0,0.7)', color: '#fff' }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
    </span>
  )
  return (
    <span className={corner ? 'absolute left-2 top-1.5 flex gap-0.5 pointer-events-none' : 'relative shrink-0 flex items-center gap-0.5 pointer-events-none'} style={{ zIndex: 2 }}>
      {st.hidden && mark('h', 'Hidden: not shown or exported', <><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0112 5c5 0 9 5 9 7a11 11 0 01-2.2 3.2M6.6 6.6C4.4 8 3 10.4 3 12c0 2 4 7 9 7a9.6 9.6 0 004.4-1.1" /></>)}
      {st.muted && mark('m', 'Muted', <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></>)}
      {st.locked && mark('l', 'Locked: can\u2019t be moved, trimmed or deleted', <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>)}
    </span>
  )
}

/** Small icon in its kind's colour at the start of a media bar */
function MediaIcon({ kind }: { kind: 'video' | 'photo' | 'text' | 'music' }) {
  return (
    <svg className="relative shrink-0 pointer-events-none" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={MEDIA_COLORS[kind]} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ marginLeft: 8 }}>
      {kind === 'video' ? <><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></>
        : kind === 'photo' ? <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>
        : kind === 'music' ? <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>
          : <path d="M4 7V4h16v3M9 20h6M12 4v16" />}
    </svg>
  )
}

/** Trim handle at one end of a media bar: a thin strip, with a small grip line */
function MediaGrip({ side, label, onPointerDown }: { side: 'left' | 'right'; label: string; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <span onPointerDown={onPointerDown} aria-label={label}
      className={`group/grip absolute inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} w-1.5 flex items-center justify-center cursor-col-resize z-10`}>
      <span className="w-[2px] h-2.5 rounded-full transition-colors bg-[rgba(255,255,255,0.35)] group-hover/grip:bg-white" />
    </span>
  )
}

