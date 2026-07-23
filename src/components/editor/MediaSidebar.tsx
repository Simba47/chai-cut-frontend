'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Video } from '@chai-cut/shared'

interface Props {
  onInsertBroll: (videoId: string) => void
  pendingInsert?: boolean
  onCancelInsert?: () => void
}

function msToLabel(ms: number) {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function MediaSidebar({ onInsertBroll, pendingInsert = false, onCancelInsert }: Props) {
  const [videos, setVideos] = useState<Video[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const sb = createClient()
    sb.from('videos')
      .select('*')
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setVideos((data ?? []) as Video[])
        setLoading(false)
      })
  }, [])

  return (
    <div
      className="shrink-0 flex flex-col overflow-hidden"
      style={{ width: 176, background: '#0e0e0e', borderRight: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* Header */}
      <div
        className="shrink-0 flex items-center gap-2 px-3"
        style={{ height: 42, borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" opacity={0.45}>
          <path d="M3 1.5l7 4.5-7 4.5V1.5z" fill="white"/>
        </svg>
        <span
          className="text-xs font-semibold"
          style={{ color: 'rgba(255,255,255,0.45)', textTransform: 'uppercase', letterSpacing: '0.05em' }}
        >
          Media
        </span>
      </div>

      {/* Pending insert banner */}
      {pendingInsert && (
        <div
          className="shrink-0 flex items-start gap-2 px-3 py-2.5"
          style={{ background: 'rgba(249,115,22,0.12)', borderBottom: '1px solid rgba(249,115,22,0.2)' }}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="mt-0.5 shrink-0">
            <circle cx="6" cy="6" r="5.5" stroke="#f97316"/>
            <path d="M6 3.5v3M6 8h.01" stroke="#f97316" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold" style={{ color: '#fb923c' }}>Insert point set</p>
            <p className="text-xs" style={{ color: 'rgba(249,115,22,0.7)', lineHeight: 1.4, marginTop: 2 }}>
              Pick a video below to add B-roll at that position
            </p>
            <button
              onClick={onCancelInsert}
              className="text-xs mt-1.5"
              style={{ color: 'rgba(255,255,255,0.3)', textDecoration: 'underline' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Video list */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading && (
          <p className="text-xs text-center py-6" style={{ color: 'rgba(255,255,255,0.25)' }}>
            Loading…
          </p>
        )}

        {!loading && videos.length === 0 && (
          <div className="px-3 py-4 text-center flex flex-col gap-2">
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>No videos yet</p>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.2)', lineHeight: 1.5 }}>
              Upload a second video from the dashboard to add B-roll
            </p>
          </div>
        )}

        {videos.map((v, i) => (
          <div
            key={v.id}
            className="mx-2 mb-2 rounded-lg overflow-hidden"
            style={{
              border: `1px solid ${pendingInsert ? 'rgba(249,115,22,0.3)' : 'rgba(255,255,255,0.07)'}`,
              background: pendingInsert ? 'rgba(249,115,22,0.05)' : 'rgba(255,255,255,0.03)',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            {/* Thumbnail */}
            <div
              className="w-full flex items-center justify-center"
              style={{ aspectRatio: '16/9', background: '#1a1a1a' }}
            >
              <svg width="20" height="20" viewBox="0 0 22 22" fill="none" opacity={0.3}>
                <path d="M6 3l14 8L6 19V3z" fill="white"/>
              </svg>
            </div>

            {/* Info + button */}
            <div className="px-2 pt-1.5 pb-2 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p className="text-xs font-medium text-white truncate">Video {i + 1}</p>
                {v.duration_ms != null && (
                  <span className="text-xs shrink-0" style={{ color: 'rgba(255,255,255,0.35)' }}>
                    {msToLabel(v.duration_ms)}
                  </span>
                )}
              </div>

              <button
                onClick={() => onInsertBroll(v.id)}
                className="w-full text-xs py-1.5 rounded-md font-semibold flex items-center justify-center gap-1.5"
                style={{
                  background: pendingInsert ? 'rgba(249,115,22,0.25)' : 'rgba(249,115,22,0.13)',
                  color: '#fb923c',
                  border: `1px solid ${pendingInsert ? 'rgba(249,115,22,0.5)' : 'rgba(249,115,22,0.25)'}`,
                }}
              >
                <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
                  <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                {pendingInsert ? 'Insert here' : 'B-roll here'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Upload link */}
      <div className="shrink-0 p-2.5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <a
          href="/dashboard"
          className="flex items-center justify-center gap-1.5 w-full text-xs py-1.5 rounded-md font-medium"
          style={{
            background: 'rgba(124,58,237,0.1)',
            color: '#a78bfa',
            border: '1px dashed rgba(124,58,237,0.25)',
          }}
        >
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <path d="M5 1v8M1 5h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
          </svg>
          Upload video
        </a>
      </div>
    </div>
  )
}
