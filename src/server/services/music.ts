import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'

/** Music added in the editor: up to 20 MB; any audio file, or a video file (its sound is used) */
export const MAX_MUSIC_BYTES = 20 * 1024 * 1024
const MEDIA_EXT = /\.(mp3|m4a|m4b|aac|wav|wave|flac|ogg|oga|opus|wma|aif|aiff|aifc|amr|caf|mka|weba|webm|mp4|m4v|mov|mkv|avi|3gp|3g2|mpeg|mpg|mp2|ts|mts)$/i

const err = (message: string, status: number) => Object.assign(new Error(message), { status })

/** Refuses what can't be music: empty, over 20 MB, or neither audio nor video */
export function checkMusicFile(name: string, type: string, size: number) {
  if (!(size > 0)) throw err('That file is empty.', 400)
  if (size > MAX_MUSIC_BYTES) throw err('Music files can be up to 20 MB. Pick a smaller file or a shorter song.', 413)
  if (!/^(audio|video)\//.test(type) && !MEDIA_EXT.test(name)) throw err('Pick an audio file (or a video, to use its sound).', 415)
}

/** A playable link to a stored song (the editor's preview) */
export function musicUrl(storagePath: string) {
  return getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: storagePath }), { expiresIn: 6 * 60 * 60 })
}

/** Stores a song picked in the editor, so it survives a reload and is in the export */
export async function uploadMusic(userId: string, file: File) {
  checkMusicFile(file.name, file.type, file.size)
  const ext = (file.name.includes('.') ? file.name.split('.').pop()! : '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'audio'
  const storage_path = `audio/${userId}/${crypto.randomUUID()}.${ext}`
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: storage_path,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type || 'application/octet-stream',
  }))
  return { storage_path, url: await musicUrl(storage_path) }
}

/** Is this a stored song (not a detached original sound, not an old name-only entry)? */
export const isStoredMusic = (storagePath: string | null | undefined) =>
  !!storagePath && storagePath.startsWith('audio/') && !storagePath.includes('..')

/** Playable links for a clip's stored songs, by track id */
export async function musicUrls(tracks: Array<{ id: string; storage_path: string }>): Promise<Record<string, string>> {
  const entries = await Promise.all(tracks.filter(t => isStoredMusic(t.storage_path))
    .map(async t => [t.id, await musicUrl(t.storage_path).catch(() => '')] as const))
  return Object.fromEntries(entries.filter(([, u]) => u))
}
