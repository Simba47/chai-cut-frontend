'use client'

import { useEffect, useRef, useState } from 'react'
import type { AnimationType, CaptionStyle } from '@chai-cut/shared'
import { SARVAM_LANGUAGES, DEFAULT_CAPTION_STYLE } from '@chai-cut/shared'

export type TextCase = 'title' | 'upper' | 'lower'

export const VIDEO_FONTS = [
  { name: 'Default',           family: 'sans-serif' },
  { name: 'Roboto',            family: 'Roboto' },
  { name: 'Montserrat',        family: 'Montserrat' },
  { name: 'Poppins',           family: 'Poppins' },
  { name: 'Lato',              family: 'Lato' },
  { name: 'Inter',             family: 'Inter' },
  { name: 'Nunito',            family: 'Nunito' },
  { name: 'Rubik',             family: 'Rubik' },
  { name: 'DM Sans',           family: 'DM Sans' },
  { name: 'Ubuntu',            family: 'Ubuntu' },
  { name: 'Space Grotesk',     family: 'Space Grotesk' },
  { name: 'Outfit',            family: 'Outfit' },
  { name: 'Sora',              family: 'Sora' },
  { name: 'Raleway',           family: 'Raleway' },
  { name: 'Oswald',            family: 'Oswald' },
  { name: 'Bebas Neue',        family: 'Bebas Neue' },
  { name: 'Anton',             family: 'Anton' },
  { name: 'Barlow Condensed',  family: 'Barlow Condensed' },
  { name: 'Fjalla One',        family: 'Fjalla One' },
  { name: 'Archivo Black',     family: 'Archivo Black' },
  { name: 'Exo 2',             family: 'Exo 2' },
  { name: 'Righteous',         family: 'Righteous' },
  { name: 'Fredoka One',       family: 'Fredoka One' },
  { name: 'Playfair Display',  family: 'Playfair Display' },
  { name: 'Pacifico',          family: 'Pacifico' },
]

const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Roboto:wght@700&family=Montserrat:wght@700&family=Poppins:wght@700&family=Lato:wght@700&family=Inter:wght@700&family=Nunito:wght@700&family=Rubik:wght@700&family=DM+Sans:wght@700&family=Ubuntu:wght@700&family=Space+Grotesk:wght@700&family=Outfit:wght@700&family=Sora:wght@700&family=Raleway:wght@700&family=Oswald:wght@700&family=Bebas+Neue&family=Anton&family=Barlow+Condensed:wght@700&family=Fjalla+One&family=Archivo+Black&family=Exo+2:wght@700&family=Righteous&family=Fredoka+One&family=Playfair+Display:wght@700&family=Pacifico&display=swap'

export function loadVideoFonts() {
  if (typeof document === 'undefined') return
  if (document.getElementById('chai-cut-video-fonts')) return
  const link = document.createElement('link')
  link.id = 'chai-cut-video-fonts'
  link.rel = 'stylesheet'
  link.href = GOOGLE_FONTS_URL
  document.head.appendChild(link)
}

interface FontPickerProps {
  value: string | null
  onChange: (family: string) => void
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = VIDEO_FONTS.find(f => f.family === (value ?? 'sans-serif')) ?? VIDEO_FONTS[0]

  useEffect(() => { loadVideoFonts() }, [])

  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div className="flex flex-col gap-2" ref={ref}>
      <span className="text-xs font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Font</span>
      <div style={{ position: 'relative' }}>
        {/* Trigger button */}
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg"
          style={{
            background: 'rgb(var(--ed-fg) / 0.06)',
            border: `1px solid ${open ? 'rgba(200,255,0,0.5)' : 'rgb(var(--ed-fg) / 0.1)'}`,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontFamily: current.family, fontSize: 14, fontWeight: 700, color: 'var(--ed-text)' }}>
            {current.name}
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, marginLeft: 8 }}>
            <path d={open ? 'M2 8l4-4 4 4' : 'M2 4l4 4 4-4'} stroke="rgb(var(--ed-fg) / 0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Dropdown list */}
        {open && (
          <div
            className="absolute w-full overflow-y-auto z-50"
            style={{
              top: 'calc(100% + 4px)',
              left: 0,
              maxHeight: 260,
              background: 'var(--ed-popover)',
              border: '1px solid rgb(var(--ed-fg) / 0.12)',
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
              scrollbarWidth: 'thin',
            }}
          >
            {VIDEO_FONTS.map(f => {
              const active = current.family === f.family
              return (
                <button
                  key={f.family}
                  onClick={() => { onChange(f.family); setOpen(false) }}
                  className="w-full text-left px-4 py-2.5"
                  style={{
                    fontFamily: f.family,
                    fontSize: 14,
                    fontWeight: 700,
                    color: active ? 'var(--ed-accent-text)' : 'rgb(var(--ed-fg) / 0.75)',
                    background: active ? 'rgba(200,255,0,0.1)' : 'transparent',
                    borderBottom: '1px solid rgb(var(--ed-fg) / 0.04)',
                    cursor: 'pointer',
                    display: 'block',
                  }}
                >
                  {f.name}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface Props {
  style: Partial<CaptionStyle>
  textCase: TextCase
  onChange: (updates: Partial<CaptionStyle>) => void
  onTextCaseChange: (c: TextCase) => void
  onEditCaptions: () => void
  onRetranscribe: (languageCode: string) => void
  retranscribing: boolean
  retranscribeElapsed?: number
  retranscribeError?: string | null
  hasWords?: boolean
  hasRoman?: boolean
  romanize?: boolean
  romanizeLabel?: string
  onRomanizeChange?: (v: boolean) => void
}

const PRESET_COLORS = [
  '#FFE700',
  '#FFFFFF',
  '#22d3ee',
  '#c8ff00',
  '#ec4899',
  '#f97316',
]

// Caption styles. Each button shows a tiny looping demo of its animation (CSS, see PRESET_CSS);
// the real thing is drawn by VideoPreview drawPresetCaptions and render.py _preset_events.
const PRESETS: Array<{ id: AnimationType; label: string }> = [
  { id: 'karaoke', label: 'Karaoke' },
  { id: 'hormozi', label: 'Hormozi' },
  { id: 'box', label: 'Box' },
  { id: 'glow', label: 'Glow' },
  { id: 'pop', label: 'Pop' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'bounce', label: 'Bounce' },
  { id: 'word', label: 'One word' },
  { id: 'fade', label: 'Fade' },
  { id: 'none', label: 'None' },
]
const ANIMATED = ['karaoke', 'hormozi', 'box', 'glow', 'pop', 'highlight', 'bounce', 'word']
const HIGHLIGHT_COLORS = ['#FFE700', '#c8ff00', '#22d3ee', '#ec4899', '#f97316', '#8b5cf6']

const PRESET_CSS = `
@keyframes cc-pop { 0%,12% { transform: scale(.8); opacity: 0 } 16% { transform: scale(1.1); opacity: 1 } 22%,100% { transform: scale(1); opacity: 1 } }
@keyframes cc-kar { 0%,33% { color: var(--cc-hl) } 34%,100% { color: inherit } }
@keyframes cc-hz { 0%,33% { color: var(--cc-hl); transform: scale(1.15) } 34%,100% { color: inherit; transform: none } }
@keyframes cc-glow { 0%,33% { opacity: 1 } 34%,100% { opacity: .6 } }
@keyframes cc-hl { 0%,33% { background: var(--cc-hl); color: #000 } 34%,100% { background: transparent; color: inherit } }
@keyframes cc-bounce { 0% { transform: translateY(5px); opacity: 0 } 15%,100% { transform: none; opacity: 1 } }
@keyframes cc-word1 { 0%,32% { opacity: 1 } 33%,100% { opacity: 0 } }
@keyframes cc-fade { 0% { opacity: 0 } 25%,100% { opacity: 1 } }
.cc-demo span { display: inline-block; border-radius: 3px; padding: 0 2px }
`

function PresetDemo({ id, hl }: { id: AnimationType; hl: string }) {
  const words = ['Hey', 'there', 'friend']
  const d = '2.4s'
  if (id === 'word') {
    return (
      <span className="cc-demo relative inline-block" style={{ width: 44, height: 14 }}>
        {words.map((w, i) => (
          <span key={w} className="absolute inset-0 text-center" style={{ animation: `cc-word1 ${d} ${i * 0.8}s infinite both`, opacity: 0 }}>{w}</span>
        ))}
      </span>
    )
  }
  return (
    <span className="cc-demo whitespace-nowrap" style={{
      ['--cc-hl' as string]: hl, display: 'inline-block',
      animation: id === 'bounce' ? `cc-bounce ${d} infinite` : id === 'fade' ? `cc-fade ${d} infinite` : undefined,
      ...(id === 'box' ? { background: 'rgba(0,0,0,0.62)', color: '#fff', padding: '0 3px' } : {}),
      ...(id === 'hormozi' ? { textTransform: 'uppercase', fontSize: 10, WebkitTextStroke: '0.4px #000' } : {}),
    }}>
      {(id === 'hormozi' ? words.slice(0, 2) : words).map((w, i) => {
        const step = `${d} ${i * 0.8}s infinite both`
        return (
          <span key={w} style={{
            animation: id === 'pop' ? `cc-pop ${step}`
              : id === 'highlight' ? `cc-hl ${step}`
              : id === 'karaoke' || id === 'box' || id === 'bounce' ? `cc-kar ${step}`
              : id === 'hormozi' ? `cc-hz ${step}`
              : id === 'glow' ? `cc-glow ${step}` : undefined,
            textShadow: id === 'glow' ? `0 0 4px ${hl}, 0 0 8px ${hl}` : undefined,
          }}>{w}</span>
        )
      })}
    </span>
  )
}

function applyCase(text: string, tc: TextCase): string {
  if (tc === 'upper') return text.toUpperCase()
  if (tc === 'lower') return text.toLowerCase()
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase()
}

export function CaptionStyler({
  style, textCase,
  onChange, onTextCaseChange, onEditCaptions, onRetranscribe, retranscribing, retranscribeElapsed = 0,
  retranscribeError = null,
  hasWords = false, hasRoman = false, romanize = false, romanizeLabel = 'Romanize', onRomanizeChange,
}: Props) {
  const color = style.color ?? DEFAULT_CAPTION_STYLE.color
  const isPreset = PRESET_COLORS.includes(color)
  const animation = style.animation ?? DEFAULT_CAPTION_STYLE.animation
  const hl = style.highlight_color ?? '#FFE700'

  return (
    <div className="flex flex-col gap-5 px-4 pb-5 pt-1">
      {/* Making captions failed (e.g. Google's service down): say why, and offer to try again */}
      {retranscribeError && !retranscribing && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl px-3 py-2.5 text-[12px] leading-snug"
          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#fca5a5' }}>
          <span>{retranscribeError}</span>
          <button type="button" onClick={() => onRetranscribe('unknown')}
            className="self-start rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors hover:bg-[rgba(239,68,68,0.2)]"
            style={{ border: '1px solid rgba(239,68,68,0.45)', color: '#fecaca' }}>
            Try again
          </button>
        </div>
      )}
      <style>{PRESET_CSS}</style>
      {/* ── Style: each tile is a little dark "screen" playing the animation, its name below ── */}
      <section className="flex flex-col gap-2.5">
        <h3 className="cap-heading">Style</h3>
        <div className="grid grid-cols-2 gap-2">
          {PRESETS.map(p => {
            const on = animation === p.id
            return (
              <button key={p.id} onClick={() => onChange({ animation: p.id })} aria-pressed={on}
                className="cap-tile" data-on={on || undefined}>
                <span className="cap-tile-screen">
                  <span className="text-[11px] font-bold flex items-center" style={{ color: '#fff' }}>
                    <PresetDemo id={p.id} hl={hl} />
                  </span>
                </span>
                <span className="cap-tile-name">{p.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* ── Look: colours, font, size and capitals ── */}
      <section className="flex flex-col gap-4">
        <h3 className="cap-heading">Look</h3>

      {/* Highlight colour (animated presets) */}
      {ANIMATED.includes(animation) && (
        <div className="flex flex-col gap-2">
          <span className="cap-label">{animation === 'highlight' ? 'Box colour' : 'Highlight colour'}</span>
          <div className="flex flex-wrap items-center gap-2">
            {HIGHLIGHT_COLORS.map(c => (
              <button key={c} onClick={() => onChange({ highlight_color: c })}
                aria-label={`Highlight colour ${c}`} aria-pressed={hl === c}
                className="cap-swatch" data-on={hl === c || undefined} style={{ background: c }} />
            ))}
          </div>
        </div>
      )}

      {/* Font */}
      <FontPicker value={style.font ?? null} onChange={family => onChange({ font: family })} />

      {/* Color swatches */}
      <div className="flex flex-col gap-2">
        <span className="cap-label">Text colour</span>
        <div className="flex flex-wrap items-center gap-2">
          {PRESET_COLORS.map(c => (
            <button key={c} onClick={() => onChange({ color: c })}
              aria-label={`Caption colour ${c}`} aria-pressed={color === c}
              className="cap-swatch" data-on={color === c || undefined} style={{ background: c }} />
          ))}
          {/* Custom colour */}
          <label title="Pick any colour" className="cap-swatch" data-on={!isPreset || undefined}
            style={{ position: 'relative', cursor: 'pointer', background: 'conic-gradient(red 0deg, yellow 60deg, lime 120deg, cyan 180deg, blue 240deg, magenta 300deg, red 360deg)' }}>
            <input
              type="color"
              value={color}
              onChange={e => onChange({ color: e.target.value })}
              aria-label="Pick any caption colour"
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
            />
          </label>
        </div>
      </div>

      {/* Size */}
      <div className="flex flex-col gap-2.5">
        <div className="flex items-center justify-between">
          <span className="cap-label">Size</span>
          <span className="cap-value">{style.size ?? 52}</span>
        </div>
        <input type="range" min={20} max={100} step={2} value={style.size ?? 52}
          onChange={e => onChange({ size: Number(e.target.value) })}
          aria-label="Caption size"
          className="ed-zoom-range w-full" style={{ '--p': `${(((style.size ?? 52) - 20) / 80) * 100}%` } as React.CSSProperties} />
      </div>

      {/* Case */}
      <div className="cap-row">
        <span className="cap-label">Capitals</span>
        <div role="radiogroup" aria-label="Capitals" className="cap-seg">
          {([['title', 'Aa', 'First letter capital'], ['upper', 'AA', 'ALL CAPITALS'], ['lower', 'aa', 'all small letters']] as const).map(([c, label, title]) => (
            <button key={c} role="radio" aria-checked={textCase === c} title={title}
              // Capitals are saved with the style, so the export shows them too
              onClick={() => { onTextCaseChange(c); onChange({ uppercase: c === 'upper' }) }}
              className="cap-seg-btn cap-seg-case" data-on={textCase === c || undefined}>
              {label}
            </button>
          ))}
        </div>
      </div>
      </section>

    </div>
  )
}

export { applyCase }
