import { NextRequest, NextResponse } from 'next/server'
import { verifyOtp, issueOtp } from '@/modules/auth/services'

export async function POST(req: NextRequest) {
  try {
    const { email, otp, purpose } = await req.json()
    if (!email || !otp || !purpose) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    await verifyOtp(email, otp, purpose)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const e = err as Error & { status?: number }
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { email, purpose } = await req.json()
    if (!email || !purpose) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    await issueOtp(email, purpose)
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const e = err as Error & { status?: number }
    return NextResponse.json({ error: e.message }, { status: e.status ?? 500 })
  }
}
