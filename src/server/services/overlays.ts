import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2, R2_BUCKET } from '@/lib/r2'
import { safeName } from './media'

export async function uploadOverlay(userId: string, file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png'
  // (the name stays in the key: the editor's Media library shows it)
  const base = safeName(file.name.replace(/\.[^.]+$/, ''))
  const storagePath = `overlays/${userId}/${crypto.randomUUID()}${base ? `--${base}` : ''}.${ext}`

  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: storagePath,
    Body: Buffer.from(await file.arrayBuffer()),
    ContentType: file.type || 'image/png',
  }))

  // Only used for immediate display right after upload — storage_path is the
  // durable reference, re-signed fresh elsewhere whenever actually needed later.
  // SigV4 presigned URLs cap at 7 days; a 1-year expiresIn here just throws.
  const preview_url = await getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: R2_BUCKET, Key: storagePath }),
    { expiresIn: 60 * 60 },
  )

  return { storage_path: storagePath, preview_url }
}
