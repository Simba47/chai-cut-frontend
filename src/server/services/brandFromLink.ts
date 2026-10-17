import dns from 'node:dns/promises'
import net from 'node:net'
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'

/**
 * A brand kit filled from a link (the Brand kit tool's "Fill from a link"): the page at a website or
 * profile link is read for the brand's name, @handle, logo and colours — no paid service. The logo is
 * copied into the user's brand folder like an uploaded one. Colours come from the page's theme colour
 * and the logo's own colours (read with sharp, which Next ships; without it only the theme colour).
 *
 * The link is the user's: the server fetches it only over http(s) on the usual ports, never to a
 * private or local address (checked again at every redirect), with time and size limits.
 */

const err = (message: string, status: number) => Object.assign(new Error(message), { status, expose: true })
const TIMEOUT_MS = 8000
const MAX_PAGE = 2 * 1024 * 1024
const MAX_IMAGE = 5 * 1024 * 1024
const UA = 'Mozilla/5.0 (compatible; ShortcutBrandKit/1.0; +https://shortcutapp.in)'

export interface LinkBrand {
  /** Where it was read from (the site's host) */
  source: string
  name: string | null
  handle: string | null
  logo: { path: string; url: string | null; ratio: number | null } | null
  colors: { main: string; accent: string | null } | null
}

/** An address the server must never fetch: loopback, private, link-local, carrier NAT, multicast, reserved */
export function privateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (net.isIPv4(v4)) {
    const [a, b] = v4.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b < 128) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
  }
  const v6 = ip.toLowerCase()
  return v6 === '::' || v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9')
    || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff')
}

/** The link as a URL the server may fetch, or an error for the user */
async function safeUrl(raw: string): Promise<URL> {
  let url: URL
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`) } catch { throw err('That doesn’t look like a link', 400) }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw err('Use a website or profile link (https://…)', 400)
  if (url.port && url.port !== '80' && url.port !== '443') throw err('That link can’t be read', 400)
  if (url.username || url.password) throw err('That link can’t be read', 400)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(host)) throw err('That link can’t be read', 400)
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map(a => a.address)
  if (!addrs.length) throw err('That website couldn’t be found', 400)
  if (addrs.some(privateAddress)) throw err('That link can’t be read', 400)
  return url
}

/** GET with every redirect checked again, a time limit, and at most `max` bytes read */
async function fetchSafe(raw: string, max: number, accept: string): Promise<{ body: Buffer; type: string; url: URL }> {
  let url = await safeUrl(raw)
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': UA, Accept: accept } })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await safeUrl(new URL(res.headers.get('location')!, url).toString())
      continue
    }
    if (!res.ok || !res.body) throw err(`The page answered ${res.status}`, 400)
    const chunks: Uint8Array[] = []
    let n = 0
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      n += value.length
      if (n > max) { await reader.cancel().catch(() => {}); break }
      chunks.push(value)
    }
    return { body: Buffer.concat(chunks), type: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), url }
  }
  throw err('That link redirects too many times', 400)
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '')
  return out
}

/** The page's tags that tell its brand, read without a full HTML parser */
export function readPage(html: string, base: URL) {
  const head = html.slice(0, 600_000)
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0]))
  const meta = (key: string) => metas.find(m => (m.property ?? m.name ?? '').toLowerCase() === key)?.content || null
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0]))
  const abs = (u: string | null | undefined) => { if (!u || u.startsWith('data:')) return null; try { return new URL(u, base).toString() } catch { return null } }
  const title = decode(/<title[^>]*>([^<]*)</i.exec(head)?.[1] ?? '')
  const siteName = meta('og:site_name') || meta('application-name') || (title ? title.split(/\s+[|–—·:-]\s+/)[0] : null)
  // A logo picture on the page (its file, alt, class or id says logo), then the site's icons, then the share picture
  const logoImgs = [...head.matchAll(/<img\b[^>]*>/gi)].map(m => attrs(m[0]))
    .filter(a => /logo/i.test(`${a.src ?? ''} ${a.alt ?? ''} ${a.class ?? ''} ${a.id ?? ''}`)).map(a => abs(a.src ?? a['data-src']))
  const size = (l: Record<string, string>) => Math.max(0, ...(l.sizes ?? '').split(/\s+/).map(s => parseInt(s, 10) || 0))
  const icons = links.filter(l => /(^|\s)(apple-touch-icon(-precomposed)?|icon|shortcut icon|mask-icon)(\s|$)/i.test(l.rel ?? ''))
    .sort((a, b) => (/apple/i.test(b.rel) ? 1 : 0) - (/apple/i.test(a.rel) ? 1 : 0) || size(b) - size(a)).map(l => abs(l.href))
  const social = /(^|\.)(instagram|youtube|x|twitter|tiktok|facebook|linkedin)\.com$/i.test(base.hostname)
  const share = abs(meta('og:image') || meta('twitter:image'))
  // On a profile page the share picture is the profile picture: the best logo there
  const logos = [...new Set((social ? [share, ...icons, ...logoImgs] : [...logoImgs, ...icons, share]).filter((u): u is string => !!u))]
  return { name: siteName ? siteName.slice(0, 40) : null, handle: handleOf(base, meta('twitter:site')), themeColor: hexColor(meta('theme-color')), logos }
}

/** The @handle: from a profile link's path, else the site's Twitter / X account */
function handleOf(url: URL, twitterSite: string | null): string | null {
  const host = url.hostname.replace(/^www\./, '').toLowerCase()
  const first = url.pathname.split('/').filter(Boolean)[0] ?? ''
  const clean = (h: string) => (h.replace(/^@+/, '').match(/^[A-Za-z0-9._]{1,30}$/) ? h.replace(/^@+/, '') : null)
  if (/^(instagram|x|twitter|tiktok|threads\.net)/.test(host) || host === 'threads.net') {
    if (first && !/^(p|reel|reels|explore|stories|share|i|home|intent)$/i.test(first)) return clean(first)
  }
  if (/^(youtube\.com|m\.youtube\.com)$/.test(host) && first.startsWith('@')) return clean(first)
  return twitterSite ? clean(twitterSite) : null
}

function hexColor(v: string | null): string | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(s)) return s
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`
  const m = /^rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s)
  return m ? `#${[m[1], m[2], m[3]].map(x => Math.min(255, +x).toString(16).padStart(2, '0')).join('')}` : null
}

type Sharp = (typeof import('sharp'))['default']
async function loadSharp(): Promise<Sharp | null> {
  try { return (await import('sharp')).default } catch { return null }
}

const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map(x => Math.round(x).toString(16).padStart(2, '0')).join('')}`
const lum = ([r, g, b]: number[]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
const sat = ([r, g, b]: number[]) => { const hi = Math.max(r, g, b), lo = Math.min(r, g, b); return hi === 0 ? 0 : (hi - lo) / hi }
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

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
  const colours = [...buckets.values()].map(k => ({ n: k.n, c: [k.r / k.n, k.g / k.n, k.b / k.n] })).sort((a, b) => b.n - a.n)
  const main = colours.find(x => lum(x.c) < 0.92 && x.n / total > 0.02) ?? colours[0]
  const accent = colours.filter(x => x !== main && x.n / total > 0.01 && dist(x.c, main.c) > 90 && sat(x.c) > 0.3 && lum(x.c) > 0.12)
    .sort((a, b) => sat(b.c) * Math.sqrt(b.n) - sat(a.c) * Math.sqrt(a.n))[0]
  return { main: toHex(main.c[0], main.c[1], main.c[2]), accent: accent ? toHex(accent.c[0], accent.c[1], accent.c[2]) : null }
}

/** Reads the link and copies its logo into the user's brand folder */
export async function brandFromLink(userId: string, link: unknown): Promise<LinkBrand> {
  if (typeof link !== 'string' || !link.trim() || link.length > 500) throw err('Paste a website or profile link', 400)
  const page = await fetchSafe(link.trim(), MAX_PAGE, 'text/html,application/xhtml+xml').catch(e => {
    throw e?.expose ? e : err('That page couldn’t be opened. Check the link, or fill the kit in by hand.', 400)
  })
  if (!/html|xml|text\/plain/.test(page.type) && page.type) throw err('That link isn’t a web page', 400)
  const info = readPage(page.body.toString('utf8'), page.url)
  const sharp = await loadSharp()
  let logo: LinkBrand['logo'] = null
  let fromLogo: { main: string; accent: string | null } | null = null
  for (const src of info.logos.slice(0, 6)) {
    const img = await fetchSafe(src, MAX_IMAGE, 'image/png,image/webp,image/svg+xml,image/jpeg,image/*').catch(() => null)
    if (!img || img.body.length < 100) continue
    const isSvg = img.type === 'image/svg+xml' || /^\s*(<\?xml[^>]*>\s*)?<svg/i.test(img.body.subarray(0, 300).toString('utf8'))
    let body = img.body, type = img.type, ratio: number | null = null
    if (sharp) {
      try {
        const pic = sharp(img.body, { density: isSvg ? 300 : undefined }).resize(1024, 1024, { fit: 'inside', withoutEnlargement: !isSvg })
        const out = await pic.png().toBuffer({ resolveWithObject: true })
        if (out.info.width < 32 || out.info.height < 16) continue
        body = out.data; type = 'image/png'; ratio = out.info.height / out.info.width
        const { data, info: px } = await sharp(out.data).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
        fromLogo = logoColors(data, px.channels)
      } catch { continue }
    } else if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) continue
    const ext = type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp'
    const path = `brand/${userId}/${crypto.randomUUID()}.${ext}`
    await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: path, Body: body, ContentType: type }))
    const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: path }), { expiresIn: 60 * 60 * 6 }).catch(() => null)
    logo = { path, url, ratio }
    break
  }
  const main = fromLogo?.main ?? info.themeColor
  const accent = fromLogo?.accent ?? (fromLogo && info.themeColor && info.themeColor !== fromLogo.main ? info.themeColor : null)
  return {
    source: page.url.hostname.replace(/^www\./, ''),
    name: info.name, handle: info.handle, logo,
    colors: main ? { main, accent } : null,
  }
}
