import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { stopSubjects } from '@/server/services/subjects'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Stop the clip's scan and following (the Subjects tool's Stop): { subjects, angles } as they are after
export async function POST(_req: Request, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    return NextResponse.json(await stopSubjects(user.id, clipId))
  } catch (err) {
    return apiError(err)
  }
}
