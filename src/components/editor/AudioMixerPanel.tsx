'use client'

import { useEffect, useRef } from 'react'
import type { AudioTrack } from '@chai-cut/shared'
import { EmptyState } from './EditorTour'
import { TimeRange } from './ItemTimeRange'

interface Props {
  tracks: AudioTrack[]
  onAddTrack: (file: File) => void
  onUpdateTrack: (id: string, updates: Partial<AudioTrack>) => void
  onRemoveTrack: (id: string) => void
  /** The track picked on the timeline (or here): highlighted, with its timing */
  selectedId?: string | null
  onSelect?: (id: string) => void
  currentTimeMs?: number
  clipLengthMs?: number
  /** Each song's full length (ms), once known */
  durations?: Record<string, number>
  /** The name shown for a track (default: its file name) */
  nameOf?: (track: AudioTrack) => string
}

export function AudioMixerPanel({ tracks, onAddTrack, onUpdateTrack, onRemoveTrack, selectedId = null, onSelect, currentTimeMs = 0, clipLengthMs, durations = {}, nameOf }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectedId) listRef.current?.querySelector(`[data-track-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

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
        <EmptyState icon={<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>}
          title="No music yet" tip="Add a background track above, then set its volume so your voice stays clear." />
      ) : (
        <div ref={listRef} className="flex flex-col gap-3">
          {tracks.map(track => {
            const on = track.id === selectedId
            // Where it stops: its trim end, else the song's end (or the clip's end while unknown)
            const len = clipLengthMs ?? Infinity
            const songEnd = durations[track.id] != null ? track.start_ms + durations[track.id] - (track.offset_ms ?? 0) : len
            const endMs = Math.min(len, track.end_ms ?? songEnd)
            return (
            <div key={track.id} data-track-id={track.id} onPointerDown={() => { if (!on) onSelect?.(track.id) }}
              className="flex flex-col gap-2 p-3 rounded-lg"
              style={{ background: 'var(--surface-2)', boxShadow: on ? 'inset 0 0 0 1.5px #c084fc' : undefined }}>
              <div className="flex items-center justify-between">
                <span className="text-xs text-white truncate">{nameOf ? nameOf(track) : track.storage_path.split('/').pop()}</span>
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

              {on && clipLengthMs != null && (
                <TimeRange startMs={track.start_ms} endMs={endMs} currentTimeMs={currentTimeMs}
                  onStart={ms => {
                    // Moving the start keeps a trimmed track's length
                    const start = Math.round(Math.max(0, Math.min(clipLengthMs - 200, ms)))
                    onUpdateTrack(track.id, { start_ms: start, ...(track.end_ms != null ? { end_ms: Math.min(clipLengthMs, start + track.end_ms - track.start_ms) } : {}) })
                  }}
                  onEnd={ms => onUpdateTrack(track.id, { end_ms: Math.round(Math.min(songEnd, clipLengthMs, Math.max(track.start_ms + 200, ms))) })} />
              )}
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
