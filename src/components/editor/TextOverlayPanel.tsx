'use client'

import { InfoTip } from '@/components/ui/info-tip'
import { useEffect, useRef, useState } from 'react'
import type { TextOverlay } from '@chai-cut/shared'
import { FontPicker, loadVideoFonts } from './CaptionStyler'
import { EmptyState } from './EditorTour'
import { TimeRange } from './ItemTimeRange'
import { EmojiButton, EmojiGrid, insertAtCursor } from './EmojiPicker'
import { TEXT_ANIMATION_GROUPS, TEXT_PRESETS, replayTextAnimation, textCss, type TextStyle } from '@/modules/editor/textStyle'

interface Props {
  overlays: TextOverlay[]
  currentTimeMs: number
  clipDurationMs: number
  onAdd: (overlay: Omit<TextOverlay, 'id' | 'clip_id'>) => void
  onUpdate: (id: string, updates: Partial<TextOverlay>) => void
  onRemove: (id: string) => void
  /** A text just added elsewhere (the timeline's "+"): it opens and its box takes focus with the words selected */
  focusId?: string | null
  onFocused?: () => void
  /** The text picked on the timeline or the preview: it opens here */
  selectedId?: string | null
  onSelect?: (id: string) => void
}

const COLORS = ['#ffffff', '#000000', '#FFE600', '#c8ff00', '#22d3ee', '#f472b6', '#ff7a45', '#ef4444']
const WEIGHTS: { v: number; label: string }[] = [{ v: 400, label: 'Regular' }, { v: 700, label: 'Bold' }, { v: 900, label: 'Black' }]
const SHADOWS: { v: NonNullable<TextOverlay['shadow']>; label: string }[] = [
  { v: 'none', label: 'None' }, { v: 'soft', label: 'Soft' }, { v: 'hard', label: 'Hard' }, { v: 'glow', label: 'Glow' },
]

/**
 * Text tool: add text, then style it — trending presets in one click, or font, weight, italic,
 * capitals, size, spacing, colour, outline, background box, shadow / glow, opacity, rotation and an
 * entrance animation. One text is open for styling at a time. (styles: .cap-* / .tx-* in globals.css)
 */
export function TextOverlayPanel({ overlays, currentTimeMs, clipDurationMs, onAdd, onUpdate, onRemove, focusId, onFocused, selectedId = null, onSelect }: Props) {
  const [newText, setNewText] = useState('')
  const [openId, setOpenId] = useState<string | null>(selectedId)
  const listRef = useRef<HTMLDivElement>(null)
  // Picked on the timeline or the preview: open it and bring it into view
  useEffect(() => {
    if (!selectedId) return
    setOpenId(selectedId)
    listRef.current?.querySelector(`[data-text-card="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selectedId])
  // Added from the timeline's "+": open it, then put the cursor in its box with the words selected
  useEffect(() => {
    if (!focusId) return
    setOpenId(focusId)
    const el = listRef.current?.querySelector<HTMLInputElement>(`[data-text-id="${focusId}"]`)
    if (!el) return
    el.focus(); el.select(); el.scrollIntoView({ block: 'nearest' })
    onFocused?.()
  }, [focusId, overlays, openId, onFocused])

  useEffect(() => { loadVideoFonts() }, [])
  // A newly added text opens for styling straight away
  const [lastCount, setLastCount] = useState(overlays.length)
  useEffect(() => {
    if (overlays.length > lastCount) setOpenId(overlays[overlays.length - 1].id)
    setLastCount(overlays.length)
  }, [overlays, lastCount])

  const newRef = useRef<HTMLInputElement>(null)
  // The Emoji section: an emoji on its own, as a sticker on the video (big, at the playhead, 3 s)
  function addEmoji(e: string) {
    onAdd({
      text: e,
      start_ms: Math.round(currentTimeMs),
      end_ms: Math.round(Math.min(currentTimeMs + 3000, clipDurationMs)),
      x: 0.4, y: 0.4, font: 'sans-serif', size: 160, color: '#ffffff',
    })
  }

  function handleAdd() {
    if (!newText.trim()) return
    onAdd({
      text: newText.trim(),
      start_ms: Math.round(currentTimeMs),
      end_ms: Math.round(Math.min(currentTimeMs + 3000, clipDurationMs)),
      x: 0.1, y: 0.4, font: 'sans-serif', size: 72, color: '#ffffff',
      ...TEXT_PRESETS[0].style,
    })
    setNewText('')
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Add */}
      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <input ref={newRef} type="text" value={newText} onChange={e => setNewText(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            placeholder="Type your text…" aria-label="New text"
            className="tx-input flex-1" />
          <EmojiButton label="Add an emoji to the text" onPick={e => setNewText(insertAtCursor(newRef.current, newText, e))} />
          <button onClick={handleAdd} disabled={!newText.trim()} className="tx-add">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            Add
          </button>
        </div>
        <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
          How it works
          <InfoTip label="How text works" size={12}>It appears at the playhead for 3 seconds. Drag it on the video to move it; drag its bar on the timeline to change when it shows.</InfoTip>
        </p>
      </div>

      {/* Emoji on their own, as stickers on the video — drawn as they'll be in the download */}
      <Fold title="Emoji">
        <EmojiGrid height={200} onPick={addEmoji} />
      </Fold>

      {overlays.length === 0 ? (
        <EmptyState icon={<path d="M4 7V5h16v2M9 19h6M12 5v14" />} title="No text yet"
          tip="Type above and press Add. Then pick a trending style or make your own." />
      ) : (
        <div ref={listRef} className="flex flex-col gap-2">
          {overlays.map(o => (
            <TextItem key={o.id} o={o} open={openId === o.id} currentTimeMs={currentTimeMs} clipDurationMs={clipDurationMs}
              onToggle={() => { if (openId !== o.id) onSelect?.(o.id); setOpenId(id => (id === o.id ? null : o.id)) }}
              onUpdate={u => onUpdate(o.id, u)} onRemove={() => onRemove(o.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function TextItem({ o, open, currentTimeMs, clipDurationMs, onToggle, onUpdate, onRemove }: {
  o: TextOverlay; open: boolean
  currentTimeMs: number; clipDurationMs: number
  onToggle: () => void
  onUpdate: (u: Partial<TextOverlay>) => void
  onRemove: () => void
}) {
  const textRef = useRef<HTMLInputElement>(null)
  // Picking a style or an animation replays the entrance in the preview straight away
  const applyPreset = (style: TextStyle) => {
    onUpdate({ ...style, ...(style.font ? {} : o.font === 'monospace' ? { font: 'sans-serif' } : {}) })
    replayTextAnimation(o.id)
  }
  const activePreset = TEXT_PRESETS.find(p => (Object.keys(p.style) as (keyof TextStyle)[])
    .every(k => (o[k] ?? null) === (p.style[k] ?? null)))?.id

  return (
    <div className="tx-item" data-open={open || undefined} data-text-card={o.id}>
      {/* Header: the text in its own style, then open / delete */}
      <div className="flex items-center gap-2">
        <button onClick={onToggle} aria-expanded={open} className="tx-head">
          <span className="tx-head-preview" style={{ ...textCss(o), fontSize: 15, opacity: 1 }}>{o.text || 'Text'}</span>
          <svg className="tx-chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        <button onClick={onRemove} aria-label="Delete this text" title="Delete this text" className="tx-del">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-5 pt-3">
          <div className="flex gap-2">
            <input ref={textRef} className="tx-input flex-1" value={o.text} onChange={e => onUpdate({ text: e.target.value })} aria-label="Text" data-text-id={o.id} />
            <EmojiButton label="Add an emoji to the text" onPick={e => onUpdate({ text: insertAtCursor(textRef.current, o.text, e) })} />
          </div>
          {/* When it shows */}
          <TimeRange startMs={o.start_ms} endMs={o.end_ms} currentTimeMs={currentTimeMs}
            onStart={ms => onUpdate({ start_ms: Math.round(Math.max(0, Math.min(o.end_ms - 200, ms))) })}
            onEnd={ms => onUpdate({ end_ms: Math.round(Math.min(clipDurationMs, Math.max(o.start_ms + 200, ms))) })} />

          {/* Trending styles */}
          <Fold title="Trending styles" defaultOpen>
            <div className="grid grid-cols-2 gap-2">
              {TEXT_PRESETS.map(p => (
                <button key={p.id} onClick={() => applyPreset(p.style)} className="cap-tile" data-on={activePreset === p.id || undefined}>
                  <span className="cap-tile-screen">
                    <span style={{ ...textCss({ ...p.style, size: 72 }), fontSize: 15 }}>Hello</span>
                  </span>
                  <span className="cap-tile-name">{p.name}</span>
                </button>
              ))}
            </div>
          </Fold>

          {/* Font */}
          <Fold title="Font">
            <FontPicker value={o.font ?? null} onChange={family => onUpdate({ font: family })} />
            <div className="cap-row">
              <span className="cap-label">Weight</span>
              <div className="cap-seg" role="radiogroup" aria-label="Weight">
                {WEIGHTS.map(w => (
                  <button key={w.v} role="radio" aria-checked={(o.weight ?? 700) === w.v} onClick={() => onUpdate({ weight: w.v })}
                    className="cap-seg-btn" data-on={(o.weight ?? 700) === w.v || undefined} style={{ fontWeight: w.v }}>{w.label}</button>
                ))}
              </div>
            </div>
            <div className="cap-row">
              <span className="cap-label">Style</span>
              <div className="flex gap-1.5">
                <button onClick={() => onUpdate({ italic: !o.italic })} aria-pressed={!!o.italic} title="Italic" className="tx-toggle" data-on={o.italic || undefined} style={{ fontStyle: 'italic', fontFamily: 'Georgia, serif' }}>I</button>
                <button onClick={() => onUpdate({ uppercase: !o.uppercase })} aria-pressed={!!o.uppercase} title="Capitals" className="tx-toggle" data-on={o.uppercase || undefined}>AA</button>
              </div>
            </div>
            <Slider label="Size" value={o.size ?? 72} min={20} max={240} step={2} onChange={v => onUpdate({ size: v })} />
            <Slider label="Letter spacing" value={o.letter_spacing ?? 0} min={-4} max={30} step={1} onChange={v => onUpdate({ letter_spacing: v })} />
          </Fold>

          {/* Colour, outline, background, shadow */}
          <Fold title="Colour & effects">
            <Swatches label="Text colour" value={o.color ?? '#ffffff'} onChange={c => onUpdate({ color: c })} />

            <OnOff label="Outline" on={!!o.stroke_color && (o.stroke_width ?? 0) > 0}
              onChange={on => onUpdate(on ? { stroke_color: o.stroke_color ?? '#000000', stroke_width: o.stroke_width || 6 } : { stroke_color: null, stroke_width: 0 })} />
            {!!o.stroke_color && (o.stroke_width ?? 0) > 0 && (
              <div className="tx-sub">
                <Swatches label="Outline colour" value={o.stroke_color} onChange={c => onUpdate({ stroke_color: c })} />
                <Slider label="Thickness" value={o.stroke_width ?? 6} min={1} max={16} step={1} onChange={v => onUpdate({ stroke_width: v })} />
              </div>
            )}

            <OnOff label="Background box" on={!!o.bg_color}
              onChange={on => onUpdate(on ? { bg_color: o.bg_color ?? '#000000', bg_opacity: o.bg_opacity ?? 0.7, bg_radius: o.bg_radius ?? 12 } : { bg_color: null })} />
            {!!o.bg_color && (
              <div className="tx-sub">
                <Swatches label="Box colour" value={o.bg_color} onChange={c => onUpdate({ bg_color: c })} />
                <Slider label="Box opacity" value={Math.round((o.bg_opacity ?? 1) * 100)} min={10} max={100} step={5} suffix="%" onChange={v => onUpdate({ bg_opacity: v / 100 })} />
                <Slider label="Roundness" value={o.bg_radius ?? 12} min={0} max={40} step={1} onChange={v => onUpdate({ bg_radius: v })} />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="cap-label">Shadow</span>
              <div className="cap-seg w-full" role="radiogroup" aria-label="Shadow">
                {SHADOWS.map(sh => (
                  <button key={sh.v} role="radio" aria-checked={(o.shadow ?? 'soft') === sh.v} onClick={() => onUpdate({ shadow: sh.v })}
                    className="cap-seg-btn flex-1" data-on={(o.shadow ?? 'soft') === sh.v || undefined}>{sh.label}</button>
                ))}
              </div>
              {(o.shadow === 'hard' || o.shadow === 'glow') && (
                <Swatches label={o.shadow === 'glow' ? 'Glow colour' : 'Shadow colour'} value={o.shadow_color ?? (o.shadow === 'glow' ? o.color ?? '#ffffff' : '#000000')} onChange={c => onUpdate({ shadow_color: c })} />
              )}
            </div>

            <Slider label="Opacity" value={Math.round((o.opacity ?? 1) * 100)} min={10} max={100} step={5} suffix="%" onChange={v => onUpdate({ opacity: v / 100 })} />
            <Slider label="Rotation" value={o.rotation ?? 0} min={-45} max={45} step={1} suffix="°" onChange={v => onUpdate({ rotation: v })} />
          </Fold>

          {/* Animation in: grouped tiles, each playing its animation on a loop (.tx-an-* in globals.css) */}
          <Fold title="Animation in" defaultOpen action={
            <button onClick={() => replayTextAnimation(o.id)} className="tx-replay" title="Play the animation again in the preview">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
              Replay
            </button>
          }>
            {TEXT_ANIMATION_GROUPS.map(g => (
              <div key={g.name} className="flex flex-col gap-1.5">
                <span className="tx-an-group">{g.name}</span>
                <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`${g.name} animations`}>
                  {g.items.map(a => {
                    const on = (o.animation ?? 'none') === a.id
                    return (
                      <button key={a.id} role="radio" aria-checked={on} onClick={() => { onUpdate({ animation: a.id }); replayTextAnimation(o.id) }}
                        className="tx-an" data-on={on || undefined} title={a.label}>
                        <span className="tx-an-screen" aria-hidden="true">
                          <span className={`tx-an-demo tx-an-${a.id}`} data-text="Aa">{a.id === 'typewriter' ? <span className="tx-an-type">Aa</span> : 'Aa'}</span>
                        </span>
                        <span className="tx-an-name">{a.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </Fold>
        </div>
      )}
    </div>
  )
}

/** A style section that folds open and closed with the collapse / expand chevron */
function Fold({ title, defaultOpen = false, action, children }: {
  title: string; defaultOpen?: boolean; action?: React.ReactNode; children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open} className="tx-fold">
          <span className="cap-heading">{title}</span>
          <span className="ed-collapse" data-open={open || undefined} aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </span>
        </button>
        {open && action}
      </div>
      {open && <div className="flex flex-col gap-3">{children}</div>}
    </section>
  )
}

function Slider({ label, value, min, max, step, suffix = '', onChange }: {
  label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="cap-label">{label}</span>
        <span className="cap-value">{value}{suffix}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={e => onChange(Number(e.target.value))}
        className="ed-zoom-range w-full" style={{ '--p': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties} />
    </div>
  )
}

function Swatches({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  const isPreset = COLORS.some(c => c.toLowerCase() === value.toLowerCase())
  return (
    <div className="flex flex-col gap-2">
      <span className="cap-label">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        {COLORS.map(c => (
          <button key={c} onClick={() => onChange(c)} aria-label={`${label} ${c}`} aria-pressed={c.toLowerCase() === value.toLowerCase()}
            className="cap-swatch" data-on={c.toLowerCase() === value.toLowerCase() || undefined} style={{ background: c }} />
        ))}
        <label title="Pick any colour" className="cap-swatch" data-on={!isPreset || undefined}
          style={{ position: 'relative', cursor: 'pointer', background: 'conic-gradient(red 0deg, yellow 60deg, lime 120deg, cyan 180deg, blue 240deg, magenta 300deg, red 360deg)' }}>
          <input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={e => onChange(e.target.value)} aria-label={`Pick any ${label.toLowerCase()}`}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }} />
        </label>
      </div>
    </div>
  )
}

function OnOff({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="cap-row">
      <span className="cap-label">{label}</span>
      <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
        className="relative shrink-0 rounded-full transition-colors"
        style={{ width: 36, height: 20, background: on ? '#c8ff00' : 'rgb(var(--ed-fg) / 0.15)' }}>
        <span className="absolute rounded-full transition-all"
          style={{ top: 3, left: on ? 19 : 3, width: 14, height: 14, background: on ? '#0a0a0a' : '#fff' }} />
      </button>
    </div>
  )
}
