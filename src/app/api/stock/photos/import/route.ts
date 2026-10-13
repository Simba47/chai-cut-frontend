import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { importPhoto } from '@/server/services/stock'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Save a stock photo to the user's photos (once per photo) so a clip can show it
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (typeof body?.ref !== 'string' || typeof body?.url !== 'string') return NextResponse.json({ error: 'ref and url required' }, { status: 400 })
  try {
    return NextResponse.json(await importPhoto(user.id, { ref: body.ref, url: body.url, title: typeof body.title === 'string' ? body.title : undefined }))
  } catch (err) {
    return apiError(err)
  }
}
