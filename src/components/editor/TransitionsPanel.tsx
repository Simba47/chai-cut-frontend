'use client'

import { useState } from 'react'
import type { Transition, TransitionType } from '@chai-cut/shared'

/** A place where one section of the main strip ends and the next begins (timeline ms) */
export interface TransitionJoin {
  /** The section before the join (transitions.after_segment_id) */
  afterId: string
  at: number
  /** The two formats, as names ("Vertical", "Split screen") */
  from: string
  to: string
  /** Both sides are one continuous shot framed the same (an edge-only change won't show) */
  sameShot?: boolean
}

/**
 * The kinds of transition, most used in short-form editing first. Each tile plays a little loop
 * of what it does: the outgoing picture (dark) gives way to the incoming one (light). Styles:
 * .tr-* in globals.css. The export draws them with ffmpeg's xfade (render.py); the preview the
 * same way (VideoPreview drawTransition).
 */
export const TRANSITION_KINDS: { type: TransitionType; name: string }[] = [
  { type: 'cut', name: 'None' },
  { type: 'fade', name: 'Dissolve' },
  { type: 'fadeblack', name: 'Fade black' },
  { type: 'fadewhite', name: 'Flash' },
  { type: 'zoomin', name: 'Zoom' },
  { type: 'smoothleft', name: 'Whip' },
  { type: 'hblur', name: 'Blur' },
  { type: 'slideleft', name: 'Slide left' },
  { type: 'slideright', name: 'Slide right' },
  { type: 'slideup', name: 'Slide up' },
  { type: 'slidedown', name: 'Slide down' },
  { type: 'wipe', name: 'Wipe' },
  { type: 'circleopen', name: 'Circle' },
  { type: 'radial', name: 'Clock' },
  { type: 'pixelize', name: 'Pixelate' },
]
/** How long a new transition lasts, and the range it can be set to (ms) */
export const TRANSITION_DEFAULT_MS = 500
const MIN_MS = 200, MAX_MS = 1500

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 100) / 10)
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}
const nameOf = (t: TransitionType) => TRANSITION_KINDS.find(k => k.type === t)?.name ?? 'None'
/**
 * Kinds that only blend or uncover the new picture in place: between two (almost) identical
 * pictures — one continuous shot split in two, framed the same — they look like a plain cut,
 * in the preview and in the export alike (measured). The moving ones (slides, Whip, Zoom,
 * the flashes, Blur, Pixelate) still show there.
 */
const NEEDS_CHANGE: TransitionType[] = ['fade', 'wipe', 'circleopen', 'radial']
const SAME_SHOT_TIP = 'Dissolve, Wipe, Circle and Clock look like a plain cut there. Pick a slide, Whip, Zoom, Flash, Blur or Pixelate — or change the framing of one side.'

/**
 * The Transitions tool, one set of controls for the whole clip:
 *
 *  - "Apply to": All cuts, or one cut (a chip per join, by its time; picking one moves the
 *    playhead there). A dot on a chip: that cut has a transition.
 *  - The tiles: the transition for what "Apply to" says (for All cuts, lit when they all share one).
 *  - Length, then Preview (plays through the cut, or the first one) and "+ Add cut" (splits the
 *    clip at the playhead: a new join).
 *
 * With no joins yet the tiles still show: picking one splits the clip at the playhead and puts
 * that transition on the new join (onAddHere).
 */
export function TransitionsPanel({ joins, transitions, currentTimeMs, canAddHere, onAddHere, onSet, onPreview, onSeek, savedAsDissolve }: {
  joins: TransitionJoin[]
  transitions: Transition[]
  currentTimeMs: number
  /** The playhead is inside a part of the clip (not on its first or last moment): it can be split there */
  canAddHere: boolean
  /** Split the clip at the playhead and give the new join this transition */
  onAddHere: (type: TransitionType) => void
  onSet: (afterId: string, type: TransitionType, durationMs: number) => void
  /** Play the clip through this join (from a moment before it) */
  onPreview: (at: number, durationMs: number) => void
  /** Move the playhead (to a cut picked in "Apply to") */
  onSeek?: (ms: number) => void
  /** The last save kept newer kinds as Dissolve: the database doesn't take them until the backend restarts */
  savedAsDissolve?: boolean
}) {
  // What the controls apply to: every cut, or one (its section id)
  const [scope, setScope] = useState<'all' | string>('all')

  if (joins.length === 0) {
    return (
      <div className="flex flex-col gap-3 px-4 pb-5 pt-1">
        <div className="tr-start">
          <span className="tr-empty-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2.5" y="5" width="8" height="14" rx="2" /><rect x="13.5" y="5" width="8" height="14" rx="2" /><path d="M10.5 12h3" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="tr-empty-title">Add a transition</p>
            <p className="tr-empty-text">
              {canAddHere
                ? <>Pick one: the clip is cut at the playhead (<b className="tabular-nums">{fmt(currentTimeMs)}</b>) and it plays there.</>
                : <>Move the playhead to where one shot should give way to the next, then pick one.</>}
            </p>
          </div>
        </div>
        <KindTiles picked={null} label="Add a transition at the playhead" disabled={!canAddHere} weak
          onPick={t => { if (t !== 'cut') onAddHere(t) }} />
        {canAddHere && <span className="tr-hint">This splits one shot in two, framed the same on both sides: {SAME_SHOT_TIP}</span>}
      </div>
    )
  }

  const trOf = (j: TransitionJoin) => transitions.find(t => t.after_segment_id === j.afterId)
  const typeOf = (j: TransitionJoin): TransitionType => trOf(j)?.type ?? 'cut'
  const one = scope === 'all' ? null : joins.find(j => j.afterId === scope) ?? null
  const targets = one ? [one] : joins
  // What the tiles show: the cut's own, or for All cuts the one they share (none lit when mixed)
  const types = new Set(targets.map(typeOf))
  const picked: TransitionType | null = types.size === 1 ? [...types][0] : null
  const firstOn = targets.find(j => typeOf(j) !== 'cut')
  const ms = (firstOn && trOf(firstOn)?.duration_ms) || TRANSITION_DEFAULT_MS
  const anyOn = !!firstOn
  const onJoin = joins.some(j => Math.abs(j.at - currentTimeMs) < 150)
  const preview = one ?? firstOn ?? joins[0]

  function apply(type: TransitionType, len = ms) {
    for (const j of targets) onSet(j.afterId, type, len)
    // (and it plays through the cut — the one picked, or the nearest — so what was picked is seen)
    if (type === 'cut') return
    const near = one ?? [...targets].sort((a, b) => Math.abs(a.at - currentTimeMs) - Math.abs(b.at - currentTimeMs))[0]
    if (near) onPreview(near.at, len)
  }

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-5 pt-1">
      {/* Apply to: all cuts, or one */}
      <div className="flex flex-col gap-1.5">
        <span className="tr-label">Apply to</span>
        <div className="tr-scope" role="radiogroup" aria-label="Which cuts">
          <button type="button" role="radio" aria-checked={scope === 'all'} data-on={scope === 'all' || undefined}
            onClick={() => setScope('all')}>
            All cuts <span className="tr-scope-n">{joins.length}</span>
          </button>
          {joins.map(j => (
            <button key={j.afterId} type="button" role="radio" aria-checked={scope === j.afterId} data-on={scope === j.afterId || undefined}
              title={`Cut at ${fmt(j.at)}: ${nameOf(typeOf(j))}`}
              onClick={() => { setScope(j.afterId); onSeek?.(j.at) }}>
              <span className="tabular-nums">{fmt(j.at)}</span>
              {typeOf(j) !== 'cut' && <i className="tr-scope-dot" aria-label="has a transition" />}
            </button>
          ))}
        </div>
        {scope === 'all' && picked === null && (
          <span className="tr-hint">The cuts have different transitions — picking one sets it on all of them.</span>
        )}
      </div>

      <KindTiles picked={picked} label={one ? `Transition at ${fmt(one.at)}` : 'Transition on every cut'} onPick={t => apply(t)}
        weak={targets.every(j => j.sameShot)} />
      {targets.some(j => j.sameShot) && (
        <span className="tr-hint" data-tone="warn">
          {targets.every(j => j.sameShot) ? 'Both sides of this cut are the same shot, framed the same: ' : 'Some cuts have the same shot on both sides, framed the same: '}{SAME_SHOT_TIP}
        </span>
      )}
      {savedAsDissolve && (
        <span className="tr-hint" data-tone="warn">
          The database doesn&apos;t take the newer transitions yet, so they were saved as Dissolve. Restart the backend once (it updates the database), then pick them again.
        </span>
      )}

      {anyOn && (
        <div className="flex flex-col gap-1">
          <label className="flex items-center justify-between text-[11.5px]" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>
            <span>Length</span>
            <span className="tabular-nums font-semibold" style={{ color: 'var(--ed-text)' }}>{(ms / 1000).toFixed(1)} s</span>
          </label>
          <input type="range" min={MIN_MS} max={MAX_MS} step={100} value={ms} aria-label="Transition length"
            onChange={e => {
              const len = Number(e.target.value)
              for (const j of targets) if (typeOf(j) !== 'cut') onSet(j.afterId, typeOf(j), len)
            }} className="tr-range" />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" className="tr-play flex-1 justify-center" onClick={() => onPreview(preview.at, typeOf(preview) !== 'cut' ? (trOf(preview)?.duration_ms ?? TRANSITION_DEFAULT_MS) : 0)}
          title={`Play the clip through the cut at ${fmt(preview.at)}`}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5v14l12-7z" /></svg>
          Preview {fmt(preview.at)}
        </button>
        <button type="button" className="tr-play flex-1 justify-center" disabled={!canAddHere || onJoin} onClick={() => { onAddHere(picked && picked !== 'cut' ? picked : 'fade'); setScope('all') }}
          title={canAddHere && !onJoin ? `Cut the clip at ${fmt(currentTimeMs)} and add a transition there` : 'Move the playhead inside a part of the clip'}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          Add cut at {fmt(currentTimeMs)}
        </button>
      </div>
    </div>
  )
}

/** The tiles of every kind; `picked` is lit */
function KindTiles({ picked, label, disabled, weak, onPick }: {
  picked: TransitionType | null
  label: string
  disabled?: boolean
  /** Both sides are the same shot: the kinds that won't show there are marked */
  weak?: boolean
  onPick: (type: TransitionType) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={label}>
      {TRANSITION_KINDS.map(k => (
        <button key={k.type} type="button" role="radio" aria-checked={picked === k.type} disabled={disabled}
          className="tr-tile" data-on={picked === k.type || undefined} data-weak={(weak && NEEDS_CHANGE.includes(k.type)) || undefined}
          title={weak && NEEDS_CHANGE.includes(k.type) ? `${k.name} barely shows between two parts of the same shot` : undefined}
          onClick={() => onPick(k.type)}>
          <span className="tr-demo" data-kind={k.type} aria-hidden="true"><i className="tr-a" /><i className="tr-b" /></span>
          <span className="tr-name">{k.name}</span>
        </button>
      ))}
    </div>
  )
}
