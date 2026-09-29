import { DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'
import { findClips, type FoundClip, type Subscores } from './clipFinder'

export async function listVideos(userId: string) {
  return sql`
    SELECT id, title, status, download_progress, duration_ms, created_at, storage_path, source_url, source_type,
      -- Why processing failed (e.g. a link that isn't shared publicly). Read through to_jsonb so
      -- this works before the worker has added the column.
      to_jsonb(videos)->>'error' AS error,
      (SELECT COUNT(*)::int FROM clips c WHERE c.video_id = videos.id) AS clip_count
    FROM videos WHERE user_id = ${userId} ORDER BY created_at DESC
  `
}

export async function renameVideo(userId: string, videoId: string, title: string) {
  const trimmed = title.trim().slice(0, 120)
  if (!trimmed) throw Object.assign(new Error('Title cannot be empty'), { status: 400 })
  const [video] = await sql`
    UPDATE videos SET title = ${trimmed}
    WHERE id = ${videoId} AND user_id = ${userId}
    RETURNING id, title
  `
  if (!video) throw Object.assign(new Error('Not found'), { status: 404 })
  return { video }
}

export async function getVideo(userId: string, videoId: string) {
  const [video] = await sql`
    SELECT id, user_id, status, download_progress, duration_ms
    FROM videos WHERE id = ${videoId}
  `
  if (!video || video.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  return { video }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Most items one bulk delete may remove */
export const MAX_BULK_DELETE = 100

/** Distinct, well-formed ids from a request body (a malformed id would make Postgres error) */
export function cleanIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)))]
}

/** Remove files from R2, 1,000 keys per request (the S3 limit). Best effort: rows are what matter. */
export async function deleteR2Keys(keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    await r2.send(new DeleteObjectsCommand({
      Bucket: R2_BUCKET,
      Delete: { Objects: keys.slice(i, i + 1000).map(Key => ({ Key })), Quiet: true },
    })).catch(() => {})
  }
}

export async function deleteVideo(userId: string, videoId: string) {
  return deleteVideos(userId, [videoId])
}

/**
 * Delete several of the user's videos at once, with their clips and every stored file (the
 * upload, its cached audio and each clip's export). All or nothing: if any id isn't one of the
 * user's videos, nothing is deleted.
 */
export async function deleteVideos(userId: string, videoIds: string[]) {
  const ids = cleanIds(videoIds)
  if (ids.length === 0) throw Object.assign(new Error('No videos selected'), { status: 400 })
  if (ids.length > MAX_BULK_DELETE) throw Object.assign(new Error(`You can delete up to ${MAX_BULK_DELETE} videos at a time`), { status: 400 })

  const videos = await sql`SELECT id, storage_path FROM videos WHERE id = ANY(${ids}) AND user_id = ${userId}`
  if (videos.length !== ids.length) throw Object.assign(new Error('Not found'), { status: 404 })

  const keysToDelete: string[] = []
  for (const video of videos) {
    if (!video.storage_path) continue
    keysToDelete.push(video.storage_path)
    // FLAC audio cache created during transcription
    keysToDelete.push(video.storage_path.replace(/\.[^.]+$/, '_audio.flac'))
  }
  // Rendered output for every clip of these videos
  const clipOutputs = await sql`
    SELECT output_storage_path FROM clips
    WHERE video_id = ANY(${ids}) AND output_storage_path IS NOT NULL
  `
  for (const row of clipOutputs) keysToDelete.push(row.output_storage_path as string)

  await deleteR2Keys(keysToDelete)
  // Clips, formats, captions, overlays… go with their video (foreign keys cascade)
  await sql`DELETE FROM videos WHERE id = ANY(${ids}) AND user_id = ${userId}`
  return { deleted: ids.length }
}

export interface ClipSuggestion {
  id: string; title: string; start_ms: number; end_ms: number; summary: string
  /** Viral score 0–99 (AI suggestions only) */
  score?: number
  /** One line on why the clip should work */
  reason?: string
  subscores?: Subscores
}
type Word = { word: string; start_ms: number; end_ms: number }

export async function getVideoSuggestions(userId: string, videoId: string): Promise<{ suggestions: ClipSuggestion[] }> {
  const [video] = await sql`
    SELECT id, user_id, duration_ms, status FROM videos WHERE id = ${videoId}
  `
  if (!video || video.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }

  const [transcriptRow] = await sql`
    SELECT id FROM transcripts WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1
  `

  const words: Word[] = transcriptRow
    ? await sql`SELECT word, start_ms, end_ms FROM transcript_words WHERE transcript_id = ${transcriptRow.id} ORDER BY start_ms`
    : []

  const durationMs = video.duration_ms ?? 0
  if (words.length === 0) return { suggestions: makeTimeChunks(durationMs) }

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (!anthropicKey) return { suggestions: makeWordChunks(words, durationMs) }

  try {
    return { suggestions: await detectClipsWithClaude(words, durationMs, anthropicKey) }
  } catch (e) {
    console.error('[suggestions] Claude error:', e)
    return { suggestions: makeWordChunks(words, durationMs) }
  }
}

// Criteria-steered clip detection ("find me the funniest moments", "controversial takes", etc.) —
// same transcript source as getVideoSuggestions, but the caller picks what to look for.
export async function getVideoSuggestionsByCriteria(
  userId: string, videoId: string, criteria: string,
): Promise<{ suggestions: ClipSuggestion[] }> {
  const trimmedCriteria = criteria.trim().slice(0, 200)
  if (!trimmedCriteria) throw Object.assign(new Error('Tell the AI what to look for'), { status: 400 })

  const [video] = await sql`
    SELECT id, user_id, duration_ms, status FROM videos WHERE id = ${videoId}
  `
  if (!video || video.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }

  const [transcriptRow] = await sql`
    SELECT id FROM transcripts WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1
  `
  const words: Word[] = transcriptRow
    ? await sql`SELECT word, start_ms, end_ms FROM transcript_words WHERE transcript_id = ${transcriptRow.id} ORDER BY start_ms`
    : []

  const durationMs = video.duration_ms ?? 0
  if (words.length === 0) {
    throw Object.assign(new Error('This video has no transcript yet'), { status: 400 })
  }

  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw Object.assign(new Error('AI clip detection is not configured'), { status: 500 })

  return {
    suggestions: await detectClipsByCriteria(words, durationMs, trimmedCriteria, geminiKey),
  }
}

function toSuggestion(c: FoundClip, id: string): ClipSuggestion {
  return {
    id, title: c.title, start_ms: c.start_ms, end_ms: c.end_ms, summary: c.summary,
    score: c.score, reason: c.reason, subscores: c.subscores,
  }
}

// Best moments: Claude reads the whole transcript in ~10-minute windows (see clipFinder.ts)
async function detectClipsWithClaude(words: Word[], durationMs: number, apiKey: string): Promise<ClipSuggestion[]> {
  const ask = async (system: string, user: string) => {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) throw new Error(`Anthropic API ${res.status}`)
    const data = await res.json()
    return (data.content?.[0]?.text ?? '') as string
  }
  const clips = await findClips({
    words, durationMs, mode: { kind: 'best' }, ask,
    log: msg => console.error('[suggestions]', msg),
  })
  return clips.map((c, i) => toSuggestion(c, `ai-${i}`))
}

// Clip search: Gemini reads the whole transcript in windows and keeps only genuine matches.
// Clips end on a line the model chose, so the old +5 s end padding is no longer needed.
async function detectClipsByCriteria(
  words: Word[], durationMs: number, criteria: string, apiKey: string,
): Promise<ClipSuggestion[]> {
  const genAI = new GoogleGenerativeAI(apiKey)
  const ask = async (system: string, user: string) => {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-pro-preview', systemInstruction: system })
    const result = await model.generateContent(user)
    return result.response.text()
  }
  const clips = await findClips({
    words, durationMs, mode: { kind: 'search', criteria }, ask,
    log: msg => console.error('[ai-detect]', msg),
  })
  return clips.map((c, i) => toSuggestion(c, `ai-criteria-${i}`))
}

function makeWordChunks(words: Word[], durationMs: number): ClipSuggestion[] {
  const TARGET_MS = 60_000
  const suggestions: ClipSuggestion[] = []
  let chunkStart = 0, chunkWords: string[] = [], idx = 0
  for (const w of words) {
    if (chunkWords.length === 0) chunkStart = w.start_ms
    chunkWords.push(w.word)
    if (w.end_ms - chunkStart >= TARGET_MS) {
      suggestions.push({ id: `chunk-${idx++}`, title: chunkWords.slice(0, 6).join(' ').trim(), start_ms: chunkStart, end_ms: w.end_ms, summary: '' })
      chunkWords = []
    }
  }
  if (chunkWords.length > 0 && words.length > 0) {
    suggestions.push({ id: `chunk-${idx}`, title: chunkWords.slice(0, 6).join(' ').trim(), start_ms: chunkStart, end_ms: words[words.length - 1].end_ms || durationMs, summary: '' })
  }
  return suggestions
}

function makeTimeChunks(durationMs: number): ClipSuggestion[] {
  const chunkMs = 60_000
  return Array.from({ length: Math.max(1, Math.ceil(durationMs / chunkMs)) }, (_, i) => ({
    id: `time-${i}`, title: `Segment ${i + 1}`,
    start_ms: i * chunkMs, end_ms: Math.min((i + 1) * chunkMs, durationMs), summary: '',
  }))
}
