import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { EditorShell } from './EditorShell'

export default async function EditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ clipId: string }>
  searchParams: Promise<{ layout?: string }>
}) {
  const { clipId } = await params
  const { layout: layoutParam } = await searchParams
  const initialLayout = layoutParam === 'horizontal' ? 'horizontal' : 'vertical'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: clip } = await supabase
    .from('clips')
    .select('*, videos(storage_path, status, user_id)')
    .eq('id', clipId)
    .single()

  if (!clip) notFound()

  const video = (clip as unknown as { videos: { storage_path: string | null; status: string; user_id: string } | null }).videos
  if (!video || video.user_id !== user.id) notFound()

  // Get signed URL via admin client (storage has no user-level RLS policies yet)
  const admin = createAdminClient()
  const signedUrl = video.storage_path
    ? (await admin.storage.from('raw-videos').createSignedUrl(video.storage_path, 3600)).data?.signedUrl ?? ''
    : ''

  // Load transcript words for this video
  const { data: transcriptRow } = await supabase
    .from('transcripts')
    .select('id')
    .eq('video_id', (clip as unknown as { video_id: string }).video_id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const words = transcriptRow
    ? (await supabase
        .from('transcript_words')
        .select('*')
        .eq('transcript_id', transcriptRow.id)
        .order('start_ms')
      ).data ?? []
    : []

  // Load existing segments, crop_boxes, keyframes
  let { data: segments } = await supabase
    .from('segments')
    .select('*, crop_boxes(*, box_keyframes(*))')
    .eq('clip_id', clipId)
    .order('sort_order')

  // If no segments exist yet, create a default full-clip segment in the DB so that
  // the IDs are stable (generated server-side) and survive SSR→hydration without mismatch.
  if (!segments || segments.length === 0) {
    const { data: newSeg } = await admin
      .from('segments')
      .insert({
        clip_id: clipId,
        start_ms: 0,
        end_ms: (clip as unknown as { end_ms: number }).end_ms - (clip as unknown as { start_ms: number }).start_ms,
        layout: initialLayout,
        sort_order: 0,
      })
      .select()
      .single()

    if (newSeg) {
      const { data: newBox } = await admin
        .from('crop_boxes')
        .insert({ segment_id: newSeg.id, slot_index: 0 })
        .select()
        .single()

      segments = [{ ...newSeg, crop_boxes: newBox ? [{ ...newBox, box_keyframes: [] }] : [] }]
    }
  }

  const { data: captionStyles } = await supabase
    .from('caption_styles')
    .select('*')
    .eq('clip_id', clipId)

  const { data: textOverlays } = await supabase
    .from('text_overlays')
    .select('*')
    .eq('clip_id', clipId)

  const { data: audioTracks } = await supabase
    .from('audio_tracks')
    .select('*')
    .eq('clip_id', clipId)

  const { data: transitions } = await supabase
    .from('transitions')
    .select('*')
    .eq('clip_id', clipId)

  const { data: overlays } = await supabase
    .from('overlays')
    .select('*')
    .eq('clip_id', clipId)
    .order('z_index')

  return (
    <EditorShell
      clip={clip as Parameters<typeof EditorShell>[0]['clip']}
      videoUrl={signedUrl}
      words={words}
      initialSegments={segments ?? []}
      initialCaptionStyles={captionStyles ?? []}
      initialTextOverlays={textOverlays ?? []}
      initialAudioTracks={audioTracks ?? []}
      initialTransitions={transitions ?? []}
      initialOverlays={overlays ?? []}
    />
  )
}
