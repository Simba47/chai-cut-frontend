'use client'

import { useEffect, useRef, useState } from 'react'

export interface StockResult {
  ref: string; provider: string; title: string
  thumb: string; preview: string; url: string
  width: number; height: number; duration: number
}
export interface BrollShot { id: string; start_ms: number; end_ms: number; title: string }

const CATEGORIES = ['City', 'People', 'Nature', 'Office', 'Food', 'Technology', 'Crowd', 'Travel']
const LENGTHS = [2000, 3000, 5000]

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 100) / 10); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }
const muted = (a: number) => `rgb(var(--ed-fg) / ${a})`

/**
 * B-roll: stock shots over the clip while the speaker keeps talking. AI ideas and categories to
 * start from, search, hover to preview, add at the playhead; the shots already in the clip can be
 * moved, lengthened or removed (or dragged on the timeline).
 */
export function BrollPanel({ clipId, currentTimeMs, shots, onAdd, onMove, onResize, onRemove, onSeek }: {
  clipId: string
  currentTimeMs: number
  shots: BrollShot[]
  onAdd: (item: StockResult, lengthMs: number) => Promise<void>
  onMove: (id: string, deltaMs: number) => void
  onResize: (id: string, deltaMs: number) => void
  onRemove: (id: string) => void
  onSeek: (ms: number) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockResult[] | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ideas, setIdeas] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<StockResult | null>(null)
  const [lengthMs, setLengthMs] = useState(3000)
  const [adding, setAdding] = useState(false)
  const asked = useRef('')

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
    try { await onAdd(picked, lengthMs); setPicked(null) } catch (e) { setError(e instanceof Error ? e.message : 'Could not add it') } finally { setAdding(false) }
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
          <div role="radiogroup" aria-label="Shot length" className="flex rounded-md overflow-hidden" style={{ border: `1px solid ${muted(0.12)}` }}>
            {LENGTHS.map(l => (
              <button key={l} role="radio" aria-checked={lengthMs === l} onClick={() => setLengthMs(l)}
                className="px-2 py-1 text-[11px] font-semibold tabular-nums"
                style={lengthMs === l ? { background: muted(0.14), color: 'var(--ed-text)' } : { color: muted(0.55) }}>
                {l / 1000}s
              </button>
            ))}
          </div>
          <button onClick={add} disabled={adding}
            className="flex-1 py-1.5 rounded-md text-xs font-bold disabled:opacity-50" style={{ background: '#c8ff00', color: '#000' }}>
            {adding ? 'Adding…' : `Add at ${fmt(currentTimeMs)}`}
          </button>
        </div>
      )}

      {/* Shots in this clip */}
      {shots.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium" style={{ color: muted(0.5) }}>In this clip</span>
          {shots.map(s => (
            <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ background: muted(0.04), border: `1px solid ${muted(0.07)}` }}>
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

      {provider && <p className="text-[10px]" style={{ color: muted(0.35) }}>Videos from {provider === 'pexels' ? 'Pexels' : 'Pixabay'}. The speaker keeps talking under each shot.</p>}
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
      title={item.title}
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
