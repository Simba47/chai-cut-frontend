'use client'

import { useRef, useState, useEffect } from 'react'
import type { SegmentLocal, LayoutType, TextOverlay } from '@chai-cut/shared'

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
const THUMB_COUNT = 24

function VideoThumbnails({ videoUrl, durationMs }: { videoUrl: string; durationMs: number }) {
  const [thumbs, setThumbs] = useState<string[]>([])

  useEffect(() => {
    if (!videoUrl || durationMs < 1000) return
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

    async function capture(i: number) {
      if (cancelled) return
      const targetSec = ((i + 0.5) / THUMB_COUNT) * (durationMs / 1000)
      vid.currentTime = targetSec
      await new Promise<void>(r => {
        if (Math.abs(vid.currentTime - targetSec) < 0.05 && vid.readyState >= 2) { r(); return }
        const tid = setTimeout(r, 3000)
        vid.addEventListener('seeked', () => { clearTimeout(tid); r() }, { once: true })
      })
      if (cancelled) return
      try { ctx.drawImage(vid, 0, 0, THUMB_W, THUMB_H) } catch { return }
      const dataUrl = canvas.toDataURL('image/jpeg', 0.5)
      setThumbs(prev => { const next = [...prev]; next[i] = dataUrl; return next })
      if (i + 1 < THUMB_COUNT) capture(i + 1)
    }

    function start() { if (!cancelled) capture(0) }
    if (vid.readyState >= 1) { start() }
    else { vid.addEventListener('loadedmetadata', start, { once: true }) }
    return () => { cancelled = true; vid.src = ''; vid.load() }
  }, [videoUrl, durationMs])

  return (
    <div className="absolute inset-0 flex overflow-hidden" style={{ borderRadius: 8 }}>
      {Array.from({ length: THUMB_COUNT }).map((_, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
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


interface Props {
  segments: SegmentLocal[]
  clipStartMs: number
  clipEndMs: number
  currentTimeMs: number
  activeSegmentId: string | null
  videoUrl?: string
  onSeek: (ms: number) => void
  onSelectSegment: (id: string) => void
  onUpdateSegment: (id: string, updates: { start_ms?: number; end_ms?: number }) => void
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
  onSeek,
  onSelectSegment,
  onUpdateSegment,
  onInsertBrollAfter,
  textOverlays = [],
  activeTextOverlayId,
  onSelectTextOverlay,
  onTextOverlayUpdate,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const duration = clipEndMs - clipStartMs

  function pxToMs(px: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return 0
    return (px / rect.width) * duration  // 0-based, no clipStartMs offset
  }

  function handleTrackClick(e: React.MouseEvent) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onSeek(pxToMs(e.clientX - rect.left))
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

  // Segments and currentTimeMs are both 0-based (clip-relative), so no clipStartMs offset needed.
  const playheadPct = duration > 0 ? (currentTimeMs / duration) * 100 : 0

  const sorted = [...segments].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="flex flex-col gap-1.5">
      {/* Legend row */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#22c55e' }} />
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Main</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: '#f97316' }} />
          <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>B-roll</span>
        </div>
        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>
          drag edges to trim · click to select
        </span>
      </div>


      {/* ── Main track ─────────────────────────────────────────────────── */}
      <div
        ref={trackRef}
        className="relative select-none"
        style={{ height: 64, cursor: 'pointer' }}
        onClick={handleTrackClick}
      >
        {/* Track background — thumbnails when available, flat fill otherwise */}
        {videoUrl && duration > 0
          ? <VideoThumbnails videoUrl={videoUrl} durationMs={duration} />
          : <div className="absolute inset-0 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }} />
        }

        {/* Segment blocks */}
        {sorted.map((seg, idx) => {
          const left = (seg.start_ms / duration) * 100
          const width = ((seg.end_ms - seg.start_ms) / duration) * 100
          const broll = isBroll(seg)
          const color = broll ? '#f97316' : LAYOUT_COLORS[seg.layout]
          const isActive = seg.id === activeSegmentId
          const segDur = seg.end_ms - seg.start_ms

          // Check if there's an adjacent segment after this one
          const nextSeg = sorted[idx + 1]
          const hasGapAfter = nextSeg && nextSeg.start_ms > seg.end_ms
          const gapLeftPct = (seg.end_ms / duration) * 100
          const gapWidthPct = ((nextSeg?.start_ms ?? seg.end_ms) - seg.end_ms) / duration * 100
          const isAdjacentToNext = nextSeg && Math.abs(nextSeg.start_ms - seg.end_ms) < 200

          return (
            <div key={seg.id}>
              {/* Clip block — semi-transparent so video frames show through */}
              <div
                className="absolute inset-y-0 flex items-center overflow-hidden cursor-pointer"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  borderRadius: 0,
                  background: broll ? `${color}22` : `${color}18`,
                  borderTop: `3px solid ${isActive ? color : color + 'aa'}`,
                  borderBottom: `3px solid ${isActive ? color : color + 'aa'}`,
                  borderLeft: `3px solid ${isActive ? color : color + 'aa'}`,
                  borderRight: `3px solid ${isActive ? color : color + 'aa'}`,
                  boxShadow: isActive ? `inset 0 0 0 1px ${color}44` : 'none',
                  transition: 'box-shadow 0.1s',
                }}
                onClick={e => { e.stopPropagation(); onSelectSegment(seg.id) }}
              >
                {/* Left trim handle */}
                <div
                  className="absolute left-0 inset-y-0 w-2.5 flex items-center justify-center cursor-col-resize z-10"
                  style={{ background: `${color}cc`, borderRadius: '6px 0 0 6px' }}
                  onMouseDown={e => handleBoundaryDrag(e, seg.id, 'left')}
                >
                  <div className="w-0.5 h-4 rounded-full" style={{ background: 'rgba(255,255,255,0.4)' }} />
                </div>

                {/* Label */}
                <div className="flex items-center gap-1.5 px-4 min-w-0 pointer-events-none overflow-hidden">
                  {broll ? (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="shrink-0 opacity-80">
                      <rect x="0.5" y="0.5" width="9" height="9" rx="1.5" stroke="white" strokeOpacity="0.9"/>
                      <path d="M0.5 3.5h9M0.5 6.5h9M3.5 0.5v9M6.5 0.5v9" stroke="white" strokeOpacity="0.6" strokeWidth="0.8"/>
                    </svg>
                  ) : (
                    <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0 opacity-60">
                      <path d="M2 1l5.5 3.5L2 8V1z" fill="white"/>
                    </svg>
                  )}
                  <span className="text-xs font-semibold text-white truncate" style={{ opacity: 0.95 }}>
                    {broll ? 'B-roll' : seg.layout}
                  </span>
                  {segDur > 2000 && (
                    <span className="text-xs text-white/50 shrink-0">{msToLabel(segDur)}</span>
                  )}
                </div>

                {/* Right trim handle */}
                <div
                  className="absolute right-0 inset-y-0 w-2.5 flex items-center justify-center cursor-col-resize z-10"
                  style={{ background: `${color}cc`, borderRadius: '0 6px 6px 0' }}
                  onMouseDown={e => handleBoundaryDrag(e, seg.id, 'right')}
                >
                  <div className="w-0.5 h-4 rounded-full" style={{ background: 'rgba(255,255,255,0.4)' }} />
                </div>
              </div>


              {/* Gap indicator (if segments aren't adjacent) */}
              {hasGapAfter && !isAdjacentToNext && (
                <div
                  className="absolute inset-y-1 flex items-center justify-center"
                  style={{
                    left: `${gapLeftPct}%`,
                    width: `${gapWidthPct}%`,
                    background: 'repeating-linear-gradient(45deg, rgba(255,255,255,0.03), rgba(255,255,255,0.03) 4px, transparent 4px, transparent 8px)',
                    border: '1px dashed rgba(255,255,255,0.1)',
                    borderRadius: 4,
                    pointerEvents: 'none',
                  }}
                />
              )}
            </div>
          )
        })}

        {/* Playhead */}
        <div
          className="absolute inset-y-0 w-px pointer-events-none z-30"
          style={{ left: `${playheadPct}%`, background: 'rgba(255,255,255,0.85)' }}
        >
          <div
            className="absolute w-3 h-3 rounded-full"
            style={{
              top: -1,
              left: '50%',
              transform: 'translateX(-50%)',
              background: '#fff',
              boxShadow: '0 0 0 2px rgba(255,255,255,0.25)',
            }}
          />
          <div
            className="absolute w-2 h-2 rotate-45"
            style={{
              bottom: -1,
              left: '50%',
              transform: 'translateX(-50%) rotate(45deg)',
              background: '#fff',
            }}
          />
        </div>
      </div>

      {/* Time ruler */}
      <div className="flex justify-between">
        <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.2)' }}>{msToLabel(clipStartMs)}</span>
        <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.35)' }}>{msToLabel(currentTimeMs)}</span>
        <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.2)' }}>{msToLabel(clipEndMs)}</span>
      </div>

      {/* ── Text overlay tracks — one row per clip ─────────────────────── */}
      {textOverlays.length > 0 && (
        <div className="flex flex-col" style={{ gap: 2, marginTop: 2 }}>
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
              <div
                key={o.id}
                className="relative select-none"
                style={{ height: 26, borderRadius: 5, background: 'rgba(255,255,255,0.02)' }}
              >
                {/* Clip bar */}
                <div
                  className="absolute inset-y-0.5 flex items-center overflow-hidden"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    borderRadius: 5,
                    background: isActive ? '#7c3aed' : '#6d28d9aa',
                    border: `1.5px solid ${isActive ? '#a78bfa' : '#8b5cf666'}`,
                    cursor: 'grab',
                    boxShadow: isActive ? '0 0 0 2px #8b5cf633' : 'none',
                    minWidth: 6,
                  }}
                  onMouseDown={e => handleTextOverlayBodyDrag(e, o.id, o.start_ms, o.end_ms)}
                  onClick={e => { e.stopPropagation(); onSelectTextOverlay?.(o.id) }}
                >
                  {/* Left handle */}
                  <div
                    className="absolute left-0 inset-y-0 w-3 flex items-center justify-center cursor-col-resize z-10 shrink-0"
                    style={{ borderRadius: '5px 0 0 5px', background: 'rgba(0,0,0,0.25)' }}
                    onMouseDown={e => handleTextOverlayEdgeDrag(e, o.id, o.start_ms, o.end_ms, 'left')}
                  >
                    <div style={{ width: 1.5, height: 10, borderRadius: 1, background: 'rgba(255,255,255,0.55)' }} />
                  </div>

                  {/* Label */}
                  <div className="absolute inset-0 flex items-center overflow-hidden pointer-events-none" style={{ padding: '0 14px' }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.92)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {o.text}
                    </span>
                  </div>

                  {/* Right handle */}
                  <div
                    className="absolute right-0 inset-y-0 w-3 flex items-center justify-center cursor-col-resize z-10 shrink-0"
                    style={{ borderRadius: '0 5px 5px 0', background: 'rgba(0,0,0,0.25)' }}
                    onMouseDown={e => handleTextOverlayEdgeDrag(e, o.id, o.start_ms, o.end_ms, 'right')}
                  >
                    <div style={{ width: 1.5, height: 10, borderRadius: 1, background: 'rgba(255,255,255,0.55)' }} />
                  </div>
                </div>

                {/* Playhead */}
                <div
                  className="absolute inset-y-0 w-px pointer-events-none z-30"
                  style={{ left: `${playheadPct}%`, background: 'rgba(255,255,255,0.35)' }}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
