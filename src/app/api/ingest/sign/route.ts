import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { signUploadRequest, type SignUploadRequest } from '@/server/services/ingest'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Signs one S3 request of a browser upload (Uppy): start, each part, list parts, finish, cancel
export async function POST(req: NextRequest) {
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null) as SignUploadRequest | null
  if (!body || !['PUT', 'POST', 'GET', 'DELETE'].includes(body.method) || typeof body.key !== 'string') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  try {
    return NextResponse.json(await signUploadRequest(user.id, body))
  } catch (err) {
    return apiError(err)
  }
}
