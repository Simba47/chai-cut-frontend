import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { apiError } from '@/lib/api-error'
import { brandClip, clipKit } from '@/server/services/brandApply'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The brand kit on this clip as saved ({ kit_id }, null: none): the editor checks it when it's back in view */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    return NextResponse.json({ kit_id: await clipKit(user.id, clipId) })
  } catch (err) {
    return apiError(err)
  }
}

/** A brand kit put on this clip ({ kit_id }), or the brand taken off ({ kit_id: null }), from the clip board: { on } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  const body = await req.json().catch(() => null)
  const kitId = typeof body?.kit_id === 'string' ? body.kit_id : null
  try {
    return NextResponse.json({ on: await brandClip(user.id, clipId, kitId) })
  } catch (err) {
    return apiError(err)
  }
}
