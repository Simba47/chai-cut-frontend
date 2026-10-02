import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { changePassword } from '@/server/services/account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Change the password: { current, next } */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  try {
    const body = await req.json().catch(() => ({}))
    await changePassword(user.id, body?.current, body?.next)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const e = err as Error & { status?: number }
    return NextResponse.json({ error: e.message || 'Could not change the password' }, { status: e.status ?? 500 })
  }
}
