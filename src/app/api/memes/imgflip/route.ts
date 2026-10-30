import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { searchImgflip } from '@/server/services/memes'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Imgflip meme templates (Media ▸ Memes): ?q=distracted — all of Imgflip with API Premium, else its top 100
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    return NextResponse.json(await searchImgflip(req.nextUrl.searchParams.get('q') ?? ''))
  } catch (err) {
    return apiError(err)
  }
}
