import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getSignedUploadUrl } from '@/server/services/ingest'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body?.filename) return NextResponse.json({ error: 'filename required' }, { status: 400 })
  try {
    return NextResponse.json(await getSignedUploadUrl(user.id, body.filename, body.content_type))
  } catch (err: unknown) {
    const e = err as { message?: string; status?: number }
    return NextResponse.json({ error: e.message ?? 'Failed' }, { status: e.status ?? 500 })
  }
}
