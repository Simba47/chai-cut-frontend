import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { cancelInvite, inviteToKit, listKitShares, setMemberRole, unshareKit } from '@/server/services/brandKits'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Ctx = { params: Promise<{ kitId: string }> }
const notFound = () => NextResponse.json({ error: 'Brand kit not found' }, { status: 404 })

/** The kit's team (its owner only): { people, invites, can_share, seats } */
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

/** Invite { email } to the kit as { role } ('use' | 'edit'): { invite } — or, someone already on its team, { person } with the new role */
export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  const { kitId } = await params
  if (!UUID.test(kitId)) return notFound()
  const body = await req.json().catch(() => ({}))
  try {
    return NextResponse.json(await inviteToKit(user.id, kitId, body?.email, body?.role))
  } catch (err) {
    return apiError(err)
  }
}

/** What { user_id } on the kit's team can do: { role } (the owner only) */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  const { kitId } = await params
  if (!UUID.test(kitId)) return notFound()
  const body = await req.json().catch(() => ({}))
  if (typeof body?.user_id !== 'string' || !UUID.test(body.user_id)) return NextResponse.json({ error: 'Who?' }, { status: 400 })
  try {
    return NextResponse.json({ role: await setMemberRole(user.id, kitId, body.user_id, body?.role) })
  } catch (err) {
    return apiError(err)
  }
}

/**
 * Take back { invite_id } (the owner); stop sharing with { user_id } (the owner), or leave a kit shared
 * with you (your own id)
 */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  const { kitId } = await params
  if (!UUID.test(kitId)) return notFound()
  const body = await req.json().catch(() => ({}))
  const memberId = typeof body?.user_id === 'string' && UUID.test(body.user_id) ? body.user_id : user.id
  try {
    if (typeof body?.invite_id === 'string' && UUID.test(body.invite_id)) await cancelInvite(user.id, kitId, body.invite_id)
    else await unshareKit(user.id, kitId, memberId)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError(err)
  }
}
