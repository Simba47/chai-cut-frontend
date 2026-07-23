import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { ClipPickerShell } from './ClipPickerShell'

export default async function VideoPickerPage({
  params,
}: {
  params: Promise<{ videoId: string }>
}) {
  const { videoId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const { data: video } = await admin
    .from('videos')
    .select('id, user_id, status, download_progress, duration_ms, created_at, storage_path')
    .eq('id', videoId)
    .single()

  if (!video || video.user_id !== user.id) notFound()

  let videoUrl = ''
  if (video.status === 'ready' && video.storage_path) {
    const { data: signed } = await admin.storage
      .from('raw-videos')
      .createSignedUrl(video.storage_path, 3600)
    videoUrl = signed?.signedUrl ?? ''
  }

  // Load existing clips with their first segment layout
  const { data: clipsRaw } = await admin
    .from('clips')
    .select('id, title, start_ms, end_ms, status, output_url, created_at, segments(layout)')
    .eq('video_id', videoId)
    .order('created_at', { ascending: true })

  type RawClip = {
    id: string
    title: string | null
    start_ms: number
    end_ms: number
    status: string
    output_url: string | null
    created_at: string
    segments: Array<{ layout: string }> | null
  }

  const savedClips = ((clipsRaw ?? []) as RawClip[]).map((c, idx) => ({
    id: c.id,
    title: c.title ?? null,
    start_ms: c.start_ms,
    end_ms: c.end_ms,
    status: c.status,
    output_url: c.output_url,
    created_at: c.created_at,
    layout: (c.segments ?? [])[0]?.layout ?? null,
    index: idx + 1,
  }))

  return (
    <ClipPickerShell
      video={video}
      videoUrl={videoUrl}
      userEmail={user.email ?? ''}
      savedClips={savedClips}
    />
  )
}
