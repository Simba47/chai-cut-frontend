import sql from '@/lib/db'
import type { SegmentLocal, BoxKeyframeLocal, CaptionStyle, TextOverlay, AudioTrack, Transition, Overlay, FrameSettings, FrameItem, CornerStyle } from '@chai-cut/shared'

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
  /** Remove pauses and filler words when exporting */
  removeFillers?: boolean
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
    frame: seg.frame ? sql.json(cleanFrame(seg.frame) as never) : null,
  }))
  const boxRows = sortedSegments.flatMap(seg => seg.crop_boxes.map(box => ({
    id: box.id, segment_id: seg.id, slot_index: box.slot_index,
    source_video_id: box.source_video_id ?? null, source_offset_ms: ms(box.source_offset_ms ?? 0),
    image_path: box.image_path ?? null,
    image_motion: box.image_motion && motions.includes(box.image_motion) ? box.image_motion : null,
    volume: Math.max(0, Math.min(1, Number(box.volume ?? 1))),
    muted: !!box.muted,
  })))
  const keyframeRows = sortedSegments.flatMap(seg => seg.crop_boxes.flatMap(box =>
    (box.keyframes ?? []).map((kf: BoxKeyframeLocal) => ({ box_id: box.id, t_ms: ms(kf.t_ms), x: kf.x, y: kf.y, w: kf.w, h: kf.h }))))
  const segIds = segRows.map(r => r.id)
  const boxIds = boxRows.map(r => r.id)
  // Other videos this clip shows (B-roll, frame lanes, video overlays): the renderer fetches them
  // by ID, so none may be another user's video. (A deleted video's ID is let through — the
  // renderer skips it — so a clip that still points at one can keep saving.)
  const videoIds = [...new Set([
    ...boxRows.map(r => r.source_video_id),
    ...sortedSegments.flatMap(seg => (seg.frame?.items ?? []).map(it => it?.kind === 'video' ? it.source_video_id : null)),
    ...overlays.map(o => o.source_video_id),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0))]

  // Segments and crop boxes are written by the IDs the client sends. None of them may belong to
  // another clip: the upserts below would change that clip's rows and the deletes would remove
  // its boxes and keyframes. New IDs (not in the database yet) are fine.
  if (segIds.length > 0 || boxIds.length > 0 || videoIds.length > 0) {
    const [foreign] = await sql`
      SELECT
        (SELECT count(*) FROM segments WHERE id = ANY(${segIds}) AND clip_id <> ${clipId})::int AS segments,
        (SELECT count(*) FROM crop_boxes cb JOIN segments s ON s.id = cb.segment_id
          WHERE cb.id = ANY(${boxIds}) AND s.clip_id <> ${clipId})::int AS boxes,
        (SELECT count(*) FROM videos WHERE id::text = ANY(${videoIds}) AND user_id <> ${userId})::int AS others_videos
    `
    if (foreign.segments > 0 || foreign.boxes > 0) {
      throw Object.assign(new Error('This save refers to formats of another clip'), { status: 400 })
    }
    if (foreign.others_videos > 0) {
      throw Object.assign(new Error('This save refers to a video that is not yours'), { status: 400 })
    }
  }

  const hasEnabledField = await captionEnabledField()
  const hasPresetFields = await captionPresetFields()
  const hasRemoveFillers = typeof body.removeFillers === 'boolean' && await clipsHasRemoveFillers()

  // Every statement is built up front and pipelined in one transaction: the database is far
  // from the server (~300–500 ms per round trip), and awaiting each statement made saves take
  // 10–20 s, long enough for the next auto-save to overlap and collide with this one.
  await sql.begin(tx => {
    const q = []

    if (segRows.length > 0) {
      q.push(tx`
        INSERT INTO segments ${tx(segRows)}
        ON CONFLICT (id) DO UPDATE SET start_ms = EXCLUDED.start_ms, end_ms = EXCLUDED.end_ms,
          layout = EXCLUDED.layout, sort_order = EXCLUDED.sort_order, frame = EXCLUDED.frame
        WHERE segments.clip_id = ${clipId}
      `)
      // Formats removed in the editor (cascades to their crop boxes and keyframes)
      q.push(tx`DELETE FROM segments WHERE clip_id = ${clipId} AND id != ALL(${segIds})`)
    }
    if (boxRows.length > 0) {
      q.push(tx`
        INSERT INTO crop_boxes ${tx(boxRows)}
        ON CONFLICT (id) DO UPDATE SET segment_id = EXCLUDED.segment_id, slot_index = EXCLUDED.slot_index,
          source_video_id = EXCLUDED.source_video_id, source_offset_ms = EXCLUDED.source_offset_ms,
          image_path = EXCLUDED.image_path, image_motion = EXCLUDED.image_motion,
          volume = EXCLUDED.volume, muted = EXCLUDED.muted
        WHERE crop_boxes.segment_id IN (SELECT id FROM segments WHERE clip_id = ${clipId})
      `)
      // Boxes left over from a layout with more slots (e.g. Split → Vertical)
      q.push(tx`DELETE FROM crop_boxes WHERE segment_id = ANY(${segIds}) AND id != ALL(${boxIds})`)
      q.push(tx`DELETE FROM box_keyframes WHERE box_id = ANY(${boxIds})`)
      if (keyframeRows.length > 0) q.push(tx`INSERT INTO box_keyframes ${tx(keyframeRows)}`)
    }

    // Captions on/off is saved on the caption style (enabled), so turning them off is remembered
    // and the style is kept. A database without that field yet (its backend hasn't added it)
    // keeps the old way: no style row means captions off.
    const captionEnabled = (captionStyle as Record<string, unknown>).enabled !== false
    if (!captionEnabled && !hasEnabledField) {
      q.push(tx`DELETE FROM caption_styles WHERE clip_id = ${clipId}`)
    } else if (Object.keys(captionStyle).length > 0) {
      const styleFields = ['font', 'size', 'color', 'position', 'position_y', 'animation', 'language', 'translated_from_language', 'timing_offset_ms',
        // Animated presets. Not emphasis: the export fills that in, and the editor's copy may be stale.
        ...(hasPresetFields ? PRESET_STYLE_FIELDS : [])]
      const onOff = hasEnabledField ? { enabled: captionEnabled } : {}
      const entries = Object.entries(captionStyle).filter(([k, v]) => styleFields.includes(k) && v !== undefined)
      const fields: Record<string, unknown> = Object.fromEntries(entries)
      // A database the backend hasn't updated yet only accepts the original animations
      if (!hasPresetFields && typeof fields.animation === 'string' && !['karaoke', 'fade', 'none'].includes(fields.animation)) {
        fields.animation = 'karaoke'
      }
      if (existingStyle?.id) {
        const set = { ...fields, ...onOff }
        if (Object.keys(set).length > 0) q.push(tx`UPDATE caption_styles SET ${tx(set)} WHERE id = ${existingStyle.id}`)
      } else {
        q.push(tx`INSERT INTO caption_styles ${tx({ clip_id: clipId, ...fields, ...onOff })}`)
      }
    }

    if (hasRemoveFillers) q.push(tx`UPDATE clips SET remove_fillers = ${body.removeFillers!} WHERE id = ${clipId}`)

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

/**
 * Delete several of the user's clips at once, with their exported files. All or nothing: if any
 * id isn't one of the user's clips, or a clip is still rendering (the worker would write its
 * export afterwards), nothing is deleted.
 */
export async function deleteClips(userId: string, clipIds: unknown) {
  const { cleanIds, deleteR2Keys, MAX_BULK_DELETE } = await import('./videos')
  const ids = cleanIds(clipIds)
  if (ids.length === 0) throw Object.assign(new Error('No clips selected'), { status: 400 })
  if (ids.length > MAX_BULK_DELETE) throw Object.assign(new Error(`You can delete up to ${MAX_BULK_DELETE} clips at a time`), { status: 400 })

  const clips = await sql`
    SELECT c.id, c.status, c.output_storage_path FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE c.id = ANY(${ids}) AND v.user_id = ${userId}
  `
  if (clips.length !== ids.length) throw Object.assign(new Error('Not found'), { status: 404 })
  const rendering = clips.filter(c => c.status === 'rendering').length
  if (rendering > 0) {
    throw Object.assign(new Error(rendering === 1
      ? 'One of these clips is still rendering. Wait for it to finish, then delete it.'
      : `${rendering} of these clips are still rendering. Wait for them to finish, then delete them.`), { status: 409 })
  }

  await deleteR2Keys(clips.map(c => c.output_storage_path as string | null).filter((k): k is string => !!k))
  // Formats, captions, overlays… go with their clip (foreign keys cascade)
  // Before the rows go (it reads them); it never throws
  const { logClipEvents } = await import('./suggestionEvents')
  await logClipEvents(userId, ids, 'deleted')
  await sql`DELETE FROM clips WHERE id = ANY(${ids})`
  return { deleted: ids.length }
}

export async function reeditClip(userId: string, clipId: string) {
  const [clip] = await sql`
    SELECT c.id, v.user_id FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  await sql`UPDATE clips SET status = 'draft', output_url = NULL WHERE id = ${clipId}`
}

const motions = ['none', 'zoom_in', 'zoom_out', 'pan_left', 'pan_right']
const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : undefined
// Corners slider 0–100 (0 = square, saved as nothing). 's'/'m'/'l' from the first version of the
// feature become their slider values, so clips saved then keep their corners.
// Whether caption_styles has its enabled field yet (the backend adds it when it starts). Once
// it's there it stays, so a yes is remembered; a no is checked again on the next save.
let enabledFieldKnown = false
async function captionEnabledField(): Promise<boolean> {
  if (enabledFieldKnown) return true
  const rows = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'caption_styles' AND column_name = 'enabled'`.catch(() => [])
  enabledFieldKnown = rows.length > 0
  return enabledFieldKnown
}

// clips.remove_fillers (added by the backend with "Remove pauses and filler words"): same rule
let removeFillersKnown = false
export async function clipsHasRemoveFillers(): Promise<boolean> {
  if (removeFillersKnown) return true
  const rows = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'clips' AND column_name = 'remove_fillers'`.catch(() => [])
  removeFillersKnown = rows.length > 0
  return removeFillersKnown
}

// Caption preset fields (added by the backend with the presets): same remember-a-yes rule
const PRESET_STYLE_FIELDS = ['highlight_color', 'words_per_line', 'uppercase', 'stroke_width']
let presetFieldsKnown = false
async function captionPresetFields(): Promise<boolean> {
  if (presetFieldsKnown) return true
  const rows = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'caption_styles' AND column_name = 'highlight_color'`.catch(() => [])
  presetFieldsKnown = rows.length > 0
  return presetFieldsKnown
}

const OLD_CORNERS: Record<string, number> = { s: 35, m: 60, l: 100 }
const corner = (v: unknown): CornerStyle | undefined => {
  const n = typeof v === 'string' ? OLD_CORNERS[v] : v
  return typeof n === 'number' && isFinite(n) && n > 0 ? Math.round(Math.min(100, n)) : undefined
}
// Per-slot settings keyed "0"–"2"; anything else is dropped
function slotMap<T>(m: unknown, pick: (v: unknown) => T | undefined): Record<string, T> | undefined {
  if (!m || typeof m !== 'object') return undefined
  const out: Record<string, T> = {}
  for (const [k, v] of Object.entries(m)) { const p = pick(v); if (/^[0-2]$/.test(k) && p !== undefined) out[k] = p }
  return out
}
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined

// Keep only what a frame needs from the client: known fields, sane values, and never the
// preview-only signed image URLs (they expire; the editor signs fresh ones on load)
function cleanFrame(frame: FrameSettings): FrameSettings {
  const items: FrameItem[] = (frame.items ?? []).slice(0, 300).flatMap((it): FrameItem[] => {
    if (!it || typeof it.id !== 'string' || !['video', 'photo', 'text'].includes(it.kind)) return []
    const lane = it.lane === 'band' ? 'band' as const : num(it.lane, 0, 2)
    const start = num(it.start_ms, 0, 1e9), end = num(it.end_ms, 0, 1e9)
    if (lane === undefined || start === undefined || end === undefined || end <= start) return []
    const base: FrameItem = { id: it.id.slice(0, 64), lane: lane === 'band' ? lane : Math.round(lane), kind: it.kind, start_ms: Math.round(start), end_ms: Math.round(end) }
    if (it.kind === 'video') {
      if (typeof it.source_video_id !== 'string') return []
      return [{ ...base, source_video_id: it.source_video_id, source_offset_ms: Math.round(num(it.source_offset_ms, 0, 1e9) ?? 0), volume: num(it.volume, 0, 1) ?? 1, muted: !!it.muted, corners: corner(it.corners) }]
    }
    if (it.kind === 'photo') {
      if (typeof it.image_path !== 'string') return []
      return [{ ...base, image_path: it.image_path, motion: it.motion && motions.includes(it.motion) ? it.motion : 'none', corners: corner(it.corners) }]
    }
    return [{
      ...base, text: typeof it.text === 'string' ? it.text.slice(0, 500) : '', captions: !!it.captions,
      bg: hex(it.bg), color: hex(it.color), size: num(it.size, 16, 200),
      x: num(it.x, 0, 1), y: num(it.y, 0, 1),
    }]
  })
  return {
    band: frame.band ? {
      text: '', bg: hex(frame.band.bg) ?? '#000000', color: hex(frame.band.color) ?? '#ffffff',
      size: num(frame.band.size, 16, 200) ?? 64, font: null,
    } : undefined,
    main_slots: Array.isArray(frame.main_slots) ? [...new Set(frame.main_slots.filter(i => Number.isInteger(i) && i >= 0 && i <= 2))] : undefined,
    main_volume: num(frame.main_volume, 0, 1),
    main_muted: frame.main_muted === undefined ? undefined : !!frame.main_muted,
    main_volumes: slotMap(frame.main_volumes, v => num(v, 0, 1)),
    main_mutes: slotMap(frame.main_mutes, v => typeof v === 'boolean' ? v : undefined),
    main_corners: frame.main_corners && typeof frame.main_corners === 'object'
      ? Object.fromEntries(Object.entries(frame.main_corners).filter(([k, v]) => /^[0-2]$/.test(k) && corner(v)).map(([k, v]) => [k, corner(v)!]))
      : undefined,
    items,
  }
}

/**
 * Writes the clip's hook, title, post caption and hashtags again (Gemini, src/lib/clipText.ts)
 * and saves them. The hook text overlay already on the clip is left as the user has it.
 */
export async function regenerateClipText(userId: string, clipId: string) {
  const [clip] = await sql`
    SELECT c.id, c.start_ms, c.end_ms, c.video_id, v.user_id, v.title AS video_title
    FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}
  `
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw Object.assign(new Error('AI text is not configured'), { status: 500 })

  const [transcript] = await sql`SELECT id FROM transcripts WHERE video_id = ${clip.video_id} ORDER BY created_at DESC LIMIT 1`
  const words = transcript
    ? await sql<{ word: string; start_ms: number; end_ms: number }[]>`
        SELECT word, start_ms, end_ms FROM transcript_words
        WHERE transcript_id = ${transcript.id} AND start_ms >= ${clip.start_ms} AND start_ms < ${clip.end_ms}
        ORDER BY start_ms`
    : []
  if (!words.length) throw Object.assign(new Error('This clip has no captions yet, so there is nothing to write from'), { status: 400 })

  const { generateClipText } = await import('@/lib/clipText')
  let text
  try {
    text = await generateClipText(words, clip.video_title ?? null, apiKey)
  } catch (e) {
    console.error('[ai-text] Gemini error:', e)
    throw Object.assign(new Error('AI could not write the text right now. Try again in a moment.'), { status: 502 })
  }
  const [hasColumns] = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'clips' AND column_name = 'post_caption'`
  if (!hasColumns) throw Object.assign(new Error('AI text needs the latest backend. Try again after it restarts.'), { status: 503 })
  await sql`
    UPDATE clips SET title = ${text.title}, hook_text = ${text.hook}, post_caption = ${text.post_caption}, hashtags = ${text.hashtags}
    WHERE id = ${clipId}
  `
  return text
}
