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
    if (res.status === 401 || res.status === 403 || res.status === 429) throw err('That site doesn’t let us read it — add your logo and colours below instead', 400)
    if (res.status === 404 || res.status === 410) throw err('That page isn’t there — check the link', 400)
    if (!res.ok || !res.body) throw err('That page couldn’t be opened. Check the link, or fill the kit in by hand.', 400)
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

const decode = (s: string) => s
  .replace(/&#x([0-9a-f]{1,6});/gi, (m, h) => { const n = parseInt(h, 16); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m })
  .replace(/&#(\d{1,7});/g, (m, d) => { const n = +d; return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m })
  .replace(/&quot;/g, '"').replace(/&apos;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim()
function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z_:][\w:.-]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) out[m[1].toLowerCase()] = decode(m[3] ?? m[4] ?? m[5] ?? '')
  return out
}

/** The page's tags that tell its brand, read without a full HTML parser */
export function readPage(html: string, base: URL) {
  // (the whole page as fetched, up to MAX_PAGE: a profile page can put its tags a megabyte in)
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => attrs(m[0]))
  const meta = (key: string) => metas.find(m => (m.property ?? m.name ?? '').toLowerCase() === key)?.content || null
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(m => attrs(m[0]))
  const abs = (u: string | null | undefined) => { if (!u || u.startsWith('data:')) return null; try { return new URL(u, base).toString() } catch { return null } }
  const title = decode(/<title[^>]*>([^<]*)</i.exec(html)?.[1] ?? '')
  const social = /(^|\.)(instagram|youtube|x|twitter|tiktok|facebook|linkedin|threads)\.(com|net)$/i.test(base.hostname)
  // On a profile page the brand is the profile ("Nike (@nike) • Instagram photos…", "MrBeast - YouTube"), not the site
  const profileName = (t: string | null) => t ? t.split(/\s+\(@|\s+[|•·–—-]\s+|\s+on\s+(Instagram|TikTok|X|Threads)\b/)[0].trim() || null : null
  const siteName = social
    ? profileName(meta('og:title') || meta('twitter:title') || title)
    : meta('og:site_name') || meta('application-name') || titleName(title)
  const share = abs(meta('og:image') || meta('twitter:image'))
  const size = (l: Record<string, string>) => Math.max(0, ...(l.sizes ?? '').split(/\s+/).map(s => parseInt(s, 10) || 0))
  // The site's own icons — always its brand mark: the big home-screen ones first, the 16-px tab icons last
  const icons = links.filter(l => /(^|\s)(apple-touch-icon(-precomposed)?|icon|shortcut icon|mask-icon|fluid-icon)(\s|$)/i.test(l.rel ?? ''))
    .sort((a, b) => rank(b) - rank(a) || size(b) - size(a)).map(l => abs(l.href))
  function rank(l: Record<string, string>) {
    if (/apple-touch/i.test(l.rel)) return 4
    if (/fluid-icon/i.test(l.rel) || size(l) >= 96) return 3
    if (/svg/i.test(l.type ?? '') || /\.svg(\?|$)/i.test(l.href ?? '') || /mask-icon/i.test(l.rel)) return 2
    return 1
  }
  // A logo picture on the page counts only when it is the site's own: in its header or top bar, or its
  // file named for the brand ("boAt_logo_black.svg"). A page's other logos — customers, partners,
  // events, products ("promo_logo_apple_watch") — are someone else's, and photos ("…forms the Stripe
  // logo", a .jpg, 2000 px wide) are no logo at all
  const domain = base.hostname.split('.').slice(0, -1).filter(l => l.length >= 3 && l !== 'www').pop() // (open.spotify.com: spotify)
  const brandKeys = [...new Set([siteName, domain]
    .map(k => (k ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')).filter(k => k.length >= 3))]
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  const logoImgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => attrs(m[0])).filter(a => {
    const src = a.src ?? a['data-src'] ?? '', file = decodeURIComponent(src.split(/[?#]/)[0].split('/').pop() ?? '')
    if (!/logo/i.test(`${file} ${a.alt ?? ''} ${a.class ?? ''} ${a.id ?? ''}`) || /\.jpe?g$/i.test(file) || (parseInt(a.width ?? '', 10) || 0) >= 1000) return false
    const ownPlace = /(^|[\s_-])(header|navbar|nav|site|brand|masthead|top)[\w-]*logo|logo[\w-]*(header|nav|site|brand|main|primary)/i.test(`${a.class ?? ''} ${a.id ?? ''}`)
    const ownFile = brandKeys.some(k => flat(file).startsWith(k) || flat(file).startsWith(`logo${k}`))
      || ((a.alt ?? '').length <= 40 && brandKeys.some(k => flat(a.alt ?? '').startsWith(k) && /logo/i.test(a.alt ?? '')))
    return ownPlace || ownFile
  }).map(a => abs(a.src ?? a['data-src']))
  // (a share picture that is the logo — open_graph_logo.png — is one too; any other is a banner)
  const shareLogo = share && /logo/i.test(share.split('/').pop() ?? '') ? share : null
  // On a profile page the share picture is the profile picture: the best logo there
  const logos = [...new Set((social ? [share, ...icons] : [...logoImgs, shareLogo, ...icons]).filter((u): u is string => !!u))]
  return { name: siteName ? siteName.slice(0, 40) : null, handle: handleOf(base, meta('twitter:site')), themeColor: hexColor(meta('theme-color')), logos }
}

/** A site's name from its page title — the shorter end: "Stripe | Financial…", "The AI workspace… | Notion" */
function titleName(title: string): string | null {
  // (a page standing in for the site — a redirect, a bot check — names nothing)
  if (/^(redirecting|just a moment|attention required|access denied|loading|please wait|403|404|error)\b/i.test(title)) return null
  const parts = title.split(/\s+[|–—·:-]\s+/).map(p => p.trim()).filter(Boolean)
  if (!parts.length) return null
  const first = parts[0], last = parts[parts.length - 1]
  return last.length < first.length ? last : first
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
  const open = (url: string) => fetchSafe(url, MAX_PAGE, 'text/html,application/xhtml+xml').catch(e => {
    throw e?.expose ? e : err('That page couldn’t be opened. Check the link, or fill the kit in by hand.', 400)
  })
  let page = await open(link.trim())
  // A page that only sends you on (<meta http-equiv="refresh" content="0; url=…">): the page it sends to
  const refresh = /<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/i.exec(page.body.subarray(0, 20_000).toString('utf8'))
  const next = refresh && /url\s*=\s*['"]?([^'">\s]+)/i.exec(attrs(refresh[0]).content ?? '')?.[1]
  if (next) page = await open(new URL(next, page.url).toString()).catch(() => page)
  if (!/html|xml|text\/plain/.test(page.type) && page.type) throw err('That link isn’t a web page', 400)
  const info = readPage(page.body.toString('utf8'), page.url)
  const sharp = await loadSharp()
  type Pick = { body: Buffer; type: string; ratio: number | null; colors: { main: string; accent: string | null } | null }
  let pick: Pick | null = null
  // (a 32-px tab icon blurs on a video: used only when the page has nothing bigger)
  let small: Pick | null = null
  for (const src of info.logos.slice(0, 8)) {
    const img = await fetchSafe(src, MAX_IMAGE, 'image/png,image/webp,image/svg+xml,image/jpeg,image/*').catch(() => null)
    if (!img || img.body.length < 100) continue
    const isSvg = img.type === 'image/svg+xml' || /^\s*(<\?xml[^>]*>\s*)?<svg/i.test(img.body.subarray(0, 300).toString('utf8'))
    if (!sharp) {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(img.type)) continue
      pick = { body: img.body, type: img.type, ratio: null, colors: null }
      break
    }
    try {
      const pic = sharp(img.body, { density: isSvg ? 300 : undefined }).resize(1024, 1024, { fit: 'inside', withoutEnlargement: !isSvg })
      const out = await pic.png().toBuffer({ resolveWithObject: true })
      const side = Math.max(out.info.width, out.info.height)
      if (side < 32 || out.info.height < 16) continue
      const { data, info: px } = await sharp(out.data).resize(48, 48, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const found: Pick = { body: out.data, type: 'image/png', ratio: out.info.height / out.info.width, colors: logoColors(data, px.channels) }
      if (side >= 64) { pick = found; break }
      small ??= found
    } catch { continue }
  }
  pick ??= small
  let logo: LinkBrand['logo'] = null
  if (pick) {
    const ext = pick.type === 'image/png' ? 'png' : pick.type === 'image/jpeg' ? 'jpg' : 'webp'
    const path = `brand/${userId}/${crypto.randomUUID()}.${ext}`
    // (the logo not stored: the name and colours still come back)
    const stored = await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: path, Body: pick.body, ContentType: pick.type })).then(() => true, () => false)
    if (stored) {
      const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: path }), { expiresIn: 60 * 60 * 6 }).catch(() => null)
      logo = { path, url, ratio: pick.ratio }
    }
  }
  const fromLogo = pick?.colors ?? null
  const main = fromLogo?.main ?? info.themeColor
  const accent = fromLogo?.accent ?? (fromLogo && info.themeColor && info.themeColor !== fromLogo.main ? info.themeColor : null)
  return {
    source: page.url.hostname.replace(/^www\./, ''),
    name: info.name, handle: info.handle, logo,
    colors: main ? { main, accent } : null,
  }
}
