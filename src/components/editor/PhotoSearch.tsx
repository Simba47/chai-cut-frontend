'use client'

import { useEffect, useRef, useState } from 'react'

// ── Media ▸ Search photos ─────────────────────────────────────────────────────
// Free stock photos (Pixabay, or Pexels when its key is set), searched like B-roll stock: AI ideas
// for this clip and categories to start from, a grid of results, then "Add at <playhead>". The
// picked photo is saved to the user's photos (it then shows under Import too) and put in like an
// uploaded one.

export interface StockPhotoResult {
  ref: string; provider: string; title: string
  thumb: string; url: string; width: number; height: number
}

const CATEGORIES = ['Nature', 'City', 'People', 'Food', 'Travel', 'Business', 'Technology', 'Sky', 'Abstract']

const fmt = (ms: number) => { const s = Math.max(0, Math.round(ms / 100) / 10); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }
const muted = (a: number) => `rgb(var(--ed-fg) / ${a})`

export function PhotoSearch({ clipId, currentTimeMs, onAdd }: {
  clipId: string
  currentTimeMs: number
  /** The saved photo: put it in at the playhead */
  onAdd: (photo: { storage_path: string; preview_url: string }) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockPhotoResult[] | null>(null)
  const [provider, setProvider] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ideas, setIdeas] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<StockPhotoResult | null>(null)
  const [adding, setAdding] = useState(false)
  const asked = useRef('')

  // Ideas for this clip, once (the same AI ideas as B-roll: they name things to show)
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
      const res = await fetch(`/api/stock/photos?q=${encodeURIComponent(term)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Search failed')
      if (asked.current !== term) return
      setProvider(data.provider)
      setResults(data.items ?? [])
      if (!data.provider) setError('Photo search is not set up (PIXABAY_API_KEY).')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    } finally {
      setSearching(false)
    }
  }

  async function add() {
    if (!picked) return
    setAdding(true); setError(null)
    try {
      const res = await fetch('/api/stock/photos/import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: picked.ref, url: picked.url, title: picked.title }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error ?? 'Could not add the photo')
      onAdd(data)
      setPicked(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the photo')
    } finally {
      setAdding(false)
    }
  }

  const chip = (label: string, accent = false) => (
    <button key={label} type="button" onClick={() => search(label)}
      className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors"
      style={accent
        ? { background: 'rgba(200,255,0,0.12)', color: 'var(--ed-accent-text)', border: '1px solid rgba(200,255,0,0.3)' }
        : { background: muted(0.06), color: muted(0.75), border: `1px solid ${muted(0.08)}` }}>
      {label}
    </button>
  )

  return (
    <div className="flex flex-col gap-3 p-4 min-h-0">
      <form onSubmit={e => { e.preventDefault(); search(query) }} className="flex gap-1.5">
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search free photos…"
          aria-label="Search free photos"
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

      {error && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{error}</p>}

      {results && (
        results.length === 0 && !searching
          ? <p className="text-xs" style={{ color: muted(0.5) }}>No photos for “{asked.current}”. Try other words.</p>
          : (
            <div className="grid grid-cols-2 gap-1.5 overflow-y-auto -mr-2 pr-2" style={{ maxHeight: 340 }}>
              {results.map(r => (
                <button key={r.ref} type="button" onClick={() => setPicked(p => (p?.ref === r.ref ? null : r))}
                  title={`${r.title} · click to pick it`} aria-pressed={picked?.ref === r.ref}
                  className="relative rounded-md overflow-hidden bg-black" style={{ aspectRatio: '4 / 3', outline: picked?.ref === r.ref ? '2px solid #c8ff00' : 'none', outlineOffset: -2 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.thumb} alt={r.title} loading="lazy" className="w-full h-full object-cover" />
                  {r.height > r.width && (
                    <span className="absolute left-1 bottom-1 px-1 rounded text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.6)' }}>Tall</span>
                  )}
                </button>
              ))}
            </div>
          )
      )}

      {/* Add the picked photo at the playhead */}
      {picked && (
        <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: muted(0.05), border: `1px solid ${muted(0.1)}` }}>
          <span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: muted(0.55) }} title={picked.title}>{picked.title}</span>
          <button type="button" onClick={add} disabled={adding}
            className="shrink-0 px-3 py-1.5 rounded-md text-xs font-bold disabled:opacity-50" style={{ background: '#c8ff00', color: '#000' }}>
            {adding ? 'Adding…' : `Add at ${fmt(currentTimeMs)}`}
          </button>
        </div>
      )}

      {provider && (
        <p className="text-[10px]" style={{ color: muted(0.35) }}>
          Photos from {provider === 'pexels' ? 'Pexels' : 'Pixabay'}, free to use in your videos. A photo you add is saved under Import too.
        </p>
      )}
    </div>
  )
}
