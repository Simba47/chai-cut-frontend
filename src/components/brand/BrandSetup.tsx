'use client'

import { useEffect, useRef, useState } from 'react'
import { CaptionStyler, loadVideoFonts, type TextCase } from '@/components/editor/CaptionStyler'
import {
  ClipMock, Mock, KitBadge, Switch, ColorRow, Section, captionPatch, urlRatio, saveLabel, type BrandKits,
} from '@/components/editor/BrandKit'
import { brandCaptionStyle, type BrandKitData, type BrandCaptions } from '@/lib/shared/brandKit'

/**
 * Setting up a brand in about a minute (the Brands page): three steps with the clip preview always in
 * view — 1. your brand (filled from a website or profile link, or by hand), 2. your caption look,
 * 3. all set (used for every new clip). Everything else — fonts, text style, the Branded card, the
 * team — is under "More options" (the full kit editor, BrandKitStudio). Saved as it's changed.
 */

type StepId = 'brand' | 'captions' | 'done'
const STEPS: Array<{ id: StepId; name: string }> = [
  { id: 'brand', name: 'Your brand' },
  { id: 'captions', name: 'Captions' },
  { id: 'done', name: 'All set' },
]

export function BrandSetup({ brand, onDone, onMore }: {
  brand: BrandKits
  /** Finished (or closed): back to the list */
  onDone: () => void
  /** "More options": the full kit editor */
  onMore: () => void
}) {
  const kit = brand.current
  const [step, setStep] = useState<StepId>('brand')
  const [url, setUrl] = useState('')
  const [reading, setReading] = useState(false)
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null)
  const [uploading, setUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  // A new step starts at its top (not where the last one was scrolled to)
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }) }, [step])
  const latest = useRef<{ id: string; data: BrandKitData; pending: boolean } | null>(null)
  useEffect(() => { loadVideoFonts() }, [])

  if (!kit) return <p className="p-8 text-sm" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>{brand.loading ? 'Loading…' : 'This brand kit isn’t there any more.'}</p>
  const d = kit.data
  // (each change builds on the one before it, even two before the screen updates: as BrandKitStudio)
  latest.current = latest.current && latest.current.id === kit.id && latest.current.pending ? latest.current : { id: kit.id, data: d, pending: false }
  const now = () => (latest.current?.id === kit.id ? latest.current.data : d)
  const set = (data: BrandKitData, extra: { name?: string; logo_url?: string | null } = {}) => {
    latest.current = { id: kit.id, data, pending: true }
    queueMicrotask(() => { if (latest.current) latest.current.pending = false })
    brand.update(kit.id, { data, ...extra })
  }
  const setCaptions = (c: Partial<BrandCaptions>) => { const cur = now(); set({ ...cur, captions: { ...cur.captions, ...c } }) }

  async function fill() {
    if (!url.trim() || reading || !kit) return
    setReading(true); setNote(null)
    try {
      const b = await brand.fromLink(url.trim())
      const cur = now()
      const ratio = b.logo ? b.logo.ratio ?? (b.logo.url ? await urlRatio(b.logo.url) : null) ?? 1 : null
      const data: BrandKitData = {
        ...cur,
        handle: cur.handle || b.handle || '',
        card_title: cur.card_title || b.name || '',
        colors: b.colors ? { ...cur.colors, main: b.colors.main, accent: b.colors.accent ?? cur.colors.accent } : cur.colors,
        logo: b.logo ? { ...cur.logo, path: b.logo.path, ratio } : cur.logo,
      }
      const rename = b.name && /^Brand kit( \d+)?$/.test(kit.name.trim()) ? { name: b.name } : {}
      set(data, { ...rename, ...(b.logo ? { logo_url: b.logo.url } : {}) })
      const got = [b.logo && 'logo', b.colors && 'colours', b.name && 'name', b.handle && '@handle'].filter(Boolean)
      setNote(got.length ? { text: `Found your ${got.join(', ')} — check them below`, bad: false }
        : { text: `Nothing to use was found on ${b.source} — add your logo and colours below`, bad: true })
    } catch (e) {
      setNote({ text: e instanceof Error ? e.message : String(e), bad: true })
    } finally { setReading(false) }
  }

  async function pickLogo(file: File | undefined) {
    if (!file || !kit) return
    setUploading(true); setLogoError(null)
    try {
      const up = await brand.uploadLogo(file)
      const cur = now()
      set({ ...cur, logo: { ...cur.logo, path: up.path, ratio: up.ratio } }, { logo_url: up.url })
    } catch (e) {
      setLogoError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const at = STEPS.findIndex(x => x.id === step)
  const saved = saveLabel(brand)
  const field = { background: 'rgb(var(--ed-fg) / 0.06)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }
  const ghost = { color: 'var(--ed-text)', background: 'rgb(var(--ed-fg) / 0.08)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }
  return (
    <div className="bs h-full flex flex-col min-h-0">
      {/* The steps, whether it's saved, close */}
      <div className="shrink-0 flex items-center gap-3 px-5" style={{ minHeight: 60, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
        <KitBadge kit={kit} />
        <span className="text-base font-bold text-[var(--ed-text)] truncate max-md:hidden">{kit.name}</span>
        <ol className="bs-steps flex-1 flex items-center justify-center gap-2" aria-label="Setup steps">
          {STEPS.map((x, i) => (
            <li key={x.id} className="flex items-center gap-2">
              {i > 0 && <span className="bs-step-line" data-on={i <= at || undefined} aria-hidden="true" />}
              <button type="button" onClick={() => setStep(x.id)} className="bs-step" data-on={i === at || undefined} data-done={i < at || undefined} aria-current={i === at ? 'step' : undefined}>
                <span className="bs-step-n">{i < at ? '✓' : i + 1}</span>{x.name}
              </button>
            </li>
          ))}
        </ol>
        <span role="status" className="text-[11px] shrink-0" style={{ color: brand.saveState === 'error' ? '#fca5a5' : 'rgb(var(--ed-fg) / 0.45)' }}>{saved}</span>
        <button type="button" onClick={onDone} aria-label="Close the setup" title="Close (it's saved)"
          className="w-8 h-8 flex items-center justify-center rounded-lg shrink-0 transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div ref={bodyRef} className="flex-1 min-w-0 overflow-y-auto">
          <div className="max-w-[560px] mx-auto px-6 py-6 flex flex-col gap-5">
            {step === 'brand' && (
              <>
                <header className="flex flex-col gap-1">
                  <span className="bs-kicker">Step 1 of 3</span>
                  <h2 className="bs-title">Your brand</h2>
                  <p className="bs-sub">Paste your website or a profile link (Instagram, YouTube…): we fill in your logo, colours, name and @handle.</p>
                </header>
                <div className="flex flex-col gap-2">
                  <div className="flex gap-2">
                    <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') fill() }} maxLength={500} autoFocus
                      placeholder="yourbrand.com or instagram.com/yourbrand" aria-label="Website or profile link"
                      className="flex-1 min-w-0 h-11 px-3.5 rounded-xl text-sm text-[var(--ed-text)] outline-none" style={field} />
                    <button type="button" onClick={fill} disabled={reading || !url.trim()} className="bs-primary h-11 px-4 disabled:opacity-50">
                      {reading ? 'Reading…' : 'Fill in my brand'}
                    </button>
                  </div>
                  {note && <p role={note.bad ? 'alert' : 'status'} className="text-[12px]" style={{ color: note.bad ? '#fca5a5' : 'var(--ed-accent-text)' }}>{note.text}</p>}
                </div>
                <div className="bs-or" aria-hidden="true"><span>or set it yourself</span></div>
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
                      <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="h-8 px-3 rounded-lg text-xs font-semibold disabled:opacity-50" style={ghost}>
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
                  {d.logo.path && <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Drag it on the preview to place it anywhere.</p>}
                </Section>
                <Section title="Name and @handle">
                  <input value={kit.name} onChange={e => brand.update(kit.id, { name: e.target.value })} maxLength={40} aria-label="Brand name"
                    onBlur={e => { if (!e.target.value.trim()) brand.update(kit.id, { name: 'Brand kit' }) }}
                    placeholder="Your brand's name" className="h-9 px-3 rounded-lg text-sm text-[var(--ed-text)] outline-none" style={field} />
                  <label className="flex items-center gap-1 h-9 px-3 rounded-lg" style={field}>
                    <span className="text-sm font-semibold" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>@</span>
                    <input value={d.handle} onChange={e => set({ ...now(), handle: e.target.value.replace(/^@+/, '').replace(/\s+/g, '') })} maxLength={40}
                      placeholder="yourchannel" aria-label="Your @handle" className="flex-1 min-w-0 bg-transparent text-sm text-[var(--ed-text)] outline-none" />
                  </label>
                </Section>
                <Section title="Colours">
                  <ColorRow label="Main colour" hint="Frame backgrounds and your Branded card" value={d.colors.main} onChange={main => set({ ...now(), colors: { ...now().colors, main } })} />
                  <ColorRow label="Accent colour" hint="Shown first in the editor's colour choices" value={d.colors.accent} onChange={accent => set({ ...now(), colors: { ...now().colors, accent } })} />
                </Section>
              </>
            )}
            {step === 'captions' && (
              <>
                <header className="flex flex-col gap-1">
                  <span className="bs-kicker">Step 2 of 3</span>
                  <h2 className="bs-title">Your caption look</h2>
                  <p className="bs-sub">Pick how captions look on your clips. You can still change any clip&rsquo;s captions in the editor.</p>
                </header>
                <label className="cap-row cursor-pointer select-none">
                  <span className="flex flex-col min-w-0">
                    <span className="cap-label">Brand captions</span>
                    <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                      {d.captions.on ? 'Your clips get this caption look' : 'Off: clips keep the caption look they have'}
                    </span>
                  </span>
                  <Switch on={d.captions.on} label="Brand captions" onChange={on => setCaptions({ on })} />
                </label>
                <div className="-mx-2" style={d.captions.on ? undefined : { opacity: 0.5 }}>
                  {/* (picking a look switches brand captions on) */}
                  <CaptionStyler
                    style={brandCaptionStyle(d.captions)} textCase={d.captions.uppercase ? 'upper' : 'title'}
                    onChange={u => setCaptions({ ...captionPatch(u), on: true })}
                    onTextCaseChange={(c: TextCase) => setCaptions({ uppercase: c === 'upper', on: true })}
                    onEditCaptions={() => {}} onRetranscribe={() => {}} retranscribing={false} hasWords={false} />
                </div>
              </>
            )}
            {step === 'done' && (
              <>
                <header className="flex flex-col gap-1">
                  <span className="bs-kicker">Step 3 of 3</span>
                  <h2 className="bs-title">You&rsquo;re all set</h2>
                  <p className="bs-sub">Here&rsquo;s your brand. It&rsquo;s saved — change anything any time from your Brand kits.</p>
                </header>
                <ul className="bs-check" aria-label="What your brand kit has">
                  <Check ok={!!d.logo.path} label="Logo" missing="No logo yet" onFix={() => setStep('brand')} />
                  <Check ok label={`Colours`} extra={<span className="flex gap-1">{[d.colors.main, d.colors.accent].map(c => <i key={c} className="bs-swatch" style={{ background: c }} />)}</span>} />
                  <Check ok={!!d.handle} label={d.handle ? `@${d.handle}` : '@handle'} missing="No @handle yet" onFix={() => setStep('brand')} />
                  <Check ok={d.captions.on} label="Caption look" missing="Brand captions are off" onFix={() => setStep('captions')} />
                </ul>
                {!kit.shared_by && (
                  <label className="bs-default cursor-pointer select-none">
                    <span className="flex flex-col min-w-0 flex-1">
                      <span className="text-[13px] font-semibold text-[var(--ed-text)]">Use for every new clip</span>
                      <span className="text-[11.5px]" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                        {d.is_default ? 'New clips — and Make my clips — get this brand by themselves' : 'Off: you switch it on clip by clip in the editor'}
                      </span>
                    </span>
                    <Switch on={d.is_default} label="Use for every new clip" onChange={on => set({ ...now(), is_default: on })} />
                  </label>
                )}
                <p className="text-[12px]" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                  Want your own fonts, a title style or a Branded card? They&rsquo;re in <button type="button" className="bs-link" onClick={onMore}>More options</button>.
                </p>
              </>
            )}
            {/* Back / Next */}
            <div className="flex items-center justify-between pt-1 pb-8">
              {at > 0
                ? <button type="button" onClick={() => setStep(STEPS[at - 1].id)} className="h-10 px-4 rounded-xl text-xs font-semibold" style={ghost}>← Back</button>
                : <button type="button" onClick={onMore} className="h-10 px-4 rounded-xl text-xs font-semibold" style={ghost}>More options</button>}
              {at < STEPS.length - 1
                ? <button type="button" onClick={() => setStep(STEPS[at + 1].id)} className="bs-primary h-10 px-5">Next: {STEPS[at + 1].name} →</button>
                : <button type="button" onClick={onDone} className="bs-primary h-10 px-5">Finish</button>}
            </div>
          </div>
        </div>

        {/* How it looks: always in view */}
        <aside aria-label="How it looks" className="bs-preview shrink-0 w-[260px] p-5 overflow-y-auto flex flex-col items-center gap-2" style={{ borderLeft: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
          <Mock label="On your clip">
            <ClipMock kit={kit} onPlace={kit.shared_by ? undefined : (x, y) => set({ ...now(), logo: { ...now().logo, x, y } })} />
          </Mock>
          <p className="text-[10.5px] text-center max-w-[200px] mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>Changes save by themselves.</p>
        </aside>
      </div>
    </div>
  )
}

/** A line of the "All set" summary: there (a tick), or missing (with a way to add it) */
function Check({ ok, label, missing, onFix, extra }: { ok: boolean; label: string; missing?: string; onFix?: () => void; extra?: React.ReactNode }) {
  return (
    <li className="bs-check-row" data-ok={ok || undefined}>
      <span className="bs-check-ico" aria-hidden="true">{ok ? '✓' : '!'}</span>
      <span className="flex-1 min-w-0 truncate">{ok ? label : missing}</span>
      {ok ? extra : onFix && <button type="button" className="bs-link" onClick={onFix}>Add</button>}
    </li>
  )
}
