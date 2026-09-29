import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'
import { findClips, type FoundClip, type Subscores } from './clipFinder'
import { logSuggestionEvents, type SuggestionSource } from './suggestionEvents'

const BEST_MOMENTS_MODEL = 'claude-haiku-4-5-20251001'
const CLIP_SEARCH_MODEL = 'gemini-3.1-pro-preview'

/** 'shown' for each AI suggestion returned (plain fallback chunks are not AI picks) */
function logShown(userId: string, videoId: string, source: SuggestionSource, model: string, suggestions: ClipSuggestion[]) {
  logSuggestionEvents(suggestions.filter(s => typeof s.score === 'number').map(s => ({
    user_id: userId, video_id: videoId, source, event: 'shown' as const,
    suggestion: { start_ms: s.start_ms, end_ms: s.end_ms, title: s.title, score: s.score, subscores: s.subscores, reason: s.reason, model },
  })))
}

export async function listVideos(userId: string) {
  return sql`
    SELECT id, title, status, download_progress, duration_ms, created_at, storage_path, source_url, source_type,
      -- Why processing failed (e.g. a link that isn't shared publicly). Read through to_jsonb so
      -- this works before the worker has added the column.
      to_jsonb(videos)->>'error' AS error,
      (SELECT COUNT(*)::int FROM clips c WHERE c.video_id = videos.id) AS clip_count
    -- Stock clips saved for auto B-roll are the user's assets, not videos they uploaded
    FROM videos WHERE user_id = ${userId} AND role <> 'asset' ORDER BY created_at DESC
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
    const suggestions = await detectClipsWithClaude(words, durationMs, anthropicKey)
    logShown(userId, videoId, 'best_moments', BEST_MOMENTS_MODEL, suggestions)
    return { suggestions }
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

  const suggestions = await detectClipsByCriteria(words, durationMs, trimmedCriteria, geminiKey)
  logShown(userId, videoId, 'clip_search', CLIP_SEARCH_MODEL, suggestions)
  return { suggestions }
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
        model: BEST_MOMENTS_MODEL,
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
    const model = genAI.getGenerativeModel({ model: CLIP_SEARCH_MODEL, systemInstruction: system })
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

// ── "Make my clips": the worker's AI Edit job picks, frames and exports clips on its own ──

export const AUTO_CLIP_COUNTS = [3, 5, 10] as const

export async function createAutoClips(userId: string, videoId: string, clipCount = 5, addBroll = false) {
  const count = Math.round(Number(clipCount))
  if (!Number.isFinite(count) || count < 1 || count > 10) {
    throw Object.assign(new Error('Choose between 1 and 10 clips'), { status: 400 })
  }
  const [video] = await sql`
    SELECT id, status, storage_path FROM videos WHERE id = ${videoId} AND user_id = ${userId}
  `
  if (!video) throw Object.assign(new Error('Not found'), { status: 404 })
  if (video.status !== 'ready' || !video.storage_path) {
    throw Object.assign(new Error('This video is still processing. Try again once it is ready.'), { status: 409 })
  }

  const { checkClipQuota, getUserPlanConfig } = await import('./quota')
  await checkClipQuota(userId)
  const plan = await getUserPlanConfig(userId)
  if (plan.maxClips) {
    const [row] = await sql<{ count: string }[]>`
      SELECT COUNT(*) AS count FROM clips c JOIN videos v ON v.id = c.video_id WHERE v.user_id = ${userId}
    `
    const left = plan.maxClips - parseInt(row?.count ?? '0', 10)
    if (count > left) {
      throw Object.assign(
        new Error(`Your ${plan.name} plan allows ${plan.maxClips} clips and you have room for ${Math.max(0, left)} more. Choose fewer clips or upgrade.`),
        { status: 403 },
      )
    }
  }

  const [running] = await sql`
    SELECT id FROM ai_edit_jobs WHERE video_id = ${videoId} AND status IN ('queued', 'running') LIMIT 1
  `
  if (running) throw Object.assign(new Error('AI is already making clips for this video. Wait for it to finish.'), { status: 409 })

  const [aiJob] = await sql`
    INSERT INTO ai_edit_jobs (video_id, clip_count, status) VALUES (${videoId}, ${count}, 'queued') RETURNING id
  `
  const payload = { ai_edit_job_id: aiJob.id, video_id: videoId, clip_count: count, add_broll: addBroll }
  await sql`INSERT INTO jobs (type, payload, status) VALUES ('ai_edit', ${sql.json(payload)}, 'queued')`
  return { ai_edit_job_id: aiJob.id as string }
}

export interface AutoClip {
  id: string; title: string | null; start_ms: number; end_ms: number; status: string
  output_url: string | null; ai_score: number | null; ai_reason: string | null
  post_caption: string | null; hashtags: string[] | null
}

/** The video's latest AI Edit job (status, progress, error) and every clip AI Edit made from it, newest batch first */
export async function getAutoClips(userId: string, videoId: string) {
  const [video] = await sql`SELECT id FROM videos WHERE id = ${videoId} AND user_id = ${userId}`
  if (!video) throw Object.assign(new Error('Not found'), { status: 404 })

  // progress / ai_score / ai_reason are read through to_jsonb so this works before the worker adds them
  const [job] = await sql`
    SELECT id, status, error, clip_count, created_at, COALESCE((to_jsonb(j)->>'progress')::int, 0) AS progress
    FROM ai_edit_jobs j WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1
  `
  if (!job) return { job: null, clips: [] as AutoClip[] }

  const rows = await sql`
    SELECT id, title, start_ms, end_ms, status, output_storage_path,
      (to_jsonb(c)->>'ai_score')::int AS ai_score, to_jsonb(c)->>'ai_reason' AS ai_reason,
      to_jsonb(c)->>'post_caption' AS post_caption, to_jsonb(c)->'hashtags' AS hashtags
    FROM clips c JOIN ai_edit_jobs j ON j.id = c.ai_edit_job_id
    WHERE j.video_id = ${videoId}
    ORDER BY j.created_at DESC, (to_jsonb(c)->>'ai_score')::int DESC NULLS LAST
  `
  const clips: AutoClip[] = await Promise.all(rows.map(async r => ({
    id: r.id, title: r.title, start_ms: r.start_ms, end_ms: r.end_ms, status: r.status,
    ai_score: r.ai_score, ai_reason: r.ai_reason,
    post_caption: r.post_caption ?? null, hashtags: Array.isArray(r.hashtags) ? r.hashtags : null,
    output_url: r.status === 'done' && r.output_storage_path
      ? await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: r.output_storage_path }), { expiresIn: 43200 }).catch(() => null)
      : null,
  })))
  return {
    job: { id: job.id, status: job.status, progress: job.progress, error: job.error, clip_count: job.clip_count },
    clips,
  }
}
