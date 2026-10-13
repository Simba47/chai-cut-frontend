import { createHash } from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GetObjectCommand, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'
import { safeName } from './media'

/**
 * Stock video for B-roll in the editor: search, AI ideas for a clip, and adding a shot to the
 * user's assets. Three libraries, each on when its key is set: Pixabay (PIXABAY_API_KEY), Pexels
 * (PEXELS_API_KEY) and Coverr (COVERR_API_KEY); the editor's B-roll stock switches between them
 * (default: Pexels, else Pixabay, else Coverr). The same video is saved once per user
 * (videos.stock_ref, shared with the worker's auto B-roll).
 */

export type StockSource = 'pixabay' | 'pexels' | 'coverr'

export interface StockItem {
  ref: string            // "pixabay:<id>" / "pexels:<id>" / "coverr:<id>"
  provider: StockSource
  title: string
  thumb: string          // still image
  preview: string        // small video for hover previews
  url: string            // the file added to the clip (smallest of at least 720p)
  width: number; height: number
  duration: number       // seconds
}

export function stockProvider(): 'pexels' | 'pixabay' | null {
  if (process.env.PEXELS_API_KEY) return 'pexels'
  if (process.env.PIXABAY_API_KEY) return 'pixabay'
  return null
}

/** The video libraries that can be searched (their keys are set), in the order they're offered */
export function stockSources(): StockSource[] {
  return [
    ...(process.env.PIXABAY_API_KEY ? ['pixabay' as const] : []),
    ...(process.env.PEXELS_API_KEY ? ['pexels' as const] : []),
    ...(process.env.COVERR_API_KEY ? ['coverr' as const] : []),
  ]
}

// Search results are kept 24 h (Pixabay's API terms ask for it; it also saves quota)
const cache = new Map<string, { at: number; items: StockItem[] }>()

/**
 * Stock videos for `query` from `source` (one of stockSources(); without one, the default library).
 * `sources`: every library that can be searched, for the editor's switch.
 */
export async function searchStock(query: string, page = 1, source?: string | null): Promise<{ provider: string | null; items: StockItem[]; sources: StockSource[] }> {
  const q = query.trim().slice(0, 100)
  const sources = stockSources()
  const provider: StockSource | null = sources.includes(source as StockSource) ? source as StockSource : (stockProvider() ?? sources[0] ?? null)
  if (!q || !provider) return { provider, items: [], sources }
  const key = `${provider}|${q.toLowerCase()}|${page}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 24 * 3600_000) return { provider, items: hit.items, sources }
  const items = provider === 'pexels' ? await searchPexels(q, page) : provider === 'coverr' ? await searchCoverr(q, page) : await searchPixabay(q, page)
  cache.set(key, { at: Date.now(), items })
  return { provider, items, sources }
}

// Coverr (api.coverr.co): key as a Bearer token; its file links are signed for that key. Every
// download of a video must be reported to Coverr (their API terms: they check partners for it).
const COVERR_API = 'https://api.coverr.co'
const coverrAuth = () => ({ Authorization: `Bearer ${process.env.COVERR_API_KEY}` })
let coverrStatsWarned = false

async function searchCoverr(q: string, page: number): Promise<StockItem[]> {
  const params = new URLSearchParams({ query: q, page: String(Math.max(0, page - 1)), page_size: '24', urls: 'true' })
  const res = await fetch(`${COVERR_API}/videos?${params}`, { headers: coverrAuth() })
  if (!res.ok) {
    // The demo key allows 50 searches an hour (for every user together)
    if (res.status === 429) throw Object.assign(new Error('Coverr\u2019s search limit is used up for now. Try again later, or use another library.'), { status: 429 })
    throw Object.assign(new Error('Stock search is not available right now'), { status: 502 })
  }
  const data = await res.json() as { hits?: Array<{ id: string; title?: string; poster?: string; thumbnail?: string; duration?: number | string; max_width?: number; max_height?: number; is_vertical?: boolean; urls?: { mp4?: string; mp4_preview?: string; mp4_download?: string } }> }
  return (data.hits ?? []).flatMap(v => {
    const url = v.urls?.mp4_download ?? v.urls?.mp4
    if (!v.id || !url) return []
    return [{
      ref: `coverr:${v.id}`, provider: 'coverr' as const, title: v.title?.trim() || 'Stock video',
      thumb: v.thumbnail ?? v.poster ?? '', preview: v.urls?.mp4_preview ?? v.urls?.mp4 ?? url, url,
      // The file is 1080p (max_width / max_height give the original, up to 4K): its shape at 1080p
      ...(() => { const w = v.max_width ?? (v.is_vertical ? 1080 : 1920), h = v.max_height ?? (v.is_vertical ? 1920 : 1080), k = Math.min(1, 1920 / Math.max(w, h)); return { width: Math.round(w * k), height: Math.round(h * k) } })(),
      duration: Math.round(Number(v.duration) || 0),
    }]
  })
}

type PixabayFile = { url: string; width: number; height: number; thumbnail?: string }
async function searchPixabay(q: string, page: number): Promise<StockItem[]> {
  const params = new URLSearchParams({ key: process.env.PIXABAY_API_KEY!, q, safesearch: 'true', per_page: '24', page: String(page) })
  const res = await fetch(`https://pixabay.com/api/videos/?${params}`)
  if (!res.ok) throw Object.assign(new Error('Stock search is not available right now'), { status: 502 })
  const data = await res.json() as { hits?: Array<{ id: number; tags: string; duration: number; isAiGenerated?: boolean; isLowQuality?: boolean; videos: Record<string, PixabayFile> }> }
  return (data.hits ?? []).flatMap(h => {
    if (h.isAiGenerated || h.isLowQuality) return []
    const files = Object.values(h.videos ?? {}).filter(f => f?.url)
    const big = files.filter(f => Math.min(f.width, f.height) >= 720).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    const small = [...files].sort((a, b) => a.width * a.height - b.width * b.height)[0]
    if (!big || !small) return []
    return [{
      ref: `pixabay:${h.id}`, provider: 'pixabay' as const, title: h.tags.split(',').slice(0, 3).join(', '),
      thumb: small.thumbnail ?? big.thumbnail ?? '', preview: small.url, url: big.url,
      width: big.width, height: big.height, duration: h.duration,
    }]
  })
}

type PexelsFile = { link: string; width: number; height: number; file_type?: string }
async function searchPexels(q: string, page: number): Promise<StockItem[]> {
  const res = await fetch(`https://api.pexels.com/videos/search?${new URLSearchParams({ query: q, per_page: '24', page: String(page) })}`, {
    headers: { Authorization: process.env.PEXELS_API_KEY! },
  })
  if (!res.ok) throw Object.assign(new Error('Stock search is not available right now'), { status: 502 })
  const data = await res.json() as { videos?: Array<{ id: number; url: string; image: string; duration: number; video_files: PexelsFile[] }> }
  return (data.videos ?? []).flatMap(v => {
    const files = (v.video_files ?? []).filter(f => (f.file_type ?? 'video/mp4') === 'video/mp4')
    const big = files.filter(f => Math.min(f.width, f.height) >= 720).sort((a, b) => a.width * a.height - b.width * b.height)[0]
    const small = [...files].sort((a, b) => a.width * a.height - b.width * b.height)[0]
    if (!big || !small) return []
    const title = v.url.split('/').filter(Boolean).pop()?.replace(/-\d+$/, '').replace(/-/g, ' ') ?? 'Stock video'
    return [{ ref: `pexels:${v.id}`, provider: 'pexels' as const, title, thumb: v.image, preview: small.link, url: big.link, width: big.width, height: big.height, duration: v.duration }]
  })
}

/**
 * The user's copy of a stock video (an 'asset' video the clip can show and the export can use),
 * made on first use. Only files from the stock libraries' own hosts are fetched.
 */
export async function importStock(userId: string, item: { ref: string; url: string; title?: string }) {
  if (!/^((pixabay|pexels):\d+|coverr:[A-Za-z0-9_-]{1,64})$/.test(item.ref)) throw Object.assign(new Error('Unknown stock video'), { status: 400 })
  let host = ''
  try { host = new URL(item.url).hostname } catch { /* invalid */ }
  if (!/(^|\.)(pixabay\.com|pexels\.com|coverr\.co)$/.test(host)) throw Object.assign(new Error('Unknown stock video'), { status: 400 })

  const sign = (key: string) => getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 43200 })
  const [existing] = await sql`SELECT id, title, storage_path FROM videos WHERE user_id = ${userId} AND stock_ref = ${item.ref} AND storage_path IS NOT NULL LIMIT 1`
  if (existing) return { video_id: existing.id as string, title: existing.title as string, url: await sign(existing.storage_path) }

  const res = await fetch(item.url)
  if (!res.ok) throw Object.assign(new Error('Could not download that video'), { status: 502 })
  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > 80 * 1024 * 1024) throw Object.assign(new Error('That video is too large'), { status: 400 })
  const storagePath = `raw/${userId}/stock-${item.ref.replace(':', '-')}-${createHash('sha1').update(item.url).digest('hex').slice(0, 8)}.mp4`
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: storagePath, Body: body, ContentType: 'video/mp4' }))
  // Coverr counts a download when its mp4_download link is fetched (the file above came from it:
  // their API terms make that a must). Their stats call is sent too; it answered 404 for the demo
  // key (2026-10-13), so a failure is only noted once.
  if (item.ref.startsWith('coverr:')) {
    await fetch(`${COVERR_API}/videos/${encodeURIComponent(item.ref.slice(7))}/stats/downloads`, { method: 'PATCH', headers: coverrAuth() })
      .then(r => { if (!r.ok && !coverrStatsWarned) { coverrStatsWarned = true; console.warn('[stock] Coverr stats call answered', r.status, '(the download itself is counted by Coverr)') } })
      .catch(() => {})
  }
  const provider = item.ref.startsWith('pixabay') ? 'Pixabay' : item.ref.startsWith('coverr') ? 'Coverr' : 'Pexels'
  const title = `${provider}: ${(item.title ?? 'stock video').slice(0, 100)}`
  const [row] = await sql`
    INSERT INTO videos (user_id, source_type, storage_path, status, title, role, stock_ref)
    VALUES (${userId}, 'upload', ${storagePath}, 'ready', ${title}, 'asset', ${item.ref})
    RETURNING id
  `
  return { video_id: row.id as string, title, url: await sign(storagePath) }
}

// ── Stock photos (Media ▸ Search photos) ──────────────────────────────────────
// The same libraries and keys as the videos: Pexels when PEXELS_API_KEY is set, otherwise Pixabay.
// Free to use in the user's videos (their licences); never a web image search, whose results come
// with no right to use them.

export interface StockPhoto {
  ref: string            // "pixabay:<id>" / "pexels:<id>"
  provider: 'pixabay' | 'pexels'
  title: string
  thumb: string          // small, for the grid
  url: string            // the picture added to the clip (about 1280 px on its long side)
  width: number; height: number
}

const photoCache = new Map<string, { at: number; items: StockPhoto[] }>()

export async function searchPhotos(query: string, page = 1): Promise<{ provider: string | null; items: StockPhoto[] }> {
  const q = query.trim().slice(0, 100)
  const provider = stockProvider()
  if (!q || !provider) return { provider, items: [] }
  const key = `${provider}|${q.toLowerCase()}|${page}`
  const hit = photoCache.get(key)
  if (hit && Date.now() - hit.at < 24 * 3600_000) return { provider, items: hit.items }
  const items = provider === 'pexels' ? await searchPexelsPhotos(q, page) : await searchPixabayPhotos(q, page)
  photoCache.set(key, { at: Date.now(), items })
  return { provider, items }
}

async function searchPixabayPhotos(q: string, page: number): Promise<StockPhoto[]> {
  const params = new URLSearchParams({ key: process.env.PIXABAY_API_KEY!, q, image_type: 'photo', safesearch: 'true', per_page: '30', page: String(page) })
  const res = await fetch(`https://pixabay.com/api/?${params}`)
  if (!res.ok) throw Object.assign(new Error('Photo search is not available right now'), { status: 502 })
  const data = await res.json() as { hits?: Array<{ id: number; tags: string; previewURL?: string; webformatURL?: string; largeImageURL?: string; imageWidth: number; imageHeight: number; isAiGenerated?: boolean }> }
  return (data.hits ?? []).flatMap(h => {
    if (h.isAiGenerated || !h.largeImageURL) return []
    // The large picture is at most 1280 px on its long side
    const k = Math.min(1, 1280 / Math.max(h.imageWidth, h.imageHeight))
    return [{
      ref: `pixabay:${h.id}`, provider: 'pixabay' as const, title: h.tags.split(',').slice(0, 3).map(t => t.trim()).join(', '),
      thumb: h.webformatURL ?? h.previewURL ?? h.largeImageURL, url: h.largeImageURL,
      width: Math.round(h.imageWidth * k), height: Math.round(h.imageHeight * k),
    }]
  })
}

async function searchPexelsPhotos(q: string, page: number): Promise<StockPhoto[]> {
  const res = await fetch(`https://api.pexels.com/v1/search?${new URLSearchParams({ query: q, per_page: '30', page: String(page) })}`, {
    headers: { Authorization: process.env.PEXELS_API_KEY! },
  })
  if (!res.ok) throw Object.assign(new Error('Photo search is not available right now'), { status: 502 })
  const data = await res.json() as { photos?: Array<{ id: number; alt?: string; width: number; height: number; src: { large?: string; large2x?: string; medium?: string } }> }
  return (data.photos ?? []).flatMap(p => {
    const url = p.src.large2x ?? p.src.large
    if (!url) return []
    const k = Math.min(1, 1880 / Math.max(p.width, p.height))
    return [{ ref: `pexels:${p.id}`, provider: 'pexels' as const, title: p.alt?.trim() || 'Stock photo', thumb: p.src.medium ?? url, url, width: Math.round(p.width * k), height: Math.round(p.height * k) }]
  })
}

/**
 * A stock photo saved to the user's photos (overlays/<user>/, where uploaded photos go: it then
 * shows under Media ▸ Import too), once per photo — the same photo again is the saved copy.
 * Only pictures from the stock libraries' own hosts are fetched (their terms: keep a copy, don't
 * link to theirs).
 */
export async function importPhoto(userId: string, item: { ref: string; url: string; title?: string }): Promise<{ storage_path: string; preview_url: string }> {
  if (!/^(pixabay|pexels):\d+$/.test(item.ref)) throw Object.assign(new Error('Unknown stock photo'), { status: 400 })
  let host = ''
  try { host = new URL(item.url).hostname } catch { /* invalid */ }
  if (!/(^|\.)(pixabay\.com|pexels\.com)$/.test(host)) throw Object.assign(new Error('Unknown stock photo'), { status: 400 })

  const provider = item.ref.startsWith('pixabay') ? 'Pixabay' : 'Pexels'
  const name = safeName(`${provider} ${(item.title ?? 'photo').split(',').slice(0, 3).join(' ')}`).slice(0, 60) || provider
  const storagePath = `overlays/${userId}/${item.ref.replace(':', '-')}--${name}.jpg`
  const sign = () => getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: storagePath }), { expiresIn: 60 * 60 })
  const saved = await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: storagePath })).then(() => true, () => false)
  if (saved) return { storage_path: storagePath, preview_url: await sign() }

  const res = await fetch(item.url)
  if (!res.ok) throw Object.assign(new Error('Could not download that photo'), { status: 502 })
  const type = res.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw Object.assign(new Error('That is not a photo'), { status: 400 })
  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > 15 * 1024 * 1024) throw Object.assign(new Error('That photo is too large'), { status: 400 })
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: storagePath, Body: body, ContentType: type }))
  return { storage_path: storagePath, preview_url: await sign() }
}

/** 4–6 short English stock-video searches that fit what is said in the clip (Gemini) */
export async function brollIdeas(userId: string, clipId: string): Promise<string[]> {
  const [clip] = await sql`
    SELECT c.start_ms, c.end_ms, c.video_id, v.user_id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return []
  const [t] = await sql`SELECT id FROM transcripts WHERE video_id = ${clip.video_id} ORDER BY created_at DESC LIMIT 1`
  if (!t) return []
  const words = await sql<{ word: string }[]>`
    SELECT word FROM transcript_words WHERE transcript_id = ${t.id} AND start_ms >= ${clip.start_ms} AND start_ms < ${clip.end_ms} ORDER BY start_ms`
  if (!words.length) return []
  const prompt = `This is what is said in a short video clip (any language, often Telugu, Hindi or Tamil mixed with English):
${words.map(w => w.word).join(' ').slice(0, 4000)}

Suggest 6 short English searches (2-3 words each) for stock B-roll footage that would fit things, places or actions talked about. Concrete and visual only (e.g. "cinema crowd", "city traffic night"); no real people or brands.
Return ONLY a JSON array of strings.`
  try {
    const out = (await new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: 'gemini-2.5-flash' }).generateContent(prompt)).response.text()
    const arr = JSON.parse(out.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as unknown[]
    return arr.filter((s): s is string => typeof s === 'string').map(s => s.trim().slice(0, 40)).filter(Boolean).slice(0, 6)
  } catch (e) {
    console.warn('[broll-ideas]', e instanceof Error ? e.message : e)
    return []
  }
}
