'use client'

import { useEffect, useRef } from 'react'
import type { Overlay } from '@chai-cut/shared'
import { EmptyState } from './EditorTour'
import { TimeRange } from './ItemTimeRange'

const muted = (a: number) => `rgb(var(--ed-fg) / ${a})`
const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 100) / 10); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }
const SIZES = [{ label: 'Full', s: 1 }, { label: 'Large', s: 0.8 }, { label: 'Medium', s: 0.6 }, { label: 'Small', s: 0.4 }]
const MIN_MS = 200

/**
 * Photos shown over the clip: one row per photo. The selected one (picked here, on the timeline's
 * Photos lane or on the preview) opens its settings: size, where it sits, when it shows, layer.
 */
export function PhotoPanel({ photos, selectedId, currentTimeMs, clipLengthMs, onSelect, onAdd, onUpdate, onRemove, onSeek }: {
  photos: Overlay[]
  selectedId: string | null
  currentTimeMs: number
  clipLengthMs: number
  onSelect: (id: string) => void
  onAdd: () => void
  onUpdate: (id: string, patch: Partial<Overlay>) => void
  onRemove: (id: string) => void
  onSeek: (ms: number) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectedId) listRef.current?.querySelector(`[data-photo-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  const topZ = Math.max(0, ...photos.map(p => p.z_index))

  return (
    <div className="flex flex-col gap-3 p-4">
      <button onClick={onAdd}
        className="py-2 rounded-lg text-sm font-medium text-[var(--ed-text)] transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]"
        style={{ background: muted(0.04), border: `1px dashed ${muted(0.2)}` }}>
        + Add a photo at {fmt(currentTimeMs)}
      </button>

      {photos.length === 0 ? (
        <EmptyState icon={<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>}
          title="No photos yet" tip="Add a photo above, or with the + beside the timeline. It shows on its own lane under the video." />
      ) : (
        <div ref={listRef} className="flex flex-col gap-2">
          {[...photos].sort((a, b) => a.start_ms - b.start_ms).map((p, i) => {
            const on = p.id === selectedId
            const size = Math.round(Math.max(p.w, p.h) * 100)
            // Resize around the photo's centre, staying inside the frame
            const resize = (s: number) => {
              const cx = p.x + p.w / 2, cy = p.y + p.h / 2
              onUpdate(p.id, { w: s, h: s, x: Math.max(0, Math.min(1 - s, cx - s / 2)), y: Math.max(0, Math.min(1 - s, cy - s / 2)) })
            }
            const place = (axis: 'x' | 'y', where: 0 | 0.5 | 1) => {
              const len = axis === 'x' ? p.w : p.h
              const edge = len >= 1 ? 0 : 0.04
              onUpdate(p.id, { [axis]: where === 0.5 ? (1 - len) / 2 : where === 0 ? Math.min(edge, 1 - len) : Math.max(0, 1 - len - edge) })
            }
            return (
              <div key={p.id} data-photo-id={p.id} className="flex flex-col rounded-lg overflow-hidden"
                style={{ background: muted(on ? 0.07 : 0.04), boxShadow: on ? 'inset 0 0 0 1.5px #60a5fa' : `inset 0 0 0 1px ${muted(0.08)}` }}>
                <div role="button" tabIndex={0} aria-pressed={on}
                  onClick={() => { onSelect(p.id); onSeek(p.start_ms) }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(p.id); onSeek(p.start_ms) } }}
                  className="flex items-center gap-2.5 px-2 py-2 cursor-pointer">
                  {p.preview_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={p.preview_url} alt="" className="w-10 h-10 rounded-md object-cover shrink-0" />
                    : <span className="w-10 h-10 rounded-md shrink-0" style={{ background: muted(0.1) }} />}
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[13px] font-medium text-[var(--ed-text)]">Photo {i + 1}</span>
                    <span className="text-[11px] tabular-nums" style={{ color: muted(0.5) }}>{fmt(p.start_ms)} → {fmt(p.end_ms)}</span>
                  </span>
                  <button onClick={e => { e.stopPropagation(); onRemove(p.id) }} aria-label="Remove photo" title="Remove photo"
                    className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-xs transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                    style={{ color: muted(0.5) }}>✕</button>
                </div>

                {on && (
                  <div className="flex flex-col gap-3 px-3 pb-3 pt-1" style={{ borderTop: `1px solid ${muted(0.07)}` }}>
                    <div className="flex flex-col gap-1.5">
                      <div className="flex justify-between text-[11px] font-medium" style={{ color: muted(0.5) }}>
                        <span>Size</span><span className="tabular-nums">{size}%</span>
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {SIZES.map(z => (
                          <button key={z.label} onClick={() => resize(z.s)}
                            className="h-7 rounded-md text-[11px] font-semibold transition-colors"
                            style={Math.abs(size / 100 - z.s) < 0.01
                              ? { background: muted(0.14), color: 'var(--ed-text)' }
                              : { color: muted(0.6), boxShadow: `inset 0 0 0 1px ${muted(0.12)}` }}>
                            {z.label}
                          </button>
                        ))}
                      </div>
                      <input type="range" min={15} max={100} step={1} value={size} aria-label="Photo size"
                        onChange={e => resize(Number(e.target.value) / 100)}
                        className="ed-zoom-range w-full" style={{ '--p': `${((size - 15) / 85) * 100}%` } as React.CSSProperties} />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <span className="text-[11px] font-medium" style={{ color: muted(0.5) }}>Position</span>
                      <div className="grid grid-cols-3 gap-1">
                        {([['Top', 'y', 0], ['Middle', 'y', 0.5], ['Bottom', 'y', 1], ['Left', 'x', 0], ['Centre', 'x', 0.5], ['Right', 'x', 1]] as const).map(([label, axis, where]) => (
                          <button key={label} onClick={() => place(axis, where)}
                            className="h-7 rounded-md text-[11px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]"
                            style={{ color: muted(0.7), boxShadow: `inset 0 0 0 1px ${muted(0.12)}` }}>
                            {label}
                          </button>
                        ))}
                      </div>
                      <span className="text-[10px]" style={{ color: muted(0.4) }}>Or drag it on the preview; its corners resize it</span>
                    </div>

                    <TimeRange startMs={p.start_ms} endMs={p.end_ms} currentTimeMs={currentTimeMs}
                      onStart={ms => onUpdate(p.id, { start_ms: Math.round(Math.max(0, Math.min(p.end_ms - MIN_MS, ms))) })}
                      onEnd={ms => onUpdate(p.id, { end_ms: Math.round(Math.min(clipLengthMs, Math.max(p.start_ms + MIN_MS, ms))) })} />

                    <button onClick={() => onUpdate(p.id, { z_index: topZ + 1 })} disabled={photos.length < 2 || p.z_index >= topZ}
                      className="h-7 rounded-md text-[11px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)] disabled:opacity-40 disabled:hover:bg-transparent"
                      style={{ color: muted(0.7), boxShadow: `inset 0 0 0 1px ${muted(0.12)}` }}>
                      Bring to front
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
