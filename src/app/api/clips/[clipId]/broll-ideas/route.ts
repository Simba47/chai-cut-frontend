import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { brollIdeas } from '@/server/services/stock'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Stock searches that fit what is said in this clip (AI)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    return NextResponse.json({ ideas: await brollIdeas(user.id, clipId) })
  } catch (err) {
    return apiError(err)
  }
}
