'use client'

import { useEffect, useRef, useState } from 'react'
import type { TextOverlay } from '@chai-cut/shared'
import { FontPicker, loadVideoFonts } from './CaptionStyler'
import { EmptyState } from './EditorTour'
import { TimeRange } from './ItemTimeRange'

interface Props {
  overlays: TextOverlay[]
  currentTimeMs: number
  clipDurationMs: number
  onAdd: (overlay: Omit<TextOverlay, 'id' | 'clip_id'>) => void
  /** A text just added elsewhere (the timeline's "+"): its box takes focus with the words selected */
  focusId?: string | null
  onFocused?: () => void
  onUpdate: (id: string, updates: Partial<TextOverlay>) => void
  onRemove: (id: string) => void
  /** The text picked (on the timeline, the preview or here): its card opens its size and timing */
  selectedId?: string | null
  onSelect?: (id: string) => void
}

export function TextOverlayPanel({ overlays, currentTimeMs, clipDurationMs, onAdd, onUpdate, onRemove, focusId, onFocused, selectedId = null, onSelect }: Props) {
  const [newText, setNewText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!focusId) return
    const el = listRef.current?.querySelector<HTMLInputElement>(`[data-text-id="${focusId}"]`)
    if (!el) return
    el.focus(); el.select(); el.scrollIntoView({ block: 'nearest' })
    onFocused?.()
  }, [focusId, overlays, onFocused])
  // Picked on the timeline or the preview: bring its card into view
  useEffect(() => {
    if (selectedId) listRef.current?.querySelector(`[data-text-card="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // Ensure fonts are loaded
  useState(() => { loadVideoFonts() })

  function handleAdd() {
    if (!newText.trim()) return
    onAdd({
      text: newText.trim(),
      start_ms: Math.round(currentTimeMs),
      end_ms: Math.round(Math.min(currentTimeMs + 3000, clipDurationMs)),
      x: 0.1,
      y: 0.4,
      font: 'sans-serif',
      size: 72,
      color: '#ffffff',
    })
    setNewText('')
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Text appears at the playhead for 3 seconds. Drag it on the preview to position it, and drag its bar on the timeline to change timing.
      </p>

      {/* Add */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Type text and press Enter…"
          className="flex-1 px-3 py-2 rounded-lg text-sm text-[var(--ed-text)] outline-none"
          style={{ background: 'rgb(var(--ed-fg) / 0.06)', border: '1px solid rgb(var(--ed-fg) / 0.1)' }}
        />
        <button
          onClick={handleAdd}
          disabled={!newText.trim()}
          className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: '#000' }}
        >
          Add
        </button>
      </div>

      {/* List */}
      {overlays.length === 0 ? (
        <EmptyState icon={<path d="M4 7V5h16v2M9 19h6M12 5v14" />} title="No text yet"
          tip="Type above and press Add. Your text appears at the playhead — drag it on the timeline to set when it shows." />
      ) : (
        <div ref={listRef} className="flex flex-col gap-2">
          {overlays.map(o => {
            const on = o.id === selectedId
            const size = o.size ?? 72
            return (
            <div
              key={o.id}
              data-text-card={o.id}
              onPointerDown={() => { if (!on) onSelect?.(o.id) }}
              className="flex flex-col gap-2 px-3 py-2.5 rounded-lg"
              style={{ background: `rgb(var(--ed-fg) / ${on ? 0.07 : 0.04})`, border: `1px solid ${on ? '#f472b6' : 'rgb(var(--ed-fg) / 0.08)'}` }}
            >
              {/* Row 1: color + text + size + delete */}
              <div className="flex items-center gap-2">
                <label style={{ position: 'relative', width: 22, height: 22, borderRadius: '50%', background: o.color ?? '#fff', flexShrink: 0, cursor: 'pointer', border: '2px solid rgb(var(--ed-fg) / 0.15)' }}>
                  <input type="color" value={o.color ?? '#ffffff'} onChange={e => onUpdate(o.id, { color: e.target.value })}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                </label>
                <input
                  type="text" value={o.text} onChange={e => onUpdate(o.id, { text: e.target.value })} data-text-id={o.id}
                  className="flex-1 bg-transparent text-sm text-[var(--ed-text)] outline-none min-w-0"
                />
                <button onClick={() => onRemove(o.id)} aria-label="Remove text" title="Remove text" className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md text-xs transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>✕</button>
              </div>

              {/* Row 2: font picker */}
              <FontPicker value={o.font ?? null} onChange={family => onUpdate(o.id, { font: family })} />

              {/* Selected: size and when it shows */}
              {on && (
                <>
                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between text-[11px] font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                      <span>Size</span><span className="tabular-nums">{size}</span>
                    </div>
                    <input type="range" min={24} max={160} step={2} value={size} aria-label="Text size"
                      onChange={e => onUpdate(o.id, { size: Number(e.target.value) })}
                      className="ed-zoom-range w-full" style={{ '--p': `${((size - 24) / 136) * 100}%` } as React.CSSProperties} />
                  </div>
                  <TimeRange startMs={o.start_ms} endMs={o.end_ms} currentTimeMs={currentTimeMs}
                    onStart={ms => onUpdate(o.id, { start_ms: Math.round(Math.max(0, Math.min(o.end_ms - 200, ms))) })}
                    onEnd={ms => onUpdate(o.id, { end_ms: Math.round(Math.min(clipDurationMs, Math.max(o.start_ms + 200, ms))) })} />
                </>
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
