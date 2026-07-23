import { createServiceClient } from '@/lib/supabase/server'
import type { TranscribeJobPayload } from '@chai-cut/shared'

export async function queueRetranscribe(userId: string, clipId: string, languageCode: string) {
  const supabase = await createServiceClient()

  const { data: clipRow } = await supabase
    .from('clips')
    .select('video_id, start_ms, end_ms, videos(storage_path, user_id)')
    .eq('id', clipId)
    .single() as {
      data: {
        video_id: string
        start_ms: number
        end_ms: number
        videos: { storage_path: string | null; user_id: string } | null
      } | null
    }

  const video = clipRow?.videos
  if (!video || video.user_id !== userId) {
    throw Object.assign(new Error('Not found'), { status: 404 })
  }
  if (!video.storage_path) {
    throw Object.assign(new Error('Video not yet uploaded'), { status: 400 })
  }

  let resolvedLang = languageCode
  if (!languageCode || languageCode === 'unknown') {
    const { data: existing } = await supabase
      .from('transcripts')
      .select('language')
      .eq('video_id', clipRow!.video_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing?.language) resolvedLang = existing.language
  }

  const payload: TranscribeJobPayload = {
    video_id: clipRow!.video_id,
    storage_path: video.storage_path,
    language_code: resolvedLang,
    is_retranscribe: true,
    clip_id: clipId,
    clip_start_ms: clipRow!.start_ms,
    clip_end_ms: clipRow!.end_ms,
  }

  await supabase.from('jobs').insert({ type: 'transcribe', payload, status: 'queued' })
}
