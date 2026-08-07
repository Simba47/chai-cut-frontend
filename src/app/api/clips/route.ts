import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { createClip } from '@/server/services/clips'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body?.video_id) return NextResponse.json({ error: 'video_id required' }, { status: 400 })
  try {
    return NextResponse.json(await createClip(user.id, body))
  } catch (err) {
    return apiError(err)
  }
}
