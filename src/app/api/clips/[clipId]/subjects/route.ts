import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { listSubjects, addSubject, renameSubject, deleteSubject } from '@/server/services/subjects'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Subjects of a clip: the people marked in it (editor Subjects tool)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    return NextResponse.json({ subjects: await listSubjects(user.id, clipId) })
  } catch (err) {
    return apiError(err)
  }
}

// Mark a person: { mark_ms (source video), x, y (fractions of the frame) }
export async function POST(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ subject: await addSubject(user.id, clipId, body) })
  } catch (err) {
    return apiError(err)
  }
}

// Rename: { id, label }
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    const body = await req.json().catch(() => ({}))
    return NextResponse.json({ subject: await renameSubject(user.id, clipId, String(body.id ?? ''), body.label) })
  } catch (err) {
    return apiError(err)
  }
}

// Remove: ?id=
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ clipId: string }> }) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { clipId } = await params
  try {
    await deleteSubject(user.id, clipId, req.nextUrl.searchParams.get('id') ?? '')
    return NextResponse.json({ ok: true })
  } catch (err) {
    return apiError(err)
  }
}
