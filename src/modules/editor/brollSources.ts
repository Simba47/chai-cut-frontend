import { useCallback, useRef, type RefObject } from 'react'
import type { SegmentLocal } from '@chai-cut/shared'
import { isFrameLayout } from './frames'

/**
 * The B-roll videos the preview draws in place of the main video (OutputCanvas sourceFor): one
 * muted element per video, kept in step with the main player on every frame. The speaker keeps
 * talking under the shot, as in the export.
 */
export function useBrollSources(
  videoRef: RefObject<HTMLVideoElement | null>,
  clipStartMs: number,
  getUrl: (videoId: string) => string | undefined,
) {
  const els = useRef(new Map<string, HTMLVideoElement>())
  const active = useRef<string | null>(null)
  const getUrlRef = useRef(getUrl)
  getUrlRef.current = getUrl

  return useCallback((seg: SegmentLocal | null) => {
    const box = seg && !isFrameLayout(seg.layout) ? seg.crop_boxes[0] : undefined
    const id = box?.source_video_id ?? null
    if (active.current && active.current !== id) els.current.get(active.current)?.pause()
    active.current = id
    const main = videoRef.current
    if (!seg || !box || !id || !main) return null
    let el = els.current.get(id)
    if (!el) {
      const url = getUrlRef.current(id)
      if (!url) return null
      el = document.createElement('video')
      el.muted = true
      el.playsInline = true
      el.preload = 'auto'
      el.crossOrigin = 'anonymous'
      el.src = url
      els.current.set(id, el)
    }
    const rel = main.currentTime * 1000 - clipStartMs
    const want = ((box.source_offset_ms ?? 0) + rel - seg.start_ms) / 1000
    if (Math.abs(el.currentTime - want) > 0.3) el.currentTime = Math.max(0, want)
    if (main.paused && !el.paused) el.pause()
    if (!main.paused && el.paused) el.play().catch(() => {})
    return el
  }, [videoRef, clipStartMs])
}
