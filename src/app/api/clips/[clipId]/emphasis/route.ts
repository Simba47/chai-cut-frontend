import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { clipEmphasis } from '@/server/services/emphasis'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The clip's key words for the Creator caption styles: the saved ones, else picked by AI (and saved)
export async function POST(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    return NextResponse.json(await clipEmphasis(user.id, clipId))
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
