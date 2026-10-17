import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { deleteBrandKit, updateBrandKit } from '@/server/services/brandKits'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Ctx = { params: Promise<{ kitId: string }> }

/** Rename a kit or change its settings: { name?, data? } */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  const { kitId } = await params
  if (!UUID.test(kitId)) return NextResponse.json({ error: 'Brand kit not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  try {
    return NextResponse.json({ kit: await updateBrandKit(user.id, kitId, body ?? {}) })
  } catch (err) {
    return apiError(err)
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  const { kitId } = await params
  if (!UUID.test(kitId)) return NextResponse.json({ error: 'Brand kit not found' }, { status: 404 })
  try {
    await deleteBrandKit(user.id, kitId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError(err)
  }
}
