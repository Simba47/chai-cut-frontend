import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getSignedUploadUrl } from '@/server/services/ingest'
import { apiError } from '@/lib/api-error'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body?.filename) return NextResponse.json({ error: 'filename required' }, { status: 400 })
  try {
    return NextResponse.json(await getSignedUploadUrl(user.id, body.filename, body.content_type, body.file_size ?? undefined))
  } catch (err) {
    return apiError(err)
  }
}
