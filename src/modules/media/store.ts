'use client'

import { create } from 'zustand'
import type { Overlay, TextOverlay, AudioTrack, Transition } from '@chai-cut/shared'
import type { FilterValues } from '@/components/editor/FilterPanel'

interface MediaState {
  overlays: Overlay[]
  textOverlays: TextOverlay[]
  audioTracks: AudioTrack[]
  transitions: Transition[]
  filters: FilterValues
  activeOverlayId: string | null
}

interface MediaActions {
  hydrate: (data: Partial<MediaState>) => void
  setOverlays: (overlays: Overlay[] | ((prev: Overlay[]) => Overlay[])) => void
  setTextOverlays: (overlays: TextOverlay[] | ((prev: TextOverlay[]) => TextOverlay[])) => void
  setAudioTracks: (tracks: AudioTrack[] | ((prev: AudioTrack[]) => AudioTrack[])) => void
  setTransitions: (transitions: Transition[] | ((prev: Transition[]) => Transition[])) => void
  setFilters: (filters: FilterValues) => void
  setActiveOverlayId: (id: string | null) => void
  updateOverlay: (id: string, updates: Partial<Overlay>) => void
  deleteOverlay: (id: string) => void
  updateTextOverlay: (id: string, updates: Partial<TextOverlay>) => void
  deleteTextOverlay: (id: string) => void
}

function applyUpdater<T>(prev: T[], updater: T[] | ((p: T[]) => T[])): T[] {
  return typeof updater === 'function' ? updater(prev) : updater
}

export const useMediaStore = create<MediaState & MediaActions>()(set => ({
  overlays: [],
  textOverlays: [],
  audioTracks: [],
  transitions: [],
  filters: { brightness: 100, contrast: 100, saturation: 100 },
  activeOverlayId: null,

  hydrate: (data) => set(data),

  setOverlays: (u) => set(s => ({ overlays: applyUpdater(s.overlays, u) })),
  setTextOverlays: (u) => set(s => ({ textOverlays: applyUpdater(s.textOverlays, u) })),
  setAudioTracks: (u) => set(s => ({ audioTracks: applyUpdater(s.audioTracks, u) })),
  setTransitions: (u) => set(s => ({ transitions: applyUpdater(s.transitions, u) })),
  setFilters: (filters) => set({ filters }),
  setActiveOverlayId: (id) => set({ activeOverlayId: id }),

  updateOverlay: (id, updates) => set(s => ({
    overlays: s.overlays.map(o => o.id === id ? { ...o, ...updates } : o),
  })),
  deleteOverlay: (id) => set(s => ({
    overlays: s.overlays.filter(o => o.id !== id),
    activeOverlayId: s.activeOverlayId === id ? null : s.activeOverlayId,
  })),
  updateTextOverlay: (id, updates) => set(s => ({
    textOverlays: s.textOverlays.map(o => o.id === id ? { ...o, ...updates } : o),
  })),
  deleteTextOverlay: (id) => set(s => ({
    textOverlays: s.textOverlays.filter(o => o.id !== id),
  })),
}))
