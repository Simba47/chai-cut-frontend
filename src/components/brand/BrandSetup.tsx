'use client'

import { useEffect, useRef, useState } from 'react'
import { CaptionStyler, loadVideoFonts, type TextCase } from '@/components/editor/CaptionStyler'
import { ClipMock, Mock, KitBadge, Switch, captionPatch, saveLabel, type BrandKits } from '@/components/editor/BrandKit'
import { brandCaptionStyle, DEFAULT_BRAND_KIT, type BrandKitData, type BrandCaptions } from '@/lib/shared/brandKit'
import { BrandStart, BrandCard, type Found } from './BrandMaker'

/**
 * Setting up a brand in about a minute (the Brands page; brand kit rebuild, Phase 1): four steps with
 * the clip preview always in view — 1. where your brand is (a link, your logo, or a few words:
 * BrandMaker.tsx BrandStart), 2. here's your brand (everything found, changed in place: BrandCard),
 * 3. your caption look, 4. all set (used for every new clip). Everything else — text style, the
 * Branded card, the team — is under "More options" (the full kit editor, BrandKitStudio). Saved as
 * it's changed.
 */

type StepId = 'start' | 'brand' | 'captions' | 'done'
const STEPS: Array<{ id: StepId; name: string }> = [
  { id: 'start', name: 'Start' },
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
  // A kit with nothing of its own yet starts at "Where's your brand?"; one being changed, at its card
  const fresh = !!kit && !kit.data.logo.path && !kit.data.handle && kit.data.colors.main === DEFAULT_BRAND_KIT.colors.main
  const [step, setStep] = useState<StepId>(fresh ? 'start' : 'brand')
  const [found, setFound] = useState<Found | null>(null)
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

  const at = STEPS.findIndex(x => x.id === step)
  const saved = saveLabel(brand)
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
            {step === 'start' && (
              <>
                <header className="flex flex-col gap-1">
                  <span className="bs-kicker">Step 1 of 4</span>
                  <h2 className="bs-title">Where&rsquo;s your brand?</h2>
                  <p className="bs-sub">Pick one and we make your kit from it: logo, colours and font. You can change everything next.</p>
                </header>
                <BrandStart kit={kit} brand={brand} now={now} set={set} onFound={f => { setFound(f); setStep('brand') }} />
                <div className="bs-or" aria-hidden="true"><span>or</span></div>
                <button type="button" className="bs-link self-center text-[12.5px]" onClick={() => setStep('brand')}>Set it up yourself</button>
              </>
            )}
            {step === 'brand' && (
              <>
                <header className="flex flex-col gap-1">
                  <span className="bs-kicker">Step 2 of 4</span>
                  <h2 className="bs-title">Here&rsquo;s your brand</h2>
                  <p className="bs-sub">Tap anything to change it. Drag the logo on the preview to place it.</p>
                </header>
                <BrandCard kit={kit} brand={brand} now={now} set={set} found={found} readOnly={!!kit.shared_by} />
                {!kit.shared_by && (
                  <button type="button" className="bs-link self-start text-[12px]" onClick={() => setStep('start')}>Start again from a link, your logo or a few words</button>
                )}
              </>
            )}
            {step === 'captions' && (
              <>
                <header className="flex flex-col gap-1">
                  <span className="bs-kicker">Step 3 of 4</span>
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
                  <span className="bs-kicker">Step 4 of 4</span>
                  <h2 className="bs-title">You&rsquo;re all set</h2>
                  <p className="bs-sub">Here&rsquo;s your brand. It&rsquo;s saved — change anything any time from your Brand kits.</p>
                </header>
                <ul className="bs-check" aria-label="What your brand kit has">
                  <Check ok={!!d.logo.path} label="Logo" missing="No logo yet" onFix={() => setStep('brand')} />
                  <Check ok label={`Colours`} extra={<span className="flex gap-1">{[...new Set([d.colors.main, d.colors.accent, ...d.colors.extra])].map(c => <i key={c} className="bs-swatch" style={{ background: c }} />)}</span>} />
                  <Check ok={!!d.title.font} label={`Font: ${d.title.font ?? ''}`} missing="No title font yet" onFix={() => setStep('brand')} />
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
