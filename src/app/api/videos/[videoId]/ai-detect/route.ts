import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getVideoSuggestionsByCriteria } from '@/server/services/videos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  const body = await req.json().catch(() => null)
  const criteria = typeof body?.criteria === 'string' ? body.criteria : ''
  try {
    return NextResponse.json(await getVideoSuggestionsByCriteria(user.id, videoId, criteria))
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
