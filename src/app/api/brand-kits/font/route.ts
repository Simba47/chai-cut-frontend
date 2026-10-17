import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { readBrandFont, uploadBrandFont } from '@/server/services/brandKits'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A font for a brand kit (form field "file": TTF or OTF): { family, name } */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file' }, { status: 400 })
  try {
    return NextResponse.json(await uploadBrandFont(user.id, file))
  } catch (err) {
    return apiError(err)
  }
}

/** One of the user's own brand fonts (?family=BrandFont-<id>), for the editor to draw with */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  try {
    const { body, type } = await readBrandFont(user.id, req.nextUrl.searchParams.get('family') ?? '')
    return new NextResponse(body as BodyInit, { headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' } })
  } catch (err) {
    return apiError(err)
  }
}
