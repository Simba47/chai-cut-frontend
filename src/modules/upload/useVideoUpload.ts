'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Uploads a video straight from the browser to R2 as a multipart upload: the file goes up in
// 16 MB parts, PARALLEL_PARTS at once (one at a time left most of the connection idle — each part
// also waited for its own signature from our server first; the parts' links are now asked for in
// batches). A failed part is retried on its own (three tries, with backoff), the upload waits
// while the browser is offline, and "Retry" after a failure continues with the parts R2 doesn't
// have yet instead of starting again. Our server only signs each request (/api/ingest/sign),
// which is where the plan's size and video-count limits are checked.

const PART_SIZE = 16 * 1024 * 1024
/** Parts going up at once (browsers open about 6 connections to one host) */
const PARALLEL_PARTS = 6
/** Part links signed per request to our server */
const SIGN_BATCH = 24
const PART_TRIES = 3

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

/** A refusal from our server (plan limit, file type…): shown as it is, and `final` ones can't be retried */
const userError = (message: string, final: boolean) => Object.assign(new Error(message), { userFacing: true, final })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/** Resolves once the browser is online (at once when it is) */
function online(): Promise<void> {
  if (typeof navigator === 'undefined' || navigator.onLine) return Promise.resolve()
  return new Promise(r => window.addEventListener('online', () => r(), { once: true }))
}

/** What a running (or interrupted) upload has got to: kept so Retry carries on from there */
interface Multipart { key: string; uploadId: string; etags: (string | null)[] }

/** `asset`: B-roll uploaded in the editor (kept off the dashboard, not counted as a video) */
export function useVideoUpload(onDone: (videoId: string) => void, { asset = false }: { asset?: boolean } = {}) {
  const [state, setState] = useState<UploadState>(IDLE)
  const fileRef = useRef<File | null>(null)
  const mpRef = useRef<Multipart | null>(null)
  /** Set once the file is in R2: a failure after that only needs the last step again */
  const uploadedKeyRef = useRef<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const xhrs = useRef(new Set<XMLHttpRequest>())
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  // Leaving the page mid-upload loses it: ask first. Unmounting stops it and removes the parts.
  const busy = state.phase === 'uploading' || state.phase === 'finishing'
  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy])
  useEffect(() => () => { stopAll(); abortMultipart(mpRef.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function sign(body: Record<string, unknown>) {
    const f = fileRef.current
    const res = await fetch('/api/ingest/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, file: f ? { name: f.name, size: f.size, type: f.type } : undefined, ...(asset ? { asset: true } : {}) }),
      signal: abortRef.current?.signal,
    })
    const data = await res.json().catch(() => ({}))
    // 4xx = we refused it (plan limit, file type…): show why, and don't offer Retry
    if (!res.ok) throw userError(data.error ?? 'Upload failed', res.status < 500)
    return data
  }

  function stopAll() {
    abortRef.current?.abort()
    for (const x of xhrs.current) x.abort()
    xhrs.current.clear()
  }
  function abortMultipart(mp: Multipart | null) {
    if (!mp) return
    fetch('/api/ingest/sign', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'DELETE', key: mp.key, uploadId: mp.uploadId }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(d => (d?.url ? fetch(d.url, { method: 'DELETE' }) : null))
      .catch(() => { /* the bucket's lifecycle rule is the backstop */ })
  }

  /** Start the multipart upload in R2: its key (from our server) and upload id (from R2) */
  async function create(file: File): Promise<Multipart> {
    const s = await sign({ method: 'POST', key: '' }) as { url: string; key: string; headers?: Record<string, string> }
    const res = await fetch(s.url, { method: 'POST', headers: s.headers, signal: abortRef.current?.signal })
    if (!res.ok) throw new Error(`Could not start the upload (${res.status})`)
    const uploadId = (await res.text()).match(/<UploadId>([^<]+)<\/UploadId>/)?.[1]
    if (!uploadId) throw new Error('Could not start the upload')
    return { key: s.key, uploadId, etags: Array(Math.max(1, Math.ceil(file.size / PART_SIZE))).fill(null) }
  }

  /** One part up (XHR: its progress counts as it goes). Resolves with its ETag. */
  function putPart(url: string, blob: Blob, onBytes: (n: number) => void): Promise<string> {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest()
      xhrs.current.add(x)
      x.open('PUT', url)
      x.upload.onprogress = e => onBytes(e.loaded)
      x.onload = () => {
        xhrs.current.delete(x)
        const etag = x.getResponseHeader('ETag')
        if (x.status >= 200 && x.status < 300 && etag) resolve(etag)
        else reject(new Error(`Part failed (${x.status})`))
      }
      x.onerror = () => { xhrs.current.delete(x); reject(new Error('Network error')) }
      x.onabort = () => { xhrs.current.delete(x); reject(Object.assign(new Error('Aborted'), { aborted: true })) }
      x.send(blob)
    })
  }

  /** Every part R2 doesn't have yet, PARALLEL_PARTS at once; progress over the whole file */
  async function uploadParts(file: File, mp: Multipart) {
    const n = mp.etags.length
    const sent = new Array<number>(n).fill(0)
    mp.etags.forEach((e, i) => { if (e) sent[i] = Math.min(PART_SIZE, file.size - i * PART_SIZE) })
    const report = () => {
      const done = sent.reduce((a, b) => a + b, 0)
      setState(s => (s.phase === 'uploading' ? { ...s, progress: Math.min(99, Math.round((done / file.size) * 100)) } : s))
    }
    report()
    const todo = mp.etags.map((e, i) => (e ? -1 : i)).filter(i => i >= 0)
    const urls = new Map<number, string>()
    /** Links for the next parts, signed in batches ahead of need */
    let signing: Promise<void> | null = null
    async function urlFor(i: number): Promise<string> {
      while (!urls.has(i)) {
        if (!signing) {
          const want = todo.filter(j => !urls.has(j)).slice(0, SIGN_BATCH)
          signing = sign({ method: 'PUT', key: mp.key, uploadId: mp.uploadId, partNumbers: want.map(j => j + 1) })
            .then((d: { urls: Record<string, string> }) => { for (const j of want) if (d.urls[j + 1]) urls.set(j, d.urls[j + 1]) })
            .finally(() => { signing = null })
        }
        await signing
      }
      return urls.get(i)!
    }
    let next = 0
    async function worker() {
      while (next < todo.length) {
        const i = todo[next++]
        const blob = file.slice(i * PART_SIZE, Math.min(file.size, (i + 1) * PART_SIZE))
        for (let attempt = 1; ; attempt++) {
          await online()
          try {
            const etag = await putPart(await urlFor(i), blob, b => { sent[i] = b; report() })
            mp.etags[i] = etag
            sent[i] = blob.size
            report()
            break
          } catch (e) {
            const info = e as { aborted?: boolean; userFacing?: boolean }
            if (info.aborted || info.userFacing || abortRef.current?.signal.aborted || attempt >= PART_TRIES) throw e
            sent[i] = 0
            urls.delete(i)   // (a link that failed may have run out: a fresh one)
            await sleep(1000 * 2 ** (attempt - 1))
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, todo.length) }, worker))
  }

  /** All parts are in: R2 joins them into the file */
  async function complete(mp: Multipart) {
    const s = await sign({ method: 'POST', key: mp.key, uploadId: mp.uploadId }) as { url: string }
    const body = `<CompleteMultipartUpload>${mp.etags.map((e, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${e}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
    const res = await fetch(s.url, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body, signal: abortRef.current?.signal })
    const text = await res.text()
    if (!res.ok || /<Error>/.test(text)) throw new Error('Could not finish the upload')
  }

  async function finish(file: File, key: string) {
    setState(s => ({ ...s, phase: 'finishing', progress: 100 }))
    const durationMs = await readDurationMs(file)
    const res = await fetch('/api/ingest/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storage_path: key, title: file.name.replace(/\.[^.]+$/, ''), ...(durationMs ? { duration_ms: durationMs } : {}), ...(asset ? { asset: true } : {}) }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw userError(data.error ?? 'Upload failed', res.status < 500)
    return data.video_id as string
  }

  async function run() {
    const file = fileRef.current
    if (!file) return
    abortRef.current = new AbortController()
    try {
      let key = uploadedKeyRef.current
      if (!key) {
        await online()
        if (!mpRef.current) mpRef.current = await create(file)
        const mp = mpRef.current
        await uploadParts(file, mp)
        await complete(mp)
        key = mp.key
        uploadedKeyRef.current = key
        mpRef.current = null
      }
      const videoId = await finish(file, key)
      setState(IDLE)
      fileRef.current = null; uploadedKeyRef.current = null
      onDoneRef.current(videoId)
    } catch (e) {
      if (fileRef.current !== file) return   // cancelled, or another upload started
      stopAll()
      const info = e as { userFacing?: boolean; final?: boolean }
      const message = e instanceof Error && info.userFacing
        ? e.message
        : 'The upload was interrupted. Check your connection and press Retry — it continues where it stopped.'
      setState(s => ({ ...s, phase: 'failed', error: message, canRetry: !info.final }))
    }
  }

  const start = useCallback((file: File) => {
    stopAll()
    abortMultipart(mpRef.current)
    fileRef.current = file
    mpRef.current = null
    uploadedKeyRef.current = null
    setState({ phase: 'uploading', fileName: file.name, progress: 0, error: null, canRetry: false })
    run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const retry = useCallback(() => {
    if (!fileRef.current) return
    setState(s => ({ ...s, phase: 'uploading', error: null, canRetry: false }))
    run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Stop the upload and remove what reached R2 */
  const cancel = useCallback(() => {
    fileRef.current = null
    stopAll()
    // The parts of an unfinished upload go with it
    abortMultipart(mpRef.current)
    mpRef.current = null
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
    uploadedKeyRef.current = null
    setState(IDLE)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { state, start, retry, cancel }
}
