import sql from '@/lib/db'
import { hasColumn } from './clips'

// ── Subjects: people marked in a clip and followed through it ─────────────────
// The editor's Subjects tool. The user marks a person (a click on them at a moment of the source
// video); "Track" queues a worker job (chai-cut-backend jobs/track_subjects.ts) that finds them 4×
// a second and saves where their face is (clip_subjects.path). The editor then lets the user frame
// any view on any subject, wherever they like — nothing is applied by itself.

export interface Subject {
  id: string
  label: string
  color: string
  /** Where it was marked: ms of the source video, and fractions of the frame */
  mark_ms: number; mark_x: number; mark_y: number
  status: 'new' | 'queued' | 'running' | 'done' | 'failed'
  error: string | null
  progress: number
  /** [[source ms, x, y, w, h], …] of their face, only where they were seen (fractions of the frame) */
  path: Array<[number, number, number, number, number, number?]> | null
  scan_start_ms: number | null
  scan_end_ms: number | null
  /** The camera cuts found while tracking (source ms); null before the worker saved them */
  cuts?: number[] | null
  /** When they are talking ([start, end] source ms, to the word); null before the worker saved them */
  speaking?: Array<[number, number]> | null
}

export const MAX_SUBJECTS = 6
const COLORS = ['#f472b6', '#38bdf8', '#facc15', '#a78bfa', '#fb923c', '#34d399']

/** The table comes with the worker that tracks subjects (its start-up adds it) */
function notReady(err: unknown): never {
  if ((err as { code?: string })?.code === '42P01') {
    throw Object.assign(new Error('Subject tracking needs the latest worker. It starts working once the backend is updated.'), { status: 503 })
  }
  throw err
}

async function ownClip(userId: string, clipId: string) {
  const [clip] = await sql<{ id: string; user_id: string; start_ms: number; end_ms: number }[]>`
    SELECT c.id, v.user_id, c.start_ms, c.end_ms FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  return clip
}

const BASE_COLUMNS = sql`id, label, color, mark_ms, mark_x, mark_y, status, error, progress, path, scan_start_ms, scan_end_ms`
const WITH_CUTS = sql`id, label, color, mark_ms, mark_x, mark_y, status, error, progress, path, scan_start_ms, scan_end_ms, cuts`
const WITH_ALL = sql`id, label, color, mark_ms, mark_x, mark_y, status, error, progress, path, scan_start_ms, scan_end_ms, cuts, speaking`
/** Which of the newer columns the table has (the worker adds them when it starts). A plain answer,
 *  not a fragment: a query fragment must never be awaited (awaiting one runs it) */
const pick = (x: 'all' | 'cuts' | 'none') => (x === 'all' ? WITH_ALL : x === 'cuts' ? WITH_CUTS : BASE_COLUMNS)
async function extras(): Promise<'all' | 'cuts' | 'none'> {
  if (await hasColumn('clip_subjects', 'speaking')) return 'all'
  return (await hasColumn('clip_subjects', 'cuts')) ? 'cuts' : 'none'
}

export async function listSubjects(userId: string, clipId: string): Promise<Subject[]> {
  await ownClip(userId, clipId)
  try {
    return await sql<Subject[]>`SELECT ${pick(await extras())} FROM clip_subjects WHERE clip_id = ${clipId} ORDER BY created_at`
  } catch (e) { return notReady(e) }
}

/** Mark a person: at `mark_ms` of the source video, where they were clicked (fractions of the frame) */
export async function addSubject(userId: string, clipId: string, body: { mark_ms?: unknown; x?: unknown; y?: unknown }): Promise<Subject> {
  await ownClip(userId, clipId)
  const t = Number(body.mark_ms), x = Number(body.x), y = Number(body.y)
  if (![t, x, y].every(Number.isFinite) || t < 0 || x < 0 || x > 1 || y < 0 || y > 1) {
    throw Object.assign(new Error('Click on the person in the video to mark them'), { status: 400 })
  }
  try {
    const existing = await sql<{ label: string; color: string }[]>`SELECT label, color FROM clip_subjects WHERE clip_id = ${clipId}`
    if (existing.length >= MAX_SUBJECTS) throw Object.assign(new Error(`Up to ${MAX_SUBJECTS} subjects per clip`), { status: 400 })
    // The first free letter and colour
    const labels = new Set(existing.map(s => s.label)), colors = new Set(existing.map(s => s.color))
    const label = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].find(l => !labels.has(l)) ?? `S${existing.length + 1}`
    const color = COLORS.find(c => !colors.has(c)) ?? COLORS[existing.length % COLORS.length]
    const [row] = await sql<Subject[]>`
      INSERT INTO clip_subjects (clip_id, label, color, mark_ms, mark_x, mark_y)
      VALUES (${clipId}, ${label}, ${color}, ${Math.round(t)}, ${x}, ${y})
      RETURNING ${pick(await extras())}
    `
    return row
  } catch (e) { return notReady(e) }
}

/** A new name for a subject (shown on the video and in the list) */
export async function renameSubject(userId: string, clipId: string, id: string, label: unknown): Promise<Subject> {
  await ownClip(userId, clipId)
  const name = String(label ?? '').trim().slice(0, 24)
  if (!name) throw Object.assign(new Error('Give the subject a name'), { status: 400 })
  try {
    const [row] = await sql<Subject[]>`UPDATE clip_subjects SET label = ${name} WHERE id = ${id} AND clip_id = ${clipId} RETURNING ${pick(await extras())}`
    if (!row) throw Object.assign(new Error('Subject not found'), { status: 404 })
    return row
  } catch (e) { return notReady(e) }
}

export async function deleteSubject(userId: string, clipId: string, id: string): Promise<void> {
  await ownClip(userId, clipId)
  try {
    await sql`DELETE FROM clip_subjects WHERE id = ${id} AND clip_id = ${clipId}`
  } catch (e) { return notReady(e) }
}

/** Remove everyone marked in the clip (the editor's Reset all). Nothing to remove before the table exists. */
export async function deleteAllSubjects(userId: string, clipId: string): Promise<void> {
  await ownClip(userId, clipId)
  try {
    await sql`DELETE FROM clip_subjects WHERE clip_id = ${clipId}`
  } catch (e) {
    if ((e as { code?: string })?.code === '42P01') return
    throw e
  }
}

/**
 * Follow the subjects through [start_ms, end_ms] of the source video (the clip as it is in the
 * editor). New and failed subjects are tracked; `all` tracks every one again (after the clip's
 * start or end moved).
 */
export async function trackSubjects(userId: string, clipId: string, body: { start_ms?: unknown; end_ms?: unknown; all?: unknown }): Promise<Subject[]> {
  const clip = await ownClip(userId, clipId)
  let start = Number(body.start_ms), end = Number(body.end_ms)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) { start = clip.start_ms; end = clip.end_ms }
  // Never longer than the longest clip the editor allows, with some room
  end = Math.min(end, start + 6 * 60_000)
  try {
    const queued = await sql<{ id: string }[]>`
      UPDATE clip_subjects SET status = 'queued', progress = 0, error = NULL
      WHERE clip_id = ${clipId} AND status NOT IN ('queued', 'running')
        AND (${body.all === true} OR status IN ('new', 'failed'))
      RETURNING id
    `
    if (queued.length) {
      // A job still waiting will take these too; one already running takes only its own
      const [waiting] = await sql`SELECT 1 FROM jobs WHERE type = 'track_subjects' AND status = 'queued' AND payload->>'clip_id' = ${clipId} LIMIT 1`
      if (!waiting) {
        await sql`INSERT INTO jobs (type, payload, status) VALUES ('track_subjects', ${sql.json({ clip_id: clipId, start_ms: Math.round(start), end_ms: Math.round(end) })}, 'queued')`
      }
    }
    return await sql<Subject[]>`SELECT ${pick(await extras())} FROM clip_subjects WHERE clip_id = ${clipId} ORDER BY created_at`
  } catch (e) {
    // An older database that doesn't allow this kind of job yet
    if ((e as { code?: string })?.code === '23514') {
      throw Object.assign(new Error('Subject tracking needs the latest worker. It starts working once the backend is updated.'), { status: 503 })
    }
    return notReady(e)
  }
}

// ── Sub-edit (the clip board's button) ─────────────────────────────────────────
// One press: the worker finds the people in the clip by itself, marks and tracks them, and frames
// the clip on whoever is talking — written into the clip (jobs/track_subjects.ts, payload auto).

export interface SubEditState {
  status: 'none' | 'queued' | 'processing' | 'done' | 'failed'
  error: string | null
  /** How long it has been going (ms), while it runs */
  elapsed_ms: number | null
  /** About how long it takes for this clip (ms) */
  estimate_ms: number
}

/**
 * About how long a Sub-edit of a clip this long takes: a first guess (fetching the video, reading
 * its faces 4× a second with their lips, following everyone), scaled by how the last Sub-edits
 * compared with that guess once there are a few to learn from.
 */
const guessMs = (clipMs: number) => 25_000 + 0.8 * clipMs
async function estimateMs(clipMs: number): Promise<number> {
  const past = await sql<{ took: number; len: number }[]>`
    SELECT EXTRACT(EPOCH FROM (updated_at - created_at)) * 1000 AS took,
      (payload->>'end_ms')::numeric - (payload->>'start_ms')::numeric AS len
    FROM jobs
    WHERE type = 'track_subjects' AND status = 'done' AND payload->>'auto' = 'true'
    ORDER BY updated_at DESC LIMIT 20
  `.catch(() => [])
  const ratios = past.map(p => Number(p.took) / guessMs(Number(p.len))).filter(r => isFinite(r) && r > 0.1 && r < 20).sort((a, b) => a - b)
  const scale = ratios.length >= 3 ? ratios[Math.floor(ratios.length / 2)] : 1
  return Math.round(guessMs(clipMs) * scale)
}

/** The latest Sub-edit of the clip, and how long one takes */
export async function subEditStatus(userId: string, clipId: string): Promise<SubEditState> {
  const clip = await ownClip(userId, clipId)
  const estimate_ms = await estimateMs(Number(clip.end_ms) - Number(clip.start_ms))
  const [job] = await sql<{ status: SubEditState['status']; error: string | null; elapsed: number }[]>`
    SELECT status, error, EXTRACT(EPOCH FROM (now() - created_at)) * 1000 AS elapsed FROM jobs
    WHERE type = 'track_subjects' AND payload->>'clip_id' = ${clipId} AND payload->>'auto' = 'true'
    ORDER BY created_at DESC LIMIT 1
  `.catch(() => [])
  if (!job) return { status: 'none', error: null, elapsed_ms: null, estimate_ms }
  // The worker's error is for the logs; the user gets the reason in plain words when there is one
  const error = job.status === 'failed' ? plainError(job.error) : null
  const running = job.status === 'queued' || job.status === 'processing'
  return { status: job.status, error, elapsed_ms: running ? Math.round(Number(job.elapsed)) : null, estimate_ms }
}

function plainError(e: string | null): string {
  if (e && /No people could be found|No one could be followed/.test(e)) return 'No people could be found in this clip.'
  return 'Sub-edit didn\u2019t work this time. Try again.'
}

/** Start a Sub-edit (or report the one already running) */
export async function startSubEdit(userId: string, clipId: string): Promise<SubEditState> {
  const clip = await ownClip(userId, clipId)
  const now = await subEditStatus(userId, clipId)
  if (now.status === 'queued' || now.status === 'processing') return now
  try {
    await sql`INSERT INTO jobs (type, payload, status) VALUES ('track_subjects', ${sql.json({ clip_id: clipId, start_ms: Number(clip.start_ms), end_ms: Number(clip.end_ms), auto: true })}, 'queued')`
  } catch (e) {
    // An older database that doesn't allow this kind of job yet
    if ((e as { code?: string })?.code === '23514') {
      throw Object.assign(new Error('Sub-edit needs the latest worker. It starts working once the backend is updated.'), { status: 503 })
    }
    throw e
  }
  return { status: 'queued', error: null, elapsed_ms: 0, estimate_ms: now.estimate_ms }
}
