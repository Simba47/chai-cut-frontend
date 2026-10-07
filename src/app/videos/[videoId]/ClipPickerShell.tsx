'use client'

import { InfoTip } from '@/components/ui/info-tip'
import { useFrameAt } from '@/modules/clips/thumbs'
import { useState, useRef, useEffect, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import { BrandLoader, BrandLoaderScreen } from '@/components/ui/brand-loader'
import { ClipPlayer } from '@/components/clips/ClipPlayer'
import type { ClipPreviewData } from '@/server/services/clipPreview'
import type { SegmentLocal } from '@chai-cut/shared'
import { defaultCropForSlot, makeBox } from '@/modules/editor/utils'

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
  origin: ClipOrigin
  /** The heart on its card */
  favorite?: boolean
  /** Why AI picked it (Make my clips), shown on its card */
  reason?: string | null
}

/** Where a clip came from, so the clip list can be split into sections */
export type ClipOrigin = 'yours' | 'ask' | 'auto' | 'best'
type ClipTab = 'all' | ClipOrigin | 'fav'
/** Typed one after another as the Ask AI hint */
const ASK_EXAMPLES = ['funny reactions', 'controversial takes', 'emotional moments', 'big announcements', 'best advice']
const CLIP_TABS: Array<{ id: ClipTab; label: string; empty: string }> = [
  { id: 'all', label: 'All clips', empty: '' },
  { id: 'yours', label: 'Your clips', empty: 'Clips you make yourself (New clip or Edit full video) show here.' },
  { id: 'ask', label: 'Ask AI', empty: 'Describe what you want in Ask AI, then press Use on a result.' },
  { id: 'auto', label: 'Make my clips', empty: 'Clips AI makes for you with Make my clips show here.' },
  { id: 'best', label: 'Best moments', empty: 'Find best moments, then press + on the ones you want.' },
  { id: 'fav', label: 'Favorites', empty: 'Tap the heart on a clip to keep it here.' },
]
/** Ask AI: one-tap searches */
const ASK_CHIPS = ['emotional', 'funny', 'aesthetic', 'action']
const ORIGIN_BADGE: Record<ClipOrigin, { label: string; color: string }> = {
  yours: { label: 'Yours', color: 'rgba(255,255,255,0.6)' },
  ask: { label: 'Ask AI', color: '#38bdf8' },
  auto: { label: 'Make my clips', color: '#c8ff00' },
  best: { label: 'Best moments', color: '#fbbf24' },
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
  /** Best moments: the draft clip it was saved as */
  clip_id?: string
}

interface AutoJob { id: string; status: 'queued' | 'running' | 'done' | 'failed'; progress: number; error: string | null; clip_count: number }
interface AutoClip {
  id: string; title: string | null; start_ms: number; end_ms: number; status: string
  output_url: string | null; ai_score: number | null; ai_reason: string | null
  post_caption: string | null; hashtags: string[] | null
}
// Ask AI answers and the Best moments list are kept in this browser per video, so asking the
// same thing again shows them straight away instead of sending a new AI request
const SAVED_DAYS = 7
const MAX_SAVED_SEARCHES = 20
function readSaved<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { at, data } = JSON.parse(raw) as { at: number; data: T }
    if (Date.now() - at > SAVED_DAYS * 864e5) { localStorage.removeItem(key); return null }
    return data
  } catch { return null }   // storage blocked or bad data: just ask again
}
function writeSaved(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })) } catch { /* storage blocked or full */ }
}
const searchKey = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ')

// Make my clips: what AI adds to each clip (all on by default; remembered per browser)
type AutoOption = 'captions' | 'title' | 'motion' | 'layouts'
const AUTO_OPTIONS: Array<{ id: AutoOption; label: string; tip: string }> = [
  { id: 'captions', label: 'Captions', tip: 'Word-by-word captions at the bottom' },
  { id: 'title', label: 'Title', tip: 'A short hook as a title over the first 3 seconds' },
  { id: 'motion', label: 'Motion', tip: 'The frame follows people as they move. Off: it holds still in each shot' },
  { id: 'layouts', label: 'Cuts (split, trio)', tip: 'Split and trio when 2 or more people are in the shot. Off: always vertical, on one person' },
]
const AUTO_OPTIONS_KEY = 'clipboard.makeOptions'

// Make my clips: how many clips one run can make (the server allows 1 to 10)
const AUTO_MAX = 10

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
// The page's three panels (AI tools · video/preview · Clipboard): separate rounded cards with space between
const PANEL_CARD: React.CSSProperties = {
  background: PANEL_BG, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16,
  boxShadow: '0 8px 24px -12px rgba(0,0,0,0.7)',
}

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
  const [momentsNote, setMomentsNote] = useState<string | null>(null)
  const [momentsAdded, setMomentsAdded] = useState<string | null>(null)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [aiCriteria, setAiCriteria] = useState('')
  // Click counters that replay the AI buttons' animations (styles: .ai-btn in globals.css)
  const [makePulse, setMakePulse] = useState(0)
  const [findPulse, setFindPulse] = useState(0)
  const [bestPulse, setBestPulse] = useState(0)
  // Typing hint in the Ask AI box: whenever it's empty, example searches are typed out letter by
  // letter (left → right), held for a moment, erased, and the next one typed — on a loop
  const [typedHint, setTypedHint] = useState('')
  useEffect(() => {
    if (aiCriteria) { setTypedHint(''); return }
    let i = 0, n = 0, erasing = false
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      const full = `e.g. ${ASK_EXAMPLES[i]}`
      if (!erasing) {
        n++
        setTypedHint(full.slice(0, n))
        if (n >= full.length) { erasing = true; t = setTimeout(tick, 1600); return }
        t = setTimeout(tick, 55)
      } else {
        n--
        setTypedHint(full.slice(0, n))
        if (n <= 0) { erasing = false; i = (i + 1) % ASK_EXAMPLES.length; t = setTimeout(tick, 350); return }
        t = setTimeout(tick, 22)
      }
    }
    t = setTimeout(tick, 250)
    return () => clearTimeout(t)
  }, [aiCriteria])
  const [aiSuggestions, setAiSuggestions] = useState<Suggestion[] | null>(null)
  // Earlier Ask AI answers by search (newest last), and which search the shown saved answer is for
  const [askSaved, setAskSaved] = useState<Record<string, Suggestion[]>>({})
  const [askFrom, setAskFrom] = useState<string | null>(null)
  const askKey = `clipboard.ask.${video.id}`, bestKey = `clipboard.best.${video.id}`
  useEffect(() => {
    setAskSaved(readSaved<Record<string, Suggestion[]>>(askKey) ?? {})
    const best = readSaved<Suggestion[]>(bestKey)
    if (best) setSuggestions(prev => prev ?? best)
  }, [askKey, bestKey])
  // The Best moments list is saved whenever it changes (found, View more, or a moment added)
  useEffect(() => { if (suggestions) writeSaved(bestKey, suggestions) }, [suggestions, bestKey])
  const [loadingAi, setLoadingAi] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  // "Make my clips": the AI Edit job for this video and the clips it made
  const [autoCount, setAutoCount] = useState<number>(5)
  // What's typed in the count box (may be empty or too big while typing; settles on blur)
  const [countText, setCountText] = useState('5')
  const [autoOpts, setAutoOpts] = useState<Record<AutoOption, boolean>>({ captions: true, title: true, motion: true, layouts: true })
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(AUTO_OPTIONS_KEY) ?? 'null') as Partial<Record<AutoOption, boolean>> | null
      if (saved) setAutoOpts(o => ({ ...o, ...saved }))
    } catch { /* storage blocked */ }
  }, [])
  function toggleAutoOpt(id: AutoOption) {
    setAutoOpts(o => {
      const next = { ...o, [id]: !o[id] }
      try { localStorage.setItem(AUTO_OPTIONS_KEY, JSON.stringify(next)) } catch { /* storage blocked */ }
      return next
    })
  }
  const countOver = Number(countText) > AUTO_MAX
  function setCount(n: number) {
    const c = Math.min(AUTO_MAX, Math.max(1, Math.round(n) || 1))
    setAutoCount(c)
    setCountText(String(c))
  }
  // B-roll in Make my clips: its option was taken off the card, so clips are made without it
  const autoBroll = false
  const [autoJob, setAutoJob] = useState<AutoJob | null>(null)
  const [autoClips, setAutoClips] = useState<AutoClip[]>([])
  const [autoStarting, setAutoStarting] = useState(false)
  const [autoError, setAutoError] = useState<string | null>(null)
  const [autoStopping, setAutoStopping] = useState(false)
  // The clip list (kept locally so deleted clips disappear at once; a refresh brings the server's copy)
  const [clips, setClips] = useState(savedClips)
  useEffect(() => { setClips(savedClips) }, [savedClips])
  // Download from Preview: an exported clip saves straight away; one AI only edited (Make my clips
  // saves edits, not files) is exported first and saves by itself once ready
  const [dlState, setDlState] = useState<Record<string, 'exporting' | { error: string }>>({})
  function saveFile(id: string) {
    const a = document.createElement('a')
    a.href = `/api/clips/${id}/download`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
  }
  async function downloadClip(id: string) {
    const c = clips.find(x => x.id === id)
    if (c?.status === 'done' && c.output_url) { saveFile(id); return }
    setDlState(d => ({ ...d, [id]: 'exporting' }))
    if (c?.status !== 'rendering') {
      const res = await fetch('/api/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clip_id: id, quality: '1080p' }),
      }).catch(() => null)
      // 409: it's already exporting — just wait for it
      if (!res || (!res.ok && res.status !== 409)) {
        const error = res ? (await res.json().catch(() => ({}))).error ?? 'Could not export' : 'Could not export'
        setDlState(d => ({ ...d, [id]: { error } }))
        return
      }
    }
    setClips(cs => cs.map(x => x.id === id ? { ...x, status: 'rendering', output_url: null } : x))
  }
  // While a download waits on its export, check every 3 s; save it the moment it's done
  const waitingDl = Object.keys(dlState).filter(id => dlState[id] === 'exporting').join(',')
  useEffect(() => {
    if (!waitingDl) return
    const t = setInterval(() => {
      for (const id of waitingDl.split(',')) {
        fetch(`/api/clips/${id}/status`).then(r => (r.ok ? r.json() : null)).then((d: { status: string; output_url: string | null } | null) => {
          if (!d) return
          if (d.status === 'done' && d.output_url) {
            setClips(cs => cs.map(x => x.id === id ? { ...x, status: 'done', output_url: d.output_url } : x))
            setDlState(s => { const n = { ...s }; delete n[id]; return n })
            saveFile(id)
          } else if (d.status === 'failed') {
            setClips(cs => cs.map(x => x.id === id ? { ...x, status: 'failed' } : x))
            setDlState(s => ({ ...s, [id]: { error: 'The export failed' } }))
          }
        }).catch(() => {})
      }
    }, 3000)
    return () => clearInterval(t)
  }, [waitingDl])
  // Which section of the clip list is showing
  const [clipTab, setClipTab] = useState<ClipTab>('all')
  const shownClips = clipTab === 'all' ? clips : clipTab === 'fav' ? clips.filter(c => c.favorite) : clips.filter(c => c.origin === clipTab)
  // A clip to bring into view and flash in the list (e.g. the clip a Best moment was saved as)
  const [focusClipId, setFocusClipId] = useState<string | null>(null)
  function focusClip(id: string, origin: ClipOrigin | 'all') {
    setClipTab(origin)
    setSelected(new Set())
    setFocusClipId(id)
  }
  // Above the video: the source video, or a clip played in 9:16 as edited (no export needed)
  const [viewMode, setViewMode] = useState<'video' | 'preview'>('video')
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, ClipPreviewData | { error: string } | 'loading'>>({})
  // An Ask AI / Best moments result shown in Preview before it's a clip (framed as a new clip would be)
  type MomentSource = 'best_moments' | 'clip_search'
  const [momentPreview, setMomentPreview] = useState<{ s: Suggestion; source: MomentSource } | null>(null)
  function previewClip(id: string) {
    videoRef.current?.pause()
    setViewMode('preview')
    setMomentPreview(null)
    setPreviewId(id)
    if (previews[id] && previews[id] !== 'loading' && !('error' in (previews[id] as object))) return
    setPreviews(p => ({ ...p, [id]: 'loading' }))
    fetch(`/api/clips/${id}/preview`)
      .then(async r => (r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? 'Could not load the preview'))))
      .then((d: ClipPreviewData) => setPreviews(p => ({ ...p, [id]: d })))
      .catch((e: unknown) => setPreviews(p => ({ ...p, [id]: { error: e instanceof Error ? e.message : 'Could not load the preview' } })))
  }
  function showPreviewMode() {
    setMomentPreview(null)
    const id = previewId && clips.some(c => c.id === previewId) ? previewId : (shownClips[0] ?? clips[0])?.id
    if (id) previewClip(id)
    else setViewMode('preview')
  }
  // A previewed clip that gets deleted: fall back to the video
  useEffect(() => {
    if (previewId && !clips.some(c => c.id === previewId)) { setPreviewId(null); setViewMode('video') }
  }, [clips, previewId])

  useEffect(() => {
    if (!focusClipId) return
    document.getElementById(`clip-${focusClipId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const t = setTimeout(() => setFocusClipId(null), 2500)
    return () => clearTimeout(t)
  }, [focusClipId, clipTab])
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

  /** The heart: saved with the clip (put back if it couldn't be saved) */
  async function toggleFavorite(id: string) {
    const was = !!clips.find(c => c.id === id)?.favorite
    setClips(prev => prev.map(c => c.id === id ? { ...c, favorite: !was } : c))
    try {
      const res = await fetch(`/api/clips/${id}/favorite`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ favorite: !was }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not save the favourite')
    } catch (e) {
      setClips(prev => prev.map(c => c.id === id ? { ...c, favorite: was } : c))
      setClipError(e instanceof Error ? e.message : 'Could not save the favourite')
    }
  }
  /** One clip's ⋮ menu → Delete */
  async function deleteOne(id: string) {
    try {
      const res = await fetch('/api/clips', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Delete failed')
      setClips(prev => prev.filter(c => c.id !== id))
      if (previewId === id) { setPreviewId(null); setViewMode('video') }
      router.refresh()
    } catch (e) {
      setClipError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

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

  /** `open`: open the new clip in the editor (Create & edit); otherwise just add it to the board */
  function submitForm(open = true) {
    if (formStartMs === null) { setFormError('Start time looks wrong. Use m:ss, e.g. 0:30'); return }
    if (formEndMs === null) { setFormError('End time looks wrong. Use m:ss, e.g. 1:45'); return }
    if (formEndMs <= formStartMs) { setFormError('End must be after start'); return }
    if (maxMs > 0 && formEndMs > maxMs) { setFormError(`The video is only ${msToDisplay(maxMs)} long`); return }
    setFormError(null)
    createClip(formStartMs, formEndMs, open ? 'form' : 'board', formTitle.trim() || undefined, undefined, open)
  }

  // What the user does with an AI suggestion (logged for improving clip picking; fire and forget)
  function logSuggestion(event: 'previewed' | 'used', s: Suggestion, source: 'best_moments' | 'clip_search', clipId?: string) {
    fetch(`/api/videos/${video.id}/suggestion-events`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true,
      body: JSON.stringify({
        event, source, clip_id: clipId,
        suggestion: { start_ms: s.start_ms, end_ms: s.end_ms, title: s.title, score: s.score, subscores: s.subscores, reason: s.reason,
          model: 'gemini-2.5-flash' },   // one model picks clips everywhere (CLIP_MODEL in services/videos.ts)
      }),
    }).catch(() => {})
  }

  async function createClip(startMs: number, endMs: number, key: string, title?: string, from?: { s: Suggestion; source: 'best_moments' | 'clip_search' }, open = true) {
    setBusy(key)
    setClipError(null)
    try {
      const res = await fetch('/api/clips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: video.id, start_ms: startMs, end_ms: endMs, layout: 'vertical', ...(title ? { title } : {}) }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Failed to create clip')
      const { clip_id } = await res.json()
      if (from && typeof from.s.score === 'number') logSuggestion('used', from.s, from.source, clip_id)
      if (!open) {
        // Add to board: the clip joins "Your clips" here, highlighted; the editor isn't opened
        setClips(prev => prev.some(c => c.id === clip_id) ? prev : [...prev, {
          id: clip_id, title: title ?? null, start_ms: startMs, end_ms: endMs, status: 'draft', output_url: null,
          layout: 'vertical', created_at: new Date().toISOString(), index: prev.length + 1,
          origin: from?.source === 'best_moments' ? 'best' as const : from?.source === 'clip_search' ? 'ask' as const : 'yours' as const,
        }])
        setShowForm(false)
        setFormTitle('')
        setBusy(null)
        focusClip(clip_id, from?.source === 'best_moments' ? 'best' : from?.source === 'clip_search' ? 'ask' : 'yours')
        router.refresh()
        return
      }
      // Every clip starts as one Vertical format over the whole clip (like "Edit full video")
      router.push(`/editor/${clip_id}`)
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
    // The number in the box, kept to 1–10 (it may not have settled yet if Enter wasn't pressed)
    const count = Math.min(AUTO_MAX, Math.max(1, Number(countText) || autoCount))
    setCount(count)
    setAutoStarting(true)
    setAutoError(null)
    try {
      const res = await fetch(`/api/videos/${video.id}/auto-clips`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_count: count, add_broll: autoBroll, ...autoOpts }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not start making clips')
      await loadAutoClips()
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : 'Could not start making clips')
    } finally {
      setAutoStarting(false)
    }
  }

  // "Stop": ends the run; the worker notices within a few seconds and keeps the clips made so far
  async function stopMakingClips() {
    setAutoStopping(true)
    setAutoError(null)
    try {
      const res = await fetch(`/api/videos/${video.id}/auto-clips`, { method: 'DELETE' })
      if (!res.ok && res.status !== 409) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not stop')
      await loadAutoClips()
    } catch (e) {
      setAutoError(e instanceof Error ? e.message : 'Could not stop')
    } finally {
      setAutoStopping(false)
    }
  }

  // On demand only — each call asks AI to read the transcript. Every moment it finds is
  // saved as a draft clip in the Best moments section; the next call finds new ones.
  // Cancel on a running Ask AI / Best moments search: the request is dropped and the list stays as it was
  const momentsAbort = useRef<AbortController | null>(null)
  const askAbort = useRef<AbortController | null>(null)
  const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

  async function findMoments() {
    momentsAbort.current?.abort()
    const ctl = new AbortController()
    momentsAbort.current = ctl
    setLoadingSuggestions(true)
    setSuggestionsError(null)
    setMomentsNote(null)
    setMomentsAdded(null)
    try {
      // A list to pick from: nothing is saved until "+"; moments already listed are skipped
      const exclude = (suggestions ?? []).map(s => [s.start_ms, s.end_ms])
      const res = await fetch(`/api/videos/${video.id}/best-moments?list=1`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ exclude }), signal: ctl.signal,
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not load suggestions')
      const { moments, limitMessage } = await res.json() as { moments: Suggestion[]; limitMessage: string | null }
      const batch = Date.now()
      const found = (moments ?? []).map(m => ({ ...m, id: m.clip_id ?? `${batch}-${m.id}` }))
      // Earlier finds stay listed above the new ones
      setSuggestions(prev => [...(prev ?? []), ...found])
      setMomentsNote(limitMessage)
      const added = found.filter(m => m.clip_id)
      if (added.length) {
        setClips(prev => [...prev, ...added.filter(m => !prev.some(c => c.id === m.clip_id)).map((m, i) => ({
          id: m.clip_id!, title: m.title, start_ms: m.start_ms, end_ms: m.end_ms, status: 'draft', output_url: null,
          layout: null, created_at: new Date().toISOString(), index: prev.length + i + 1, origin: 'best' as const,
        }))])
        setMomentsAdded(`✓ Added ${added.length} moment${added.length === 1 ? '' : 's'} to Clips › Best moments`)
        focusClip(added[0].clip_id!, 'best')
        router.refresh()
      }
    } catch (e) {
      if (!isAbort(e)) setSuggestionsError(e instanceof Error ? e.message : 'Could not load suggestions')
    } finally {
      if (momentsAbort.current === ctl) { momentsAbort.current = null; setLoadingSuggestions(false) }
    }
  }

  /** The clip a result already became (same start and end), if any */
  function clipFor(s: Suggestion) {
    return clips.find(c => c.id === s.clip_id) ?? clips.find(c => c.start_ms === s.start_ms && c.end_ms === s.end_ms) ?? null
  }
  /** Clicking a result card: it plays in Preview, in 9:16, without being made a clip */
  function previewMoment(s: Suggestion, source: MomentSource) {
    videoRef.current?.pause()
    setPreviewId(null)
    setMomentPreview({ s, source })
    setViewMode('preview')
    if (typeof s.score === 'number') logSuggestion('previewed', s, source)
  }
  function closeMoment() { setMomentPreview(null); setViewMode('video') }
  /** Edit: opens it in the editor (made a clip first if it isn't one yet) */
  function editMoment(s: Suggestion, source: MomentSource) {
    const c = clipFor(s)
    if (c) { setBusy('open'); router.push(`/editor/${c.id}`); return }
    createClip(s.start_ms, s.end_ms, s.id, s.title, { s, source })
  }
  /** Add: it joins the clip board (the editor isn't opened); once added, this shows it there */
  function addMomentToBoard(s: Suggestion, source: MomentSource) {
    const c = clipFor(s)
    if (c) { focusClip(c.id, source === 'best_moments' ? 'best' : 'ask'); return }
    createClip(s.start_ms, s.end_ms, s.id, s.title, { s, source }, false)
  }

  // On demand — asks AI to find moments matching a specific, user-typed criteria
  async function findByCriteria(query?: string, fresh = false) {
    const q = (query ?? aiCriteria).trim()
    if (!q) return
    const key = searchKey(q)
    if (!fresh && askSaved[key]) {
      // Asked before: show that answer, no new request
      askAbort.current?.abort(); askAbort.current = null; setLoadingAi(false)
      setAiError(null)
      setAiSuggestions(askSaved[key])
      setAskFrom(q)
      return
    }
    askAbort.current?.abort()
    const ctl = new AbortController()
    askAbort.current = ctl
    setLoadingAi(true)
    setAiError(null)
    try {
      const res = await fetch(`/api/videos/${video.id}/ai-detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ criteria: q }),
        signal: ctl.signal,
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Could not find clips')
      const { suggestions } = await res.json() as { suggestions?: Suggestion[] }
      const list = suggestions ?? []
      setAiSuggestions(list)
      setAskFrom(null)
      // Keep the newest searches only
      const next = Object.fromEntries([...Object.entries(askSaved).filter(([k]) => k !== key), [key, list]].slice(-MAX_SAVED_SEARCHES))
      setAskSaved(next)
      writeSaved(askKey, next)
    } catch (e) {
      if (!isAbort(e)) setAiError(e instanceof Error ? e.message : 'Could not find clips')
    } finally {
      if (askAbort.current === ctl) { askAbort.current = null; setLoadingAi(false) }
    }
  }
  function cancelAsk() { askAbort.current?.abort(); askAbort.current = null; setLoadingAi(false) }
  function cancelMoments() { momentsAbort.current?.abort(); momentsAbort.current = null; setLoadingSuggestions(false) }

  // The second AI card: Ask AI or Best moments (one at a time, switched at its top)
  const [aiPane, setAiPane] = useState<'ask' | 'best'>('ask')

  const wide = useWide()
  // Clip previews are 9:16; the video keeps its own shape
  // The frame takes the video's own proportions once it loads, so it fits exactly (no empty bars)
  const [ratio, setRatio] = useState(16 / 9)
  // The metadata can arrive before the page is interactive (the <video> is server-rendered),
  // so also read the size once on mount
  useEffect(() => {
    const v = videoRef.current
    if (v && v.videoWidth && v.videoHeight) setRatio(v.videoWidth / v.videoHeight)
  }, [videoUrl])
  const frameRatio = viewMode === 'preview' ? 9 / 16 : ratio

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

  // ── Clip preview (in place of the video): the clip played in 9:16 as edited ──
  const previewed = clips.find(c => c.id === previewId) ?? null
  const previewData = previewId ? previews[previewId] : undefined
  const previewList = shownClips.some(c => c.id === previewId) ? shownClips : clips
  const previewIdx = previewList.findIndex(c => c.id === previewId)
  const previewPane = (
    <div className="w-full h-full flex items-center justify-center">
      {momentPreview ? (
        <ClipPlayer key={`m-${momentPreview.s.id}`} videoUrl={videoUrl} mainVideoId={video.id}
          startMs={momentPreview.s.start_ms} endMs={momentPreview.s.end_ms}
          segments={previewSegments([], momentPreview.s.end_ms - momentPreview.s.start_ms, ratio)}
          words={[]} captionStyle={null} textOverlays={[]} />
      ) : !previewed ? (
        <p className="text-sm px-6 text-center" style={{ color: 'rgba(255,255,255,0.5)' }}>No clips yet. Make a clip, then preview it here.</p>
      ) : previewData === 'loading' || previewData === undefined ? (
        <BrandLoader size={36} label="Loading preview…" />
      ) : 'error' in previewData ? (
        <p className="text-sm px-6 text-center" style={{ color: '#f87171' }}>{previewData.error}</p>
      ) : (
        <ClipPlayer key={previewData.id} videoUrl={videoUrl} mainVideoId={previewData.video_id} stockUrls={previewData.stockUrls}
          startMs={previewData.start_ms} endMs={previewData.end_ms}
          segments={previewSegments(previewData.segments, previewData.end_ms - previewData.start_ms, ratio)}
          words={previewData.words}
          // No saved style yet: captions off, as the editor opens a new clip
          captionStyle={previewData.captionStyle ?? null}
          textOverlays={previewData.textOverlays} />
      )}
    </div>
  )
  // Toggle between the video and clip previews, and (in preview) which clip and what to do with it
  const viewBar = isReady && (
    <div className="shrink-0 flex flex-col items-center gap-2">
      {/* A switch: two equal halves and a lime knob that slides (and stretches a little) to the
          picked side (styles: .view-switch in globals.css) */}
      <div role="tablist" aria-label="Show" className="view-switch" data-side={viewMode === 'preview' ? 'right' : 'left'}>
        <span className="view-switch-knob" aria-hidden="true" />
        {([['video', 'Video'], ['preview', 'Clip preview']] as const).map(([mode, label]) => (
          <button key={mode} type="button" role="tab" aria-selected={viewMode === mode}
            onClick={() => (mode === 'preview' ? showPreviewMode() : setViewMode('video'))}
            className="view-switch-opt" data-on={viewMode === mode || undefined}>
            {label}{mode === 'preview' && clips.length > 0 ? ` (${clips.length})` : ''}
          </button>
        ))}
      </div>
      {viewMode === 'preview' && momentPreview && (() => {
        const list = (momentPreview.source === 'clip_search' ? aiSuggestions : suggestions) ?? []
        const i = list.findIndex(x => x.id === momentPreview.s.id)
        return (
          <div className="w-full max-w-xl mx-auto flex items-center gap-2">
            <button type="button" aria-label="Previous result" disabled={i <= 0}
              onClick={() => previewMoment(list[i - 1], momentPreview.source)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-sm transition-colors hover:bg-white/10 disabled:opacity-30" style={{ color: '#fff' }}>‹</button>
            <p className="min-w-0 flex-1 text-sm font-medium text-white truncate text-center" title={momentPreview.s.title}>
              {momentPreview.s.title}
              <span className="ml-2 text-xs font-normal" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {momentPreview.source === 'clip_search' ? 'Ask AI' : 'Best moments'}{i >= 0 ? ` · ${i + 1} of ${list.length}` : ''}
              </span>
            </p>
            <button type="button" aria-label="Next result" disabled={i < 0 || i >= list.length - 1}
              onClick={() => previewMoment(list[i + 1], momentPreview.source)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-sm transition-colors hover:bg-white/10 disabled:opacity-30" style={{ color: '#fff' }}>›</button>
          </div>
        )
      })()}
      {viewMode === 'preview' && !momentPreview && previewed && (
        <div className="w-full max-w-xl mx-auto flex items-center gap-2">
          <button type="button" aria-label="Previous clip" disabled={previewIdx <= 0}
            onClick={() => previewClip(previewList[previewIdx - 1].id)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-sm transition-colors hover:bg-white/10 disabled:opacity-30" style={{ color: '#fff' }}>‹</button>
          <p className="min-w-0 flex-1 text-sm font-medium text-white truncate text-center" title={previewed.title ?? undefined}>
            {previewed.title ?? `Clip ${previewed.index}`}
            <span className="ml-2 text-xs font-normal" style={{ color: 'rgba(255,255,255,0.45)' }}>{previewIdx + 1} of {previewList.length}</span>
          </p>
          <button type="button" aria-label="Next clip" disabled={previewIdx < 0 || previewIdx >= previewList.length - 1}
            onClick={() => previewClip(previewList[previewIdx + 1].id)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-sm transition-colors hover:bg-white/10 disabled:opacity-30" style={{ color: '#fff' }}>›</button>
        </div>
      )}
    </div>
  )

  // ── Under the video: Edit full video + New clip (which opens the start/end form in place) ──
  // While a clip is shown in Preview, the first button edits that clip instead of the whole video
  const editingPreviewed = viewMode === 'preview' && !!previewId && clips.some(c => c.id === previewId)
  const editingMoment = viewMode === 'preview' && momentPreview ? momentPreview : null
  const newClipBar = showForm ? (
    <form className="shrink-0 rounded-2xl p-4 flex flex-col gap-3" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.14)' }}
      onSubmit={e => { e.preventDefault(); submitForm(true) }}>
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
          {/* Save it to the clip board only (edit it later) */}
          <button type="button" onClick={() => submitForm(false)} disabled={!!busy}
            title="Save this clip to your clip board without opening the editor"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:bg-white/10 disabled:opacity-50"
            style={{ color: '#fff', border: '1px solid rgba(255,255,255,0.22)' }}>
            {busy === 'board' ? <Spinner /> : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M12 9v6M9 12h6" />
              </svg>
            )}
            Add to board
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
    // Two equal-width, equal-height buttons: same border, weight and icon size, so they read as a pair
    <div className="shrink-0 grid grid-cols-2 gap-3 w-full max-w-md mx-auto">
      {/* Previewing a clip: this edits that clip; otherwise the whole video */}
      <button onClick={editingMoment ? () => editMoment(editingMoment.s, editingMoment.source)
          : editingPreviewed ? () => { setBusy('open'); router.push(`/editor/${previewId}`) } : editFullVideo} disabled={!!busy}
        title={editingMoment ? 'Open the moment you’re previewing in the editor' : editingPreviewed ? 'Open the clip you’re previewing in the editor' : 'Open the whole video in the editor as one clip'}
        className="h-12 flex items-center justify-center gap-2 px-5 rounded-xl text-sm font-semibold transition-colors hover:bg-white/10 disabled:opacity-40"
        style={{ color: 'rgba(255,255,255,0.9)', border: '1px solid rgba(255,255,255,0.16)', background: 'rgba(255,255,255,0.03)' }}>
        {busy === 'full' || ((editingPreviewed || editingMoment) && (busy === 'open' || busy === editingMoment?.s.id)) ? <Spinner /> : editingPreviewed || editingMoment ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" />
          </svg>
        )}
        {editingMoment ? 'Edit this moment' : editingPreviewed ? 'Edit this clip' : 'Edit full video'}
      </button>
      <button onClick={openForm} disabled={!!busy}
        className="h-12 flex items-center justify-center gap-2 px-5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
        style={{ background: ACCENT, color: '#000', border: `1px solid ${ACCENT}` }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
        New clip from <span className="tabular-nums">{msToDisplay(nowMs)}</span>
      </button>
    </div>
  )

  // ── AI tools: Ask AI + Best moments (left column on wide screens, under the video otherwise) ──
  const aiTools = (
    <>
      <section className="mmc shrink-0 p-3.5 flex flex-col gap-3 rounded-2xl" style={CARD}>
        {/* Header: a lime spark badge, the title and its ⓘ */}
        <div className="flex items-center gap-2.5">
          <span aria-hidden="true" className="mmc-badge shrink-0 w-8 h-8 rounded-[10px] grid place-items-center"
            style={{ background: 'rgba(200,255,0,0.1)', color: ACCENT, boxShadow: 'inset 0 0 0 1px rgba(200,255,0,0.22)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2l1.9 5.6L19.5 9.5l-5.6 1.9L12 17l-1.9-5.6L4.5 9.5l5.6-1.9z" />
              <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" opacity=".7" />
            </svg>
          </span>
          <h2 className="flex-1 min-w-0 flex items-center gap-1.5 text-sm font-semibold text-white">
            Make my clips
            <InfoTip label="About Make my clips">AI picks the best moments, frames them vertically and adds captions. Type or step how many clips you want (1 to {AUTO_MAX}), and tick what AI should add: captions, a title, motion (the frame follows people) and cuts (split / trio for 2+ people).</InfoTip>
          </h2>
        </div>

        {/* How many clips: type a number or step it with − / + (styles: .mmc-* in globals.css) */}
        <div className="flex items-center justify-between gap-3 pl-3 pr-1.5 py-1.5 rounded-xl"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <label htmlFor={`clip-count-${video.id}`} className="flex flex-col leading-tight">
            <span className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.8)' }}>How many clips?</span>
            <span className="text-[10px]" style={{ color: countOver ? '#fbbf24' : 'rgba(255,255,255,0.38)' }}>
              {countOver ? `Up to ${AUTO_MAX} at a time` : `1 to ${AUTO_MAX}`}
            </span>
          </label>
          <div className="mmc-count flex items-center rounded-lg" data-off={autoRunning || undefined}>
            <button type="button" className="mmc-step" aria-label="Fewer clips" onClick={() => setCount(autoCount - 1)}
              disabled={autoRunning || autoCount <= 1}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M5 12h14" /></svg>
            </button>
            <input id={`clip-count-${video.id}`} type="text" inputMode="numeric" autoComplete="off" maxLength={2}
              value={countText} disabled={autoRunning}
              onChange={e => {
                const t = e.target.value.replace(/\D/g, '').slice(0, 2)
                setCountText(t)
                const n = Number(t)
                if (t && n >= 1 && n <= AUTO_MAX) setAutoCount(n)
              }}
              onBlur={() => setCount(Number(countText) || autoCount)}
              onKeyDown={e => {
                if (e.key === 'Enter') e.currentTarget.blur()
                else if (e.key === 'ArrowUp') { e.preventDefault(); setCount(autoCount + 1) }
                else if (e.key === 'ArrowDown') { e.preventDefault(); setCount(autoCount - 1) }
              }}
              className="mmc-input w-10 h-8 text-center bg-transparent text-sm font-bold tabular-nums text-white outline-none" />
            <button type="button" className="mmc-step" aria-label="More clips" onClick={() => setCount(autoCount + 1)}
              disabled={autoRunning || autoCount >= AUTO_MAX}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
            </button>
          </div>
        </div>

        {/* What AI adds: four checkboxes (styles: .mmc-opt in globals.css) */}
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="What AI adds to each clip">
          {AUTO_OPTIONS.map(o => (
            <label key={o.id} title={o.tip} className="mmc-opt" data-on={autoOpts[o.id] || undefined} data-off={autoRunning || undefined}>
              <input type="checkbox" className="sr-only" checked={autoOpts[o.id]} disabled={autoRunning}
                onChange={() => toggleAutoOpt(o.id)} />
              <span className="mmc-opt-box" aria-hidden="true">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              </span>
              <span className="min-w-0 truncate">{o.label}</span>
            </label>
          ))}
        </div>

        {autoError && <p className="text-xs" style={{ color: '#f87171' }}>{autoError}</p>}
        {autoRunning && autoJob && (
          <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl" style={{ background: 'rgba(200,255,0,0.04)', border: '1px solid rgba(200,255,0,0.12)' }}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>
                {autoJob.status === 'queued' ? 'Waiting to start…' : autoJob.progress < 20 ? 'Reading the video…' : autoJob.progress < 35 ? 'Finding the best moments…' : 'Framing clips…'}
              </span>
              <span className="font-semibold tabular-nums" style={{ color: ACCENT }}>{autoJob.progress}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(3, autoJob.progress)}%`, background: ACCENT }} />
            </div>
            <div className="flex items-center gap-2">
              <p className="flex-1 text-[11px]" style={{ color: 'rgba(255,255,255,0.4)' }}>
                {autoJob.clip_count ? `${autoJob.clip_count} clip${autoJob.clip_count === 1 ? '' : 's'}` : ''}
              </p>
              <button type="button" onClick={stopMakingClips} disabled={autoStopping}
                title="Stop making clips (clips already made are kept)"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors hover:bg-red-500/20 disabled:opacity-50"
                style={{ color: '#fca5a5', border: '1px solid rgba(239,68,68,0.35)' }}>
                {autoStopping ? <Spinner /> : <span aria-hidden="true" className="w-2 h-2 rounded-[2px]" style={{ background: 'currentColor' }} />}
                {autoStopping ? 'Stopping…' : 'Stop'}
              </button>
            </div>
          </div>
        )}
        {autoJob?.status === 'failed' && autoJob.error === 'Cancelled by you' && (
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Stopped.{autoClips.length ? ' Clips made before you stopped are kept.' : ''} Press Make my clips to start again.
          </p>
        )}
        {autoJob?.status === 'failed' && autoJob.error !== 'Cancelled by you' && (
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
        {/* Main action last, under AI edits */}
        <button onClick={() => { setMakePulse(n => n + 1); makeClips() }} disabled={autoRunning || autoStarting}
          data-busy={autoRunning || autoStarting || undefined}
          className="ai-btn ai-make flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-bold disabled:opacity-40"
          style={{ background: ACCENT, color: '#000' }}>
          <span key={makePulse} className={`ai-fire${makePulse ? ' is-on' : ''}`} aria-hidden="true" />
          {autoStarting || autoRunning ? <Spinner /> : (
            <span key={`s${makePulse}`} className={`ai-spark${makePulse ? ' is-on' : ''}`} aria-hidden="true">
              ✦<i /><i /><i />
            </span>
          )} {autoRunning ? 'Making clips…' : `Make ${autoCount} clip${autoCount === 1 ? '' : 's'}`}
        </button>
      </section>

      {/* Ask AI and Best moments share one card: a switch at the top picks which one shows */}
      <section className="flex-1 min-h-[260px] p-3.5 flex flex-col gap-2.5 rounded-2xl" style={CARD}>
        <div className="shrink-0 flex items-center gap-2">
          {/* Segmented switch: a lime-edged tile slides under the picked side (styles: .ai-seg in globals.css) */}
          <div role="tablist" aria-label="Find clips with AI" className="ai-seg flex-1" data-side={aiPane === 'best' ? 'right' : 'left'}
            onKeyDown={e => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                const next = e.key === 'ArrowLeft' ? 'ask' : 'best'
                setAiPane(next)
                e.currentTarget.querySelector<HTMLButtonElement>(`[data-pane="${next}"]`)?.focus()
              }
            }}>
            <span className="ai-seg-knob" aria-hidden="true" />
            {([['ask', 'Ask AI'], ['best', 'Best moments']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={aiPane === id} tabIndex={aiPane === id ? 0 : -1}
                data-pane={id} onClick={() => setAiPane(id)} className="ai-seg-opt" data-on={aiPane === id || undefined}>
                {id === 'ask' ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.8A8 8 0 1 1 21 12z" />
                    <path d="M12 8.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" fill="currentColor" stroke="none" />
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" aria-hidden>
                    <path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z" />
                  </svg>
                )}
                <span>{label}</span>
                {id === 'best' && suggestions?.length ? <span className="ai-seg-badge tabular-nums">{suggestions.length}</span> : null}
              </button>
            ))}
          </div>
          {aiPane === 'ask'
            ? <InfoTip label="About Ask AI">Describe a moment — an emotion, a topic, a hot take — and AI finds matching clips. Press Use on a result to add it.</InfoTip>
            : <InfoTip label="About Best moments">AI picks the moments most likely to work as reels. Press + on the ones you want to add them to your clip board.</InfoTip>}
        </div>
        {aiPane === 'ask' && (<>
        <form className="shrink-0 flex gap-2" onSubmit={e => { e.preventDefault(); setFindPulse(n => n + 1); findByCriteria() }}>
          {/* While the box is empty, example searches are typed out left → right with a blinking
              caret, on a loop; the newest letters stay in view (styles: .ai-hint in globals.css) */}
          <div className="ai-hint-wrap relative min-w-0 flex-1">
            <input
              type="text"
              aria-label="What should AI look for? For example: funny reactions, controversial takes"
              value={aiCriteria}
              onChange={e => setAiCriteria(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm text-white outline-none focus:border-[#c8ff00]"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)' }}
            />
            {!aiCriteria && (
              <span className="ai-hint" aria-hidden="true">
                <span className="ai-hint-line"><span className="ai-hint-text">{typedHint}</span></span>
                <span className="ai-hint-caret" />
              </span>
            )}
          </div>
          <button type="submit" disabled={loadingAi || !aiCriteria.trim()} aria-label="Find" title="Find matching clips"
            data-busy={loadingAi || undefined}
            className="ai-btn ai-find shrink-0 w-10 flex items-center justify-center rounded-lg disabled:opacity-40"
            style={{ background: ACCENT, color: '#000' }}>
            <span key={findPulse} className={`ai-scan${findPulse ? ' is-on' : ''}`} aria-hidden="true" />
            {loadingAi ? <Spinner /> : (
              <svg key={`p${findPulse}`} className={`ai-ping${findPulse ? ' is-on' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            )}
          </button>
        </form>
        {/* One-tap searches */}
        <div className="shrink-0 flex flex-wrap gap-1.5">
          {ASK_CHIPS.map(q => (
            <button key={q} type="button" disabled={loadingAi}
              onClick={() => { setAiCriteria(q); setFindPulse(n => n + 1); findByCriteria(q) }}
              className="px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors hover:bg-white/10 disabled:opacity-40"
              style={{ color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.14)' }}>
              {q}
            </button>
          ))}
        </div>
        {/* Results scroll inside the card, so the card never grows */}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -mr-2 pr-2">
        {aiError && <p className="text-xs" style={{ color: '#f87171' }}>{aiError}</p>}
        {!loadingAi && askFrom && aiSuggestions && (
          <div className="shrink-0 flex items-center gap-2 text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
            <span className="flex-1 min-w-0 truncate">Saved results for “{askFrom}”</span>
            <button type="button" onClick={() => { setFindPulse(n => n + 1); findByCriteria(askFrom, true) }}
              title="Ask AI again for fresh results"
              className="shrink-0 flex items-center gap-1 px-1.5 py-0.5 rounded font-semibold transition-colors hover:bg-white/10" style={{ color: ACCENT }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></svg>
              Search again
            </button>
          </div>
        )}
        {loadingAi && (
          <div className="flex items-center gap-2 py-1.5">
            <p className="flex-1 flex items-center gap-2 text-xs" style={{ color: ACCENT }}><Spinner /> Scanning the transcript…</p>
            <CancelButton onClick={cancelAsk} title="Stop this search" />
          </div>
        )}
        {!loadingAi && aiSuggestions && aiSuggestions.length === 0 && (
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>Nothing matched that. Try a different description.</p>
        )}
        {!loadingAi && aiSuggestions?.map((s, i) => (
          <ResultCard key={s.id} s={s} rank={i + 1} videoUrl={videoUrl} busy={busy} inClips={!!clipFor(s)}
            open={viewMode === 'preview' && momentPreview?.s.id === s.id}
            onOpen={() => previewMoment(s, 'clip_search')} onClose={closeMoment}
            onEdit={() => editMoment(s, 'clip_search')} onAdd={() => addMomentToBoard(s, 'clip_search')} />
        ))}
        </div>
        </>)}

        {aiPane === 'best' && (<>
        {!suggestions && !loadingSuggestions && (
          <>
            {/* Spotlight: on hover the stars twinkle in turn and the edge warms to lime;
                on click a lime spotlight flashes out of the stars (styles: .ai-best in globals.css) */}
            <button onClick={() => { setBestPulse(n => n + 1); findMoments() }}
              className="ai-btn ai-best shrink-0 flex items-center justify-center gap-2 h-9 rounded-lg text-xs font-medium"
              style={{ color: 'rgba(255,255,255,0.85)' }}>
              <span key={bestPulse} className={`ai-spot${bestPulse ? ' is-on' : ''}`} aria-hidden="true" />
              <svg className="ai-stars" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ overflow: 'visible' }}>
                <path className="ai-star-big" d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" fill="currentColor"/>
                <path className="ai-star-small" d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16z" fill="currentColor"/>
              </svg>
              Find best moments
            </button>
          </>
        )}
        <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-2 -mr-2 pr-2">
        {loadingSuggestions && (
          <div className="flex items-center gap-2 py-1.5">
            <p className="flex-1 flex items-center gap-2 text-xs" style={{ color: ACCENT }}><Spinner /> Finding moments…</p>
            <CancelButton onClick={cancelMoments} title="Stop finding moments" />
          </div>
        )}
        {suggestionsError && <p className="text-xs" style={{ color: '#f87171' }}>{suggestionsError}</p>}
        {momentsAdded && <p className="text-xs font-semibold" style={{ color: ACCENT }}>{momentsAdded}</p>}
        {momentsNote && <p className="text-xs" style={{ color: '#fbbf24' }}>{momentsNote}</p>}
        {suggestions && !loadingSuggestions && suggestions.length === 0 && (
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.45)' }}>
            {clips.length ? 'No new moments — the strongest ones are already in your clips.' : 'No suggestions for this video.'}
          </p>
        )}
        {suggestions && suggestions.map((s, i) => (
          <ResultCard key={s.id} s={s} rank={i + 1} videoUrl={videoUrl} busy={busy} inClips={!!clipFor(s)}
            open={viewMode === 'preview' && momentPreview?.s.id === s.id}
            onOpen={() => previewMoment(s, 'best_moments')} onClose={closeMoment}
            onEdit={() => editMoment(s, 'best_moments')} onAdd={() => addMomentToBoard(s, 'best_moments')} />
        ))}
        </div>
        {suggestions && !loadingSuggestions && (
          <button onClick={findMoments} title="Find more moments (ones already listed or in your clips are skipped)"
            className="shrink-0 self-center flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md transition-colors hover:bg-white/10" style={{ color: ACCENT }}>
            View more suggestions
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        )}
        </>)}
      </section>
    </>
  )

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#0d0d0d' }}>
      {/* Opening a clip: covers the page while the clip is created and the editor loads */}
      {busy && <BrandLoaderScreen overlay label="Getting your clip ready, please wait…" />}
      {/* Nav */}
      <nav className="flex items-center gap-3 px-4 shrink-0"
        style={{ height: 56, background: '#111', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {/* Where am I: Shortcut | Dashboard › Clip board */}
        <Breadcrumbs shine items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Clip board' }]} />
        <div className="flex-1" />
        <AccountMenu />
      </nav>

      <div className="flex-1 flex gap-3 p-3 min-h-0 overflow-hidden" style={{ background: '#090909' }}>

        {/* ── Left: AI tools (wide screens) ─────────────────────── */}
        {wide && isReady && (
          <aside className="shrink-0 flex flex-col gap-3 p-3 min-h-0 overflow-y-auto" style={{ ...PANEL_CARD, width: 340 }}>
            {aiTools}
          </aside>
        )}

        {/* ── Centre: the video, as large as fits, with the new-clip bar right under it ── */}
        <main className="flex-1 min-w-0 flex flex-col gap-3 p-3 overflow-y-auto" style={PANEL_CARD}>
          {viewBar}
          {wide ? (
            // Container-query box: the player takes the biggest size (in the video's own shape) that fits both ways
            <div className="flex-1 min-h-0 flex items-center justify-center" style={{ containerType: 'size' }}>
              <div className="rounded-2xl overflow-hidden flex items-center justify-center bg-black"
                style={{ width: `min(100cqw, calc(100cqh * ${frameRatio}))`, aspectRatio: `${frameRatio}`, border: '1px solid rgba(255,255,255,0.08)' }}>
                {/* The video stays mounted (hidden) while a clip previews, so it keeps its place */}
                <div className="w-full h-full flex items-center justify-center" style={{ display: viewMode === 'video' ? 'flex' : 'none' }}>{player}</div>
                {viewMode === 'preview' && previewPane}
              </div>
            </div>
          ) : (
            <div className="w-full rounded-2xl overflow-hidden flex items-center justify-center bg-black shrink-0"
              style={{ aspectRatio: `${frameRatio}`, maxHeight: '70vh', margin: '0 auto', width: `min(100%, calc(70vh * ${frameRatio}))`, border: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="w-full h-full flex items-center justify-center" style={{ display: viewMode === 'video' ? 'flex' : 'none' }}>{player}</div>
              {viewMode === 'preview' && previewPane}
            </div>
          )}

          {isReady && newClipBar}

          {!wide && isReady && <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{ height: 420 }}>{aiTools}</div>}
        </main>

        {/* ── Right: your clips ─────────────────────────────────── */}
        <aside className="shrink-0 flex flex-col min-h-0 overflow-hidden" style={{ ...PANEL_CARD, width: 340 }}>
          <div className="px-4 pt-4 pb-3 flex items-center gap-2 shrink-0">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4V3h6v1M9 10h6M9 14h4" />
            </svg>
            <h2 className="text-sm font-semibold text-white">Clipboard</h2>
            {clips.length > 0 && (
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full" style={{ color: ACCENT, background: 'rgba(200,255,0,0.1)', border: '1px solid rgba(200,255,0,0.25)' }}>
                {clips.length} clip{clips.length === 1 ? '' : 's'}
              </span>
            )}
            <div className="flex-1" />
            {(selecting || shownClips.length > 0) && (() => {
              const all = shownClips.length > 0 && shownClips.every(c => selected.has(c.id))
              return (
                <label className="flex items-center gap-1.5 text-xs font-medium cursor-pointer select-none" style={{ color: 'rgba(255,255,255,0.75)' }}>
                  <input type="checkbox" checked={all}
                    onChange={() => {
                      if (all) { stopSelecting(); return }
                      setSelecting(true); setSelected(new Set(shownClips.map(c => c.id)))
                    }}
                    className="w-3.5 h-3.5 rounded" style={{ accentColor: ACCENT }} />
                  Select all
                </label>
              )
            })()}
          </div>
          {/* Sections: every clip, or only those from one place */}
          {clips.length > 0 && (
            <div role="tablist" aria-label="Clip sections" className="px-4 pb-3 flex flex-wrap gap-1.5 shrink-0">
              {CLIP_TABS.map(t => {
                const n = t.id === 'all' ? clips.length : t.id === 'fav' ? clips.filter(c => c.favorite).length : clips.filter(c => c.origin === t.id).length
                const on = clipTab === t.id
                const dot = t.id === 'all' || t.id === 'fav' ? null : ORIGIN_BADGE[t.id].color
                return (
                  <button key={t.id} type="button" role="tab" aria-selected={on}
                    onClick={() => { setClipTab(t.id); setSelected(new Set()) }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors hover:bg-white/10"
                    style={on
                      ? { background: 'rgba(255,255,255,0.14)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)' }
                      : { color: n ? 'rgba(255,255,255,0.65)' : 'rgba(255,255,255,0.35)', border: '1px solid rgba(255,255,255,0.1)' }}>
                    {dot && <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: dot }} />}
                    {t.id === 'fav' && <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 6 3.5 4.5 7.3C19.5 16.4 12 21 12 21z" /></svg>}
                    {t.label}
                    <span className="tabular-nums" style={{ opacity: 0.6 }}>{n}</span>
                  </button>
                )
              })}
            </div>
          )}
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
            {clips.length > 0 && shownClips.length === 0 && (
              <p className="text-xs leading-relaxed" style={{ color: 'rgba(255,255,255,0.45)' }}>
                {CLIP_TABS.find(t => t.id === clipTab)?.empty}
              </p>
            )}
            {shownClips.map((clip, idx) => (
              <ClipCard
                key={clip.id}
                id={clip.id}
                focused={focusClipId === clip.id}
                number={idx + 1}
                origin={clipTab === 'all' || clipTab === 'fav' ? clip.origin : undefined}
                videoUrl={videoUrl}
                favorite={!!clip.favorite}
                reason={clip.reason ?? null}
                onFavorite={() => toggleFavorite(clip.id)}
                onDelete={() => deleteOne(clip.id)}
                title={clip.title ?? `Clip ${clip.index}`}
                startMs={clip.start_ms}
                endMs={clip.end_ms}
                status={clip.status}
                outputUrl={clip.output_url}
                playing={nowMs >= clip.start_ms && nowMs < clip.end_ms}
                onSeek={() => seek(clip.start_ms)}
                onEdit={() => { setBusy('open'); router.push(`/editor/${clip.id}`) }}
                onPreview={() => previewClip(clip.id)}
                previewing={viewMode === 'preview' && previewId === clip.id}
                open={previewId === clip.id}
                onClose={() => { setPreviewId(null); setViewMode('video') }}
                onDownload={() => downloadClip(clip.id)}
                download={dlState[clip.id] === 'exporting' || clip.status === 'rendering' ? 'preparing'
                  : typeof dlState[clip.id] === 'object' ? 'failed' : 'ready'}
                disabled={!!busy}
                selecting={selecting}
                selected={selected.has(clip.id)}
                onToggle={() => toggleSelected(clip.id)}
              />
            ))}
            {clips.length > 0 && !selecting && (
              <div className="mt-1 shrink-0 flex items-start gap-2.5 px-3 py-2.5 rounded-xl" style={{ border: '1px solid rgba(200,255,0,0.25)', background: 'rgba(200,255,0,0.04)' }}>
                <svg className="shrink-0 mt-0.5" width="14" height="14" viewBox="0 0 24 24" fill={ACCENT} aria-hidden="true"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /></svg>
                <span className="flex flex-col">
                  <span className="text-xs font-semibold" style={{ color: ACCENT }}>Tip</span>
                  <span className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)' }}>Tap a clip to open it. You can preview, edit or download your clips anytime.</span>
                </span>
              </div>
            )}
          </div>

          {/* Select mode: what's ticked, and what to do with it */}
          {selecting && (() => {
            const allOn = shownClips.length > 0 && shownClips.every(c => selected.has(c.id))
            return (
              <div className="shrink-0 px-4 py-3 flex flex-col gap-2" style={{ borderTop: PANEL_LINE, background: PANEL_BG }} role="toolbar" aria-label="Selected clips">
                {deleteError && !confirmDelete && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{deleteError}</p>}
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-white flex-1" aria-live="polite">
                    {selected.size === 0 ? 'Tap clips to select them' : `${selected.size} selected`}
                  </span>
                  <button type="button" onClick={() => setSelected(allOn ? new Set() : new Set(shownClips.map(c => c.id)))}
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

/** A small "✕ Cancel" for a running AI search */
function CancelButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button type="button" onClick={onClick} title={title}
      className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors hover:bg-white/10 hover:text-white"
      style={{ color: 'rgba(255,255,255,0.7)', border: '1px solid rgba(255,255,255,0.16)' }}>
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
      Cancel
    </button>
  )
}

function Spinner() {
  return <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
}

/** A clip's picture: a frame from its start, with its number on it */
function ClipThumb({ videoUrl, atMs, number, w, h }: { videoUrl: string; atMs: number; number?: number; w: number; h: number }) {
  const src = useFrameAt(videoUrl, atMs)
  return (
    <span className="relative shrink-0 block rounded-lg overflow-hidden" style={{ width: w, height: h, background: 'rgba(255,255,255,0.06)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="" className="w-full h-full object-cover" />}
      {number != null && (
        <span className="absolute left-1 top-1 min-w-5 h-5 px-1 rounded-md flex items-center justify-center text-[11px] font-bold tabular-nums"
          style={{ background: 'rgba(0,0,0,0.72)', color: '#fff', border: '1px solid rgba(255,255,255,0.18)' }}>{number}</span>
      )}
    </span>
  )
}

const ClockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
)
function Heart({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill={on ? ACCENT : 'none'} stroke={on ? ACCENT : 'currentColor'} strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 21s-7.5-4.6-9.5-9.2C1 8 3.4 4.5 7 4.5c2 0 3.6 1.1 5 3 1.4-1.9 3-3 5-3 3.6 0 6 3.5 4.5 7.3C19.5 16.4 12 21 12 21z" />
    </svg>
  )
}

/**
 * An Ask AI / Best moments result, like a clip card: slim (picture, title, length, +) until clicked;
 * clicked, it opens and plays in Preview with Preview · Edit · Add. Clicking it again closes it.
 */
function ResultCard({ s, rank, videoUrl, busy, inClips, open, onOpen, onClose, onEdit, onAdd }: {
  s: Suggestion; rank: number; videoUrl: string; busy: string | null
  /** Already a clip on the board (Add then shows it there) */
  inClips: boolean
  open: boolean
  onOpen: () => void; onClose: () => void; onEdit: () => void; onAdd: () => void
}) {
  const working = busy === s.id
  const score = typeof s.score === 'number' && (
    <span title="Viral score (0–99)" className="shrink-0 px-1.5 py-px rounded-md text-[10px] font-bold tabular-nums"
      style={{ color: ACCENT, background: 'rgba(200,255,0,0.1)', border: '1px solid rgba(200,255,0,0.25)' }}>{s.score}</span>
  )
  const addIcon = inClips
    ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
    : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
  const click = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return
    if (open) onClose(); else onOpen()
  }
  const keys = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); if (open) onClose(); else onOpen() }
  }

  if (!open) {
    return (
      <div role="button" tabIndex={0} onClick={click} onKeyDown={keys} title={`${s.title} · click to preview`}
        className="shrink-0 flex items-center gap-3 rounded-xl p-2 min-h-[68px] cursor-pointer transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', outlineColor: ACCENT }}>
        <ClipThumb videoUrl={videoUrl} atMs={s.start_ms} number={rank} w={84} h={48} />
        <span className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-sm font-semibold text-white leading-snug line-clamp-2 break-words">{s.title}</span>
          <span className="flex items-center gap-1.5 text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <ClockIcon />{durLabel(s.start_ms, s.end_ms)}
            {score}
          </span>
        </span>
        <button type="button" onClick={onAdd} disabled={!!busy} aria-label={inClips ? 'In your clips — show it' : 'Add to your clips'}
          title={inClips ? 'In your clips — show it' : 'Add to your clips'}
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center transition-opacity hover:opacity-90 disabled:opacity-40"
          style={inClips ? { color: ACCENT, border: `1px solid ${ACCENT}` } : { background: ACCENT, color: '#000' }}>
          {working ? <Spinner /> : addIcon}
        </button>
      </div>
    )
  }

  return (
    <div role="button" tabIndex={0} onClick={click} onKeyDown={keys} title="Click to close"
      className="shrink-0 rounded-xl p-2.5 cursor-pointer transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2"
      style={{ background: 'rgba(200,255,0,0.03)', border: `1px solid ${ACCENT}`, outlineColor: ACCENT }}>
      <div className="flex items-start gap-3">
        <ClipThumb videoUrl={videoUrl} atMs={s.start_ms} number={rank} w={112} h={64} />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <p className="text-sm font-semibold text-white leading-snug line-clamp-2" title={s.title}>{s.title}</p>
          <span className="flex items-center gap-1.5 text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.65)' }}>
            <ClockIcon />{msToDisplay(s.start_ms)} – {msToDisplay(s.end_ms)}
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>· {durLabel(s.start_ms, s.end_ms)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            {score}
            {inClips && <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: ACCENT }}>✓ In your clips</span>}
          </span>
        </div>
      </div>
      {(s.summary || s.reason) && (
        <p className="mt-2 text-[11px] leading-relaxed line-clamp-3" style={{ color: 'rgba(255,255,255,0.5)' }}>{s.summary || s.reason}</p>
      )}
      {/* Preview (playing now) · Edit · Add */}
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <span className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold"
          style={{ color: ACCENT, border: '1px solid rgba(200,255,0,0.5)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
          Previewing
        </span>
        <button type="button" onClick={onEdit} disabled={!!busy} title={inClips ? 'Open this clip in the editor' : 'Make it a clip and open it in the editor'}
          className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-white/10 disabled:opacity-40"
          style={{ color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.14)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
          Edit
        </button>
        <button type="button" onClick={onAdd} disabled={!!busy} title={inClips ? 'Show it in your clips' : 'Add it to your clip board'}
          className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-40"
          style={inClips ? { color: ACCENT, border: `1px solid ${ACCENT}` } : { background: ACCENT, color: '#000' }}>
          {working ? <Spinner /> : addIcon}
          {inClips ? 'Added' : 'Add'}
        </button>
      </div>
    </div>
  )
}

function ClipCard({ id, focused, number, origin, title, startMs, endMs, status, outputUrl, playing, onSeek, onEdit, onPreview, previewing, open, onClose, disabled, selecting, selected, onToggle, videoUrl, favorite, reason, onFavorite, onDelete, onDownload, download }: {
  id: string
  /** Download: saves the file, exporting it first if it isn't exported yet (e.g. AI's clips) */
  onDownload: () => void
  /** preparing: exporting, saves by itself when ready · failed: the last try didn't work */
  download: 'ready' | 'preparing' | 'failed'
  videoUrl: string
  favorite: boolean
  /** Why AI picked it (Make my clips), when we have it */
  reason: string | null
  onFavorite: () => void
  onDelete: () => void
  /** Clicking the opened card again: it closes back to the slim card (and the preview closes) */
  onClose?: () => void
  /** The opened card (the one being previewed): everything shows. The others are slim */
  open?: boolean
  onPreview: () => void
  previewing?: boolean
  /** Just jumped to (e.g. from Best moments): shown open, outlined for a moment */
  focused?: boolean
  number: number
  /** Shown in "All clips" / "Favorites": which section the clip belongs to */
  origin?: ClipOrigin
  title: string
  startMs: number
  endMs: number
  status: string
  outputUrl: string | null
  playing: boolean
  onSeek: () => void
  onEdit: () => void
  disabled?: boolean
  /** Select mode: the whole card toggles its tick */
  selecting?: boolean
  selected?: boolean
  onToggle?: () => void
}) {
  const [menu, setMenu] = useState<false | 'open' | 'confirm'>(false)
  const chip =
    status === 'rendering' ? { label: 'Rendering', color: ACCENT } :
    status === 'done' ? { label: 'Exported', color: '#4ade80' } :
    status === 'failed' ? { label: 'Render failed', color: '#f87171' } :
    { label: 'Draft', color: 'rgba(255,255,255,0.45)' }
  const border = selected || focused || previewing ? ACCENT : playing ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.07)'
  const heart = (
    <button type="button" onClick={e => { e.stopPropagation(); onFavorite() }} aria-pressed={favorite}
      aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'} title={favorite ? 'Remove from favorites' : 'Add to favorites'}
      className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.6)' }}>
      <Heart on={favorite} />
    </button>
  )

  // Slim: picture, title, length and the heart; clicking it opens it (and its preview)
  if (!open && !focused && !selecting) {
    return (
      <div id={`clip-${id}`} role="button" tabIndex={0}
        onClick={e => { if (!disabled && !(e.target as HTMLElement).closest('button')) onPreview() }}
        onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !disabled && e.target === e.currentTarget) { e.preventDefault(); onPreview() } }}
        title={`${title} · click to open and preview`}
        className="group flex items-center gap-3 rounded-xl p-2 min-h-[68px] cursor-pointer transition-colors hover:bg-white/[0.05] focus-visible:outline focus-visible:outline-2"
        style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${playing ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.07)'}`, outlineColor: ACCENT }}>
        <ClipThumb videoUrl={videoUrl} atMs={startMs} number={number} w={84} h={48} />
        <span className="flex-1 min-w-0 flex flex-col gap-1">
          <span className="text-sm font-semibold text-white leading-snug line-clamp-2 break-words">{title}</span>
          <span className="flex items-center gap-1.5 text-[11px] tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>
            <ClockIcon />{durLabel(startMs, endMs)}
            {status === 'rendering' && <span className="flex items-center gap-1" style={{ color: ACCENT }}>· <Spinner /> Exporting</span>}
          </span>
        </span>
        {heart}
      </div>
    )
  }

  return (
    <div id={`clip-${id}`} className={`rounded-xl p-2.5 transition-all duration-300 ${focused ? 'shadow-[0_0_0_3px_rgba(200,255,0,0.25)]' : ''} ${selecting ? 'cursor-pointer select-none hover:bg-white/[0.06] focus-visible:outline focus-visible:outline-2' : 'cursor-pointer hover:bg-white/[0.04]'}`}
      style={{ background: selected ? 'rgba(200,255,0,0.06)' : 'rgba(255,255,255,0.03)', border: `1px solid ${border}`, outlineColor: ACCENT }}
      {...(selecting ? {
        role: 'checkbox',
        'aria-checked': !!selected,
        'aria-label': `Select ${title}`,
        tabIndex: 0,
        onClick: onToggle,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); onToggle?.() } },
      } : {
        // Clicking the card (not one of its buttons): opened → closes back to the slim card; else previews it
        onClick: (e: React.MouseEvent) => {
          if (disabled || (e.target as HTMLElement).closest('button, a, input, label')) return
          if (open && onClose) onClose(); else onPreview()
        },
        title: open ? 'Click to close' : 'Click to preview this clip',
      })}>
      <div className="flex items-start gap-3">
        {selecting ? (
          <span aria-hidden="true" className="shrink-0 mt-1 w-6 h-6 rounded-full flex items-center justify-center transition-colors"
            style={selected
              ? { background: ACCENT, border: `2px solid ${ACCENT}`, color: '#000' }
              : { background: 'transparent', border: '2px solid rgba(255,255,255,0.45)' }}>
            {selected && <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          </span>
        ) : null}
        <ClipThumb videoUrl={videoUrl} atMs={startMs} number={number} w={112} h={64} />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          <div className="flex items-start gap-1">
            <p className="flex-1 min-w-0 text-sm font-semibold text-white leading-snug line-clamp-2" title={title}>{title}</p>
            {!selecting && heart}
            {!selecting && (
              <span className="relative shrink-0">
                <button type="button" onClick={e => { e.stopPropagation(); setMenu(m => m ? false : 'open') }} aria-label="More" title="More"
                  className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
                </button>
                {menu && (
                  <span className="absolute right-0 top-8 z-20 flex flex-col p-1 rounded-lg min-w-[150px]" onClick={e => e.stopPropagation()}
                    style={{ background: '#1a1a1a', border: '1px solid rgba(255,255,255,0.12)', boxShadow: '0 12px 30px -8px rgba(0,0,0,0.8)' }}>
                    {menu === 'open' ? (
                      <>
                        <button type="button" onClick={() => { setMenu(false); onEdit() }} className="px-2.5 py-1.5 rounded-md text-left text-xs text-white hover:bg-white/10">Open in editor</button>
                        <button type="button" onClick={() => { setMenu(false); onSeek() }} className="px-2.5 py-1.5 rounded-md text-left text-xs text-white hover:bg-white/10">Play in the video</button>
                        <button type="button" onClick={() => setMenu('confirm')} className="px-2.5 py-1.5 rounded-md text-left text-xs hover:bg-white/10" style={{ color: '#f87171' }}>Delete clip</button>
                      </>
                    ) : (
                      <>
                        <span className="px-2.5 py-1.5 text-xs text-white">Delete this clip?</span>
                        <span className="flex gap-1 px-1 pb-1">
                          <button type="button" onClick={() => setMenu(false)} className="flex-1 px-2 py-1 rounded-md text-xs hover:bg-white/10" style={{ color: 'rgba(255,255,255,0.7)' }}>Cancel</button>
                          <button type="button" onClick={() => { setMenu(false); onDelete() }} className="flex-1 px-2 py-1 rounded-md text-xs font-semibold" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>Delete</button>
                        </span>
                      </>
                    )}
                  </span>
                )}
              </span>
            )}
          </div>
          <button type="button" onClick={e => { e.stopPropagation(); onSeek() }} title="Play this clip in the video"
            className="self-start flex items-center gap-1.5 text-xs tabular-nums transition-colors hover:text-white" style={{ color: 'rgba(255,255,255,0.65)' }}>
            <ClockIcon />{msToDisplay(startMs)} – {msToDisplay(endMs)}
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>· {durLabel(startMs, endMs)}</span>
          </button>
          <div className="flex items-center gap-1.5 flex-wrap">
            {origin && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                style={{ color: ORIGIN_BADGE[origin].color, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full" style={{ background: ORIGIN_BADGE[origin].color }} />
                {ORIGIN_BADGE[origin].label}
              </span>
            )}
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: chip.color }}>
              {status === 'rendering' ? <Spinner /> : <span className="w-1.5 h-1.5 rounded-full" style={{ background: chip.color }} />}
              {chip.label}
            </span>
          </div>
        </div>
      </div>
      {reason && !selecting && <p className="mt-2 text-[11px] leading-relaxed line-clamp-2" style={{ color: 'rgba(255,255,255,0.5)' }}>{reason}</p>}
      {/* Preview · Edit · Download */}
      {!selecting && (
        <div className="mt-2.5 grid grid-cols-3 gap-1.5">
          <button onClick={e => { e.stopPropagation(); onPreview() }} aria-pressed={!!previewing} title="Play this clip as edited, in 9:16"
            className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-white/10"
            style={{ color: previewing ? ACCENT : 'rgba(255,255,255,0.85)', border: `1px solid ${previewing ? 'rgba(200,255,0,0.5)' : 'rgba(255,255,255,0.14)'}` }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
            {previewing ? 'Previewing' : 'Preview'}
          </button>
          <button onClick={e => { e.stopPropagation(); onEdit() }} disabled={disabled} title="Open in the editor"
            className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-white/10 disabled:opacity-40"
            style={{ color: 'rgba(255,255,255,0.85)', border: '1px solid rgba(255,255,255,0.14)' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z" /></svg>
            Edit
          </button>
          <button onClick={e => { e.stopPropagation(); onDownload() }} disabled={download === 'preparing'}
            title={download === 'preparing' ? 'Exporting — it downloads by itself when ready'
              : download === 'failed' ? 'The export failed — try again'
              : outputUrl && status === 'done' ? 'Download the exported reel' : 'Export this clip as it is, then download it'}
            className="h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-bold transition-opacity hover:opacity-90 disabled:opacity-70"
            style={download === 'failed' ? { color: '#f87171', border: '1px solid rgba(239,68,68,0.45)' } : { background: ACCENT, color: '#000' }}>
            {download === 'preparing' ? <Spinner /> : (
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M7 2v7M4 7l3 3 3-3M2 11.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            )}
            {download === 'preparing' ? 'Preparing' : download === 'failed' ? 'Retry' : 'Download'}
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The clip's formats as the editor would open them: a clip never opened has none (one centred
 * Vertical), and a crop box never framed has no keyframes (the layout's default framing).
 */
function previewSegments(segments: SegmentLocal[], lengthMs: number, videoAR: number): SegmentLocal[] {
  if (!segments.length) {
    return [{
      id: 'preview', start_ms: 0, end_ms: lengthMs, layout: 'vertical', sort_order: 0, frame: null,
      crop_boxes: [makeBox(0, 'vertical', 0, [{ t_ms: 0, ...defaultCropForSlot('vertical', 0, videoAR) }])],
    } as SegmentLocal]
  }
  return segments.map(seg => ({
    ...seg,
    crop_boxes: seg.crop_boxes.map((b, i) => (b.keyframes.length ? b : {
      ...b, keyframes: [{ t_ms: seg.start_ms, ...defaultCropForSlot(seg.layout, b.slot_index ?? i, videoAR) }],
    })),
  }))
}
