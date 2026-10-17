'use client'

import { useEffect, useRef, useState } from 'react'

/** The speeds offered as one tap (as CapCut's Normal speed) */
export const SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4]
const MIN = 0.25, MAX = 4
/** The slider runs evenly from 0.25× to 4× on a log scale (1× in the middle) */
const toPos = (s: number) => Math.log(s / MIN) / Math.log(MAX / MIN)
const fromPos = (p: number) => Math.round(MIN * Math.pow(MAX / MIN, p) * 100) / 100
const label = (s: number) => `${s % 1 === 0 ? s.toFixed(0) : String(s)}×`
function len(ms: number) {
  const t = ms / 1000
  return t < 60 ? `${t.toFixed(1)}s` : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`
}

/**
 * A part's speed (the toolbar's Speed button): presets, a slider from 0.25× to 4×, its length as it
 * will be, Smooth slow-mo (below 1×) and Pitch. The speed is applied when a preset is picked or the
 * slider is let go (it moves everything after the part, so not on every step of a drag).
 */
export function SpeedPanel({ speed, smooth, pitch, lengthMs, onSpeed, onSmooth, onPitch, onClose }: {
  speed: number; smooth: boolean; pitch: boolean
  /** How long the part lasts now on the timeline (ms) */
  lengthMs: number
  onSpeed: (s: number) => void
  onSmooth: (on: boolean) => void
  onPitch: (on: boolean) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(speed)
  useEffect(() => { setDraft(speed) }, [speed])
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
  const videoMs = lengthMs * speed
  const commit = () => { if (Math.abs(draft - speed) > 0.001) onSpeed(draft) }
  return (
    <div ref={boxRef} className="spd-panel" role="dialog" aria-label="Speed">
      <div className="spd-head">
        <b>Speed</b>
        <span className="tabular-nums">{len(lengthMs)} <span aria-hidden="true">→</span> <b>{len(videoMs / draft)}</b></span>
      </div>
      <div className="spd-presets" role="radiogroup" aria-label="Speed presets">
        {SPEED_PRESETS.map(s => (
          <button key={s} type="button" role="radio" aria-checked={Math.abs(draft - s) < 0.001} data-on={Math.abs(draft - s) < 0.001 || undefined}
            onClick={() => { setDraft(s); if (Math.abs(s - speed) > 0.001) onSpeed(s) }}>
            {label(s)}
          </button>
        ))}
      </div>
      <div className="spd-slider">
        <span>0.25×</span>
        <input type="range" min={0} max={1} step={0.001} value={toPos(draft)} aria-label="Speed" aria-valuetext={label(draft)}
          onChange={e => setDraft(fromPos(Number(e.target.value)))}
          onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
        <span>4×</span>
        <output className="tabular-nums">{label(draft)}</output>
      </div>
      <label className="spd-switch" data-off={draft >= 1 || undefined} title={draft >= 1 ? 'For slow motion (below 1×)' : 'New in-between frames in the export, so slow motion doesn’t stutter (the export takes a little longer)'}>
        <input type="checkbox" checked={smooth && draft < 1} disabled={draft >= 1} onChange={e => onSmooth(e.target.checked)} />
        <span><b>Smooth slow-mo</b><i>Smooth frames in the export</i></span>
      </label>
      <label className="spd-switch" data-off={Math.abs(draft - 1) < 0.001 || undefined} title="On: the voice sounds higher when faster and deeper when slower. Off: it stays natural">
        <input type="checkbox" checked={pitch && Math.abs(draft - 1) > 0.001} disabled={Math.abs(draft - 1) < 0.001} onChange={e => onPitch(e.target.checked)} />
        <span><b>Pitch</b><i>Voice higher when faster, deeper when slower</i></span>
      </label>
      {Math.abs(speed - 1) > 0.001 && (
        <button type="button" className="spd-reset" onClick={() => { setDraft(1); onSpeed(1) }}>Back to 1×</button>
      )}
    </div>
  )
}
