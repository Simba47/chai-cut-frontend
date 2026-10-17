'use client'

import { useEffect, useRef, useState } from 'react'
import { SOUND_CHIPS, SOUND_TABS, type SoundItem, type SoundKind } from '@/modules/editor/soundCatalog'

interface Props {
  /** Puts a sound on the clip at the playhead (stores it first); rejects with a message */
  onAdd: (item: SoundItem, kind: SoundKind) => Promise<void>
}

/** Saved sounds (a star): in this browser */
const FAVS_KEY = 'chai-sound-favs'
type Fav = { kind: SoundKind; item: SoundItem }
function readFavs(): Fav[] {
  try {
    const v = JSON.parse(localStorage.getItem(FAVS_KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((f: Fav) => f?.item?.id && f.kind && f.item.preview) : []
  } catch { return [] }
}

const fmtLen = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s < 10 ? s.toFixed(1) : Math.round(s)}s`)

/**
 * Sounds to search and add — music by mood, effects, meme sounds (Freesound, live). Listen with the
 * play button, add with "Add" (the sound goes onto the clip at the playhead), star the ones you
 * come back to. Sits in the Music tool under "+ Add background music".
 */
export function SoundLibrary({ onAdd }: Props) {
  const [kind, setKind] = useState<SoundKind>('music')
  const [q, setQ] = useState(SOUND_CHIPS.music[0].q)
  const [typed, setTyped] = useState('')       // what the search box says ('' while a chip is lit)
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<SoundItem[]>([])
  const [more, setMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [off, setOff] = useState(false)         // no API key on the server
  const [playing, setPlaying] = useState<number | null>(null)
  const [adding, setAdding] = useState<number | null>(null)
  const [favs, setFavs] = useState<Fav[]>([])
  const [showFavs, setShowFavs] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => { setFavs(readFavs()) }, [])
  const stop = () => { audioRef.current?.pause(); audioRef.current = null; setPlaying(null) }
  useEffect(() => stop, [])
  useEffect(() => { stop() }, [kind, q, showFavs])

  // The box waits for a pause in typing; chips search at once
  useEffect(() => {
    if (!typed.trim()) return
    const t = setTimeout(() => { setQ(typed.trim()); setPage(1) }, 450)
    return () => clearTimeout(t)
  }, [typed])

  useEffect(() => {
    if (showFavs) return
    const ctl = new AbortController()
    setLoading(true); setProblem(null)
    fetch(`/api/audio/library/search?${new URLSearchParams({ kind, q, page: String(page) })}`, { signal: ctl.signal })
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error ?? 'The sound library is not available right now.')
        setOff(d.on === false)
        // (only a proper list of sounds: an odd answer must never break the editor)
        const got: SoundItem[] = Array.isArray(d.items) ? d.items.filter((n: SoundItem) => n && typeof n.id === 'number' && typeof n.preview === 'string') : []
        setItems(prev => (page > 1 ? [...prev, ...got.filter(n => !prev.some(p => p.id === n.id))] : got))
        setMore(!!d.more)
      })
      .catch((e: unknown) => { if ((e as { name?: string }).name !== 'AbortError') { setProblem(e instanceof Error ? e.message : 'The sound library is not available right now.'); if (page === 1) setItems([]) } })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false) })
    return () => ctl.abort()
  }, [kind, q, page, showFavs])

  function toggle(item: SoundItem) {
    if (playing === item.id) { stop(); return }
    stop()
    const a = new Audio(item.preview)
    a.onended = () => setPlaying(p => (p === item.id ? null : p))
    a.onerror = () => { setPlaying(null); setProblem('That sound could not be played.') }
    audioRef.current = a
    setPlaying(item.id)
    a.play().catch(() => setPlaying(null))
  }
  function star(item: SoundItem) {
    const next = favs.some(f => f.item.id === item.id) ? favs.filter(f => f.item.id !== item.id) : [{ kind, item }, ...favs].slice(0, 60)
    setFavs(next)
    try { localStorage.setItem(FAVS_KEY, JSON.stringify(next)) } catch { /* private window: the stars last until the page closes */ }
  }
  async function add(item: SoundItem, k: SoundKind) {
    stop(); setProblem(null); setAdding(item.id)
    try { await onAdd(item, k) } catch (e) { setProblem(e instanceof Error ? e.message : 'The sound could not be added.') } finally { setAdding(null) }
  }
  function pickKind(k: SoundKind) {
    setShowFavs(false); setKind(k); setTyped(''); setQ(SOUND_CHIPS[k][0].q); setPage(1); setItems([])
  }

  const shown: Array<{ item: SoundItem; kind: SoundKind }> = showFavs ? favs.map(f => ({ item: f.item, kind: f.kind })) : items.map(item => ({ item, kind }))
  const lit = !typed.trim() ? SOUND_CHIPS[kind].find(c => c.q === q)?.q : undefined

  return (
    <div className="flex flex-col gap-2.5 p-3 rounded-lg" style={{ background: 'var(--surface-2)' }} data-testid="sound-library">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Sound library</p>
        <button type="button" aria-pressed={showFavs} onClick={() => setShowFavs(v => !v)} title="Sounds you starred"
          className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
          style={showFavs ? { background: 'rgba(250,204,21,0.16)', color: '#fde047' } : { background: 'rgba(255,255,255,0.05)', color: 'var(--text-muted)' }}>
          ★ Saved{favs.length ? ` ${favs.length}` : ''}
        </button>
      </div>

      <div role="tablist" aria-label="Sound type" className="grid grid-cols-3 gap-0.5 p-0.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.05)' }}>
        {SOUND_TABS.map(t => (
          <button key={t.kind} type="button" role="tab" aria-selected={kind === t.kind && !showFavs} title={t.hint} onClick={() => pickKind(t.kind)}
            className="h-7 rounded-md text-[11.5px] font-semibold transition-colors"
            style={kind === t.kind && !showFavs ? { background: 'rgba(192,132,252,0.18)', color: '#e9d5ff' } : { color: 'var(--text-muted)' }}>
            {t.label}
          </button>
        ))}
      </div>

      {!showFavs && (
        <>
          <input type="search" value={typed} onChange={e => setTyped(e.target.value)} placeholder={`Search ${SOUND_TABS.find(t => t.kind === kind)!.label.toLowerCase()}…`}
            aria-label="Search sounds" className="h-8 px-2.5 rounded-md text-xs text-white outline-none"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--border)' }} />
          <div className="flex flex-wrap gap-1.5" aria-label="Quick searches">
            {SOUND_CHIPS[kind].map(c => (
              <button key={c.label} type="button" aria-pressed={lit === c.q} onClick={() => { setTyped(''); setQ(c.q); setPage(1) }}
                className="px-2 py-1 rounded-full text-[11px] font-medium transition-colors"
                style={lit === c.q ? { background: 'rgba(192,132,252,0.22)', color: '#e9d5ff', boxShadow: 'inset 0 0 0 1px rgba(192,132,252,0.55)' } : { background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
                {c.label}
              </button>
            ))}
          </div>
        </>
      )}

      {off && !showFavs && <p className="text-[11px]" style={{ color: '#fbbf24' }}>The sound library isn’t set up yet.</p>}
      {problem && <p role="alert" className="text-[11px]" style={{ color: '#f87171' }}>{problem}</p>}

      <ul className="flex flex-col gap-1" aria-label="Sounds">
        {shown.map(({ item, kind: k }) => {
          const starred = favs.some(f => f.item.id === item.id)
          return (
            <li key={`${k}-${item.id}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <button type="button" onClick={() => toggle(item)} aria-label={playing === item.id ? `Stop ${item.name}` : `Play ${item.name}`}
                className="shrink-0 grid place-items-center w-7 h-7 rounded-full" style={{ background: playing === item.id ? '#c084fc' : 'rgba(192,132,252,0.18)', color: playing === item.id ? '#1e1033' : '#e9d5ff' }}>
                {playing === item.id
                  ? <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1" /><rect x="14" y="4" width="5" height="16" rx="1" /></svg>
                  : <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>}
              </button>
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-white truncate" title={item.name}>{item.name}</span>
                <span className="block text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                  {fmtLen(item.duration)} · {item.license === 'cc0' ? 'Free (CC0)' : `by ${item.author} · CC BY`}
                </span>
              </span>
              <button type="button" onClick={() => star(item)} aria-pressed={starred} aria-label={starred ? `Remove ${item.name} from saved` : `Save ${item.name}`}
                className="shrink-0 text-sm leading-none" style={{ color: starred ? '#fde047' : 'var(--text-muted)' }}>{starred ? '★' : '☆'}</button>
              <button type="button" disabled={adding != null} onClick={() => add(item, k)} aria-label={`Add ${item.name} at the playhead`}
                className="shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold disabled:opacity-50" style={{ background: 'rgba(192,132,252,0.18)', color: '#e9d5ff' }}>
                {adding === item.id ? 'Adding…' : 'Add'}
              </button>
            </li>
          )
        })}
      </ul>

      {loading && <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>Searching…</p>}
      {!loading && !problem && !off && shown.length === 0 && (
        <p className="text-[11px] text-center" style={{ color: 'var(--text-muted)' }}>{showFavs ? 'Star a sound (☆) to keep it here.' : 'Nothing found. Try another word.'}</p>
      )}
      {!showFavs && more && !loading && (
        <button type="button" onClick={() => setPage(p => p + 1)} className="py-1.5 rounded-md text-[11px] font-semibold" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
          Load more
        </button>
      )}
      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Sounds from Freesound (free licences). A CC BY sound needs its author named when you publish.</p>
    </div>
  )
}
