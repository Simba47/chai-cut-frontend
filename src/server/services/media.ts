import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'
import { deleteR2Keys, deleteVideos, listVideos } from './videos'

/**
 * The editor's Media library: everything the user has imported — their videos (uploads and the
 * long videos they make clips from), photos and audio. Stock footage is not here (it is under
 * Library, searched for). Photos and audio are the files in storage under the user's own folders
 * (overlays/<user>/, audio/<user>/): uploaded once, they can be used in any clip.
 */
export interface MediaItem {
  kind: 'video' | 'image' | 'audio'
  /** A video's id; a photo's or a song's storage path */
  id: string
  name: string
  url: string | null
  duration_ms: number | null
  created_at: string
}

const sign = (key: string, hours = 6) => getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }), { expiresIn: hours * 3600 }).catch(() => null)

/** "<uuid>--<name>.<ext>" (since names are kept in the key) → "<name>.<ext>"; older files have no name */
export function nameFromKey(key: string, fallback: string): string {
  const file = key.split('/').pop() ?? ''
  const i = file.indexOf('--')
  return i > 0 ? file.slice(i + 2) : fallback
}

/** A file name made safe for a storage key (letters, digits, - _ . and spaces as -) */
export function safeName(name: string): string {
  return name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 80)
}

async function listFolder(prefix: string, kind: 'image' | 'audio'): Promise<MediaItem[]> {
  const out: MediaItem[] = []
  let token: string | undefined
  // At most a few hundred: the newest are what the user looks for
  for (let page = 0; page < 3; page++) {
    const res = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix, ContinuationToken: token, MaxKeys: 200 }))
    for (const o of res.Contents ?? []) {
      if (!o.Key || o.Key.endsWith('/')) continue
      out.push({
        kind, id: o.Key, name: nameFromKey(o.Key, kind === 'image' ? 'Photo' : 'Audio'), url: null, duration_ms: null,
        created_at: (o.LastModified ?? new Date(0)).toISOString(),
      })
    }
    if (!res.IsTruncated) break
    token = res.NextContinuationToken
  }
  return out
}

export async function listMedia(userId: string): Promise<MediaItem[]> {
  const [videos, images, audio] = await Promise.all([
    listVideos(userId, true),
    listFolder(`overlays/${userId}/`, 'image').catch(() => []),
    listFolder(`audio/${userId}/`, 'audio').catch(() => []),
  ])
  const vids: MediaItem[] = await Promise.all(videos
    // Stock footage is under Library; a video still downloading or that failed has nothing to show
    .filter(v => !(v.is_asset && !v.is_upload_asset) && v.status === 'ready' && v.storage_path)
    .map(async v => ({
      kind: 'video' as const, id: v.id as string, name: (v.title as string | null)?.trim() || 'Video',
      url: await sign(v.storage_path as string), duration_ms: v.duration_ms as number | null,
      created_at: new Date(v.created_at as string).toISOString(),
    })))
  const files = [...images, ...audio].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 300)
  await Promise.all(files.map(async f => { f.url = await sign(f.id) }))
  return [...vids, ...files]
}

// ── Deleting from the library ──

const busy = (what: string) => Object.assign(new Error(what), { status: 409 })

/**
 * Remove something from the user's Media library: its file and (a video) its row. Never something
 * a saved clip still uses: that clip would lose it. A video they make clips from, with clips,
 * is deleted from their videos page instead (that deletes the clips too).
 */
export async function deleteMedia(userId: string, kind: unknown, id: unknown): Promise<void> {
  if (typeof id !== 'string' || !id) throw Object.assign(new Error('What should be deleted?'), { status: 400 })
  if (kind === 'video') {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw Object.assign(new Error('Not found'), { status: 404 })
    const [v] = await sql`SELECT id, role, stock_ref, storage_path FROM videos WHERE id = ${id} AND user_id = ${userId}`
    if (!v || v.stock_ref) throw Object.assign(new Error('Not found'), { status: 404 })
    const [{ n: clips }] = await sql`SELECT count(*)::int AS n FROM clips WHERE video_id = ${id}`
    if (clips > 0) throw busy(`This video has ${clips} clip${clips === 1 ? '' : 's'}. Delete it from your videos page (its clips go with it)`)
    const [{ n: uses }] = await sql`
      SELECT count(DISTINCT clip_id)::int AS n FROM (
        SELECT s.clip_id FROM crop_boxes cb JOIN segments s ON s.id = cb.segment_id WHERE cb.source_video_id = ${id}
        UNION ALL SELECT o.clip_id FROM overlays o WHERE o.source_video_id = ${id}
        UNION ALL SELECT s.clip_id FROM segments s
          CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.frame->'items') = 'array' THEN s.frame->'items' ELSE '[]'::jsonb END) it
          WHERE it->>'kind' = 'video' AND it->>'source_video_id' = ${id}
      ) refs`
    if (uses > 0) throw busy(`Used in ${uses} clip${uses === 1 ? '' : 's'}. Take it out of ${uses === 1 ? 'that clip' : 'those clips'} first`)
    await deleteVideos(userId, [id])
    return
  }
  if (kind === 'image' || kind === 'audio') {
    const folder = kind === 'image' ? `overlays/${userId}/` : `audio/${userId}/`
    if (!id.startsWith(folder) || id.includes('..')) throw Object.assign(new Error('Not found'), { status: 404 })
    const [{ n: uses }] = kind === 'audio'
      ? await sql`SELECT count(DISTINCT clip_id)::int AS n FROM audio_tracks WHERE storage_path = ${id}`
      : await sql`
        SELECT count(DISTINCT clip_id)::int AS n FROM (
          SELECT o.clip_id FROM overlays o WHERE o.storage_path = ${id}
          UNION ALL SELECT s.clip_id FROM crop_boxes cb JOIN segments s ON s.id = cb.segment_id WHERE cb.image_path = ${id}
          UNION ALL SELECT s.clip_id FROM segments s
            CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(s.frame->'items') = 'array' THEN s.frame->'items' ELSE '[]'::jsonb END) it
            WHERE it->>'image_path' = ${id}
        ) refs`
    if (uses > 0) throw busy(`Used in ${uses} clip${uses === 1 ? '' : 's'}. Take it out of ${uses === 1 ? 'that clip' : 'those clips'} first`)
    await deleteR2Keys([id])
    return
  }
  throw Object.assign(new Error('What should be deleted?'), { status: 400 })
}
