'use client'

import { useState } from 'react'
import type { TextOverlay } from '@chai-cut/shared'
import { FontPicker, loadVideoFonts } from './CaptionStyler'

interface Props {
  overlays: TextOverlay[]
  currentTimeMs: number
  clipDurationMs: number
  onAdd: (overlay: Omit<TextOverlay, 'id' | 'clip_id'>) => void
  onUpdate: (id: string, updates: Partial<TextOverlay>) => void
  onRemove: (id: string) => void
}

export function TextOverlayPanel({ overlays, currentTimeMs, clipDurationMs, onAdd, onUpdate, onRemove }: Props) {
  const [newText, setNewText] = useState('')

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
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Text overlays
        <span className="ml-2 normal-case font-normal" style={{ color: 'rgba(255,255,255,0.2)', letterSpacing: 0 }}>
          — drag on preview to position · drag bar below to adjust timing
        </span>
      </p>

      {/* Add */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Type text and press Enter…"
          className="flex-1 px-3 py-2 rounded-lg text-sm text-white outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
        />
        <button
          onClick={handleAdd}
          disabled={!newText.trim()}
          className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-40"
          style={{ background: '#8b5cf6' }}
        >
          Add
        </button>
      </div>

      {/* List */}
      {overlays.length === 0 ? (
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>No text overlays yet. Type above and press Add.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {overlays.map(o => (
            <div
              key={o.id}
              className="flex flex-col gap-2 px-3 py-2.5 rounded-lg"
              style={{ background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}
            >
              {/* Row 1: color + text + size + delete */}
              <div className="flex items-center gap-2">
                <label style={{ position: 'relative', width: 22, height: 22, borderRadius: '50%', background: o.color ?? '#fff', flexShrink: 0, cursor: 'pointer', border: '2px solid rgba(255,255,255,0.15)' }}>
                  <input type="color" value={o.color ?? '#ffffff'} onChange={e => onUpdate(o.id, { color: e.target.value })}
                    style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
                </label>
                <input
                  type="text" value={o.text} onChange={e => onUpdate(o.id, { text: e.target.value })}
                  className="flex-1 bg-transparent text-sm text-white outline-none min-w-0"
                />
<button onClick={() => onRemove(o.id)} className="shrink-0 text-xs" style={{ color: '#ef4444' }}>✕</button>
              </div>

              {/* Row 2: font picker */}
              <FontPicker value={o.font ?? null} onChange={family => onUpdate(o.id, { font: family })} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
