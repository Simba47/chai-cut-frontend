import sql from '@/lib/db'
import type { SegmentLocal, BoxKeyframeLocal, CaptionStyle, TextOverlay, AudioTrack, Transition, Overlay } from '@chai-cut/shared'

interface CreateClipInput {
  video_id: string; start_ms?: number; end_ms?: number; layout?: string; title?: string
}

export async function createClip(userId: string, input: CreateClipInput) {
  const [video] = await sql`
    SELECT id, duration_ms, storage_path FROM videos WHERE id = ${input.video_id} AND user_id = ${userId}
  `
  if (!video) throw Object.assign(new Error('Video not found'), { status: 404 })

  const startMs = input.start_ms ?? 0
  const endMs = input.end_ms ?? (video.duration_ms ?? 5 * 60 * 1000)
  const layout = input.layout === 'horizontal' ? 'horizontal' : 'vertical'

  const [clip] = await sql`
    INSERT INTO clips (video_id, start_ms, end_ms, status, title)
    VALUES (${input.video_id}, ${startMs}, ${endMs}, 'draft', ${input.title ?? null})
    RETURNING id
  `
  if (!clip) throw Object.assign(new Error('Failed to create clip'), { status: 500 })

  if (video.storage_path) {
    const payload = { video_id: input.video_id, storage_path: video.storage_path, clip_id: clip.id, clip_start_ms: startMs, clip_end_ms: endMs }
    await sql`INSERT INTO jobs (type, status, payload) VALUES ('transcribe', 'queued', ${sql.json(payload)})`
  }

  return { clip_id: clip.id, layout }
}

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
  const [clip] = await sql`
    SELECT c.id, v.user_id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })

  const { segments, captionStyle, textOverlays, audioTracks, transitions, overlays } = body

  const ms = (v: number) => Math.round(v)

  // Re-index sort_order as 0,1,2… — the store uses fractional values (e.g. +0.5) to insert
  // between existing segments in-memory, but the DB column is INTEGER.
  const sortedSegments = [...segments].sort((a, b) => a.sort_order - b.sort_order)

  for (let si = 0; si < sortedSegments.length; si++) {
    const seg = sortedSegments[si]
    await sql`
      INSERT INTO segments (id, clip_id, start_ms, end_ms, layout, sort_order)
      VALUES (${seg.id}, ${clipId}, ${ms(seg.start_ms)}, ${ms(seg.end_ms)}, ${seg.layout}, ${si})
      ON CONFLICT (id) DO UPDATE SET start_ms = EXCLUDED.start_ms, end_ms = EXCLUDED.end_ms,
        layout = EXCLUDED.layout, sort_order = EXCLUDED.sort_order
    `
    for (const box of seg.crop_boxes) {
      await sql`
        INSERT INTO crop_boxes (id, segment_id, slot_index, source_video_id, source_offset_ms)
        VALUES (${box.id}, ${seg.id}, ${box.slot_index}, ${box.source_video_id ?? null}, ${ms(box.source_offset_ms ?? 0)})
        ON CONFLICT (id) DO UPDATE SET slot_index = EXCLUDED.slot_index,
          source_video_id = EXCLUDED.source_video_id, source_offset_ms = EXCLUDED.source_offset_ms
      `
      await sql`DELETE FROM box_keyframes WHERE box_id = ${box.id}`
      if (box.keyframes.length > 0) {
        await sql`
          INSERT INTO box_keyframes ${sql(box.keyframes.map((kf: BoxKeyframeLocal) => ({ box_id: box.id, t_ms: ms(kf.t_ms), x: kf.x, y: kf.y, w: kf.w, h: kf.h })))}
        `
      }
    }
  }

  if (segments.length > 0) {
    const segIds = segments.map(s => s.id)
    await sql`DELETE FROM segments WHERE clip_id = ${clipId} AND id != ALL(${segIds})`
  }

  if (Object.keys(captionStyle).length > 0) {
    const [existing] = await sql`SELECT id FROM caption_styles WHERE clip_id = ${clipId} LIMIT 1`
    const styleFields = ['font', 'size', 'color', 'position', 'position_y', 'animation', 'language', 'translated_from_language']
    if (existing?.id) {
      const entries = Object.entries(captionStyle).filter(([k, v]) => styleFields.includes(k) && v !== undefined)
      if (entries.length > 0) {
        const updates = Object.fromEntries(entries)
        await sql`UPDATE caption_styles SET ${sql(updates)} WHERE id = ${existing.id}`
      }
    } else {
      const { id: _id, clip_id: _clip_id, ...rest } = captionStyle as CaptionStyle
      await sql`INSERT INTO caption_styles ${sql({ clip_id: clipId, ...rest })}`
    }
  }

  await sql`DELETE FROM text_overlays WHERE clip_id = ${clipId}`
  if (textOverlays.length > 0) {
    await sql`INSERT INTO text_overlays ${sql(textOverlays.map(({ id, clip_id: _c, text, start_ms, end_ms, x, y, font, size, color }) => ({
      id, clip_id: clipId, text, start_ms: ms(start_ms), end_ms: ms(end_ms), x, y, font, size, color,
    })))}`
  }

  await sql`DELETE FROM audio_tracks WHERE clip_id = ${clipId}`
  if (audioTracks.length > 0) {
    await sql`INSERT INTO audio_tracks ${sql(audioTracks.map(({ id, clip_id: _c, storage_path, start_ms, volume, duck_under_speech }) => ({
      id, clip_id: clipId, storage_path, start_ms: ms(start_ms), volume, duck_under_speech,
    })))}`
  }

  await sql`DELETE FROM transitions WHERE clip_id = ${clipId}`
  if (transitions.length > 0) {
    await sql`INSERT INTO transitions ${sql(transitions.map(({ id, clip_id: _c, after_segment_id, type, duration_ms }) => ({
      id, clip_id: clipId, after_segment_id, type, duration_ms: ms(duration_ms),
    })))}`
  }

  await sql`DELETE FROM overlays WHERE clip_id = ${clipId}`
  if (overlays.length > 0) {
    await sql`INSERT INTO overlays ${sql(overlays.map(({ id, type, storage_path, source_video_id, source_offset_ms, x, y, w, h, start_ms, end_ms, z_index }) => ({
      id, clip_id: clipId, type, storage_path: storage_path ?? null,
      source_video_id: source_video_id ?? null, source_offset_ms: ms(source_offset_ms ?? 0),
      x, y, w, h, start_ms: ms(start_ms), end_ms: ms(end_ms), z_index,
    })))}`
  }
}

export async function reeditClip(userId: string, clipId: string) {
  const [clip] = await sql`
    SELECT c.id, v.user_id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  await sql`UPDATE clips SET status = 'draft', output_url = NULL WHERE id = ${clipId}`
}
