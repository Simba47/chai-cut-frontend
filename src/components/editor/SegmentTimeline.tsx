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
  safeDurationMs?: number
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
  safeDurationMs,
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
  const duration = (clipEndMs - clipStartMs) || safeDurationMs || 0

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

  const thumbDuration = safeDurationMs && safeDurationMs > duration ? safeDurationMs : duration

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
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M5 10L0 0h10z" fill="#00b4d8"/></svg>
        </div>
        {/* Playhead line */}
        <div className="absolute inset-y-0 pointer-events-none z-10" style={{ left: `${playheadPct}%`, width: 1, background: '#00b4d8', opacity: 0.6 }} />
      </div>

      {/* ── Segment color band ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden select-none" style={{ height: 8 }}>
        {sorted.map(seg => {
          const left = (seg.start_ms / duration) * 100
          const width = ((seg.end_ms - seg.start_ms) / duration) * 100
          const broll = isBroll(seg)
          const color = broll ? '#f97316' : LAYOUT_COLORS[seg.layout]
          const isActive = seg.id === activeSegmentId
          return (
            <div key={seg.id} className="absolute inset-y-0 cursor-pointer"
              style={{ left: `${left}%`, width: `${width}%`, background: color, opacity: isActive ? 1 : 0.55, borderRight: '1px solid rgba(0,0,0,0.5)' }}
              onClick={e => { e.stopPropagation(); onSelectSegment(seg.id) }}
            />
          )
        })}
        <div className="absolute inset-y-0 pointer-events-none z-10" style={{ left: `${playheadPct}%`, width: 1, background: '#00b4d8' }} />
      </div>

      {/* ── Main thumbnail track ───────────────────────────────────────── */}
      <div
        className="relative overflow-hidden"
        style={{ height: 76, background: '#111', borderRadius: '0 0 6px 6px' }}
      >
        {videoUrl && thumbDuration > 0
          ? <VideoThumbnails videoUrl={videoUrl} durationMs={thumbDuration} />
          : <div className="absolute inset-0" style={{ background: '#1a1a1a' }} />
        }

        {/* Segment boundary dividers */}
        {sorted.map((seg, idx) => {
          if (idx === 0) return null
          const leftPct = (seg.start_ms / duration) * 100
          return <div key={seg.id} className="absolute inset-y-0 pointer-events-none z-10" style={{ left: `${leftPct}%`, width: 1, background: 'rgba(255,255,255,0.25)' }} />
        })}

        {/* Active segment — colored border highlight + trim handles */}
        {sorted.map(seg => {
          if (seg.id !== activeSegmentId) return null
          const broll = isBroll(seg)
          const color = broll ? '#f97316' : LAYOUT_COLORS[seg.layout]
          const leftPct = (seg.start_ms / duration) * 100
          const rightPct = (seg.end_ms / duration) * 100
          const widthPct = rightPct - leftPct
          return (
            <div key={seg.id}>
              {/* Inset border highlight */}
              <div className="absolute inset-y-0 pointer-events-none z-20"
                style={{ left: `${leftPct}%`, width: `${widthPct}%`, boxShadow: `inset 0 0 0 2px ${color}` }} />
              {/* Left trim handle */}
              <div className="absolute inset-y-0 z-30 flex items-center justify-center cursor-col-resize"
                style={{ left: `${leftPct}%`, width: 12, background: `${color}ee`, borderRadius: '4px 0 0 4px' }}
                onMouseDown={e => handleBoundaryDrag(e, seg.id, 'left')}>
                <div style={{ width: 2, height: 22, borderRadius: 2, background: 'rgba(255,255,255,0.6)' }} />
              </div>
              {/* Right trim handle */}
              <div className="absolute inset-y-0 z-30 flex items-center justify-center cursor-col-resize"
                style={{ left: `${rightPct}%`, width: 12, transform: 'translateX(-100%)', background: `${color}ee`, borderRadius: '0 4px 4px 0' }}
                onMouseDown={e => handleBoundaryDrag(e, seg.id, 'right')}>
                <div style={{ width: 2, height: 22, borderRadius: 2, background: 'rgba(255,255,255,0.6)' }} />
              </div>
            </div>
          )
        })}

        {/* Playhead line */}
        <div className="absolute inset-y-0 pointer-events-none z-30"
          style={{ left: `${playheadPct}%`, width: 1.5, background: '#00b4d8', boxShadow: '0 0 6px rgba(0,180,216,0.8)' }} />
        {/* Playhead grab handle — visible pill, draggable */}
        <div
          className="absolute z-40 flex items-center justify-center"
          style={{
            left: `${playheadPct}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: 18,
            height: 28,
            borderRadius: 6,
            background: '#00b4d8',
            boxShadow: '0 0 8px rgba(0,180,216,0.7)',
            cursor: 'ew-resize',
          }}
          onMouseDown={e => { e.stopPropagation(); handleTrackDrag(e) }}
        >
          <div style={{ display: 'flex', gap: 2 }}>
            <div style={{ width: 1.5, height: 12, borderRadius: 1, background: 'rgba(255,255,255,0.7)' }} />
            <div style={{ width: 1.5, height: 12, borderRadius: 1, background: 'rgba(255,255,255,0.7)' }} />
          </div>
        </div>
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
