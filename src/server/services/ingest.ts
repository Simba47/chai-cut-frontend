import { PassThrough } from 'node:stream'
import Busboy from 'busboy'
import type { NextRequest } from 'next/server'
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { r2, R2_BUCKET } from '@/lib/r2'
import sql from '@/lib/db'
import { ACCEPTED_VIDEO_EXTENSIONS } from '@chai-cut/shared'

export async function ingestLink(userId: string, url: string) {
  try { new URL(url) } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 })
  }

  const [video] = await sql`
    INSERT INTO videos (user_id, source_type, source_url, status)
    VALUES (${userId}, 'link', ${url}, 'uploaded')
    RETURNING id
  `
  if (!video) throw Object.assign(new Error('Failed to create video record'), { status: 500 })

  const payload = { video_id: video.id, storage_path: '' }
  await sql`INSERT INTO jobs (type, payload, status) VALUES ('transcribe', ${sql.json(payload)}, 'queued')`

  return { video_id: video.id }
}

export async function uploadVideo(userId: string, req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    throw Object.assign(new Error('Expected multipart/form-data'), { status: 400 })
  }

  const { storagePath } = await streamFileToR2(req, userId, contentType)

  const [video] = await sql`
    INSERT INTO videos (user_id, source_type, storage_path, status)
    VALUES (${userId}, 'upload', ${storagePath}, 'uploaded')
    RETURNING id
  `
  if (!video) throw Object.assign(new Error('Failed to create video record'), { status: 500 })

  const payload = { video_id: video.id, storage_path: storagePath }
  await sql`INSERT INTO jobs (type, payload, status) VALUES ('transcribe', ${sql.json(payload)}, 'queued')`

  return { video_id: video.id }
}

async function streamFileToR2(req: NextRequest, userId: string, contentType: string): Promise<{ storagePath: string }> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: { 'content-type': contentType }, limits: { fileSize: 2 * 1024 * 1024 * 1024 } })
    let settled = false, fileFieldSeen = false

    bb.on('file', (_, fileStream, info) => {
      fileFieldSeen = true
      const { filename, mimeType } = info
      const ext = '.' + (filename.split('.').pop() ?? 'mp4').toLowerCase()
      if (!ACCEPTED_VIDEO_EXTENSIONS.includes(ext as never)) {
        fileStream.resume()
        if (!settled) { settled = true; reject(Object.assign(new Error('Unsupported file type'), { status: 415 })) }
        return
      }
      const storagePath = `raw/${userId}/${Date.now()}${ext}`
      const chunks: Buffer[] = []
      fileStream.on('data', (chunk: Buffer) => chunks.push(chunk))
      fileStream.on('end', async () => {
        if (settled) return
        try {
          await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: storagePath, Body: Buffer.concat(chunks), ContentType: mimeType }))
          settled = true; resolve({ storagePath })
        } catch (e) { if (!settled) { settled = true; reject(e) } }
      })
      fileStream.on('error', e => { if (!settled) { settled = true; reject(e) } })
    })
    bb.on('error', e => { if (!settled) { settled = true; reject(e) } })
    bb.on('finish', () => { if (!settled && !fileFieldSeen) { settled = true; reject(new Error('No file received')) } })
    if (!req.body) { reject(new Error('No request body')); return }
    const pt = new PassThrough()
    pt.pipe(bb)
    const reader = req.body.getReader()
    ;(async () => {
      try {
        for (;;) { const { done, value } = await reader.read(); if (done) { pt.end(); break } pt.write(Buffer.from(value)) }
      } catch (e) { pt.destroy(e instanceof Error ? e : new Error(String(e))) }
    })()
  })
}

export async function getSignedUploadUrl(userId: string, filename: string, mimeType?: string) {
  const ext = '.' + filename.split('.').pop()?.toLowerCase()
  if (!ACCEPTED_VIDEO_EXTENSIONS.includes(ext as never)) {
    throw Object.assign(new Error('Unsupported file type'), { status: 415 })
  }
  const storagePath = `raw/${userId}/${Date.now()}${ext}`
  const signed_url = await getSignedUrl(r2, new PutObjectCommand({ Bucket: R2_BUCKET, Key: storagePath, ContentType: mimeType }), { expiresIn: 3600 })
  return { signed_url, storage_path: storagePath }
}

export async function completeUpload(userId: string, storagePath: string, durationMs?: number) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: storagePath }))
  } catch {
    throw Object.assign(new Error('File not found in storage'), { status: 404 })
  }

  const [video] = await sql`
    INSERT INTO videos (user_id, source_type, storage_path, status, duration_ms)
    VALUES (${userId}, 'upload', ${storagePath}, 'ready', ${durationMs ?? null})
    RETURNING id
  `
  if (!video) throw Object.assign(new Error('Failed to create video record'), { status: 500 })
  return { video_id: video.id }
}
