import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { uploadVideo } from '@/server/services/ingest'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await uploadVideo(user.id, req))
  } catch (err) {
    return apiError(err)
  }
}
