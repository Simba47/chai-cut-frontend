import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { CropBoxLocal, SegmentLocal } from '@chai-cut/shared'
import { isFrameLayout } from './frames'

/**
 * A split/trio slot showing the clip's own video at another moment (a "borrowed" reaction made
 * by Make my clips): its crop box names the clip's own video, from source_offset_ms on.
 */
export function isBorrowedSlot(seg: SegmentLocal | null | undefined, box: CropBoxLocal | undefined, mainVideoId: string | null | undefined) {
  return !!seg && !!box && !!mainVideoId && !isFrameLayout(seg.layout) && box.source_video_id === mainVideoId
}

/**
 * The B-roll videos the preview draws in place of the main video (OutputCanvas sourceFor): one
 * element per video, kept in step with the main player on every frame. Muted (the default) the
 * speaker keeps talking under the shot; with its sound on it plays instead — as in the export.
 */
export function useBrollSources(
  videoRef: RefObject<HTMLVideoElement | null>,
  clipStartMs: number,
  getUrl: (videoId: string) => string | undefined,
  /** The clip's own video: slots showing it are borrowed reactions (useBorrowedSlots), not B-roll */
  mainVideoId?: string | null,
  /** Parts of the clip were removed (lib/trims.ts): the main video's time (ms) → clip time */
  videoToTimeline?: (videoMs: number) => number,
) {
  const els = useRef(new Map<string, HTMLVideoElement>())
  const active = useRef<string | null>(null)
  const getUrlRef = useRef(getUrl)
  getUrlRef.current = getUrl
  const toTimelineRef = useRef(videoToTimeline)
  toTimelineRef.current = videoToTimeline

  return useCallback((seg: SegmentLocal | null) => {
    const box = seg && !isFrameLayout(seg.layout) ? seg.crop_boxes[0] : undefined
    const pictureId = box?.source_video_id && box.source_video_id !== mainVideoId ? box.source_video_id : null
    // A hidden added video with its sound on: played for its sound only (the main video is the picture)
    const sound = !pictureId ? seg?.sound_only ?? null : null
    const id = pictureId ?? sound?.video_id ?? null
    if (active.current && active.current !== id) els.current.get(active.current)?.pause()
    active.current = id
    const main = videoRef.current
    if (!seg || !id || !main) return null
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
    // Its own sound when switched on (the main video is quiet under it then, as in the export)
    el.muted = sound ? false : box?.muted !== false
    el.volume = Math.max(0, Math.min(1, (sound ? sound.volume : box?.volume) ?? 1))
    const rel = toTimelineRef.current ? toTimelineRef.current(main.currentTime * 1000) : main.currentTime * 1000 - clipStartMs
    const want = ((sound ? sound.offset_ms : box?.source_offset_ms ?? 0) + rel - seg.start_ms) / 1000
    // Playing: only re-seek on real drift (a seek stalls the picture). Paused (dragging the
    // playhead): follow the main video's frame exactly. Never a new seek over one still running:
    // this runs every frame, so the next frame after it lands seeks to the latest time.
    if (!el.seeking && Math.abs(el.currentTime - want) > (main.paused ? 0.04 : 0.3)) el.currentTime = Math.max(0, want)
    if (main.paused && !el.paused) el.pause()
    if (!main.paused && el.paused) el.play().catch(() => {})
    return sound ? null : el
  }, [videoRef, clipStartMs, mainVideoId])
}

/** How far ahead the next part's borrowed slots are parked on their first frame */
const LOOKAHEAD_MS = 1500
/** Most video elements a player keeps for borrowed slots (a trio needs 2, plus 2 parked ahead) */
const POOL_SIZE = 4

/**
 * The pictures of borrowed reaction slots: a few muted elements of the clip's own video, reused
 * from part to part. Each frame `sync` keeps the slots on screen in step with the main player and
 * parks the next part's slots on their first frame LOOKAHEAD_MS ahead, so a split or trio starts
 * on time (no seek at the switch). Elements are only made when first needed (nothing loads
 * until a clip plays), and never more than POOL_SIZE: a browser streams only a few videos from
 * one server at once, and more would starve the main video.
 */
export class BorrowedPool {
  private entries: Array<{ el: HTMLVideoElement; box: string | null; used: number }> = []

  constructor(private url: string, private mainVideoId: string) {}

  private assign(boxId: string, protect: Set<string>): { el: HTMLVideoElement; fresh: boolean } | null {
    const now = performance.now()
    const have = this.entries.find(e => e.box === boxId)
    if (have) { have.used = now; return { el: have.el, fresh: false } }
    let e = this.entries.find(x => x.box === null)
    if (!e && this.entries.length < POOL_SIZE) {
      const el = document.createElement('video')
      el.muted = true
      el.playsInline = true
      el.preload = 'auto'
      el.crossOrigin = 'anonymous'
      el.src = this.url
      e = { el, box: null, used: now }
      this.entries.push(e)
    }
    if (!e) e = this.entries.filter(x => !x.box || !protect.has(x.box)).sort((a, b) => a.used - b.used)[0]
    if (!e) return null
    e.el.pause()
    e.box = boxId
    e.used = now
    return { el: e.el, fresh: true }
  }

  /** Keep the slots at `rel` (clip ms) in step and park the next part's slots ahead of time */
  sync(segments: SegmentLocal[], rel: number, playing: boolean) {
    const borrowedOf = (seg: SegmentLocal | undefined) => (seg ? seg.crop_boxes.filter(b => isBorrowedSlot(seg, b, this.mainVideoId)) : [])
    const seg = segments.find(s => rel >= s.start_ms && rel < s.end_ms)
    const next = segments.filter(s => s.start_ms > rel && s.start_ms - rel <= LOOKAHEAD_MS).sort((a, b) => a.start_ms - b.start_ms)[0]
    const cur = borrowedOf(seg), ahead = borrowedOf(next)
    const keep = new Set([...cur, ...ahead].map(b => b.id))
    for (const e of this.entries) if (e.box && !cur.some(b => b.id === e.box) && !e.el.paused) e.el.pause()
    for (const b of ahead) {
      const got = this.assign(b.id, keep)
      if (got?.fresh) got.el.currentTime = Math.max(0, (b.source_offset_ms ?? 0) / 1000)
    }
    for (const b of cur) {
      const got = this.assign(b.id, keep)
      if (!got || !seg) continue
      const want = ((b.source_offset_ms ?? 0) + rel - seg.start_ms) / 1000
      // Playing: only re-seek on real drift (seeking stalls the picture); paused: follow exactly
      if (got.fresh || Math.abs(got.el.currentTime - want) > (playing ? 0.35 : 0.05)) got.el.currentTime = Math.max(0, want)
      if (playing && got.el.paused) got.el.play().catch(() => {})
      if (!playing && !got.el.paused) got.el.pause()
    }
  }

  /** The element showing this slot, or false while it isn't ready to draw */
  source(boxId: string): HTMLVideoElement | false {
    const e = this.entries.find(x => x.box === boxId)
    return e && e.el.readyState >= 2 ? e.el : false
  }

  /** Stop and drop every element (stops their downloads) */
  dispose() {
    for (const e of this.entries) { e.el.pause(); e.el.removeAttribute('src'); e.el.load() }
    this.entries = []
  }
}

/**
 * The borrowed reaction slots' pictures in the editor (OutputCanvas slotSourceFor), from a
 * BorrowedPool kept in step with the main player. `track` gives it the clip's parts, so it can
 * park the next part's slots ahead of time.
 */
export function useBorrowedSlots(
  videoRef: RefObject<HTMLVideoElement | null>,
  clipStartMs: number,
  mainVideoId: string | null | undefined,
  mainUrl: string | null | undefined,
  /** Parts of the clip were removed (lib/trims.ts): the main video's time (ms) → clip time */
  videoToTimeline?: (videoMs: number) => number,
) {
  const pool = useRef<BorrowedPool | null>(null)
  const segs = useRef<SegmentLocal[]>([])
  const toTimelineRef = useRef(videoToTimeline)
  toTimelineRef.current = videoToTimeline
  useEffect(() => {
    if (!mainUrl || !mainVideoId) return
    pool.current = new BorrowedPool(mainUrl, mainVideoId)
    return () => { pool.current?.dispose(); pool.current = null }
  }, [mainUrl, mainVideoId])

  const slotSourceFor = useCallback((seg: SegmentLocal | null, box: CropBoxLocal) => {
    if (!isBorrowedSlot(seg, box, mainVideoId)) return null
    const main = videoRef.current
    if (!seg || !main || !pool.current) return false
    const rel = toTimelineRef.current ? toTimelineRef.current(main.currentTime * 1000) : main.currentTime * 1000 - clipStartMs
    pool.current.sync(segs.current.length ? segs.current : [seg], rel, !main.paused)
    return pool.current.source(box.id)
  }, [videoRef, clipStartMs, mainVideoId])

  const track = useCallback((segments: SegmentLocal[]) => { segs.current = segments }, [])

  return { slotSourceFor, track }
}
