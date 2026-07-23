import { createAdminClient } from '@/lib/supabase/server'
import type { RenderJobPayload, RenderQuality } from '@chai-cut/shared'

export async function queueRender(userId: string, clipId: string, quality: RenderQuality = '1080p') {
  const admin = createAdminClient()

  const { data: clip } = await admin
    .from('clips')
    .select('id, status, videos(storage_path, user_id)')
    .eq('id', clipId)
    .single()

  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })

  const video = (clip as unknown as { videos: { storage_path: string; user_id: string } }).videos
  if (video.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  if (clip.status === 'rendering') throw Object.assign(new Error('Already rendering'), { status: 409 })
  if (!video.storage_path) throw Object.assign(new Error('Video not ready (no storage path)'), { status: 400 })

  await admin.from('clips').update({ status: 'rendering' }).eq('id', clipId)

  const payload: RenderJobPayload = { clip_id: clipId, video_storage_path: video.storage_path, quality }
  const { data: job, error: jobErr } = await admin
    .from('jobs')
    .insert({ type: 'render', payload, status: 'queued' })
    .select()
    .single()

  if (jobErr || !job) {
    await admin.from('clips').update({ status: 'draft' }).eq('id', clipId)
    console.error('[export] job insert error:', jobErr)
    throw Object.assign(new Error('Failed to queue render job'), { status: 500 })
  }

  return { job_id: job.id }
}
