'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Uppy from '@uppy/core'
import AwsS3 from '@uppy/aws-s3'

// Uploads a video straight from the browser to R2 as a multipart upload (Uppy): the file goes up
// in 16 MB parts, a failed part is retried on its own (three tries, with backoff), the upload
// waits while the browser is offline, and "Retry" after a failure continues from the parts R2
// already has instead of starting again. Our server only signs each request (/api/ingest/sign),
// which is where the plan's size and video-count limits are checked.

const PART_SIZE = 16 * 1024 * 1024

export type UploadPhase = 'idle' | 'uploading' | 'finishing' | 'failed'

export interface UploadState {
  phase: UploadPhase
  fileName: string
  /** 0–100 */
  progress: number
  error: string | null
  /** A failed upload can continue (connection problems); a refused one can't (plan limit, file type) */
  canRetry: boolean
}

const IDLE: UploadState = { phase: 'idle', fileName: '', progress: 0, error: null, canRetry: false }

async function readDurationMs(file: File): Promise<number | undefined> {
  try {
    return await new Promise<number>((resolve, reject) => {
      const v = document.createElement('video')
      v.preload = 'metadata'
      const url = URL.createObjectURL(file)
      v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Math.round(v.duration * 1000)) }
      v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('metadata')) }
      v.src = url
    })
  } catch {
    return undefined // e.g. a format this browser can't read; the worker fills it in later
  }
}

export function useVideoUpload(onDone: (videoId: string) => void) {
  const [state, setState] = useState<UploadState>(IDLE)
  const uppyRef = useRef<Uppy | null>(null)
  const fileRef = useRef<File | null>(null)
  const uppyFileIdRef = useRef<string | null>(null)
  /** Set once the file is in R2: a failure after that only needs the last step again */
  const uploadedKeyRef = useRef<string | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  function getUppy() {
    if (uppyRef.current) return uppyRef.current
    const uppy = new Uppy({ autoProceed: false, allowMultipleUploadBatches: true })
    uppy.use(AwsS3, {
      shouldUseMultipart: true,
      getChunkSize: () => PART_SIZE,
      limit: 1,
      signRequest: async request => {
        const f = fileRef.current
        const res = await fetch('/api/ingest/sign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...request, file: f ? { name: f.name, size: f.size, type: f.type } : undefined }),
        })
        const data = await res.json().catch(() => ({}))
        // 4xx = we refused it (plan limit, file type…): show why, and don't offer Retry
        if (!res.ok) throw Object.assign(new Error(data.error ?? 'Upload failed'), { userFacing: true, final: res.status < 500 })
        return data
      },
    })
    uppy.on('upload-progress', (_file, p) => {
      if (p.bytesTotal) setState(s => ({ ...s, progress: Math.min(99, Math.round((p.bytesUploaded / p.bytesTotal!) * 100)) }))
    })
    uppyRef.current = uppy
    return uppy
  }

  // Leaving the page mid-upload loses it: ask first. Unmounting cancels the upload in R2 too,
  // so no half-finished parts are left behind.
  const busy = state.phase === 'uploading' || state.phase === 'finishing'
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])
  useEffect(() => () => { uppyRef.current?.destroy(); uppyRef.current = null }, [])

  async function finish(file: File, key: string) {
    setState(s => ({ ...s, phase: 'finishing', progress: 100 }))
    const durationMs = await readDurationMs(file)
    const res = await fetch('/api/ingest/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path: key, title: file.name.replace(/\.[^.]+$/, ''), ...(durationMs ? { duration_ms: durationMs } : {}) }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw Object.assign(new Error(data.error ?? 'Upload failed'), { userFacing: true, final: res.status < 500 })
    return data.video_id as string
  }

  async function run(retrying: boolean) {
    const file = fileRef.current
    if (!file) return
    try {
      let key = uploadedKeyRef.current
      if (!key) {
        const uppy = getUppy()
        const result = retrying && uppyFileIdRef.current
          ? await uppy.retryUpload(uppyFileIdRef.current)
          : await uppy.upload()
        const failed = result?.failed?.[0]
        if (failed || !result?.successful?.length) {
          const cause = failed?.error as unknown
          throw typeof cause === 'string' ? new Error(cause) : (cause instanceof Error ? cause : new Error('Upload failed'))
        }
        key = (result.successful[0].response?.body as { key?: string } | undefined)?.key ?? null
        if (!key) throw new Error('Upload failed')
        uploadedKeyRef.current = key
      }
      const videoId = await finish(file, key)
      setState(IDLE)
      uppyRef.current?.clear()
      fileRef.current = null; uppyFileIdRef.current = null; uploadedKeyRef.current = null
      onDoneRef.current(videoId)
    } catch (e) {
      const info = e as { userFacing?: boolean; final?: boolean }
      const message = e instanceof Error && info.userFacing
        ? e.message
        : 'The upload was interrupted. Check your connection and press Retry — it continues where it stopped.'
      setState(s => ({ ...s, phase: 'failed', error: message, canRetry: !info.final }))
    }
  }

  const start = useCallback((file: File) => {
    const uppy = getUppy()
    uppy.cancelAll()
    fileRef.current = file
    uploadedKeyRef.current = null
    uppyFileIdRef.current = uppy.addFile({ name: file.name, type: file.type || 'video/mp4', data: file, source: 'Local', isRemote: false })
    setState({ phase: 'uploading', fileName: file.name, progress: 0, error: null, canRetry: false })
    run(false)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    if (!fileRef.current) return
    setState(s => ({ ...s, phase: 'uploading', error: null, canRetry: false }))
    run(true)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Stop the upload and remove what reached R2 */
  const cancel = useCallback(() => {
    // Parts of an unfinished upload are removed by Uppy (it aborts the multipart upload)
    uppyRef.current?.cancelAll()
    // A file that finished uploading but never became a video (the last step failed) is removed
    // here; the server refuses if it already belongs to a video
    const orphan = uploadedKeyRef.current
    if (orphan) {
      fetch('/api/ingest/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'DELETE', key: orphan }),
      })
        .then(r => (r.ok ? r.json() : null))
        .then(d => (d?.url ? fetch(d.url, { method: 'DELETE' }) : null))
        .catch(() => { /* the bucket's lifecycle rule is the backstop */ })
    }
    fileRef.current = null; uppyFileIdRef.current = null; uploadedKeyRef.current = null
    setState(IDLE)
  }, [])

  return { state, start, retry, cancel }
}
