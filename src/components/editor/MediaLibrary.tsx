'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { VideoThumbnails, MEDIA_DRAG_TYPE } from './SegmentTimeline'

const muted = (a: number) => `rgb(var(--ed-fg) / ${a})`
const ACCENT = '#c8ff00'

/** One thing in the Media library (see server/services/media.ts) */
export interface LibraryItem {
  kind: 'video' | 'image' | 'audio'
  /** A video's id; a photo's or a song's storage path */
  id: string
  name: string
  url: string | null
  duration_ms: number | null
  created_at: string
}

export type MediaSection = 'media' | 'library'


type Filter = 'all' | 'video' | 'audio' | 'image'
type SortBy = 'time' | 'name' | 'type' | 'duration'
type View = 'grid' | 'list' | 'large'
const VIEWS: Array<{ id: View; label: string; icon: React.ReactNode }> = [
  { id: 'grid', label: 'Grid', icon: <><rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" /></> },
  { id: 'list', label: 'List', icon: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></> },
  { id: 'large', label: 'Large list', icon: <><rect x="3" y="4" width="7" height="6" rx="1.5" /><rect x="3" y="14" width="7" height="6" rx="1.5" /><path d="M13 6h8M13 9h5M13 16h8M13 19h5" /></> },
]
const FILTERS: Array<{ id: Filter; label: string }> = [{ id: 'all', label: 'All' }, { id: 'video', label: 'Video' }, { id: 'audio', label: 'Audio' }, { id: 'image', label: 'Image' }]
const SORTS: Array<{ id: SortBy; label: string }> = [{ id: 'time', label: 'Time imported' }, { id: 'name', label: 'Name' }, { id: 'type', label: 'Type' }, { id: 'duration', label: 'Duration' }]
const PREFS_KEY = 'editor.mediaLibrary'

const clock = (ms: number | null) => {
  if (ms == null) return ''
  const s = Math.round(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Media, laid out like CapCut's. Import (the panel's header switches between Import and Library):
 * a bar with Import, the view (grid, list, large list), sort and filter over the user's videos,
 * photos and audio. Each item shows a picture, its length and "Added" when it is in this clip; +
 * adds it at the playhead, or drag it onto the timeline; the bin deletes it. Library is the stock
 * footage search (`library`).
 */
export function MediaLibrary({ items, loading, used, filter, onFilter, section, importing, onImport, onAdd, onDelete, library }: {
  items: LibraryItem[]
  loading: boolean
  /** Ids (videos) and storage paths (photos, audio) already in this clip */
  used: Set<string>
  filter: Filter
  onFilter: (f: Filter) => void
  /** Import or Library (switched in the panel's header) */
  section: MediaSection
  /** What is being imported right now (shown on the Import button) */
  importing: string | null
  onImport: (files: File[]) => void
  onAdd: (item: LibraryItem) => void
  /** Delete it from the library (resolves when it's gone) */
  onDelete: (item: LibraryItem) => Promise<void>
  library: React.ReactNode
}) {
  const [view, setView] = useState<View>('grid')
  const [sortBy, setSortBy] = useState<SortBy>('time')
  const [latestFirst, setLatestFirst] = useState(true)
  const [menu, setMenu] = useState<'view' | 'sort' | 'filter' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // The view and sort are remembered per browser
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as { view?: View; sortBy?: SortBy; latestFirst?: boolean } | null
      if (VIEWS.some(x => x.id === p?.view)) setView(p!.view!)
      if (SORTS.some(x => x.id === p?.sortBy)) setSortBy(p!.sortBy!)
      if (typeof p?.latestFirst === 'boolean') setLatestFirst(p.latestFirst)
    } catch { /* storage blocked */ }
  }, [])
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ view, sortBy, latestFirst })) } catch { /* storage blocked */ } }, [view, sortBy, latestFirst])

  const shown = useMemo(() => {
    const list = items.filter(i => filter === 'all' || i.kind === filter)
    const dir = latestFirst ? -1 : 1
    const by: Record<SortBy, (a: LibraryItem, b: LibraryItem) => number> = {
      time: (a, b) => dir * a.created_at.localeCompare(b.created_at),
      name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }) * (latestFirst ? 1 : -1),
      type: (a, b) => a.kind.localeCompare(b.kind) || dir * a.created_at.localeCompare(b.created_at),
      duration: (a, b) => dir * ((a.duration_ms ?? -1) - (b.duration_ms ?? -1)),
    }
    return [...list].sort(by[sortBy])
  }, [items, filter, sortBy, latestFirst])

  const chevron = (open: boolean) => (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
    </svg>
  )
  const toolBtn = 'h-7 flex items-center gap-1 px-1.5 rounded-md transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]'

  return (
    <div className="flex h-full min-h-0">
      <div className="flex-1 min-w-0 min-h-0 flex flex-col">
        {section === 'library' ? (
          <div className="flex-1 min-h-0 overflow-y-auto">{library}</div>
        ) : (
          <>
            {/* ── Import · view · sort · filter ── */}
            <div className="shrink-0 flex items-center gap-1 px-2 py-2" style={{ color: muted(0.75) }}>
              <input ref={inputRef} type="file" multiple accept="video/*,image/*,audio/*" className="hidden" aria-label="Import media"
                onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onImport(f) }} />
              <button type="button" onClick={() => inputRef.current?.click()} disabled={!!importing}
                className="h-7 flex items-center gap-1.5 px-2.5 rounded-lg text-[12px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.06)] disabled:opacity-60"
                style={{ color: 'var(--ed-text)', border: `1px dashed ${muted(0.25)}` }}>
                <span className="w-4 h-4 rounded-full flex items-center justify-center" style={{ background: ACCENT, color: '#000' }}>
                  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                </span>
                {importing ?? 'Import'}
              </button>
              <div className="flex-1" />
              <div className="relative">
                <button type="button" onClick={() => setMenu(m => (m === 'view' ? null : 'view'))} aria-expanded={menu === 'view'}
                  aria-label={`View: ${VIEWS.find(v => v.id === view)?.label}`} title="View" className={toolBtn}
                  style={menu === 'view' ? { background: muted(0.1) } : undefined}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    {VIEWS.find(v => v.id === view)?.icon}
                  </svg>
                  {chevron(menu === 'view')}
                </button>
                {menu === 'view' && (
                  <Menu onClose={() => setMenu(null)}>
                    {VIEWS.map(o => (
                      <MenuItem key={o.id} on={view === o.id} onClick={() => { setView(o.id); setMenu(null) }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: muted(0.7) }}>{o.icon}</svg>
                        {o.label}
                      </MenuItem>
                    ))}
                  </Menu>
                )}
              </div>
              <div className="relative">
                <button type="button" onClick={() => setMenu(m => (m === 'sort' ? null : 'sort'))} aria-expanded={menu === 'sort'} aria-label="Sort" title="Sort" className={toolBtn}
                  style={menu === 'sort' ? { background: muted(0.1) } : undefined}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 6h10M4 12h7M4 18h4M18 5v14M15 16l3 3 3-3" /></svg>
                  {chevron(menu === 'sort')}
                </button>
                {menu === 'sort' && (
                  <Menu onClose={() => setMenu(null)}>
                    {SORTS.map(o => <MenuItem key={o.id} on={sortBy === o.id} onClick={() => setSortBy(o.id)}>{o.label}</MenuItem>)}
                    <div className="my-1" style={{ borderTop: `1px solid ${muted(0.1)}` }} />
                    <MenuItem on={latestFirst} onClick={() => setLatestFirst(true)}>Latest to earliest</MenuItem>
                    <MenuItem on={!latestFirst} onClick={() => setLatestFirst(false)}>Earliest to latest</MenuItem>
                  </Menu>
                )}
              </div>
              <div className="relative">
                <button type="button" onClick={() => setMenu(m => (m === 'filter' ? null : 'filter'))} aria-expanded={menu === 'filter'} aria-label="Filter" title="Filter" className={toolBtn}
                  style={menu === 'filter' || filter !== 'all' ? { background: muted(0.1) } : undefined}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4-2v-4z" /></svg>
                  {chevron(menu === 'filter')}
                </button>
                {menu === 'filter' && (
                  <Menu onClose={() => setMenu(null)}>
                    {FILTERS.map(o => <MenuItem key={o.id} on={filter === o.id} onClick={() => { onFilter(o.id); setMenu(null) }}>{o.label}</MenuItem>)}
                  </Menu>
                )}
              </div>
            </div>

            {/* ── The items ── */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3">
              {loading && !items.length ? (
                <p className="px-1 text-xs" style={{ color: muted(0.45) }}>Loading your media…</p>
              ) : !shown.length ? (
                <button type="button" onClick={() => inputRef.current?.click()}
                  className="w-full flex flex-col items-center gap-1.5 rounded-xl py-8 text-center transition-colors hover:bg-[rgb(var(--ed-fg)/0.03)]"
                  style={{ border: `1.5px dashed ${muted(0.15)}`, color: muted(0.55) }}>
                  <span className="text-[12.5px] font-semibold" style={{ color: 'var(--ed-text)' }}>{filter === 'all' ? 'No media yet' : `No ${filter === 'image' ? 'images' : filter} yet`}</span>
                  <span className="text-[11px]">Import videos, photos or audio, or drop files here</span>
                </button>
              ) : view === 'grid' ? (
                <div className="grid gap-x-2 gap-y-2.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))' }}>
                  {shown.map(item => <Card key={`${item.kind}:${item.id}`} item={item} added={used.has(item.id)} onAdd={() => onAdd(item)} onDelete={() => onDelete(item)} />)}
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {shown.map(item => <Row key={`${item.kind}:${item.id}`} big={view === 'large'} item={item} added={used.has(item.id)} onAdd={() => onAdd(item)} onDelete={() => onDelete(item)} />)}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Menu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0" style={{ zIndex: 80 }} onClick={onClose} aria-hidden="true" />
      <div role="menu" className="absolute right-0 top-full mt-1 py-1.5 rounded-xl flex flex-col"
        style={{ zIndex: 81, minWidth: 176, background: 'var(--ed-popover, var(--ed-panel))', border: `1px solid ${muted(0.14)}`, boxShadow: '0 12px 32px rgba(0,0,0,0.55)' }}>
        {children}
      </div>
    </>
  )
}

function MenuItem({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={on} onClick={onClick}
      className="flex items-center gap-2 px-3 py-1.5 text-[12.5px] font-medium text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.07)]"
      style={{ color: 'var(--ed-text)' }}>
      <span className="w-3.5 flex justify-center" style={{ color: ACCENT }}>
        {on && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
      </span>
      {children}
    </button>
  )
}

/** The item's picture: a frame of a video, the photo, or a sound wave for audio */
function Thumb({ item, size }: { item: LibraryItem; size: 'card' | 'row' }) {
  const r = size === 'card' ? 10 : 6
  if (item.kind === 'image' && item.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.url} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-contain" style={{ borderRadius: r }} />
  }
  if (item.kind === 'video' && item.url) {
    return <span className="absolute inset-0 pointer-events-none"><VideoThumbnails videoUrl={item.url} startMs={0} durationMs={Math.max(1000, Math.min(item.duration_ms ?? 2000, 4000))} count={1} radius={r} dim={false} /></span>
  }
  return (
    <span className="absolute inset-0 flex items-center justify-center" style={{ color: '#c084fc' }}>
      <svg width={size === 'card' ? 28 : 16} height={size === 'card' ? 28 : 16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0" />
      </svg>
    </span>
  )
}

const dragStart = (item: LibraryItem) => (e: React.DragEvent) => {
  e.dataTransfer.setData(MEDIA_DRAG_TYPE, JSON.stringify(item))
  e.dataTransfer.effectAllowed = 'copy'
}

function AddButton({ onAdd, name }: { onAdd: () => void; name: string }) {
  return (
    <button type="button" onClick={e => { e.stopPropagation(); onAdd() }} aria-label={`Add ${name} at the playhead`} title="Add at the playhead"
      className="media-add w-6 h-6 rounded-full flex items-center justify-center" style={{ background: ACCENT, color: '#000' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
    </button>
  )
}

const tip = (item: LibraryItem) => `${item.name} · drag it onto the timeline, or + to add it at the playhead`

/** The bin: the first click asks ("Delete?"), the second deletes; it waits while that happens */
function DeleteButton({ onDelete, name }: { onDelete: () => Promise<void>; name: string }) {
  const [state, setState] = useState<'idle' | 'ask' | 'busy'>('idle')
  // The question goes away by itself when not answered
  useEffect(() => {
    if (state !== 'ask') return
    const t = setTimeout(() => setState('idle'), 3000)
    return () => clearTimeout(t)
  }, [state])
  const click = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (state === 'idle') { setState('ask'); return }
    if (state !== 'ask') return
    setState('busy')
    onDelete().finally(() => setState('idle'))
  }
  const asking = state !== 'idle'
  return (
    <button type="button" onClick={click} disabled={state === 'busy'} data-on={asking || undefined}
      aria-label={state === 'ask' ? `Click again to delete ${name}` : `Delete ${name}`} title={state === 'ask' ? 'Click again to delete' : 'Delete'}
      className="media-del h-6 rounded-full flex items-center justify-center gap-1 text-[10.5px] font-semibold disabled:opacity-70"
      style={asking ? { background: '#ef4444', color: '#fff', padding: '0 8px' } : { width: 24, background: 'rgba(0,0,0,0.7)', color: '#fff' }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
      </svg>
      {state === 'ask' && 'Delete?'}
      {state === 'busy' && 'Deleting…'}
    </button>
  )
}

function Card({ item, added, onAdd, onDelete }: { item: LibraryItem; added: boolean; onAdd: () => void; onDelete: () => Promise<void> }) {
  return (
    <div className="media-card flex flex-col gap-1 min-w-0" draggable onDragStart={dragStart(item)} title={tip(item)}>
      <div className="relative w-full rounded-[10px] overflow-hidden" style={{ aspectRatio: '1 / 1', background: 'rgb(var(--ed-fg) / 0.07)' }}>
        <Thumb item={item} size="card" />
        {added && <span className="absolute left-1 top-1 px-1.5 rounded text-[9.5px] font-semibold" style={{ background: 'rgba(0,0,0,0.72)', color: '#fff' }}>Added</span>}
        {item.duration_ms != null && <span className="absolute left-1 bottom-1 px-1 rounded text-[9.5px] font-semibold tabular-nums" style={{ background: 'rgba(0,0,0,0.6)', color: '#fff' }}>{clock(item.duration_ms)}</span>}
        <span className="absolute right-1 top-1"><DeleteButton onDelete={onDelete} name={item.name} /></span>
        <span className="absolute right-1 bottom-1"><AddButton onAdd={onAdd} name={item.name} /></span>
      </div>
      <span className="text-[11px] truncate" style={{ color: muted(0.65) }}>{item.name}</span>
    </div>
  )
}

/** A list row; `big` (the large list): a taller row with a bigger picture */
function Row({ item, added, onAdd, onDelete, big = false }: { item: LibraryItem; added: boolean; onAdd: () => void; onDelete: () => Promise<void>; big?: boolean }) {
  return (
    <div className={`media-card flex items-center ${big ? 'gap-3 p-1.5' : 'gap-2 p-1'} rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]`} draggable onDragStart={dragStart(item)}
      title={tip(item)}>
      <span className={`relative shrink-0 ${big ? 'rounded-lg' : 'rounded-md'} overflow-hidden`}
        style={{ width: big ? 112 : 44, height: big ? 63 : 32, background: 'rgb(var(--ed-fg) / 0.07)' }}><Thumb item={item} size={big ? 'card' : 'row'} /></span>
      <span className={`flex-1 min-w-0 flex flex-col ${big ? 'gap-1' : ''}`}>
        <span className={big ? 'text-[13px] font-medium leading-snug line-clamp-2 text-[var(--ed-text)]' : 'text-[12px] truncate text-[var(--ed-text)]'}>{item.name}</span>
        <span className="text-[10.5px] tabular-nums" style={{ color: muted(0.45) }}>
          {item.kind === 'image' ? 'Image' : item.kind === 'audio' ? 'Audio' : 'Video'}{item.duration_ms != null ? ` · ${clock(item.duration_ms)}` : ''}{added ? ' · Added' : ''}
        </span>
      </span>
      <DeleteButton onDelete={onDelete} name={item.name} />
      <AddButton onAdd={onAdd} name={item.name} />
    </div>
  )
}
