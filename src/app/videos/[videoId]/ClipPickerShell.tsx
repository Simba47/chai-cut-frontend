'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface VideoData {
  id: string
  title?: string | null
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

interface Suggestion {
  id: string
  title: string
  start_ms: number
  end_ms: number
  summary: string
}

interface Props {
  video: VideoData
  videoUrl: string
  savedClips: SavedClip[]
}

const ACCENT = '#c8ff00'
const DEFAULT_CLIP_MS = 60_000

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

// ── main component ─────────────────────────────────────────────────────────────

export function ClipPickerShell({ video: initialVideo, videoUrl, savedClips }: Props) {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)

  const [video, setVideo] = useState(initialVideo)
  const [nowMs, setNowMs] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [formTitle, setFormTitle] = useState('')
  const [formStart, setFormStart] = useState('')
  const [formEnd, setFormEnd] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [clipError, setClipError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [aiCriteria, setAiCriteria] = useState('')
  const [aiSuggestions, setAiSuggestions] = useState<Suggestion[] | null>(null)
  const [loadingAi, setLoadingAi] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const isReady = video.status === 'ready'
  const isProcessing = video.status === 'uploaded' || video.status === 'transcribing'
  const maxMs = video.duration_ms ?? 0
  const videoTitle = video.title?.trim() || 'Untitled video'

  // Poll while processing
  useEffect(() => {
    if (!isProcessing) return
    const id = setInterval(async () => {
      try {
        const r = await fetch(`/api/videos/${video.id}`)
        if (!r.ok) return
        const { video: updated } = await r.json()
        setVideo(v => ({ ...v, ...updated }))
        if (updated.status === 'ready') { clearInterval(id); router.refresh() }
      } catch { /* ignore */ }
    }, 3000)
    return () => clearInterval(id)
  }, [isProcessing, video.id, router])

  function seek(ms: number, play = true) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = ms / 1000
    if (play) v.play().catch(() => {})
  }

  function openForm() {
    // Start from wherever the user has scrubbed to — they usually just found the moment
    const start = Math.floor(nowMs / 1000) * 1000
    const end = maxMs > 0 ? Math.min(maxMs, start + DEFAULT_CLIP_MS) : start + DEFAULT_CLIP_MS
    setFormTitle('')
    setFormStart(msToDisplay(start))
    setFormEnd(msToDisplay(end))
    setFormError(null)
    setShowForm(true)
  }

  // Parsed form range, for the live duration readout and the marker on the video bar
  const formStartMs = parseTime(formStart)
  const formEndMs = parseTime(formEnd)
  const formRangeValid = formStartMs !== null && formEndMs !== null && formEndMs > formStartMs

  function submitForm() {
    if (formStartMs === null) { setFormError('Start time looks wrong. Use m:ss, e.g. 0:30'); return }
    if (formEndMs === null) { setFormError('End time looks wrong. Use m:ss, e.g. 1:45'); return }
    if (formEndMs <= formStartMs) { setFormError('End must be after start'); return }
    if (maxMs > 0 && formEndMs > maxMs) { setFormError(`The video is only ${msToDisplay(maxMs)} long`); return }
    setFormError(null)
    createClip(formStartMs, formEndMs, 'form', formTitle.trim() || undefined)
  }

  async function createClip(startMs: number, endMs: number, key: string, title?: string) {
    setBusy(key)
    setClipError(null)
    try {
      const res = await fetch('/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: video.id, start_ms: startMs, end_ms: endMs, layout: 'horizontal', ...(title ? { title } : {}) }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create clip')
      const { clip_id } = await res.json()
      router.push(`/editor/${clip_id}?layout=horizontal`)
    } catch (e) {
      console.error(e)
      setBusy(null)
      setClipError(e instanceof Error ? e.message : 'Failed to create clip. Please try again.')
    }
  }

  async function editFullVideo() {
    setBusy('full')
    setClipError(null)
    try {
      const res = await fetch('/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: video.id }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to open video')
      const { clip_id } = await res.json()
      router.push(`/editor/${clip_id}`)
    } catch (e) {
      console.error(e)
      setBusy(null)
      setClipError(e instanceof Error ? e.message : 'Failed to open video. Please try again.')
    }
  }

  // On demand only — each call asks Claude to read the transcript
  async function findMoments() {
    setLoadingSuggestions(true)
    setSuggestionsError(null)
    try {
      const res = await fetch(`/api/videos/${video.id}/suggestions`)
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load suggestions')
      const { suggestions } = await res.json()
      setSuggestions(suggestions ?? [])
    } catch (e) {
      setSuggestionsError(e instanceof Error ? e.message : 'Could not load suggestions')
    } finally {
      setLoadingSuggestions(false)
    }
  }

  // On demand — asks Claude to find moments matching a specific, user-typed criteria
  async function findByCriteria() {
    const q = aiCriteria.trim()
    if (!q) return
    setLoadingAi(true)
    setAiError(null)
    try {
      const res = await fetch(`/api/videos/${video.id}/ai-detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria: q }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not find clips')
      const { suggestions } = await res.json()
      setAiSuggestions(suggestions ?? [])
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Could not find clips')
    } finally {
      setLoadingAi(false)
    }
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#0d0d0d' }}>
      {/* Nav */}
      <nav className="flex items-center gap-3 px-3 shrink-0"
        style={{ height: 52, background: '#111', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <button onClick={() => router.push('/dashboard')} aria-label="Back to videos" title="Back to videos"
          className="flex items-center justify-center rounded-lg transition-colors hover:bg-white/10 shrink-0"
          style={{ width: 34, height: 34, background: 'rgba(255,255,255,0.05)' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2.5L4.5 7 9 11.5" stroke="rgba(255,255,255,0.75)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white leading-tight truncate" title={videoTitle}>{videoTitle}</p>
          <p className="text-[11px] leading-tight" style={{ color: 'rgba(255,255,255,0.4)' }}>
            {maxMs > 0 && `${msToDisplay(maxMs)} · `}{savedClips.length === 0 ? 'No clips yet' : `${savedClips.length} clip${savedClips.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {isReady && (
          <button onClick={editFullVideo} disabled={!!busy}
            title="Open the whole video in the editor as one clip"
            className="flex items-center gap-2 px-3.5 rounded-lg text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-40 shrink-0"
            style={{ height: 36, color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.14)' }}>
            {busy === 'full' && <Spinner />}
            Edit full video
          </button>
        )}
      </nav>

      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── Video ────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 flex items-center justify-center bg-black">
            {isReady && videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                controls
                className="w-full h-full object-contain"
                onTimeUpdate={e => setNowMs(e.currentTarget.currentTime * 1000)}
                onSeeked={e => setNowMs(e.currentTarget.currentTime * 1000)}
              />
            ) : (
              <div className="flex flex-col items-center gap-4 px-10 text-center">
                {video.status === 'failed' ? (
                  <>
                    <p className="text-sm font-medium text-white">We couldn&apos;t process this video</p>
                    <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Delete it from your videos and upload it again.</p>
                  </>
                ) : (
                  <>
                    <div className="w-9 h-9 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: ACCENT, borderTopColor: 'transparent' }} />
                    <p className="text-sm font-medium text-white">{isProcessing ? stageLabel(video.download_progress ?? 0) : 'Loading video…'}</p>
                    {isProcessing && (
                      <div className="w-48 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(4, video.download_progress ?? 0)}%`, background: ACCENT }} />
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Clip panel ─────────────────────────────────────────── */}
        <aside className="shrink-0 flex flex-col min-h-0" style={{ width: 380, background: '#111', borderLeft: '1px solid rgba(255,255,255,0.07)' }}>
          {clipError && (
            <div role="alert" className="mx-3 mt-3 px-3 py-2 rounded-lg flex items-center justify-between gap-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <span className="text-xs" style={{ color: '#f87171' }}>{clipError}</span>
              <button onClick={() => setClipError(null)} aria-label="Dismiss" className="shrink-0 px-1 rounded hover:bg-white/10" style={{ color: 'rgba(239,68,68,0.7)' }}>✕</button>
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Your clips */}
            <section className="p-4 flex flex-col gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              <h2 className="text-sm font-semibold text-white">Your clips</h2>
              {savedClips.length === 0 && !showForm && (
                <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  {isReady
                    ? 'Scrub the video to a moment you like, then press New clip. Or let AI find moments below.'
                    : 'You can start clipping once the video has finished processing.'}
                </p>
              )}
              {savedClips.map((clip, idx) => (
                <ClipCard
                  key={clip.id}
                  number={idx + 1}
                  title={clip.title ?? `Clip ${clip.index}`}
                  startMs={clip.start_ms}
                  endMs={clip.end_ms}
                  status={clip.status}
                  outputUrl={clip.output_url}
                  playing={nowMs >= clip.start_ms && nowMs < clip.end_ms}
                  onSeek={() => seek(clip.start_ms)}
                  onEdit={() => router.push(`/editor/${clip.id}`)}
                  disabled={!!busy}
                />
              ))}

              {/* New clip form */}
              {showForm && (
                <form className="mt-1 rounded-xl p-3.5 flex flex-col gap-3" style={{ background: 'rgba(200,255,0,0.05)', border: '1px solid rgba(200,255,0,0.3)' }}
                  onSubmit={e => { e.preventDefault(); submitForm() }}>
                  <p className="text-xs font-semibold text-white">New clip</p>
                  <input
                    id="clip-title"
                    type="text"
                    placeholder="Title (optional)"
                    aria-label="Clip title"
                    value={formTitle}
                    onChange={e => setFormTitle(e.target.value)}
                    autoFocus
                    className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none focus:border-[#c8ff00]"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <TimeField id="clip-start" label="Start" value={formStart} onChange={setFormStart} onUseNow={() => setFormStart(msToDisplay(nowMs))} />
                    <TimeField id="clip-end" label="End" value={formEnd} onChange={setFormEnd} onUseNow={() => setFormEnd(msToDisplay(nowMs))} />
                  </div>
                  <p className="text-xs" style={{ color: formError ? '#f87171' : 'rgba(255,255,255,0.45)' }}>
                    {formError ?? (formRangeValid ? `Length: ${durLabel(formStartMs!, formEndMs!)}` : 'Use m:ss, e.g. 1:45')}
                  </p>
                  <div className="flex gap-2">
                    <button type="submit" disabled={!!busy}
                      className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold disabled:opacity-50" style={{ background: ACCENT, color: '#000' }}>
                      {busy === 'form' && <Spinner />} Create &amp; edit
                    </button>
                    <button type="button" onClick={() => setShowForm(false)}
                      className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.6)' }}>
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </section>

            {/* Ask AI */}
            {isReady && (
              <section className="p-4 flex flex-col gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <h2 className="text-sm font-semibold text-white">Ask AI</h2>
                <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                  Describe what to look for — an emotion, a controversial moment, a specific topic — and AI scans the transcript for matching clips.
                </p>
                <form className="flex gap-2" onSubmit={e => { e.preventDefault(); findByCriteria() }}>
                  <input
                    type="text"
                    placeholder="e.g. funny reactions, controversial takes…"
                    aria-label="What should AI look for?"
                    value={aiCriteria}
                    onChange={e => setAiCriteria(e.target.value)}
                    className="min-w-0 flex-1 px-3 py-2 rounded-lg text-sm text-white outline-none focus:border-[#c8ff00]"
                    style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
                  />
                  <button type="submit" disabled={loadingAi || !aiCriteria.trim()}
                    className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-40"
                    style={{ background: ACCENT, color: '#000' }}>
                    {loadingAi ? <Spinner /> : '✦'} Find
                  </button>
                </form>
                {aiError && <p className="text-xs" style={{ color: '#f87171' }}>{aiError}</p>}
                {loadingAi && (
                  <p className="flex items-center gap-2 text-xs py-2" style={{ color: ACCENT }}><Spinner /> Scanning the transcript…</p>
                )}
                {!loadingAi && aiSuggestions && aiSuggestions.length === 0 && (
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Nothing matched that. Try a different description.</p>
                )}
                {!loadingAi && aiSuggestions?.map(s => (
                  <SuggestionCard key={s.id} suggestion={s} busy={busy}
                    onSeek={() => seek(s.start_ms)} onUse={() => createClip(s.start_ms, s.end_ms, s.id, s.title)} />
                ))}
              </section>
            )}

            {/* AI suggestions */}
            {isReady && (
              <section className="p-4 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-white">Best moments</h2>
                  {suggestions && !loadingSuggestions && (
                    <button onClick={findMoments} className="text-xs px-2 py-1 rounded-md transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.55)' }}>Refresh</button>
                  )}
                </div>
                {!suggestions && !loadingSuggestions && (
                  <>
                    <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                      AI reads the transcript and picks the moments most likely to work as reels.
                    </p>
                    <button onClick={findMoments}
                      className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/10"
                      style={{ color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.12)' }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" fill="currentColor"/></svg>
                      Find best moments
                    </button>
                  </>
                )}
                {loadingSuggestions && (
                  <p className="flex items-center gap-2 text-xs py-2" style={{ color: ACCENT }}><Spinner /> Reading the transcript…</p>
                )}
                {suggestionsError && <p className="text-xs" style={{ color: '#f87171' }}>{suggestionsError}</p>}
                {suggestions && !loadingSuggestions && suggestions.length === 0 && (
                  <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>No suggestions for this video.</p>
                )}
                {suggestions && !loadingSuggestions && suggestions.map(s => (
                  <SuggestionCard key={s.id} suggestion={s} busy={busy}
                    onSeek={() => seek(s.start_ms)} onUse={() => createClip(s.start_ms, s.end_ms, s.id, s.title)} />
                ))}
              </section>
            )}
          </div>

          {!showForm && isReady && (
            <div className="px-3 py-3 shrink-0" style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <button onClick={openForm} disabled={!!busy}
                className="w-full py-3 rounded-xl text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: ACCENT, color: '#000' }}>
                + New clip from {msToDisplay(nowMs)}
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function TimeField({ id, label, value, onChange, onUseNow }: { id: string; label: string; value: string; onChange: (v: string) => void; onUseNow: () => void }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>{label}</label>
      <div className="flex items-center rounded-lg overflow-hidden" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}>
        <input id={id} type="text" inputMode="numeric" value={value} onChange={e => onChange(e.target.value)}
          className="min-w-0 flex-1 px-2.5 py-2 bg-transparent text-sm text-white outline-none font-mono tabular-nums" />
        <button type="button" onClick={onUseNow} title="Use the video's current time"
          className="shrink-0 px-2 self-stretch text-[11px] font-medium transition-colors hover:bg-white/10" style={{ color: ACCENT }}>
          Now
        </button>
      </div>
    </div>
  )
}

function Spinner() {
  return <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
}

function SuggestionCard({ suggestion, busy, onSeek, onUse }: {
  suggestion: Suggestion
  busy: string | null
  onSeek: () => void
  onUse: () => void
}) {
  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <p className="text-sm font-medium text-white leading-snug">{suggestion.title}</p>
      {suggestion.summary && <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{suggestion.summary}</p>}
      <div className="flex items-center gap-2 mt-2.5">
        <button onClick={onSeek} title="Play this moment"
          className="text-xs font-mono tabular-nums px-2 py-1 rounded-md transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.05)' }}>
          ▶ {msToDisplay(suggestion.start_ms)} – {msToDisplay(suggestion.end_ms)}
        </button>
        <span className="text-xs" style={{ color: 'rgba(255,255,255,0.35)' }}>{durLabel(suggestion.start_ms, suggestion.end_ms)}</span>
        <div className="flex-1" />
        <button onClick={onUse} disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition-colors hover:bg-white/15"
          style={{ color: '#fff', background: 'rgba(255,255,255,0.08)' }}>
          {busy === suggestion.id ? <Spinner /> : '+'} Use
        </button>
      </div>
    </div>
  )
}

function ClipCard({ number, title, startMs, endMs, status, outputUrl, playing, onSeek, onEdit, disabled }: {
  number: number
  title: string
  startMs: number
  endMs: number
  status: string
  outputUrl: string | null
  playing: boolean
  onSeek: () => void
  onEdit: () => void
  disabled?: boolean
}) {
  const chip =
    status === 'rendering' ? { label: 'Rendering', color: ACCENT } :
    status === 'done' ? { label: 'Exported', color: '#4ade80' } :
    status === 'failed' ? { label: 'Render failed', color: '#f87171' } :
    { label: 'Draft', color: 'rgba(255,255,255,0.45)' }

  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${playing ? 'rgba(200,255,0,0.4)' : 'rgba(255,255,255,0.07)'}` }}>
      <div className="flex items-start gap-2.5">
        <span className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold" style={{ background: 'rgba(200,255,0,0.7)', color: '#000' }}>
          {number}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-white leading-snug truncate" title={title}>{title}</p>
            <span className="shrink-0 flex items-center gap-1.5 text-[11px] font-medium mt-0.5" style={{ color: chip.color }}>
              {status === 'rendering' ? <Spinner /> : <span className="w-1.5 h-1.5 rounded-full" style={{ background: chip.color }} />}
              {chip.label}
            </span>
          </div>
          <button onClick={onSeek} title="Play this clip"
            className="mt-1 text-xs font-mono tabular-nums px-2 py-0.5 -ml-2 rounded-md transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.55)' }}>
            ▶ {msToDisplay(startMs)} – {msToDisplay(endMs)} · {durLabel(startMs, endMs)}
          </button>
          <div className="flex items-center gap-2 mt-2">
            <button onClick={onEdit} disabled={disabled}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40 transition-colors hover:bg-white/15"
              style={{ color: '#fff', background: 'rgba(255,255,255,0.08)' }}>
              <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M9.5 2L12 4.5M2 12l.7-2.8L10 1.5 12.5 4 4.8 11.3 2 12z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Edit
            </button>
            {outputUrl && status === 'done' && (
              <a href={outputUrl} download target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-opacity hover:opacity-90"
                style={{ background: ACCENT, color: '#000' }}>
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M7 2v7M4 7l3 3 3-3M2 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Download
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
