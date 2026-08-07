import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { searchParams } = req.nextUrl
  const videoId = searchParams.get('video_id')
  const since = searchParams.get('since')
  if (!videoId) return NextResponse.json({ error: 'video_id required' }, { status: 400 })

  const [video] = await sql`SELECT id, status FROM videos WHERE id = ${videoId} AND user_id = ${user.id}`
  if (!video) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = since
    ? await sql`SELECT id FROM transcripts WHERE video_id = ${videoId} AND created_at > ${since} ORDER BY created_at DESC LIMIT 1`
    : await sql`SELECT id FROM transcripts WHERE video_id = ${videoId} ORDER BY created_at DESC LIMIT 1`

  if (!rows.length) return NextResponse.json({ words: null, video_status: video.status })

  const words = await sql`SELECT * FROM transcript_words WHERE transcript_id = ${rows[0].id} ORDER BY start_ms`
  return NextResponse.json({ words, video_status: video.status })
}
