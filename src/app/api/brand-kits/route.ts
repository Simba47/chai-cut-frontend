import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { createBrandKit, listBrandKits } from '@/server/services/brandKits'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The user's brand kits and how many their plan allows */
export async function GET() {
  const user = await requireUser()
  try {
    return NextResponse.json(await listBrandKits(user.id))
  } catch (err) {
    return apiError(err)
  }
}

/** A new brand kit: { name?, data? } */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  const body = await req.json().catch(() => ({}))
  try {
    return NextResponse.json({ kit: await createBrandKit(user.id, body ?? {}) })
  } catch (err) {
    return apiError(err)
  }
}
