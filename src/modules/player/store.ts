'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { create } from 'zustand'

// ── The playhead's time, two ways ──
// The video moves the playhead every frame (and on every pointer move while dragging). Redrawing
// the whole editor that often made the picture lag, so the store's currentTimeMs (what the editor
// redraws from) follows at most every STORE_EVERY_MS — the first change at once, the last one
// always. What has to move every frame (the playhead line, the time, the preview's overlays)
// reads the exact time from the live feed below instead (useLiveTimeMs, liveTime.get()).
// While playing the editor needs it even less often: everything that plays (the preview, the
// sound, the music, the playhead, the timeline's scrolling) follows the live feed, and the rest
// (which section the panels show as current) can be a moment behind.
const STORE_EVERY_MS = 100
const STORE_EVERY_PLAYING_MS = 1000
let liveMs = 0
const listeners = new Set<() => void>()
export const liveTime = {
  /** The playhead's exact time now (clip ms) */
  get: () => liveMs,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn) } },
}
/** The exact playhead time, redrawing the component that uses it every frame (off: no updates) */
export function useLiveTimeMs(on = true): number {
  const subscribe = useCallback((fn: () => void) => (on ? liveTime.subscribe(fn) : () => {}), [on])
  return useSyncExternalStore(subscribe, liveTime.get, liveTime.get)
}

interface PlayerState {
  currentTimeMs: number   // clip-relative (0 = clip start)
  durationMs: number
  playing: boolean
  /** The playhead is being dragged along the timeline: the editor waits for the release */
  scrubbing: boolean
}

interface PlayerActions {
  setCurrentTimeMs: (ms: number) => void
  setScrubbing: (on: boolean) => void
  setDurationMs: (ms: number) => void
  setPlaying: (playing: boolean) => void
}

let lastStoreAt = 0
let storeTimer: ReturnType<typeof setTimeout> | null = null
/**
 * Put the live time in the store (the editor redraws). The wait before the next one counts from
 * when this redraw is on screen, so a slow redraw (the development build's are ~20x slower) can't
 * be followed straight away by another, and another.
 */
let painting = false
let wantAfterPaint = false
function storeNow() {
  painting = true
  usePlayerStore.setState({ currentTimeMs: liveMs })
  requestAnimationFrame(() => {
    painting = false
    lastStoreAt = performance.now()
    if (wantAfterPaint) { wantAfterPaint = false; requestStore() }
  })
}
/** The live time moved: the editor gets it now, or once its last redraw is on screen and the wait is over */
function requestStore() {
  if (storeTimer) return  // the latest time goes in when the timer fires
  if (painting) { wantAfterPaint = true; return }
  const st = usePlayerStore.getState()
  if (st.scrubbing || st.currentTimeMs === liveMs) return
  const every = st.playing ? STORE_EVERY_PLAYING_MS : STORE_EVERY_MS
  const since = performance.now() - lastStoreAt
  if (since >= every) { storeNow(); return }
  storeTimer = setTimeout(() => { storeTimer = null; storeNow() }, every - since)
}

export const usePlayerStore = create<PlayerState & PlayerActions>()((set, get) => ({
  currentTimeMs: 0,
  durationMs: 0,
  playing: false,
  scrubbing: false,
  setCurrentTimeMs: (ms) => {
    if (ms === liveMs && !storeTimer) return
    liveMs = ms
    for (const fn of listeners) fn()
    // Dragging the playhead: only the live feed moves (the playhead, the time, both views); the
    // editor catches up when the drag ends (setScrubbing(false))
    if (get().scrubbing) return
    requestStore()
  },
  setScrubbing: (on) => {
    if (get().scrubbing === on) return
    set({ scrubbing: on })
    if (!on && get().currentTimeMs !== liveMs) storeNow()
  },
  setDurationMs: (ms) => set({ durationMs: ms }),
  setPlaying: (playing) => set({ playing }),
}))
