'use client'

import { useEffect, useRef, useState } from 'react'
import type { CaptionStyle } from '@chai-cut/shared'
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
      <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Font</span>
      <div style={{ position: 'relative' }}>
        {/* Trigger button */}
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: `1px solid ${open ? 'rgba(0,180,216,0.5)' : 'rgba(255,255,255,0.1)'}`,
            cursor: 'pointer',
          }}
        >
          <span style={{ fontFamily: current.family, fontSize: 14, fontWeight: 700, color: '#fff' }}>
            {current.name}
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, marginLeft: 8 }}>
            <path d={open ? 'M2 8l4-4 4 4' : 'M2 4l4 4 4-4'} stroke="rgba(255,255,255,0.4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
              background: '#141420',
              border: '1px solid rgba(255,255,255,0.12)',
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
                    color: active ? '#00b4d8' : 'rgba(255,255,255,0.75)',
                    background: active ? 'rgba(0,180,216,0.1)' : 'transparent',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
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
  '#22c55e',
  '#00b4d8',
  '#ec4899',
  '#f97316',
]

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
  const sampleText = applyCase('your captions look like this', textCase)
  const currentLang = style.language ?? 'original'

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Caption preview */}
      <div
        className="rounded-xl flex items-center justify-center"
        style={{ background: '#0a0a0a', minHeight: 82, padding: '14px 16px' }}
      >
        <p
          className="text-center leading-snug"
          style={{
            color,
            fontWeight: 700,
            fontSize: 17,
            fontFamily: style.font ?? 'sans-serif',
            textShadow: '0 2px 8px rgba(0,0,0,0.9)',
            letterSpacing: 0.2,
          }}
        >
          {sampleText}
        </p>
      </div>

      {/* Font */}
      <FontPicker value={style.font ?? null} onChange={family => onChange({ font: family })} />

      {/* Color swatches */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Color</span>
        <div className="flex items-center gap-2">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              onClick={() => onChange({ color: c })}
              style={{
                width: 32, height: 32, borderRadius: '50%', background: c, flexShrink: 0,
                border: color === c ? '2px solid #00b4d8' : '2px solid rgba(255,255,255,0.1)',
                transform: color === c ? 'scale(1.15)' : 'scale(1)',
                transition: 'transform 0.12s, border-color 0.12s',
                boxShadow: color === c ? '0 0 0 3px rgba(0,180,216,0.25)' : 'none',
              }}
            />
          ))}
          {/* Custom color */}
          <label style={{ width: 32, height: 32, borderRadius: '50%', flexShrink: 0, position: 'relative', cursor: 'pointer' }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'conic-gradient(red 0deg, yellow 60deg, lime 120deg, cyan 180deg, blue 240deg, magenta 300deg, red 360deg)',
              border: !isPreset ? '2px solid #00b4d8' : '2px solid rgba(255,255,255,0.2)',
              boxShadow: !isPreset ? '0 0 0 3px rgba(0,180,216,0.25)' : 'none',
            }} />
            <input
              type="color"
              value={color}
              onChange={e => onChange({ color: e.target.value })}
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
            />
          </label>
        </div>
      </div>

      {/* Size */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Size</span>
          <span className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.5)' }}>{style.size ?? 52}px</span>
        </div>
        <input
          type="range" min={20} max={100} step={2}
          value={style.size ?? 52}
          onChange={e => onChange({ size: Number(e.target.value) })}
          className="w-full accent-cyan-400"
          style={{ height: 4, accentColor: '#00b4d8' }}
        />
      </div>

      {/* Case */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Case</span>
        <div className="flex gap-1.5">
          {([['title', 'Aa'], ['upper', 'AA'], ['lower', 'aa']] as const).map(([c, label]) => (
            <button
              key={c}
              onClick={() => onTextCaseChange(c)}
              className="flex-1 py-2 text-sm font-semibold rounded-lg transition-colors"
              style={{
                background: textCase === c ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)',
                color: textCase === c ? '#fff' : 'rgba(255,255,255,0.35)',
                border: `1px solid ${textCase === c ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.06)'}`,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Caption timing offset */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Caption Timing</span>
          <span className="text-xs font-semibold tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>
            {(style.timing_offset_ms ?? 0) === 0
              ? 'auto'
              : (style.timing_offset_ms ?? 0) > 0
                ? `+${style.timing_offset_ms}ms`
                : `${style.timing_offset_ms}ms`}
          </span>
        </div>
        <input
          type="range" min={-2000} max={2000} step={50}
          value={style.timing_offset_ms ?? 0}
          onChange={e => onChange({ timing_offset_ms: Number(e.target.value) })}
          className="w-full"
          style={{ height: 4, accentColor: '#00b4d8' }}
        />
        <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.25)', textAlign: 'center', marginTop: -2 }}>
          ← earlier &nbsp;&nbsp; later →
        </p>
      </div>

    </div>
  )
}

export { applyCase }
