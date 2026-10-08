import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { deleteAccount, getAccount, updateName } from '@/server/services/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(err: unknown) {
  const e = err as Error & { status?: number }
  return NextResponse.json({ error: e.message || 'Something went wrong' }, { status: e.status ?? 500 })
}

/** The signed-in user's profile for the Account settings page */
export async function GET() {
  const user = await requireUser()
  try { return NextResponse.json(await getAccount(user.id)) } catch (err) { return fail(err) }
}

/** Change the name: { name } */
export async function PATCH(req: NextRequest) {
  const user = await requireUser()
  try {
    const body = await req.json().catch(() => ({}))
    const name = await updateName(user.id, body?.name)
    return NextResponse.json({ name })
  } catch (err) { return fail(err) }
}

/** Delete the account for good: { password } */
export async function DELETE(req: NextRequest) {
  const user = await requireUser()
  try {
    const body = await req.json().catch(() => ({}))
    await deleteAccount(user.id, body?.password)
    return NextResponse.json({ ok: true })
  } catch (err) { return fail(err) }
}
