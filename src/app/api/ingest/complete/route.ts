import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { completeUpload } from '@/server/services/ingest'
import { apiError } from '@/lib/api-error'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body?.storage_path) return NextResponse.json({ error: 'storage_path required' }, { status: 400 })
  const durationMs = typeof body.duration_ms === 'number' ? Math.round(body.duration_ms) : undefined
  try {
    return NextResponse.json(await completeUpload(user.id, body.storage_path, durationMs))
  } catch (err) {
    return apiError(err)
  }
}
