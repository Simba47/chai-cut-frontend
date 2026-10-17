import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { importSound } from '@/server/services/soundLibrary'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// A sound picked in the library goes into the user's own audio storage (like an uploaded song)
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!Number.isInteger(body?.id)) return NextResponse.json({ error: 'id required' }, { status: 400 })
  try {
    return NextResponse.json(await importSound(user.id, body.id))
  } catch (err) {
    return apiError(err)
  }
}
