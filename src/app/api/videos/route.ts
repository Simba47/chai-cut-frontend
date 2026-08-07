import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { listVideos } from '@/server/services/videos'
import { apiError } from '@/lib/api-error'
import { r2, R2_BUCKET } from '@/lib/r2'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const rows = await listVideos(user.id)
    const videos = await Promise.all(
      rows.map(async (v, i) => {
        let video_url: string | null = null
        if (v.storage_path) {
          try {
            video_url = await getSignedUrl(
              r2,
              new GetObjectCommand({ Bucket: R2_BUCKET, Key: v.storage_path }),
              { expiresIn: 3600 },
            )
          } catch { /* no url */ }
        } else if (v.source_url) {
          video_url = v.source_url
        }
        return {
          id: v.id,
          status: v.status,
          download_progress: v.download_progress,
          duration_ms: v.duration_ms,
          created_at: v.created_at,
          source_type: v.source_type,
          video_url,
          index: rows.length - i,
        }
      }),
    )
    return NextResponse.json({ videos })
  } catch (err) {
    return apiError(err)
  }
}
