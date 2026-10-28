import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { answerInvite } from '@/server/services/brandKits'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
type Ctx = { params: Promise<{ inviteId: string }> }

/** Accept { accept: true } an invite to a brand kit's team — { kit }, the kit now shared — or decline it */
export async function POST(req: NextRequest, { params }: Ctx) {
  const user = await requireUser()
  const { inviteId } = await params
  if (!UUID.test(inviteId)) return NextResponse.json({ error: 'Invite not found' }, { status: 404 })
  const body = await req.json().catch(() => ({}))
  try {
    return NextResponse.json({ kit: await answerInvite(user.id, inviteId, body?.accept === true) })
  } catch (err) {
    return apiError(err)
  }
}
