import type { SegmentLocal, FrameItem } from '@chai-cut/shared'
import { isFrameLayout, frameOf } from './frames'

// Media a frame's lanes show besides the main video: other uploaded videos and photos. The
// preview canvas draws them; this keeps one element per video item, in step with the main
// player (looping, since frames loop shorter videos), and plays each item's sound at the volume
// set for the export so the preview sounds like the result.

export interface FrameMediaPool {
  /** The element playing a video item */
  video: (item: FrameItem) => HTMLVideoElement | null
  image: (url: string) => HTMLImageElement | null
  /** Call every frame with the format being shown; plays/pauses/seeks its videos to match */
  sync: (seg: SegmentLocal | null, clipMs: number, playing: boolean, main?: HTMLVideoElement | null) => void
  dispose: () => void
}

// Start loading a video item this long before it appears, so it's ready on time
const PRELOAD_MS = 2000

export function createFrameMediaPool(getVideoUrl: (videoId: string) => string | undefined): FrameMediaPool {
  const videos = new Map<string, { el: HTMLVideoElement; videoId: string }>()
  const images = new Map<string, HTMLImageElement>()

  function video(item: FrameItem) {
    if (!item.source_video_id) return null
    let entry = videos.get(item.id)
    if (entry && entry.videoId !== item.source_video_id) { release(item.id); entry = undefined }
    if (!entry) {
      const url = getVideoUrl(item.source_video_id)
      if (!url) return null
      const el = document.createElement('video')
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      el.playsInline = true
      el.loop = true
      el.muted = true
      el.src = url
      entry = { el, videoId: item.source_video_id }
      videos.set(item.id, entry)
    }
    return entry.el
  }

  function release(id: string) {
    const e = videos.get(id)
    if (!e) return
    e.el.pause(); e.el.removeAttribute('src'); e.el.load()
    videos.delete(id)
  }

  function image(url: string) {
    let img = images.get(url)
    if (!img) {
      img = new Image()
      img.crossOrigin = 'anonymous'
      img.src = url
      images.set(url, img)
    }
    return img
  }

  function sync(seg: SegmentLocal | null, clipMs: number, playing: boolean, main?: HTMLVideoElement | null) {
    const frame = seg && isFrameLayout(seg.layout) ? frameOf(seg) : null
    // The main video's own sound in this frame
    if (main) {
      const vol = frame ? (frame.main_muted ? 0 : frame.main_volume ?? 1) : 1
      if (Math.abs(main.volume - vol) > 0.01) main.volume = Math.max(0, Math.min(1, vol))
    }
    const inUse = new Set<string>()
    for (const it of frame?.items ?? []) {
      if (it.kind !== 'video' || !it.source_video_id || !seg) continue
      const from = Math.max(it.start_ms, seg.start_ms), to = Math.min(it.end_ms, seg.end_ms)
      if (clipMs < from - PRELOAD_MS || clipMs >= to) continue
      const v = video(it)
      if (!v) continue
      inUse.add(it.id)
      if (!(v.duration > 0)) continue
      const showing = clipMs >= from
      // Where this item's video should be, looping over its own length
      const target = (((it.source_offset_ms ?? 0) + Math.max(0, clipMs - it.start_ms)) / 1000) % v.duration
      const drift = Math.abs(v.currentTime - target)
      const vol = it.muted ? 0 : it.volume ?? 1
      v.muted = !showing || vol <= 0
      v.volume = Math.max(0, Math.min(1, vol))
      if (playing && showing) {
        if (v.paused) v.play().catch(() => {})
        if (drift > 0.35 && drift < v.duration - 0.35) v.currentTime = target
      } else {
        if (!v.paused) v.pause()
        if (drift > 0.04) v.currentTime = target
      }
    }
    for (const [id, e] of videos) {
      if (inUse.has(id)) continue
      if (!e.el.paused) e.el.pause()
      e.el.muted = true
    }
    // Drop elements of items that no longer exist anywhere near here
    if (videos.size > 12) for (const id of [...videos.keys()]) if (!inUse.has(id)) release(id)
  }

  function dispose() {
    for (const id of [...videos.keys()]) release(id)
    images.clear()
  }

  return { video, image, sync, dispose }
}
