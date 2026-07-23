'use client'

import { useRef, useState } from 'react'
import type { Overlay } from '@chai-cut/shared'

interface Props {
  overlays: Overlay[]
  clipId: string
  currentTimeMs: number
  clipEndMs: number
  activeOverlayId: string | null
  onSelect: (id: string | null) => void
  onAdd: (overlay: Overlay) => void
  onUpdate: (id: string, updates: Partial<Overlay>) => void
  onRemove: (id: string) => void
}

function msToLabel(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function LayersPanel({
  overlays, clipId, currentTimeMs, clipEndMs,
  activeOverlayId, onSelect, onAdd, onUpdate, onRemove,
}: Props) {
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleImageUpload(file: File) {
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/overlays/upload', { method: 'POST', body: form })
      if (!res.ok) throw new Error('Upload failed')
      const { storage_path, preview_url } = await res.json()

      const overlay: Overlay = {
        id: crypto.randomUUID(),
        clip_id: clipId,
        type: 'image',
        storage_path,
        source_video_id: null,
        source_offset_ms: 0,
        x: 0.1, y: 0.1, w: 0.4, h: 0.3,
        start_ms: currentTimeMs,
        end_ms: Math.min(currentTimeMs + 5000, clipEndMs),
        z_index: overlays.length + 1,
        created_at: new Date().toISOString(),
        // store preview URL temporarily for the editor canvas
        ...(preview_url ? { _preview_url: preview_url } as unknown as Partial<Overlay> : {}),
      }
      onAdd(overlay)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* Upload button */}
      <button
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium disabled:opacity-50"
        style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px dashed rgba(124,58,237,0.3)' }}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M6 1v7M2 6l4-5 4 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        {uploading ? 'Uploading…' : '+ Add image overlay'}
      </button>
      <input
        ref={fileRef} type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleImageUpload(f); e.target.value = '' }}
      />

      {overlays.length === 0 && (
        <p className="text-xs text-center py-3" style={{ color: 'rgba(255,255,255,0.25)' }}>
          No overlays yet. Upload an image to place it on the video.
        </p>
      )}

      {[...overlays].sort((a, b) => b.z_index - a.z_index).map(ov => (
        <div
          key={ov.id}
          onClick={() => onSelect(ov.id === activeOverlayId ? null : ov.id)}
          className="rounded-lg cursor-pointer"
          style={{
            border: `1px solid ${ov.id === activeOverlayId ? 'rgba(124,58,237,0.5)' : 'rgba(255,255,255,0.07)'}`,
            background: ov.id === activeOverlayId ? 'rgba(124,58,237,0.08)' : 'transparent',
          }}
        >
          {/* Row */}
          <div className="flex items-center gap-2 px-2.5 py-2">
            <div className="w-8 h-8 rounded shrink-0 flex items-center justify-center" style={{ background: '#1e1e1e' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" opacity={0.5}>
                <rect x="1" y="1" width="12" height="12" rx="2" stroke="white" strokeWidth="1.2"/>
                <circle cx="5" cy="5" r="1.5" fill="white"/>
                <path d="M1 10l3.5-3 3 3 2-2 3 3" stroke="white" strokeWidth="1" strokeLinecap="round"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white">Image</p>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                {msToLabel(ov.start_ms)} → {msToLabel(ov.end_ms)}
              </p>
            </div>
            <button
              onClick={e => { e.stopPropagation(); onRemove(ov.id) }}
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ color: '#f87171', background: 'rgba(239,68,68,0.1)' }}
            >
              ✕
            </button>
          </div>

          {/* Expanded controls when selected */}
          {ov.id === activeOverlayId && (
            <div className="px-2.5 pb-2.5 flex flex-col gap-2" onClick={e => e.stopPropagation()}>
              <div className="flex gap-2">
                <label className="flex-1 flex flex-col gap-1">
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Start</span>
                  <input
                    type="range" min={0} max={clipEndMs} step={100}
                    value={ov.start_ms}
                    onChange={e => onUpdate(ov.id, { start_ms: Number(e.target.value) })}
                    className="w-full h-1 accent-purple-500"
                  />
                  <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>{msToLabel(ov.start_ms)}</span>
                </label>
                <label className="flex-1 flex flex-col gap-1">
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>End</span>
                  <input
                    type="range" min={0} max={clipEndMs} step={100}
                    value={ov.end_ms}
                    onChange={e => onUpdate(ov.id, { end_ms: Number(e.target.value) })}
                    className="w-full h-1 accent-purple-500"
                  />
                  <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>{msToLabel(ov.end_ms)}</span>
                </label>
              </div>
              <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>
                Drag the box on the preview to reposition it.
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
