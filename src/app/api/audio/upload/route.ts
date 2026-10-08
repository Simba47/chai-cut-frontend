import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { uploadMusic, MAX_MUSIC_BYTES } from '@/server/services/music'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Music picked in the editor (up to 20 MB, any audio or video file): stored so it plays after a
// reload and is mixed into the export
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Refuse an oversized body before reading it
  const declared = Number(req.headers.get('content-length') ?? 0)
  if (declared > MAX_MUSIC_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: 'Music files can be up to 20 MB. Pick a smaller file or a shorter song.' }, { status: 413 })
  }
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
  try {
    return NextResponse.json(await uploadMusic(user.id, file))
  } catch (err) {
    return apiError(err)
  }
}
