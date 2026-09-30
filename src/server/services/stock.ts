import { createHash } from 'node:crypto'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'

/**
 * Stock video for B-roll in the editor: search, AI ideas for a clip, and adding a shot to the
 * user's assets. Pexels when PEXELS_API_KEY is set, otherwise Pixabay (PIXABAY_API_KEY). The same
 * video is saved once per user (videos.stock_ref, shared with the worker's auto B-roll).
 */

export interface StockItem {
  ref: string            // "pixabay:<id>" / "pexels:<id>"
  provider: 'pixabay' | 'pexels'
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

// Search results are kept 24 h (Pixabay's API terms ask for it; it also saves quota)
const cache = new Map<string, { at: number; items: StockItem[] }>()

export async function searchStock(query: string, page = 1): Promise<{ provider: string | null; items: StockItem[] }> {
  const q = query.trim().slice(0, 100)
  const provider = stockProvider()
  if (!q || !provider) return { provider, items: [] }
  const key = `${provider}|${q.toLowerCase()}|${page}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < 24 * 3600_000) return { provider, items: hit.items }
  const items = provider === 'pexels' ? await searchPexels(q, page) : await searchPixabay(q, page)
  cache.set(key, { at: Date.now(), items })
  return { provider, items }
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
  if (!/^(pixabay|pexels):\d+$/.test(item.ref)) throw Object.assign(new Error('Unknown stock video'), { status: 400 })
  let host = ''
  try { host = new URL(item.url).hostname } catch { /* invalid */ }
  if (!/(^|\.)(pixabay\.com|pexels\.com)$/.test(host)) throw Object.assign(new Error('Unknown stock video'), { status: 400 })

  const sign = (key: string) => getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: 43200 })
  const [existing] = await sql`SELECT id, title, storage_path FROM videos WHERE user_id = ${userId} AND stock_ref = ${item.ref} AND storage_path IS NOT NULL LIMIT 1`
  if (existing) return { video_id: existing.id as string, title: existing.title as string, url: await sign(existing.storage_path) }

  const res = await fetch(item.url)
  if (!res.ok) throw Object.assign(new Error('Could not download that video'), { status: 502 })
  const body = Buffer.from(await res.arrayBuffer())
  if (body.length > 80 * 1024 * 1024) throw Object.assign(new Error('That video is too large'), { status: 400 })
  const storagePath = `raw/${userId}/stock-${item.ref.replace(':', '-')}-${createHash('sha1').update(item.url).digest('hex').slice(0, 8)}.mp4`
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: storagePath, Body: body, ContentType: 'video/mp4' }))
  const provider = item.ref.startsWith('pixabay') ? 'Pixabay' : 'Pexels'
  const title = `${provider}: ${(item.title ?? 'stock video').slice(0, 100)}`
  const [row] = await sql`
    INSERT INTO videos (user_id, source_type, storage_path, status, title, role, stock_ref)
    VALUES (${userId}, 'upload', ${storagePath}, 'ready', ${title}, 'asset', ${item.ref})
    RETURNING id
  `
  return { video_id: row.id as string, title, url: await sign(storagePath) }
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
