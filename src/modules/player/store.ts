'use client'

import { create } from 'zustand'

interface PlayerState {
  currentTimeMs: number   // clip-relative (0 = clip start)
  durationMs: number
  playing: boolean
}

interface PlayerActions {
  setCurrentTimeMs: (ms: number) => void
  setDurationMs: (ms: number) => void
  setPlaying: (playing: boolean) => void
}

export const usePlayerStore = create<PlayerState & PlayerActions>()(set => ({
  currentTimeMs: 0,
  durationMs: 0,
  playing: false,
  setCurrentTimeMs: (ms) => set({ currentTimeMs: ms }),
  setDurationMs: (ms) => set({ durationMs: ms }),
  setPlaying: (playing) => set({ playing }),
}))
