/**
 * The sound library in the Music tool (SoundLibrary.tsx): what it offers and the shape of a result.
 * The sounds come from Freesound (server/services/soundLibrary.ts), live; the chips below are
 * ready-made searches, so the first screen of each tab already shows something useful.
 */

export type SoundKind = 'music' | 'sfx' | 'meme'

/** One result of a search */
export interface SoundItem {
  /** Freesound's number for the sound */
  id: number
  name: string
  author: string
  /** CC0: free to use as is. CC BY: free to use with the author named (it is in the track's name) */
  license: 'cc0' | 'by'
  /** Seconds */
  duration: number
  /** A small mp3 to listen to before adding it */
  preview: string
}

export const SOUND_TABS: { kind: SoundKind; label: string; hint: string }[] = [
  { kind: 'music', label: 'Music', hint: 'Background music and beats' },
  { kind: 'sfx', label: 'Effects', hint: 'Whooshes, pops, hits: short sounds for cuts and moments' },
  { kind: 'meme', label: 'Memes', hint: 'Reaction sounds used in memes and reels' },
]

/** Ready-made searches per tab (the first one shows when the tab opens) */
export const SOUND_CHIPS: Record<SoundKind, { label: string; q: string }[]> = {
  music: [
    { label: 'Trending', q: 'upbeat energetic loop' },
    { label: 'Lo-fi', q: 'lofi chill beat' },
    { label: 'Phonk', q: 'phonk drift bass' },
    { label: 'Desi beats', q: 'indian dhol beat' },
    { label: 'Bollywood', q: 'bollywood instrumental' },
    { label: 'Devotional', q: 'indian flute bhajan' },
    { label: 'Emotional', q: 'emotional piano' },
    { label: 'Cinematic', q: 'cinematic epic' },
  ],
  sfx: [
    { label: 'Whoosh', q: 'whoosh' },
    { label: 'Pop', q: 'pop click' },
    { label: 'Boom', q: 'boom impact' },
    { label: 'Riser', q: 'riser' },
    { label: 'Glitch', q: 'glitch' },
    { label: 'Camera', q: 'camera shutter' },
    { label: 'Ding', q: 'ding notification' },
    { label: 'Clap', q: 'clap applause' },
  ],
  meme: [
    { label: 'Vine boom', q: 'vine boom' },
    { label: 'Bruh', q: 'bruh' },
    { label: 'Airhorn', q: 'airhorn' },
    { label: 'Sad violin', q: 'sad violin' },
    { label: 'Dramatic', q: 'dramatic sting' },
    { label: 'Record scratch', q: 'record scratch' },
    { label: 'Dhol hit', q: 'dhol hit' },
    { label: 'Laugh', q: 'laugh track' },
  ],
}

/** How long a sound of each kind can be (seconds): effects and meme sounds are short */
export const SOUND_LENGTH: Record<SoundKind, [number, number]> = {
  music: [20, 240],
  sfx: [0.3, 8],
  meme: [0.3, 10],
}

/**
 * What a sound of each kind is added with. A song keeps the usual defaults (a gentle level, ducked
 * under speech, faded in and out); a short sound doesn't: the 0.5 s fades would swallow it and
 * ducking would mute it whenever someone talks.
 */
export const SOUND_DEFAULTS: Record<SoundKind, { volume: number; duck_under_speech: boolean; fade_in: boolean; fade_out: boolean }> = {
  music: { volume: 0.5, duck_under_speech: true, fade_in: true, fade_out: true },
  sfx: { volume: 0.9, duck_under_speech: false, fade_in: false, fade_out: false },
  meme: { volume: 0.9, duck_under_speech: false, fade_in: false, fade_out: false },
}

/** A track added from a CC BY sound has this at the end of its name (the author is in front of it) */
export const CC_BY_SUFFIX = 'CC-BY'
