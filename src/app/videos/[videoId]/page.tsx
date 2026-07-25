import { redirect, notFound } from 'next/navigation'
import { requireUser } from '@/server/auth'
import { ClipPickerShell } from './ClipPickerShell'
import sql from '@/lib/db'
import { r2, R2_BUCKET } from '@/lib/r2'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export default async function VideoPickerPage({
  params,
}: {
  params: Promise<{ videoId: string }>
}) {
  const { videoId } = await params
  const user = await requireUser()
  if (!user) redirect('/login')

  type VideoRow = { id: string; user_id: string; status: string; download_progress: number; duration_ms: number | null; created_at: string; storage_path: string | null }
  const [video] = await sql`
    SELECT id, user_id, status, download_progress, duration_ms, created_at, storage_path
    FROM videos WHERE id = ${videoId}
  ` as unknown as VideoRow[]
  if (!video || video.user_id !== user.id) notFound()

  let videoUrl = ''
  if (video.status === 'ready' && video.storage_path) {
    videoUrl = await getSignedUrl(
      r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: video.storage_path }), { expiresIn: 3600 }
    ).catch(() => '')
  }

  type RawClip = {
    id: string; title: string | null; start_ms: number; end_ms: number
    status: string; output_url: string | null; created_at: string
    layout: string | null
  }

  const clipsRaw = await sql<RawClip[]>`
    SELECT c.id, c.title, c.start_ms, c.end_ms, c.status, c.output_url, c.created_at,
      (SELECT layout FROM segments WHERE clip_id = c.id ORDER BY sort_order LIMIT 1) AS layout
    FROM clips c
    WHERE c.video_id = ${videoId}
    ORDER BY c.created_at ASC
  `

  const savedClips = clipsRaw.map((c, idx) => ({
    id: c.id, title: c.title ?? null, start_ms: c.start_ms, end_ms: c.end_ms,
    status: c.status, output_url: c.output_url, created_at: c.created_at,
    layout: c.layout ?? null, index: idx + 1,
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
