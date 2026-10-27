import sql from '@/lib/db'

// ── Silences of a clip (the editor's Cleanup tool) ─────────────────────────────
// The worker finds the clip's silent stretches from its sound (chai-cut-backend jobs/silence.ts, a
// detect_silence job) into clip_silences; Cleanup turns each into a card. Mirrors the camera angles
// (services/subjects.ts getAngles / scanAngles).

export interface SilencesState {
  /** none: never looked for; unavailable: the worker that finds them isn't deployed yet */
  status: 'none' | 'queued' | 'running' | 'done' | 'failed' | 'unavailable'
  error: string | null
  /** Silent stretches, source ms */
  ranges: Array<[number, number]>
  scan_start_ms: number | null
  scan_end_ms: number | null
}
const NONE: SilencesState = { status: 'none', error: null, ranges: [], scan_start_ms: null, scan_end_ms: null }
/** A scan not heard from for this long has stopped (the worker restarted): it can be started again */
const STUCK = '3 minutes'

async function ownClip(userId: string, clipId: string) {
  const [clip] = await sql<{ user_id: string; start_ms: number; end_ms: number }[]>`
    SELECT v.user_id, c.start_ms, c.end_ms FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  return clip
}

export async function getSilences(userId: string, clipId: string): Promise<SilencesState> {
  await ownClip(userId, clipId)
  try {
    const [row] = await sql<(Omit<SilencesState, 'ranges'> & { ranges: Array<[number, number]> | null; stuck: boolean; job_failed: string | null })[]>`
      SELECT status, error, ranges, scan_start_ms, scan_end_ms,
        status IN ('queued', 'running') AND updated_at < now() - ${STUCK}::interval AS stuck,
        -- (a worker from before this kind of job fails it without marking the row)
        (SELECT CASE WHEN j.status = 'failed' THEN coalesce(j.error, 'failed') END FROM jobs j
          WHERE j.type = 'detect_silence' AND j.payload->>'clip_id' = ${clipId} ORDER BY j.created_at DESC LIMIT 1) AS job_failed
      FROM clip_silences WHERE clip_id = ${clipId}
    `
    if (!row) return NONE
    const { stuck, job_failed, ranges, ...state } = row
    if ((job_failed && (state.status === 'queued' || state.status === 'running')) || stuck) {
      await sql`UPDATE clip_silences SET status = 'failed', updated_at = now() WHERE clip_id = ${clipId} AND status IN ('queued', 'running')`
      return { ...state, ranges: [], status: 'failed', error: 'Looking for silences stopped. Try again.' }
    }
    return { ...state, ranges: state.status === 'done' ? ranges ?? [] : [], error: state.status === 'failed' ? 'The silences could not be found this time. Try again.' : null }
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return { ...NONE, status: 'unavailable' }
    throw e
  }
}

/** Look for silences through [start_ms, end_ms] of the source video (the clip as it is in the editor) */
export async function scanSilences(userId: string, clipId: string, body: { start_ms?: unknown; end_ms?: unknown }): Promise<SilencesState> {
  const clip = await ownClip(userId, clipId)
  let start = Number(body.start_ms), end = Number(body.end_ms)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { start = clip.start_ms; end = clip.end_ms }
  start = Math.max(0, Math.round(start))
  end = Math.min(Math.round(end), start + 6 * 60_000)
  try {
    // One scan at a time: a row already waiting or being worked on is left alone
    const [queued] = await sql<{ clip_id: string }[]>`
      INSERT INTO clip_silences (clip_id, status) VALUES (${clipId}, 'queued')
      ON CONFLICT (clip_id) DO UPDATE SET status = 'queued', error = NULL, updated_at = now()
        WHERE clip_silences.status NOT IN ('queued', 'running') OR clip_silences.updated_at < now() - ${STUCK}::interval
      RETURNING clip_id
    `
    if (queued) await sql`INSERT INTO jobs (type, payload, status) VALUES ('detect_silence', ${sql.json({ clip_id: clipId, start_ms: start, end_ms: end, user_id: userId })}, 'queued')`
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return { ...NONE, status: 'unavailable' }
    throw e
  }
  return getSilences(userId, clipId)
}
