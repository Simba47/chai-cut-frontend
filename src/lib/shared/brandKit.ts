/**
 * Brand kits (editor Brand kit tool): a user's saved looks — colours, a logo, an @handle and a title
 * style — put on a clip with Apply (EditorShell applyBrandKit), and what a Branded card frame starts
 * with. Saved per account in the brand_kits table (the backend creates it: its index.ts); how many a
 * user can have depends on their plan (BRAND_KIT_LIMITS).
 */

export type LogoCorner = 'tl' | 'tr' | 'bl' | 'br'

export interface BrandKitData {
  /** main: the Branded card's background and frame bands; accent: the @handle on the card */
  colors: { main: string; accent: string }
  logo: {
    /** Storage path of the uploaded logo (brand/<user>/…); null = no logo */
    path: string | null
    /** Its height ÷ width, so its box keeps its shape */
    ratio: number | null
    corner: LogoCorner
    /** Its width, as a share of the frame's width */
    size: number
    /** 0–1 (1 = solid) */
    opacity: number
  }
  /** The channel's @handle (shown on the Branded card) */
  handle: string
  /** Frame titles and text on the clip: font family (null = the default), colour and size (px at 1080 wide) */
  title: { font: string | null; color: string; size: number }
  /** The Branded card's title */
  card_title: string
}

export interface BrandKit {
  id: string
  name: string
  data: BrandKitData
  /** A signed link to the logo — for showing it only, never saved */
  logo_url?: string | null
}

/** How many brand kits each plan can have (user, 2026-10-17); a plan not listed gets the Free count */
export const BRAND_KIT_LIMITS: Record<string, number> = { free: 1, student: 1, starter: 2, creator: 5, agency: 15 }
export const brandKitLimit = (plan: string | null | undefined) => BRAND_KIT_LIMITS[plan ?? 'free'] ?? BRAND_KIT_LIMITS.free

export const LOGO_SIZE: [number, number] = [0.06, 0.5]
/** Space between the logo and the frame's edge, as a share of the frame's width */
export const LOGO_MARGIN = 0.04

export const DEFAULT_BRAND_KIT: BrandKitData = {
  colors: { main: '#1c1c22', accent: '#c8ff00' },
  logo: { path: null, ratio: null, corner: 'tr', size: 0.18, opacity: 0.9 },
  handle: '',
  title: { font: null, color: '#ffffff', size: 64 },
  card_title: '',
}

const HEX = /^#[0-9a-f]{6}$/i
const color = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback)
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** A kit's settings as they may be saved: anything missing or wrong takes the default */
export function cleanBrandKitData(raw: unknown, userId?: string): BrandKitData {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  const def = DEFAULT_BRAND_KIT
  const logo = (d.logo && typeof d.logo === 'object' ? d.logo : {}) as Record<string, unknown>
  // Only the user's own uploads (brand/<user>/…)
  const path = typeof logo.path === 'string' && (!userId || logo.path.startsWith(`brand/${userId}/`)) && !logo.path.includes('..') ? logo.path : null
  return {
    colors: { main: color(d.colors?.main, def.colors.main), accent: color(d.colors?.accent, def.colors.accent) },
    logo: {
      path,
      ratio: path ? num(logo.ratio, 0.05, 20, 1) : null,
      corner: (['tl', 'tr', 'bl', 'br'] as const).includes(logo.corner as LogoCorner) ? logo.corner as LogoCorner : def.logo.corner,
      size: num(logo.size, LOGO_SIZE[0], LOGO_SIZE[1], def.logo.size),
      opacity: num(logo.opacity, 0.1, 1, def.logo.opacity),
    },
    handle: text(d.handle, 40).replace(/\s+/g, ''),
    title: {
      font: typeof d.title?.font === 'string' && d.title.font.length <= 60 ? d.title.font : null,
      color: color(d.title?.color, def.title.color),
      size: Math.round(num(d.title?.size, 24, 160, def.title.size)),
    },
    card_title: text(d.card_title, 80),
  }
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
  const x = logo.corner.endsWith('l') ? mx : 1 - mx - w
  const y = logo.corner.startsWith('t') ? my : 1 - my - h
  return { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000, w: Math.round(w * 10000) / 10000, h: Math.round(h * 10000) / 10000 }
}

/** A clip's photo that is a brand kit's logo (Apply replaces it) */
export const isBrandLogo = (storagePath: string | null | undefined) => !!storagePath && storagePath.startsWith('brand/')
