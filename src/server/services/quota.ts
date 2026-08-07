import sql from '@/lib/db'
import { PLANS, type PlanKey } from '@/lib/plans'

export async function getUserPlan(userId: string): Promise<PlanKey> {
  const [row] = await sql<{ plan: string }[]>`SELECT plan FROM users WHERE id = ${userId}`
  const plan = row?.plan ?? 'free'
  return (plan in PLANS ? plan : 'free') as PlanKey
}

export async function getUserPlanConfig(userId: string) {
  const key = await getUserPlan(userId)
  return PLANS[key]
}

export async function checkVideoQuota(userId: string): Promise<void> {
  const plan = await getUserPlanConfig(userId)
  const [row] = await sql<{ count: string }[]>`SELECT COUNT(*) as count FROM videos WHERE user_id = ${userId}`
  const count = parseInt(row?.count ?? '0', 10)
  if (count >= plan.maxVideos) {
    throw Object.assign(
      new Error(`Your ${plan.name} plan allows ${plan.maxVideos} video${plan.maxVideos === 1 ? '' : 's'}. Upgrade to add more.`),
      { status: 403 }
    )
  }
}

export async function checkClipQuota(userId: string): Promise<void> {
  const plan = await getUserPlanConfig(userId)
  if (!plan.maxClips) return
  const [row] = await sql<{ count: string }[]>`
    SELECT COUNT(*) as count FROM clips c
    JOIN videos v ON v.id = c.video_id
    WHERE v.user_id = ${userId}
  `
  const count = parseInt(row?.count ?? '0', 10)
  if (count >= plan.maxClips) {
    throw Object.assign(
      new Error(`Your ${plan.name} plan allows ${plan.maxClips} clips. Upgrade to create more.`),
      { status: 403 }
    )
  }
}

export async function checkFileSizeQuota(userId: string, fileSizeBytes: number): Promise<void> {
  const plan = await getUserPlanConfig(userId)
  if (fileSizeBytes > plan.maxFileSizeBytes) {
    throw Object.assign(
      new Error(`Your ${plan.name} plan allows videos up to ${plan.maxFileSizeGb} GB. Upgrade for larger files.`),
      { status: 403 }
    )
  }
}
