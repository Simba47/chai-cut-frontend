import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { ingestLink } from '@/server/services/ingest'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  const url: string = body?.url?.trim()
  if (!url) return NextResponse.json({ error: 'No URL provided' }, { status: 400 })
  try {
    return NextResponse.json(await ingestLink(user.id, url))
  } catch (err) {
    return apiError(err)
  }
}
