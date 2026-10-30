import { PutObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET } from '@/lib/r2'
import { safeName } from './media'
import { musicUrl, MAX_MUSIC_BYTES } from './music'
import { CC_BY_SUFFIX, SOUND_LENGTH, type SoundItem, type SoundKind } from '@/modules/editor/soundCatalog'

/**
 * The sound library of the Music tool: live search on Freesound (FREESOUND_API_KEY) and adding a
 * sound to the user's own audio storage, exactly as an uploaded song is — so it plays after a
 * reload, shows in Media, and is in the export with nothing else to change.
 *
 * Only CC0 and CC BY sounds are offered (never the NonCommercial ones). A CC BY sound is added with
 * its author in the track's name and CC-BY at its end (the editor's "Copy credits" lists them).
 */

const API = 'https://freesound.org/apiv2'
const err = (message: string, status: number) => Object.assign(new Error(message), { status })

export const soundLibraryOn = () => !!process.env.FREESOUND_API_KEY

// CC0, and CC BY (not "Attribution NonCommercial", which is another licence name)
const LICENSES = 'license:("Creative Commons 0" OR "Attribution")'

/** Freesound's licence link → what we call it; anything else (NonCommercial, Sampling+) is refused */
function licenseOf(url: string | undefined): SoundItem['license'] | null {
  if (!url) return null
  if (/publicdomain\/zero/.test(url)) return 'cc0'
  if (/licenses\/by\/\d/.test(url)) return 'by'
  return null
}

interface FsSound {
  id: number; name: string; username: string; license: string; duration: number
  previews?: Record<string, string>
}

/** "whoosh_fast.wav" → "whoosh fast" */
const cleanName = (n: string) => n.replace(/\.(wav|mp3|ogg|flac|aif+|m4a)$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Sound'

function toItem(s: FsSound): SoundItem | null {
  const license = licenseOf(s.license)
  const preview = s.previews?.['preview-hq-mp3'] ?? s.previews?.['preview-lq-mp3']
  if (!license || !preview) return null
  return { id: s.id, name: cleanName(s.name), author: s.username, license, duration: Math.round(s.duration * 10) / 10, preview }
}

// Searches are kept 10 min: it saves Freesound's quota (about 60 calls a minute, 2000 a day for
// a free key, for every user together)
const cache = new Map<string, { at: number; items: SoundItem[]; more: boolean }>()
// A few calls a minute per person is plenty for typing and clicking chips
const calls = new Map<string, number[]>()
function allow(userId: string, what: 'search' | 'import', max: number) {
  const key = `${what}:${userId}`
  const now = Date.now()
  const recent = (calls.get(key) ?? []).filter(t => now - t < 60_000)
  if (recent.length >= max) throw err('Too many searches in a minute. Wait a moment and try again.', 429)
  recent.push(now)
  calls.set(key, recent)
}

export async function searchSounds(userId: string, kind: SoundKind, query: string, page = 1): Promise<{ items: SoundItem[]; more: boolean }> {
  const key = process.env.FREESOUND_API_KEY
  if (!key) throw err('The sound library is not set up yet.', 503)
  const q = query.trim().slice(0, 80)
  if (!q) return { items: [], more: false }
  const cacheKey = `${kind}|${q.toLowerCase()}|${page}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < 10 * 60_000) return { items: hit.items, more: hit.more }
  allow(userId, 'search', 30)
  const [lo, hi] = SOUND_LENGTH[kind]
  const params = new URLSearchParams({
    query: q,
    filter: `${LICENSES} duration:[${lo} TO ${hi}]`,
    fields: 'id,name,username,license,duration,previews',
    page_size: '15', page: String(Math.max(1, page)),
    // Music: the best liked first (the first page is the part worth listening to). Effects and meme
    // sounds: the closest match first — best liked put metro horns above air horns and a ghost
    // scream above "bruh" (tested 2026-10-30)
    sort: kind === 'music' ? 'rating_desc' : 'score',
    token: key,
  })
  const res = await fetch(`${API}/search/text/?${params}`)
  if (res.status === 429) throw err('The sound library is busy. Try again in a minute.', 429)
  if (!res.ok) throw err('The sound library is not available right now.', 502)
  const data = await res.json() as { results?: FsSound[]; next?: string | null }
  const items = (data.results ?? []).map(toItem).filter((i): i is SoundItem => !!i)
  const out = { at: Date.now(), items, more: !!data.next }
  cache.set(cacheKey, out)
  if (cache.size > 300) cache.delete(cache.keys().next().value as string)
  return { items, more: out.more }
}

/**
 * Adds a Freesound sound to the user's audio storage. The sound is looked up again (its licence is
 * checked on our side, not taken from the browser) and its preview mp3 is what is stored.
 */
export async function importSound(userId: string, id: number): Promise<{ storage_path: string; url: string; duration_ms: number; name: string }> {
  const key = process.env.FREESOUND_API_KEY
  if (!key) throw err('The sound library is not set up yet.', 503)
  if (!Number.isInteger(id) || id < 1) throw err('Unknown sound', 400)
  allow(userId, 'import', 30)
  const res = await fetch(`${API}/sounds/${id}/?${new URLSearchParams({ fields: 'id,name,username,license,duration,previews', token: key })}`)
  if (res.status === 404) throw err('That sound is gone.', 404)
  if (!res.ok) throw err('The sound library is not available right now.', 502)
  const item = toItem(await res.json() as FsSound)
  if (!item) throw err('That sound can’t be used here (its licence doesn’t allow it).', 400)
  let host = ''
  try { host = new URL(item.preview).hostname } catch { /* invalid */ }
  if (!/(^|\.)freesound\.org$/.test(host)) throw err('Unknown sound', 400)
  const file = await fetch(item.preview)
  if (!file.ok) throw err('Could not download that sound.', 502)
  const body = Buffer.from(await file.arrayBuffer())
  if (!body.length || body.length > MAX_MUSIC_BYTES) throw err('That sound is too large.', 400)
  // The author goes into the name of a CC BY sound; the name stays in the key (Media shows it)
  const label = item.license === 'by' ? `${item.name} by ${item.author} ${CC_BY_SUFFIX}` : item.name
  const storage_path = `audio/${userId}/${crypto.randomUUID()}--${safeName(label)}.mp3`
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: storage_path, Body: body, ContentType: 'audio/mpeg' }))
  return { storage_path, url: await musicUrl(storage_path), duration_ms: Math.round(item.duration * 1000), name: item.name }
}
