/**
 * Media ▸ Memes: Imgflip's meme templates (KLIPY and GIPHY are searched from the browser, as their
 * terms ask; Imgflip's key belongs to our account, so it stays here). Searching all 1M+ templates
 * needs Imgflip's paid API Premium; without it only the 100 most used templates can be had, so a
 * search then matches words in their names (user, 2026-10-30: trying Imgflip next to KLIPY and
 * GIPHY to see which gives the best results). Imgflip asks not to keep results for all users on
 * a server, so nothing is cached.
 */

export interface ImgflipTemplate { id: string; name: string; url: string; width: number; height: number }

type Raw = { id?: string; name?: string; url?: string; width?: number; height?: number }

const IMGFLIP = 'https://api.imgflip.com'
const clean = (list: Raw[] | undefined): ImgflipTemplate[] => (list ?? []).flatMap(m =>
  m.id && m.url ? [{ id: String(m.id), name: m.name ?? 'Meme', url: m.url, width: Number(m.width) || 0, height: Number(m.height) || 0 }] : [])

/** `premium`: searched all of Imgflip; false: only its top 100 templates (no words: all of them) */
export async function searchImgflip(query: string): Promise<{ items: ImgflipTemplate[]; premium: boolean }> {
  const q = query.trim().slice(0, 100)
  const key = process.env.IMGFLIP_API_KEY
  if (q && key) {
    const res = await fetch(`${IMGFLIP}/search_memes`, {
      method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: new URLSearchParams({ query: q }),
    }).catch(() => null)
    const data = await res?.json().catch(() => null) as { success?: boolean; data?: { memes?: Raw[] } } | null
    if (data?.success) return { items: clean(data.data?.memes), premium: true }
    // (no Premium: the top 100 below)
  }
  const res = await fetch(`${IMGFLIP}/get_memes`)
  if (!res.ok) throw Object.assign(new Error('Imgflip isn’t answering right now'), { status: 502 })
  const data = await res.json() as { success?: boolean; data?: { memes?: Raw[] } }
  const all = clean(data.data?.memes)
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  return { items: words.length ? all.filter(m => words.every(w => m.name.toLowerCase().includes(w))) : all, premium: false }
}
