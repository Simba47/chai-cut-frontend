import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Media ▸ Memes: KLIPY's and GIPHY's APIs are called from the user's browser, as their terms ask
// (no proxying), so the signed-in editor gets their app keys here — keys both make for use in apps
// — with a stable id for the user that says nothing about them (KLIPY's customer_id)
export async function GET() {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    klipy: process.env.KLIPY_API_KEY || null,
    giphy: process.env.GIPHY_API_KEY || null,
    customer_id: createHash('sha256').update(`klipy|${user.id}`).digest('hex').slice(0, 32),
  })
}
