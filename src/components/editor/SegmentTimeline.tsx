'use client'

import { useRef, useState, useEffect } from 'react'
import type { SegmentLocal, LayoutType, TextOverlay, Overlay } from '@chai-cut/shared'

const LAYOUT_COLORS: Record<LayoutType, string> = {
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
const THUMB_COUNT = 8

function VideoThumbnails({ videoUrl, startSec = 0, endSec }: { videoUrl: string; startSec?: number; endSec?: number }) {
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
      const rangeEnd = Math.min(endSec ?? durSec, durSec)
      const rangeStart = Math.max(0, startSec)
      const rangeLen = Math.max(rangeEnd - rangeStart, 1)
      for (let i = 0; i < THUMB_COUNT; i++) {
        if (cancelled) return
        const targetSec = rangeStart + ((i + 0.5) / THUMB_COUNT) * rangeLen
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
  }, [videoUrl, startSec, endSec])

  return (
    <div className="absolute inset-0 flex overflow-hidden">
      {Array.from({ length: THUMB_COUNT }).map((_, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, overflow: 'hidden', background: 'rgba(255,255,255,0.04)' }}>
          {thumbs[i] && (
            <img src={thumbs[i]} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', opacity: 0, transition: 'opacity 0.3s ease' }}
              onLoad={e => { (e.currentTarget as HTMLImageElement).style.opacity = '1' }} />
          )}
        </div>
      ))}
      <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(0,0,0,0.18)' }} />
    </div>
  )
}

function msToLabel(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}


interface Props {
  segments: SegmentLocal[]
  clipStartMs: number
  clipEndMs: number
  currentTimeMs: number
  activeSegmentId: string | null
  videoUrl?: string
  safeDurationMs?: number
  brollUrls?: Record<string, string>
  onSeek: (ms: number) => void
  onSelectSegment: (id: string) => void
  onUpdateSegment: (id: string, updates: { start_ms?: number; end_ms?: number }) => void
  onInsertBrollAfter?: (afterSegId: string) => void
  textOverlays?: TextOverlay[]
  activeTextOverlayId?: string | null
  onSelectTextOverlay?: (id: string) => void
  onTextOverlayUpdate?: (id: string, updates: { start_ms?: number; end_ms?: number }) => void
  videoOverlays?: Overlay[]
  activeOverlayId?: string | null
  onSelectOverlay?: (id: string) => void
  onOverlayUpdate?: (id: string, updates: { start_ms?: number; end_ms?: number }) => void
  onDeleteOverlay?: (id: string) => void
  onDeleteSegment?: (id: string) => void
  onCut?: () => void
}

export function SegmentTimeline({
  segments,
  clipStartMs,
  clipEndMs,
  currentTimeMs,
  activeSegmentId,
  videoUrl,
  safeDurationMs,
  brollUrls,
  onSeek,
  onSelectSegment,
  onUpdateSegment,
  onInsertBrollAfter,
  textOverlays = [],
  activeTextOverlayId,
  onSelectTextOverlay,
  onTextOverlayUpdate,
  videoOverlays = [],
  activeOverlayId,
  onSelectOverlay,
  onOverlayUpdate,
  onDeleteOverlay,
  onDeleteSegment,
  onCut,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  // Always take the maximum of: passed safeDurationMs, actual max segment end_ms, current playhead,
  // and original clip length — so the timeline never clips segments or hides the playhead.
  const segMaxMs = segments.reduce((m, s) => Math.max(m, s.end_ms), 0)
  const duration = Math.max(safeDurationMs || 0, segMaxMs, currentTimeMs, clipEndMs - clipStartMs) || 0

  function pxToMs(px: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return 0
    return Math.max(0, Math.min((px / rect.width) * duration, duration))
  }

  function handleTrackDrag(e: React.MouseEvent) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onSeek(pxToMs(e.clientX - rect.left))
    function onMove(ev: MouseEvent) {
      const r = trackRef.current?.getBoundingClientRect()
      if (!r) return
      onSeek(pxToMs(ev.clientX - r.left))
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  function handleBoundaryDrag(e: React.MouseEvent, segId: string, side: 'left' | 'right') {
    e.stopPropagation()
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return

    function onMouseMove(ev: MouseEvent) {
      const x = Math.max(0, Math.min(ev.clientX - rect!.left, rect!.width))
      const ms = pxToMs(x)
      if (side === 'right') {
        onUpdateSegment(segId, { end_ms: Math.min(Math.max(ms, 100), duration) })
      } else {
        onUpdateSegment(segId, { start_ms: Math.max(Math.min(ms, duration - 100), 0) })
      }
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function handleTextOverlayBodyDrag(e: React.MouseEvent, id: string, origStart: number, origEnd: number) {
    e.stopPropagation()
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const sx = e.clientX
    const dur = origEnd - origStart
    function move(ev: MouseEvent) {
      const dMs = ((ev.clientX - sx) / rect!.width) * duration
      const newStart = Math.round(Math.max(0, Math.min(duration - dur, origStart + dMs)))
      onTextOverlayUpdate?.(id, { start_ms: newStart, end_ms: newStart + dur })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function handleTextOverlayEdgeDrag(e: React.MouseEvent, id: string, origStart: number, origEnd: number, side: 'left' | 'right') {
    e.stopPropagation()
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    function move(ev: MouseEvent) {
      const x = Math.max(0, Math.min(ev.clientX - rect!.left, rect!.width))
      const ms = Math.round((x / rect!.width) * duration)
      if (side === 'right') onTextOverlayUpdate?.(id, { end_ms: Math.max(ms, origStart + 200) })
      else onTextOverlayUpdate?.(id, { start_ms: Math.min(ms, origEnd - 200) })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const playheadPct = duration > 0 ? (currentTimeMs / duration) * 100 : 0
  const sorted = [...segments].sort((a, b) => a.sort_order - b.sort_order)

  // Adaptive tick interval for the ruler
  const durSec = duration / 1000
  const tickMs = durSec <= 30 ? 5000 : durSec <= 90 ? 10000 : durSec <= 180 ? 15000 : durSec <= 360 ? 30000 : 60000
  const ticks: number[] = []
  for (let t = 0; t <= duration; t += tickMs) ticks.push(t)

  return (
    <div className="flex flex-col" style={{ gap: 0 }}>

      {/* ── Unified drag area: ruler + band + track all seek on drag ────── */}
      <div ref={trackRef} className="flex flex-col select-none" style={{ gap: 0, cursor: 'ew-resize' }} onMouseDown={handleTrackDrag}>

      {/* ── Time ruler ─────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden" style={{ height: 26, background: '#0c0c0c', borderRadius: '6px 6px 0 0' }}>
        {ticks.map(t => {
          const pct = duration > 0 ? (t / duration) * 100 : 0
          const isMajor = t % (tickMs * 2) === 0 || t === 0
          return (
            <div key={t} className="absolute flex flex-col items-center pointer-events-none" style={{ left: `${pct}%`, top: 0, bottom: 0, transform: 'translateX(-50%)' }}>
              <div style={{ flex: 1 }} />
              <div style={{ width: 1, height: isMajor ? 10 : 5, background: isMajor ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)' }} />
              {isMajor && (
                <span style={{ position: 'absolute', top: 3, fontSize: 9, fontWeight: 500, color: 'rgba(255,255,255,0.38)', whiteSpace: 'nowrap', transform: 'translateX(-50%)', left: '50%' }}>
                  {msToLabel(t)}
                </span>
              )}
            </div>
          )
        })}
        {/* Playhead triangle */}
        <div className="absolute top-0 pointer-events-none z-20" style={{ left: `${playheadPct}%`, transform: 'translateX(-50%)' }}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 10L0 0h10z" fill="#c8ff00"/></svg>
        </div>
        {/* Playhead line */}
        <div className="absolute inset-y-0 pointer-events-none z-10" style={{ left: `${playheadPct}%`, width: 1, background: '#c8ff00', opacity: 0.6 }} />
      </div>

      {/* ── Overlay track — floating video layers only (not inserts) ─── */}
      {videoOverlays.length > 0 && (
        <div className="relative select-none" style={{ height: 36, background: 'rgba(249,115,22,0.10)', borderTop: '1px solid rgba(249,115,22,0.3)', borderBottom: '1px solid rgba(0,0,0,0.5)' }}>
          <span style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 9, fontWeight: 800, color: 'rgba(249,115,22,0.8)', letterSpacing: '0.08em', pointerEvents: 'none', zIndex: 1 }}>OVERLAY</span>
          {videoOverlays.map(ov => {
            const left = (ov.start_ms / duration) * 100
            const width = Math.max(((ov.end_ms - ov.start_ms) / duration) * 100, 0.5)
            const isActive = ov.id === activeOverlayId
            return (
              <div
                key={ov.id}
                className="absolute flex items-center overflow-hidden"
                style={{
                  top: 4, bottom: 4,
                  left: `${left}%`, width: `${width}%`,
                  background: isActive ? '#f97316' : 'rgba(249,115,22,0.7)',
                  border: `1.5px solid ${isActive ? '#fff' : '#fb923c'}`,
                  borderRadius: 4,
                  boxShadow: isActive ? '0 0 0 2px rgba(249,115,22,0.5)' : 'inset 0 1px 0 rgba(255,255,255,0.15)',
                  minWidth: 4, cursor: 'pointer',
                }}
                onMouseDown={e => { e.stopPropagation()
                  const rect = trackRef.current?.getBoundingClientRect()
                  if (!rect) return
                  const sx = e.clientX
                  const origStart = ov.start_ms
                  const origEnd = ov.end_ms
                  const dur = origEnd - origStart
                  function move(ev: MouseEvent) {
                    const dMs = ((ev.clientX - sx) / rect!.width) * duration
                    const newStart = Math.round(Math.max(0, Math.min(duration - dur, origStart + dMs)))
                    onOverlayUpdate?.(ov.id, { start_ms: newStart, end_ms: newStart + dur })
                  }
                  function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                  window.addEventListener('mousemove', move)
                  window.addEventListener('mouseup', up)
                }}
                onClick={e => { e.stopPropagation(); onSelectOverlay?.(ov.id) }}
              >
                <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', padding: '0 4px 0 8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, pointerEvents: 'none' }}>
                  ▶ Overlay
                </span>
                {/* Delete button */}
                <button
                  style={{ flexShrink: 0, width: 16, height: 16, borderRadius: 3, background: 'rgba(0,0,0,0.5)', border: 'none', color: '#fff', fontSize: 10, lineHeight: '16px', textAlign: 'center', cursor: 'pointer', marginRight: 4 }}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onDeleteOverlay?.(ov.id) }}
                >×</button>
                {/* Left trim */}
                <div className="absolute left-0 inset-y-0 flex items-center justify-center cursor-col-resize z-10" style={{ width: 8 }}
                  onMouseDown={e => { e.stopPropagation()
                    const rect = trackRef.current?.getBoundingClientRect()
                    if (!rect) return
                    function move(ev: MouseEvent) {
                      const ms = Math.round(Math.max(0, Math.min(ov.end_ms - 200, ((ev.clientX - rect!.left) / rect!.width) * duration)))
                      onOverlayUpdate?.(ov.id, { start_ms: ms })
                    }
                    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
                  }}>
                  <div style={{ width: 1.5, height: 12, borderRadius: 1, background: 'rgba(255,255,255,0.7)' }} />
                </div>
                {/* Right trim */}
                <div className="absolute right-0 inset-y-0 flex items-center justify-center cursor-col-resize z-10" style={{ width: 8 }}
                  onMouseDown={e => { e.stopPropagation()
                    const rect = trackRef.current?.getBoundingClientRect()
                    if (!rect) return
                    function move(ev: MouseEvent) {
                      const ms = Math.round(Math.max(ov.start_ms + 200, Math.min(duration, ((ev.clientX - rect!.left) / rect!.width) * duration)))
                      onOverlayUpdate?.(ov.id, { end_ms: ms })
                    }
                    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
                    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
                  }}>
                  <div style={{ width: 1.5, height: 12, borderRadius: 1, background: 'rgba(255,255,255,0.7)' }} />
                </div>
              </div>
            )
          })}
          <div className="absolute inset-y-0 pointer-events-none z-20" style={{ left: `${playheadPct}%`, width: 1, background: '#c8ff00', opacity: 0.7 }} />
        </div>
      )}

      {/* ── Main thumbnail track ───────────────────────────────────────── */}
      <div
        className="relative"
        style={{ height: 76, background: '#0a0a0a', borderRadius: '0 0 6px 6px', overflow: 'visible' }}
      >
        {/* Per-segment filmstrip blocks */}
        {sorted.map((seg, idx) => {
          const leftPct = (seg.start_ms / duration) * 100
          const widthPct = Math.max(((seg.end_ms - seg.start_ms) / duration) * 100, 0.3)
          const isActive = seg.id === activeSegmentId
          const broll = isBroll(seg)
          const color = broll ? '#f97316' : LAYOUT_COLORS[seg.layout]
          const isFirst = idx === 0
          const isLast = idx === sorted.length - 1
          const brollVideoId = broll ? (seg.crop_boxes[0]?.source_video_id ?? null) : null
          const brollUrl = brollVideoId ? (brollUrls?.[brollVideoId] ?? null) : null
          const thumbUrl = broll ? (brollUrl ?? '') : (videoUrl ?? '')
          // Determine the actual video file position for thumbnails.
          // B-roll: start from source_offset_ms (0 if not set), duration = segment length.
          // Pushed segment (Part B, video_offset_ms != null): actual video at clipStartMs + video_offset_ms.
          // Normal segment (Part A, video_offset_ms == null): actual video at clipStartMs + start_ms.
          const thumbStart = broll
            ? 0
            : seg.video_offset_ms != null
              ? (clipStartMs + seg.video_offset_ms) / 1000
              : (clipStartMs + seg.start_ms) / 1000
          const thumbEnd = broll
            ? (seg.end_ms - seg.start_ms) / 1000
            : seg.video_offset_ms != null
              ? (clipStartMs + seg.video_offset_ms + (seg.end_ms - seg.start_ms)) / 1000
              : (clipStartMs + seg.end_ms) / 1000

          const gapL = isFirst ? 0 : 3
          const gapR = isLast ? 0 : 3

          return (
            <div
              key={seg.id}
              className="absolute overflow-hidden cursor-pointer"
              style={{
                top: 4, bottom: 4,
                left: `calc(${leftPct}% + ${gapL}px)`,
                width: `calc(${widthPct}% - ${gapL + gapR}px)`,
                borderRadius: 8,
                border: isActive ? `2px solid ${color}` : '1.5px solid rgba(255,255,255,0.1)',
                boxShadow: isActive ? `0 0 0 1px ${color}55, 0 2px 8px rgba(0,0,0,0.5)` : '0 2px 8px rgba(0,0,0,0.4)',
                background: '#111',
                zIndex: 10,
              }}
              onClick={e => { e.stopPropagation(); onSelectSegment(seg.id) }}
            >
              {thumbUrl && <VideoThumbnails videoUrl={thumbUrl} startSec={thumbStart} endSec={thumbEnd} />}
              {!thumbUrl && <div className="absolute inset-0" style={{ background: 'rgba(40,40,40,0.8)' }} />}

              {/* Trim handles for active segment */}
              {isActive && <>
                <div className="absolute inset-y-0 left-0 z-30 flex items-center justify-center cursor-col-resize"
                  style={{ width: 12, background: `${color}cc`, borderRadius: '6px 0 0 6px' }}
                  onMouseDown={e => { e.stopPropagation(); handleBoundaryDrag(e, seg.id, 'left') }}>
                  <div style={{ width: 2, height: 18, borderRadius: 2, background: 'rgba(255,255,255,0.7)' }} />
                </div>
                <div className="absolute inset-y-0 right-0 z-30 flex items-center justify-center cursor-col-resize"
                  style={{ width: 12, background: `${color}cc`, borderRadius: '0 6px 6px 0' }}
                  onMouseDown={e => { e.stopPropagation(); handleBoundaryDrag(e, seg.id, 'right') }}>
                  <div style={{ width: 2, height: 18, borderRadius: 2, background: 'rgba(255,255,255,0.7)' }} />
                </div>
              </>}
            </div>
          )
        })}

        {/* "+" buttons at each junction */}
        {onInsertBrollAfter && sorted.slice(0, -1).map((seg) => {
          const posPct = (seg.end_ms / duration) * 100
          return (
            <button
              key={`plus-${seg.id}`}
              onMouseDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); onInsertBrollAfter(seg.id) }}
              title="Insert B-roll here"
              style={{
                position: 'absolute',
                left: `${posPct}%`, top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 34, height: 34,
                borderRadius: 10,
                background: 'rgba(50,50,52,0.96)',
                color: 'rgba(255,255,255,0.85)',
                border: '1.5px solid rgba(255,255,255,0.18)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', zIndex: 60,
                fontSize: 20, fontWeight: 300, lineHeight: 1, padding: 0,
                boxShadow: '0 2px 10px rgba(0,0,0,0.6)',
              }}
            >+</button>
          )
        })}

        {/* Playhead line */}
        <div className="absolute inset-y-0 pointer-events-none z-40"
          style={{ left: `${playheadPct}%`, width: 1.5, background: '#c8ff00', boxShadow: '0 0 6px rgba(200,255,0,0.8)' }} />
        {/* Playhead grab handle */}
        <div
          className="absolute z-50 flex items-center justify-center"
          style={{
            left: `${playheadPct}%`, top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 18, height: 28, borderRadius: 6,
            background: '#c8ff00', boxShadow: '0 0 8px rgba(200,255,0,0.7)',
            cursor: 'ew-resize',
          }}
          onMouseDown={e => { e.stopPropagation(); handleTrackDrag(e) }}
        >
          <div style={{ display: 'flex', gap: 2 }}>
            <div style={{ width: 1.5, height: 12, borderRadius: 1, background: 'rgba(255,255,255,0.7)' }} />
            <div style={{ width: 1.5, height: 12, borderRadius: 1, background: 'rgba(255,255,255,0.7)' }} />
          </div>
        </div>
        {/* Cut pill */}
        {onCut && (
          <button
            onMouseDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); onCut() }}
            style={{
              position: 'absolute', zIndex: 55,
              left: `${playheadPct}%`, bottom: -2,
              transform: 'translateX(-50%)',
              fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
              padding: '2px 7px', borderRadius: 999,
              background: '#c8ff00', color: '#000',
              border: 'none', cursor: 'pointer',
              boxShadow: '0 0 8px rgba(200,255,0,0.6)',
              pointerEvents: 'auto',
            }}
          >CUT</button>
        )}
      </div>

      {/* end unified drag area */}
      </div>

      {/* ── Text overlay tracks ────────────────────────────────────────── */}
      {textOverlays.length > 0 && (
        <div className="flex flex-col" style={{ gap: 2, marginTop: 6 }}>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-sm" style={{ background: '#8b5cf6' }} />
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Text</span>
            <span className="text-xs" style={{ color: 'rgba(255,255,255,0.15)' }}>· drag to move · edges to resize</span>
          </div>
          {textOverlays.map(o => {
            const left = (o.start_ms / duration) * 100
            const width = Math.max(((o.end_ms - o.start_ms) / duration) * 100, 1)
            const isActive = o.id === activeTextOverlayId
            return (
              <div key={o.id} className="relative select-none" style={{ height: 26, borderRadius: 5, background: 'rgba(255,255,255,0.02)' }}>
                <div className="absolute inset-y-0.5 flex items-center overflow-hidden"
                  style={{ left: `${left}%`, width: `${width}%`, borderRadius: 5, background: isActive ? '#7c3aed' : '#6d28d9aa', border: `1.5px solid ${isActive ? '#a78bfa' : '#8b5cf666'}`, cursor: 'grab', boxShadow: isActive ? '0 0 0 2px #8b5cf633' : 'none', minWidth: 6 }}
                  onMouseDown={e => handleTextOverlayBodyDrag(e, o.id, o.start_ms, o.end_ms)}
                  onClick={e => { e.stopPropagation(); onSelectTextOverlay?.(o.id) }}>
                  <div className="absolute left-0 inset-y-0 w-3 flex items-center justify-center cursor-col-resize z-10 shrink-0"
                    style={{ borderRadius: '5px 0 0 5px', background: 'rgba(0,0,0,0.25)' }}
                    onMouseDown={e => handleTextOverlayEdgeDrag(e, o.id, o.start_ms, o.end_ms, 'left')}>
                    <div style={{ width: 1.5, height: 10, borderRadius: 1, background: 'rgba(255,255,255,0.55)' }} />
                  </div>
                  <div className="absolute inset-0 flex items-center overflow-hidden pointer-events-none" style={{ padding: '0 14px' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{o.text}</span>
                  </div>
                  <div className="absolute right-0 inset-y-0 w-3 flex items-center justify-center cursor-col-resize z-10 shrink-0"
                    style={{ borderRadius: '0 5px 5px 0', background: 'rgba(0,0,0,0.25)' }}
                    onMouseDown={e => handleTextOverlayEdgeDrag(e, o.id, o.start_ms, o.end_ms, 'right')}>
                    <div style={{ width: 1.5, height: 10, borderRadius: 1, background: 'rgba(255,255,255,0.55)' }} />
                  </div>
                </div>
                <div className="absolute inset-y-0 w-px pointer-events-none z-30" style={{ left: `${playheadPct}%`, background: 'rgba(255,255,255,0.35)' }} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
