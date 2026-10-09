'use client'

import { useEffect, useRef, useState } from 'react'
import { ACCEPTED_VIDEO_EXTENSIONS } from '@chai-cut/shared'
import { useVideoUpload } from '@/modules/upload/useVideoUpload'
import { STOCK_DRAG_TYPE } from './SegmentTimeline'

export interface StockResult {
  ref: string; provider: string; title: string
  thumb: string; preview: string; url: string
  width: number; height: number; duration: number
}
export interface BrollShot { id: string; start_ms: number; end_ms: number; title: string }

const CATEGORIES = ['City', 'People', 'Nature', 'Office', 'Food', 'Technology', 'Crowd', 'Travel']

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 100) / 10); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }
const muted = (a: number) => `rgb(var(--ed-fg) / ${a})`

/**
 * B-roll: stock shots over the clip while the speaker keeps talking. AI ideas and categories to
 * start from, search, hover to preview, add at the playhead; the shots already in the clip can be
 * moved, lengthened or removed (or dragged on the timeline).
 */
type BrollTab = 'search' | 'upload' | 'clip'

export function BrollPanel({ clipId, currentTimeMs, shots, selectedId = null, focusId = null, onAdd, onUploaded, onMove, onResize, onRemove, onSeek, settings, searchOnly = false }: {
  clipId: string
  currentTimeMs: number
  shots: BrollShot[]
  /** The shot picked on the timeline: highlighted and scrolled into view */
  selectedId?: string | null
  /** A shot the user just picked (or added): the "In this clip" tab opens on it */
  focusId?: string | null
  onAdd: (item: StockResult, lengthMs: number) => Promise<void>
  /** A video uploaded from the device in the Upload tab: put in as B-roll at the playhead */
  onUploaded?: (videoId: string) => Promise<void> | void
  onMove: (id: string, deltaMs: number) => void
  onResize: (id: string, deltaMs: number) => void
  onRemove: (id: string) => void
  onSeek: (ms: number) => void
  /** The B-roll already in the clip, with all its settings (VideoPanel): shown instead of the short list */
  settings?: React.ReactNode
  /** Only the stock search (Media ▸ Library): no Upload / In this clip tabs */
  searchOnly?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockResult[] | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ideas, setIdeas] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<StockResult | null>(null)
  const [adding, setAdding] = useState(false)
  const asked = useRef('')
  // Search | Upload | In this clip: each part of B-roll on its own tab, like other editors
  const [tabState, setTab] = useState<BrollTab>(focusId ? 'clip' : 'search')
  const tab: BrollTab = searchOnly ? 'search' : tabState
  useEffect(() => { if (focusId) setTab('clip') }, [focusId])
  const shotsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectedId) shotsRef.current?.querySelector(`[data-shot-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])

  // Ideas for this clip, once
  useEffect(() => {
    let alive = true
    fetch(`/api/clips/${clipId}/broll-ideas`).then(r => r.ok ? r.json() : { ideas: [] })
      .then(d => { if (alive) setIdeas(d.ideas ?? []) }).catch(() => { if (alive) setIdeas([]) })
    return () => { alive = false }
  }, [clipId])

  async function search(q: string) {
    const term = q.trim()
    if (!term) return
    setQuery(term); asked.current = term
    setSearching(true); setError(null); setPicked(null)
    try {
      const res = await fetch(`/api/stock/search?q=${encodeURIComponent(term)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Search failed')
      if (asked.current !== term) return
      setProvider(data.provider)
      setResults(data.items ?? [])
      if (!data.provider) setError('Stock video search is not set up (PIXABAY_API_KEY).')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function add() {
    if (!picked) return
    setAdding(true); setError(null)
    // The whole stock video goes in (up to the clip's end); its handles trim it
    const len = picked.duration > 0 ? Math.round(picked.duration * 1000) : 5000
    try { await onAdd(picked, len); setPicked(null); setTab('clip') } catch (e) { setError(e instanceof Error ? e.message : 'Could not add it') } finally { setAdding(false) }
  }

  const chip = (label: string, accent = false) => (
    <button key={label} onClick={() => search(label)}
      className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
      style={accent
        ? { background: 'rgba(200,255,0,0.12)', color: 'var(--ed-accent-text)', border: '1px solid rgba(200,255,0,0.3)' }
        : { background: muted(0.06), color: muted(0.75), border: `1px solid ${muted(0.08)}` }}>
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-3 p-4 min-h-0">
      {!searchOnly && <div role="tablist" aria-label="B-roll" className="grid grid-cols-3 gap-0.5 p-0.5 rounded-lg" style={{ background: muted(0.06) }}>
        {([['search', 'Search'], ['upload', 'Upload'], ['clip', `In this clip${shots.length ? ` (${shots.length})` : ''}`]] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className="h-8 rounded-md text-[11.5px] font-semibold transition-colors"
            style={tab === id ? { background: muted(0.16), color: 'var(--ed-text)' } : { color: muted(0.55) }}>
            {label}
          </button>
        ))}
      </div>}

      {tab === 'search' && (<>
        {/* Search */}
        <form onSubmit={e => { e.preventDefault(); search(query) }} className="flex gap-1.5">
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search stock videos…"
            aria-label="Search stock videos"
            className="min-w-0 flex-1 px-3 py-2 rounded-lg text-sm outline-none"
            style={{ background: muted(0.06), border: `1px solid ${muted(0.1)}`, color: 'var(--ed-text)' }} />
          <button type="submit" disabled={searching || !query.trim()}
            className="shrink-0 px-3 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: '#c8ff00', color: '#000' }}>
            {searching ? '…' : 'Search'}
          </button>
        </form>

        {/* Starting points: AI ideas for this clip, then categories */}
        <div className="flex flex-col gap-1.5">
          {ideas === null && <span className="text-[11px]" style={{ color: muted(0.45) }}>Finding ideas for this clip…</span>}
          {ideas && ideas.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] self-center" style={{ color: muted(0.45) }}>✦ For this clip</span>
              {ideas.map(i => chip(i, true))}
            </div>
          )}
          <div className="flex flex-wrap gap-1.5">{CATEGORIES.map(c => chip(c))}</div>
        </div>

        {error && <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>}

        {/* Results */}
        {results && (
          results.length === 0 && !searching
            ? <p className="text-xs" style={{ color: muted(0.5) }}>No videos for “{asked.current}”. Try other words.</p>
            : (
              <div className="grid grid-cols-2 gap-1.5 overflow-y-auto -mr-2 pr-2" style={{ maxHeight: 300 }}>
                {results.map(r => (
                  <StockTile key={r.ref} item={r} selected={picked?.ref === r.ref} onPick={() => setPicked(p => p?.ref === r.ref ? null : r)} />
                ))}
              </div>
            )
        )}

        {/* Add the picked shot at the playhead */}
        {picked && (
          <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: muted(0.05), border: `1px solid ${muted(0.1)}` }}>
            <span className="text-[11px] tabular-nums" style={{ color: muted(0.55) }}>{picked.duration}s</span>
            <button onClick={add} disabled={adding}
              className="flex-1 py-1.5 rounded-md text-xs font-bold disabled:opacity-50" style={{ background: '#c8ff00', color: '#000' }}>
              {adding ? 'Adding…' : `Add at ${fmt(currentTimeMs)}`}
            </button>
          </div>
        )}

        {provider && <p className="text-[10px]" style={{ color: muted(0.35) }}>Videos from {provider === 'pexels' ? 'Pexels' : 'Pixabay'}. The speaker keeps talking under each shot.</p>}
      </>)}

      {tab === 'upload' && <UploadBroll currentTimeMs={currentTimeMs} onUploaded={async id => { await onUploaded?.(id); setTab('clip') }} />}

      {tab === 'clip' && (<>
        {/* Shots in this clip: their full settings when given, else a short list */}
        {settings}
        {!settings && shots.length > 0 && (
          <div ref={shotsRef} className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ color: muted(0.5) }}>In this clip</span>
            {shots.map(s => (
              <div key={s.id} data-shot-id={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
                style={{ background: muted(s.id === selectedId ? 0.08 : 0.04), border: `1px solid ${s.id === selectedId ? '#f97316' : muted(0.07)}` }}>
                <button onClick={() => onSeek(s.start_ms)} className="flex-1 min-w-0 text-left" title="Go to this shot">
                  <p className="text-xs truncate" style={{ color: 'var(--ed-text)' }}>{s.title}</p>
                  <p className="text-[10px] tabular-nums" style={{ color: muted(0.5) }}>{fmt(s.start_ms)} · {((s.end_ms - s.start_ms) / 1000).toFixed(1)}s</p>
                </button>
                <IconBtn label="Earlier" onClick={() => onMove(s.id, -500)}>‹</IconBtn>
                <IconBtn label="Later" onClick={() => onMove(s.id, 500)}>›</IconBtn>
                <IconBtn label="Shorter" onClick={() => onResize(s.id, -500)}>−</IconBtn>
                <IconBtn label="Longer" onClick={() => onResize(s.id, 500)}>+</IconBtn>
                <IconBtn label="Remove" onClick={() => onRemove(s.id)}>✕</IconBtn>
              </div>
            ))}
          </div>
        )}

        {!shots.length && <p className="text-xs" style={{ color: muted(0.5) }}>No B-roll in this clip yet. Find stock footage under Search, or upload your own under Upload.</p>}
      </>)}
    </div>
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className="shrink-0 w-6 h-6 rounded-md text-xs font-bold transition-colors hover:bg-[rgb(var(--ed-fg)/0.12)]"
      style={{ color: muted(0.7) }}>
      {children}
    </button>
  )
}

/** A result: still image, plays its small preview while hovered */
function StockTile({ item, selected, onPick }: { item: StockResult; selected: boolean; onPick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button onClick={onPick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      // Drag it onto the timeline to put it in at that spot
      draggable onDragStart={e => { e.dataTransfer.setData(STOCK_DRAG_TYPE, JSON.stringify(item)); e.dataTransfer.effectAllowed = 'copy' }}
      title={`${item.title} · click to pick it, or drag it onto the timeline`}
      className="relative rounded-md overflow-hidden bg-black" style={{ aspectRatio: '16 / 10', outline: selected ? '2px solid #c8ff00' : 'none', outlineOffset: -2 }}>
      {hover
        ? <video src={item.preview} poster={item.thumb || undefined} autoPlay muted loop playsInline className="w-full h-full object-cover" />
        : item.thumb
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={item.thumb} alt={item.title} loading="lazy" className="w-full h-full object-cover" />
          // Some stock results come without a still (thumb is ''): show the preview's first frame instead
          : <video src={item.preview} muted playsInline preload="metadata" aria-label={item.title} className="w-full h-full object-cover" />}
      <span className="absolute right-1 bottom-1 px-1 rounded text-[9px] font-semibold tabular-nums text-white" style={{ background: 'rgba(0,0,0,0.6)' }}>
        {item.duration}s
      </span>
      {item.height > item.width && (
        <span className="absolute left-1 bottom-1 px-1 rounded text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.6)' }}>9:16</span>
      )}
    </button>
  )
}

/**
 * Upload: a video from the device, put in as B-roll at the playhead (5 s, or less when the video is
 * shorter). It is saved as one of the user's assets (off the dashboard, not counted as a video).
 */
function UploadBroll({ currentTimeMs, onUploaded }: { currentTimeMs: number; onUploaded: (videoId: string) => Promise<void> | void }) {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const upload = useVideoUpload(async videoId => {
    try { await onUploaded(videoId); setFile(null) } catch (e) { setError(e instanceof Error ? e.message : 'Could not add it') }
  }, { asset: true })
  const busy = upload.state.phase === 'uploading' || upload.state.phase === 'finishing'
  const failed = upload.state.phase === 'failed' ? upload.state.error : null
  return (
    <div className="flex flex-col gap-3">
      <input ref={inputRef} type="file" accept={ACCEPTED_VIDEO_EXTENSIONS.join(',')} className="hidden" aria-label="Choose a video for B-roll"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { upload.cancel(); setError(null); setFile(f) } }} />
      {!file ? (
        <button type="button" onClick={() => inputRef.current?.click()}
          className="flex flex-col items-center justify-center gap-2 rounded-xl py-8 transition-colors hover:bg-[rgb(var(--ed-fg)/0.04)]"
          style={{ border: `2px dashed ${muted(0.14)}` }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: muted(0.7) }} aria-hidden="true"><path d="M12 16V8M8 12l4-4 4 4M4 20h16" /></svg>
          <span className="text-sm font-semibold text-[var(--ed-text)]">Upload B-roll from your device</span>
          <span className="text-[11px]" style={{ color: muted(0.45) }}>MP4, MOV, WebM, MKV · added at {fmt(currentTimeMs)}</span>
        </button>
      ) : (
        <div className="flex items-center gap-2.5 p-2.5 rounded-lg" style={{ background: muted(0.05), border: `1px solid ${muted(0.1)}` }}>
          <span className="flex-1 min-w-0 flex flex-col">
            <span className="text-xs font-semibold truncate text-[var(--ed-text)]">{file.name}</span>
            <span className="text-[11px]" style={{ color: muted(0.45) }}>{(file.size / 1024 / 1024).toFixed(1)} MB</span>
          </span>
          {!busy && <button type="button" onClick={() => { upload.cancel(); setFile(null) }} aria-label="Remove this file" className="text-xs px-1" style={{ color: muted(0.5) }}>✕</button>}
        </div>
      )}
      {busy && (
        <div>
          <div className="flex justify-between text-[11px] mb-1" style={{ color: muted(0.5) }}>
            <span>{upload.state.phase === 'finishing' ? 'Finishing…' : 'Uploading…'}</span><span className="tabular-nums">{upload.state.progress}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: muted(0.1) }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${upload.state.progress}%`, background: '#c8ff00' }} />
          </div>
        </div>
      )}
      {(failed || error) && <p className="text-xs" style={{ color: '#f87171' }}>{failed ?? error}</p>}
      <button type="button" disabled={!file || busy || (upload.state.phase === 'failed' && !upload.state.canRetry)}
        onClick={() => { setError(null); if (upload.state.phase === 'failed' && upload.state.canRetry) upload.retry(); else if (file) upload.start(file) }}
        className="py-2 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: '#c8ff00', color: '#000' }}>
        {upload.state.phase === 'failed' && upload.state.canRetry ? `Retry from ${upload.state.progress}%` : busy ? 'Uploading…' : `Upload & add at ${fmt(currentTimeMs)}`}
      </button>
    </div>
  )
}
