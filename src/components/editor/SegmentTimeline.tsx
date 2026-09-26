'use client'

import { useRef, useState, useEffect } from 'react'
import type { SegmentLocal, LayoutType, TextOverlay } from '@chai-cut/shared'

export const LAYOUT_COLORS: Record<LayoutType, string> = {
  vertical:   '#22c55e',
  split:      '#3b82f6',
  trio:       '#f59e0b',
  spotlight:  '#ef4444',
  centered:   '#06b6d4',
  horizontal: '#ec4899',
}

function isBroll(seg: SegmentLocal): boolean {
  return seg.crop_boxes.some(b => b.source_video_id != null)
}

const THUMB_W = 80
const THUMB_H = 56
const THUMB_COUNT = 24

// Frames sampled across the clip's own range of the source video, so each thumbnail sits under
// the moment it shows (the video file is the whole source, not just this clip)
function VideoThumbnails({ videoUrl, startMs, durationMs }: { videoUrl: string; startMs: number; durationMs: number }) {
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
      for (let i = 0; i < THUMB_COUNT; i++) {
        if (cancelled) return
        const targetSec = fromSec + ((i + 0.5) / THUMB_COUNT) * spanSec
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
  }, [videoUrl, startMs, durationMs])

  return (
    <div className="absolute inset-0 flex overflow-hidden" style={{ borderRadius: 8 }}>
      {Array.from({ length: THUMB_COUNT }).map((_, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, overflow: 'hidden', background: 'rgb(var(--ed-fg) / 0.03)' }}>
          {thumbs[i] && (
            <img src={thumbs[i]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0, transition: 'opacity 0.3s ease' }}
              onLoad={e => { (e.currentTarget as HTMLImageElement).style.opacity = '1' }} />
          )}
        </div>
      ))}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8 }} />
    </div>
  )
}

function msToLabel(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

const ZOOM_STEPS = [1, 1.5, 2, 3, 4, 6, 8]
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
  activeTextOverlayId,
  onSelectTextOverlay,
  onTextOverlayUpdate,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [viewW, setViewW] = useState(0)
  const [dragging, setDragging] = useState<string | null>(null)
  const [snapLine, setSnapLine] = useState<number | null>(null)
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

  function changeZoom(dir: 1 | -1) {
    const i = ZOOM_STEPS.indexOf(zoom)
    setZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, i + dir))])
  }

  function msFromClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return 0
    return Math.max(0, Math.min(((clientX - rect.left) / rect.width) * duration, duration))
  }

  function handleTrackDrag(e: React.PointerEvent) {
    if (e.button !== 0) return
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
  const RULER_H = 26, LANE_H = 20, STRIP_H = 48
  const STRIP_TOP = RULER_H + LANE_H

  // Places where one format ends exactly where the next begins
  const junctions: { left: SegmentLocal; right: SegmentLocal }[] = []
  for (let i = 0; i + 1 < byTime.length; i++) {
    if (Math.abs(byTime[i + 1].start_ms - byTime[i].end_ms) <= 1) junctions.push({ left: byTime[i], right: byTime[i + 1] })
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
      {/* Zoom */}
      <div className="flex items-center gap-2">
        <div className="flex items-center rounded-lg" style={{ background: 'rgb(var(--ed-fg) / 0.05)' }}>
          <button onClick={() => changeZoom(-1)} disabled={zoom === ZOOM_STEPS[0]} aria-label="Zoom out timeline"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm disabled:opacity-30 hover:bg-[rgb(var(--ed-fg)/0.1)]" style={{ color: 'rgb(var(--ed-fg) / 0.7)' }}>−</button>
          <span className="w-9 text-center text-xs tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>{zoom}x</span>
          <button onClick={() => changeZoom(1)} disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]} aria-label="Zoom in timeline"
            className="w-7 h-7 flex items-center justify-center rounded-lg text-sm disabled:opacity-30 hover:bg-[rgb(var(--ed-fg)/0.1)]" style={{ color: 'rgb(var(--ed-fg) / 0.7)' }}>+</button>
        </div>
      </div>

      {/* No visible scrollbar: when zoomed in, the wheel scrolls sideways and the view follows the playhead */}
      <div ref={scrollRef} className="relative overflow-x-auto overflow-y-hidden rounded-lg no-scrollbar"
        style={{ background: 'var(--ed-ruler)', border: '1px solid rgb(var(--ed-fg) / 0.06)', scrollbarWidth: 'none' }}>
        <div className="relative" style={{ width: `${zoom * 100}%`, minWidth: '100%' }}>
          <div ref={trackRef} className="relative" style={{ cursor: 'pointer', paddingBottom: 10 }} onPointerDown={handleTrackDrag}>

            {/* ── Ruler ─────────────────────────────────────────────── */}
            <div className="relative" style={{ height: RULER_H }}>
              {ticks.map(({ t, major }) => {
                const p = pct(t)
                return (
                  <div key={t} className="absolute bottom-0 pointer-events-none" style={{ left: `${p}%`, width: 1, height: major ? 10 : 5, background: major ? 'rgb(var(--ed-fg) / 0.35)' : 'rgb(var(--ed-fg) / 0.14)' }}>
                    {major && (
                      <span className="absolute tabular-nums" style={{
                        bottom: 12, fontSize: 10, color: 'rgb(var(--ed-fg) / 0.45)', whiteSpace: 'nowrap',
                        transform: p < 2 ? 'translateX(2px)' : p > 98 ? 'translateX(-100%)' : 'translateX(-50%)',
                      }}>{msToLabel(t)}</span>
                    )}
                  </div>
                )
              })}
            </div>


            {/* ── Junction lane: one handle wherever two formats touch ── */}
            <div className="relative" style={{ height: LANE_H, background: 'rgb(var(--ed-fg) / 0.025)', borderTop: '1px solid rgb(var(--ed-fg) / 0.05)' }}>
              {junctions.length === 0 && (
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[10px] pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.25)' }}>
                  Joins between touching formats appear here
                </span>
              )}
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
            <div className="relative overflow-hidden" style={{ height: STRIP_H }}>
              {videoUrl
                ? <VideoThumbnails videoUrl={videoUrl} startMs={clipStartMs} durationMs={duration} />
                : <div className="absolute inset-0" style={{ background: 'var(--ed-raise)' }} />}

              {gaps.map(g => (
                <div key={`gap-${g.start_ms}`} className="absolute inset-y-0 pointer-events-none flex items-center justify-center overflow-hidden"
                  title={`${msToLabel(g.start_ms)}–${msToLabel(g.end_ms)} · no format: default Vertical framing`}
                  style={{
                    left: `${pct(g.start_ms)}%`, width: `${pct(g.end_ms - g.start_ms)}%`,
                    background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.55) 0 6px, rgba(0,0,0,0.35) 6px 12px)',
                    borderTop: '3px dashed rgb(var(--ed-fg) / 0.35)',
                  }}>
                  <span className="text-[10px] font-semibold px-1.5 rounded" style={{ color: 'rgba(255,255,255,0.85)', background: 'rgba(0,0,0,0.5)' }}>Default</span>
                </div>
              ))}

              {byTime.map(seg => {
                const color = colorOf(seg)
                const isActive = seg.id === activeSegmentId
                return (
                  <div key={seg.id} className="absolute inset-y-0 pointer-events-none"
                    style={{
                      left: `${pct(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`,
                      background: `${color}${isActive ? '38' : '2a'}`,
                      borderTop: `3px solid ${color}${isActive ? '' : 'aa'}`,
                      boxShadow: isActive ? `inset 0 0 0 2px ${color}` : 'none',
                    }} />
                )
              })}
            </div>

            {/* ── Keys: ◆ start (top edge) and ◆ end (bottom edge) of every format ── */}
            {byTime.flatMap((seg, i) => {
              const color = colorOf(seg)
              const selected = seg.id === activeSegmentId
              const label = isBroll(seg) ? 'B-roll' : seg.layout === 'split' ? 'Split screen' : seg.layout.charAt(0).toUpperCase() + seg.layout.slice(1)
              return (['start', 'end'] as const).map(edge => {
                const t = edge === 'start' ? seg.start_ms : seg.end_ms
                const key = `${edge}-${seg.id}`
                const size = selected ? 16 : 13
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
                    className="absolute"
                    style={{
                      left: `${pct(t)}%`, top: edge === 'start' ? STRIP_TOP + 3 : STRIP_TOP + STRIP_H - 3,
                      width: size, height: size,
                      // Keep keys at the very ends of the clip fully visible
                      transform: `translate(${t <= 0 ? '0' : t >= duration ? '-100%' : '-50%'}, -50%) rotate(45deg)`,
                      background: color, borderRadius: 3,
                      border: `2px solid ${selected ? '#fff' : 'rgba(0,0,0,0.6)'}`,
                      boxShadow: dragging === key ? `0 0 0 4px ${color}55` : '0 1px 4px rgba(0,0,0,0.6)',
                      cursor: 'ew-resize', touchAction: 'none', zIndex: selected ? 32 : 30,
                    }} />
                )
              })
            })}

            {/* Snap guide while trimming */}
            {snapLine !== null && (
              <div className="absolute top-0 bottom-0 pointer-events-none z-20" style={{ left: `${pct(snapLine)}%`, width: 1, background: 'rgb(var(--ed-fg) / 0.6)' }} />
            )}

            {/* ── Playhead ─────────────────────────────────────────── */}
            <div className="absolute top-0 bottom-0 pointer-events-none z-40" style={{ left: `${playheadPct}%` }}>
              <svg width="12" height="10" viewBox="0 0 12 10" className="absolute" style={{ top: 0, left: -6 }}><path d="M0 0h12L6 10z" fill="#c8ff00" /></svg>
              <div className="absolute" style={{ top: 0, bottom: 0, left: -1, width: 2, background: '#c8ff00', boxShadow: '0 0 6px rgba(200,255,0,0.7)' }} />
            </div>
          </div>

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
  )
}
