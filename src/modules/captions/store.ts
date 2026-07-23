'use client'

import { create } from 'zustand'
import type { TranscriptWord, CaptionStyle } from '@chai-cut/shared'
import type { TextCase } from '@/components/editor/CaptionStyler'

interface CaptionState {
  words: TranscriptWord[]
  captionStyle: Partial<CaptionStyle>
  captionTextCase: TextCase
  showCaptions: boolean
  romanize: boolean
  retranscribing: boolean
  retranscribeElapsed: number
  retranscribeError: string | null
}

interface CaptionActions {
  hydrate: (words: TranscriptWord[], style?: Partial<CaptionStyle>, showCaptions?: boolean) => void
  setWords: (words: TranscriptWord[]) => void
  updateWord: (id: string, text: string, field?: 'word' | 'word_roman') => void
  updateCaptionStyle: (updates: Partial<CaptionStyle>) => void
  setCaptionTextCase: (tc: TextCase) => void
  setShowCaptions: (show: boolean) => void
  setRomanize: (v: boolean) => void
  setRetranscribing: (v: boolean) => void
  setRetranscribeElapsed: (n: number) => void
  setRetranscribeError: (e: string | null) => void
}

export const useCaptionStore = create<CaptionState & CaptionActions>()(set => ({
  words: [],
  captionStyle: { color: '#FFE700' },
  captionTextCase: 'title',
  showCaptions: false,
  romanize: false,
  retranscribing: false,
  retranscribeElapsed: 0,
  retranscribeError: null,

  hydrate: (words, style = { color: '#FFE700' }, showCaptions = false) =>
    set({ words, captionStyle: style, showCaptions }),

  setWords: (words) => set({ words }),
  updateWord: (id, text, field = 'word') => set(s => ({
    words: s.words.map(w => w.id === id ? { ...w, [field]: text } : w),
  })),
  updateCaptionStyle: (updates) => set(s => ({ captionStyle: { ...s.captionStyle, ...updates } })),
  setCaptionTextCase: (tc) => set({ captionTextCase: tc }),
  setShowCaptions: (show) => set({ showCaptions: show }),
  setRomanize: (v) => set({ romanize: v }),
  setRetranscribing: (v) => set({ retranscribing: v }),
  setRetranscribeElapsed: (n) => set({ retranscribeElapsed: n }),
  setRetranscribeError: (e) => set({ retranscribeError: e }),
}))
