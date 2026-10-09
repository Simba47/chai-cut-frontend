import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { listVideos, deleteVideos, cleanIds } from '@/server/services/videos'
import { apiError } from '@/lib/api-error'
import { r2, R2_BUCKET } from '@/lib/r2'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ?assets=1 also lists the user's asset videos (stock clips saved for B-roll), for the editor
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const rows = await listVideos(user.id, req.nextUrl.searchParams.get('assets') === '1')
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
          title: v.title,
          clip_count: v.clip_count,
          status: v.status,
          download_progress: v.download_progress,
          duration_ms: v.duration_ms,
          created_at: v.created_at,
          source_type: v.source_type,
          error: v.status === 'failed' ? v.error ?? null : null,
          video_url,
          index: rows.length - i,
          // (with ?assets=1) a saved stock clip (B-roll) or a video uploaded in the editor: the editor
          // keeps stock footage on its B-roll lane and the user's own videos on the Videos lane
          is_asset: !!v.is_asset,
          is_upload_asset: !!v.is_upload_asset,
        }
      }),
    )
    return NextResponse.json({ videos })
  } catch (err) {
    return apiError(err)
  }
}

// Delete one or more videos (with their clips and files): body { ids: string[] }
export async function DELETE(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  try {
    return NextResponse.json(await deleteVideos(user.id, cleanIds(body?.ids)))
  } catch (err) {
    return apiError(err)
  }
}
