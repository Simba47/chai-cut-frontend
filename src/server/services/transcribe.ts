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
  await sql`INSERT INTO jobs (type, payload, status) VALUES ('transcribe', ${sql.json(payload)}, 'queued')`
}
