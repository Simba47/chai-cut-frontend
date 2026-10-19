'use client'

import { useEffect, useRef, useState } from 'react'
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
  return (
    <div ref={boxRef} className="spd-panel" role="dialog" aria-label="Speed">
      <div className="spd-head">
        <b>Speed</b>
        <span className="tabular-nums">{len(videoMs)} <span aria-hidden="true">→</span> <b>{len(videoMs / draft)}</b></span>
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
        <span>{label(MIN)}</span>
        <input type="range" min={0} max={1} step={0.001} value={toPos(draft)} aria-label="Speed" aria-valuetext={label(draft)}
          onPointerDown={() => { dragging.current = true }}
          onChange={e => {
            // (at or past this part's limit: the limit itself, not the rounded speed just under it)
            const p = Number(e.target.value), raw = MIN * Math.pow(MAX / MIN, p)
            const s = raw >= hi - 0.005 ? hi : raw <= lo + 0.0005 ? lo : clamp(fromPos(p))
            setDraft(s); applySoon(s)
          }}
          onPointerUp={commit} onKeyUp={commit} onBlur={() => { if (dragging.current || live.current.timer) commit() }} />
        <span>{label(MAX)}</span>
        <output className="tabular-nums">{label(draft)}</output>
      </div>
      {(hi < MAX - 0.001 && maxNote) || (lo > MIN + 0.001 && minNote) ? (
        <p className="spd-note">{[hi < MAX - 0.001 ? maxNote : null, lo > MIN + 0.001 ? minNote : null].filter(Boolean).join(' · ')}</p>
      ) : null}
      <label className="spd-switch" data-off={draft >= 1 || undefined} title={draft >= 1 ? 'For slow motion (below 1×)' : 'New in-between frames in the export, so slow motion doesn’t stutter (the export takes a little longer)'}>
        <input type="checkbox" checked={smooth && draft < 1} disabled={draft >= 1} onChange={e => onSmooth(e.target.checked)} />
        <span><b>Smooth slow-mo</b><i>Smooth frames in the export</i></span>
      </label>
      <label className="spd-switch" data-off={Math.abs(draft - 1) < 0.001 || undefined} title="On: the voice sounds higher when faster and deeper when slower. Off: it stays natural">
        <input type="checkbox" checked={pitch && Math.abs(draft - 1) > 0.001} disabled={Math.abs(draft - 1) < 0.001} onChange={e => onPitch(e.target.checked)} />
        <span><b>Pitch</b><i>Voice higher when faster, deeper when slower</i></span>
      </label>
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
