import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import sql from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The heart on a clip card: { favorite: true | false } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  const body = await req.json().catch(() => ({}))
  if (typeof body?.favorite !== 'boolean') return NextResponse.json({ error: 'favorite must be true or false' }, { status: 400 })
  // The worker adds the column when it starts: until then, say so instead of failing
  const [col] = await sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'clips' AND column_name = 'favorite'`
  if (!col) return NextResponse.json({ error: 'Favorites will work once the latest backend update is running' }, { status: 503 })
  const rows = await sql`
    UPDATE clips c SET favorite = ${body.favorite}
    FROM videos v
    WHERE c.id = ${clipId} AND v.id = c.video_id AND v.user_id = ${user.id}
    RETURNING c.id
  `
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true, favorite: body.favorite })
}
