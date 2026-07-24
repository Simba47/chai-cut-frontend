import { PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET } from '@/lib/r2'
import { createAdminClient } from '@/lib/supabase/server'

export async function uploadOverlay(userId: string, file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  const storagePath = `overlays/${userId}/${crypto.randomUUID()}.${ext}`

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: storagePath,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type || 'image/png',
  }))

  const preview_url = await getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: storagePath }),
    { expiresIn: 60 * 60 * 24 * 365 },
  )

  return { storage_path: storagePath, preview_url }
}
