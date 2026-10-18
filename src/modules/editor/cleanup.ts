import { clipWords, wordCuts, type CutWord, type Range } from '@/lib/cuts'

// ── Cleanup cards (the editor's Cleanup tool) ──────────────────────────────────
// Detect lists what can go from a clip — silences (from the audio: the worker's silencedetect),
// filler words and repeated words (from the captions: lib/cuts.ts) — each as a card the user plays
// and deletes. A deleted card is a removed part of the clip (trims), so it stays listed, greyed,
// and Restore brings it back. Pauses between words aren't listed (user, 2026-10-18).
// All times are SOURCE ms (the video's own), so a card keeps its place whatever else is cut.

export type CleanupKind = 'silence' | 'filler' | 'repeat'
export interface CleanupCard {
  /** Stable while the words and the silences stay the same: its kind and where it starts */
  id: string
  kind: CleanupKind
  /** What goes: source ms */
  a: number
  b: number
  /** The words it takes out (none for a silence) */
  words: string[]
}

/** Air kept next to the words either side of a removed word (as lib/cuts.ts does) */
const KEEP_EDGE_MS = 75
/** Air kept at either end of a silence, so the speech next to it isn't clipped */
const SILENCE_EDGE_MS = 120
/** A silence shorter than this (after its edges) isn't worth a card */
const MIN_SILENCE_MS = 300
/** A card counts as deleted once this much of it is removed */
const DELETED_SHARE = 0.8

/** Filler and repeated-word cards: each run of words that goes for the same reason is one card */
export function wordCards(allWords: CutWord[], clipStart: number, clipEnd: number): CleanupCard[] {
  const words = clipWords(allWords, clipStart, clipEnd)
  if (!words.length) return []
  const cut = wordCuts(words)
  // (a clip that would lose every word lists nothing: something must stay)
  if (cut.every(Boolean)) return []
  const out: CleanupCard[] = []
  for (let i = 0; i < words.length; i++) {
    const kind = cut[i]
    if (!kind) continue
    let j = i
    while (j + 1 < words.length && cut[j + 1] === kind) j++
    const prev = words[i - 1], next = words[j + 1]
    // From just after the word before to just before the word after (half the gap when it's tight)
    const a = prev ? prev.end_ms + Math.min(KEEP_EDGE_MS, (words[i].start_ms - prev.end_ms) / 2) : Math.max(clipStart, words[i].start_ms - KEEP_EDGE_MS)
    const b = next ? next.start_ms - Math.min(KEEP_EDGE_MS, (next.start_ms - words[j].end_ms) / 2) : Math.min(clipEnd, words[j].end_ms + KEEP_EDGE_MS)
    if (b > a) out.push({ id: `${kind}:${Math.round(a)}`, kind, a: Math.round(a), b: Math.round(b), words: words.slice(i, j + 1).map(w => w.word) })
    i = j
  }
  return out
}

/** Silence cards from the worker's silent stretches (source ms), a little air kept at each end */
export function silenceCards(silences: Range[], clipStart: number, clipEnd: number): CleanupCard[] {
  return silences.flatMap(([s, e]): CleanupCard[] => {
    // (at the clip's own start or end there's no speech to keep air for)
    const a = Math.max(clipStart, s <= clipStart + 1 ? s : s + SILENCE_EDGE_MS)
    const b = Math.min(clipEnd, e >= clipEnd - 1 ? e : e - SILENCE_EDGE_MS)
    return b - a >= MIN_SILENCE_MS ? [{ id: `silence:${Math.round(a)}`, kind: 'silence', a: Math.round(a), b: Math.round(b), words: [] }] : []
  })
}

/** Every card of the clip, in the order they're heard */
export function cleanupCards(words: CutWord[], silences: Range[] | null, clipStart: number, clipEnd: number): CleanupCard[] {
  return [...silenceCards(silences ?? [], clipStart, clipEnd), ...wordCards(words, clipStart, clipEnd)].sort((x, y) => x.a - y.a || x.b - y.b)
}

/** How much of [a, b) the removed parts cover, ms */
function coveredMs(a: number, b: number, trims: Range[]): number {
  return trims.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0)
}

/** Whether a card has been deleted (its stretch is a removed part of the clip) */
export const isDeleted = (card: Pick<CleanupCard, 'a' | 'b'>, trims: Range[]) => coveredMs(card.a, card.b, trims) >= (card.b - card.a) * DELETED_SHARE
