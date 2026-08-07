import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { queueRender } from '@/server/services/export'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body?.clip_id) return NextResponse.json({ error: 'clip_id required' }, { status: 400 })
  try {
    return NextResponse.json(await queueRender(user.id, body.clip_id, body.quality ?? '1080p'))
  } catch (err) {
    return apiError(err)
  }
}
