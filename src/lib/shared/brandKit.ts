/**
 * Brand kits (editor Brand kit tool): a user's saved looks — colours, a logo, an @handle, a title
 * style and a caption style — put on a clip with Apply (EditorShell applyBrandKit), and what a
 * Branded card frame starts with. Saved per account in the brand_kits table (the backend creates it:
 * its index.ts); how many a user can have depends on their plan (BRAND_KIT_LIMITS).
 *
 * The default kit (Phase 1, user 2026-10-17): one kit can be marked default; every new clip gets it
 * by itself — made by hand, from Best moments or Ask AI (server services/brandKits.ts
 * brandNewClips), and by Make my clips (the worker's lib/brandKit.ts mirrors what it puts on).
 */
import type { CaptionStyle, AnimationType } from './types'
import { cleanCardLook, DEFAULT_CARD_LOOK, type CardLook } from './brandCard'

export type LogoCorner = 'tl' | 'tr' | 'bl' | 'br'
/** When the logo shows: the whole clip, or only its first / last seconds */
export type LogoShow = 'all' | 'start' | 'end'

/**
 * A bar along the top or bottom edge that fills from the left as the clip plays (clips.progress_bar;
 * the preview draws it in VideoPreview, the export in render.py): its colour, its thickness in px on
 * a 1080 × 1920 frame, and its edge
 */
export interface ProgressBar { color: string; height: number; position: 'top' | 'bottom' }

/**
 * A kit's caption look: the same choices as the editor's Captions tool (a caption style and its
 * colours, font, size, capitals, words per line). `on`: new clips and Apply use it.
 */
export interface BrandCaptions {
  on: boolean
  template: string | null
  animation: AnimationType
  font: string | null
  size: number
  color: string
  highlight_color: string
  uppercase: boolean
  words_per_line: number | null
}

export interface BrandKitData {
  /**
   * main: the Branded card's background and frame bands; accent: the @handle on the card; extra:
   * up to MAX_EXTRA_COLORS more brand colours — all of them quick picks in the editor's colour choices
   */
  colors: { main: string; accent: string; extra: string[] }
  logo: {
    /** Storage path of the uploaded logo (brand/<user>/…); null = no logo */
    path: string | null
    /** Its height ÷ width, so its box keeps its shape */
    ratio: number | null
    corner: LogoCorner
    /** Placed anywhere (dragged on the kit's preview): its top-left as shares of the frame; null = in its corner */
    x: number | null
    y: number | null
    /** Its width, as a share of the frame's width */
    size: number
    /** 0–1 (1 = solid) */
    opacity: number
    /** The whole clip, or only its first / last `seconds` */
    show: LogoShow
    seconds: number
  }
  captions: BrandCaptions
  /** The progress bar new clips and Apply put on (on: they do) */
  progress: ProgressBar & { on: boolean }
  /**
   * Videos from the user's library played before and after the clip: Apply puts them in at its start
   * and end (EditorShell brandInserts; the export plays them like any video put in between). null = none
   */
  intro: string | null
  outro: string | null
  /** Apply makes the clip's last `seconds` (before the outro) a Branded card with the kit's title and @handle */
  end_card: { on: boolean; seconds: number }
  /**
   * The kit's own fonts (uploaded TTF / OTF, up to MAX_BRAND_FONTS): "BrandFont-<id>" is the family
   * name text and captions use (the file is brand/<user>/fonts/<id>); `name` is what the user calls it
   */
  fonts: BrandFont[]
  /** How the AI writes titles, hooks and post text (lib/clipText.ts BrandVoice) */
  voice: { tone: string; avoid: string; hashtags: string[]; cta: string }
  /**
   * Names and words captions must spell exactly (brand, products, people): the worker corrects
   * them after transcribing (its lib/glossary.ts), one per entry, up to MAX_GLOSSARY
   */
  glossary: string[]
  /** The channel's @handle (shown on the Branded card) */
  handle: string
  /** Frame titles and text on the clip: font family (null = the default), colour and size (px at 1080 wide) */
  title: { font: string | null; color: string; size: number }
  /** The Branded card's title */
  card_title: string
  /**
   * The Branded card, as the brand wants it (user, 2026-10-19: the one frame a kit customizes): its
   * look (background — a colour, a gradient or a pattern — and where the video, title and @handle
   * sit: brandCard.ts) and its title's and @handle's colour and size, and whether each shows
   */
  card: BrandCardSettings
  /** The account's default kit: new clips get it by themselves (at most one kit is) */
  is_default: boolean
  /**
   * Brand sound (Apply puts it on): `music` under the clip (between its intro and outro), at its
   * volume, quieter while someone talks; `sting`, a short sound logo, at the clip's very start or
   * end. Files are the owner's stored audio (audio/<user>/…, like any song in the editor).
   */
  sound: {
    music: { path: string; name: string; volume: number } | null
    sting: { path: string; name: string } | null
    sting_at: 'start' | 'end'
  }
  /**
   * Brand corners: a rounding (0–100, the Corners slider) the brand puts on every frame of a clip it's
   * on, and frames picked while it's on; null = frames keep their own. (The kit's own list of frames,
   * shown first in the Frames tool, was dropped 2026-10-19: the brand shows on whatever is picked.)
   */
  frames: { corners: number | null }
  /** Brand lock: the people the kit is shared with can pick only its colours and fonts (brandLockOf) */
  lock: boolean
}

/** The Branded card a kit customizes: its look, and its title's and @handle's colour, size and whether each shows */
export interface BrandCardSettings extends CardLook {
  title: { show: boolean; color: string; size: number }
  handle: { show: boolean; color: string; size: number }
}
export const CARD_TEXT_SIZE: [number, number] = [24, 120]

export interface BrandKit {
  id: string
  name: string
  data: BrandKitData
  /** A signed link to the logo — for showing it only, never saved */
  logo_url?: string | null
  /** Playable links to its sound files — for the editor only, never saved */
  music_url?: string | null
  sting_url?: string | null
  /** A kit someone shared with this user: who (their name or email). They can use it, not change it. */
  shared_by?: string | null
}

/** How many brand kits each plan can have (user, 2026-10-17); a plan not listed gets the Free count */
export const BRAND_KIT_LIMITS: Record<string, number> = { free: 1, student: 1, starter: 2, creator: 5, agency: 15 }
export const brandKitLimit = (plan: string | null | undefined) => BRAND_KIT_LIMITS[plan ?? 'free'] ?? BRAND_KIT_LIMITS.free

export const LOGO_SIZE: [number, number] = [0.06, 0.5]
export interface BrandFont { family: string; name: string }
/** How many names the glossary holds, and its brand hashtags */
export const MAX_GLOSSARY = 50
export const MAX_BRAND_HASHTAGS = 5

/** How many fonts a kit can hold */
export const MAX_BRAND_FONTS = 4
const BRAND_FONT = /^BrandFont-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** A font value that is a brand kit's own font */
export const isBrandFont = (family: string | null | undefined) => !!family && BRAND_FONT.test(family)
/** Where a brand font's file is kept (the render job reads it there too) */
export const brandFontKey = (userId: string, family: string) => `brand/${userId}/fonts/${family.slice('BrandFont-'.length).toLowerCase()}`

/** The logo shown only at the start or end: for this long (s) */
export const LOGO_SECONDS: [number, number] = [1, 15]
/** How many people one kit can be shared with, and the plans that can share (user's plan names) */
export const MAX_KIT_SHARES = 10
export const SHARE_PLANS = ['agency']
/** How long an end card is (s) */
export const END_CARD_SECONDS: [number, number] = [2, 10]
/** A progress bar's thickness (px on a 1080 × 1920 frame) */
export const PROGRESS_HEIGHT: [number, number] = [4, 40]
/** More brand colours besides the main and accent */
export const MAX_EXTRA_COLORS = 3
/** Space between the logo and the frame's edge, as a share of the frame's width */
export const LOGO_MARGIN = 0.04

export const DEFAULT_BRAND_CAPTIONS: BrandCaptions = {
  on: false, template: null, animation: 'karaoke', font: null, size: 52, color: '#ffffff', highlight_color: '#ffe700',
  uppercase: false, words_per_line: null,
}

export const DEFAULT_BRAND_KIT: BrandKitData = {
  colors: { main: '#1c1c22', accent: '#c8ff00', extra: [] },
  logo: { path: null, ratio: null, corner: 'tr', x: null, y: null, size: 0.18, opacity: 0.9, show: 'all', seconds: 3 },
  captions: DEFAULT_BRAND_CAPTIONS,
  progress: { on: false, color: '#c8ff00', height: 12, position: 'bottom' },
  intro: null,
  outro: null,
  end_card: { on: false, seconds: 3 },
  sound: { music: null, sting: null, sting_at: 'start' },
  frames: { corners: null },
  lock: false,
  fonts: [],
  voice: { tone: '', avoid: '', hashtags: [], cta: '' },
  glossary: [],
  handle: '',
  title: { font: null, color: '#ffffff', size: 64 },
  card_title: '',
  card: { ...DEFAULT_CARD_LOOK, title: { show: true, color: '#ffffff', size: 64 }, handle: { show: true, color: '#c8ff00', size: 40 } },
  is_default: false,
}

const ANIMATIONS: AnimationType[] = ['karaoke', 'fade', 'none', 'pop', 'highlight', 'bounce', 'word', 'hormozi', 'box', 'glow']

const HEX = /^#[0-9a-f]{6}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const videoId = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null)
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback)
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** A saved progress bar (a clip's progress_bar, or a kit's) made safe; null when it is not one */
export function cleanProgressBar(raw: unknown, fallbackColor = '#ffffff'): ProgressBar | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  return {
    color: color(p.color, fallbackColor),
    height: Math.round(num(p.height, PROGRESS_HEIGHT[0], PROGRESS_HEIGHT[1], 12)),
    position: p.position === 'top' ? 'top' : 'bottom',
  }
}

/** A kit's settings as they may be saved: anything missing or wrong takes the default */
export function cleanBrandKitData(raw: unknown, userId?: string): BrandKitData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const def = DEFAULT_BRAND_KIT
  const logo = (d.logo && typeof d.logo === 'object' ? d.logo : {}) as Record<string, unknown>
  // Only the user's own uploads (brand/<user>/…)
  const path = typeof logo.path === 'string' && (!userId || logo.path.startsWith(`brand/${userId}/`)) && !logo.path.includes('..') ? logo.path : null
  const cap = (d.captions && typeof d.captions === 'object' ? d.captions : {}) as Record<string, unknown>
  const dc = DEFAULT_BRAND_CAPTIONS
  const placed = typeof logo.x === 'number' && typeof logo.y === 'number' && isFinite(logo.x) && isFinite(logo.y)
  return {
    colors: {
      main: color(d.colors?.main, def.colors.main), accent: color(d.colors?.accent, def.colors.accent),
      extra: (Array.isArray(d.colors?.extra) ? d.colors.extra : []).filter((c: unknown) => typeof c === 'string' && HEX.test(c))
        .map((c: string) => c.toLowerCase()).slice(0, MAX_EXTRA_COLORS),
    },
    logo: {
      path,
      ratio: path ? num(logo.ratio, 0.05, 20, 1) : null,
      corner: (['tl', 'tr', 'bl', 'br'] as const).includes(logo.corner as LogoCorner) ? logo.corner as LogoCorner : def.logo.corner,
      x: placed ? num(logo.x, 0, 1, 0) : null,
      y: placed ? num(logo.y, 0, 1, 0) : null,
      size: num(logo.size, LOGO_SIZE[0], LOGO_SIZE[1], def.logo.size),
      opacity: num(logo.opacity, 0.1, 1, def.logo.opacity),
      show: (['all', 'start', 'end'] as const).includes(logo.show as LogoShow) ? logo.show as LogoShow : def.logo.show,
      seconds: Math.round(num(logo.seconds, LOGO_SECONDS[0], LOGO_SECONDS[1], def.logo.seconds)),
    },
    captions: {
      on: cap.on === true,
      template: typeof cap.template === 'string' && cap.template.length <= 60 ? cap.template : null,
      animation: ANIMATIONS.includes(cap.animation as AnimationType) ? cap.animation as AnimationType : dc.animation,
      font: typeof cap.font === 'string' && cap.font.length <= 60 ? cap.font : null,
      size: Math.round(num(cap.size, 20, 100, dc.size)),
      color: color(cap.color, dc.color),
      highlight_color: color(cap.highlight_color, dc.highlight_color),
      uppercase: cap.uppercase === true,
      words_per_line: typeof cap.words_per_line === 'number' ? Math.round(num(cap.words_per_line, 1, 10, 3)) : null,
    },
    progress: { ...(cleanProgressBar(d.progress, def.progress.color) ?? def.progress), on: d.progress?.on === true },
    intro: videoId(d.intro),
    outro: videoId(d.outro),
    end_card: {
      on: d.end_card?.on === true,
      seconds: Math.round(num(d.end_card?.seconds, END_CARD_SECONDS[0], END_CARD_SECONDS[1], def.end_card.seconds)),
    },
    fonts: (Array.isArray(d.fonts) ? d.fonts : [])
      .filter((f: any) => f && isBrandFont(f.family))
      .map((f: any) => ({ family: String(f.family), name: text(f.name, 40).trim() || 'Brand font' }))
      .filter((f: BrandFont, i: number, all: BrandFont[]) => all.findIndex(x => x.family === f.family) === i)
      .slice(0, MAX_BRAND_FONTS),
    voice: {
      tone: text(d.voice?.tone, 200),
      avoid: text(d.voice?.avoid, 200),
      hashtags: (Array.isArray(d.voice?.hashtags) ? d.voice.hashtags : [])
        .map((h: unknown) => text(h, 40).replace(/^#+/, '').replace(/\s+/g, '')).filter(Boolean).slice(0, MAX_BRAND_HASHTAGS),
      cta: text(d.voice?.cta, 120),
    },
    glossary: [...new Set((Array.isArray(d.glossary) ? d.glossary : [])
      .map((g: unknown) => text(g, 40).replace(/\s+/g, ' ').trim()).filter(Boolean))].slice(0, MAX_GLOSSARY) as string[],
    handle: text(d.handle, 40).replace(/\s+/g, ''),
    title: {
      font: typeof d.title?.font === 'string' && d.title.font.length <= 60 ? d.title.font : null,
      color: color(d.title?.color, def.title.color),
      size: Math.round(num(d.title?.size, 24, 160, def.title.size)),
    },
    card_title: text(d.card_title, 80),
    // (a kit from before its card was customized: the card as it looked then — the main colour,
    // the title style's colour and size, the accent on the @handle)
    card: cleanCard(d.card, {
      ...DEFAULT_CARD_LOOK, bg: { ...DEFAULT_CARD_LOOK.bg, color: color(d.colors?.main, def.colors.main) },
      title: { show: true, color: color(d.title?.color, def.title.color), size: Math.round(num(d.title?.size, CARD_TEXT_SIZE[0], CARD_TEXT_SIZE[1], def.title.size)) },
      handle: { show: true, color: color(d.colors?.accent, def.colors.accent), size: 40 },
    }),
    is_default: d.is_default === true,
    sound: {
      music: audioPath(d.sound?.music?.path, userId)
        ? { path: d.sound.music.path, name: text(d.sound.music.name, 60) || 'Brand music', volume: num(d.sound.music.volume, 0.05, 1, 0.3) }
        : null,
      sting: audioPath(d.sound?.sting?.path, userId) ? { path: d.sound.sting.path, name: text(d.sound.sting.name, 60) || 'Sound logo' } : null,
      sting_at: d.sound?.sting_at === 'end' ? 'end' : 'start',
    },
    frames: {
      corners: typeof d.frames?.corners === 'number' && isFinite(d.frames.corners) ? Math.round(num(d.frames.corners, 0, 100, 80)) : null,
    },
    lock: d.lock === true,
  }
}

/** A kit's Branded card settings made safe; anything missing or wrong takes `fallback`'s */
function cleanCard(raw: unknown, fallback: BrandCardSettings): BrandCardSettings {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const textOf = (t: any, f: BrandCardSettings['title']) => ({
    show: typeof t?.show === 'boolean' ? t.show : f.show,
    color: color(t?.color, f.color),
    size: Math.round(num(t?.size, CARD_TEXT_SIZE[0], CARD_TEXT_SIZE[1], f.size)),
  })
  return { ...cleanCardLook(d, fallback), title: textOf(d.title, fallback.title), handle: textOf(d.handle, fallback.handle) }
}

/** The look a Branded card section carries (FrameSettings.card) from a kit's card settings */
export const cardLookOf = (c: BrandCardSettings): CardLook => ({ bg: c.bg, video: c.video, title_at: c.title_at, handle_at: c.handle_at })

/** A kit's sound file: the owner's stored audio only */
const audioPath = (p: unknown, userId?: string): p is string =>
  typeof p === 'string' && p.startsWith(userId ? `audio/${userId}/` : 'audio/') && !p.includes('..') && p.length < 400

/**
 * What a brand lock leaves the people a kit is shared with: its colours (the palette, and its caption
 * colours) and its fonts (its own fonts, its title and caption fonts). No fonts named: fonts stay free.
 */
export function brandLockOf(d: BrandKitData): { colors: string[]; fonts: string[] } {
  return {
    colors: [...new Set([...brandPalette(d), d.captions.color, d.captions.highlight_color].map(c => c.toLowerCase()))],
    fonts: [...new Set([...d.fonts.map(f => f.family), d.title.font, d.captions.font].filter((f): f is string => !!f))],
  }
}

/** The kit's colours, for quick picks in the editor's colour choices: main, accent, title, then the extra ones (no repeats) */
export function brandPalette(d: BrandKitData): string[] {
  return [...new Set([d.colors.main, d.colors.accent, d.title.color, ...d.colors.extra].map(c => c.toLowerCase()))]
}

/** The caption style fields a kit puts on a clip (its captions switched on in the kit), as the editor saves them */
export function brandCaptionStyle(c: BrandCaptions): Partial<CaptionStyle> {
  return {
    template: c.template, animation: c.animation, font: c.font, size: c.size, color: c.color,
    highlight_color: c.highlight_color, uppercase: c.uppercase, words_per_line: c.words_per_line,
  }
}

/** When the logo shows on a clip `lengthMs` long: [start, end] ms */
export function logoSpan(logo: BrandKitData['logo'], lengthMs: number): [number, number] {
  const len = Math.max(0, Math.round(lengthMs))
  const s = Math.min(len, logo.seconds * 1000)
  return logo.show === 'start' ? [0, s] : logo.show === 'end' ? [len - s, len] : [0, len]
}

/** The @handle as shown: one leading @ */
export const showHandle = (handle: string) => (handle ? `@${handle.replace(/^@+/, '')}` : '')

/**
 * Where a kit's logo sits on the 1080 × 1920 frame (shares of the frame, like a photo on the clip):
 * its width, its height from its shape, in its corner a margin in from the edges.
 */
export function logoBox(logo: BrandKitData['logo'], frameW = 1080, frameH = 1920): { x: number; y: number; w: number; h: number } {
  const w = logo.size
  const h = Math.min(0.9, (w * frameW * (logo.ratio ?? 1)) / frameH)
  const mx = LOGO_MARGIN, my = (LOGO_MARGIN * frameW) / frameH
  // Placed anywhere (dragged): there, kept inside the frame; else in its corner
  const x = logo.x !== null ? Math.min(1 - w, Math.max(0, logo.x)) : logo.corner.endsWith('l') ? mx : 1 - mx - w
  const y = logo.y !== null ? Math.min(1 - h, Math.max(0, logo.y)) : logo.corner.startsWith('t') ? my : 1 - my - h
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, w: Math.round(w * 10000) / 10000, h: Math.round(h * 10000) / 10000 }
}

/** A clip's photo that is a brand kit's logo (Apply replaces it) */
export const isBrandLogo = (storagePath: string | null | undefined) => !!storagePath && storagePath.startsWith('brand/')
