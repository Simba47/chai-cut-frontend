import sql from '@/lib/db'
import { cleanTrims, trimMap, MAX_CLIP_MS, MIN_CLIP_MS } from '@/lib/trims'
import type { SegmentLocal, BoxKeyframeLocal, CaptionStyle, TextOverlay, AudioTrack, Transition, Overlay, FrameSettings, FrameItem, CornerStyle } from '@chai-cut/shared'

interface CreateClipInput {
  video_id: string; start_ms?: number; end_ms?: number; layout?: string; title?: string
}

export async function createClip(userId: string, input: CreateClipInput) {
  const [video] = await sql`
    SELECT id, duration_ms, storage_path FROM videos WHERE id = ${input.video_id} AND user_id = ${userId}
  `
  if (!video) throw Object.assign(new Error('Video not found'), { status: 404 })

  const { checkClipQuota } = await import('./quota')
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

  // No captions yet: they cost money, so the clip opens with captions off and they're made when
  // switched on in the editor (for this clip only)

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
  /** The clip's own sound (top of the Music panel) */
  originalSound?: { volume: number; muted: boolean }
  /**
   * Parts of the video removed from the clip: [[start, end], …] in ms of the source video
   * (lib/trims.ts). Left out by an editor that doesn't know about them: what's saved stays.
   */
  trims?: unknown
  /** The clip's start and end in its video, when dragged in the editor: [start, end] ms */
  range?: unknown
  /**
   * Videos on top (B-roll) are layers in the editor, saved as one row of parts in `segments`. This
   * is the editor's note of the sections it cut to do so (modules/editor/shots.ts), kept as it is
   * and handed back when the clip is opened; null = no video on top. Left out by an editor that
   * doesn't know about layers: what's saved stays (and no longer matches the rows, so it's ignored).
   */
  layers?: unknown
}

export async function saveClip(userId: string, clipId: string, body: SaveClipInput) {
  const { segments, captionStyle, textOverlays, audioTracks, transitions, overlays } = body
  const ms = (v: number) => Math.round(v)

  // Ownership check and the existing caption style in one round trip
  const [[clip], [existingStyle]] = await Promise.all([
    sql`SELECT c.id, c.start_ms, c.end_ms, to_jsonb(c)->'trim_ranges' AS trim_ranges,
      (to_jsonb(c)->>'original_start_ms')::int AS original_start_ms, (to_jsonb(c)->>'original_end_ms')::int AS original_end_ms,
      v.user_id, v.duration_ms AS video_duration_ms FROM clips c JOIN videos v ON v.id = c.video_id WHERE c.id = ${clipId}`,
    sql`SELECT id FROM caption_styles WHERE clip_id = ${clipId} LIMIT 1`,
  ])
  if (!clip) throw Object.assign(new Error('Clip not found'), { status: 404 })
  if (clip.user_id !== userId) throw Object.assign(new Error('Forbidden'), { status: 403 })

  // Re-index sort_order as 0,1,2… — the store uses fractional values (e.g. +0.5) to insert
  // between existing segments in-memory, but the DB column is INTEGER. Order by time: repeated
  // splits can give two segments the same fractional sort_order, and the renderer concatenates
  // segments in sort_order, so a tie could swap them in the export.
  const sortedSegments = [...segments].sort((a, b) => a.start_ms - b.start_ms || a.sort_order - b.sort_order)

  // Hide / mute / lock (and music trims) once the database has those fields (the backend adds them when it starts)
  const hasControls = await itemControlFields()
  const segRows = sortedSegments.map((seg, si) => ({
    id: seg.id, clip_id: clipId, start_ms: ms(seg.start_ms), end_ms: ms(seg.end_ms), layout: seg.layout, sort_order: si,
    frame: seg.frame ? sql.json(cleanFrame(seg.frame) as never) : null,
    ...(hasControls ? { hidden: !!seg.hidden, muted: !!seg.muted, locked: !!seg.locked } : {}),
  }))
  const boxRows = sortedSegments.flatMap(seg => seg.crop_boxes.map(box => ({
    id: box.id, segment_id: seg.id, slot_index: box.slot_index,
    source_video_id: box.source_video_id ?? null, source_offset_ms: ms(box.source_offset_ms ?? 0),
    image_path: box.image_path ?? null,
    image_motion: box.image_motion && motions.includes(box.image_motion) ? box.image_motion : null,
    volume: Math.max(0, Math.min(1, Number(box.volume ?? 1))),
    muted: !!box.muted,
    ...(hasControls ? { hidden: !!box.hidden } : {}),
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
  const hasFades = await hasColumn('audio_tracks', 'fade_in')
  const hasTextW = await hasColumn('text_overlays', 'w')
  const hasTextH = await hasColumn('text_overlays', 'h')
  // How far a text / photo is turned (its rotate handle on the preview), once the worker has added the field
  const hasTextRot = await hasColumn('text_overlays', 'rotation')
  const hasPhotoRot = await hasColumn('overlays', 'rotation')
  /** Degrees, clockwise, -180..180 (nothing when it isn't turned) */
  const turn = (r: unknown) => (typeof r === 'number' && isFinite(r) && Math.round(r * 10) % 3600 !== 0 ? (((r % 360) + 540) % 360) - 180 : null)
  // The clip's start and end, when dragged in the editor (bug #8)
  const range = clipRangeFrom(body.range, clip, body.trims)
  const keepsMadeRange = !!range && await hasColumn('clips', 'original_start_ms')
  const clipStart = range ? range[0] : Number(clip.start_ms), clipEnd = range ? range[1] : Number(clip.end_ms)
  // Removed parts of the video, once the database has that field (the backend adds it when it starts)
  const trims = Array.isArray(body.trims) && await hasColumn('clips', 'trim_ranges')
    ? cleanTrims(body.trims, clipStart, clipEnd)
    : null
  // The editor's note beside the rows (see SaveClipInput.layers), once the database has the field
  const layersJson = body.layers === undefined ? undefined : body.layers === null ? null : JSON.stringify(body.layers)
  const savesLayers = layersJson !== undefined && (layersJson === null || (layersJson.length < 2_000_000 && typeof body.layers === 'object'))
    && await hasColumn('clips', 'layers')
  const original = body.originalSound
  const hasOriginal = !!original && typeof original.volume === 'number' && await hasColumn('clips', 'original_volume')

  // Every statement is built up front and pipelined in one transaction: the database is far
  // from the server (~300–500 ms per round trip), and awaiting each statement made saves take
  // 10–20 s, long enough for the next auto-save to overlap and collide with this one.
  await sql.begin(tx => {
    const q = []

    if (segRows.length > 0) {
      q.push(hasControls ? tx`
        INSERT INTO segments ${tx(segRows)}
        ON CONFLICT (id) DO UPDATE SET start_ms = EXCLUDED.start_ms, end_ms = EXCLUDED.end_ms,
          layout = EXCLUDED.layout, sort_order = EXCLUDED.sort_order, frame = EXCLUDED.frame,
          hidden = EXCLUDED.hidden, muted = EXCLUDED.muted, locked = EXCLUDED.locked
        WHERE segments.clip_id = ${clipId}
      ` : tx`
        INSERT INTO segments ${tx(segRows)}
        ON CONFLICT (id) DO UPDATE SET start_ms = EXCLUDED.start_ms, end_ms = EXCLUDED.end_ms,
          layout = EXCLUDED.layout, sort_order = EXCLUDED.sort_order, frame = EXCLUDED.frame
        WHERE segments.clip_id = ${clipId}
      `)
      // Formats removed in the editor (cascades to their crop boxes and keyframes)
      q.push(tx`DELETE FROM segments WHERE clip_id = ${clipId} AND id != ALL(${segIds})`)
    }
    if (boxRows.length > 0) {
      q.push(hasControls ? tx`
        INSERT INTO crop_boxes ${tx(boxRows)}
        ON CONFLICT (id) DO UPDATE SET segment_id = EXCLUDED.segment_id, slot_index = EXCLUDED.slot_index,
          source_video_id = EXCLUDED.source_video_id, source_offset_ms = EXCLUDED.source_offset_ms,
          image_path = EXCLUDED.image_path, image_motion = EXCLUDED.image_motion,
          volume = EXCLUDED.volume, muted = EXCLUDED.muted, hidden = EXCLUDED.hidden
        WHERE crop_boxes.segment_id IN (SELECT id FROM segments WHERE clip_id = ${clipId})
      ` : tx`
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
    if (range) {
      q.push(tx`UPDATE clips SET start_ms = ${range[0]}, end_ms = ${range[1]} WHERE id = ${clipId}`)
      // The first move keeps where the clip was made (Reset goes back to it)
      if (keepsMadeRange) {
        q.push(tx`UPDATE clips SET original_start_ms = COALESCE(original_start_ms, ${Number(clip.start_ms)}),
          original_end_ms = COALESCE(original_end_ms, ${Number(clip.end_ms)}) WHERE id = ${clipId}`)
      }
    }
    if (trims) q.push(tx`UPDATE clips SET trim_ranges = ${trims.length ? sql.json(trims as never) : null} WHERE id = ${clipId}`)
    if (savesLayers) q.push(tx`UPDATE clips SET layers = ${body.layers ? sql.json(body.layers as never) : null} WHERE id = ${clipId}`)
    if (hasOriginal) {
      q.push(tx`UPDATE clips SET original_volume = ${Math.max(0, Math.min(1, original!.volume))}, original_muted = ${!!original!.muted} WHERE id = ${clipId}`)
    }

    q.push(tx`DELETE FROM text_overlays WHERE clip_id = ${clipId}`)
    if (textOverlays.length > 0) {
      q.push(tx`INSERT INTO text_overlays ${tx(textOverlays.map(({ id, text, start_ms, end_ms, x, y, font, size, color, hidden, locked, w, h, rotation }) => ({
        id, clip_id: clipId, text, start_ms: ms(start_ms), end_ms: ms(end_ms), x, y, font, size, color,
        // Box width (the text wraps inside it): a share of the frame's width, or none
        ...(hasTextW ? { w: typeof w === 'number' && w > 0 ? Math.min(1, w) : null } : {}),
        // Box height (the text sits in its middle): a share of the frame's height, or none
        ...(hasTextH ? { h: typeof h === 'number' && h > 0 ? Math.min(1, h) : null } : {}),
        ...(hasTextRot ? { rotation: turn(rotation) } : {}),
        ...(hasControls ? { hidden: !!hidden, locked: !!locked } : {}),
      })))}`)
    }

    q.push(tx`DELETE FROM audio_tracks WHERE clip_id = ${clipId}`)
    if (audioTracks.length > 0) {
      q.push(tx`INSERT INTO audio_tracks ${tx(audioTracks.map(({ id, storage_path, start_ms, volume, duck_under_speech, offset_ms, end_ms, muted, locked, fade_in, fade_out }) => ({
        id, clip_id: clipId, storage_path, start_ms: ms(start_ms), volume, duck_under_speech,
        ...(hasFades ? { fade_in: !!fade_in, fade_out: !!fade_out } : {}),
        ...(hasControls ? {
          offset_ms: offset_ms == null ? null : ms(offset_ms), end_ms: end_ms == null ? null : ms(end_ms),
          muted: !!muted, locked: !!locked,
        } : {}),
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
      q.push(tx`INSERT INTO overlays ${tx(overlays.map(({ id, type, storage_path, source_video_id, source_offset_ms, x, y, w, h, start_ms, end_ms, z_index, hidden, muted, locked, rotation }) => ({
        id, clip_id: clipId, type, storage_path: storage_path ?? null,
        source_video_id: source_video_id ?? null, source_offset_ms: ms(source_offset_ms ?? 0),
        x, y, w, h, start_ms: ms(start_ms), end_ms: ms(end_ms), z_index,
        ...(hasPhotoRot ? { rotation: turn(rotation) } : {}),
        ...(hasControls ? { hidden: !!hidden, muted: !!muted, locked: !!locked } : {}),
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
  const { cleanIds, deleteR2Keys, MAX_BULK_DELETE, uploadsOnlyUsedBy, deleteUploads } = await import('./videos')
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
  // B-roll uploaded into these clips that no other clip uses goes with them (read before the rows go)
  const uploads = await uploadsOnlyUsedBy(userId, ids)
  const songs = await sql<{ storage_path: string }[]>`
    SELECT DISTINCT storage_path FROM audio_tracks WHERE clip_id = ANY(${ids}) AND storage_path LIKE ${`audio/${userId}/%`}`
  await sql`DELETE FROM clips WHERE id = ANY(${ids})`
  await deleteUploads(uploads)
  // Songs uploaded for these clips (stored per upload; another clip can't share one)
  const stillUsed = new Set((await sql<{ storage_path: string }[]>`
    SELECT storage_path FROM audio_tracks WHERE storage_path = ANY(${songs.map(s => s.storage_path)})`).map(r => r.storage_path))
  await deleteR2Keys(songs.map(s => s.storage_path).filter(p => !stillUsed.has(p)))
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

// Hide / mute / lock fields (added by the backend with the timeline controls, all at once): same rule
let itemControlsKnown = false
async function itemControlFields(): Promise<boolean> {
  if (itemControlsKnown) return true
  const rows = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'crop_boxes' AND column_name = 'hidden'`.catch(() => [])
  itemControlsKnown = rows.length > 0
  return itemControlsKnown
}

/**
 * A dragged clip start / end from the editor, checked: inside the video, at least MIN_CLIP_MS, and
 * playing at most MAX_CLIP_MS (a clip already longer may only get shorter). Null when unchanged;
 * refused (400) when it breaks a rule.
 */
function clipRangeFrom(raw: unknown, clip: Record<string, unknown>, newTrims?: unknown): [number, number] | null {
  if (raw == null) return null
  const bad = (msg: string) => Object.assign(new Error(msg), { status: 400 })
  if (!Array.isArray(raw) || raw.length !== 2 || !raw.every(v => Number.isFinite(Number(v)))) throw bad('Invalid clip start and end')
  const start = Math.round(Number(raw[0])), end = Math.round(Number(raw[1]))
  const oldStart = Number(clip.start_ms), oldEnd = Number(clip.end_ms)
  if (start === oldStart && end === oldEnd) return null
  // Back to where the clip was made (Reset): always allowed, however long it was
  if (clip.original_start_ms != null && start === Number(clip.original_start_ms) && end === Number(clip.original_end_ms)) return [start, end]
  const videoLen = Number(clip.video_duration_ms) || 0
  if (start < 0 || (videoLen > 0 && end > videoLen + 50)) throw bad('The clip can\u2019t reach past its video')
  const played = (t: unknown, a: number, b: number) => trimMap(cleanTrims(t, a, b), a, b).lengthMs
  const len = played(Array.isArray(newTrims) ? newTrims : clip.trim_ranges, start, end)
  if (len < MIN_CLIP_MS) throw bad('A clip must be at least 1 second long')
  if (len > Math.max(MAX_CLIP_MS, played(clip.trim_ranges, oldStart, oldEnd)) + 50) throw bad('A clip can be up to 5 minutes long')
  return [start, Math.min(end, videoLen > 0 ? videoLen : end)]
}

// Columns the backend adds when it starts (remembered once seen): saving works before and after
const knownColumns = new Set<string>()
async function hasColumn(table: string, column: string): Promise<boolean> {
  const key = `${table}.${column}`
  if (knownColumns.has(key)) return true
  const rows = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = ${table} AND column_name = ${column}`.catch(() => [])
  if (rows.length) knownColumns.add(key)
  return rows.length > 0
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
  // A media box inside its slot (resized / moved), or nothing when it fills the slot
  const rectOf = (r: unknown) => {
    const q = r as { x?: unknown; y?: unknown; w?: unknown; h?: unknown } | null | undefined
    const x = num(q?.x, 0, 1), y = num(q?.y, 0, 1), w = num(q?.w, 0.05, 1), h = num(q?.h, 0.05, 1)
    const r3 = (v: number) => Math.round(v * 1000) / 1000
    return x !== undefined && y !== undefined && w !== undefined && h !== undefined ? { rect: { x: r3(x), y: r3(y), w: r3(w), h: r3(h) } } : {}
  }
  const items: FrameItem[] = (frame.items ?? []).slice(0, 300).flatMap((it): FrameItem[] => {
    if (!it || typeof it.id !== 'string' || !['video', 'photo', 'text'].includes(it.kind)) return []
    const lane = it.lane === 'band' ? 'band' as const : num(it.lane, 0, 2)
    const start = num(it.start_ms, 0, 1e9), end = num(it.end_ms, 0, 1e9)
    if (lane === undefined || start === undefined || end === undefined || end <= start) return []
    const base: FrameItem = { id: it.id.slice(0, 64), lane: lane === 'band' ? lane : Math.round(lane), kind: it.kind, start_ms: Math.round(start), end_ms: Math.round(end), ...(it.hidden ? { hidden: true } : {}) }
    if (it.kind === 'video') {
      if (typeof it.source_video_id !== 'string') return []
      return [{ ...base, source_video_id: it.source_video_id, source_offset_ms: Math.round(num(it.source_offset_ms, 0, 1e9) ?? 0), volume: num(it.volume, 0, 1) ?? 1, muted: !!it.muted, corners: corner(it.corners), ...rectOf(it.rect) }]
    }
    if (it.kind === 'photo') {
      if (typeof it.image_path !== 'string') return []
      return [{ ...base, image_path: it.image_path, motion: it.motion && motions.includes(it.motion) ? it.motion : 'none', corners: corner(it.corners), ...rectOf(it.rect) }]
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
    main_under: frame.main_under ? true : undefined,
    // The main video's box in its slot, when resized / moved
    main_rects: frame.main_rects && typeof frame.main_rects === 'object'
      ? Object.fromEntries(Object.entries(frame.main_rects).flatMap(([k, r]) => {
          const x = num(r?.x, 0, 1), y = num(r?.y, 0, 1), w = num(r?.w, 0.05, 1), h = num(r?.h, 0.05, 1)
          return /^[0-2]$/.test(k) && x !== undefined && y !== undefined && w !== undefined && h !== undefined
            ? [[k, { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, w: Math.round(w * 1000) / 1000, h: Math.round(h * 1000) / 1000 }]] : []
        }))
      : undefined,
    // Resized rows (at most 4 in a template); the export checks they fit the frame's template
    row_h: Array.isArray(frame.row_h) && frame.row_h.length >= 2 && frame.row_h.length <= 4 && frame.row_h.every(h => typeof h === 'number' && h >= 0.03 && h <= 1)
      ? frame.row_h.map(h => Math.round(h * 1000) / 1000) : undefined,
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
