import sql from '@/lib/db'

// renderAfter: when set, the worker queues this render job once transcription finishes
export async function queueRetranscribe(userId: string, clipId: string, languageCode: string, renderAfter?: { clip_id: string; video_storage_path: string; quality: string; watermark: boolean }) {
  const [row] = await sql`
    SELECT c.video_id, c.start_ms, c.end_ms, v.storage_path, v.user_id
    FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE c.id = ${clipId}
  `
  if (!row || row.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  if (!row.storage_path) {
    throw Object.assign(new Error('Video not yet uploaded'), { status: 400 })
  }

  let resolvedLang = languageCode
  if (!languageCode || languageCode === 'unknown') {
    const [existing] = await sql`
      SELECT language FROM transcripts WHERE video_id = ${row.video_id}
      ORDER BY created_at DESC LIMIT 1
    `
    if (existing?.language) resolvedLang = existing.language
  }

  const payload = {
    video_id: row.video_id,
    storage_path: row.storage_path,
    language_code: resolvedLang,
    is_retranscribe: true,
    clip_id: clipId,
    clip_start_ms: row.start_ms,
    clip_end_ms: row.end_ms,
    ...(renderAfter ? { render_after: renderAfter } : {}),
  }
  const [job] = await sql`INSERT INTO jobs (type, payload, status) VALUES ('transcribe', ${sql.json(payload)}, 'queued') RETURNING id`
  return job?.id as string | undefined
}

/**
 * The whole video's transcript, for features that read all of it (Best moments, Ask AI). Captions
 * are never made automatically (they cost money), so the first time one of those features is
 * used, this starts it. 'ready' = the whole video has been read (or, for transcripts from before
 * that was recorded, words cover the video); 'running' = being made now. A reading that failed
 * is reported once, with its reason; asking again after that starts it again (the worker keeps
 * the parts it had read, so only the rest is sent).
 */
export async function ensureVideoTranscript(videoId: string): Promise<'ready' | 'running'> {
  const [video] = await sql`SELECT storage_path, duration_ms FROM videos WHERE id = ${videoId}`
  // (to_jsonb: a database whose worker hasn't added the field yet has no whole_video)
  const [whole] = await sql`
    SELECT 1 FROM transcripts t WHERE t.video_id = ${videoId} AND (to_jsonb(t)->>'whole_video')::boolean LIMIT 1`
  if (whole) return 'ready'
  const [{ minutes }] = await sql`
    SELECT COUNT(DISTINCT (tw.start_ms / 60000))::int AS minutes FROM transcript_words tw
    WHERE tw.transcript_id = (SELECT t.id FROM transcripts t WHERE t.video_id = ${videoId}
      AND EXISTS (SELECT 1 FROM transcript_words WHERE transcript_id = t.id) ORDER BY t.created_at DESC LIMIT 1)`
  const total = Math.max(1, Math.ceil((video?.duration_ms ?? 60000) / 60000))
  if (minutes / total >= 0.6) return 'ready'
  const [last] = await sql`
    SELECT id, status, error, payload->>'reported' AS reported FROM jobs
    WHERE type = 'transcribe' AND payload->>'video_id' = ${videoId} AND payload->>'transcribe_full' = 'true'
    ORDER BY created_at DESC LIMIT 1`
  if (last?.status === 'queued' || last?.status === 'processing') return 'running'
  if (last?.status === 'failed') {
    const reason = readingFailure(last.error)
    // A video with no sound will never have words: say so every time, never read it again
    const final = /has no sound/i.test(reason)
    if (final || !last.reported) {
      if (!final) await sql`UPDATE jobs SET payload = payload || '{"reported": true}'::jsonb WHERE id = ${last.id}`
      throw Object.assign(new Error(final ? reason : `Reading your video failed: ${reason} Try again to continue from where it stopped.`), { status: 400 })
    }
  }
  if (video?.storage_path) {
    const payload = { video_id: videoId, storage_path: video.storage_path, transcribe_full: true }
    await sql`INSERT INTO jobs (type, payload, status) VALUES ('transcribe', ${sql.json(payload)}, 'queued')`
  }
  return 'running'
}

/** Why a reading failed, in a sentence: the worker's own message, without a failed command's pages of output */
function readingFailure(error: string | null): string {
  const first = (error ?? '').split('\n')[0].trim()
  if (!first || /^Command failed/i.test(first)) return 'The video file could not be read.'
  const text = first.length > 240 ? `${first.slice(0, 240)}…` : first
  return /[.!?]$/.test(text) ? text : `${text}.`
}
