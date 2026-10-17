import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { startVideoTranscript, stopVideoTranscript, videoTranscriptState } from '@/server/services/transcribe'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The whole video's transcript (AI edit needs it): how far it is
export async function GET(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  try {
    return NextResponse.json(await videoTranscriptState(user.id, videoId))
  } catch (err) {
    return apiError(err)
  }
}

// Stop the reading (the clip board's lock): the parts already read are kept for the next Unlock
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  try {
    return NextResponse.json(await stopVideoTranscript(user.id, videoId))
  } catch (err) {
    return apiError(err)
  }
}

// Start reading the whole video (AI edit picked): a reading made or under way is kept
export async function POST(_req: NextRequest, { params }: { params: Promise<{ videoId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { videoId } = await params
  try {
    return NextResponse.json(await startVideoTranscript(user.id, videoId))
  } catch (err) {
    return apiError(err)
  }
}
