'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Video, SegmentLocal, CropBoxLocal } from '@chai-cut/shared'

interface Props {
  activeSegment: SegmentLocal | null
  onAssignSource: (segId: string, boxId: string, videoId: string | null, offsetMs: number) => void
}

function msToLabel(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function MediaPanel({ activeSegment, onAssignSource }: Props) {
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)
  const [pickingBox, setPickingBox] = useState<CropBoxLocal | null>(null)

  useEffect(() => {
    const sb = createClient()
    sb.from('videos')
      .select('*')
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setVideos((data ?? []) as Video[]); setLoading(false) })
  }, [])

  if (!activeSegment) {
    return (
      <div className="p-4 text-center">
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>Select a segment to assign video sources.</p>
      </div>
    )
  }

  const boxes = activeSegment.crop_boxes

  return (
    <div className="flex flex-col gap-3 p-3">
      <p className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        Slot Sources — {activeSegment.layout}
      </p>

      {boxes.map((box, i) => {
        const srcVideo = videos.find(v => v.id === box.source_video_id)
        return (
          <div key={box.id} className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
            {/* Slot header */}
            <div className="flex items-center justify-between px-3 py-2" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <span className="text-xs font-medium text-white">Slot {i + 1}</span>
              {box.source_video_id ? (
                <button
                  onClick={() => onAssignSource(activeSegment.id, box.id, null, 0)}
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
                >
                  Clear
                </button>
              ) : (
                <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Main video</span>
              )}
            </div>

            {/* Current assignment */}
            {srcVideo ? (
              <div className="px-3 py-2 flex flex-col gap-1.5">
                <p className="text-xs text-white truncate">
                  Video {new Date(srcVideo.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Offset:</span>
                  <input
                    type="range"
                    min={0}
                    max={srcVideo.duration_ms ?? 60000}
                    step={100}
                    value={box.source_offset_ms}
                    onChange={e => onAssignSource(activeSegment.id, box.id, box.source_video_id, Number(e.target.value))}
                    className="flex-1 h-1 accent-purple-500"
                  />
                  <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.5)', minWidth: 36 }}>
                    {msToLabel(box.source_offset_ms)}
                  </span>
                </div>
                <button
                  onClick={() => setPickingBox(box)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}
                >
                  Change video
                </button>
              </div>
            ) : (
              <div className="px-3 py-2">
                <button
                  onClick={() => setPickingBox(box)}
                  className="w-full text-xs py-1.5 rounded"
                  style={{ background: 'rgba(124,58,237,0.12)', color: '#a78bfa', border: '1px dashed rgba(124,58,237,0.3)' }}
                >
                  + Assign secondary video
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Video picker overlay */}
      {pickingBox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
          <div className="rounded-xl overflow-hidden flex flex-col" style={{ width: 320, maxHeight: '80vh', background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)' }}>
            <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <p className="text-sm font-semibold text-white">Pick a video for Slot {pickingBox.slot_index + 1}</p>
              <button onClick={() => setPickingBox(null)} style={{ color: 'rgba(255,255,255,0.4)' }}>✕</button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
              {loading && <p className="text-xs text-center py-4" style={{ color: 'rgba(255,255,255,0.3)' }}>Loading…</p>}
              {!loading && videos.length === 0 && (
                <p className="text-xs text-center py-4" style={{ color: 'rgba(255,255,255,0.3)' }}>No ready videos found. Upload more videos first.</p>
              )}
              {videos.map(v => (
                <button
                  key={v.id}
                  onClick={() => {
                    onAssignSource(activeSegment!.id, pickingBox.id, v.id, 0)
                    setPickingBox(null)
                  }}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors"
                  style={{
                    background: v.id === pickingBox.source_video_id ? 'rgba(124,58,237,0.2)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${v.id === pickingBox.source_video_id ? 'rgba(124,58,237,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  <div className="w-8 h-8 rounded flex items-center justify-center shrink-0" style={{ background: '#2a2a2a' }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" opacity={0.5}>
                      <path d="M3 2l9 5-9 5V2z" fill="white"/>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-white truncate">
                      Video — {new Date(v.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                    {v.duration_ms && (
                      <p className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>
                        {msToLabel(v.duration_ms)}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
