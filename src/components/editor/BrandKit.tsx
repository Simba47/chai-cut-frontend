'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { FontPicker, loadVideoFonts } from './CaptionStyler'
import {
  LOGO_SIZE, logoBox, showHandle, type BrandKit, type BrandKitData, type LogoCorner,
} from '@/lib/shared/brandKit'

/**
 * The editor's Brand kit tool (user, 2026-10-17): the kits listed in the options panel (pick one,
 * make a new one, Apply it to the clip), and the kit edited in a workshop that takes the video's
 * place in the middle — more room to set it up. Kits are the account's (api/brand-kits), saved as
 * they're changed; how many there can be depends on the plan.
 */

type SaveState = 'saved' | 'saving' | 'error'
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
  /** logo_url: the new logo's link, for showing it (not saved) */
  update: (id: string, patch: { name?: string; data?: BrandKitData; logo_url?: string | null }) => void
  remove: (id: string) => Promise<void>
  uploadLogo: (file: File) => Promise<{ path: string; url: string | null; ratio: number }>
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
    fetch(`/api/brand-kits/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch), keepalive })
      .then(r => json<{ kit: BrandKit }>(r))
      // (the saved kit's logo link; what's on screen stays as typed meanwhile)
      .then(d => {
        setKits(ks => ks.map(k => (k.id === id ? { ...k, logo_url: d.kit.logo_url ?? k.logo_url } : k)))
        if (!timers.current.size) setSaveState('saved')
      })
      .catch(() => setSaveState('error'))
  }, [])
  // Leaving the editor: what's still waiting is sent
  useEffect(() => () => { for (const id of [...pending.current.keys()]) flush(id, true) }, [flush])

  const update = useCallback((id: string, { logo_url, ...patch }: { name?: string; data?: BrandKitData; logo_url?: string | null }) => {
    setKits(ks => ks.map(k => (k.id === id ? {
      ...k, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.data ? { data: patch.data } : {}),
      ...(logo_url !== undefined ? { logo_url } : {}),
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

  const current = kits.find(k => k.id === currentId) ?? null
  return { kits, limit, plan, loading, error, current, select, create, update, remove, uploadLogo, saveState, reload: load }
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

export function BrandKitPanel({ brand, onApply, onDelete }: {
  brand: BrandKits
  onApply: (kit: BrandKit) => void
  /** Asks first, then deletes */
  onDelete: (kit: BrandKit) => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [applied, apply] = useApply(onApply)
  const full = brand.kits.length >= brand.limit
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
          {brand.kits.length} of {brand.limit} · {planName}
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
                <span className="text-[13px] font-semibold truncate text-[var(--ed-text)]">{k.name}</span>
                <span className="text-[11px] truncate" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{showHandle(k.data.handle) || 'No @handle yet'}</span>
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
            Puts &ldquo;{brand.current.name}&rdquo; on this clip: its logo on the whole clip, its title font and colour on
            your text (frame text keeps its own font), its colour on frame bands, and fills any Branded card. One undo step.
          </p>
          <button type="button" onClick={() => onDelete(brand.current!)}
            className="self-start text-[11px] font-medium hover:underline" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
            Delete this kit
          </button>
        </div>
      )}
    </div>
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

export function BrandKitStudio({ brand, onApply, onClose }: { brand: BrandKits; onApply: (kit: BrandKit) => void; onClose: () => void }) {
  const kit = brand.current
  const [applied, apply] = useApply(onApply)
  const [uploading, setUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
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
  const set = (data: BrandKitData) => brand.update(kit.id, { data })

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
        <input value={kit.name} onChange={e => brand.update(kit.id, { name: e.target.value })} maxLength={40} aria-label="Brand kit name"
          onBlur={e => { if (!e.target.value.trim()) brand.update(kit.id, { name: 'Brand kit' }) }}
          className="flex-1 min-w-0 bg-transparent text-base font-bold text-[var(--ed-text)] outline-none rounded-md px-1.5 py-1 focus:bg-[rgb(var(--ed-fg)/0.06)]" />
        <span role="status" className="text-[11px] shrink-0" style={{ color: brand.saveState === 'error' ? '#fca5a5' : 'rgb(var(--ed-fg) / 0.45)' }}>
          {brand.saveState === 'saving' ? 'Saving…' : brand.saveState === 'error' ? 'Not saved — check your connection' : 'Saved'}
        </span>
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
            <Section title="Colours">
              <ColorRow label="Main colour" hint="Branded card background and frame bands" value={d.colors.main} onChange={main => set({ ...d, colors: { ...d.colors, main } })} />
              <ColorRow label="Accent colour" hint="Your @handle on the Branded card" value={d.colors.accent} onChange={accent => set({ ...d, colors: { ...d.colors, accent } })} />
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
                    <button type="button" onClick={() => set({ ...d, logo: { ...d.logo, path: null, ratio: null } })}
                      className="self-start text-[11px] hover:underline" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Remove logo</button>
                  )}
                  <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>PNG with a see-through background works best · up to 5 MB</span>
                </div>
              </div>
              {logoError && <p role="alert" className="text-[11px]" style={{ color: '#fca5a5' }}>{logoError}</p>}
              <div className="cap-row">
                <span className="cap-label">Corner</span>
                <CornerSwitch value={d.logo.corner} onChange={corner => set({ ...d, logo: { ...d.logo, corner } })} />
              </div>
              <RangeRow label="Size" min={LOGO_SIZE[0]} max={LOGO_SIZE[1]} step={0.01} value={d.logo.size} text={`${Math.round(d.logo.size * 100)}%`}
                onChange={size => set({ ...d, logo: { ...d.logo, size } })} />
              <RangeRow label="Opacity" min={0.1} max={1} step={0.05} value={d.logo.opacity} text={`${Math.round(d.logo.opacity * 100)}%`}
                onChange={opacity => set({ ...d, logo: { ...d.logo, opacity } })} />
            </Section>

            <Section title="@handle">
              <label className="flex items-center gap-1 h-9 px-3 rounded-lg" style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
                <span className="text-sm font-semibold" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>@</span>
                <input value={d.handle} onChange={e => set({ ...d, handle: e.target.value.replace(/^@+/, '').replace(/\s+/g, '') })} maxLength={40}
                  placeholder="yourchannel" aria-label="Your @handle" className="flex-1 min-w-0 bg-transparent text-sm text-[var(--ed-text)] outline-none" />
              </label>
            </Section>

            <Section title="Title style">
              <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                For text on the clip. Frame titles take this colour and keep the frame&rsquo;s own font.
              </p>
              <FontPicker value={d.title.font} onChange={font => set({ ...d, title: { ...d.title, font: font === 'sans-serif' ? null : font } })} />
              <ColorRow label="Colour" value={d.title.color} onChange={color => set({ ...d, title: { ...d.title, color } })} />
              <RangeRow label="Size" min={24} max={160} step={2} value={d.title.size} text={`${d.title.size}`}
                onChange={size => set({ ...d, title: { ...d.title, size } })} />
            </Section>

            <Section title="Branded card">
              <p className="text-[11px] -mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                The Branded card frame (in Frames) starts with these: your main colour, this title and your @handle.
              </p>
              <input value={d.card_title} onChange={e => set({ ...d, card_title: e.target.value })} maxLength={80}
                placeholder="Card title — e.g. your show's name" aria-label="Branded card title"
                className="h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none"
                style={{ background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }} />
            </Section>
          </div>

          {/* How it looks */}
          <div className="flex gap-5 flex-wrap">
            <Mock label="On your clip">
              <ClipMock kit={kit} />
            </Mock>
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

/** The logo where Apply puts it, over a stand-in video, with a line of text in the title style */
function ClipMock({ kit }: { kit: BrandKit }) {
  const d = kit.data, box = logoBox(d.logo)
  return (
    <>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(160deg, #3a4150 0%, #1d2129 55%, #2c2a24 100%)' }} />
      <div className="absolute rounded-full" style={{ left: '28%', top: '30%', width: '44%', height: '25%', background: 'rgba(255,255,255,0.08)' }} />
      <div className="absolute inset-x-0 text-center px-3" style={{ top: '62%', fontFamily: d.title.font ?? 'sans-serif', fontWeight: 700, fontSize: d.title.size * K, color: d.title.color, lineHeight: 1.15, textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
        Your text here
      </div>
      {d.logo.path && kit.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={kit.logo_url} alt="" className="absolute" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%`, opacity: d.logo.opacity, objectFit: 'fill' }} />
      )}
    </>
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
function CornerSwitch({ value, onChange }: { value: LogoCorner; onChange: (v: LogoCorner) => void }) {
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
