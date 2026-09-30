import sql from '@/lib/db'

/**
 * A log of what users do with AI suggestions (ai_suggestion_events, made by the backend), to
 * improve clip picking later. Logging never gets in the way: nothing here throws or is awaited
 * on the user's path, and a database without the table yet just logs nothing.
 */

export type SuggestionSource = 'best_moments' | 'clip_search' | 'auto_clips'
export type SuggestionEvent = 'shown' | 'previewed' | 'used' | 'exported' | 'deleted'
export interface SuggestionData {
  start_ms: number; end_ms: number; title?: string | null
  score?: number | null; subscores?: unknown; reason?: string | null; model?: string | null
}
interface EventRow {
  user_id: string; video_id: string; clip_id?: string | null
  source: SuggestionSource; suggestion: SuggestionData; event: SuggestionEvent
}

export function logSuggestionEvents(rows: EventRow[]) {
  if (!rows.length) return
  void sql`
    INSERT INTO ai_suggestion_events ${sql(rows.map(r => ({
      user_id: r.user_id, video_id: r.video_id, clip_id: r.clip_id ?? null,
      source: r.source, suggestion: sql.json(r.suggestion as never), event: r.event,
    })))}
  `.catch(e => console.warn('[suggestion-events] not logged:', e instanceof Error ? e.message : e))
}

/**
 * 'exported' / 'deleted' for clips that came from a suggestion: a clip made with "Use" (its
 * 'used' event says which suggestion), or a "Make my clips" clip (its AI score and reason).
 */
export function logClipEvents(userId: string, clipIds: string[], event: 'exported' | 'deleted') {
  if (!clipIds.length) return
  const run = async () => {
    const used = await sql`
      SELECT DISTINCT ON (clip_id) clip_id, video_id, source, suggestion
      FROM ai_suggestion_events WHERE clip_id = ANY(${clipIds}) AND event = 'used'
      ORDER BY clip_id, created_at DESC
    `
    const known = new Set(used.map(r => r.clip_id as string))
    const auto = await sql`
      SELECT id, video_id, start_ms, end_ms, title,
        (to_jsonb(c)->>'ai_score')::int AS score, to_jsonb(c)->>'ai_reason' AS reason
      FROM clips c WHERE id = ANY(${clipIds.filter(id => !known.has(id))}) AND ai_edit_job_id IS NOT NULL
    `
    logSuggestionEvents([
      ...used.map(r => ({ user_id: userId, video_id: r.video_id, clip_id: r.clip_id, source: r.source, suggestion: r.suggestion, event })),
      ...auto.map(c => ({
        user_id: userId, video_id: c.video_id, clip_id: c.id, source: 'auto_clips' as const, event,
        suggestion: { start_ms: c.start_ms, end_ms: c.end_ms, title: c.title, score: c.score, reason: c.reason, model: 'gemini-2.5-flash' },
      })),
    ])
  }
  // Deleting must read the clips before they go, so that one is awaited — but never throws
  return run().catch(e => console.warn('[suggestion-events] not logged:', e instanceof Error ? e.message : e))
}
