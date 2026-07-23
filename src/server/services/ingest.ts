import { PassThrough } from 'node:stream'
import Busboy from 'busboy'
import type { NextRequest } from 'next/server'
import { createServiceClient, createAdminClient } from '@/lib/supabase/server'
import { STORAGE_BUCKET_RAW, ACCEPTED_VIDEO_EXTENSIONS } from '@chai-cut/shared'
import type { TranscribeJobPayload } from '@chai-cut/shared'

// ── Link ingest ────────────────────────────────────────────────────────────────

export async function ingestLink(userId: string, url: string) {
  try { new URL(url) } catch {
    throw Object.assign(new Error('Invalid URL'), { status: 400 })
  }

  const admin = createAdminClient()
  const { data: video, error } = await admin
    .from('videos')
    .insert({ user_id: userId, source_type: 'link', source_url: url, status: 'uploaded' })
    .select()
    .single()

  if (error || !video) {
    console.error('[link] video insert error:', error)
    throw Object.assign(new Error('Failed to create video record'), { status: 500 })
  }

  const payload: TranscribeJobPayload = { video_id: video.id, storage_path: '' }
  const { error: jobErr } = await admin.from('jobs').insert({ type: 'transcribe', payload, status: 'queued' })
  if (jobErr) {
    console.error('[link] job insert error:', jobErr)
    throw Object.assign(new Error('Failed to queue job'), { status: 500 })
  }

  return { video_id: video.id }
}

// ── Multipart upload ──────────────────────────────────────────────────────────

export async function uploadVideo(userId: string, req: NextRequest) {
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    throw Object.assign(new Error('Expected multipart/form-data'), { status: 400 })
  }

  const supabase = createAdminClient()
  const { storagePath } = await streamFileToStorage(req, userId, supabase, contentType)

  const { data: video, error: dbError } = await supabase
    .from('videos')
    .insert({ user_id: userId, source_type: 'upload', storage_path: storagePath, status: 'uploaded' })
    .select()
    .single()

  if (dbError || !video) {
    console.error('[upload] DB insert error:', dbError)
    throw Object.assign(new Error('Failed to create video record'), { status: 500 })
  }

  const payload: TranscribeJobPayload = { video_id: video.id, storage_path: storagePath }
  await supabase.from('jobs').insert({ type: 'transcribe', payload, status: 'queued' })

  return { video_id: video.id }
}

async function streamFileToStorage(
  req: NextRequest,
  userId: string,
  supabase: ReturnType<typeof createAdminClient>,
  contentType: string,
): Promise<{ storagePath: string }> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: { 'content-type': contentType }, limits: { fileSize: 2 * 1024 * 1024 * 1024 } })
    let settled = false
    let fileFieldSeen = false

    bb.on('file', (_, fileStream, info) => {
      fileFieldSeen = true
      const { filename, mimeType } = info
      const ext = '.' + (filename.split('.').pop() ?? 'mp4').toLowerCase()
      if (!ACCEPTED_VIDEO_EXTENSIONS.includes(ext as never)) {
        fileStream.resume()
        if (!settled) { settled = true; reject(Object.assign(new Error('Unsupported file type'), { status: 415 })) }
        return
      }

      const storagePath = `${userId}/${Date.now()}${ext}`
      const chunks: Buffer[] = []
      fileStream.on('data', (chunk: Buffer) => chunks.push(chunk))
      fileStream.on('end', async () => {
        if (settled) return
        try {
          const buffer = Buffer.concat(chunks)
          const { error } = await supabase.storage
            .from(STORAGE_BUCKET_RAW)
            .upload(storagePath, buffer, { contentType: mimeType, upsert: false })
          if (error) { settled = true; reject(new Error(`Storage error: ${error.message}`)); return }
          settled = true
          resolve({ storagePath })
        } catch (e) {
          if (!settled) { settled = true; reject(e) }
        }
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
        for (;;) {
          const { done, value } = await reader.read()
          if (done) { pt.end(); break }
          pt.write(Buffer.from(value))
        }
      } catch (e) {
        pt.destroy(e instanceof Error ? e : new Error(String(e)))
      }
    })()
  })
}

// ── Signed URL upload ─────────────────────────────────────────────────────────

export async function getSignedUploadUrl(userId: string, filename: string, contentType?: string) {
  const ext = '.' + filename.split('.').pop()?.toLowerCase()
  if (!ACCEPTED_VIDEO_EXTENSIONS.includes(ext as never)) {
    throw Object.assign(new Error('Unsupported file type'), { status: 415 })
  }

  const supabase = await createServiceClient()
  const storagePath = `${userId}/${Date.now()}${ext}`
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET_RAW)
    .createSignedUploadUrl(storagePath)

  if (error || !data) {
    console.error('signed URL error:', error)
    throw Object.assign(new Error('Could not create upload URL'), { status: 500 })
  }

  return { signed_url: data.signedUrl, storage_path: storagePath, token: data.token }
}

// ── Complete upload (browser-direct) ─────────────────────────────────────────

export async function completeUpload(userId: string, storagePath: string, durationMs?: number) {
  const supabase = await createServiceClient()

  const { data: stat, error: statErr } = await supabase.storage
    .from('raw-videos')
    .list(storagePath.split('/').slice(0, -1).join('/'), { search: storagePath.split('/').pop() })

  if (statErr || !stat?.length) {
    throw Object.assign(new Error('File not found in storage'), { status: 404 })
  }

  const { data: video, error: dbError } = await supabase
    .from('videos')
    .insert({
      user_id: userId,
      source_type: 'upload',
      storage_path: storagePath,
      status: 'ready',
      ...(durationMs ? { duration_ms: durationMs } : {}),
    })
    .select()
    .single()

  if (dbError || !video) {
    console.error('DB insert error:', dbError)
    throw Object.assign(new Error('Failed to create video record'), { status: 500 })
  }

  return { video_id: video.id }
}
