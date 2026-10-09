import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { deleteMedia, listMedia } from '@/server/services/media'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The editor's Media library: the user's imported videos, photos and audio
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json({ items: await listMedia(user.id) })
  } catch (err) {
    return apiError(err)
  }
}

// Delete one item from the library: { kind: 'video' | 'image' | 'audio', id }
export async function DELETE(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as { kind?: unknown; id?: unknown } | null
  try {
    await deleteMedia(user.id, body?.kind, body?.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError(err)
  }
}
