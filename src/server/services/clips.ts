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

  const { checkClipQuota, getUserPlanConfig } = await import('./quota')
  await checkClipQuota(userId)

  const startMs = input.start_ms ?? 0
  const endMs = input.end_ms ?? (video.duration_ms ?? 5 * 60 * 1000)
  const layout = input.layout === 'vertical' ? 'vertical' : 'horizontal'

  const [clip] = await sql`
    INSERT INTO clips (video_id, start_ms, end_ms, status, title)
    VALUES (${input.video_id}, ${startMs}, ${endMs}, 'draft', ${input.title ?? null})
    RETURNING id
  `
  if (!clip) throw Object.assign(new Error('Failed to create clip'), { status: 500 })

  const plan = await getUserPlanConfig(userId)
  // The whole video is captioned in the background after upload. Skip the per-clip job
  // when that transcript is done, or still running on a video short enough (≤ 20 min)
  // that waiting for it is quicker than paying for a second transcription.
  const [fullJob] = await sql`
    SELECT status FROM jobs
    WHERE type = 'transcribe' AND payload->>'video_id' = ${input.video_id}
      AND payload->>'transcribe_full' = 'true' AND status <> 'failed'
    ORDER BY created_at DESC LIMIT 1
  `
  const coveredByFullTranscript = !!fullJob &&
    (fullJob.status === 'done' || (video.duration_ms ?? Infinity) <= 20 * 60 * 1000)
  if (video.storage_path && plan.autoCaption && !coveredByFullTranscript) {
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
  const { segments, captionStyle, textOverlays, audioTracks, transitions, overlays } = body
  const ms = (v: number) => Math.round(v)

  // Ownership check and the existing caption style in one round trip
  const [[clip], [existingStyle]] = await Promise.all([
    sql`SELECT c.id, v.user_id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}`,
    sql`SELECT id FROM caption_styles WHERE clip_id = ${clipId} LIMIT 1`,
  ])
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })

  // Re-index sort_order as 0,1,2… — the store uses fractional values (e.g. +0.5) to insert
  // between existing segments in-memory, but the DB column is INTEGER. Order by time: repeated
  // splits can give two segments the same fractional sort_order, and the renderer concatenates
  // segments in sort_order, so a tie could swap them in the export.
  const sortedSegments = [...segments].sort((a, b) => a.start_ms - b.start_ms || a.sort_order - b.sort_order)

  const segRows = sortedSegments.map((seg, si) => ({
    id: seg.id, clip_id: clipId, start_ms: ms(seg.start_ms), end_ms: ms(seg.end_ms), layout: seg.layout, sort_order: si,
  }))
  const boxRows = sortedSegments.flatMap(seg => seg.crop_boxes.map(box => ({
    id: box.id, segment_id: seg.id, slot_index: box.slot_index,
    source_video_id: box.source_video_id ?? null, source_offset_ms: ms(box.source_offset_ms ?? 0),
  })))
  const keyframeRows = sortedSegments.flatMap(seg => seg.crop_boxes.flatMap(box =>
    (box.keyframes ?? []).map((kf: BoxKeyframeLocal) => ({ box_id: box.id, t_ms: ms(kf.t_ms), x: kf.x, y: kf.y, w: kf.w, h: kf.h }))))
  const segIds = segRows.map(r => r.id)
  const boxIds = boxRows.map(r => r.id)

  // Every statement is built up front and pipelined in one transaction: the database is far
  // from the server (~300–500 ms per round trip), and awaiting each statement made saves take
  // 10–20 s, long enough for the next auto-save to overlap and collide with this one.
  await sql.begin(tx => {
    const q = []

    if (segRows.length > 0) {
      q.push(tx`
        INSERT INTO segments ${tx(segRows)}
        ON CONFLICT (id) DO UPDATE SET start_ms = EXCLUDED.start_ms, end_ms = EXCLUDED.end_ms,
          layout = EXCLUDED.layout, sort_order = EXCLUDED.sort_order
      `)
      // Formats removed in the editor (cascades to their crop boxes and keyframes)
      q.push(tx`DELETE FROM segments WHERE clip_id = ${clipId} AND id != ALL(${segIds})`)
    }
    if (boxRows.length > 0) {
      q.push(tx`
        INSERT INTO crop_boxes ${tx(boxRows)}
        ON CONFLICT (id) DO UPDATE SET segment_id = EXCLUDED.segment_id, slot_index = EXCLUDED.slot_index,
          source_video_id = EXCLUDED.source_video_id, source_offset_ms = EXCLUDED.source_offset_ms
      `)
      // Boxes left over from a layout with more slots (e.g. Split → Vertical)
      q.push(tx`DELETE FROM crop_boxes WHERE segment_id = ANY(${segIds}) AND id != ALL(${boxIds})`)
      q.push(tx`DELETE FROM box_keyframes WHERE box_id = ANY(${boxIds})`)
      if (keyframeRows.length > 0) q.push(tx`INSERT INTO box_keyframes ${tx(keyframeRows)}`)
    }

    const captionEnabled = (captionStyle as Record<string, unknown>).enabled !== false
    if (!captionEnabled) {
      q.push(tx`DELETE FROM caption_styles WHERE clip_id = ${clipId}`)
    } else if (Object.keys(captionStyle).length > 0) {
      const styleFields = ['font', 'size', 'color', 'position', 'position_y', 'animation', 'language', 'translated_from_language', 'timing_offset_ms']
      if (existingStyle?.id) {
        const entries = Object.entries(captionStyle).filter(([k, v]) => styleFields.includes(k) && v !== undefined)
        if (entries.length > 0) q.push(tx`UPDATE caption_styles SET ${tx(Object.fromEntries(entries))} WHERE id = ${existingStyle.id}`)
      } else {
        const { id: _id, clip_id: _clip_id, enabled: _en, ...rest } = captionStyle as CaptionStyle & { enabled?: boolean }
        q.push(tx`INSERT INTO caption_styles ${tx({ clip_id: clipId, ...rest })}`)
      }
    }

    q.push(tx`DELETE FROM text_overlays WHERE clip_id = ${clipId}`)
    if (textOverlays.length > 0) {
      q.push(tx`INSERT INTO text_overlays ${tx(textOverlays.map(({ id, text, start_ms, end_ms, x, y, font, size, color }) => ({
        id, clip_id: clipId, text, start_ms: ms(start_ms), end_ms: ms(end_ms), x, y, font, size, color,
      })))}`)
    }

    q.push(tx`DELETE FROM audio_tracks WHERE clip_id = ${clipId}`)
    if (audioTracks.length > 0) {
      q.push(tx`INSERT INTO audio_tracks ${tx(audioTracks.map(({ id, storage_path, start_ms, volume, duck_under_speech }) => ({
        id, clip_id: clipId, storage_path, start_ms: ms(start_ms), volume, duck_under_speech,
      })))}`)
    }

    q.push(tx`DELETE FROM transitions WHERE clip_id = ${clipId}`)
    // A transition can only point at a format that still exists
    const liveTransitions = transitions.filter(t => segIds.includes(t.after_segment_id))
    if (liveTransitions.length > 0) {
      q.push(tx`INSERT INTO transitions ${tx(liveTransitions.map(({ id, after_segment_id, type, duration_ms }) => ({
        id, clip_id: clipId, after_segment_id, type, duration_ms: ms(duration_ms),
      })))}`)
    }

    q.push(tx`DELETE FROM overlays WHERE clip_id = ${clipId}`)
    if (overlays.length > 0) {
      q.push(tx`INSERT INTO overlays ${tx(overlays.map(({ id, type, storage_path, source_video_id, source_offset_ms, x, y, w, h, start_ms, end_ms, z_index }) => ({
        id, clip_id: clipId, type, storage_path: storage_path ?? null,
        source_video_id: source_video_id ?? null, source_offset_ms: ms(source_offset_ms ?? 0),
        x, y, w, h, start_ms: ms(start_ms), end_ms: ms(end_ms), z_index,
      })))}`)
    }

    return q
  })
}

export async function reeditClip(userId: string, clipId: string) {
  const [clip] = await sql`
    SELECT c.id, v.user_id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  await sql`UPDATE clips SET status = 'draft', output_url = NULL WHERE id = ${clipId}`
}
