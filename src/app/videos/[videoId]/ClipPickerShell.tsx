'use client'

import { useState, useRef, useEffect, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import { BrandLoader } from '@/components/ui/brand-loader'

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
  subscores?: Record<string, number>
  title: string
  start_ms: number
  end_ms: number
  summary: string
  /** Viral score 0–99, missing on the plain fallback chunks */
  score?: number
  reason?: string
}

interface AutoJob { id: string; status: 'queued' | 'running' | 'done' | 'failed'; progress: number; error: string | null; clip_count: number }
interface AutoClip {
  id: string; title: string | null; start_ms: number; end_ms: number; status: string
  output_url: string | null; ai_score: number | null; ai_reason: string | null
  post_caption: string | null; hashtags: string[] | null
}
const AUTO_COUNTS = [3, 5, 10] as const

interface Props {
  video: VideoData
  videoUrl: string
  savedClips: SavedClip[]
}

const ACCENT = '#c8ff00'
// Card look shared by the AI tools and the new-clip bar
const CARD: React.CSSProperties = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }
const PANEL_BG = '#111'
const PANEL_LINE = '1px solid rgba(255,255,255,0.07)'

// Wide screens get three columns (AI tools · video · clips); narrower ones stack the AI tools under the video
const WIDE_QUERY = '(min-width: 1280px)'
function useWide() {
  return useSyncExternalStore(
    cb => { const mq = window.matchMedia(WIDE_QUERY); mq.addEventListener('change', cb); return () => mq.removeEventListener('change', cb) },
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  )
}
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
  // "Make my clips": the AI Edit job for this video and the clips it made
  const [autoCount, setAutoCount] = useState<number>(5)
  const [autoBroll, setAutoBroll] = useState(false)
  const [autoJob, setAutoJob] = useState<AutoJob | null>(null)
  const [autoClips, setAutoClips] = useState<AutoClip[]>([])
  const [autoStarting, setAutoStarting] = useState(false)
  const [autoError, setAutoError] = useState<string | null>(null)
  // The clip list (kept locally so deleted clips disappear at once; a refresh brings the server's copy)
  const [clips, setClips] = useState(savedClips)
  useEffect(() => { setClips(savedClips) }, [savedClips])
  // Select mode: tick several clips, then delete them together
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function toggleSelected(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function stopSelecting() {
    setSelecting(false); setSelected(new Set()); setConfirmDelete(false); setDeleteError(null)
  }
  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || deleting) return
      if (confirmDelete) setConfirmDelete(false); else stopSelecting()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selecting, confirmDelete, deleting])

  async function deleteSelected() {
    const ids = [...selected]
    if (!ids.length) return
    setDeleting(true); setDeleteError(null)
    try {
      const res = await fetch('/api/clips', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Delete failed')
      const gone = new Set(ids)
      setClips(prev => prev.filter(c => !gone.has(c.id)))
      stopSelecting()
      router.refresh()
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

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

  // Parsed form range, for the live duration readout
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

  // What the user does with an AI suggestion (logged for improving clip picking; fire and forget)
  function logSuggestion(event: 'previewed' | 'used', s: Suggestion, source: 'best_moments' | 'clip_search', clipId?: string) {
    fetch(`/api/videos/${video.id}/suggestion-events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({
        event, source, clip_id: clipId,
        suggestion: { start_ms: s.start_ms, end_ms: s.end_ms, title: s.title, score: s.score, subscores: s.subscores, reason: s.reason,
          model: source === 'best_moments' ? 'claude-haiku-4-5-20251001' : 'gemini-3.1-pro-preview' },
      }),
    }).catch(() => {})
  }

  async function createClip(startMs: number, endMs: number, key: string, title?: string, from?: { s: Suggestion; source: 'best_moments' | 'clip_search' }) {
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
      if (from && typeof from.s.score === 'number') logSuggestion('used', from.s, from.source, clip_id)
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

  async function loadAutoClips() {
    const res = await fetch(`/api/videos/${video.id}/auto-clips`)
    if (!res.ok) return
    const data = await res.json() as { job: AutoJob | null; clips: AutoClip[] }
    setAutoJob(data.job)
    setAutoClips(data.clips ?? [])
  }
  const autoRunning = autoJob?.status === 'queued' || autoJob?.status === 'running'
  // A run that finishes while this page is open goes straight to its clips
  const wasRunningRef = useRef(false)
  useEffect(() => {
    if (autoRunning) wasRunningRef.current = true
    else if (wasRunningRef.current && autoJob?.status === 'done') router.push(`/videos/${video.id}/clips`)
  }, [autoRunning, autoJob?.status, router, video.id])
  const autoRendering = autoClips.some(c => c.status === 'rendering')
  // Show an earlier run on load, then poll every 3 s while the job runs or its clips export
  useEffect(() => { if (video.status === 'ready') loadAutoClips().catch(() => {}) }, [video.id, video.status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoRunning && !autoRendering) return
    const t = setInterval(() => { loadAutoClips().catch(() => {}) }, 3000)
    return () => clearInterval(t)
  }, [autoRunning, autoRendering]) // eslint-disable-line react-hooks/exhaustive-deps
  // New clips also belong in the clip list on the right
  const autoDoneCount = autoClips.filter(c => c.status !== 'rendering').length
  useEffect(() => { if (autoDoneCount > 0) router.refresh() }, [autoDoneCount, router])

  async function makeClips() {
    setAutoStarting(true)
    setAutoError(null)
    try {
      const res = await fetch(`/api/videos/${video.id}/auto-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_count: autoCount, add_broll: autoBroll }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not start making clips')
      await loadAutoClips()
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : 'Could not start making clips')
    } finally {
      setAutoStarting(false)
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

  const wide = useWide()
  // The frame takes the video's own proportions once it loads, so it fits exactly (no empty bars)
  const [ratio, setRatio] = useState(16 / 9)
  // The metadata can arrive before the page is interactive (the <video> is server-rendered),
  // so also read the size once on mount
  useEffect(() => {
    const v = videoRef.current
    if (v && v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight)
  }, [videoUrl])

  // ── The player (or its processing / failed state) ──
  const player = isReady && videoUrl ? (
    <video
      ref={videoRef}
      src={videoUrl}
      controls
      className="w-full h-full object-contain"
      onLoadedMetadata={e => { const v = e.currentTarget; if (v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight) }}
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
          <BrandLoader size={40} />
          <p className="text-sm font-medium text-white">{isProcessing ? stageLabel(video.download_progress ?? 0) : 'Loading video…'}</p>
          {isProcessing && (
            <div className="w-48 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(4, video.download_progress ?? 0)}%`, background: ACCENT }} />
            </div>
          )}
        </>
      )}
    </div>
  )

  // ── Under the video: Edit full video + New clip (which opens the start/end form in place) ──
  const newClipBar = showForm ? (
    <form className="shrink-0 rounded-2xl p-4 flex flex-col gap-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.14)' }}
      onSubmit={e => { e.preventDefault(); submitForm() }}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 flex-1" style={{ minWidth: 200 }}>
          <label htmlFor="clip-title" className="text-[11px] font-medium" style={{ color: 'rgba(255,255,255,0.5)' }}>New clip · title (optional)</label>
          <input
            id="clip-title"
            type="text"
            placeholder="e.g. Best reaction"
            value={formTitle}
            onChange={e => setFormTitle(e.target.value)}
            autoFocus
            className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none focus:border-[#c8ff00]"
            style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
          />
        </div>
        <div style={{ width: 150 }}>
          <TimeField id="clip-start" label="Start" value={formStart} onChange={setFormStart} onUseNow={() => setFormStart(msToDisplay(nowMs))} />
        </div>
        <div style={{ width: 150 }}>
          <TimeField id="clip-end" label="End" value={formEnd} onChange={setFormEnd} onUseNow={() => setFormEnd(msToDisplay(nowMs))} />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={!!busy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-50" style={{ background: ACCENT, color: '#000' }}>
            {busy === 'form' && <Spinner />} Create &amp; edit
          </button>
          <button type="button" onClick={() => setShowForm(false)}
            className="px-3.5 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.6)' }}>
            Cancel
          </button>
        </div>
      </div>
      <p className="text-xs" style={{ color: formError ? '#f87171' : 'rgba(255,255,255,0.45)' }}>
        {formError ?? (formRangeValid ? `Length: ${durLabel(formStartMs!, formEndMs!)}` : 'Use m:ss, e.g. 1:45')}
      </p>
    </form>
  ) : (
    <div className="shrink-0 flex justify-center gap-3">
      <button onClick={editFullVideo} disabled={!!busy}
        title="Open the whole video in the editor as one clip"
        className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-colors hover:bg-white/10 disabled:opacity-40"
        style={{ color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.14)' }}>
        {busy === 'full' && <Spinner />}
        Edit full video
      </button>
      <button onClick={openForm} disabled={!!busy}
        className="px-6 py-3 rounded-xl text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ background: ACCENT, color: '#000' }}>
        + New clip from {msToDisplay(nowMs)}
      </button>
    </div>
  )

  // ── AI tools: Ask AI + Best moments (left column on wide screens, under the video otherwise) ──
  const aiTools = (
    <>
      <section className="shrink-0 max-h-[50%] p-4 flex flex-col gap-2 rounded-2xl" style={CARD}>
        <h2 className="text-sm font-semibold text-white">Make my clips</h2>
        <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
          AI picks the best moments, frames them vertically and adds captions. Each new batch finds new moments.
        </p>
        <div className="flex gap-2">
          <div className="flex rounded-lg overflow-hidden" role="radiogroup" aria-label="How many clips" style={{ border: '1px solid rgba(255,255,255,0.12)' }}>
            {AUTO_COUNTS.map(n => (
              <button key={n} role="radio" aria-checked={autoCount === n} onClick={() => setAutoCount(n)} disabled={autoRunning}
                className="px-3 py-2 text-xs font-semibold tabular-nums transition-colors disabled:opacity-40"
                style={autoCount === n ? { background: 'rgba(255,255,255,0.14)', color: '#fff' } : { color: 'rgba(255,255,255,0.55)' }}>
                {n}
              </button>
            ))}
          </div>
          <button onClick={makeClips} disabled={autoRunning || autoStarting}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-40"
            style={{ background: ACCENT, color: '#000' }}>
            {autoStarting || autoRunning ? <Spinner /> : '✦'} {autoRunning ? 'Making clips…' : 'Make my clips'}
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'rgba(255,255,255,0.6)' }}>
          <input type="checkbox" checked={autoBroll} onChange={e => setAutoBroll(e.target.checked)} disabled={autoRunning}
            style={{ accentColor: ACCENT }} />
          Add B-roll <span style={{ color: 'rgba(255,255,255,0.35)' }}>(stock shots, videos from Pexels)</span>
        </label>
        {autoError && <p className="text-xs" style={{ color: '#f87171' }}>{autoError}</p>}
        {autoRunning && autoJob && (
          <div className="flex flex-col gap-1">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(3, autoJob.progress)}%`, background: ACCENT }} />
            </div>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
              {autoJob.status === 'queued' ? 'Waiting to start…' : autoJob.progress < 20 ? 'Reading the video…' : autoJob.progress < 35 ? 'Finding the best moments…' : 'Framing clips…'} {autoJob.progress}%
            </p>
          </div>
        )}
        {autoJob?.status === 'failed' && (
          <p className="text-xs" style={{ color: '#f87171' }}>
            Making clips failed{autoJob.error ? `: ${autoJob.error}` : ''}. Try again, or make clips by hand below.
          </p>
        )}
        {autoClips.length > 0 && !autoRunning && (
          <button onClick={() => router.push(`/videos/${video.id}/clips`)}
            className="flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ color: '#fff', border: '1px solid rgba(255,255,255,0.14)' }}>
            ▶ AI edits ({autoClips.length} clip{autoClips.length === 1 ? '' : 's'})
          </button>
        )}
      </section>

      <section className="flex-1 min-h-0 p-4 flex flex-col gap-2 rounded-2xl" style={CARD}>
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
        {/* Results scroll inside the card, so the card never grows */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -mr-2 pr-2">
        {aiError && <p className="text-xs" style={{ color: '#f87171' }}>{aiError}</p>}
        {loadingAi && (
          <p className="flex items-center gap-2 text-xs py-2" style={{ color: ACCENT }}><Spinner /> Scanning the transcript…</p>
        )}
        {!loadingAi && aiSuggestions && aiSuggestions.length === 0 && (
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Nothing matched that. Try a different description.</p>
        )}
        {!loadingAi && aiSuggestions?.map(s => (
          <SuggestionCard key={s.id} suggestion={s} busy={busy}
            onSeek={() => { seek(s.start_ms); if (typeof s.score === 'number') logSuggestion('previewed', s, 'clip_search') }}
            onUse={() => createClip(s.start_ms, s.end_ms, s.id, s.title, { s, source: 'clip_search' })} />
        ))}
        </div>
      </section>

      <section className="flex-1 min-h-0 p-4 flex flex-col gap-2 rounded-2xl" style={CARD}>
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
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -mr-2 pr-2">
        {loadingSuggestions && (
          <p className="flex items-center gap-2 text-xs py-2" style={{ color: ACCENT }}><Spinner /> Reading the transcript…</p>
        )}
        {suggestionsError && <p className="text-xs" style={{ color: '#f87171' }}>{suggestionsError}</p>}
        {suggestions && !loadingSuggestions && suggestions.length === 0 && (
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>No suggestions for this video.</p>
        )}
        {suggestions && !loadingSuggestions && suggestions.map(s => (
          <SuggestionCard key={s.id} suggestion={s} busy={busy}
            onSeek={() => { seek(s.start_ms); if (typeof s.score === 'number') logSuggestion('previewed', s, 'best_moments') }}
            onUse={() => createClip(s.start_ms, s.end_ms, s.id, s.title, { s, source: 'best_moments' })} />
        ))}
        </div>
      </section>
    </>
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#0d0d0d' }}>
      {/* Nav */}
      <nav className="flex items-center gap-3 px-4 shrink-0"
        style={{ height: 56, background: '#111', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {/* Where am I: Shortcut | Dashboard › Clip board */}
        <Breadcrumbs shine items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Clip board' }]} />
        <div className="flex-1" />
        <AccountMenu />
      </nav>

      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* ── Left: AI tools (wide screens) ─────────────────────── */}
        {wide && isReady && (
          <aside className="shrink-0 flex flex-col gap-4 p-4 min-h-0" style={{ width: 340, background: PANEL_BG, borderRight: PANEL_LINE }}>
            {aiTools}
          </aside>
        )}

        {/* ── Centre: the video, as large as fits, with the new-clip bar right under it ── */}
        <main className="flex-1 min-w-0 flex flex-col gap-3 p-3 overflow-y-auto">
          {wide ? (
            // Container-query box: the player takes the biggest size (in the video's own shape) that fits both ways
            <div className="flex-1 min-h-0 flex items-center justify-center" style={{ containerType: 'size' }}>
              <div className="rounded-2xl overflow-hidden flex items-center justify-center bg-black"
                style={{ width: `min(100cqw, calc(100cqh * ${ratio}))`, aspectRatio: `${ratio}`, border: '1px solid rgba(255,255,255,0.08)' }}>
                {player}
              </div>
            </div>
          ) : (
            <div className="w-full rounded-2xl overflow-hidden flex items-center justify-center bg-black shrink-0"
              style={{ aspectRatio: `${ratio}`, maxHeight: '70vh', margin: '0 auto', width: `min(100%, calc(70vh * ${ratio}))`, border: '1px solid rgba(255,255,255,0.08)' }}>
              {player}
            </div>
          )}

          {isReady && newClipBar}

          {!wide && isReady && <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ height: 420 }}>{aiTools}</div>}
        </main>

        {/* ── Right: your clips ─────────────────────────────────── */}
        <aside className="shrink-0 flex flex-col min-h-0" style={{ width: 340, background: PANEL_BG, borderLeft: PANEL_LINE }}>
          <div className="px-4 pt-4 pb-3 flex items-center gap-2 shrink-0">
            <h2 className="text-sm font-semibold text-white">Your clips</h2>
            {clips.length > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
                {clips.length}
              </span>
            )}
            <div className="flex-1" />
            {clips.length > 0 && (
              <button type="button" aria-pressed={selecting}
                onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
                className="px-3 py-1 rounded-full text-xs font-semibold transition-colors hover:bg-white/10"
                style={selecting
                  ? { color: ACCENT, border: `1px solid ${ACCENT}` }
                  : { color: 'rgba(255,255,255,0.75)', border: '1px solid rgba(255,255,255,0.15)' }}>
                {selecting ? 'Done' : 'Select'}
              </button>
            )}
          </div>
          {clipError && (
            <div role="alert" className="mx-4 mb-2 px-3 py-2 rounded-lg flex items-center justify-between gap-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <span className="text-xs" style={{ color: '#f87171' }}>{clipError}</span>
              <button onClick={() => setClipError(null)} aria-label="Dismiss" className="shrink-0 px-1 rounded hover:bg-white/10" style={{ color: 'rgba(239,68,68,0.7)' }}>✕</button>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 flex flex-col gap-2">
            {clips.length === 0 && (
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {isReady
                  ? 'Pause the video on a moment you like, then press New clip under it. Or let AI find moments for you.'
                  : 'You can start clipping once the video has finished processing.'}
              </p>
            )}
            {clips.map((clip, idx) => (
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
                selecting={selecting}
                selected={selected.has(clip.id)}
                onToggle={() => toggleSelected(clip.id)}
              />
            ))}
          </div>

          {/* Select mode: what's ticked, and what to do with it */}
          {selecting && (() => {
            const allOn = clips.length > 0 && clips.every(c => selected.has(c.id))
            return (
              <div className="shrink-0 px-4 py-3 flex flex-col gap-2" style={{ borderTop: PANEL_LINE, background: PANEL_BG }} role="toolbar" aria-label="Selected clips">
                {deleteError && !confirmDelete && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{deleteError}</p>}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white flex-1" aria-live="polite">
                    {selected.size === 0 ? 'Tap clips to select them' : `${selected.size} selected`}
                  </span>
                  <button type="button" onClick={() => setSelected(allOn ? new Set() : new Set(clips.map(c => c.id)))}
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.75)' }}>
                    {allOn ? 'Clear' : 'Select all'}
                  </button>
                  <button type="button" disabled={selected.size === 0} onClick={() => { setDeleteError(null); setConfirmDelete(true) }}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40 transition-opacity hover:opacity-90"
                    style={{ background: '#ef4444', color: '#fff' }}>
                    Delete{selected.size > 0 ? ` ${selected.size}` : ''}
                  </button>
                </div>
              </div>
            )
          })()}
        </aside>
      </div>

      {confirmDelete && (() => {
        const n = selected.size
        const exported = clips.filter(c => selected.has(c.id) && c.status === 'done').length
        return (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
            onClick={() => { if (!deleting) setConfirmDelete(false) }}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="clip-delete-title" onClick={e => e.stopPropagation()}
              className="w-full max-w-[400px] rounded-2xl p-6" style={{ background: '#161616', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 40px 100px -30px rgba(0,0,0,0.8)' }}>
              <h2 id="clip-delete-title" className="text-lg font-black text-white">Delete {n === 1 ? 'this clip' : `${n} clips`}?</h2>
              <p className="text-sm mt-2 leading-relaxed" style={{ color: 'rgba(255,255,255,0.6)' }}>
                {n === 1 ? 'The clip and its edits are' : `The clips and their edits are`} removed permanently
                {exported > 0 ? `, including ${exported === 1 ? 'an exported video' : `${exported} exported videos`}` : ''}.
                The original video stays. This can&apos;t be undone.
              </p>
              {deleteError && <p role="alert" className="text-xs mt-3" style={{ color: '#f87171' }}>{deleteError}</p>}
              <div className="flex justify-end gap-2 mt-5">
                <button type="button" autoFocus disabled={deleting} onClick={() => setConfirmDelete(false)}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition-colors hover:bg-white/10 disabled:opacity-50" style={{ color: 'rgba(255,255,255,0.8)' }}>
                  Cancel
                </button>
                <button type="button" disabled={deleting} onClick={deleteSelected}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-60 transition-opacity hover:opacity-90" style={{ background: '#ef4444', color: '#fff' }}>
                  {deleting ? <><Spinner /> Deleting</> : n === 1 ? 'Delete' : `Delete ${n} clips`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
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
    <div className="shrink-0 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
      <div className="flex items-start gap-2">
        <p className="flex-1 text-sm font-medium text-white leading-snug">{suggestion.title}</p>
        {typeof suggestion.score === 'number' && (
          <span title="Viral score (0–99)"
            className="shrink-0 text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-md"
            style={{ color: ACCENT, background: 'rgba(200,255,0,0.1)', border: '1px solid rgba(200,255,0,0.25)' }}>
            {suggestion.score}
          </span>
        )}
      </div>
      {suggestion.summary && <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgba(255,255,255,0.5)' }}>{suggestion.summary}</p>}
      {suggestion.reason && <p className="text-[11px] mt-1 leading-relaxed italic" style={{ color: 'rgba(255,255,255,0.4)' }}>{suggestion.reason}</p>}
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

function ClipCard({ number, title, startMs, endMs, status, outputUrl, playing, onSeek, onEdit, disabled, selecting, selected, onToggle }: {
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
  /** Select mode: the whole card toggles its tick; Edit and Download step aside */
  selecting?: boolean
  selected?: boolean
  onToggle?: () => void
}) {
  const chip =
    status === 'rendering' ? { label: 'Rendering', color: ACCENT } :
    status === 'done' ? { label: 'Exported', color: '#4ade80' } :
    status === 'failed' ? { label: 'Render failed', color: '#f87171' } :
    { label: 'Draft', color: 'rgba(255,255,255,0.45)' }

  const border = selected ? ACCENT : playing ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.07)'
  return (
    <div className={`rounded-xl p-3 transition-colors ${selecting ? 'cursor-pointer select-none hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2' : ''}`}
      style={{ background: selected ? 'rgba(200,255,0,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, outlineColor: ACCENT }}
      {...(selecting ? {
        role: 'checkbox',
        'aria-checked': !!selected,
        'aria-label': `Select ${title}`,
        tabIndex: 0,
        onClick: onToggle,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle?.() } },
      } : {})}>
      <div className="flex items-start gap-2.5">
        {selecting ? (
          <span aria-hidden="true" className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors"
            style={selected
              ? { background: ACCENT, border: `2px solid ${ACCENT}`, color: '#000' }
              : { background: 'transparent', border: '2px solid rgba(255,255,255,0.45)' }}>
            {selected && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
          </span>
        ) : (
          <span className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[11px] font-bold" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff' }}>
            {number}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-white leading-snug truncate" title={title}>{title}</p>
            <span className="shrink-0 flex items-center gap-1.5 text-[11px] font-medium mt-0.5" style={{ color: chip.color }}>
              {status === 'rendering' ? <Spinner /> : <span className="w-1.5 h-1.5 rounded-full" style={{ background: chip.color }} />}
              {chip.label}
            </span>
          </div>
          {selecting ? (
            <p className="mt-1 text-xs font-mono tabular-nums" style={{ color: 'rgba(255,255,255,0.55)' }}>
              {msToDisplay(startMs)} – {msToDisplay(endMs)} · {durLabel(startMs, endMs)}
            </p>
          ) : (
            <button onClick={onSeek} title="Play this clip"
              className="mt-1 text-xs font-mono tabular-nums px-2 py-0.5 -ml-2 rounded-md transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.55)' }}>
              ▶ {msToDisplay(startMs)} – {msToDisplay(endMs)} · {durLabel(startMs, endMs)}
            </button>
          )}
          {!selecting && <div className="flex items-center gap-2 mt-2">
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
          </div>}
        </div>
      </div>
    </div>
  )
}
