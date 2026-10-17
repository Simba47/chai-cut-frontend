import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { brandFromLink } from '@/server/services/brandFromLink'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A brand read from a website or profile link ({ url }): its name, @handle, logo (copied) and colours */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  const body = await req.json().catch(() => ({}))
  try {
    return NextResponse.json(await brandFromLink(user.id, body?.url))
  } catch (err) {
    return apiError(err)
  }
}
