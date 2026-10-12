import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from '@/server/auth'
import { getPhotoUrl, readPhoto, removePhoto, savePhoto } from '@/server/services/account'
import { apiError } from '@/lib/api-error'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The signed-in user's profile photo (the address carries ?v=…, so a new photo is a new address).
 * With ?info: only its address as JSON, { image } (null when none was added).
 */
export async function GET(req: NextRequest) {
  const user = await requireUser()
  try {
    if (req.nextUrl.searchParams.has('info')) {
      return NextResponse.json({ image: await getPhotoUrl(user.id) }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const photo = await readPhoto(user.id)
    if (!photo) return new NextResponse(null, { status: 404 })
    return new NextResponse(Buffer.from(photo.body), {
      headers: { 'Content-Type': photo.contentType, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
    })
  } catch (err) { return apiError(err) }
}

/** Set the profile photo: form data with `file` (the settings page sends a small square JPEG) */
export async function POST(req: NextRequest) {
  const user = await requireUser()
  try {
    const form = await req.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose a photo' }, { status: 400 })
    return NextResponse.json({ image: await savePhoto(user.id, file) })
  } catch (err) { return apiError(err) }
}

/** Remove the profile photo (the first letter of the name shows again) */
export async function DELETE() {
  const user = await requireUser()
  try {
    await removePhoto(user.id)
    return NextResponse.json({ image: null })
  } catch (err) { return apiError(err) }
}
