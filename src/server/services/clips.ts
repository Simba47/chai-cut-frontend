import { createAdminClient } from '@/lib/supabase/server'
import type { SegmentLocal, BoxKeyframeLocal, CaptionStyle, TextOverlay, AudioTrack, Transition, Overlay } from '@chai-cut/shared'

// ── Create clip ────────────────────────────────────────────────────────────────

interface CreateClipInput {
  video_id: string
  start_ms?: number
  end_ms?: number
  layout?: string
  title?: string
}

export async function createClip(userId: string, input: CreateClipInput) {
  const admin = createAdminClient()

  const { data: video, error: videoErr } = await admin
    .from('videos')
    .select('id, duration_ms, storage_path')
    .eq('id', input.video_id)
    .eq('user_id', userId)
    .single()

  if (videoErr || !video) throw Object.assign(new Error('Video not found'), { status: 404 })

  const startMs = input.start_ms ?? 0
  const endMs = input.end_ms ?? (video.duration_ms ?? 5 * 60 * 1000)
  const layout = input.layout === 'horizontal' ? 'horizontal' : 'vertical'

  const { data: clip, error: clipErr } = await admin
    .from('clips')
    .insert({
      video_id: input.video_id,
      start_ms: startMs,
      end_ms: endMs,
      status: 'draft',
      ...(input.title ? { title: input.title } : {}),
    })
    .select()
    .single()

  if (clipErr || !clip) {
    console.error('[clips] insert error:', clipErr)
    throw Object.assign(new Error('Failed to create clip'), { status: 500 })
  }

  const storagePath = (video as unknown as { storage_path?: string }).storage_path ?? ''
  if (storagePath) {
    await admin.from('jobs').insert({
      type: 'transcribe',
      status: 'queued',
      payload: { video_id: input.video_id, storage_path: storagePath, clip_id: clip.id, clip_start_ms: startMs, clip_end_ms: endMs },
    })
  }

  return { clip_id: clip.id, layout }
}

// ── Save clip ─────────────────────────────────────────────────────────────────

interface SaveClipInput {
  segments: SegmentLocal[]
  captionStyle: Partial<CaptionStyle>
  textOverlays: TextOverlay[]
  audioTracks: AudioTrack[]
  transitions: Transition[]
  filters: { brightness: number; contrast: number; saturation: number }
  overlays: Omit<Overlay, 'created_at'>[]
}

export async function saveClip(userId: string, clipId: string, body: SaveClipInput) {
  const admin = createAdminClient()

  const { data: clip } = await admin
    .from('clips')
    .select('id, videos(user_id)')
    .eq('id', clipId)
    .single()

  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if ((clip as unknown as { videos: { user_id: string } }).videos?.user_id !== userId) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }

  const { segments, captionStyle, textOverlays, audioTracks, transitions, overlays } = body

  for (const seg of segments) {
    await admin.from('segments').upsert(
      { id: seg.id, clip_id: clipId, start_ms: seg.start_ms, end_ms: seg.end_ms, layout: seg.layout, sort_order: seg.sort_order },
      { onConflict: 'id' },
    )
    for (const box of seg.crop_boxes) {
      await admin.from('crop_boxes').upsert(
        { id: box.id, segment_id: seg.id, slot_index: box.slot_index, source_video_id: box.source_video_id ?? null, source_offset_ms: box.source_offset_ms ?? 0 },
        { onConflict: 'id' },
      )
      await admin.from('box_keyframes').delete().eq('box_id', box.id)
      if (box.keyframes.length > 0) {
        await admin.from('box_keyframes').insert(
          box.keyframes.map((kf: BoxKeyframeLocal) => ({ box_id: box.id, t_ms: kf.t_ms, x: kf.x, y: kf.y, w: kf.w, h: kf.h })),
        )
      }
    }
  }

  const segIds = segments.map(s => s.id)
  if (segIds.length > 0) {
    await admin.from('segments').delete().eq('clip_id', clipId).not('id', 'in', `(${segIds.map(id => `'${id}'`).join(',')})`)
  }

  if (Object.keys(captionStyle).length > 0) {
    const { data: existing } = await admin.from('caption_styles').select('id').eq('clip_id', clipId).limit(1)
    if (existing?.[0]?.id) {
      await admin.from('caption_styles').update({ ...captionStyle }).eq('id', existing[0].id)
    } else {
      await admin.from('caption_styles').insert({ clip_id: clipId, ...captionStyle })
    }
  }

  await admin.from('text_overlays').delete().eq('clip_id', clipId)
  if (textOverlays.length > 0) await admin.from('text_overlays').insert(textOverlays.map(o => ({ ...o, clip_id: clipId })))

  await admin.from('audio_tracks').delete().eq('clip_id', clipId)
  if (audioTracks.length > 0) await admin.from('audio_tracks').insert(audioTracks.map(t => ({ ...t, clip_id: clipId })))

  await admin.from('transitions').delete().eq('clip_id', clipId)
  if (transitions.length > 0) await admin.from('transitions').insert(transitions.map(t => ({ ...t, clip_id: clipId })))

  await admin.from('overlays').delete().eq('clip_id', clipId)
  if (overlays.length > 0) await admin.from('overlays').insert(overlays.map(o => ({ ...o, clip_id: clipId })))
}

// ── Re-edit clip ──────────────────────────────────────────────────────────────

export async function reeditClip(userId: string, clipId: string) {
  const admin = createAdminClient()

  const { data: clip } = await admin
    .from('clips')
    .select('id, videos(user_id)')
    .eq('id', clipId)
    .single()

  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if ((clip as unknown as { videos: { user_id: string } }).videos?.user_id !== userId) {
    throw Object.assign(new Error('Forbidden'), { status: 403 })
  }

  await admin.from('clips').update({ status: 'draft', output_url: null }).eq('id', clipId)
}
