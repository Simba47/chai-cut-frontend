import { VIDEO_FONTS } from '@/lib/shared/videoFonts'

/**
 * A website's look read from its styles (brandFromLink.ts, Easy setup stage 1, 2026-10-27): its
 * heading and body fonts, matched to the nearest of the editor's fonts (VIDEO_FONTS), and its brand
 * colours, most telling first. Plain text work on the page's CSS: no paid service, no browser.
 */

// ── Fonts ─────────────────────────────────────────────────────────────────────

/** Font names that say nothing about the brand: the browser's own and the usual fallbacks */
const GENERIC = /^(serif|sans-serif|monospace|cursive|fantasy|math|emoji|fangsong|system-ui|ui-(sans-serif|serif|monospace|rounded)|-apple-system|blinkmacsystemfont|segoe ui( (emoji|symbol))?|apple color emoji|noto color emoji|inherit|initial|unset|revert|var\(.*)$/i
/** A stack that starts with the system's own font: the site uses no font of its own there */
const SYSTEM_FIRST = /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif)$/i
/** Icon fonts, maths fonts (KaTeX, MathJax) and code fonts are no one's brand type */
const ICON_FONT = /icon|awesome|material symbols|material icons|glyph|fontello|dashicons|swiper|slick|katex|mathjax|^math|mono|code|consol|courier|menlo/i
/** Where a font is set for code, not for the brand's own words */
const CODE_PLACE = /mono|code|\bpre\b|kbd|samp|\bcode\b|terminal/i

/**
 * A web font's nearest one in the editor's list, by its kind: well-known faces by name, else by
 * the words in its name. (Families already in the list are themselves.)
 */
const NEAREST: Array<[RegExp, string]> = [
  // script and handwritten
  [/pacifico|lobster|dancing|great vibes|satisfy|kaushan|caveat|sacramento|script|brush|handwrit|signature/i, 'Pacifico'],
  // rounded and friendly
  [/fredoka|baloo|comfortaa|varela round|quicksand|nunito|rounded|bubble|chewy/i, 'Nunito'],
  // condensed display
  [/bebas|league gothic|impact|teko|anton|six caps|big shoulders/i, 'Bebas Neue'],
  [/oswald|barlow condensed|roboto condensed|fjalla|pathway|antonio|condensed|compressed|narrow/i, 'Oswald'],
  // serif
  [/playfair|merriweather|lora|pt serif|libre baskerville|cormorant|garamond|dm serif|tiempos|sectra|canela|recoleta|georgia|times|baskerville|bodoni|didot|caslon|spectral|fraunces|crimson|noto serif|source serif|ibm plex serif|serif/i, 'Playfair Display'],
  // heavy display sans
  [/archivo black|black ops|titan|alfa slab|rubik mono|ultra|heavy/i, 'Archivo Black'],
  // techy
  [/space grotesk|orbitron|exo|audiowide|tech/i, 'Space Grotesk'],
  // geometric sans
  [/poppins|circular|gilroy|product sans|google sans|avenir|futura|proxima|gotham|manrope|plus jakarta|urbanist|lexend|figtree|general sans|satoshi|cabinet|clash|mulish|josefin|century gothic|sofia pro|tt commons|gordita|euclid|graphik|aeonik|geist/i, 'Poppins'],
  [/montserrat|raleway|outfit|sora|ubuntu|rubik|dm sans|lato|work sans|karla|hind|mukta|kanit|prompt|heebo|assistant|cabin/i, 'Montserrat'],
  // neo-grotesk and plain sans (the most common): Inter
  [/inter|helvetica|arial|roboto|open sans|source sans|noto sans|ibm plex|sf pro|segoe|neue haas|untitled|söhne|soehne|sohne|suisse|aktiv|akzidenz|universe|univers|public sans|pt sans|fira sans|sans/i, 'Inter'],
]

const ours = new Map(VIDEO_FONTS.filter(f => f.family !== 'sans-serif').map(f => [f.family.toLowerCase(), f.family]))

/** A web font's nearest editor font; null when the name says nothing (a system or icon font) */
export function nearestFont(name: string): string | null {
  const n = name.trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ')
  if (!n || GENERIC.test(n) || ICON_FONT.test(n)) return null
  const exact = ours.get(n.toLowerCase())
  if (exact) return exact
  // ("Inter Variable", "Poppins-Bold", "Gilroy SemiBold": the family's own name first)
  const base = n.replace(/[-_]/g, ' ').replace(/\b(variable|vf|var|display|text|web|pro|semibold|semi bold|bold|regular|medium|light|thin|black|extra ?bold|book|italic|\d{3})\b/gi, '').replace(/\s+/g, ' ').trim()
  const same = ours.get(base.toLowerCase())
  if (same) return same
  for (const [re, family] of NEAREST) if (re.test(n)) return family
  return null
}

/** The first real font of a `font-family` list ("'Gilroy', -apple-system, sans-serif" → Gilroy); null for a system or generic one */
function firstFont(value: string): string | null {
  const parts = value.split(',').map(p => p.trim().replace(/^["']|["']$/g, '').replace(/\s*!important$/i, '').trim()).filter(Boolean)
  if (!parts.length || SYSTEM_FIRST.test(parts[0])) return null
  const f = parts.find(p => !GENERIC.test(p))
  return f && f.length <= 60 && !ICON_FONT.test(f) ? f : null
}

/** The families a Google Fonts link loads ("…/css2?family=Open+Sans:wght@400;700&family=Lora", or the older "family=Open+Sans:400|Lora") */
export function googleFontFamilies(href: string): string[] {
  let url: URL
  try { url = new URL(href) } catch { return [] }
  if (!/(^|\.)fonts\.googleapis\.com$/i.test(url.hostname)) return []
  return url.searchParams.getAll('family').flatMap(v => v.split('|')).map(f => f.split(':')[0].replace(/\+/g, ' ').trim()).filter(Boolean)
}

// ── Colours ───────────────────────────────────────────────────────────────────

type Rgb = [number, number, number]
const hex = ([r, g, b]: Rgb) => `#${[r, g, b].map(x => Math.round(Math.min(255, Math.max(0, x))).toString(16).padStart(2, '0')).join('')}`
const lum = ([r, g, b]: Rgb) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const sat = ([r, g, b]: Rgb) => { const hi = Math.max(r, g, b), lo = Math.min(r, g, b); return hi === 0 ? 0 : (hi - lo) / hi }
export const colourDistance = (a: string, b: string) => { const x = rgbOf(a)!, y = rgbOf(b)!; return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) }
const rgbOf = (h: string): Rgb | null => (/^#[0-9a-f]{6}$/i.test(h) ? [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)] : null)

function hslToRgb(h: number, s: number, l: number): Rgb {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** The colours written in a CSS value (hex, rgb(), hsl(); see-through ones left out) */
export function coloursIn(value: string): Rgb[] {
  const out: Rgb[] = []
  for (const m of value.matchAll(/#([0-9a-f]{3,8})\b|rgba?\(([^)]*)\)|hsla?\(([^)]*)\)/gi)) {
    if (m[1]) {
      const h = m[1]
      if (![3, 4, 6, 8].includes(h.length)) continue
      const full = h.length <= 4 ? [...h].map(c => c + c).join('') : h
      if (full.length === 8 && parseInt(full.slice(6, 8), 16) < 128) continue
      out.push([parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)])
      continue
    }
    const nums = (m[2] ?? m[3]).split(/[\s,/]+/).filter(Boolean)
    const alpha = nums[3] !== undefined ? (nums[3].endsWith('%') ? parseFloat(nums[3]) / 100 : parseFloat(nums[3])) : 1
    if (!(alpha >= 0.5)) continue
    if (m[2]) {
      const c = nums.slice(0, 3).map(n => (n.endsWith('%') ? (parseFloat(n) / 100) * 255 : parseFloat(n)))
      if (c.length === 3 && c.every(x => isFinite(x))) out.push(c as Rgb)
    } else {
      const [h, s, l] = [parseFloat(nums[0]), parseFloat(nums[1]) / 100, parseFloat(nums[2]) / 100]
      if ([h, s, l].every(x => isFinite(x))) out.push(hslToRgb(((h % 360) + 360) % 360, s, l))
    }
  }
  return out
}

/** A colour that says something about a brand: not grey, not near-white, not near-black */
const telling = (c: Rgb) => sat(c) >= 0.3 && lum(c) <= 0.92 && lum(c) >= 0.08
/**
 * The stock colours of the usual site frameworks (Bootstrap 4 and 5, WordPress's preset palette):
 * a site built on one has them in its CSS without choosing them, so they say nothing about its brand
 */
const STOCK = new Set(['#007bff', '#0d6efd', '#6610f2', '#6f42c1', '#d63384', '#e83e8c', '#dc3545', '#fd7e14', '#ffc107', '#28a745', '#198754',
  '#20c997', '#17a2b8', '#0dcaf0', '#0069d9', '#0062cc', '#c82333', '#218838', '#e0a800', '#138496', '#0b5ed7', '#bb2d3b', '#157347', '#ffca2c',
  // (their hover, pressed and focus shades)
  '#005cbf', '#0056b3', '#004085', '#1e7e34', '#1c7430', '#bd2130', '#b21f2d', '#d39e00', '#c69500', '#117a8b', '#10707f', '#0a58ca', '#0a53be',
  '#b02a37', '#146c43', '#13653f', '#ffcd39', '#3dd5f3', '#31d2f2',
  '#cf2e2e', '#ff6900', '#fcb900', '#7bdcb5', '#00d084', '#8ed1fc', '#0693e3', '#9b51e0', '#f78da7'])
/** Variables of those frameworks (and of Tailwind's and WordPress's machinery): not the site's choice */
const STOCK_VAR = /^--(bs-|tw-|wp--preset|wp-admin|chakra-|mantine-|joy-|mui-)/
const isStock = (c: Rgb) => STOCK.has(hex(c))

// ── Reading the CSS ───────────────────────────────────────────────────────────

export interface SiteStyle {
  /** The nearest editor fonts to the site's own (null: none found, or only the system's) */
  heading: string | null
  body: string | null
  /** The site's brand colours, most telling first (up to 6, none alike) */
  colors: string[]
}

/**
 * Reads a site's fonts and colours from its CSS (`css`: inline styles and stylesheets, in page order)
 * and the families its Google Fonts links load. A heading font is one set on h1–h3 or a heading /
 * display variable; a body font one set on html, body or p, or a body / sans variable. A colour
 * counts for more when it's a brand / primary / accent variable or a button's background.
 */
export function readSiteStyle(css: string[], googleFamilies: string[] = []): SiteStyle {
  const heading = new Map<string, number>(), body = new Map<string, number>(), any = new Map<string, number>()
  // Variables first: most sites set fonts and colours through them (font-family: var(--brand-font)),
  // so a value is read with its variables put in (two levels deep)
  const vars = new Map<string, string>()
  for (const sheet of css) for (const m of sheet.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) if (!vars.has(m[1])) vars.set(m[1], m[2].trim())
  const resolve = (v: string, depth = 0): string => (depth > 2 ? v
    : v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (_, name, fallback) => resolve(vars.get(name) ?? fallback ?? '', depth + 1)))
  const colours: Array<{ c: Rgb; w: number }> = []
  const add = (m: Map<string, number>, name: string | null, w: number) => { if (name) m.set(name, (m.get(name) ?? 0) + w) }
  const loaded = new Set<string>()
  for (const f of googleFamilies) { add(any, f, 3); loaded.add(f.toLowerCase()) }

  for (const sheet of css) {
    const text = sheet.replace(/\/\*[\s\S]*?\*\//g, '')
    for (const block of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = block[1].trim(), decls = block[2]
      if (/@font-face/i.test(sel)) {
        const fam = /font-family\s*:\s*([^;]+)/i.exec(decls)?.[1]
        const name = fam ? firstFont(fam) : null
        if (name) { add(any, name, 1); loaded.add(name.toLowerCase()) }
        continue
      }
      const isHeading = /(^|[\s,>+~])h[1-3]\b|heading|headline|title|display|hero/i.test(sel)
      const isBody = /(^|[\s,])(html|body|:root|p)(\s*,|\s*$|[\s.:#[])/i.test(sel) || /^\s*(html|body)\s*$/i.test(sel)
      const isButton = /\b(btn|button|cta)\b|button|\[type=.?submit/i.test(sel)
      for (const d of decls.matchAll(/(^|;)\s*([-\w]+)\s*:\s*([^;]+)/g)) {
        const prop = d[2].toLowerCase(), value = resolve(d[3])
        // Fonts: on headings, on the body, in variables named for them
        if (prop === 'font-family' || (prop.startsWith('--') && /font|family|typeface/.test(prop) && !/size|weight|feature|smooth/.test(prop))) {
          if (CODE_PLACE.test(prop) || CODE_PLACE.test(sel)) continue
          const name = firstFont(value)
          if (!name) continue
          const w = loaded.has(name.toLowerCase()) ? 2 : 1
          if (prop.startsWith('--')) {
            if (/head|display|title|brand|accent/.test(prop)) add(heading, name, 3 * w)
            else if (/body|sans|base|text|default|primary|main/.test(prop)) add(body, name, 3 * w)
            else add(any, name, w)
          } else if (isHeading) add(heading, name, 2 * w)
          else if (isBody) add(body, name, 2 * w)
          else add(any, name, 0.5 * w)
          continue
        }
        // Colours
        const custom = prop.startsWith('--')
        const colourProp = custom || /^(color|background|background-color|border-color|border|fill|stroke|outline-color|accent-color)$/.test(prop)
        if (!colourProp) continue
        if (custom && STOCK_VAR.test(prop)) continue
        let w = 0.5
        if (custom && /brand|primary|accent|main|theme|highlight|cta/.test(prop) && !/text|fg|foreground|border|muted|gray|grey|neutral|bg-?subtle/.test(prop)) w = 6
        // (a design system's whole palette — --red-500, --color-teal-100 … — is many colours it may never use)
        else if (custom) w = 0.15
        else if (isButton && /background/.test(prop)) w = 4
        else if (/background/.test(prop)) w = 1.2
        else if (prop === 'color' && /\ba\b|link/i.test(sel)) w = 1.5
        for (const c of coloursIn(value)) if (telling(c) && !isStock(c)) colours.push({ c, w })
      }
    }
  }

  // Fonts: the strongest per kind, matched to an editor font (a heading falls back on the body's)
  const best = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => nearestFont(n)).find(Boolean) ?? null
  const bodyFont = best(body) ?? best(any)
  const headingFont = best(heading) ?? bodyFont

  // Colours: alike ones gathered (their weights summed), most telling first
  const groups: Array<{ c: Rgb; w: number }> = []
  for (const x of colours) {
    const g = groups.find(y => Math.hypot(x.c[0] - y.c[0], x.c[1] - y.c[1], x.c[2] - y.c[2]) < 42)
    if (g) g.w += x.w
    else groups.push({ c: x.c, w: x.w })
  }
  const ranked = groups.filter(g => g.w >= 2).sort((a, b) => b.w - a.w).slice(0, 6).map(g => hex(g.c))
  return { heading: headingFont, body: bodyFont, colors: ranked }
}

/**
 * The kit's colours from what was found: the logo's main colour and its accent first (they're the
 * brand's own), then the site's colours and its theme colour; `extra` the next ones, none alike
 */
export function mergePalette(logo: { main: string; accent: string | null } | null, site: string[], theme: string | null, maxExtra = 3): { main: string; accent: string | null; extra: string[] } | null {
  const chosen: string[] = []
  const far = (c: string) => chosen.every(x => colourDistance(x, c) >= 48)
  const take = (c: string | null | undefined) => { if (c && /^#[0-9a-f]{6}$/i.test(c) && far(c)) { chosen.push(c.toLowerCase()); return c.toLowerCase() } return null }
  const main = take(logo?.main) ?? take(site[0]) ?? take(theme)
  if (!main) return null
  // (a white or grey theme colour — the page's background — is no accent or extra colour)
  const themeTells = !!theme && !!rgbOf(theme) && telling(rgbOf(theme)!)
  let accent = take(logo?.accent)
  for (const c of site) { if (accent) break; accent = take(c) }
  if (!accent && themeTells) accent = take(theme)
  const extra: string[] = []
  for (const c of [...site, themeTells ? theme : null]) { const t = extra.length < maxExtra ? take(c) : null; if (t) extra.push(t) }
  return { main, accent: accent ?? null, extra }
}

// ── Logos ─────────────────────────────────────────────────────────────────────

type Sharp = (typeof import('sharp'))['default']
/** sharp (which Next ships) when it's there; null without it: logos then give no colours */
export async function loadSharp(): Promise<Sharp | null> {
  try { return (await import('sharp')).default } catch { return null }
}

/**
 * A logo's brand colours from its pixels (RGBA): `main` its most used colour that isn't near-white
 * (a logo's background or its dark letters), `accent` its most colourful one well apart from that
 */
export function logoColors(px: Uint8Array | Buffer, channels: number): { main: string; accent: string | null } | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  for (let i = 0; i + channels - 1 < px.length; i += channels) {
    if (channels === 4 && px[i + 3] < 160) continue
    const r = px[i], g = px[i + 1], b = px[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const k = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
    k.n++; k.r += r; k.g += g; k.b += b
    buckets.set(key, k)
  }
  const total = [...buckets.values()].reduce((s, k) => s + k.n, 0)
  if (!total) return null
  const colours = [...buckets.values()].map(k => ({ n: k.n, c: [k.r / k.n, k.g / k.n, k.b / k.n] as Rgb })).sort((a, b) => b.n - a.n)
  const apart = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
  const main = colours.find(x => lum(x.c) < 0.92 && x.n / total > 0.02) ?? colours[0]
  const accent = colours.filter(x => x !== main && x.n / total > 0.01 && apart(x.c, main.c) > 90 && sat(x.c) > 0.3 && lum(x.c) > 0.12)
    .sort((a, b) => sat(b.c) * Math.sqrt(b.n) - sat(a.c) * Math.sqrt(a.n))[0]
  return { main: hex(main.c), accent: accent ? hex(accent.c) : null }
}

/** An uploaded logo's brand colours (a PNG, JPG or WebP file); null when they can't be read */
export async function pictureColours(body: Buffer): Promise<{ main: string; accent: string | null } | null> {
  const sharp = await loadSharp()
  if (!sharp) return null
  try {
    const { data, info } = await sharp(body).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    return logoColors(data, info.channels)
  } catch { return null }
}
