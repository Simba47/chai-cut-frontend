'use client'

import { create } from 'zustand'
import { useEditorStore, type KeyframeMap } from './store'
import { useMediaStore } from '@/modules/media/store'
import { useCaptionStore } from '@/modules/captions/store'

// Undo / redo for everything the editor saves: formats and frames, crop boxes and their motion,
// overlays, text, audio, transitions, filters and the caption style. Selection is not history.
//
// One step = one burst of edits: a whole drag (until the pointer is released) or a run of typing
// counts once. The auto-save watches the same state, so an undo is saved like any other edit.

interface Snapshot {
  segments: ReturnType<typeof useEditorStore.getState>['segments']
  keyframes: KeyframeMap
  overlays: ReturnType<typeof useMediaStore.getState>['overlays']
  textOverlays: ReturnType<typeof useMediaStore.getState>['textOverlays']
  audioTracks: ReturnType<typeof useMediaStore.getState>['audioTracks']
  transitions: ReturnType<typeof useMediaStore.getState>['transitions']
  filters: ReturnType<typeof useMediaStore.getState>['filters']
  captionStyle: ReturnType<typeof useCaptionStore.getState>['captionStyle']
}

const LIMIT = 100
// Edits closer together than this belong to the same step
const BURST_IDLE_MS = 600

function take(): Snapshot {
  const e = useEditorStore.getState(), m = useMediaStore.getState(), c = useCaptionStore.getState()
  return {
    segments: e.segments, keyframes: e.keyframes,
    overlays: m.overlays, textOverlays: m.textOverlays, audioTracks: m.audioTracks, transitions: m.transitions, filters: m.filters,
    captionStyle: c.captionStyle,
  }
}

// Stores replace what they change, so comparing references finds real edits
function same(a: Snapshot, b: Snapshot) {
  return (Object.keys(a) as (keyof Snapshot)[]).every(k => a[k] === b[k])
}

function restore(s: Snapshot) {
  useEditorStore.setState({ segments: s.segments, keyframes: s.keyframes })
  useMediaStore.setState({ overlays: s.overlays, textOverlays: s.textOverlays, audioTracks: s.audioTracks, transitions: s.transitions, filters: s.filters })
  useCaptionStore.setState({ captionStyle: s.captionStyle, romanize: s.captionStyle.language === 'roman' })
}

export const useHistory = create<{ canUndo: boolean; canRedo: boolean }>(() => ({ canUndo: false, canRedo: false }))

let past: Snapshot[] = []
let future: Snapshot[] = []
/** State at the end of the last step — what an edit starting now would be undone to */
let committed: Snapshot | null = null
let inBurst = false
let restoring = false
let pointerDown = false
let timer: ReturnType<typeof setTimeout> | null = null

function sync() {
  useHistory.setState({ canUndo: past.length > 0 || inBurst, canRedo: future.length > 0 })
}

function endBurst() {
  if (timer) { clearTimeout(timer); timer = null }
  inBurst = false
  committed = take()
}

function settle() {
  // A drag isn't over until the pointer is released
  if (pointerDown) { timer = setTimeout(settle, BURST_IDLE_MS); return }
  endBurst()
  sync()
}

function onChange() {
  if (restoring || !committed) return
  if (!inBurst) {
    if (same(take(), committed)) return // only the selection changed
    past.push(committed)
    if (past.length > LIMIT) past.shift()
    future = []
    inBurst = true
    sync()
  }
  if (timer) clearTimeout(timer)
  timer = setTimeout(settle, BURST_IDLE_MS)
}

export function undo() {
  if (inBurst) endBurst()
  const prev = past.pop()
  if (!prev) { sync(); return }
  future.push(take())
  restoring = true
  restore(prev)
  restoring = false
  committed = prev
  sync()
}

export function redo() {
  if (inBurst) endBurst()
  const next = future.pop()
  if (!next) { sync(); return }
  past.push(take())
  restoring = true
  restore(next)
  restoring = false
  committed = next
  sync()
}

/** Start recording (call once the stores hold the loaded clip). Returns a stop function. */
export function startHistory(): () => void {
  past = []; future = []; inBurst = false; committed = take()
  sync()
  const unsubs = [useEditorStore.subscribe(onChange), useMediaStore.subscribe(onChange), useCaptionStore.subscribe(onChange)]
  const down = () => { pointerDown = true }
  const up = () => { pointerDown = false }
  window.addEventListener('pointerdown', down, true)
  window.addEventListener('pointerup', up, true)
  window.addEventListener('pointercancel', up, true)
  return () => {
    unsubs.forEach(u => u())
    window.removeEventListener('pointerdown', down, true)
    window.removeEventListener('pointerup', up, true)
    window.removeEventListener('pointercancel', up, true)
    if (timer) clearTimeout(timer)
    past = []; future = []; committed = null; inBurst = false
    sync()
  }
}
