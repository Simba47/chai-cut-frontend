import { createAdminClient } from '@/lib/supabase/server'
import { STORAGE_BUCKET_OVERLAYS } from '@chai-cut/shared'

export async function uploadOverlay(userId: string, file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const storagePath = `${userId}/${crypto.randomUUID()}.${ext}`

  const admin = createAdminClient()
  const { error } = await admin.storage
    .from(STORAGE_BUCKET_OVERLAYS)
    .upload(storagePath, Buffer.from(await file.arrayBuffer()), {
      contentType: file.type || 'image/png',
      upsert: false,
    })

  if (error) throw Object.assign(new Error(error.message), { status: 500 })

  const { data: signed } = await admin.storage
    .from(STORAGE_BUCKET_OVERLAYS)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 365)

  return { storage_path: storagePath, preview_url: signed?.signedUrl }
}
