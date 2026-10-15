'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * A storyboard of a video: still frames across all of it, so dragging along the video can show
 * each moment at once (like YouTube's previews) while the player itself is still decoding the
 * real frame. A heavy original — full size, a full picture only every few seconds — can take a
 * second or more per jump; a picture from here is there in no time.
 *
 * One hidden video grabs the frames one after another, coarse first (every 16 steps, then every
 * 8, 4, 2, 1), so the whole video is covered early and sharpens as more arrive. At most ~240
 * frames (one a second for a short video), 480 px wide, kept as JPEG blobs.
 *
 * Grabbing decodes the same video as the player, so it waits while `busy` says the player needs
 * the machine (playing, or being dragged): it never makes playback or dragging stutter.
 */

const W = 480
const MAX_FRAMES = 240

function once(el: HTMLMediaElement, event: string, timeoutMs: number): Promise<boolean> {
  return new Promise(resolve => {
    const done = (ok: boolean) => { clearTimeout(t); el.removeEventListener(event, onEvent); resolve(ok) }
    const onEvent = () => done(true)
    const t = setTimeout(() => done(false), timeoutMs)
    el.addEventListener(event, onEvent, { once: true })
  })
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Frames of `src` (`durationMs` long), grabbed once `start` is true and only while `busy` is
 * false. Returns `frameAt(ms)`: the nearest frame grabbed so far, or null when none is near
 * enough to pass for that moment.
 */
export function useStoryboard(src: string | null | undefined, durationMs: number | null | undefined, start: boolean, busy: boolean) {
  const frames = useRef(new Map<number, string>())
  const step = useRef(1000)
  const busyRef = useRef(busy)
  busyRef.current = busy

  useEffect(() => {
    frames.current = new Map()
    if (!src || !start || !durationMs || durationMs <= 0) return
    // The finest step: a whole half second, at least one second, ~MAX_FRAMES over the video
    const finest = Math.max(1000, Math.ceil(durationMs / MAX_FRAMES / 500) * 500)
    step.current = finest
    const order: number[] = []
    const seen = new Set<number>()
    for (let s = finest * 16; s >= finest; s /= 2) {
      for (let t = 0; t < durationMs; t += s) if (!seen.has(t)) { seen.add(t); order.push(t) }
    }

    let alive = true
    const made: string[] = []
    const video = document.createElement('video')
    video.crossOrigin = 'anonymous'   // (to read its pixels: the bucket allows it, as for thumbnails)
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = src
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    void (async () => {
      if (video.readyState < 1 && !(await once(video, 'loadedmetadata', 20_000))) return
      for (const ms of order) {
        while (alive && busyRef.current) await sleep(250)
        if (!alive) return
        video.currentTime = Math.min(ms / 1000, Math.max(0, video.duration - 0.05))
        const ok = await once(video, 'seeked', 8000)
        if (!alive) return
        if (!ok || !ctx || !video.videoWidth) continue
        canvas.width = W
        canvas.height = Math.round(W * video.videoHeight / video.videoWidth)
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        } catch {
          return   // its pixels can't be read (no CORS): no storyboard, dragging still works
        }
        const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.78))
        if (!alive || !blob) continue
        const url = URL.createObjectURL(blob)
        made.push(url)
        frames.current.set(ms, url)
      }
    })()

    return () => {
      alive = false
      video.removeAttribute('src')
      video.load()   // (stops its download)
      // (a moment later: a picture still on screen keeps its address until it is swapped out)
      setTimeout(() => made.forEach(u => URL.revokeObjectURL(u)), 2000)
    }
  }, [src, durationMs, start])

  return useCallback((ms: number): string | null => {
    // Near enough: within a few steps (early on only the coarse frames are there)
    let best: string | null = null, bestD = step.current * 4
    for (const [t, url] of frames.current) {
      const d = Math.abs(t - ms)
      if (d <= bestD) { bestD = d; best = url }
    }
    return best
  }, [])
}
