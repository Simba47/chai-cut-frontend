import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'
import { PLANS, type PlanKey } from '@/lib/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAID_PLANS: PlanKey[] = ['starter', 'creator', 'agency']

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const plan = body?.plan as PlanKey | undefined
  if (!plan || !PAID_PLANS.includes(plan)) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const expiresAt = new Date()
  expiresAt.setMonth(expiresAt.getMonth() + 1)

  await sql.begin(async tx => {
    await tx`UPDATE users SET plan = ${plan} WHERE id = ${user.id}`
    await tx`
      INSERT INTO subscriptions (user_id, plan, status, expires_at)
      VALUES (${user.id}, ${plan}, 'active', ${expiresAt})
    `
  })

  return NextResponse.json({ success: true, plan, planName: PLANS[plan].name })
}
