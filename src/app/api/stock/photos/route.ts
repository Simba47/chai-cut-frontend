import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { searchPhotos } from '@/server/services/stock'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Stock photos (Media ▸ Search photos): ?q=mountains&page=1
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const page = Math.max(1, Math.min(10, Number(req.nextUrl.searchParams.get('page')) || 1))
  try {
    return NextResponse.json(await searchPhotos(q, page))
  } catch (err) {
    return apiError(err)
  }
}
