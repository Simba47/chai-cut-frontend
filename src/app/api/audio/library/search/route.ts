import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { searchSounds, soundLibraryOn } from '@/server/services/soundLibrary'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The Music tool's sound library: sounds to search (music, effects, meme sounds), from Freesound
export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const p = req.nextUrl.searchParams
  const kind = p.get('kind')
  if (kind !== 'music' && kind !== 'sfx' && kind !== 'meme') return NextResponse.json({ error: 'kind required' }, { status: 400 })
  if (!soundLibraryOn()) return NextResponse.json({ on: false, items: [], more: false })
  try {
    return NextResponse.json({ on: true, ...await searchSounds(user.id, kind, p.get('q') ?? '', Math.max(1, Number(p.get('page')) || 1)) })
  } catch (err) {
    return apiError(err)
  }
}
