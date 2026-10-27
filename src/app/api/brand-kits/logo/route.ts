import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { uploadBrandLogo } from '@/server/services/brandKits'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A logo for a brand kit (form field "file"): { path, url, colors } — its own colours read from it */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
  try {
    return NextResponse.json(await uploadBrandLogo(user.id, file))
  } catch (err) {
    return apiError(err)
  }
}
