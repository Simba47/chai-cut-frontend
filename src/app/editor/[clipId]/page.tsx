import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { requireUser } from '@/server/auth'
import { EditorShell } from './EditorShell'
import { EditorShellMobile } from './EditorShellMobile'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { TranscriptWord, CaptionStyle, TextOverlay, AudioTrack, Transition, Overlay } from '@chai-cut/shared'

export const dynamic = 'force-dynamic'

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

  const ua = (await headers()).get('user-agent') ?? ''
  const isMobile = /Mobi|Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua)

  const user = await requireUser()
  if (!user) redirect('/login')

  const [clip] = await sql`
    SELECT c.*, v.storage_path, v.status AS video_status, v.user_id
    FROM clips c JOIN videos v ON v.id = c.video_id
    WHERE c.id = ${clipId}
  `
  if (!clip || clip.user_id !== user.id) notFound()

  // Fire all independent queries in parallel — one round-trip after the clip fetch
  const [
    signedUrl,
    wordsRaw,
    segmentsRaw,
    captionStylesRaw,
    textOverlaysRaw,
    audioTracksRaw,
    transitionsRaw,
    overlaysRaw,
  ] = await Promise.all([
    clip.storage_path
      ? getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: clip.storage_path }), { expiresIn: 43200 })
      : Promise.resolve(''),
    // Merged two-step transcript lookup into one subquery
    sql`
      SELECT tw.* FROM transcript_words tw
      WHERE tw.transcript_id = (
        SELECT id FROM transcripts WHERE video_id = ${clip.video_id} ORDER BY created_at DESC LIMIT 1
      )
      ORDER BY tw.start_ms
    `,
    sql`
      SELECT s.*, COALESCE(
        json_agg(
          jsonb_build_object(
            'id', cb.id, 'segment_id', cb.segment_id, 'slot_index', cb.slot_index,
            'source_video_id', cb.source_video_id, 'source_offset_ms', cb.source_offset_ms,
            'box_keyframes', COALESCE(
              (SELECT json_agg(bk.* ORDER BY bk.t_ms) FROM box_keyframes bk WHERE bk.box_id = cb.id),
              '[]'
            )
          ) ORDER BY cb.slot_index
        ) FILTER (WHERE cb.id IS NOT NULL),
        '[]'
      ) AS crop_boxes
      FROM segments s
      LEFT JOIN crop_boxes cb ON cb.segment_id = s.id
      WHERE s.clip_id = ${clipId}
      GROUP BY s.id
      ORDER BY s.sort_order
    `,
    sql`SELECT * FROM caption_styles WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM text_overlays WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM audio_tracks WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM transitions WHERE clip_id = ${clipId}`,
    sql`SELECT * FROM overlays WHERE clip_id = ${clipId} ORDER BY z_index`,
  ])

  const words: TranscriptWord[] = wordsRaw as unknown as TranscriptWord[]
  const captionStyles = captionStylesRaw as unknown as CaptionStyle[]
  const textOverlays = textOverlaysRaw as unknown as TextOverlay[]
  const audioTracks = audioTracksRaw as unknown as AudioTrack[]
  const transitions = transitionsRaw as unknown as Transition[]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let segments: any[] = segmentsRaw as any[]

  // Heal segments with accidental absolute timestamps
  const clipDuration = clip.end_ms - clip.start_ms
  const healPromises: Promise<unknown>[] = []
  for (const seg of segments) {
    if (seg.start_ms >= clipDuration || seg.end_ms > clipDuration) {
      const corrStart = Math.max(0, Math.min(seg.start_ms - clip.start_ms, clipDuration))
      const corrEnd = Math.max(corrStart + 1000, Math.min(seg.end_ms - clip.start_ms, clipDuration))
      healPromises.push(sql`UPDATE segments SET start_ms = ${corrStart}, end_ms = ${corrEnd} WHERE id = ${seg.id}`)
      seg.start_ms = corrStart
      seg.end_ms = corrEnd
    }
  }
  if (healPromises.length) await Promise.all(healPromises)

  if (segments.length === 0) {
    const [newSeg] = await sql`
      INSERT INTO segments (clip_id, start_ms, end_ms, layout, sort_order)
      VALUES (${clipId}, 0, ${clip.end_ms - clip.start_ms}, ${initialLayout}, 0)
      RETURNING *
    `
    if (newSeg) {
      const [newBox] = await sql`
        INSERT INTO crop_boxes (segment_id, slot_index)
        VALUES (${newSeg.id}, 0)
        RETURNING *
      `
      segments = [{ ...newSeg, crop_boxes: newBox ? [{ ...newBox, box_keyframes: [] }] : [] }]
    }
  }

  // Sign overlay image URLs (fast local operation, run in parallel)
  const overlays: Overlay[] = await Promise.all((overlaysRaw as unknown as Overlay[]).map(async ov => {
    if (ov.type === 'image' && ov.storage_path) {
      const preview_url = await getSignedUrl(
        r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: ov.storage_path }), { expiresIn: 43200 }
      ).catch(() => undefined)
      return { ...ov, preview_url }
    }
    return ov
  }))

  const shellProps = {
    clip: clip as Parameters<typeof EditorShell>[0]['clip'],
    videoUrl: signedUrl,
    words,
    initialSegments: segments ?? [],
    initialCaptionStyles: captionStyles ?? [],
    initialTextOverlays: textOverlays ?? [],
    initialAudioTracks: audioTracks ?? [],
    initialTransitions: transitions ?? [],
    initialOverlays: overlays ?? [],
  }

  return isMobile ? <EditorShellMobile {...shellProps} /> : <EditorShell {...shellProps} />
}
