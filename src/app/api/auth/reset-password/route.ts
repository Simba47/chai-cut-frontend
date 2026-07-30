import { NextRequest, NextResponse } from 'next/server'
import { resetPassword } from '@/modules/auth/services'

export async function POST(req: NextRequest) {
  try {
    const { email, otp, password } = await req.json()
    if (!email || !otp || !password) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    await resetPassword(email, otp, password)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const e = err as Error & { status?: number }
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 })
  }
}
