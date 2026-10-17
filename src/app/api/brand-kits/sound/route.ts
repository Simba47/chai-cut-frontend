import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { uploadBrandSound } from '@/server/services/brandKits'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Brand music or a sound logo for a kit (form fields "file", "kind": music | sting): { path, name, url } */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
  try {
    return NextResponse.json(await uploadBrandSound(user.id, file, form?.get('kind') === 'sting' ? 'sting' : 'music'))
  } catch (err) {
    return apiError(err)
  }
}
