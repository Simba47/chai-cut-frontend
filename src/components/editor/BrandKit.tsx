'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { CaptionStyler, FontPicker, loadVideoFonts, type TextCase } from './CaptionStyler'
import { PlatformOverlay, PLATFORM_SAFE, type Platform } from './PlatformOverlay'
import { ensureBrandFont } from './brandFonts'
import { FrameThumb } from './FramesPanel'
import { FRAME_TEMPLATES, FRAME_LAYOUTS } from '@/modules/editor/frames'
import type { FrameLayout } from '@chai-cut/shared'
import { templateOf, templateFontFamily } from '@/modules/captions/templates'
import {
  LOGO_SIZE, LOGO_SECONDS, MAX_EXTRA_COLORS, MAX_BRAND_FONTS, MAX_GLOSSARY, MAX_BRAND_HASHTAGS, PROGRESS_HEIGHT, END_CARD_SECONDS, MAX_BRAND_FRAMES, MAX_KIT_SHARES,
  brandCaptionStyle, cleanProgressBar, logoBox, showHandle,
  type BrandKit, type BrandKitData, type BrandCaptions, type LogoCorner, type LogoShow, type ProgressBar,
} from '@/lib/shared/brandKit'

/**
 * The editor's Brand kit tool (user, 2026-10-17): the kits listed in the options panel (pick one,
 * make a new one, Apply it to the clip), and the kit edited in a workshop that takes the video's
 * place in the middle — more room to set it up. Kits are the account's (api/brand-kits), saved as
 * they're changed; how many there can be depends on the plan.
 */

type SaveState = 'saved' | 'saving' | 'error'
type KitPatch = { name?: string; data?: BrandKitData; logo_url?: string | null; music_url?: string | null; sting_url?: string | null }
/** What a link gave (server services/brandFromLink.ts LinkBrand) */
type LinkBrand = {
  source: string; name: string | null; handle: string | null
  logo: { path: string; url: string | null; ratio: number | null } | null
  colors: { main: string; accent: string | null } | null
}
const CURRENT_KEY = 'shortcut:brandKit'
const SAVE_AFTER_MS = 600

export interface BrandKits {
  kits: BrandKit[]
  limit: number
  plan: string
  loading: boolean
  error: string | null
  current: BrandKit | null
  select: (id: string) => void
  create: () => Promise<void>
  /** logo_url, music_url, sting_url: the new files' links, for showing and playing them (not saved) */
  update: (id: string, patch: KitPatch) => void
  remove: (id: string) => Promise<void>
  /** Stop using a kit someone shared with you */
  leave: (id: string) => Promise<void>
  uploadLogo: (file: File) => Promise<{ path: string; url: string | null; ratio: number }>
  uploadSound: (file: File, kind: 'music' | 'sting') => Promise<{ path: string; name: string; url: string }>
  /** A brand read from a website or profile link (server services/brandFromLink.ts) */
  fromLink: (url: string) => Promise<LinkBrand>
  saveState: SaveState
  reload: () => void
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((body as { error?: string }).error ?? 'Something went wrong. Please try again.')
  return body as T
}

/** A picture's height ÷ width, read in the browser before it's uploaded */
function pictureRatio(file: File): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img.naturalWidth > 0 ? img.naturalHeight / img.naturalWidth : 1) }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(1) }
    img.src = url
  })
}

/** The account's brand kits: loaded once, changes saved shortly after they're made */
export function useBrandKits(): BrandKits {
  const [kits, setKits] = useState<BrandKit[]>([])
  const [limit, setLimit] = useState(1)
  const [plan, setPlan] = useState('free')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const pending = useRef(new Map<string, { name?: string; data?: BrandKitData }>())
  /** Each kit's save on its way (the next one waits for it) */
  const sending = useRef(new Map<string, Promise<void>>())

  const load = useCallback(() => {
    setLoading(true); setError(null)
    fetch('/api/brand-kits').then(r => json<{ kits: BrandKit[]; limit: number; plan: string }>(r))
      .then(d => {
        setKits(d.kits); setLimit(d.limit); setPlan(d.plan)
        let saved: string | null = null
        try { saved = localStorage.getItem(CURRENT_KEY) } catch { /* private window */ }
        setCurrentId(d.kits.some(k => k.id === saved) ? saved : d.kits[0]?.id ?? null)
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const flush = useCallback((id: string, keepalive = false) => {
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.delete(id)
    const patch = pending.current.get(id)
    pending.current.delete(id)
    if (!patch) return
    setSaveState('saving')
    const send = () => fetch(`/api/brand-kits/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch), keepalive })
      .then(r => json<{ kit: BrandKit }>(r))
      // (the saved kit's logo link; what's on screen stays as typed meanwhile)
      .then(d => {
        setKits(ks => ks.map(k => (k.id === id ? { ...k, logo_url: d.kit.logo_url ?? k.logo_url } : k)))
        if (!timers.current.size) setSaveState('saved')
      })
      .catch(() => setSaveState('error'))
    // One save of a kit at a time, in order: a slow earlier save landing after a later one would
    // put back what it had (leaving the editor: sent at once)
    const before = keepalive ? undefined : sending.current.get(id)
    const run = before ? before.then(send) : send()
    sending.current.set(id, run)
    run.finally(() => { if (sending.current.get(id) === run) sending.current.delete(id) })
  }, [])
  // Leaving the editor: what's still waiting is sent
  useEffect(() => () => { for (const id of [...pending.current.keys()]) flush(id, true) }, [flush])

  const update = useCallback((id: string, { logo_url, music_url, sting_url, ...patch }: KitPatch) => {
    setKits(ks => ks.map(k => (k.id === id ? {
      ...k, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.data ? { data: patch.data } : {}),
      ...(logo_url !== undefined ? { logo_url } : {}), ...(music_url !== undefined ? { music_url } : {}), ...(sting_url !== undefined ? { sting_url } : {}),
    } : k)))
    pending.current.set(id, { ...pending.current.get(id), ...patch })
    const t = timers.current.get(id)
    if (t) clearTimeout(t)
    timers.current.set(id, setTimeout(() => flush(id), SAVE_AFTER_MS))
    setSaveState('saving')
  }, [flush])

  const select = useCallback((id: string) => {
    setCurrentId(id)
    try { localStorage.setItem(CURRENT_KEY, id) } catch { /* private window */ }
  }, [])

  const create = useCallback(async () => {
    const { kit } = await fetch('/api/brand-kits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => json<{ kit: BrandKit }>(r))
    setKits(ks => [...ks, kit])
    select(kit.id)
  }, [select])

  const remove = useCallback(async (id: string) => {
    timers.current.delete(id); pending.current.delete(id)
    await fetch(`/api/brand-kits/${id}`, { method: 'DELETE' }).then(r => json(r))
    setKits(ks => {
      const rest = ks.filter(k => k.id !== id)
      setCurrentId(cur => (cur === id ? rest[0]?.id ?? null : cur))
      return rest
    })
  }, [])

  const uploadLogo = useCallback(async (file: File) => {
    const ratio = await pictureRatio(file)
    const form = new FormData()
    form.append('file', file)
    const d = await fetch('/api/brand-kits/logo', { method: 'POST', body: form }).then(r => json<{ path: string; url: string | null }>(r))
    return { ...d, ratio }
  }, [])

  const uploadSound = useCallback(async (file: File, kind: 'music' | 'sting') => {
    const form = new FormData()
    form.append('file', file)
    form.append('kind', kind)
    return fetch('/api/brand-kits/sound', { method: 'POST', body: form }).then(r => json<{ path: string; name: string; url: string }>(r))
  }, [])

  const fromLink = useCallback((url: string) => fetch('/api/brand-kits/from-link', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }),
  }).then(r => json<LinkBrand>(r)), [])

  const leave = useCallback(async (id: string) => {
    await fetch(`/api/brand-kits/${id}/share`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => json(r))
    setKits(ks => {
      const rest = ks.filter(k => k.id !== id)
      setCurrentId(cur => (cur === id ? rest[0]?.id ?? null : cur))
      return rest
    })
  }, [])

  const current = kits.find(k => k.id === currentId) ?? null
  return { kits, limit, plan, loading, error, current, select, create, update, remove, leave, uploadLogo, uploadSound, fromLink, saveState, reload: load }
}

/** Apply, with "Applied" on the button for a moment after */
function useApply(onApply: (kit: BrandKit) => void): [boolean, (kit: BrandKit) => void] {
  const [done, setDone] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return [done, kit => {
    onApply(kit)
    setDone(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setDone(false), 2500)
  }]
}

// ── Options panel: the kits, a new one, Apply ────────────────────────────────

export function BrandKitPanel({ brand, onApply, onDelete, progressBar, onProgressBarChange }: {
  brand: BrandKits
  onApply: (kit: BrandKit) => void
  /** Asks first, then deletes */
  onDelete: (kit: BrandKit) => void
  /** This clip's progress bar (null = none) and its change: shown when given */
  progressBar?: ProgressBar | null
  onProgressBarChange?: (bar: ProgressBar | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [applied, apply] = useApply(onApply)
  // (kits shared with this user don't count against their plan)
  const own = brand.kits.filter(k => !k.shared_by).length
  const full = own >= brand.limit
  const planName = brand.plan.charAt(0).toUpperCase() + brand.plan.slice(1)

  async function newKit() {
    setBusy(true); setNote(null)
    try { await brand.create() } catch (e) { setNote(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }

  if (brand.loading) return <p className="p-4 text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Loading your brand kits…</p>
  if (brand.error) {
    return (
      <div className="p-4 flex flex-col gap-2">
        <p className="text-xs" style={{ color: '#fca5a5' }}>{brand.error}</p>
        <button type="button" onClick={brand.reload} className="self-start text-xs font-semibold hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Try again</button>
      </div>
    )
  }
  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="cap-heading">Your kits</h3>
        <span className="text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}
          title={`The ${planName} plan has room for ${brand.limit} brand kit${brand.limit === 1 ? '' : 's'}`}>
          {own} of {brand.limit} · {planName}
        </span>
      </div>

      <div className="flex flex-col gap-2" role="listbox" aria-label="Brand kits">
        {brand.kits.map(k => {
          const on = k.id === brand.current?.id
          return (
            <button key={k.id} type="button" role="option" aria-selected={on} onClick={() => brand.select(k.id)}
              className="flex items-center gap-3 p-2.5 rounded-xl text-left transition-colors"
              style={{ background: on ? 'rgba(200,255,0,0.08)' : 'rgb(var(--ed-fg) / 0.04)', boxShadow: `inset 0 0 0 1px ${on ? 'rgba(200,255,0,0.55)' : 'rgb(var(--ed-fg) / 0.08)'}` }}>
              <KitBadge kit={k} />
              <span className="flex-1 min-w-0 flex flex-col">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span className="text-[13px] font-semibold truncate text-[var(--ed-text)]">{k.name}</span>
                  {k.data.is_default && (
                    <span className="shrink-0 px-1.5 py-px rounded text-[9.5px] font-bold uppercase tracking-wide" title="New clips get this kit by themselves"
                      style={{ background: 'rgba(200,255,0,0.14)', color: 'var(--ed-accent-text)' }}>Default</span>
                  )}
                </span>
                <span className="text-[11px] truncate" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                  {k.shared_by ? `Shared by ${k.shared_by}${k.data.lock ? ' · brand lock' : ''}` : showHandle(k.data.handle) || 'No @handle yet'}
                </span>
              </span>
              <span className="flex gap-1 shrink-0" aria-hidden="true">
                {[k.data.colors.main, k.data.colors.accent].map((c, i) => <span key={i} className="w-3.5 h-3.5 rounded-full" style={{ background: c, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.2)' }} />)}
              </span>
            </button>
          )
        })}
        {!brand.kits.length && (
          <p className="text-xs leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
            Make a kit with your colours, logo and @handle, then put it on any clip in one click.
          </p>
        )}
      </div>

      <button type="button" onClick={newKit} disabled={busy || full}
        title={full ? `Your ${planName} plan has room for ${brand.limit} brand kit${brand.limit === 1 ? '' : 's'}. Upgrade for more.` : 'Make a new brand kit'}
        className="flex items-center justify-center gap-1.5 h-9 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40"
        style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
        <span aria-hidden="true">+</span> {busy ? 'Making…' : 'New brand kit'}
      </button>
      {full && <p className="-mt-2 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>That&rsquo;s all your plan has room for. <a href="/pricing" className="font-semibold hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Upgrade</a> for more.</p>}
      {note && <p role="alert" className="-mt-2 text-[11px]" style={{ color: '#fca5a5' }}>{note}</p>}

      {brand.current && (
        <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
          <button type="button" onClick={() => apply(brand.current!)}
            className="h-10 rounded-lg text-[13px] font-bold transition-transform hover:scale-[1.01]"
            style={{ background: '#c8ff00', color: '#0a0a0a' }}>
            {applied ? 'Applied ✓ · Ctrl+Z to undo' : 'Apply brand kit'}
          </button>
          <p className="text-[11px] leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
            Puts &ldquo;{brand.current.name}&rdquo; on this clip: its logo, its captions, progress bar and end card (when they&rsquo;re
            on in the kit), its title font and colour on your text (frame text keeps its own font), its colour on frame bands,
            fills any Branded card, and adds its intro, outro and sound. One undo step (the progress bar is switched off below).
          </p>
          {!brand.current.shared_by && <DefaultSwitch kit={brand.current} onChange={on => brand.update(brand.current!.id, { data: { ...brand.current!.data, is_default: on } })} />}
          {onProgressBarChange && (
            <ClipProgressBar value={progressBar ?? null} onChange={onProgressBarChange}
              // Switched on: the kit's bar (its colour, thickness and edge)
              start={cleanProgressBar(brand.current.data.progress)!} />
          )}
          {brand.current.shared_by ? (
            <button type="button" onClick={() => { brand.leave(brand.current!.id).catch(e => setNote(e instanceof Error ? e.message : String(e))) }}
              className="self-start text-[11px] font-medium hover:underline" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
              Stop using this shared kit
            </button>
          ) : (
            <button type="button" onClick={() => onDelete(brand.current!)}
              className="self-start text-[11px] font-medium hover:underline" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
              Delete this kit
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/** A picture's height ÷ width from its link (null when it doesn't load) */
function urlRatio(url: string): Promise<number | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve(img.naturalWidth ? img.naturalHeight / img.naturalWidth : null)
    img.onerror = () => resolve(null)
    setTimeout(() => resolve(null), 8000)
    img.src = url
  })
}

/** A website or profile link, read for the brand (the kit is filled from it) */
function LinkFill({ onFill }: { onFill: (url: string) => Promise<string> }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  async function go() {
    if (!url.trim() || busy) return
    setBusy(true); setNote(null)
    try { setNote({ text: await onFill(url.trim()), bad: false }) } catch (e) { setNote({ text: e instanceof Error ? e.message : String(e), bad: true }) } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
        Paste your website or a profile link: we take the logo, colours, name and @handle from it.
      </p>
      <div className="flex gap-2">
        <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') go() }} maxLength={500}
          placeholder="yourbrand.com or instagram.com/yourbrand" aria-label="Website or profile link"
          className="flex-1 min-w-0 h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none"
          style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
        <button type="button" onClick={go} disabled={busy || !url.trim()} className="h-9 px-3 rounded-lg text-xs font-semibold disabled:opacity-50"
          style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.08)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
          {busy ? 'Reading…' : 'Fill the kit'}
        </button>
      </div>
      {note && <p role={note.bad ? 'alert' : 'status'} className="text-[11px]" style={{ color: note.bad ? '#fca5a5' : 'var(--ed-accent-text)' }}>{note.text}</p>}
    </div>
  )
}

/** A kit's sound file: its name, a play button, upload / change, remove */
function SoundRow({ label, file, url, busy, onPick, onRemove }: {
  label: string; file: { name: string } | null; url: string | null; busy: boolean; onPick: (f: File | undefined) => void; onRemove: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState(false)
  useEffect(() => () => { audio.current?.pause() }, [])
  useEffect(() => { audio.current?.pause(); audio.current = null; setPlaying(false) }, [url])
  function play() {
    if (!url) return
    if (playing) { audio.current?.pause(); setPlaying(false); return }
    audio.current ??= new Audio(url)
    audio.current.onended = () => setPlaying(false)
    audio.current.currentTime = 0
    audio.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }
  return (
    <div className="cap-row">
      <span className="flex flex-col min-w-0">
        <span className="cap-label">{label}</span>
        <span className="text-[11px] truncate" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{file ? file.name : 'None'}</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        <input ref={ref} type="file" accept="audio/*,.mp3,.m4a,.wav,.aac,.ogg" className="hidden" aria-label={`Upload ${label.toLowerCase()}`}
          onChange={e => { onPick(e.target.files?.[0]); e.target.value = '' }} />
        {file && url && (
          <button type="button" onClick={play} aria-label={playing ? `Stop ${label.toLowerCase()}` : `Play ${label.toLowerCase()}`}
            className="h-7 px-2 rounded-md text-[11px] font-semibold" style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.08)' }}>
            {playing ? 'Stop' : 'Play'}
          </button>
        )}
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}
          className="h-7 px-2 rounded-md text-[11px] font-semibold disabled:opacity-50" style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.08)' }}>
          {busy ? 'Uploading…' : file ? 'Change' : 'Upload'}
        </button>
        {file && (
          <button type="button" onClick={onRemove} aria-label={`Remove ${label.toLowerCase()}`}
            className="h-7 px-2 rounded-md text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Remove</button>
        )}
      </span>
    </div>
  )
}

type KitShare = { user_id: string; name: string | null; email: string | null }

/** Who the kit is shared with (Agency), adding and taking people off, and its brand lock */
function KitTeam({ kitId, lock, onLock }: { kitId: string; lock: boolean; onLock: (on: boolean) => void }) {
  const [state, setState] = useState<{ people: KitShare[]; can_share: boolean } | null>(null)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setState(null); setNote(null)
    fetch(`/api/brand-kits/${kitId}/share`).then(r => json<{ people: KitShare[]; can_share: boolean }>(r))
      .then(s => { if (live) setState(s) }).catch(e => { if (live) setNote(e instanceof Error ? e.message : String(e)) })
    return () => { live = false }
  }, [kitId])
  async function add() {
    if (!email.trim() || busy) return
    setBusy(true); setNote(null)
    try {
      const { person } = await fetch(`/api/brand-kits/${kitId}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim() }) })
        .then(r => json<{ person: KitShare }>(r))
      setState(s => s && { ...s, people: [...s.people.filter(p => p.user_id !== person.user_id), person] })
      setEmail('')
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  async function removePerson(userId: string) {
    setNote(null)
    try {
      await fetch(`/api/brand-kits/${kitId}/share`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: userId }) }).then(r => json(r))
      setState(s => s && { ...s, people: s.people.filter(p => p.user_id !== userId) })
    } catch (e) { setNote(e instanceof Error ? e.message : String(e)) }
  }
  if (!state) return <p className="text-[11px]" style={{ color: note ? '#fca5a5' : 'rgb(var(--ed-fg) / 0.45)' }}>{note ?? 'Loading…'}</p>
  if (!state.can_share) {
    return (
      <p className="text-[11px] leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
        Share this kit with your team so everyone&rsquo;s clips look the same — on the Agency plan.{' '}
        <a href="/pricing" className="font-semibold hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Upgrade</a>
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
        People you share it with can put it on their clips; only you can change it. Up to {MAX_KIT_SHARES} people.
      </p>
      <div className="flex gap-2">
        <input value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} type="email" maxLength={200}
          placeholder="Their Shortcut email" aria-label="Email to share the kit with"
          className="flex-1 min-w-0 h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none"
          style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
        <button type="button" onClick={add} disabled={busy || !email.trim() || state.people.length >= MAX_KIT_SHARES}
          className="h-9 px-3 rounded-lg text-xs font-semibold disabled:opacity-50"
          style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.08)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
          {busy ? 'Sharing…' : 'Share'}
        </button>
      </div>
      {note && <p role="alert" className="text-[11px]" style={{ color: '#fca5a5' }}>{note}</p>}
      {state.people.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Shared with">
          {state.people.map(p => (
            <li key={p.user_id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-[var(--ed-text)]">{p.name || p.email}{p.name && p.email ? <span style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}> · {p.email}</span> : null}</span>
              <button type="button" onClick={() => removePerson(p.user_id)} aria-label={`Stop sharing with ${p.email ?? p.name}`}
                className="text-[11px] shrink-0 hover:underline" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <label className="cap-row cursor-pointer select-none">
        <span className="flex flex-col min-w-0">
          <span className="cap-label">Brand lock</span>
          <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
            {lock ? 'Your team can pick only this kit\u2019s colours and fonts' : 'Off: your team picks any colour and font'}
          </span>
        </span>
        <Switch on={lock} label="Brand lock" onChange={onLock} />
      </label>
    </div>
  )
}

type KitVideo = { id: string; title: string; duration_ms: number | null }
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}`

/** One of the user's videos, or none (a kit's intro or outro) */
function VideoChoice({ label, value, videos, onChange }: { label: string; value: string | null; videos: KitVideo[]; onChange: (id: string | null) => void }) {
  const gone = !!value && !videos.some(v => v.id === value)
  return (
    <label className="cap-row">
      <span className="cap-label">{label}</span>
      <select value={value ?? ''} onChange={e => onChange(e.target.value || null)} aria-label={`${label} video`}
        className="h-8 max-w-[60%] px-2 rounded-lg text-xs text-[var(--ed-text)] outline-none"
        style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
        <option value="">None</option>
        {gone && <option value={value!}>A video no longer in your library</option>}
        {videos.map(v => <option key={v.id} value={v.id}>{v.title}{v.duration_ms ? ` · ${clock(v.duration_ms)}` : ''}</option>)}
      </select>
    </label>
  )
}

/** This clip's progress bar: on or off, its colour, thickness and edge */
function ClipProgressBar({ value, start, onChange }: { value: ProgressBar | null; start: ProgressBar; onChange: (bar: ProgressBar | null) => void }) {
  return (
    <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
      <label className="cap-row cursor-pointer select-none">
        <span className="flex flex-col min-w-0">
          <span className="cap-label">Progress bar</span>
          <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Fills up as this clip plays</span>
        </span>
        <Switch on={!!value} label="Progress bar on this clip" onChange={on => onChange(on ? (value ?? start) : null)} />
      </label>
      {value && <ProgressBarFields value={value} onChange={onChange} />}
    </div>
  )
}

/** A progress bar's colour, thickness and edge (the clip's, or a kit's) */
function ProgressBarFields({ value, onChange }: { value: ProgressBar; onChange: (bar: ProgressBar) => void }) {
  return (
    <>
      <ColorRow label="Colour" value={value.color} onChange={color => onChange({ ...value, color })} />
      <RangeRow label="Thickness" min={PROGRESS_HEIGHT[0]} max={PROGRESS_HEIGHT[1]} step={1} value={value.height} text={`${value.height} px`}
        onChange={height => onChange({ ...value, height })} />
      <div className="cap-row">
        <span className="cap-label">Edge</span>
        <div role="radiogroup" aria-label="Which edge the progress bar is on" className="cap-seg">
          {([['top', 'Top'], ['bottom', 'Bottom']] as const).map(([v, label]) => (
            <button key={v} type="button" role="radio" aria-checked={value.position === v} onClick={() => onChange({ ...value, position: v })}
              className="cap-seg-btn" data-on={value.position === v || undefined}>{label}</button>
          ))}
        </div>
      </div>
    </>
  )
}

function KitBadge({ kit }: { kit: BrandKit }) {
  return (
    <span className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden" style={{ background: kit.data.colors.main, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
      {kit.logo_url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={kit.logo_url} alt="" className="max-w-[80%] max-h-[80%] object-contain" />
        : <span className="text-sm font-bold" style={{ color: kit.data.colors.accent }}>{kit.name.trim().charAt(0).toUpperCase() || 'B'}</span>}
    </span>
  )
}

// ── Workshop: the kit set up, in the video's place ─────────────────────────

export function BrandKitStudio({ brand, onApply, onClose, videos = [] }: {
  brand: BrandKits; onApply: (kit: BrandKit) => void; onClose: () => void
  /** The user's videos, for the intro and outro */
  videos?: KitVideo[]
}) {
  const kit = brand.current
  const [applied, apply] = useApply(onApply)
  const [uploading, setUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [soundBusy, setSoundBusy] = useState<'music' | 'sting' | null>(null)
  const [soundError, setSoundError] = useState<string | null>(null)
  // The app's buttons over the preview: where the logo is safe from them
  const [platform, setPlatform] = useState<Platform>('instagram')
  const latest = useRef<{ id: string; data: BrandKitData; pending: boolean } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { loadVideoFonts() }, [])

  if (!kit) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm font-semibold text-[var(--ed-text)]">{brand.loading ? 'Loading your brand kits…' : brand.error ? brand.error : 'No brand kit yet'}</p>
        {!brand.loading && !brand.error && (
          <p className="text-xs max-w-xs" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>Make one with &ldquo;New brand kit&rdquo; on the left: your colours, logo, @handle and title style, ready for every clip.</p>
        )}
        <button type="button" onClick={onClose} className="text-xs font-semibold hover:underline" style={{ color: 'var(--ed-accent-text)' }}>Back to the video</button>
      </div>
    )
  }
  const d = kit.data
  // Each change builds on the one before it, even two in a row before the screen updates (picking a
  // caption style sets the style, then its capitals): the second would otherwise undo the first
  latest.current = latest.current && latest.current.id === kit.id && latest.current.pending ? latest.current : { id: kit.id, data: d, pending: false }
  const set = (data: BrandKitData) => {
    latest.current = { id: kit.id, data, pending: true }
    queueMicrotask(() => { if (latest.current) latest.current.pending = false })
    brand.update(kit.id, { data })
  }
  const now = () => (latest.current?.id === kit.id ? latest.current.data : d)
  const setCaptions = (c: Partial<BrandCaptions>) => { const cur = now(); set({ ...cur, captions: { ...cur.captions, ...c } }) }
  // A kit someone shared with this user: shown, not changed
  const readOnly = !!kit.shared_by

  async function pickSound(file: File | undefined, kind: 'music' | 'sting') {
    if (!file || !kit) return
    setSoundBusy(kind); setSoundError(null)
    try {
      const up = await brand.uploadSound(file, kind)
      const cur = now()
      const sound = kind === 'music'
        ? { ...cur.sound, music: { path: up.path, name: up.name, volume: cur.sound.music?.volume ?? 0.3 } }
        : { ...cur.sound, sting: { path: up.path, name: up.name } }
      latest.current = { id: kit.id, data: { ...cur, sound }, pending: true }
      queueMicrotask(() => { if (latest.current) latest.current.pending = false })
      brand.update(kit.id, { data: { ...cur, sound }, ...(kind === 'music' ? { music_url: up.url } : { sting_url: up.url }) })
    } catch (e) {
      setSoundError(e instanceof Error ? e.message : String(e))
    } finally { setSoundBusy(null) }
  }

  /** The kit filled from a link: its logo, colours, and the name, @handle and card title where they're still empty */
  async function fillFromLink(url: string): Promise<string> {
    const b = await brand.fromLink(url)
    const cur = now()
    const ratio = b.logo ? b.logo.ratio ?? (b.logo.url ? await urlRatio(b.logo.url) : null) ?? 1 : null
    const data: BrandKitData = {
      ...cur,
      handle: cur.handle || b.handle || '',
      card_title: cur.card_title || b.name || '',
      colors: b.colors ? { ...cur.colors, main: b.colors.main, accent: b.colors.accent ?? cur.colors.accent } : cur.colors,
      logo: b.logo ? { ...cur.logo, path: b.logo.path, ratio } : cur.logo,
    }
    latest.current = { id: kit!.id, data, pending: true }
    queueMicrotask(() => { if (latest.current) latest.current.pending = false })
    const rename = b.name && /^Brand kit( \d+)?$/.test(kit!.name.trim()) ? { name: b.name } : {}
    brand.update(kit!.id, { data, ...rename, ...(b.logo ? { logo_url: b.logo.url } : {}) })
    const got = [b.logo && 'logo', b.colors && 'colours', b.name && 'name', b.handle && '@handle'].filter(Boolean)
    return got.length ? `From ${b.source}: ${got.join(', ')} — check them below` : `Nothing to use was found on ${b.source} — fill the kit in by hand`
  }

  async function pickLogo(file: File | undefined) {
    if (!file || !kit) return
    setUploading(true); setLogoError(null)
    try {
      const up = await brand.uploadLogo(file)
      // (shown straight away from the link the upload gave)
      brand.update(kit.id, { data: { ...kit.data, logo: { ...kit.data.logo, path: up.path, ratio: up.ratio } }, logo_url: up.url })
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Its name, whether it's saved, Apply, back to the video */}
      <div className="shrink-0 flex items-center gap-3 px-5" style={{ minHeight: 60, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
        <KitBadge kit={kit} />
        <input value={kit.name} onChange={e => brand.update(kit.id, { name: e.target.value })} maxLength={40} aria-label="Brand kit name" readOnly={readOnly}
          onBlur={e => { if (!readOnly && !e.target.value.trim()) brand.update(kit.id, { name: 'Brand kit' }) }}
          className="flex-1 min-w-0 bg-transparent text-base font-bold text-[var(--ed-text)] outline-none rounded-md px-1.5 py-1 focus:bg-[rgb(var(--ed-fg)/0.06)]" />
        {readOnly
          ? <span className="text-[11px] shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Shared by {kit.shared_by}{d.lock ? ' · brand lock' : ''}</span>
          : <span role="status" className="text-[11px] shrink-0" style={{ color: brand.saveState === 'error' ? '#fca5a5' : 'rgb(var(--ed-fg) / 0.45)' }}>
            {brand.saveState === 'saving' ? 'Saving…' : brand.saveState === 'error' ? 'Not saved — check your connection' : 'Saved'}
          </span>}
        {!readOnly && <DefaultSwitch kit={kit} compact onChange={on => set({ ...now(), is_default: on })} />}
        <button type="button" onClick={() => apply(kit)} className="h-9 px-4 rounded-lg text-xs font-bold shrink-0" style={{ background: '#c8ff00', color: '#0a0a0a' }}>
          {applied ? 'Applied ✓' : 'Apply brand kit'}
        </button>
        <button type="button" onClick={onClose} aria-label="Back to the video" title="Back to the video"
          className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0 transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-wrap gap-8 p-6 items-start">
          {/* The settings */}
          <div className="flex-1 min-w-[300px] max-w-[560px] flex flex-col gap-6">
            {readOnly && (
              <p className="text-xs leading-relaxed p-3 rounded-lg" style={{ background: 'rgba(200,255,0,0.08)', color: 'rgb(var(--ed-fg) / 0.75)' }}>
                {kit.shared_by} shared this kit with you: put it on your clips with Apply. Only they can change it.
                {d.lock && ' Brand lock is on: your colour and font choices are its colours and fonts.'}
              </p>
            )}
            <div className="flex flex-col gap-6" inert={readOnly || undefined} style={readOnly ? { opacity: 0.6 } : undefined}>
            {!readOnly && (
              <Section title="Fill from a link">
                <LinkFill onFill={fillFromLink} />
              </Section>
            )}
            <Section title="Colours">
              <ColorRow label="Main colour" hint="Branded card background and frame bands" value={d.colors.main} onChange={main => set({ ...now(), colors: { ...now().colors, main } })} />
              <ColorRow label="Accent colour" hint="Your @handle on the Branded card" value={d.colors.accent} onChange={accent => set({ ...now(), colors: { ...now().colors, accent } })} />
              <ExtraColors value={d.colors.extra} onChange={extra => set({ ...now(), colors: { ...now().colors, extra } })} />
              <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                All your brand colours show first in the editor&rsquo;s colour choices — text, captions and frames.
              </p>
            </Section>

            <Section title="Fonts">
              <BrandFonts fonts={d.fonts} onChange={fonts => set({ ...now(), fonts })} />
            </Section>

            <Section title="Captions">
              <label className="cap-row cursor-pointer select-none">
                <span className="flex flex-col min-w-0">
                  <span className="cap-label">Brand captions</span>
                  <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                    {d.captions.on ? 'New clips and Apply use this caption style' : 'Off: clips keep the caption style they have'}
                  </span>
                </span>
                <Switch on={d.captions.on} label="Brand captions" onChange={on => setCaptions({ on })} />
              </label>
              {d.captions.on && (
                <div className="-mx-4 -mb-4">
                  <CaptionStyler
                    style={brandCaptionStyle(d.captions)} textCase={d.captions.uppercase ? 'upper' : 'title'}
                    onChange={u => setCaptions(captionPatch(u))}
                    onTextCaseChange={(c: TextCase) => setCaptions({ uppercase: c === 'upper' })}
                    onEditCaptions={() => {}} onRetranscribe={() => {}} retranscribing={false} hasWords={false} />
                </div>
              )}
            </Section>

            <Section title="Progress bar">
              <label className="cap-row cursor-pointer select-none">
                <span className="flex flex-col min-w-0">
                  <span className="cap-label">Brand progress bar</span>
                  <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                    {d.progress.on ? 'New clips and Apply get a bar that fills up as the clip plays' : 'Off: clips keep the bar they have, or none'}
                  </span>
                </span>
                <Switch on={d.progress.on} label="Brand progress bar" onChange={on => set({ ...now(), progress: { ...now().progress, on } })} />
              </label>
              {d.progress.on && (
                <ProgressBarFields value={d.progress} onChange={bar => set({ ...now(), progress: { ...bar, on: true } })} />
              )}
            </Section>

            <Section title="Frames">
              <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                Up to {MAX_BRAND_FRAMES} frames your brand uses: they show first in the Frames tool.
              </p>
              <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Your brand's frames">
                {FRAME_LAYOUTS.map(id => {
                  const on = d.frames.preferred.includes(id)
                  const full = !on && d.frames.preferred.length >= MAX_BRAND_FRAMES
                  return (
                    <button key={id} type="button" aria-pressed={on} disabled={full} title={FRAME_TEMPLATES[id].description}
                      onClick={() => { const f = now().frames; set({ ...now(), frames: { ...f, preferred: on ? f.preferred.filter(x => x !== id) : [...f.preferred, id] } }) }}
                      className="min-w-0 flex flex-col items-center gap-1 px-0.5 py-1.5 rounded-lg text-center disabled:opacity-35"
                      style={{ background: on ? 'rgba(200,255,0,0.08)' : 'rgb(var(--ed-fg) / 0.02)', boxShadow: `inset 0 0 0 ${on ? 1.5 : 1}px ${on ? '#c8ff00' : 'rgb(var(--ed-fg) / 0.08)'}` }}>
                      <FrameThumb layout={id as FrameLayout} />
                      <span className="w-full text-[9.5px] font-semibold leading-[1.15]" style={{ color: on ? 'var(--ed-text)' : 'rgb(var(--ed-fg) / 0.7)' }}>{FRAME_TEMPLATES[id].name}</span>
                    </button>
                  )
                })}
              </div>
              <label className="cap-row cursor-pointer select-none">
                <span className="flex flex-col min-w-0">
                  <span className="cap-label">Brand corners</span>
                  <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                    {d.frames.corners !== null ? 'Apply rounds the clip’s frames like this; new frames start with it' : 'Off: frames keep their own corners'}
                  </span>
                </span>
                <Switch on={d.frames.corners !== null} label="Brand corners" onChange={on => set({ ...now(), frames: { ...now().frames, corners: on ? 80 : null } })} />
              </label>
              {d.frames.corners !== null && (
                <RangeRow label="Rounding" min={0} max={100} step={5} value={d.frames.corners} text={`${d.frames.corners}%`}
                  onChange={corners => set({ ...now(), frames: { ...now().frames, corners } })} />
              )}
            </Section>

            <Section title="Intro, outro & end card">
              <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                Apply puts the intro before the clip and the outro after it — short ones (a few seconds) work best.
              </p>
              <VideoChoice label="Intro" value={d.intro} videos={videos} onChange={intro => set({ ...now(), intro })} />
              <VideoChoice label="Outro" value={d.outro} videos={videos} onChange={outro => set({ ...now(), outro })} />
              <label className="cap-row cursor-pointer select-none">
                <span className="flex flex-col min-w-0">
                  <span className="cap-label">End card</span>
                  <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                    The clip&rsquo;s last seconds become a Branded card with your title and @handle
                  </span>
                </span>
                <Switch on={d.end_card.on} label="End card" onChange={on => set({ ...now(), end_card: { ...now().end_card, on } })} />
              </label>
              {d.end_card.on && (
                <RangeRow label="For" min={END_CARD_SECONDS[0]} max={END_CARD_SECONDS[1]} step={1} value={d.end_card.seconds} text={`${d.end_card.seconds} s`}
                  onChange={seconds => set({ ...now(), end_card: { ...now().end_card, seconds } })} />
              )}
            </Section>

            <Section title="Sound">
              <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                Apply puts your music under the clip (quieter while someone talks) and your sound logo at its start or end.
              </p>
              <SoundRow label="Music" file={d.sound.music} url={kit.music_url ?? null} busy={soundBusy === 'music'}
                onPick={f => pickSound(f, 'music')} onRemove={() => set({ ...now(), sound: { ...now().sound, music: null } })} />
              {d.sound.music && (
                <RangeRow label="Volume" min={0.05} max={1} step={0.05} value={d.sound.music.volume} text={`${Math.round(d.sound.music.volume * 100)}%`}
                  onChange={volume => set({ ...now(), sound: { ...now().sound, music: { ...now().sound.music!, volume } } })} />
              )}
              <SoundRow label="Sound logo" file={d.sound.sting} url={kit.sting_url ?? null} busy={soundBusy === 'sting'}
                onPick={f => pickSound(f, 'sting')} onRemove={() => set({ ...now(), sound: { ...now().sound, sting: null } })} />
              {d.sound.sting && (
                <div className="cap-row">
                  <span className="cap-label">Plays</span>
                  <div role="radiogroup" aria-label="When the sound logo plays" className="cap-seg">
                    {([['start', 'At the start'], ['end', 'At the end']] as const).map(([v, label]) => (
                      <button key={v} type="button" role="radio" aria-checked={d.sound.sting_at === v} onClick={() => set({ ...now(), sound: { ...now().sound, sting_at: v } })}
                        className="cap-seg-btn" data-on={d.sound.sting_at === v || undefined}>{label}</button>
                    ))}
                  </div>
                </div>
              )}
              {soundError && <p role="alert" className="text-[11px]" style={{ color: '#fca5a5' }}>{soundError}</p>}
            </Section>

            <Section title="Brand voice">
              <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                How AI writes your titles, hooks and post text — in Make my clips and Regenerate (the default kit&rsquo;s).
              </p>
              <TextRow label="Sounds" placeholder="e.g. friendly, confident, a little funny" value={d.voice.tone} max={200}
                onChange={tone => set({ ...now(), voice: { ...now().voice, tone } })} />
              <TextRow label="Never say" placeholder="e.g. cheap, hack, guys" value={d.voice.avoid} max={200}
                onChange={avoid => set({ ...now(), voice: { ...now().voice, avoid } })} />
              <TextRow label="Hashtags" placeholder={`Always on every post — up to ${MAX_BRAND_HASHTAGS}`} value={d.voice.hashtags.map(h => `#${h}`).join(' ')} max={240}
                onChange={v => set({ ...now(), voice: { ...now().voice, hashtags: v.split(/[\s,]+/).map(h => h.replace(/^#+/, '')).filter(Boolean).slice(0, MAX_BRAND_HASHTAGS) } })}
                commitOnBlur />
              <TextRow label="Ends with" placeholder="e.g. Follow for more — link in bio" value={d.voice.cta} max={120}
                onChange={cta => set({ ...now(), voice: { ...now().voice, cta } })} />
            </Section>

            <Section title="Names & spellings">
              <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                Your brand, products and people, one per line. Captions spell them exactly like this
                (&ldquo;short cut&rdquo; becomes &ldquo;Shortcut&rdquo;), from the next captions made.
              </p>
              <GlossaryBox value={d.glossary} onChange={glossary => set({ ...now(), glossary })} />
            </Section>

            <Section title="Logo">
              <div className="flex items-center gap-3">
                <div className="w-20 h-20 rounded-xl flex items-center justify-center overflow-hidden shrink-0"
                  style={{ background: 'repeating-conic-gradient(rgb(var(--ed-fg) / 0.08) 0 25%, transparent 0 50%) 0 0 / 14px 14px', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
                  {d.logo.path && kit.logo_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={kit.logo_url} alt="Your logo" className="max-w-[85%] max-h-[85%] object-contain" />
                    : <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>No logo</span>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => pickLogo(e.target.files?.[0])} />
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="h-8 px-3 rounded-lg text-xs font-semibold disabled:opacity-50"
                    style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.08)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
                    {uploading ? 'Uploading…' : d.logo.path ? 'Change logo' : 'Upload logo'}
                  </button>
                  {d.logo.path && (
                    <button type="button" onClick={() => set({ ...now(), logo: { ...now().logo, path: null, ratio: null } })}
                      className="self-start text-[11px] hover:underline" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Remove logo</button>
                  )}
                  <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>PNG with a see-through background works best · up to 5 MB</span>
                </div>
              </div>
              {logoError && <p role="alert" className="text-[11px]" style={{ color: '#fca5a5' }}>{logoError}</p>}
              <div className="cap-row">
                <span className="flex flex-col min-w-0">
                  <span className="cap-label">Place</span>
                  <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                    {d.logo.x !== null ? 'Placed by hand — pick a corner to snap it back' : 'A corner, or drag it anywhere on the preview'}
                  </span>
                </span>
                <CornerSwitch value={d.logo.x !== null ? null : d.logo.corner} onChange={corner => set({ ...now(), logo: { ...now().logo, corner, x: null, y: null } })} />
              </div>
              <div className="cap-row">
                <span className="cap-label">Shows</span>
                <div role="radiogroup" aria-label="When the logo shows" className="cap-seg">
                  {([['all', 'Whole clip'], ['start', 'At the start'], ['end', 'At the end']] as const).map(([v, label]) => (
                    <button key={v} type="button" role="radio" aria-checked={d.logo.show === v} onClick={() => set({ ...now(), logo: { ...now().logo, show: v as LogoShow } })}
                      className="cap-seg-btn" data-on={d.logo.show === v || undefined}>{label}</button>
                  ))}
                </div>
              </div>
              {d.logo.show !== 'all' && (
                <RangeRow label="For" min={LOGO_SECONDS[0]} max={LOGO_SECONDS[1]} step={1} value={d.logo.seconds} text={`${d.logo.seconds} s`}
                  onChange={seconds => set({ ...now(), logo: { ...now().logo, seconds } })} />
              )}
              <RangeRow label="Size" min={LOGO_SIZE[0]} max={LOGO_SIZE[1]} step={0.01} value={d.logo.size} text={`${Math.round(d.logo.size * 100)}%`}
                onChange={size => set({ ...now(), logo: { ...now().logo, size } })} />
              <RangeRow label="Opacity" min={0.1} max={1} step={0.05} value={d.logo.opacity} text={`${Math.round(d.logo.opacity * 100)}%`}
                onChange={opacity => set({ ...now(), logo: { ...now().logo, opacity } })} />
            </Section>

            <Section title="@handle">
              <label className="flex items-center gap-1 h-9 px-3 rounded-lg" style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
                <span className="text-sm font-semibold" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>@</span>
                <input value={d.handle} onChange={e => set({ ...now(), handle: e.target.value.replace(/^@+/, '').replace(/\s+/g, '') })} maxLength={40}
                  placeholder="yourchannel" aria-label="Your @handle" className="flex-1 min-w-0 bg-transparent text-sm text-[var(--ed-text)] outline-none" />
              </label>
            </Section>

            <Section title="Title style">
              <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                For text on the clip. Frame titles take this colour and keep the frame&rsquo;s own font.
              </p>
              <FontPicker value={d.title.font} onChange={font => set({ ...now(), title: { ...now().title, font: font === 'sans-serif' ? null : font } })} />
              <ColorRow label="Colour" value={d.title.color} onChange={color => set({ ...now(), title: { ...now().title, color } })} />
              <RangeRow label="Size" min={24} max={160} step={2} value={d.title.size} text={`${d.title.size}`}
                onChange={size => set({ ...now(), title: { ...now().title, size } })} />
            </Section>

            <Section title="Branded card">
              <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                The Branded card frame (in Frames) starts with these: your main colour, this title and your @handle.
              </p>
              <input value={d.card_title} onChange={e => set({ ...now(), card_title: e.target.value })} maxLength={80}
                placeholder="Card title — e.g. your show's name" aria-label="Branded card title"
                className="h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none"
                style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
            </Section>

            {!readOnly && (
              <Section title="Team">
                <KitTeam kitId={kit.id} lock={d.lock} onLock={lock => set({ ...now(), lock })} />
              </Section>
            )}
            </div>
          </div>

          {/* How it looks */}
          <div className="flex gap-5 flex-wrap">
            <div className="flex flex-col gap-2">
              <Mock label="On your clip">
                <ClipMock kit={kit} platform={platform} onPlace={readOnly ? undefined : (x, y) => set({ ...now(), logo: { ...now().logo, x, y } })} />
              </Mock>
              <PlatformSwitch value={platform} onChange={setPlatform} />
              {platform !== 'off' && d.logo.path && logoCovered(d, platform) && (
                <p role="status" className="text-[11px] max-w-[200px]" style={{ color: '#fbbf24' }}>
                  {PLATFORM_SAFE[platform].name}&rsquo;s buttons or text cover part of the logo there — drag it into the clear area.
                </p>
              )}
            </div>
            <Mock label="Branded card">
              <CardMock kit={kit} />
            </Mock>
          </div>
        </div>
      </div>
    </div>
  )
}

const MOCK_W = 200, MOCK_H = (MOCK_W * 16) / 9, K = MOCK_W / 1080
/** Frame text is drawn in Montserrat Bold (render.py _frame_text_font) */
const FRAME_FONT = 'Montserrat, sans-serif'

function Mock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <figure className="flex flex-col gap-2 m-0">
      <figcaption className="cap-heading">{label}</figcaption>
      <div className="relative overflow-hidden rounded-xl" style={{ width: MOCK_W, height: MOCK_H, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.12), 0 8px 24px rgba(0,0,0,0.4)' }}>
        {children}
      </div>
    </figure>
  )
}

/**
 * The logo where Apply puts it, over a stand-in video, with a line of text in the title style and a
 * caption line in the kit's caption style. The logo can be dragged anywhere (onPlace: its new
 * top-left, shares of the frame); the app's buttons can be laid over it.
 */
function ClipMock({ kit, platform = 'off', onPlace }: { kit: BrandKit; platform?: Platform; onPlace?: (x: number, y: number) => void }) {
  const d = kit.data, box = logoBox(d.logo)
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null)
  const shown = drag ?? { x: box.x, y: box.y }
  function down(e: React.PointerEvent<HTMLImageElement>) {
    if (!onPlace || e.button !== 0) return
    e.preventDefault()
    const frame = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
    const x0 = e.clientX, y0 = e.clientY, bx = box.x, by = box.y
    let last = { x: bx, y: by }
    const move = (ev: PointerEvent) => {
      last = {
        x: Math.round(Math.min(1 - box.w, Math.max(0, bx + (ev.clientX - x0) / frame.width)) * 1000) / 1000,
        y: Math.round(Math.min(1 - box.h, Math.max(0, by + (ev.clientY - y0) / frame.height)) * 1000) / 1000,
      }
      setDrag(last)
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setDrag(null)
      if (last.x !== bx || last.y !== by) onPlace(last.x, last.y)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div className="absolute inset-0" style={{ containerType: 'inline-size' }}>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #3a4150 0%, #1d2129 55%, #2c2a24 100%)' }} />
      <div className="absolute rounded-full" style={{ left: '28%', top: '30%', width: '44%', height: '25%', background: 'rgba(255,255,255,0.08)' }} />
      <div className="absolute inset-x-0 text-center px-3" style={{ top: '18%', fontFamily: d.title.font ?? 'sans-serif', fontWeight: 700, fontSize: d.title.size * K, color: d.title.color, lineHeight: 1.15, textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
        Your text here
      </div>
      {d.captions.on && <CaptionSample c={d.captions} />}
      {d.progress.on && (
        // (at 40%, as if the clip were playing)
        <div className="absolute left-0" aria-hidden="true"
          style={{ width: '40%', height: Math.max(2, d.progress.height * (MOCK_H / 1920)), background: d.progress.color, [d.progress.position]: 0 }} />
      )}
      {platform !== 'off' && <div className="absolute inset-0 pointer-events-none"><PlatformOverlay platform={platform} /></div>}
      {d.logo.path && kit.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={kit.logo_url} alt="Your logo — drag to place it" draggable={false} onPointerDown={down}
          title={onPlace ? 'Drag to place it anywhere' : undefined}
          className="absolute select-none"
          style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, opacity: d.logo.opacity, objectFit: 'fill', cursor: onPlace ? (drag ? 'grabbing' : 'grab') : undefined, touchAction: 'none', outline: drag ? '1.5px dashed #c8ff00' : undefined }} />
      )}
    </div>
  )
}

/** A caption line in the kit's caption style, where captions sit (the spoken word in the highlight colour) */
function CaptionSample({ c }: { c: BrandCaptions }) {
  const tpl = templateOf({ template: c.template })
  const font = c.font ?? (tpl ? templateFontFamily(tpl.font) : 'sans-serif')
  const words = ['Your', 'captions', 'look', 'like', 'this']
  return (
    <div className="absolute inset-x-0 flex flex-wrap justify-center gap-x-[0.3em] px-3 text-center" style={{
      top: '66%', fontFamily: font, fontWeight: 800, fontSize: c.size * K * 1.1, lineHeight: 1.15,
      textTransform: c.uppercase ? 'uppercase' : undefined, textShadow: '0 1px 2px rgba(0,0,0,0.85), 0 0 2px rgba(0,0,0,0.85)',
    }}>
      {words.map((w, i) => <span key={i} style={{ color: i === 1 && c.animation !== 'none' ? c.highlight_color : c.color }}>{w}</span>)}
    </div>
  )
}

/** Whether the app's buttons or text cover part of the logo where it is */
function logoCovered(d: BrandKitData, platform: Exclude<Platform, 'off'>): boolean {
  const z = PLATFORM_SAFE[platform], b = logoBox(d.logo)
  const hits = (x0: number, y0: number, x1: number, y1: number) => b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0
  return hits(0, 0, 1, z.top) || hits(0, 1 - z.bottom, 1, 1) || hits(1 - z.right, z.rightFrom, 1, 1 - z.bottom)
}

/** Which app's buttons to show over the clip preview */
function PlatformSwitch({ value, onChange }: { value: Platform; onChange: (p: Platform) => void }) {
  return (
    <div role="radiogroup" aria-label="Show an app's buttons over the preview" className="cap-seg self-start">
      {([['off', 'Off'], ['instagram', 'Instagram'], ['youtube', 'Shorts']] as const).map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className="cap-seg-btn" data-on={value === v || undefined}>{label}</button>
      ))}
    </div>
  )
}

/** A caption style change from the Captions panel, as the kit keeps it */
function captionPatch(u: Partial<import('@/lib/shared/types').CaptionStyle>): Partial<BrandCaptions> {
  const out: Partial<BrandCaptions> = {}
  if ('template' in u) out.template = u.template ?? null
  if (u.animation) out.animation = u.animation
  if ('font' in u) out.font = u.font ?? null
  if (typeof u.size === 'number') out.size = u.size
  if (u.color) out.color = u.color.toLowerCase()
  if (u.highlight_color) out.highlight_color = u.highlight_color.toLowerCase()
  if (typeof u.uppercase === 'boolean') out.uppercase = u.uppercase
  if ('words_per_line' in u) out.words_per_line = u.words_per_line ?? null
  return out
}

/** "Use for new clips": the account's default kit (at most one) */
function DefaultSwitch({ kit, compact = false, onChange }: { kit: BrandKit; compact?: boolean; onChange: (on: boolean) => void }) {
  const on = kit.data.is_default
  return (
    <label className={`flex items-center gap-2 cursor-pointer select-none ${compact ? 'shrink-0' : ''}`}
      title="New clips — made by hand, from Best moments or Ask AI, and by Make my clips — get this kit by themselves">
      <Switch on={on} label="Use for new clips" onChange={onChange} />
      <span className="text-[11.5px] font-semibold" style={{ color: on ? 'var(--ed-accent-text)' : 'rgb(var(--ed-fg) / 0.6)' }}>
        {compact ? 'Default' : 'Use for every new clip'}
      </span>
    </label>
  )
}

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={e => { e.preventDefault(); onChange(!on) }}
      className="relative shrink-0 rounded-full transition-colors" style={{ width: 34, height: 19, background: on ? '#c8ff00' : 'rgb(var(--ed-fg) / 0.18)' }}>
      <span className="absolute top-[2px] rounded-full transition-[left]" style={{ left: on ? 17 : 2, width: 15, height: 15, background: on ? '#0a0a0a' : '#fff' }} />
    </button>
  )
}

/**
 * The kit's own fonts: upload a TTF or OTF (up to MAX_BRAND_FONTS), rename, remove. They show first
 * in every font choice (captions, text, the title style) and the export draws with them.
 */
function BrandFonts({ fonts, onChange }: { fonts: Array<{ family: string; name: string }>; onChange: (f: Array<{ family: string; name: string }>) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => { fonts.forEach(f => { ensureBrandFont(f.family) }) }, [fonts])
  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true); setError(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/brand-kits/font', { method: 'POST', body: form })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'The font could not be uploaded')
      await ensureBrandFont(body.family)
      onChange([...fonts, { family: body.family, name: body.name }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {fonts.map((f, i) => (
        <div key={f.family} className="flex items-center gap-2">
          <span className="w-10 text-center text-lg shrink-0" style={{ fontFamily: f.family, color: 'var(--ed-text)' }} aria-hidden="true">Aa</span>
          <input value={f.name} maxLength={40} aria-label={`Name of brand font ${i + 1}`}
            onChange={e => onChange(fonts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            className="flex-1 min-w-0 h-8 px-2 rounded-md text-sm text-[var(--ed-text)] outline-none"
            style={{ fontFamily: f.family, background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
          <button type="button" aria-label={`Remove brand font ${f.name}`} onClick={() => onChange(fonts.filter((_, j) => j !== i))}
            className="w-7 h-7 shrink-0 rounded-md text-sm" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>×</button>
        </div>
      ))}
      <input ref={fileRef} type="file" accept=".ttf,.otf,font/ttf,font/otf" className="hidden" aria-label="Upload a font file" onChange={e => upload(e.target.files?.[0])} />
      {fonts.length < MAX_BRAND_FONTS && (
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
          className="self-start h-8 px-3 rounded-lg text-xs font-semibold disabled:opacity-50"
          style={{ color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.08)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
          {busy ? 'Uploading…' : 'Upload a font'}
        </button>
      )}
      <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
        TTF or OTF, up to 10 MB · up to {MAX_BRAND_FONTS}. They show first in every font choice and in your exports. Use fonts you have the right to use.
      </span>
      {error && <p role="alert" className="text-[11px]" style={{ color: '#fca5a5' }}>{error}</p>}
    </div>
  )
}

/** A labelled one-line text field; `commitOnBlur`: typed freely, saved when left (a list typed as text) */
function TextRow({ label, placeholder, value, max, onChange, commitOnBlur = false }: {
  label: string; placeholder: string; value: string; max: number; onChange: (v: string) => void; commitOnBlur?: boolean
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <label className="flex flex-col gap-1">
      <span className="cap-label">{label}</span>
      <input value={commitOnBlur ? draft : value} maxLength={max} placeholder={placeholder} aria-label={label}
        onChange={e => (commitOnBlur ? setDraft(e.target.value) : onChange(e.target.value))}
        onBlur={() => { if (commitOnBlur && draft !== value) onChange(draft) }}
        onKeyDown={e => { if (commitOnBlur && e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none"
        style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
    </label>
  )
}

/** The glossary: one name per line, saved when the box is left */
function GlossaryBox({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState(value.join('\n'))
  useEffect(() => { setDraft(value.join('\n')) }, [value])
  const commit = () => {
    const next = [...new Set(draft.split('\n').map(t => t.replace(/\s+/g, ' ').trim().slice(0, 40)).filter(Boolean))].slice(0, MAX_GLOSSARY)
    if (next.join('\n') !== value.join('\n')) onChange(next)
  }
  return (
    <div className="flex flex-col gap-1">
      <textarea value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit} rows={4} aria-label="Names and spellings, one per line"
        placeholder={'Shortcut\nMutiny Talent\nNarasimha'}
        className="px-3 py-2 rounded-lg text-sm text-[var(--ed-text)] outline-none resize-y"
        style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
      <span className="text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{value.length} of {MAX_GLOSSARY}</span>
    </div>
  )
}

/** Up to MAX_EXTRA_COLORS more brand colours: each one changed, removed, or one added */
function ExtraColors({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="cap-row">
      <span className="flex flex-col min-w-0">
        <span className="cap-label">More colours</span>
        <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Up to {MAX_EXTRA_COLORS}</span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        {value.map((c, i) => (
          <span key={i} className="relative group">
            <input type="color" value={c} aria-label={`Brand colour ${i + 3}`} onChange={e => onChange(value.map((x, j) => (j === i ? e.target.value.toLowerCase() : x)))}
              className="w-8 h-8 rounded-md cursor-pointer bg-transparent" style={{ border: 'none', padding: 0 }} />
            <button type="button" aria-label={`Remove brand colour ${i + 3}`} onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] leading-none opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              style={{ background: '#111', color: '#fff', boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.3)' }}>×</button>
          </span>
        ))}
        {value.length < MAX_EXTRA_COLORS && (
          <button type="button" onClick={() => onChange([...value, '#ffffff'])} aria-label="Add a brand colour"
            className="w-8 h-8 rounded-md text-base font-semibold" style={{ color: 'rgb(var(--ed-fg) / 0.6)', boxShadow: 'inset 0 0 0 1.5px rgb(var(--ed-fg) / 0.2)' }}>+</button>
        )}
      </span>
    </div>
  )
}

/** The Branded card as it starts: the video as a rounded card on the main colour, the title above, the @handle below */
function CardMock({ kit }: { kit: BrandKit }) {
  const d = kit.data
  return (
    <div className="absolute inset-0 flex flex-col items-center" style={{ background: d.colors.main }}>
      <div className="flex items-center justify-center text-center px-3" style={{ height: '15%', marginTop: '5%', width: '88%', fontFamily: FRAME_FONT, fontWeight: 700, fontSize: d.title.size * K, color: d.title.color, lineHeight: 1.1 }}>
        {d.card_title || kit.name}
      </div>
      <div className="rounded-[10px]" style={{ width: '88%', height: '60%', marginTop: '1%', background: 'linear-gradient(160deg, #3a4150 0%, #1d2129 60%, #2c2a24 100%)' }} />
      <div className="flex items-center justify-center" style={{ height: '10%', marginTop: '2%', fontFamily: FRAME_FONT, fontWeight: 700, fontSize: 40 * K, color: d.colors.accent }}>
        {showHandle(d.handle) || '@yourchannel'}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 p-4 rounded-2xl" style={{ background: 'rgb(var(--ed-fg) / 0.03)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.08)' }}>
      <h3 className="cap-heading">{title}</h3>
      {children}
    </section>
  )
}

function ColorRow({ label, hint, value, onChange }: { label: string; hint?: string; value: string; onChange: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])
  return (
    <div className="cap-row">
      <span className="flex flex-col min-w-0">
        <span className="cap-label">{label}</span>
        {hint && <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{hint}</span>}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <input value={draft} onChange={e => { setDraft(e.target.value); if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase()) }}
          onBlur={() => setDraft(value)} aria-label={`${label} (hex)`} maxLength={7}
          className="w-20 h-8 px-2 rounded-md text-xs font-mono text-[var(--ed-text)] outline-none" style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
        <input type="color" value={value} onChange={e => onChange(e.target.value.toLowerCase())} aria-label={label}
          className="w-8 h-8 rounded-md cursor-pointer bg-transparent" style={{ border: 'none', padding: 0 }} />
      </span>
    </div>
  )
}

function RangeRow({ label, min, max, step, value, text, onChange }: { label: string; min: number; max: number; step: number; value: number; text: string; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="cap-label w-16 shrink-0">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={e => onChange(Number(e.target.value))}
        className="ed-zoom-range flex-1 min-w-0" style={{ width: 'auto', '--p': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} />
      <span className="cap-value shrink-0">{text}</span>
    </div>
  )
}

const CORNERS: { id: LogoCorner; label: string }[] = [
  { id: 'tl', label: 'Top left' }, { id: 'tr', label: 'Top right' }, { id: 'bl', label: 'Bottom left' }, { id: 'br', label: 'Bottom right' },
]

/** Which corner the logo goes in: a little frame with a spot in each corner */
function CornerSwitch({ value, onChange }: { value: LogoCorner | null; onChange: (v: LogoCorner) => void }) {
  return (
    <div role="radiogroup" aria-label="Logo corner" className="relative rounded-md" style={{ width: 44, height: 70, boxShadow: 'inset 0 0 0 1.5px rgb(var(--ed-fg) / 0.25)' }}>
      {CORNERS.map(c => {
        const on = c.id === value
        return (
          <button key={c.id} type="button" role="radio" aria-checked={on} aria-label={c.label} title={c.label} onClick={() => onChange(c.id)}
            className="absolute rounded-[3px] transition-colors"
            style={{
              width: 14, height: 10, [c.id.startsWith('t') ? 'top' : 'bottom']: 5, [c.id.endsWith('l') ? 'left' : 'right']: 5,
              background: on ? '#c8ff00' : 'rgb(var(--ed-fg) / 0.18)',
            }} />
        )
      })}
    </div>
  )
}
