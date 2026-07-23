'use client'

import { useRef } from 'react'
import type { AudioTrack } from '@chai-cut/shared'

interface Props {
  tracks: AudioTrack[]
  onAddTrack: (file: File) => void
  onUpdateTrack: (id: string, updates: Partial<AudioTrack>) => void
  onRemoveTrack: (id: string) => void
}

export function AudioMixerPanel({ tracks, onAddTrack, onUpdateTrack, onRemoveTrack }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) onAddTrack(f)
    e.target.value = ''
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Audio Mixer
      </p>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <button
        onClick={() => fileInputRef.current?.click()}
        className="py-2 rounded-lg text-sm font-medium text-white"
        style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}
      >
        + Add background music
      </button>

      {tracks.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No audio tracks added.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {tracks.map(track => (
            <div key={track.id} className="flex flex-col gap-2 p-3 rounded-lg" style={{ background: 'var(--surface-2)' }}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white truncate">{track.storage_path.split('/').pop()}</span>
                <button
                  onClick={() => onRemoveTrack(track.id)}
                  className="text-xs shrink-0 ml-2"
                  style={{ color: 'var(--danger)' }}
                >
                  ✕
                </button>
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>Volume</span>
                  <span>{Math.round(track.volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={track.volume}
                  onChange={e => onUpdateTrack(track.id, { volume: Number(e.target.value) })}
                  className="accent-purple-500"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer text-xs text-white">
                <input
                  type="checkbox"
                  checked={track.duck_under_speech}
                  onChange={e => onUpdateTrack(track.id, { duck_under_speech: e.target.checked })}
                  className="accent-purple-500"
                />
                Duck under speech
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
