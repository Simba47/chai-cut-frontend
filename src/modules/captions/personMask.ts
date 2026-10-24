'use client'

import type { ImageSegmenter } from '@mediapipe/tasks-vision'

/**
 * Where the person is in the preview's picture, for captions drawn behind them (the Creator styles
 * "Behind": creator.ts). MediaPipe's selfie segmenter — the same model the export uses
 * (backend person_mask.py; public/models/selfie_segmenter.tflite) — runs on a small copy of the
 * frame. The result is a canvas the size of that copy, opaque where the person is.
 *
 * It loads on first use (the runtime from the jsDelivr CDN, the version installed here); until it
 * is ready, or if it can't load, there is no mask and the words are drawn in front.
 */

const VERSION = '0.10.35'   // keep in step with package.json @mediapipe/tasks-vision
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`
const MODEL = '/models/selfie_segmenter.tflite'
const MASK_W = 256
const EDGE_LO = 0.35, EDGE_HI = 0.65    // as person_mask.py: confidence → a soft edge
const SMOOTH = 0.35
const EVERY_MS = 33                      // at most ~30 times a second

let segmenter: ImageSegmenter | null = null
let loading: Promise<void> | null = null
let failed = false
let small: HTMLCanvasElement | null = null
let mask: HTMLCanvasElement | null = null
let prev: Float32Array | null = null
let lastAt = 0
let lastT = NaN

function load() {
  if (loading) return
  loading = (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
    const files = await FilesetResolver.forVisionTasks(WASM)
    const make = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    })
    segmenter = await make('GPU').catch(() => make('CPU'))
  })().catch(e => { failed = true; console.warn('[captions] the person cut-out could not load; words go in front', e) })
}

/** The person in `frame` (a canvas holding the picture without captions), or null while it loads */
export function personMask(frame: HTMLCanvasElement, tMs: number): HTMLCanvasElement | null {
  if (failed || typeof document === 'undefined') return null
  if (!segmenter) { load(); return null }
  const now = performance.now()
  if (mask && (tMs === lastT || now - lastAt < EVERY_MS)) return mask
  lastAt = now
  lastT = tMs

  const w = MASK_W, h = Math.max(2, Math.round((frame.height * w) / frame.width))
  small ??= document.createElement('canvas')
  mask ??= document.createElement('canvas')
  if (small.width !== w || small.height !== h) { small.width = mask.width = w; small.height = mask.height = h; prev = null }
  small.getContext('2d')!.drawImage(frame, 0, 0, w, h)

  try {
    const res = segmenter.segmentForVideo(small, now)
    const masks = res.confidenceMasks ?? []
    const conf = masks[masks.length - 1]?.getAsFloat32Array()
    if (conf && conf.length === w * h) {
      const img = new ImageData(w, h)
      const next = new Float32Array(w * h)
      for (let i = 0; i < next.length; i++) {
        let m = Math.min(1, Math.max(0, (conf[i] - EDGE_LO) / (EDGE_HI - EDGE_LO)))
        if (prev) m = m * (1 - SMOOTH) + prev[i] * SMOOTH
        next[i] = m
        img.data[i * 4 + 3] = m * 255
      }
      prev = next
      mask.getContext('2d')!.putImageData(img, 0, 0)
    }
    res.close()
  } catch (e) {
    failed = true
    console.warn('[captions] the person cut-out failed; words go in front', e)
    return null
  }
  return mask
}
