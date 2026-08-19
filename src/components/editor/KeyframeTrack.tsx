'use client'

import { useState, useRef } from 'react'
import type { BoxKeyframe } from '@chai-cut/shared'

interface Props {
  boxId: string
  keyframes: BoxKeyframe[]
  clipStartMs: number
  clipEndMs: number
  currentTimeMs: number
  onAddKeyframe: () => void
  onRemoveKeyframe: (t_ms: number) => void
  onSeek: (ms: number) => void
}

export function KeyframeTrack({
  keyframes,
  clipStartMs,
  clipEndMs,
  currentTimeMs,
  onAddKeyframe,
  onRemoveKeyframe,
  onSeek,
}: Props) {
  const duration = clipEndMs - clipStartMs
  const sorted = [...keyframes].sort((a, b) => a.t_ms - b.t_ms)
  const playheadPct = duration > 0 ? Math.min(100, (currentTimeMs / duration) * 100) : 0
  const hasKeyframeAtTime = keyframes.some(k => Math.abs(k.t_ms - currentTimeMs) < 80)

  const [selectedMs, setSelectedMs] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  function handleTrackClick(e: React.MouseEvent) {
    if (!trackRef.current || duration <= 0) return
    const { left, width } = trackRef.current.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - left) / width))
    onSeek(Math.round(pct * duration))
  }

  function handleDiamondClick(e: React.MouseEvent, t_ms: number) {
    e.stopPropagation()
    setSelectedMs(prev => prev === t_ms ? null : t_ms)
    onSeek(t_ms)
  }

  function handleDelete(e: React.MouseEvent, t_ms: number) {
    e.stopPropagation()
    onRemoveKeyframe(t_ms)
    setSelectedMs(null)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.3)' }}>
            Keyframes
          </span>
          {sorted.length > 0 && (
            <span className="text-xs tabular-nums px-1.5 py-0.5 rounded-md"
              style={{ background: 'rgba(200,255,0,0.12)', color: '#c8ff00', fontSize: 10 }}>
              {sorted.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {sorted.length > 1 && (
            <button
              onClick={() => { sorted.forEach(kf => onRemoveKeyframe(kf.t_ms)); setSelectedMs(null) }}
              className="text-xs px-2 py-0.5 rounded"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171' }}
            >
              Clear all
            </button>
          )}
          <button
            onClick={onAddKeyframe}
            className="text-xs px-2 py-0.5 rounded"
            style={{
              background: hasKeyframeAtTime ? 'rgba(200,255,0,0.18)' : 'rgba(255,255,255,0.07)',
              color: hasKeyframeAtTime ? '#c8ff00' : 'rgba(255,255,255,0.4)',
            }}
          >
            {hasKeyframeAtTime ? '● here' : '+ Add'}
          </button>
        </div>
      </div>

      {/* Track */}
      <div style={{ position: 'relative', paddingBottom: selectedMs !== null ? 28 : 0, transition: 'padding-bottom 0.15s' }}>
        <div
          ref={trackRef}
          className="relative rounded-lg cursor-crosshair"
          style={{ height: 40, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}
          onClick={handleTrackClick}
        >
          {/* Filled range between first and last keyframe */}
          {sorted.length >= 2 && (
            <div
              className="absolute inset-y-0 pointer-events-none"
              style={{
                left: `${(sorted[0].t_ms / duration) * 100}%`,
                right: `${100 - (sorted[sorted.length - 1].t_ms / duration) * 100}%`,
                background: 'rgba(200,255,0,0.08)',
                borderLeft: '1px solid rgba(200,255,0,0.2)',
                borderRight: '1px solid rgba(200,255,0,0.2)',
              }}
            />
          )}

          {/* Diamonds */}
          {sorted.map(kf => {
            const pct = duration > 0 ? (kf.t_ms / duration) * 100 : 0
            const isSelected = selectedMs === kf.t_ms
            const isAtCursor = Math.abs(kf.t_ms - currentTimeMs) < 80
            return (
              <div
                key={kf.t_ms}
                className="absolute top-1/2 flex items-center justify-center"
                style={{
                  left: `${pct}%`,
                  transform: 'translate(-50%, -50%)',
                  width: 32,
                  height: 40,
                  zIndex: isSelected ? 20 : 2,
                  cursor: 'pointer',
                }}
                onClick={e => handleDiamondClick(e, kf.t_ms)}
              >
                {/* Diamond shape */}
                <div
                  style={{
                    width: 18,
                    height: 18,
                    transform: 'rotate(45deg)',
                    background: isSelected
                      ? '#facc15'
                      : isAtCursor
                        ? '#fff'
                        : 'rgba(200,255,0,0.85)',
                    border: isSelected
                      ? '2px solid #fde68a'
                      : '2px solid rgba(200,255,0,0.4)',
                    boxShadow: isSelected
                      ? '0 0 8px #facc15, 0 0 2px #facc15'
                      : isAtCursor
                        ? '0 0 6px rgba(255,255,255,0.6)'
                        : '0 0 4px rgba(200,255,0,0.4)',
                    transition: 'all 0.12s',
                    flexShrink: 0,
                  }}
                />
              </div>
            )
          })}

          {/* Playhead */}
          <div
            className="absolute inset-y-0 pointer-events-none"
            style={{ left: `${playheadPct}%`, width: 1.5, background: 'rgba(255,255,255,0.6)', zIndex: 10 }}
          />
        </div>

        {/* Delete bar — slides in below when a diamond is selected */}
        {selectedMs !== null && (
          <div
            className="absolute left-0 right-0 flex items-center justify-between px-3 rounded-b-lg"
            style={{
              top: 40,
              height: 28,
              background: 'rgba(250,204,21,0.1)',
              border: '1px solid rgba(250,204,21,0.25)',
              borderTop: 'none',
            }}
          >
            <span className="text-xs tabular-nums" style={{ color: '#facc15', fontSize: 10 }}>
              {msToLabel(selectedMs)}
            </span>
            <button
              className="text-xs px-2 py-0.5 rounded flex items-center gap-1"
              style={{ background: 'rgba(239,68,68,0.2)', color: '#f87171', fontWeight: 600 }}
              onClick={e => handleDelete(e, selectedMs)}
            >
              × Delete
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function msToLabel(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}
