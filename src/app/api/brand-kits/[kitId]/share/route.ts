import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { listKitShares, shareKit, unshareKit } from '@/server/services/brandKits'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Ctx = { params: Promise<{ kitId: string }> }
const notFound = () => NextResponse.json({ error: 'Brand kit not found' }, { status: 404 })

/** Who the kit is shared with (its owner only): { people, can_share } */
export async function GET(_req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  const { kitId } = await params
  if (!UUID.test(kitId)) return notFound()
  try {
    return NextResponse.json(await listKitShares(user.id, kitId))
  } catch (err) {
    return apiError(err)
  }
}

/** Share the kit with the account that has { email } */
export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  const { kitId } = await params
  if (!UUID.test(kitId)) return notFound()
  const body = await req.json().catch(() => ({}))
  try {
    return NextResponse.json({ person: await shareKit(user.id, kitId, body?.email) })
  } catch (err) {
    return apiError(err)
  }
}

/** Stop sharing with { user_id } (the owner), or leave a kit shared with you (your own id) */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  const { kitId } = await params
  if (!UUID.test(kitId)) return notFound()
  const body = await req.json().catch(() => ({}))
  const memberId = typeof body?.user_id === 'string' && UUID.test(body.user_id) ? body.user_id : user.id
  try {
    await unshareKit(user.id, kitId, memberId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError(err)
  }
}
