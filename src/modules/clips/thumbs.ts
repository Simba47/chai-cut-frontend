'use client'

import { useEffect, useState } from 'react'

/**
 * Still frames of a video at given moments, for clip and suggestion thumbnails. One hidden video
 * per source grabs the frames one after another (seek → draw → JPEG); results are cached for the
 * page, so a card that re-renders or comes back shows its picture straight away.
 */

const W = 192, H = 108
const cache = new Map<string, string>()
const waiters = new Map<string, Array<(url: string | null) => void>>()
type Job = { key: string; atSec: number }
const queues = new Map<string, { video: HTMLVideoElement; jobs: Job[]; busy: boolean }>()

function keyOf(src: string, ms: number) { return `${src}#${Math.round(ms / 100)}` }

function settle(key: string, url: string | null) {
  if (url) cache.set(key, url)
  for (const w of waiters.get(key) ?? []) w(url)
  waiters.delete(key)
}

async function run(src: string) {
  const q = queues.get(src)
  if (!q || q.busy) return
  q.busy = true
  const { video } = q
  const canvas = document.createElement('canvas')
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')
  try {
    if (video.readyState < 1) {
      await new Promise<void>(r => {
        const t = setTimeout(r, 8000)
        video.addEventListener('loadedmetadata', () => { clearTimeout(t); r() }, { once: true })
      })
    }
    while (q.jobs.length) {
      const job = q.jobs.shift()!
      if (cache.has(job.key)) { settle(job.key, cache.get(job.key)!); continue }
      const dur = video.duration
      const at = isFinite(dur) && dur > 0 ? Math.min(job.atSec, Math.max(0, dur - 0.1)) : job.atSec
      video.currentTime = at
      await new Promise<void>(r => {
        const t = setTimeout(r, 4000)
        video.addEventListener('seeked', () => { clearTimeout(t); r() }, { once: true })
      })
      let url: string | null = null
      try {
        if (ctx && video.videoWidth) {
          // Cover the 16:9 thumbnail, like object-fit: cover
          const s = Math.max(W / video.videoWidth, H / video.videoHeight)
          const dw = video.videoWidth * s, dh = video.videoHeight * s
          ctx.drawImage(video, (W - dw) / 2, (H - dh) / 2, dw, dh)
          url = canvas.toDataURL('image/jpeg', 0.7)
        }
      } catch { url = null }   // a source without CORS can't be read: no thumbnail
      settle(job.key, url)
    }
  } finally {
    q.busy = false
  }
}

function request(src: string, ms: number): Promise<string | null> {
  const key = keyOf(src, ms)
  if (cache.has(key)) return Promise.resolve(cache.get(key)!)
  return new Promise(resolve => {
    const list = waiters.get(key)
    if (list) { list.push(resolve); return }
    waiters.set(key, [resolve])
    let q = queues.get(src)
    if (!q) {
      const video = document.createElement('video')
      video.crossOrigin = 'anonymous'
      video.preload = 'auto'
      video.muted = true
      video.playsInline = true
      video.src = src
      q = { video, jobs: [], busy: false }
      queues.set(src, q)
    }
    q.jobs.push({ key, atSec: ms / 1000 })
    void run(src)
  })
}

/** A thumbnail of `src` at `ms` (a little into the moment, so it isn't a cut's first frame); null until ready */
export function useFrameAt(src: string | null | undefined, ms: number): string | null {
  const at = ms + 600
  const [url, setUrl] = useState<string | null>(() => (src ? cache.get(keyOf(src, at)) ?? null : null))
  useEffect(() => {
    if (!src) return
    let alive = true
    const hit = cache.get(keyOf(src, at))
    if (hit) { setUrl(hit); return }
    request(src, at).then(u => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [src, at])
  return url
}
