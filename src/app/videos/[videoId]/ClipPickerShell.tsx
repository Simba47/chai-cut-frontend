'use client'

import { useState, useRef, useEffect, useId } from 'react'
import { useRouter } from 'next/navigation'

interface VideoData {
  id: string
  status: string
  download_progress: number
  duration_ms: number | null
  created_at: string
}

interface SavedClip {
  id: string
  title: string | null
  start_ms: number
  end_ms: number
  status: string
  output_url: string | null
  layout: string | null
  created_at: string
  index: number
}

interface PendingClip {
  id: string
  title: string
  start_ms: number
  end_ms: number
  // always vertical — app is reels-only
}

interface Props {
  video: VideoData
  videoUrl: string
  userEmail: string
  savedClips: SavedClip[]
}

// ── helpers ────────────────────────────────────────────────────────────────────

function parseTime(str: string): number | null {
  const parts = str.trim().split(':').map(Number)
  if (parts.some(isNaN) || parts.length === 0) return null
  if (parts.length === 1) return parts[0] * 1000
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
  return null
}

function msToDisplay(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

function durLabel(startMs: number, endMs: number): string {
  const totalSec = Math.floor((endMs - startMs) / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m > 0 && s > 0) return `${m}m ${s}s`
  if (m > 0) return `${m}m`
  return `${s}s`
}

const stageLabel = (pct: number) =>
  pct < 5  ? 'Queued…' :
  pct < 30 ? `Downloading ${pct}%` :
  pct < 56 ? `Processing ${pct}%` :
  pct < 62 ? 'Extracting audio…' :
  pct < 99 ? `Transcribing ${pct}%` : 'Finishing…'

// ── sub-components ─────────────────────────────────────────────────────────────

function TimePill({ startMs, endMs, onSeekStart, onSeekEnd }: {
  startMs: number; endMs: number
  onSeekStart?: () => void; onSeekEnd?: () => void
}) {
  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono"
      style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.55)' }}
    >
      <button onClick={onSeekStart} className="hover:text-white transition-colors">{msToDisplay(startMs)}</button>
      <span style={{ color: 'rgba(255,255,255,0.25)' }}>→</span>
      <button onClick={onSeekEnd} className="hover:text-white transition-colors">{msToDisplay(endMs)}</button>
      <span
        className="ml-0.5 px-1.5 py-0.5 rounded-full text-xs"
        style={{ background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.4)' }}
      >
        {durLabel(startMs, endMs)}
      </span>
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────────

export function ClipPickerShell({ video: initialVideo, videoUrl, userEmail, savedClips }: Props) {
  const router = useRouter()
  const uid = useId()
  const videoRef = useRef<HTMLVideoElement>(null)

  const [video, setVideo] = useState(initialVideo)
  const [pending, setPending] = useState<PendingClip[]>([])
  const [showForm, setShowForm] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formStart, setFormStart] = useState('')
  const [formEnd, setFormEnd] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const isReady = video.status === 'ready'
  const isProcessing = video.status === 'uploaded' || video.status === 'transcribing'
  const maxMs = video.duration_ms ?? 0

  // Poll while processing
  useEffect(() => {
    if (!isProcessing) return
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/videos/${video.id}`)
        if (!r.ok) return
        const { video: updated } = await r.json()
        setVideo(updated)
        if (updated.status === 'ready') { clearInterval(id); router.refresh() }
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(id)
  }, [isProcessing, video.id, router])

  function seek(ms: number) {
    if (videoRef.current) {
      videoRef.current.currentTime = ms / 1000
      videoRef.current.play().catch(() => {})
    }
  }

  function openForm() {
    setFormTitle('')
    setFormStart('')
    setFormEnd('')
    setFormError(null)
    setShowForm(true)
  }

  function submitForm() {
    if (!formTitle.trim()) { setFormError('Enter a title'); return }
    const startMs = parseTime(formStart)
    const endMs = parseTime(formEnd)
    if (startMs === null) { setFormError('Invalid start time (e.g. 0:30)'); return }
    if (endMs === null) { setFormError('Invalid end time (e.g. 1:45)'); return }
    if (endMs <= startMs) { setFormError('End must be after start'); return }
    if (maxMs > 0 && endMs > maxMs) {
      setFormError(`Exceeds video length (${msToDisplay(maxMs)})`); return
    }
    setPending(prev => [...prev, { id: `${uid}-${Date.now()}`, title: formTitle.trim(), start_ms: startMs, end_ms: endMs }])
    setShowForm(false)
  }

  function removePending(id: string) { setPending(prev => prev.filter(c => c.id !== id)) }

  async function clipIt(startMs: number, endMs: number, pendingId?: string, title?: string) {
    const key = pendingId ?? 'new'
    setBusy(key)
    try {
      const res = await fetch('/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: video.id, start_ms: startMs, end_ms: endMs, layout: 'vertical', ...(title ? { title } : {}) }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed')
      const { clip_id } = await res.json()
      if (pendingId) removePending(pendingId)
      router.push(`/editor/${clip_id}?layout=vertical`)
    } catch (e) {
      console.error(e)
      setBusy(null)
    }
  }

  const totalClips = savedClips.length + pending.length

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#0d0d0d' }}>
      {/* Nav */}
      <nav
        className="flex items-center justify-between px-5 h-11 border-b shrink-0"
        style={{ background: '#111', borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-1 text-sm transition-opacity hover:opacity-70"
            style={{ color: 'rgba(255,255,255,0.45)' }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Back
          </button>
          <span className="text-sm font-bold text-white tracking-tight">✂ Chai Cut</span>
        </div>
        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>{userEmail}</span>
      </nav>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">

        {/* ── LEFT: video ────────────────────────────────────────────── */}
        <div className="flex-1 flex items-center justify-center bg-black overflow-hidden">
          {isReady && videoUrl ? (
            <video
              ref={videoRef}
              src={videoUrl}
              controls
              className="w-full h-full object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-4 px-10 text-center">
              <div
                className="w-9 h-9 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: '#00b4d8', borderTopColor: 'transparent' }}
              />
              {isProcessing ? (
                <>
                  <p className="text-sm font-medium text-white">{stageLabel(video.download_progress ?? 0)}</p>
                  <div className="w-48 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max(4, video.download_progress ?? 0)}%`, background: '#00b4d8' }}
                    />
                  </div>
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Video is being processed…</p>
                </>
              ) : (
                <p className="text-sm text-white">{video.status === 'failed' ? 'Processing failed' : 'Loading video…'}</p>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: clip panel ──────────────────────────────────────── */}
        <div
          className="w-90 shrink-0 flex flex-col overflow-hidden"
          style={{ borderLeft: '1px solid rgba(255,255,255,0.08)' }}
        >
          {/* Panel header */}
          <div
            className="px-4 py-3 flex items-center justify-between border-b shrink-0"
            style={{ borderColor: 'rgba(255,255,255,0.07)' }}
          >
            <span className="text-sm font-semibold text-white">
              Clips {totalClips > 0 && <span style={{ color: 'rgba(255,255,255,0.35)' }}>· {totalClips}</span>}
            </span>
            {isReady && (
              <button
                onClick={() => { setBusy('full'); fetch('/api/clips', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video_id: video.id }) }).then(r => r.json()).then(d => router.push(`/editor/${d.clip_id}`)).catch(() => setBusy(null)) }}
                disabled={!!busy}
                className="text-xs px-2.5 py-1 rounded-lg transition-opacity hover:opacity-70 disabled:opacity-40"
                style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.09)' }}
              >
                Edit full video
              </button>
            )}
          </div>

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto py-2">

            {/* Saved clips from DB */}
            {savedClips.map((clip, idx) => (
              <ClipCard
                key={clip.id}
                number={idx + 1}
                title={clip.title ?? `Clip ${clip.index}`}
                startMs={clip.start_ms}
                endMs={clip.end_ms}
                onSeekStart={() => seek(clip.start_ms)}
                onSeekEnd={() => seek(clip.end_ms)}
                saved
                status={clip.status}
                outputUrl={clip.output_url}
                onEdit={() => router.push(`/editor/${clip.id}`)}
                disabled={!!busy}
              />
            ))}

            {/* Pending (local) clips */}
            {pending.map((clip, idx) => (
              <ClipCard
                key={clip.id}
                number={savedClips.length + idx + 1}
                title={clip.title}
                startMs={clip.start_ms}
                endMs={clip.end_ms}
                onSeekStart={() => seek(clip.start_ms)}
                onSeekEnd={() => seek(clip.end_ms)}
                saved={false}
                busyClip={busy === clip.id}
                onClip={() => clipIt(clip.start_ms, clip.end_ms, clip.id, clip.title)}
                onRemove={() => removePending(clip.id)}
                disabled={!!busy}
              />
            ))}

            {/* Empty state */}
            {totalClips === 0 && !showForm && (
              <div className="flex flex-col items-center justify-center py-10 px-6 text-center">
                <p className="text-sm" style={{ color: 'rgba(255,255,255,0.25)' }}>
                  {isReady ? 'Scrub the video to find your timestamps, then add clips below' : 'Video is processing…'}
                </p>
              </div>
            )}

            {/* New clip form */}
            {showForm && (
              <div className="mx-3 my-2 rounded-2xl p-4" style={{ background: 'rgba(0,180,216,0.06)', border: '1.5px solid rgba(0,180,216,0.3)' }}>
                <p className="text-xs font-semibold text-white mb-3">New clip</p>
                <input
                  type="text"
                  placeholder="Clip title"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && submitForm()}
                  autoFocus
                  className="w-full px-3 py-2 rounded-xl text-sm text-white outline-none mb-2"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
                <div className="flex flex-col gap-2 mb-2">
                  <input
                    type="text"
                    placeholder="Start — e.g. 2:45"
                    value={formStart}
                    onChange={e => setFormStart(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitForm()}
                    className="w-full px-3 py-2 rounded-xl text-sm text-white outline-none font-mono"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                  <input
                    type="text"
                    placeholder={maxMs > 0 ? `End — max ${msToDisplay(maxMs)}` : 'End — e.g. 4:28'}
                    value={formEnd}
                    onChange={e => setFormEnd(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && submitForm()}
                    className="w-full px-3 py-2 rounded-xl text-sm text-white outline-none font-mono"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)' }}
                  />
                </div>
                {formError && <p className="text-xs mb-2" style={{ color: '#f87171' }}>{formError}</p>}
                <div className="flex gap-2">
                  <button onClick={submitForm} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white" style={{ background: '#00b4d8' }}>Add</button>
                  <button onClick={() => setShowForm(false)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(255,255,255,0.5)' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          {/* Add clip button */}
          {!showForm && isReady && (
            <div className="px-3 py-3 border-t shrink-0" style={{ borderColor: 'rgba(255,255,255,0.07)' }}>
              <button
                onClick={openForm}
                disabled={!!busy}
                className="w-full py-3 rounded-xl text-sm font-medium transition-colors hover:border-white/20 disabled:opacity-40"
                style={{ border: '1.5px dashed rgba(255,255,255,0.13)', color: 'rgba(255,255,255,0.35)' }}
              >
                + Add a clip
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── ClipCard ──────────────────────────────────────────────────────────────────

interface ClipCardProps {
  number: number
  title: string
  startMs: number
  endMs: number
  onSeekStart: () => void
  onSeekEnd: () => void
  saved: boolean
  disabled?: boolean
  // saved-clip props
  status?: string
  outputUrl?: string | null
  onEdit?: () => void
  // pending-clip props
  busyClip?: boolean
  onClip?: () => void
  onRemove?: () => void
}

function ClipCard({
  number, title, startMs, endMs,
  onSeekStart, onSeekEnd,
  saved, disabled,
  status, outputUrl, onEdit,
  busyClip, onClip, onRemove,
}: ClipCardProps) {
  const isDone = status === 'done'

  return (
    <div
      className="mx-3 my-1.5 rounded-2xl p-3.5"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)' }}
    >
      <div className="flex items-start gap-2.5">
        {/* Number */}
        <div
          className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
          style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.6)' }}
        >
          {number}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-white leading-snug">{title}</p>
            {!saved && onRemove && (
              <button
                onClick={onRemove}
                disabled={disabled}
                className="shrink-0 p-1 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-30 mt-0.5"
                style={{ color: 'rgba(255,255,255,0.35)' }}
              >
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>

          {/* Time pill */}
          <div className="mt-1.5">
            <TimePill startMs={startMs} endMs={endMs} onSeekStart={onSeekStart} onSeekEnd={onSeekEnd} />
          </div>

          {/* Buttons */}
          <div className="flex items-center gap-2 mt-2.5 flex-wrap">
            {saved ? (
              <>
                <button
                  onClick={onEdit}
                  disabled={disabled}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-80"
                  style={{ background: '#374151' }}
                >
                  <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                    <path d="M9.5 2L12 4.5M2 12l.7-2.8L10 1.5 12.5 4 4.8 11.3 2 12z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Re-edit
                </button>
                {outputUrl && (
                  <a
                    href={outputUrl}
                    download
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white transition-opacity hover:opacity-80"
                    style={{ background: '#00b4d8' }}
                  >
                    <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                      <path d="M7 2v7M4 7l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Download
                  </a>
                )}
                {isDone && !outputUrl && (
                  <span className="text-xs px-2 py-1 rounded-lg" style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>Done</span>
                )}
                {status === 'rendering' && (
                  <span className="flex items-center gap-1.5 text-xs" style={{ color: '#00b4d8' }}>
                    <span className="w-3 h-3 border border-current border-t-transparent rounded-full animate-spin" />
                    Rendering…
                  </span>
                )}
              </>
            ) : (
              <button
                onClick={onClip}
                disabled={disabled}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white disabled:opacity-40 transition-opacity hover:opacity-80"
                style={{ background: '#00b4d8' }}
              >
                {busyClip
                  ? <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <svg width="6" height="10" viewBox="0 0 9 16" fill="none"><rect x="0.5" y="0.5" width="8" height="15" rx="1.5" stroke="currentColor" strokeWidth="1.3"/></svg>
                }
                Clip
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

