import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { searchStock } from '@/server/services/stock'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Stock videos for B-roll: ?q=cinema crowd&page=1 — every library with a key at once, mixed (&source=pixabay|pexels|coverr: that one only; an empty q only lists the libraries, or with &browse=1 gives their own picks)
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const q = req.nextUrl.searchParams.get('q') ?? ''
  const page = Math.max(1, Math.min(10, Number(req.nextUrl.searchParams.get('page')) || 1))
  try {
    return NextResponse.json(await searchStock(q, page, req.nextUrl.searchParams.get('source'), req.nextUrl.searchParams.get('browse') === '1'))
  } catch (err) {
    return apiError(err)
  }
}
