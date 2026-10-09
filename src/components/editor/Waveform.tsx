'use client'

import { useEffect, useRef, useState } from 'react'

/** How finely a sound's loudness is kept for drawing: this many values a second */
const PEAKS_PER_SEC = 100

// Each file is read once (by its storage path: signed links change), then reused by every bar
const cache = new Map<string, Promise<Float32Array | null>>()

/**
 * A sound file's loudness, PEAKS_PER_SEC times a second, 0–1 (its loudest moment = 1). The file
 * is decoded in the browser (Web Audio); null when it can't be read.
 */
function peaksOf(key: string, url: string): Promise<Float32Array | null> {
  let p = cache.get(key)
  if (!p) {
    p = (async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = await res.arrayBuffer()
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      try {
        const audio = await ctx.decodeAudioData(buf)
        const per = Math.max(1, Math.floor(audio.sampleRate / PEAKS_PER_SEC))
        const n = Math.ceil(audio.length / per)
        const out = new Float32Array(n)
        for (let c = 0; c < Math.min(2, audio.numberOfChannels); c++) {
          const d = audio.getChannelData(c)
          for (let i = 0; i < n; i++) {
            let m = out[i]
            const end = Math.min(d.length, (i + 1) * per)
            // Every 4th sample is plenty to find the peak, and 4× quicker
            for (let j = i * per; j < end; j += 4) { const v = Math.abs(d[j]); if (v > m) m = v }
            out[i] = m
          }
        }
        let top = 0
        for (let i = 0; i < n; i++) if (out[i] > top) top = out[i]
        if (top > 0) for (let i = 0; i < n; i++) out[i] /= top
        return out
      } finally {
        ctx.close().catch(() => {})
      }
    })().catch(() => null)
    cache.set(key, p)
  }
  return p
}

/**
 * The sound's waveform (as in CapCut): a bar for every few pixels, as tall as the sound is loud
 * there. Shows the part of the file from `offsetMs`, `durationMs` long, across its box; a thin
 * line while the file is read (or if it can't be).
 */
export function Waveform({ url, srcKey, offsetMs, durationMs, color = '#e9d5ff' }: {
  url?: string | null
  /** What the file is (its storage path), for reading it only once */
  srcKey?: string
  offsetMs: number
  durationMs: number
  color?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    if (!url) return
    let off = false
    peaksOf(srcKey || url, url).then(p => { if (!off) setPeaks(p) })
    return () => { off = true }
  }, [url, srcKey])

  useEffect(() => {
    const el = ref.current?.parentElement
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height)
      setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const c = ref.current
    const { w, h } = size
    if (!c || !w || !h) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = color
    const mid = h / 2
    if (!peaks || durationMs <= 0) {
      ctx.globalAlpha = 0.4
      ctx.fillRect(0, mid - 0.5, w, 1)
      return
    }
    // A 2 px bar every 3 px: the loudest moment in its stretch of the sound
    const STEP = 3
    const at = (x: number) => ((offsetMs + (x / w) * durationMs) / 1000) * PEAKS_PER_SEC
    for (let x = 0; x < w; x += STEP) {
      const a = Math.floor(at(x)), b = Math.max(a + 1, Math.ceil(at(x + STEP)))
      let m = 0
      for (let i = Math.max(0, a); i < b && i < peaks.length; i++) if (peaks[i] > m) m = peaks[i]
      const bh = Math.max(1, m * (h - 2))
      ctx.fillRect(x, mid - bh / 2, 2, bh)
    }
  }, [peaks, size, offsetMs, durationMs, color])

  return <canvas ref={ref} className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true" />
}
