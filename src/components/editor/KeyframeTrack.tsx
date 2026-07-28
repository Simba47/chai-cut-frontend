'use client'

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
  boxId,
  keyframes,
  clipStartMs,
  clipEndMs,
  currentTimeMs,
  onAddKeyframe,
  onRemoveKeyframe,
  onSeek,
}: Props) {
  const duration = clipEndMs - clipStartMs
  const playheadPct = duration > 0 ? (currentTimeMs / duration) * 100 : 0
  const hasKeyframeAtTime = keyframes.some(k => Math.abs(k.t_ms - currentTimeMs) < 50)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
          Keyframes — box {boxId.slice(-4)}
        </p>
        <button
          onClick={onAddKeyframe}
          className="text-xs px-2 py-0.5 rounded"
          style={{
            background: hasKeyframeAtTime ? 'var(--accent)' : 'var(--surface-2)',
            color: hasKeyframeAtTime ? '#fff' : 'var(--text-muted)',
          }}
          title="Add keyframe at current time"
        >
          {hasKeyframeAtTime ? '● Update' : '+ Keyframe'}
        </button>
      </div>

      <div className="relative h-6 rounded overflow-hidden cursor-pointer" style={{ background: 'var(--surface-2)' }}>
        {/* Playhead */}
        <div
          className="absolute inset-y-0 w-0.5 pointer-events-none z-10"
          style={{ left: `${playheadPct}%`, background: '#fff' }}
        />

        {/* Keyframe diamonds */}
        {keyframes.map(kf => {
          const pct = duration > 0 ? (kf.t_ms / duration) * 100 : 0
          return (
            <div
              key={kf.t_ms}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer group"
              style={{ left: `${pct}%` }}
              onClick={e => { e.stopPropagation(); onSeek(kf.t_ms) }}
              onContextMenu={e => { e.preventDefault(); onRemoveKeyframe(kf.t_ms) }}
              title={`${msToLabel(kf.t_ms)} — right-click to remove`}
            >
              <div
                className="w-2.5 h-2.5 rotate-45 group-hover:scale-125 transition-transform"
                style={{ background: 'var(--accent)' }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function msToLabel(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`
}
