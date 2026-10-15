'use client'

import type { Transition, TransitionType } from '@chai-cut/shared'

/** A place where one section of the main strip ends and the next begins (timeline ms) */
export interface TransitionJoin {
  /** The section before the join (transitions.after_segment_id) */
  afterId: string
  at: number
  /** The two formats, as names ("Vertical", "Split screen") */
  from: string
  to: string
}

/**
 * The kinds of transition, in the order they're offered. Each tile plays a little loop of what it
 * does: the outgoing picture (grey) gives way to the incoming one (lime). Styles: .tr-* in
 * globals.css. The export draws them with ffmpeg's xfade (render.py); the preview the same way
 * (VideoPreview drawTransition).
 */
export const TRANSITION_KINDS: { type: TransitionType; name: string }[] = [
  { type: 'cut', name: 'None' },
  { type: 'fade', name: 'Dissolve' },
  { type: 'fadeblack', name: 'Fade black' },
  { type: 'fadewhite', name: 'Flash' },
  { type: 'slideleft', name: 'Slide' },
  { type: 'slideup', name: 'Slide up' },
  { type: 'wipe', name: 'Wipe' },
  { type: 'zoomin', name: 'Zoom' },
  { type: 'circleopen', name: 'Circle' },
]
/** How long a new transition lasts, and the range it can be set to (ms) */
export const TRANSITION_DEFAULT_MS = 500
const MIN_MS = 200, MAX_MS = 1500

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 100) / 10)
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/**
 * The Transitions tool: every join between sections of the clip, each with its transition (None
 * to begin with) picked from tiles, and how long it lasts. "Preview" plays the clip through that
 * join; "Use on every join" gives all of them the same one.
 */
export function TransitionsPanel({ joins, transitions, currentTimeMs, onSet, onPreview }: {
  joins: TransitionJoin[]
  transitions: Transition[]
  currentTimeMs: number
  onSet: (afterId: string, type: TransitionType, durationMs: number) => void
  /** Play the clip through this join (from a moment before it) */
  onPreview: (at: number, durationMs: number) => void
}) {
  if (joins.length === 0) {
    return (
      <div className="tr-empty">
        <span className="tr-empty-icon" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2.5" y="5" width="8" height="14" rx="2" /><rect x="13.5" y="5" width="8" height="14" rx="2" /><path d="M10.5 12h3" />
          </svg>
        </span>
        <p className="tr-empty-title">No joins yet</p>
        <p className="tr-empty-text">A transition goes where one part of the clip meets the next. Split the clip (press S at the playhead) or change its format partway, then come back here.</p>
      </div>
    )
  }
  // The join nearest the playhead is shown as the one being looked at
  const near = joins.reduce((best, j) => (Math.abs(j.at - currentTimeMs) < Math.abs(best.at - currentTimeMs) ? j : best), joins[0])
  return (
    <div className="flex flex-col gap-3 px-4 pb-5 pt-1">
      <p className="text-[12px] leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
        Pick how each part of the clip gives way to the next. It plays in the preview and in the export.
      </p>
      {joins.map((j, i) => {
        const tr = transitions.find(t => t.after_segment_id === j.afterId)
        const type: TransitionType = tr?.type ?? 'cut'
        const ms = tr?.duration_ms ?? TRANSITION_DEFAULT_MS
        const on = type !== 'cut'
        return (
          <section key={j.afterId} className="tr-join" data-near={j === near || undefined} aria-label={`Join ${i + 1} at ${fmt(j.at)}`}>
            <div className="flex items-center gap-2">
              <span className="tr-join-num">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <p className="tr-join-title">Join at {fmt(j.at)}</p>
                <p className="tr-join-sub truncate">{j.from} → {j.to}</p>
              </div>
              <button type="button" className="tr-play" onClick={() => onPreview(j.at, on ? ms : 0)} title="Play the clip through this join">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
                Preview
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`Transition at join ${i + 1}`}>
              {TRANSITION_KINDS.map(k => (
                <button key={k.type} type="button" role="radio" aria-checked={type === k.type}
                  className="tr-tile" data-on={type === k.type || undefined}
                  onClick={() => onSet(j.afterId, k.type, ms)}>
                  <span className="tr-demo" data-kind={k.type} aria-hidden="true"><i className="tr-a" /><i className="tr-b" /></span>
                  <span className="tr-name">{k.name}</span>
                </button>
              ))}
            </div>
            {on && (
              <div className="flex flex-col gap-1.5">
                <label className="flex items-center justify-between text-[11.5px]" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>
                  <span>Length</span>
                  <span className="tabular-nums font-semibold" style={{ color: 'var(--ed-text)' }}>{(ms / 1000).toFixed(1)} s</span>
                </label>
                <input type="range" min={MIN_MS} max={MAX_MS} step={100} value={ms} aria-label="Transition length"
                  onChange={e => onSet(j.afterId, type, Number(e.target.value))} className="tr-range" />
                {joins.length > 1 && (
                  <button type="button" className="tr-all" onClick={() => joins.forEach(o => onSet(o.afterId, type, ms))}>
                    Use on every join
                  </button>
                )}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
