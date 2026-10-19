'use client'

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { SPEED_MIN, SPEED_MAX } from '@chai-cut/shared'

/** The speeds offered as one tap (as CapCut's Normal speed) */
export const SPEED_PRESETS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10]
const MIN = SPEED_MIN, MAX = SPEED_MAX
/** The slider runs evenly on a log scale: 1× in the middle, 0.1× and 10× as far from it */
const toPos = (s: number) => Math.log(s / MIN) / Math.log(MAX / MIN)
/** (rounded as one would type it — 0.37×, 1.25×, 4.5× — and 1× catches the thumb near the middle) */
const fromPos = (p: number) => {
  if (Math.abs(p - toPos(1)) < 0.015) return 1
  const s = MIN * Math.pow(MAX / MIN, p)
  return s < 3 ? Math.round(s * 100) / 100 : Math.round(s * 10) / 10
}
const label = (s: number) => `${s % 1 === 0 ? s.toFixed(0) : String(s)}×`
function len(ms: number) {
  const t = ms / 1000
  return t < 60 ? `${t.toFixed(1)}s` : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
}
/** While the slider is dragged its speed is applied this often (the timeline and the length follow it) */
const LIVE_EVERY_MS = 120
/** The usual speeds, marked under the slider */
const TICKS = [0.5, 1, 2, 5]
const GAP = 12

/**
 * Where the panel goes (fixed to the window): above the toolbar it opens from, beside the video so
 * it never covers it — left of it if there's room, else right of it — else below the toolbar, over
 * the timeline (scrolling inside if it doesn't fit). The video: the largest picture showing in the
 * preview ([data-speed-avoid]).
 */
function placeBeside(panel: HTMLElement, button: HTMLElement): CSSProperties {
  const b = button.getBoundingClientRect()
  const w = panel.offsetWidth, h = panel.scrollHeight
  const vw = window.innerWidth, vh = window.innerHeight
  const area = document.querySelector('[data-speed-avoid]')
  let pic: DOMRect | null = null
  for (const el of area ? Array.from(area.querySelectorAll('video, canvas')) : []) {
    const r = el.getBoundingClientRect()
    if (r.width > 40 && r.height > 40 && (!pic || r.width * r.height > pic.width * pic.height)) pic = r
  }
  const top = Math.max(8, Math.min(b.top - GAP, vh - 8) - h)
  if (pic) {
    if (pic.left - GAP - w >= 8) return { position: 'fixed', left: pic.left - GAP - w, top }
    if (pic.right + GAP + w <= vw - 8) return { position: 'fixed', left: pic.right + GAP, top }
  }
  const left = Math.max(8, Math.min(b.left - 8, vw - w - 8))
  const below = b.bottom + GAP
  if (vh - 8 - below >= Math.min(h, 260)) return { position: 'fixed', left, top: below, maxHeight: vh - 8 - below, overflowY: 'auto' }
  return { position: 'fixed', left, top }
}

/**
 * A part's speed (the toolbar's Speed button): presets, a slider from 0.1× to 10×, its length as it
 * will be, Smooth slow-mo (below 1×) and Pitch. A preset applies at once; the slider applies while
 * it is dragged (a few times a second: the part's length on the timeline follows) and once more
 * when it is let go — one undo step for the whole drag. `minSpeed` / `maxSpeed`: how far this part
 * can go (a part can't get shorter than the shortest part, the clip no longer than its limit).
 */
export function SpeedPanel({ speed, smooth, pitch, lengthMs, minSpeed = MIN, maxSpeed = MAX, minNote, maxNote, applyAllCount = 0, onSpeed, onSmooth, onPitch, onApplyAll, onClose }: {
  speed: number; smooth: boolean; pitch: boolean
  /** How long the part lasts now on the timeline (ms) */
  lengthMs: number
  minSpeed?: number
  maxSpeed?: number
  /** Why it can't go slower than minSpeed / faster than maxSpeed (shown when it can't) */
  minNote?: string
  maxNote?: string
  /** How many parts "Apply to all parts" would change (the button shows when there are others) */
  applyAllCount?: number
  onSpeed: (s: number) => void
  onSmooth: (on: boolean) => void
  onPitch: (on: boolean) => void
  onApplyAll?: () => void
  onClose: () => void
}) {
  const lo = Math.max(MIN, Math.min(minSpeed, speed)), hi = Math.min(MAX, Math.max(maxSpeed, speed))
  const [draft, setDraft] = useState(speed)
  // (dragging: the speed applied meanwhile doesn't move the thumb back to where it was a moment ago)
  const dragging = useRef(false)
  const live = useRef<{ at: number; timer: ReturnType<typeof setTimeout> | null; want: number | null }>({ at: 0, timer: null, want: null })
  useEffect(() => { if (!dragging.current) setDraft(speed) }, [speed])
  const onSpeedRef = useRef(onSpeed)
  onSpeedRef.current = onSpeed
  const speedRef = useRef(speed)
  speedRef.current = speed
  useEffect(() => () => { if (live.current.timer) clearTimeout(live.current.timer) }, [])
  const boxRef = useRef<HTMLDivElement>(null)
  // A speed being typed in (null: not typing)
  const [typing, setTyping] = useState<string | null>(null)
  // (Escape: what was typed is dropped — the box losing focus right after mustn't apply it)
  const dropTyped = useRef(false)
  // Where it sits: worked out before it shows, and again when the window changes size
  const [place, setPlace] = useState<CSSProperties | null>(null)
  // (after every change too: its height changes as its options show or hide)
  const placeNow = () => {
    const p = boxRef.current, btn = document.querySelector<HTMLElement>('[data-speed-btn]')
    if (!p || !btn) return
    const next = placeBeside(p, btn)
    setPlace(prev => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }
  useLayoutEffect(placeNow)
  useEffect(() => {
    window.addEventListener('resize', placeNow)
    return () => window.removeEventListener('resize', placeNow)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (boxRef.current && !boxRef.current.contains(t) && !t?.closest?.('[data-speed-btn]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onDown, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onDown, true) }
  }, [onClose])
  const apply = (s: number) => { if (Math.abs(s - speedRef.current) > 0.001) onSpeedRef.current(s) }
  /** The slider moved: applied now, or as soon as LIVE_EVERY_MS has passed since the last one */
  const applySoon = (s: number) => {
    const l = live.current
    l.want = s
    if (l.timer) return
    const wait = LIVE_EVERY_MS - (performance.now() - l.at)
    const go = () => { l.timer = null; l.at = performance.now(); if (l.want != null) apply(l.want); l.want = null }
    if (wait <= 0) go()
    else l.timer = setTimeout(go, wait)
  }
  const commit = () => {
    const l = live.current
    if (l.timer) { clearTimeout(l.timer); l.timer = null }
    l.want = null
    dragging.current = false
    apply(draft)
  }
  const videoMs = lengthMs * speed
  const clamp = (s: number) => Math.max(lo, Math.min(hi, s))
  const atMax = hi < MAX - 0.001 && draft >= hi - 0.001
  const atMin = lo > MIN + 0.001 && draft <= lo + 0.001
  const normal = Math.abs(draft - 1) < 0.001
  /** A speed typed in ("1.3", "1.3x", "1,3×"): within this part's limits, else back to what it was */
  const typed = (text: string) => {
    const v = parseFloat(text.replace(',', '.').replace(/[x×\s]/gi, ''))
    if (!isFinite(v) || v <= 0) { setTyping(null); return }
    const s = clamp(Math.round(v * 100) / 100)
    setTyping(null); setDraft(s); apply(s)
  }
  return (
    <div ref={boxRef} className="spd-panel" role="dialog" aria-label="Speed" style={place ?? { visibility: 'hidden' }}>
      <div className="spd-head">
        <b>Speed</b>
        <span className="tabular-nums" title="How long this part lasts: as filmed → at this speed">
          Duration {normal ? <b>{len(videoMs)}</b> : <>{len(videoMs)} <span aria-hidden="true">→</span> <b>{len(videoMs / draft)}</b></>}
        </span>
      </div>
      <div className="spd-presets" role="radiogroup" aria-label="Speed presets">
        {SPEED_PRESETS.map(s => {
          const off = s < lo - 0.001 || s > hi + 0.001
          return (
            <button key={s} type="button" role="radio" aria-checked={Math.abs(draft - s) < 0.001} data-on={Math.abs(draft - s) < 0.001 || undefined}
              disabled={off} title={off ? (s > hi ? maxNote : minNote) : undefined}
              onClick={() => { setDraft(s); apply(s) }}>
              {label(s)}
            </button>
          )
        })}
      </div>
      <div className="spd-slider">
        <div className="spd-track">
          <input type="range" min={0} max={1} step={0.001} value={toPos(draft)} aria-label="Speed" aria-valuetext={label(draft)}
            onPointerDown={() => { dragging.current = true }}
            onChange={e => {
              // (at or past this part's limit: the limit itself, not the rounded speed just under it)
              const p = Number(e.target.value), raw = MIN * Math.pow(MAX / MIN, p)
              const s = raw >= hi - 0.005 ? hi : raw <= lo + 0.0005 ? lo : clamp(fromPos(p))
              setDraft(s); applySoon(s)
            }}
            onPointerUp={commit} onKeyUp={commit} onBlur={() => { if (dragging.current || live.current.timer) commit() }} />
          {/* marks under the track at the usual speeds (the thumb's centre runs 8 px in from each end) */}
          <div className="spd-ticks" aria-hidden="true">
            {TICKS.map(t => (
              <span key={t} style={{ left: `calc(8px + ${toPos(t)} * (100% - 16px))` }} data-on={Math.abs(draft - t) < 0.001 || undefined}>{label(t)}</span>
            ))}
          </div>
        </div>
        {/* the speed, and a box to type one */}
        <input className="spd-type tabular-nums" type="text" inputMode="decimal" aria-label="Type a speed" title="Type a speed (for example 1.3) and press Enter"
          value={typing ?? label(draft)}
          onFocus={e => { setTyping(String(draft)); requestAnimationFrame(() => e.target.select()) }}
          onChange={e => setTyping(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); typed(e.currentTarget.value); e.currentTarget.blur() }
            if (e.key === 'Escape') { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); dropTyped.current = true; setTyping(null); e.currentTarget.blur() }
          }}
          onBlur={e => {
            if (dropTyped.current) { dropTyped.current = false; return }
            if (typing != null) typed(e.currentTarget.value)
          }} />
      </div>
      {(atMax || atMin) && <p className="spd-note">{atMax ? maxNote : minNote}</p>}
      {normal ? (
        <p className="spd-hint">Slow it down or speed it up for smooth slow-mo and voice pitch</p>
      ) : (
        <>
          {draft < 1 && (
            <label className="spd-switch" title="New in-between frames in the export, so slow motion doesn’t stutter (the export takes a little longer)">
              <input type="checkbox" checked={smooth} onChange={e => onSmooth(e.target.checked)} />
              <span><b>Smooth slow-mo</b><i>Smooth frames in the export</i></span>
            </label>
          )}
          <label className="spd-switch" title="On: the voice sounds higher when faster and deeper when slower. Off: it stays natural">
            <input type="checkbox" checked={pitch} onChange={e => onPitch(e.target.checked)} />
            <span><b>Pitch</b><i>Voice higher when faster, deeper when slower</i></span>
          </label>
        </>
      )}
      {(Math.abs(speed - 1) > 0.001 || (onApplyAll && applyAllCount > 1)) && (
        <div className="spd-foot">
          {Math.abs(speed - 1) > 0.001 && (
            <button type="button" className="spd-reset" onClick={() => { setDraft(1); apply(1) }}>Back to 1×</button>
          )}
          {onApplyAll && applyAllCount > 1 && (
            <button type="button" className="spd-all" onClick={onApplyAll}
              title={`Every part of the main video plays at ${label(speed)}${smooth && speed < 1 ? ', smooth' : ''}${pitch && speed !== 1 ? ', pitch following' : ''}`}>
              Apply to all {applyAllCount} parts
            </button>
          )}
        </div>
      )}
    </div>
  )
}
