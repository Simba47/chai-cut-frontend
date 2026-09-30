import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { importStock } from '@/server/services/stock'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Add a stock video to the user's assets (once per video) so a clip can use it as B-roll
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (typeof body?.ref !== 'string' || typeof body?.url !== 'string') return NextResponse.json({ error: 'ref and url required' }, { status: 400 })
  try {
    return NextResponse.json(await importStock(user.id, { ref: body.ref, url: body.url, title: typeof body.title === 'string' ? body.title : undefined }))
  } catch (err) {
    return apiError(err)
  }
}
