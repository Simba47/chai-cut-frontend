import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getUserPlan, getUserPlanConfig } from '@/server/services/quota'
import sql from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [planKey, plan] = await Promise.all([
    getUserPlan(user.id),
    getUserPlanConfig(user.id),
  ])

  const [videoRow, clipRow] = await Promise.all([
    sql<{ count: string }[]>`SELECT COUNT(*) as count FROM videos WHERE user_id = ${user.id}`,
    sql<{ count: string }[]>`
      SELECT COUNT(*) as count FROM clips c
      JOIN videos v ON v.id = c.video_id
      WHERE v.user_id = ${user.id}
    `,
  ])

  return NextResponse.json({
    plan: planKey,
    planName: plan.name,
    price: plan.price,
    maxVideos: plan.maxVideos,
    maxClips: plan.maxClips,
    maxFileSizeGb: plan.maxFileSizeGb,
    maxFileSizeBytes: plan.maxFileSizeBytes,
    retentionDays: plan.retentionDays,
    autoCaption: plan.autoCaption,
    watermark: plan.watermark,
    usage: {
      videos: parseInt(videoRow[0]?.count ?? '0', 10),
      clips: parseInt(clipRow[0]?.count ?? '0', 10),
    },
  })
}
