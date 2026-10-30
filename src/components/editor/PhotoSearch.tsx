'use client'

import { useEffect, useRef, useState } from 'react'

// ── Media ▸ Search photos ─────────────────────────────────────────────────────
// Free photos from every library at once, mixed (user, 2026-10-30: no switch): the stock one
// (Pixabay, or Pexels when its key is set) and Wikimedia Commons — famous people, places and
// history, which stock libraries don't carry. Searched like B-roll: photos show as soon as it opens
// (the stock library's own picks, then the clip's first AI idea on top), a grid of results, then
// "Add at <playhead>". The picked photo is saved to the user's photos (it then shows under Import
// too) and put in like an uploaded one. Most Wikimedia photos ask for a credit, so it is shown with
// the picked photo and again once it is added, ready to copy into the post.

export interface StockPhotoResult {
  ref: string; provider: string; title: string
  thumb: string; url: string; width: number; height: number
  /** Wikimedia: the credit line, and whether the licence asks for it */
  credit?: string; credit_required?: boolean
}

const SOURCE_NAMES: Record<string, string> = { pixabay: 'Pixabay', pexels: 'Pexels', wikimedia: 'Wikimedia' }

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
  /** The credit of the photo just added (Wikimedia), to copy into the post */
  const [added, setAdded] = useState<{ credit: string; required: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<StockPhotoResult | null>(null)
  const [adding, setAdding] = useState(false)
  /** The words of the results shown ('' = the ones shown on opening) */
  const asked = useRef('')

  // Photos on opening, without suggestions to click first (user, 2026-10-30: show the photos, not
  // the idea words): the stock library's own picks at once, then — when the AI's ideas for this
  // clip come (the same ideas as B-roll) — photos for its first idea from every library put on top,
  // unless the user has searched by then
  useEffect(() => {
    let alive = true
    search('', true)
    fetch(`/api/clips/${clipId}/broll-ideas`).then(r => r.ok ? r.json() : { ideas: [] }).catch(() => ({ ideas: [] }))
      .then(async (d: { ideas?: string[] }) => {
        const idea = d.ideas?.[0]
        if (!idea || !alive || asked.current) return
        const res = await fetch(`/api/stock/photos?q=${encodeURIComponent(idea)}`).catch(() => null)
        const data = res?.ok ? await res.json() : null
        if (!data?.items?.length || !alive || asked.current) return
        setResults(prev => {
          const ours = new Set((data.items as StockPhotoResult[]).map(i => i.ref))
          return [...data.items, ...(prev ?? []).filter(i => !ours.has(i.ref))]
        })
      })
    return () => { alive = false }
  }, [clipId]) // eslint-disable-line react-hooks/exhaustive-deps

  /** `opening`: photos shown without typing (no words: the stock library's own picks) */
  async function search(q: string, opening = false) {
    const term = q.trim()
    if (!term && !opening) return
    if (!opening) setQuery(term)
    asked.current = term
    setSearching(true); setError(null); setPicked(null)
    try {
      const res = await fetch(`/api/stock/photos?q=${encodeURIComponent(term)}${term ? '' : '&browse=1'}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Search failed')
      if (asked.current !== term) return
      setResults(data.items ?? [])
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
      setAdded(data.credit ? { credit: data.credit, required: data.credit_required !== false } : null)
      setCopied(false)
      setPicked(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the photo')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 min-h-0">
      <form onSubmit={e => { e.preventDefault(); search(query) }} className="flex gap-1.5">
        <input value={query} onChange={e => setQuery(e.target.value)}
          aria-label="Search free photos"
          className="min-w-0 flex-1 px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: muted(0.06), border: `1px solid ${muted(0.1)}`, color: 'var(--ed-text)' }} />
        <button type="submit" disabled={searching || !query.trim()}
          className="shrink-0 px-3 rounded-lg text-xs font-bold disabled:opacity-40" style={{ background: '#c8ff00', color: '#000' }}>
          {searching ? '…' : 'Search'}
        </button>
      </form>

      {error && <p role="alert" className="text-xs" style={{ color: '#f87171' }}>{error}</p>}

      {/* The photo just added came with a credit: there to copy into the post (above the results, so it is seen) */}
      {added && (
        <div className="flex items-start gap-2 p-2 rounded-lg" role="status" style={{ background: 'rgba(200,255,0,0.06)', border: '1px solid rgba(200,255,0,0.2)' }}>
          <span className="min-w-0 flex-1 text-[11px]" style={{ color: muted(0.7) }}>
            {added.required ? 'Added. Put this credit in your post:' : 'Added. No credit is needed, but this is the source:'}
            <span className="block mt-0.5 break-words" style={{ color: 'var(--ed-text)' }}>Photo: {added.credit}</span>
          </span>
          <button type="button" onClick={() => { navigator.clipboard?.writeText(`Photo: ${added.credit}`).then(() => setCopied(true), () => {}) }}
            className="shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold" style={{ background: muted(0.08), color: 'var(--ed-text)' }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      )}


      {/* Results (placeholders while the first ones load) */}
      {!results && searching && (
        <div className="grid grid-cols-2 gap-1.5" aria-label="Loading photos">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="rounded-md animate-pulse" style={{ aspectRatio: '4 / 3', background: muted(0.06) }} />)}
        </div>
      )}
      {results && (
        results.length === 0 && !searching
          ? <p className="text-xs" style={{ color: muted(0.5) }}>{asked.current ? <>No photos for “{asked.current}”. Try other words.</> : 'Search for photos to put in your clip.'}</p>
          : (
            // (down to the panel's bottom, like B-roll)
            <div className="flex-1 min-h-[240px] grid grid-cols-2 auto-rows-max content-start gap-1.5 overflow-y-auto -mr-2 pr-2">
              {results.map(r => (
                <button key={r.ref} type="button" onClick={() => setPicked(p => (p?.ref === r.ref ? null : r))}
                  title={`${r.title} · click to pick it`} aria-pressed={picked?.ref === r.ref}
                  className="relative rounded-md overflow-hidden bg-black" style={{ aspectRatio: '4 / 3', outline: picked?.ref === r.ref ? '2px solid #c8ff00' : 'none', outlineOffset: -2 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={r.thumb} alt={r.title} loading="lazy" className="w-full h-full object-cover" />
                  {/* which library it is from (user, 2026-10-30: to compare the libraries) */}
                  <span className="absolute left-1 top-1 px-1 rounded text-[9px] font-semibold text-white" style={{ background: 'rgba(0,0,0,0.6)' }}>
                    {SOURCE_NAMES[r.provider] ?? r.provider}
                  </span>
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
          <span className="min-w-0 flex-1 flex flex-col gap-0.5">
            <span className="truncate text-[11px]" style={{ color: muted(0.55) }} title={picked.title}>{picked.title}</span>
            {picked.credit && <span className="truncate text-[10px]" style={{ color: muted(0.4) }} title={picked.credit}>{picked.credit_required === false ? 'No credit needed' : 'Credit'}: {picked.credit}</span>}
          </span>
          <button type="button" onClick={add} disabled={adding}
            className="shrink-0 px-3 py-1.5 rounded-md text-xs font-bold disabled:opacity-50" style={{ background: '#c8ff00', color: '#000' }}>
            {adding ? 'Adding…' : `Add at ${fmt(currentTimeMs)}`}
          </button>
        </div>
      )}
    </div>
  )
}
