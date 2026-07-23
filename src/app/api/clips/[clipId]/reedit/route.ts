import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { reeditClip } from '@/server/services/clips'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    await reeditClip(user.id, clipId)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
