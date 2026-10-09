'use client'

import { useRef, useState, useEffect, useLayoutEffect, useCallback, Fragment } from 'react'
import type { SegmentLocal, LayoutType, TextOverlay, FrameItem, FrameLane, FrameLayout } from '@chai-cut/shared'
import type { TrackRef } from '@/modules/editor/tracks'
import { Waveform } from './Waveform'
import { useLiveTimeMs, liveTime, usePlayerStore } from '@/modules/player/store'
import { isFrameLayout, FRAME_TEMPLATES, frameLanesFor, frameOf, laneItems, itemBounds, MIN_ITEM_MS } from '@/modules/editor/frames'
import { isShot } from '@/modules/editor/shots'

export const LAYOUT_COLORS: Record<LayoutType, string> = {
  vertical:   '#22c55e',
  split:      '#3b82f6',
  trio:       '#f59e0b',
  spotlight:  '#ef4444',
  centered:   '#06b6d4',
  horizontal: '#ec4899',
  // Frames share one colour so they read as "a frame" on the timeline
  frame_single: '#2dd4bf',
  frame_video_photo: '#2dd4bf',
  frame_dual: '#2dd4bf',
  frame_dual_letterbox: '#2dd4bf',
  frame_triple: '#2dd4bf',
  frame_title_caption: '#2dd4bf',
  frame_big_small: '#2dd4bf',
  frame_photo_story: '#2dd4bf',
}

// Frame lane items: one colour per kind of media
export const FRAME_ITEM_COLORS = { video: '#60a5fa', photo: '#34d399', text: '#f472b6', captions: '#facc15', main: '#2dd4bf' } as const
export const frameItemColor = (it: FrameItem) => it.captions ? FRAME_ITEM_COLORS.captions : FRAME_ITEM_COLORS[it.kind]
const FRAME_LANE_H = 26
// Frames not under the playhead keep their lanes, shrunk to thin lines
const THIN_H = 4, THIN_GAP = 2

/**
 * The lanes a frame shows on the timeline. The band's lane appears once text is on it (the band
 * itself is always in the preview, with its own "Add text" button). A Single frame's slot is just
 * the main video — the film strip already shows that — so it only gets a lane once something is
 * put on it.
 */
function visibleLanes(seg: SegmentLocal) {
  const frame = frameOf(seg)
  const main = frame.main_slots ?? [0]
  const slots = FRAME_TEMPLATES[seg.layout as FrameLayout].rows.filter(r => r.kind === 'slot').length
  return frameLanesFor(seg).filter(r => {
    const empty = laneItems(frame, r.lane, seg).length === 0
    if (r.lane === 'band') return !empty
    return !(slots === 1 && main.includes(r.lane) && empty)
  })
}

/** Frames are captured this tall (px) in the video's own shape: sharp when shown smaller, on any screen */
const CAPTURE_H = 180
const THUMB_COUNT = 24

// Frames already captured, per video file, by their time in the video (ms). When the clip's
// start or end is dragged the strip is laid out again many times a second: each thumbnail first
// takes the nearest frame already captured (so nothing goes blank), and only the frames missing —
// the new footage — are captured.
const thumbCache = new Map<string, Map<number, string>>()
function nearestThumb(cache: Map<number, string>, ms: number, tol: number): string | undefined {
  let best: string | undefined, bestD = tol
  for (const [t, url] of cache) { const d = Math.abs(t - ms); if (d <= bestD) { bestD = d; best = url } }
  return best
}

// ── Grabbing frames without slowing the editor ──
// Every strip used to open its own hidden copy of its video, loading eagerly: they took the
// browser's few connections to the server away from the main video, and dragging the playhead
// lagged. Now there is one hidden copy per file, shared by every strip that shows it; it loads
// only what each seek needs, only one file is grabbed from at a time, and a copy nobody has
// used for a while is let go (it stops loading).
const GRAB_AT_ONCE = 1
const LET_GO_AFTER_MS = 15000
let grabbing = 0
const grabQueue: Array<() => void> = []
async function takeGrabTurn() {
  if (grabbing < GRAB_AT_ONCE) { grabbing++; return }
  await new Promise<void>(r => grabQueue.push(r))  // the turn is handed over as it is (grabbing stays)
}
function endGrabTurn() {
  const next = grabQueue.shift()
  if (next) next()
  else grabbing--
}
interface Grabber { el: HTMLVideoElement; chain: Promise<void>; jobs: number; idle: ReturnType<typeof setTimeout> | null }
const grabbers = new Map<string, Grabber>()
function grabberFor(url: string): Grabber {
  let g = grabbers.get(url)
  if (!g) {
    const el = document.createElement('video')
    el.crossOrigin = 'anonymous'
    el.preload = 'metadata'
    el.muted = true
    el.src = url
    g = { el, chain: Promise.resolve(), jobs: 0, idle: null }
    grabbers.set(url, g)
  }
  if (g.idle) { clearTimeout(g.idle); g.idle = null }
  return g
}
function jobDone(url: string, g: Grabber) {
  if (--g.jobs > 0) return
  g.idle = setTimeout(() => {
    if (grabbers.get(url) !== g || g.jobs > 0) return
    g.el.removeAttribute('src'); g.el.load()
    grabbers.delete(url)
  }, LET_GO_AFTER_MS)
}
/**
 * Frames of a video at these times (ms in the video), one after another, `onFrame` with each as it
 * is ready. `onShape` first gets the video's width / height: false stops there (the caller lays
 * its frames out again for that shape and asks again).
 */
function grabFrames(url: string, times: Array<{ i: number; ms: number }>, opts: {
  onFrame: (i: number, dataUrl: string, ms: number) => void
  onShape?: (shape: number) => boolean
  cancelled: () => boolean
}) {
  const g = grabberFor(url)
  g.jobs++
  g.chain = g.chain.then(async () => {
    if (opts.cancelled()) return
    await takeGrabTurn()
    try {
      const vid = g.el
      if (vid.readyState < 1) {
        await new Promise<void>(r => {
          const done = () => r()
          vid.addEventListener('loadedmetadata', done, { once: true })
          vid.addEventListener('error', done, { once: true })
          setTimeout(done, 15000)
        })
      }
      const durSec = vid.duration
      if (opts.cancelled() || !durSec || !isFinite(durSec)) return
      // In the video's own shape (not squeezed), big enough to stay sharp
      const shape = vid.videoWidth && vid.videoHeight ? vid.videoWidth / vid.videoHeight : 16 / 9
      if (opts.onShape && !opts.onShape(shape)) return
      const canvas = document.createElement('canvas')
      canvas.height = CAPTURE_H
      canvas.width = Math.round(CAPTURE_H * shape)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      for (const { i, ms } of times) {
        if (opts.cancelled()) return
        const targetSec = Math.min(durSec, Math.max(0, ms / 1000))
        if (!(Math.abs(vid.currentTime - targetSec) < 0.05 && vid.readyState >= 2)) {
          await new Promise<void>(r => {
            const tid = setTimeout(r, 3000)
            vid.addEventListener('seeked', () => { clearTimeout(tid); r() }, { once: true })
            vid.currentTime = targetSec
          })
        }
        if (opts.cancelled()) return
        try {
          ctx.drawImage(vid, 0, 0, canvas.width, canvas.height)
          opts.onFrame(i, canvas.toDataURL('image/jpeg', 0.82), Math.round(targetSec * 1000))
        } catch { /* (a frame that can't be read is left blank) */ }
      }
    } finally {
      endGrabTurn()
    }
  }).catch(() => {}).finally(() => jobDone(url, g))
}

// Frames sampled across the clip's own range of the source video, so each thumbnail sits under
// the moment it shows (the video file is the whole source, not just this clip)
export function VideoThumbnails({ videoUrl, startMs, durationMs, count = THUMB_COUNT, radius = 8, dim = true, tile = false, sourceAt, sourceKey = '' }: {
  videoUrl: string; startMs: number; durationMs: number
  /** Frames across the width, the corner radius, and the dark veil over them */
  count?: number; radius?: number; dim?: boolean
  /**
   * As in CapCut: frames side by side in the video's own shape, as many as fit the width (`count`
   * is then ignored), each showing the moment under it
   */
  tile?: boolean
  /** Parts of the clip were removed: clip time (ms) → time in the video (ms). `sourceKey` changes when it does. */
  sourceAt?: (clipMs: number) => number; sourceKey?: string
}) {
  const [thumbs, setThumbs] = useState<string[]>([])
  // Tiles: the strip's size and the video's shape decide how many frames fit
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [ar, setAr] = useState(16 / 9)
  useEffect(() => {
    const el = boxRef.current
    if (!tile || !el) return
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height)
      setSize(prev => (prev.w === w && prev.h === h ? prev : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [tile])
  const tileW = Math.max(8, size.h * ar)
  const n = tile ? Math.max(1, Math.min(60, Math.ceil(size.w / tileW))) : count
  const sourceAtRef = useRef(sourceAt)
  sourceAtRef.current = sourceAt
  useEffect(() => {
    if (!videoUrl || (tile && !size.w)) return
    let cancelled = false
    let cache = thumbCache.get(videoUrl)
    if (!cache) { cache = new Map(); thumbCache.set(videoUrl, cache) }  // (sharp frames: CAPTURE_H)
    // Where each thumbnail is in the video (a tile: the moment under its middle), and how far off a
    // reused frame may be (half a thumbnail)
    const at = sourceAtRef.current
    const targets = Array.from({ length: n }, (_, i) => {
      const clipMs = tile ? Math.min(1, ((i + 0.5) * tileW) / size.w) * durationMs : ((i + 0.5) / n) * durationMs
      return at ? at(clipMs) : startMs + clipMs
    })
    const tol = Math.max(250, durationMs / n / 2)
    const start = targets.map(t => nearestThumb(cache!, t, tol) ?? '')
    setThumbs(start)
    const missing = targets.map((ms, i) => ({ i, ms })).filter(({ i }) => !start[i])
    if (!missing.length) return
    // A short pause first: while a clip end is being dragged the layout changes on every frame
    const wait = setTimeout(() => grabFrames(videoUrl, missing, {
      cancelled: () => cancelled,
      // Tiles: laid out again for the video's own shape first
      onShape: shape => { if (tile && Math.abs(shape - ar) > 0.01) { setAr(shape); return false } return true },
      onFrame: (i, dataUrl, ms) => {
        cache!.set(ms, dataUrl)
        setThumbs(prev => { const next = [...prev]; next[i] = dataUrl; return next })
      },
    }), 120)
    return () => { cancelled = true; clearTimeout(wait) }
  }, [videoUrl, startMs, durationMs, n, sourceKey, tile, size.w, size.h, ar]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // (only a picture: never grabbed itself — an image dragged by the browser stopped the playhead
    // from following a drag along the strip — clicks and drags go to what's under it)
    <div ref={boxRef} className="absolute inset-0 flex overflow-hidden pointer-events-none" style={{ borderRadius: radius }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} style={{ ...(tile ? { width: tileW, flex: 'none' } : { flex: 1, minWidth: 0 }), overflow: 'hidden', background: 'rgb(var(--ed-fg) / 0.03)' }}>
          {thumbs[i] && (
            <img src={thumbs[i]} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          )}
        </div>
      ))}
      {dim && <div className="absolute inset-0 pointer-events-none" style={{ background: 'rgba(0,0,0,0.25)', borderRadius: radius }} />}
    </div>
  )
}

// Friendly name of a format, shown on its block and in its handles' labels
function formatName(seg: SegmentLocal): string {
  if (isFrameLayout(seg.layout)) return `Frame · ${FRAME_TEMPLATES[seg.layout].name}`
  if (seg.layout === 'split') return 'Split screen'
  return seg.layout.charAt(0).toUpperCase() + seg.layout.slice(1)
}

/** Seconds as "12.4s" under a minute, else "1:05" */
function durLabel(ms: number): string {
  return ms < 60000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` : msToLabel(ms)
}

const ACCENT = '#c8ff00'
const iconProps = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true }

function msToLabel(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export const ZOOM_STEPS = [1, 1.25, 1.5, 2, 3, 4, 6, 8]
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]
/** The next zoom step out (-1) or in (1) from any zoom — a pinch can leave it between steps */
export function zoomStep(zoom: number, dir: 1 | -1): number {
  return dir > 0 ? (ZOOM_STEPS.find(z => z > zoom + 0.001) ?? MAX_ZOOM) : ([...ZOOM_STEPS].reverse().find(z => z < zoom - 0.001) ?? 1)
}
/** A zoom as shown on its button: 1.25×, 1.7×, 3× */
export const zoomLabel = (zoom: number) => `${Math.round(zoom * 100) / 100}`

/** Zoom out · Fit · Zoom in, for the timeline (inside it, or in the editor's control bar) */
export function TimelineZoom({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const step = (dir: 1 | -1) => onZoom(zoomStep(zoom, dir))
  const btn = 'w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-30 hover:bg-[rgb(var(--ed-fg)/0.08)]'
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-xl" role="group" aria-label="Timeline zoom"
      style={{ background: 'rgb(var(--ed-fg) / 0.04)', border: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
      <button onClick={() => step(-1)} disabled={zoom === ZOOM_STEPS[0]} aria-label="Zoom out timeline" title="Zoom out"
        className={btn} style={{ color: 'rgb(var(--ed-fg) / 0.8)' }}>
        <svg {...iconProps}><circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-4-4" /></svg>
      </button>
      <button onClick={() => onZoom(1)} disabled={zoom === 1} title="Fit the whole clip"
        className="h-8 min-w-[48px] px-2 flex items-center justify-center rounded-lg text-xs font-semibold tabular-nums transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)] disabled:hover:bg-transparent"
        style={{ color: zoom === 1 ? 'rgb(var(--ed-fg) / 0.6)' : ACCENT }}>
        {zoom === 1 ? 'Fit' : `${zoomLabel(zoom)}×`}
      </button>
      <button onClick={() => step(1)} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in timeline" title="Zoom in"
        className={btn} style={{ color: 'rgb(var(--ed-fg) / 0.8)' }}>
        <svg {...iconProps}><circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M20 20l-4-4" /></svg>
      </button>
    </div>
  )
}
// Major tick spacing candidates and how many minor ticks sit between two majors
const TICK_STEPS: [number, number][] = [
  [1000, 5], [2000, 4], [5000, 5], [10000, 5], [15000, 3], [30000, 6], [60000, 6], [120000, 4], [300000, 5], [600000, 5],
]
const MIN_LABEL_GAP_PX = 64

interface Props {
  segments: SegmentLocal[]
  clipStartMs: number
  clipEndMs: number
  currentTimeMs: number
  activeSegmentId: string | null
  videoUrl?: string
  /** Parts of the clip were removed: clip time (ms) → time in the video (ms), for the film strip. `sourceKey` changes when it does. */
  sourceAt?: (clipMs: number) => number
  sourceKey?: string
  /**
   * The clip's own start and end can be dragged (handles just outside the film strip): how far
   * each can move (ms), and what to do on release (start: < 0 earlier; end: > 0 later).
   */
  clipEdgeLimits?: { startEarlier: number; startLater: number; endEarlier: number; endLater: number }
  /** Called while dragging (`done` false, a few times a second: the clip changes live) and on release (`done` true) */
  onClipEdge?: (edge: 'start' | 'end', deltaMs: number, done: boolean) => void
  safeDurationMs?: number
  onSeek: (ms: number) => void
  onSelectSegment: (id: string) => void
  onUpdateSegment: (id: string, updates: { start_ms?: number; end_ms?: number }) => void
  /** Move one edge of a format. Formats are independent: neighbours never move. */
  onSetEdge?: (segId: string, edge: 'start' | 'end', tMs: number) => void
  /** Move the shared edge of two touching formats together. */
  onMoveJunction?: (leftId: string, rightId: string, tMs: number) => void
  onInsertBrollAfter?: (afterSegId: string) => void
  textOverlays?: TextOverlay[]
  activeTextOverlayId?: string | null
  onSelectTextOverlay?: (id: string) => void
  onTextOverlayUpdate?: (id: string, updates: { start_ms?: number; end_ms?: number }) => void
  /** Frame section under the playhead: its lanes are shown under the film strip */
  frameSeg?: SegmentLocal | null
  /** Selected lane item, or `main:<slot>` for a slot's main video */
  activeFrameItemId?: string | null
  /** Bumped to point the user at a lane (e.g. after clicking "+" in the preview) */
  laneHighlight?: { lane: FrameLane; n: number; focusPlus?: boolean; openMenu?: boolean } | null
  videoTitles?: Record<string, string>
  onSelectFrameItem?: (id: string | null) => void
  onUpdateFrameItem?: (id: string, patch: Partial<Pick<FrameItem, 'start_ms' | 'end_ms' | 'source_offset_ms'>>) => void
  /** "+" on a lane: open the add menu next to it */
  onAddFrameItem?: (lane: FrameLane, anchor: DOMRect) => void
  /** A thin line of another frame clicked: go there and select it */
  onJumpToFrameItem?: (segId: string, itemId: string) => void
  /** View changes (◆) of the selected crop box in the format under the playhead (see views.ts) */
  viewMarkers?: { t_ms: number; cut: boolean }[]
  selectedViewT?: number | null
  /** Click a ◆: select it and jump there */
  onSelectView?: (t: number) => void
  /** Drag a ◆ in time; returns where it landed */
  onMoveView?: (from: number, to: number) => number | void
  onRemoveView?: (t: number) => void
  /** The selected ◆'s copy button (and Ctrl+D on it): a copy of that view, to drag anywhere */
  onDuplicateView?: (t: number) => void
  /** Playable URLs of the videos B-roll shots show, by video id (for their thumbnails) */
  videoUrls?: Record<string, string>
  /** Full lengths (ms) of the videos shots show, by video id: a shot's ends can't be dragged past its video's own start and end */
  mediaLengths?: Record<string, number>
  /**
   * The clip's own video. `segments` holds the sections AND the videos put on top of them (B-roll:
   * a first slot showing another video, see shots.ts): those lie on their own lane, as layers —
   * the strip and its sections stay whole under them.
   */
  mainVideoId?: string | null
  /** B-roll shots (shown on their own lane over the film strip): moved or trimmed to a new time */
  onBrollChange?: (segId: string, startMs: number, endMs: number, done?: boolean) => void
  /** Bin on the section the user clicked on the strip: delete that section */
  onDeleteSegment?: (id: string) => void
  /** The section the user clicked on the film strip (its bin shows only then); null when none */
  pickedSegmentId?: string | null
  /** Clicking the strip picks the section under the pointer; clicking anywhere else clears it */
  onPickSegment?: (id: string | null) => void
  /** A join dragged onto the next one: the section between goes, the one dragged from takes its time */
  onSwallowSection?: (removeId: string, keepId: string) => void
  /** Background music, one bar per track on a Music lane (drag a bar to change when it starts) */
  musicTracks?: { id: string; name: string; start_ms: number; duration_ms?: number; /** the main video's own sound, detached: shown over the strip */ original?: boolean; muted?: boolean; locked?: boolean; /** its audio track */ track?: number
    /** The song's file (its waveform is drawn), what it is (storage path), and how far into it the bar starts */
    url?: string; key?: string; offset_ms?: number }[]
  onMusicMove?: (id: string, startMs: number) => void
  /** A music bar's end dragged: the start cuts into the song (its end stays put), the end shortens or lengthens it */
  onMusicTrim?: (id: string, edge: 'start' | 'end', ms: number) => void
  /** The music bar selected for Trim / Delete (it gets a white ring), and clicking a bar selects it */
  selectedMusicId?: string | null
  onSelectMusic?: (id: string) => void
  /** A sub timeline's icon (or its empty row): add that kind of media at the playhead */
  onAddKind?: (kind: 'video' | 'broll' | 'photo' | 'music' | 'text') => void
  /** A video on top that is stock footage (B-roll): it sits on the B-roll lane; the others (the user's own videos) on the Video lane */
  isStock?: (seg: SegmentLocal) => boolean
  /**
   * The lock / view / sound buttons beside a lane (`kind`: main, broll, video, photo, music, text):
   * which it has, whether each is on (for everything in the lane), and whether the lane is empty
   */
  laneCtl?: (kind: string) => LaneCtl | null
  onLaneCtl?: (kind: string, key: LaneCtlKey) => void
  /** The whole clip's own sound is off (Music panel): every section shows as muted */
  mainMuted?: boolean
  /** Files dragged from the computer and dropped on the timeline: at `atMs`, on `lane` (null: not on a media lane) */
  onDropFiles?: (files: File[], atMs: number, lane: string | null) => void
  /** Stock footage dragged from the B-roll search (its JSON, see STOCK_DRAG_TYPE) and dropped at `atMs` */
  onDropStock?: (json: string, atMs: number, lane?: string | null) => void
  /** Something dragged from the Media library (its JSON, see MEDIA_DRAG_TYPE) and dropped at `atMs` on `lane` */
  onDropMedia?: (json: string, atMs: number, lane: string | null) => void
  /** Photos over the clip, on their own lane: drag to move, drag the ends to trim, click to pick */
  photos?: { id: string; start_ms: number; end_ms: number; url?: string; hidden?: boolean; locked?: boolean; /** its track */ track?: number }[]
  /**
   * Something dragged up or down to another track (`'new'`: past the last one, a new track), or
   * released on its own track after a change in time (it may now overlap something there)
   */
  onTrackDrop?: (ref: TrackRef, target: number | 'new') => void
  activePhotoId?: string | null
  onSelectPhoto?: (id: string) => void
  onPhotoTimeChange?: (id: string, updates: { start_ms: number; end_ms: number }) => void
  /** Controlled zoom (e.g. when the zoom buttons live in the editor's control bar) */
  zoom?: number
  onZoomChange?: (z: number) => void
  /** Show the timeline's own zoom row (off when the zoom buttons live elsewhere) */
  showToolbar?: boolean
}

export function SegmentTimeline({
  segments,
  mainVideoId,
  clipStartMs,
  clipEndMs,
  currentTimeMs,
  activeSegmentId,
  videoUrl,
  sourceAt,
  sourceKey,
  clipEdgeLimits,
  onClipEdge,
  safeDurationMs,
  onSeek,
  onSelectSegment,
  onUpdateSegment,
  onSetEdge,
  onMoveJunction,
  onSwallowSection,
  textOverlays = [],
  photos = [],
  activePhotoId = null,
  onSelectPhoto,
  onPhotoTimeChange,
  musicTracks = [],
  onMusicMove,
  onMusicTrim,
  selectedMusicId = null,
  onSelectMusic,
  activeTextOverlayId,
  onSelectTextOverlay,
  onTextOverlayUpdate,
  frameSeg,
  activeFrameItemId,
  laneHighlight,
  videoTitles = {},
  onSelectFrameItem,
  onUpdateFrameItem,
  onAddFrameItem,
  onJumpToFrameItem,
  viewMarkers = [],
  selectedViewT = null,
  onSelectView,
  onMoveView,
  onRemoveView,
  onDuplicateView,
  onBrollChange,
  videoUrls = {},
  mediaLengths = {},
  zoom: zoomProp,
  onZoomChange,
  onDeleteSegment,
  onAddKind,
  isStock,
  onDropFiles,
  onDropStock,
  onDropMedia,
  laneCtl,
  onLaneCtl,
  mainMuted = false,
  onTrackDrop,
  pickedSegmentId = null,
  onPickSegment,
  showToolbar = true,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  // The icon column on the left: where each kind of lane sits (top / height, px within the timeline)
  // Something dragged over the timeline: where it would go (a line at that time, its lane lit)
  const [dropAt, setDropAt] = useState<{ ms: number; lane: string | null; what: string } | null>(null)
  /** The lane under the pointer, or the lane of the + button under it */
  const laneAt = (el: Element) => el.closest?.('[data-lane]')?.getAttribute('data-lane') ?? el.closest?.('[data-drop-lane]')?.getAttribute('data-drop-lane') ?? null
  const dropKind = (e: React.DragEvent) => e.dataTransfer.types.includes(STOCK_DRAG_TYPE) ? 'stock' : e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) ? 'media' : e.dataTransfer.types.includes('Files') ? 'files' : null
  function onDragOver(e: React.DragEvent) {
    const kind = dropKind(e)
    if (!kind || (kind === 'files' && !onDropFiles) || (kind === 'stock' && !onDropStock) || (kind === 'media' && !onDropMedia)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const lane = laneAt(e.target as Element)
    const ms = Math.round(msFromClientX(e.clientX))
    const what = kind === 'stock' ? 'B-roll' : lane === 'broll' ? 'B-roll' : lane === 'photo' ? 'photo' : lane === 'music' ? 'music' : 'media'
    setDropAt(prev => (prev && prev.ms === ms && prev.lane === lane && prev.what === what ? prev : { ms, lane, what }))
  }
  function onDrop(e: React.DragEvent) {
    const kind = dropKind(e)
    setDropAt(null)
    if (!kind) return
    e.preventDefault()
    const lane = laneAt(e.target as Element)
    const ms = Math.round(msFromClientX(e.clientX))
    if (kind === 'stock') onDropStock?.(e.dataTransfer.getData(STOCK_DRAG_TYPE), ms, lane)
    else if (kind === 'media') onDropMedia?.(e.dataTransfer.getData(MEDIA_DRAG_TYPE), ms, lane)
    else if (e.dataTransfer.files.length) onDropFiles?.([...e.dataTransfer.files], ms, lane)
  }
  const [laneSpans, setLaneSpans] = useState<{ kind: string; top: number; h: number }[]>([])
  const measureLanes = () => {
    const box = scrollRef.current
    if (!box) return
    const base = box.getBoundingClientRect().top
    const by = new Map<string, { top: number; bottom: number }>()
    box.querySelectorAll<HTMLElement>('[data-lane]').forEach(el => {
      const r = el.getBoundingClientRect(), k = el.dataset.lane!
      const cur = by.get(k)
      by.set(k, { top: Math.min(cur?.top ?? Infinity, r.top - base), bottom: Math.max(cur?.bottom ?? -Infinity, r.bottom - base) })
    })
    // The ruler and the main video stay at the top: a lane scrolled under them has no icon
    const cover = trackRef.current ? trackRef.current.getBoundingClientRect().bottom - base : 0
    const next = [...by].map(([kind, v]) => ({ kind, top: Math.round(v.top), h: Math.round(v.bottom - v.top) }))
      .filter(sp => sp.kind === 'main' || sp.kind === 'original' || sp.top + sp.h / 2 > cover)
    setLaneSpans(prev => JSON.stringify(prev) === JSON.stringify(next) ? prev : next)
  }
  useLayoutEffect(measureLanes)
  useEffect(() => {
    const box = scrollRef.current?.firstElementChild
    if (!box) return
    const ro = new ResizeObserver(() => measureLanes())
    ro.observe(box)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const trackRef = useRef<HTMLDivElement>(null)
  const [zoomState, setZoomState] = useState(1)
  const zoom = zoomProp ?? zoomState
  const setZoom = (z: number) => { if (onZoomChange) onZoomChange(z); else setZoomState(z) }
  const [viewW, setViewW] = useState(0)
  const [dragging, setDragging] = useState<string | null>(null)
  /** A ◆ being dragged: where it is now (its moment's frame floats above it) */
  const [viewDragT, setViewDragT] = useState<number | null>(null)
  const [snapLine, setSnapLine] = useState<number | null>(null)
  // A join dragged onto the next join: the section that goes when it's released
  const [doomed, setDoomed] = useState<{ id: string; label: string; start: number; end: number } | null>(null)
  // A B-roll shot being dragged: where it would land
  const [brollGhost, setBrollGhost] = useState<{ id: string; start: number; end: number } | null>(null)
  // The + at the top of the lane column: its menu (where the button is on screen), or closed
  const [addMenu, setAddMenu] = useState<DOMRect | null>(null)
  useEffect(() => {
    if (!addMenu) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddMenu(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [addMenu])
  // Lane pointed at from the preview: scroll to it, focus its "+", and pulse it for a moment
  const [pulseLane, setPulseLane] = useState<FrameLane | null>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const plusRefs = useRef(new Map<string, HTMLButtonElement>())
  useEffect(() => {
    if (!laneHighlight) return
    setPulseLane(laneHighlight.lane)
    // Opening the lane's menu needs the "+" to have stopped moving, so jump instead of gliding
    lanesRef.current?.scrollIntoView({ block: 'nearest', behavior: laneHighlight.openMenu ? 'auto' : 'smooth' })
    const plus = plusRefs.current.get(String(laneHighlight.lane))
    if (laneHighlight.focusPlus !== false) plus?.focus({ preventScroll: true })
    if (laneHighlight.openMenu && plus) onAddFrameItem?.(laneHighlight.lane, plus.getBoundingClientRect())
    const t = setTimeout(() => setPulseLane(null), 1800)
    return () => clearTimeout(t)
  }, [laneHighlight])
  // Latest playhead for drag handlers (their closures outlive renders)
  const nowRef = useRef(currentTimeMs)
  nowRef.current = currentTimeMs
  const duration = (clipEndMs - clipStartMs) || safeDurationMs || 0

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Zoom with the trackpad or the mouse:
  //  • pinch (the browser sends it as Ctrl + wheel) or Ctrl + wheel anywhere on the timeline;
  //  • the plain wheel (up / down) with the pointer over the video strip.
  // The moment under the pointer stays under the pointer. Otherwise the wheel scrolls the zoomed
  // timeline sideways (the scrollbar is hidden).
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const setZoomRef = useRef(setZoom)
  setZoomRef.current = setZoom
  /** Where to keep the pointer's moment after a zoom: its share of the strip, and its x in the view */
  const zoomAnchor = useRef<{ share: number; x: number } | null>(null)
  /** When the wheel last zoomed: the playhead doesn't pull the view away right after */
  const wheelZoomAt = useRef(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const overStrip = !!(e.target as HTMLElement | null)?.closest?.('[data-lane="main"]')
      const vertical = Math.abs(e.deltaY) > Math.abs(e.deltaX)
      if (e.ctrlKey || e.metaKey || (overStrip && vertical && !e.shiftKey)) {
        e.preventDefault()   // (and the page itself doesn't zoom)
        // A pinch sends small steps, a mouse wheel ~100 per notch: each notch about ×1.3
        const k = e.ctrlKey && Math.abs(e.deltaY) < 40 ? 0.012 : 0.0026
        const z0 = zoomRef.current
        const z = Math.round(Math.max(1, Math.min(MAX_ZOOM, z0 * Math.exp(-e.deltaY * k))) * 100) / 100
        if (z === z0) return
        const rect = el.getBoundingClientRect()
        const x = e.clientX - rect.left
        zoomAnchor.current = { share: (el.scrollLeft + x) / Math.max(1, el.scrollWidth), x }
        wheelZoomAt.current = performance.now()
        setZoomRef.current(z)
        return
      }
      // Up / down: through the tracks when there are more than fit (Shift or a sideways swipe: along the time)
      if (vertical && !e.shiftKey && el.scrollHeight > el.clientHeight) return
      if (el.scrollWidth <= el.clientWidth) return
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (!d) return
      e.preventDefault()
      el.scrollLeft += d
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  useLayoutEffect(() => {
    const el = scrollRef.current, a = zoomAnchor.current
    if (!el || !a) return
    zoomAnchor.current = null
    el.scrollLeft = Math.max(0, a.share * el.scrollWidth - a.x)
  }, [zoom])

  // Keep the playhead in view when zoomed in (after seeking or while playing): from the live time,
  // so it scrolls on with the playhead even while the rest of the timeline redraws less often
  const followRef = useRef({ zoom, duration })
  followRef.current = { zoom, duration }
  const keepPlayheadInView = useCallback(() => {
    const el = scrollRef.current, { zoom: z, duration: d } = followRef.current
    if (!el || z === 1 || d <= 0 || performance.now() - wheelZoomAt.current < 600) return
    const x = (liveTime.get() / d) * el.scrollWidth
    if (x < el.scrollLeft + 24 || x > el.scrollLeft + el.clientWidth - 24) {
      el.scrollLeft = Math.max(0, x - el.clientWidth * 0.2)
    }
  }, [])
  useEffect(() => liveTime.subscribe(keepPlayheadInView), [keepPlayheadInView])
  useEffect(() => { keepPlayheadInView() }, [zoom, duration, keepPlayheadInView])


  function msFromClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return 0
    return Math.max(0, Math.min(((clientX - rect.left) / rect.width) * duration, duration))
  }

  // ── The clip's own ends: drag outwards for more video, inwards to cut ──
  const [clipDrag, setClipDrag] = useState<{ edge: 'start' | 'end'; delta: number } | null>(null)
  function handleClipEdgeDown(e: React.PointerEvent, edge: 'start' | 'end') {
    if (e.button !== 0 || !clipEdgeLimits || !onClipEdge) return
    e.stopPropagation()
    e.preventDefault()
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return
    const lim = clipEdgeLimits
    const x0 = e.clientX
    const at = (clientX: number) => {
      const d = ((clientX - x0) / rect.width) * duration
      // Whole tenths of a second, inside the limits
      const r = Math.round(d / 100) * 100
      return edge === 'start' ? Math.max(-lim.startEarlier, Math.min(lim.startLater, r)) : Math.max(-lim.endEarlier, Math.min(lim.endLater, r))
    }
    setClipDrag({ edge, delta: 0 })
    // The clip changes as the handle moves: at most once a frame, from where the drag started
    let pending: number | null = null, frame = 0
    const flush = () => { frame = 0; if (pending !== null) { onClipEdge(edge, pending, false); pending = null } }
    const move = (ev: PointerEvent) => {
      const d = at(ev.clientX)
      setClipDrag({ edge, delta: d })
      pending = d
      if (!frame) frame = requestAnimationFrame(flush)
    }
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      if (frame) cancelAnimationFrame(frame)
      setClipDrag(null)
      onClipEdge(edge, at(ev.clientX), true)
    }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  function handleTrackDrag(e: React.PointerEvent) {
    if (e.button !== 0) return
    // A click on the film strip picks the section under it (showing its bin); anywhere else clears it
    if (onPickSegment) {
      const rect = trackRef.current?.getBoundingClientRect()
      const y = rect ? e.clientY - rect.top : -1
      const onStrip = y >= STRIP_TOP && y <= STRIP_TOP + STRIP_H
      const t = msFromClientX(e.clientX)
      // (a video on top is picked on its own lane: the strip under it is the section's. Without
      // layers the video is the part there, so the strip picks it)
      const hit = onStrip ? mains.find(m => t >= m.start_ms && t < m.end_ms) ?? (layered ? undefined : brolls.find(b => t >= b.start_ms && t < b.end_ms)) : undefined
      onPickSegment(hit?.id ?? null)
    }
    // While the playhead is dragged the editor doesn't redraw (the playhead, the time and both
    // views follow the live time); it catches up on release
    const { setScrubbing } = usePlayerStore.getState()
    setScrubbing(true)
    onSeek(msFromClientX(e.clientX))
    const move = (ev: PointerEvent) => onSeek(msFromClientX(ev.clientX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      window.removeEventListener('blur', up)
      setScrubbing(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    window.addEventListener('blur', up)
  }

  const MIN_FORMAT_MS = 300
  const SNAP_PX = 8

  // Clamp an edge so formats never overlap and never get shorter than MIN_FORMAT_MS
  function clampEdge(seg: SegmentLocal, edge: 'start' | 'end', t: number) {
    // (the neighbours are sections: a video on top lies over them)
    const byT = layered ? mains : byTime
    const i = byT.findIndex(x => x.id === seg.id)
    if (edge === 'start') return Math.max(byT[i - 1]?.end_ms ?? 0, Math.min(seg.end_ms - MIN_FORMAT_MS, t))
    return Math.min(byT[i + 1]?.start_ms ?? duration, Math.max(seg.start_ms + MIN_FORMAT_MS, t))
  }

  // Snap to the playhead, other formats' edges and the clip ends when within a few pixels
  function snap(t: number, seg: SegmentLocal, alsoIgnore?: SegmentLocal) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return t
    const tol = (SNAP_PX / rect.width) * duration
    const targets = [0, duration, nowRef.current]
    for (const x of segments) if (x.id !== seg.id && x.id !== alsoIgnore?.id) targets.push(x.start_ms, x.end_ms)
    let best = t, bestD = tol
    for (const target of targets) { const d = Math.abs(target - t); if (d < bestD) { best = target; bestD = d } }
    return best
  }

  function setEdge(seg: SegmentLocal, edge: 'start' | 'end', t: number) {
    if (onSetEdge) { onSetEdge(seg.id, edge, t); return }
    onUpdateSegment(seg.id, edge === 'start' ? { start_ms: clampEdge(seg, 'start', t) } : { end_ms: clampEdge(seg, 'end', t) })
  }

  // Junction handle: where two formats touch, drag to move their shared edge together —
  // one grows, the other shrinks, and no default-framing gap appears between them
  function clampJunction(left: SegmentLocal, right: SegmentLocal, t: number) {
    return Math.max(left.start_ms + MIN_FORMAT_MS, Math.min(right.end_ms - MIN_FORMAT_MS, t))
  }
  function moveJunction(left: SegmentLocal, right: SegmentLocal, t: number) {
    if (onMoveJunction) { onMoveJunction(left.id, right.id, t); return }
    const c = clampJunction(left, right, t)
    onUpdateSegment(left.id, { end_ms: c })
    onUpdateSegment(right.id, { start_ms: c })
  }
  function handleJunctionDown(e: React.PointerEvent, left: SegmentLocal, right: SegmentLocal) {
    e.stopPropagation()
    e.preventDefault()
    if (left.locked || right.locked) { onSeek(left.end_ms); return }
    const sx = e.clientX
    let moved = false
    const now0 = nowRef.current
    const side = now0 >= left.start_ms && now0 < left.end_ms ? 'left' : now0 >= right.start_ms && now0 < right.end_ms ? 'right' : null
    const orig = left.end_ms
    // Dragged (nearly) onto the far edge of a section: that section would go. It stays as it was,
    // in red, until release; pulling back makes it an ordinary drag again.
    let doom: { removeId: string; keepId: string } | null = null
    const DOOM_PX = 14
    setDragging(`join-${left.id}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const raw = msFromClientX(ev.clientX)
      if (onSwallowSection) {
        const rect = trackRef.current?.getBoundingClientRect()
        const tol = rect ? (DOOM_PX / rect.width) * duration : 0
        const gone = raw >= right.end_ms - MIN_FORMAT_MS - tol ? right : raw <= left.start_ms + MIN_FORMAT_MS + tol ? left : null
        if (gone) {
          if (!doom) moveJunction(left, right, orig)   // the edge goes back: the whole section shows as going
          doom = { removeId: gone.id, keepId: (gone === right ? left : right).id }
          setDoomed({ id: gone.id, start: gone.start_ms, end: gone.end_ms,
            label: `Release to remove ${formatName(gone)} ${msToLabel(gone.start_ms)}–${msToLabel(gone.end_ms)}` })
          setSnapLine(gone === right ? right.end_ms : left.start_ms)
          return
        }
        if (doom) { doom = null; setDoomed(null) }
      }
      const t = clampJunction(left, right, snap(raw, left, right))
      // Keep the playhead in the format it was in, so the selection doesn't flip mid-drag
      if (side === 'left' && t <= nowRef.current) onSeek(Math.max(left.start_ms, t - 50))
      if (side === 'right' && t >= nowRef.current) onSeek(Math.min(right.end_ms - 50, t + 50))
      moveJunction(left, right, t)
      setSnapLine(t)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setSnapLine(null)
      setDoomed(null)
      if (doom) { onSwallowSection?.(doom.removeId, doom.keepId); return }
      if (!moved) onSeek(left.end_ms)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ◆ key: drag to trim that edge of the format, click to jump to it
  function handleEdgeDown(e: React.PointerEvent, seg: SegmentLocal, edge: 'start' | 'end') {
    e.stopPropagation()
    e.preventDefault()
    onSelectSegment(seg.id)
    if (seg.locked) { onSeek(edge === 'start' ? seg.start_ms : Math.max(seg.start_ms, seg.end_ms - 100)); return }
    const sx = e.clientX
    let moved = false
    // Only carry the playhead along if it started inside the format being trimmed
    const playheadInside = nowRef.current >= seg.start_ms && nowRef.current < seg.end_ms
    setDragging(`${edge}-${seg.id}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const t = clampEdge(seg, edge, snap(msFromClientX(ev.clientX), seg))
      // Keep the playhead inside the format being trimmed, so the selection stays on it
      if (playheadInside && edge === 'start' && t >= nowRef.current) onSeek(Math.min(seg.end_ms - 50, t + 50))
      if (playheadInside && edge === 'end' && t <= nowRef.current) onSeek(Math.max(t - 50, 0))
      setEdge(seg, edge, t)
      setSnapLine(t)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setSnapLine(null)
      if (!moved) onSeek(edge === 'start' ? seg.start_ms : Math.max(seg.start_ms, seg.end_ms - 100))
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /**
   * Snapping for everything dragged on the lanes (video, photo, text, music): an edge close to a
   * section edge (or the playhead, or the clip's ends) jumps onto it, so an item lines up with a
   * section exactly. A guide line shows where. `ignoreId`: a section not to snap to (a video shot
   * is a section itself).
   */
  const LANE_SNAP_PX = 10
  // Alt held while dragging: no snapping, the item goes exactly where the pointer is
  const noSnapRef = useRef(false)
  function edgeSnap(t: number, ignoreId?: string): number | null {
    if (noSnapRef.current) return null
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return null
    const tol = (LANE_SNAP_PX / rect.width) * duration
    let best: number | null = null, bestD = tol
    for (const x of [0, duration, nowRef.current, ...segments.filter(sg => sg.id !== ignoreId).flatMap(sg => [sg.start_ms, sg.end_ms])]) {
      const d = Math.abs(x - t)
      if (d < bestD) { best = x; bestD = d }
    }
    return best
  }
  /** One edge dragged: snapped (guide shown), or left where the pointer is */
  function snapEdgeAt(t: number, ignoreId?: string): number {
    const sn = edgeSnap(t, ignoreId)
    setSnapLine(sn)
    return sn ?? t
  }
  /** A whole item moved (length kept): whichever of its ends is closer to an edge snaps */
  function snapSpanAt(st: number, len: number, ignoreId?: string): number {
    const a = edgeSnap(st, ignoreId), b = edgeSnap(st + len, ignoreId)
    const da = a === null ? Infinity : Math.abs(a - st), db = b === null ? Infinity : Math.abs(b - (st + len))
    if (a !== null && da <= db) { setSnapLine(a); return a }
    if (b !== null) { setSnapLine(b); return Math.max(0, b - len) }
    setSnapLine(null)
    return st
  }
  /** "Fits section 2" / "Fits sections 1–2" when an item lines up exactly with sections */
  function fitLabel(startMs: number, endMs: number): string | null {
    const sections = mains.filter(x => x.end_ms - x.start_ms > 50)
    const first = sections.findIndex(x => Math.abs(x.start_ms - startMs) <= 1)
    const last = sections.findIndex(x => Math.abs(x.end_ms - endMs) <= 1)
    if (first === -1 || last < first) return null
    return first === last ? `Fits section ${first + 1}` : `Fits sections ${first + 1}–${last + 1}`
  }
  /** Drag that follows the pointer until it's released */
  function follow(move: (ev: PointerEvent) => void, done?: () => void) {
    const up = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up)
      setDragging(null); setSnapLine(null); done?.()
    }
    const onMove = (ev: PointerEvent) => { noSnapRef.current = ev.altKey; move(ev) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
  }
  const msPerPx = () => { const r = trackRef.current?.getBoundingClientRect(); return r && r.width > 0 ? duration / r.width : 0 }

  /** While something is dragged up or down: the track it would go on ('new': a new track past the last) */
  const [trackHover, setTrackHover] = useState<{ family: 'visual' | 'audio'; target: number | 'new' } | null>(null)
  const trackHoverRef = useRef<typeof trackHover>(null)
  /** The track row under the pointer (visual tracks: above the top one = a new track; audio: below the last) */
  function hoverTrack(ev: PointerEvent, family: 'visual' | 'audio', current: number) {
    const rows = [...(scrollRef.current?.querySelectorAll<HTMLElement>(`[data-track-row="${family}"]`) ?? [])]
    if (!rows.length) return
    const y = ev.clientY
    const first = rows[0].getBoundingClientRect(), last = rows[rows.length - 1].getBoundingClientRect()
    let target: number | 'new'
    if (family === 'visual' ? y < first.top - MEDIA_GAP : y > last.bottom + MEDIA_GAP) target = 'new'
    else target = Number((rows.find(r => y < r.getBoundingClientRect().bottom + MEDIA_GAP / 2) ?? rows[rows.length - 1]).dataset.track)
    const next = target === current ? null : { family, target }
    trackHoverRef.current = next
    setTrackHover(prev => (prev?.family === next?.family && prev?.target === next?.target ? prev : next))
  }
  /** Released: onto the track it was dragged to, or its own (where it may now overlap something) */
  function endTrackDrag(ref: TrackRef, current: number) {
    const h = trackHoverRef.current
    trackHoverRef.current = null
    setTrackHover(null)
    onTrackDrop?.(ref, h?.target ?? current)
  }

  // Music bar: drag to move where the track starts (it keeps its length; never before the clip starts)
  function handleMusicDrag(e: React.PointerEvent, m: { id: string; start_ms: number; duration_ms?: number; locked?: boolean; track?: number }) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectMusic?.(m.id)
    if (m.locked) return
    const k = msPerPx()
    if (!k) return
    const sx = e.clientX
    const len = musicEnd(m) - m.start_ms
    setDragging(`music-${m.id}`)
    follow(ev => {
      const st = Math.max(0, Math.min(duration - 200, m.start_ms + (ev.clientX - sx) * k))
      onMusicMove?.(m.id, Math.round(snapSpanAt(st, len)))
      hoverTrack(ev, 'audio', m.track ?? 0)
    }, () => endTrackDrag({ kind: 'music', id: m.id }, m.track ?? 0))
  }

  // Music bar ends: drag to trim; picks the track too
  function handleMusicTrim(e: React.PointerEvent, m: { id: string; start_ms: number; duration_ms?: number; locked?: boolean; track?: number }, edge: 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectMusic?.(m.id)
    if (m.locked) return
    const k = msPerPx()
    if (!k) return
    const sx = e.clientX
    const orig = edge === 'start' ? m.start_ms : musicEnd(m)
    setDragging(`music-${m.id}`)
    follow(ev => onMusicTrim?.(m.id, edge, Math.round(snapEdgeAt(orig + (ev.clientX - sx) * k))), () => endTrackDrag({ kind: 'music', id: m.id }, m.track ?? 0))
  }

  // Photo bar: the body moves it, the ends trim it (at least 0.2 s, inside the clip); picks it too
  function handlePhotoDrag(e: React.PointerEvent, ph: { id: string; start_ms: number; end_ms: number; locked?: boolean; track?: number }, part: 'body' | 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectPhoto?.(ph.id)
    if (ph.locked) return
    const k = msPerPx()
    if (!k) return
    const sx = e.clientX
    const len = ph.end_ms - ph.start_ms
    setDragging(`photo-${ph.id}`)
    follow(ev => {
      const d = (ev.clientX - sx) * k
      if (part === 'body') {
        const st = Math.round(snapSpanAt(Math.max(0, Math.min(duration - len, ph.start_ms + d)), len))
        onPhotoTimeChange?.(ph.id, { start_ms: st, end_ms: Math.min(duration, st + len) })
        hoverTrack(ev, 'visual', ph.track ?? 0)
      } else if (part === 'start') {
        onPhotoTimeChange?.(ph.id, { start_ms: Math.round(Math.max(0, Math.min(ph.end_ms - 200, snapEdgeAt(ph.start_ms + d)))), end_ms: ph.end_ms })
      } else {
        onPhotoTimeChange?.(ph.id, { start_ms: ph.start_ms, end_ms: Math.round(Math.min(duration, Math.max(ph.start_ms + 200, snapEdgeAt(ph.end_ms + d)))) })
      }
    }, () => endTrackDrag({ kind: 'photo', id: ph.id }, ph.track ?? 0))
  }

  // Text bar: the body moves it, the ends trim it (at least 0.2 s, inside the clip)
  function handleTextOverlayBodyDrag(e: React.PointerEvent, id: string, origStart: number, origEnd: number) {
    e.stopPropagation()
    if (textOverlays.find(t => t.id === id)?.locked) return
    const k = msPerPx()
    if (!k) return
    const sx = e.clientX
    const len = origEnd - origStart
    const track = textOverlays.find(t => t.id === id)?.track ?? 0
    setDragging(`text-${id}`)
    follow(ev => {
      const st = Math.round(snapSpanAt(Math.max(0, Math.min(duration - len, origStart + (ev.clientX - sx) * k)), len))
      onTextOverlayUpdate?.(id, { start_ms: st, end_ms: Math.min(duration, st + len) })
      hoverTrack(ev, 'visual', track)
    }, () => endTrackDrag({ kind: 'text', id }, track))
  }

  function handleTextOverlayEdgeDrag(e: React.PointerEvent, id: string, origStart: number, origEnd: number, side: 'left' | 'right') {
    e.stopPropagation()
    if (textOverlays.find(t => t.id === id)?.locked) return
    setDragging(`text-${id}`)
    follow(ev => {
      const ms = Math.round(snapEdgeAt(msFromClientX(ev.clientX)))
      if (side === 'right') onTextOverlayUpdate?.(id, { end_ms: Math.min(duration, Math.max(ms, origStart + 200)) })
      else onTextOverlayUpdate?.(id, { start_ms: Math.max(0, Math.min(ms, origEnd - 200)) })
    }, () => endTrackDrag({ kind: 'text', id }, textOverlays.find(t => t.id === id)?.track ?? 0))
  }

  /** An empty media lane: a faint row that adds that kind at the playhead (as in CapCut) */
  /** Dashed guide through a lane while one of its items sits on an edge */
  const laneGuide = (prefix: string) => snapLine !== null && dragging?.startsWith(prefix) ? (
    <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `calc(${pct(snapLine)}% - 0.5px)`, width: 0, borderLeft: `1.5px dashed ${ACCENT}`, zIndex: 20 }} />
  ) : null
  /** The lime tag on a bar that lines up with sections */
  const fitTag = (label: string | null) => label ? (
    <span className="relative shrink-0 px-1.5 rounded-full text-[9px] font-bold whitespace-nowrap pointer-events-none" style={{ background: ACCENT, color: '#000' }}>{label}</span>
  ) : null

  // Frame lane items: drag the body to move, the ends to trim. Items stay inside their format
  // and never cover a neighbour on the same lane.
  function handleFrameItemDown(e: React.PointerEvent, item: FrameItem, mode: 'move' | 'start' | 'end') {
    if (e.button !== 0 || !frameSeg) return
    e.stopPropagation()
    e.preventDefault()
    onSelectFrameItem?.(item.id)
    if (frameSeg.locked) return
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || duration <= 0) return
    const frame = frameOf(frameSeg)
    const { min, max } = itemBounds(frame, item, frameSeg)
    // Work with the part that's actually inside the format
    const s0 = Math.max(item.start_ms, frameSeg.start_ms), e0 = Math.min(item.end_ms, frameSeg.end_ms)
    const len = Math.min(e0 - s0, max - min)
    const tol = (SNAP_PX / rect.width) * duration
    const targets = [nowRef.current, frameSeg.start_ms, frameSeg.end_ms]
    for (const it of frame.items ?? []) if (it.id !== item.id) targets.push(it.start_ms, it.end_ms)
    const snapT = (t: number) => {
      let best = t, bestD = tol
      for (const x of targets) { const d = Math.abs(x - t); if (d < bestD) { best = x; bestD = d } }
      return best
    }
    const sx = e.clientX
    let moved = false
    setDragging(`item-${item.id}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const d = ((ev.clientX - sx) / rect.width) * duration
      if (mode === 'move') {
        // Snap whichever end is near something
        const a = snapT(s0 + d), b = snapT(s0 + d + len) - len
        const ns = Math.round(Math.max(min, Math.min(max - len, a !== s0 + d ? a : b)))
        onUpdateFrameItem?.(item.id, { start_ms: ns, end_ms: ns + len })
      } else if (mode === 'start') {
        const ns = Math.round(Math.max(min, Math.min(e0 - MIN_ITEM_MS, snapT(s0 + d))))
        // A video keeps showing the same moment under its other end: move where it starts in the source too
        const off = item.kind === 'video' ? { source_offset_ms: Math.max(0, (item.source_offset_ms ?? 0) + (ns - item.start_ms)) } : {}
        onUpdateFrameItem?.(item.id, { start_ms: ns, ...off })
        setSnapLine(ns)
      } else {
        const ne = Math.round(Math.min(max, Math.max(s0 + MIN_ITEM_MS, snapT(e0 + d))))
        onUpdateFrameItem?.(item.id, { end_ms: ne })
        setSnapLine(ne)
      }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setSnapLine(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ◆ view change: click selects it and jumps there; drag moves it in time (kept between its
  // neighbours by the store). The first view starts with the format and doesn't move.
  function handleViewDown(e: React.PointerEvent, t: number, first: boolean) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    onSelectView?.(t)
    if (first || !onMoveView) return
    const sx = e.clientX
    let cur = t, moved = false
    setDragging(`view-${t}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const landed = onMoveView(cur, Math.round(msFromClientX(ev.clientX)))
      if (typeof landed === 'number') { cur = landed; setSnapLine(landed); setViewDragT(landed) }
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setSnapLine(null)
      setViewDragT(null)
      if (moved) onSelectView?.(cur)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const pct = (ms: number) => (duration > 0 ? (ms / duration) * 100 : 0)
  const byTime = [...segments].sort((a, b) => a.start_ms - b.start_ms)

  // Ruler: pick the smallest spacing that keeps labels readable at this zoom
  const contentW = Math.max(1, viewW * zoom)
  const [majorMs, minorPerMajor] = TICK_STEPS.find(([ms]) => (ms / Math.max(duration, 1)) * contentW >= MIN_LABEL_GAP_PX) ?? TICK_STEPS[TICK_STEPS.length - 1]
  const minorMs = majorMs / minorPerMajor
  const ticks: { t: number; major: boolean }[] = []
  for (let i = 0; i * minorMs <= duration; i++) ticks.push({ t: i * minorMs, major: i % minorPerMajor === 0 })

  const colorOf = (seg: SegmentLocal) => LAYOUT_COLORS[seg.layout]
  // Videos on top (B-roll) are layers: they sit on their own lane, over the sections, which stay
  // whole under them. The strip, its ◆ keys and joins are about the sections that frame the main video.
  const brolls = byTime.filter(sg => isShot(sg, mainVideoId))
  const mains = byTime.filter(sg => !isShot(sg, mainVideoId))
  // An editor that doesn't keep layers (no mainVideoId: the phone editor) still has each video as
  // a part of its own between the sections, not over them
  const layered = mainVideoId != null
  // One lane over the strip holds the joins between touching formats and the B-roll shots
  // The joins lane: just tall enough for its handles, and a thin gap when there are none
  const RULER_H = 30
  const LANE_H = mains.some((m, i) => i + 1 < mains.length && Math.abs(mains[i + 1].start_ms - m.end_ms) <= 1) ? 18 : 6
  // The main video's own sound, when detached, sits in a row right over the strip
  const originals = musicTracks.filter(m => m.original)
  const ORIG_H = originals.length ? 24 : 0
  const STRIP_TOP = RULER_H + LANE_H + ORIG_H

  // Places where one format ends exactly where the next begins
  const junctions: { left: SegmentLocal; right: SegmentLocal }[] = []
  for (let i = 0; i + 1 < mains.length; i++) {
    if (Math.abs(mains[i + 1].start_ms - mains[i].end_ms) <= 1) junctions.push({ left: mains[i], right: mains[i + 1] })
  }

  /**
   * Drag a video on top: its body moves it, its ends trim it. It follows the pointer on its lane
   * and takes its new time when released. Only it moves: the sections under it are not touched.
   */
  function handleBrollDown(e: React.PointerEvent, seg: SegmentLocal, part: 'body' | 'start' | 'end') {
    e.stopPropagation(); e.preventDefault()
    if (seg.locked) { onSeek(seg.start_ms); onPickSegment?.(seg.id); return }
    const sx = e.clientX, sy = e.clientY
    const grab = msFromClientX(e.clientX) - seg.start_ms
    const len = seg.end_ms - seg.start_ms
    // Trimming (as in CapCut): an end follows the pointer live and stops at the video's own start
    // and end (`anchor`: where the video's first frame sits on the timeline)
    const box0 = seg.crop_boxes[0]
    const anchor = seg.start_ms - (box0?.source_offset_ms ?? 0)
    const full = mediaLengths[box0?.source_video_id ?? '']
    const minStart = Math.max(0, anchor)
    const maxEnd = full ? Math.min(duration, anchor + full) : duration
    let moved = false
    let next = { start: seg.start_ms, end: seg.end_ms }
    setDragging(`broll-${part}-${seg.id}`)
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return
      moved = true
      noSnapRef.current = ev.altKey
      if (part === 'body') hoverTrack(ev, 'visual', seg.track ?? 0)
      const t = msFromClientX(ev.clientX)
      if (part === 'body') {
        const st = snapSpanAt(Math.max(0, Math.min(duration - len, t - grab)), len, seg.id)
        next = { start: st, end: Math.min(duration, st + len) }
        setBrollGhost({ id: seg.id, ...next })
        return
      }
      if (part === 'start') next = { start: Math.max(minStart, Math.min(seg.end_ms - 500, snapEdgeAt(t, seg.id))), end: seg.end_ms }
      else next = { start: seg.start_ms, end: Math.min(maxEnd, Math.max(seg.start_ms + 500, snapEdgeAt(t, seg.id))) }
      onBrollChange?.(seg.id, Math.round(next.start), Math.round(next.end), false)
      // The preview shows the frame at the edge being dragged
      onSeek(part === 'start' ? next.start : Math.max(next.start, next.end - 40))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null)
      setBrollGhost(null)
      setSnapLine(null)
      if (!moved) { onSeek(seg.start_ms); onPickSegment?.(seg.id); return }
      onBrollChange?.(seg.id, Math.round(next.start), Math.round(next.end), true)
      endTrackDrag({ kind: 'shot', id: seg.id }, seg.track ?? 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const musicEnd = (m: { start_ms: number; duration_ms?: number }) => Math.min(duration, m.start_ms + (m.duration_ms ?? duration))

  // ── Tracks (as in CapCut, tracks.ts): videos on top, B-roll, photos and text share the visual
  //    tracks, the highest at the top (drawn over the ones under it); music has its own audio
  //    tracks under them. Anything can be dragged up or down to another track. ──
  type Visual = { kind: 'shot'; id: string; track: number; seg: SegmentLocal }
    | { kind: 'photo'; id: string; track: number; ph: (typeof photos)[number] }
    | { kind: 'text'; id: string; track: number; o: TextOverlay }
  const visual: Visual[] = [
    ...brolls.map(seg => ({ kind: 'shot' as const, id: seg.id, track: seg.track ?? 0, seg })),
    ...photos.map(ph => ({ kind: 'photo' as const, id: ph.id, track: ph.track ?? 0, ph })),
    ...textOverlays.map(o => ({ kind: 'text' as const, id: o.id, track: o.track ?? 0, o })),
  ]
  const visualTracks = [...new Set(visual.map(v => v.track))].sort((a, b) => b - a)
  const songs = musicTracks.filter(m => !m.original)
  const songTracks = [...new Set(songs.map(m => m.track ?? 0))].sort((a, b) => a - b)
  /** The icon beside a track: what is on it (a track with a video shows the film) */
  const metaOf = (kind: string): LaneMeta | undefined => {
    if (LANE_META[kind]) return LANE_META[kind]
    const vt = /^track-(\d+)$/.exec(kind)
    if (vt) {
      const on = visual.filter(v => v.track === Number(vt[1]))
      const like = on.some(v => v.kind === 'shot') ? LANE_META.video : on.some(v => v.kind === 'photo') ? LANE_META.photo : LANE_META.text
      return { label: 'Track', color: 'rgb(var(--ed-fg) / 0.6)', icon: like.icon }
    }
    if (/^audio-\d+$/.test(kind)) return { ...LANE_META.music, label: 'Audio track' }
    return undefined
  }

  // Stretches with no format — rendered with the default framing
  const gaps: { start_ms: number; end_ms: number }[] = []
  {
    let cursor = 0
    for (const seg of layered ? mains : byTime) {
      if (seg.start_ms - cursor >= 50) gaps.push({ start_ms: cursor, end_ms: seg.start_ms })
      cursor = Math.max(cursor, seg.end_ms)
    }
    if (duration - cursor >= 50) gaps.push({ start_ms: cursor, end_ms: duration })
  }

  // Media bars always show at full size, wherever the playhead is
  const inFocus = (_startMs: number, _endMs: number) => true
  const THIN_ROW_H = 6
  /** A thin media line (outside the section under the playhead) */
  const thinBar = (color: string, startMs: number, endMs: number): React.CSSProperties => ({
    left: `${pct(startMs)}%`, width: `max(6px, ${pct(endMs - startMs)}%)`, top: '50%', height: 4, transform: 'translateY(-50%)',
    borderRadius: 2, backgroundColor: `${color}b3`, cursor: 'pointer', touchAction: 'none',
  })
  /** A media bar on its row: tinted with its kind's colour, a solid edge on the left; picked = white ring */
  const mediaBar = (color: string, startMs: number, endMs: number, sel: boolean, on: boolean, fits: boolean, st?: { hidden?: boolean; locked?: boolean }): React.CSSProperties => ({
    left: `${pct(startMs)}%`, width: `max(12px, ${pct(endMs - startMs)}%)`, borderRadius: 5, paddingRight: 8,
    backgroundColor: `${color}${sel || on ? '55' : '30'}`,
    boxShadow: fits && on ? `inset 0 0 0 1.5px ${ACCENT}, 0 0 10px rgba(200,255,0,0.35)`
      : sel ? `inset 0 0 0 1.5px #fff, 0 0 8px ${color}88`
        : `inset 0 0 0 1px ${color}80`,
    cursor: on ? 'grabbing' : 'grab', touchAction: 'none',
    ...(st?.hidden ? { opacity: 0.45, backgroundImage: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.35) 0 4px, transparent 4px 8px)' } : {}),
    ...(st?.locked ? { cursor: 'pointer' } : {}),
  })

  // ── The bars on the tracks (as in CapCut): a header with the name and the length as tags, over
  //    the pictures — the video's frames side by side, the photo, the song's waveform; each in its kind's colour ──
  const BAR_HEAD_H = 18
  /** The bar's box: its time on the track, its colour; the header on top, the pictures under it */
  const barStyle = (color: string, startMs: number, endMs: number, sel: boolean, on: boolean, fits: boolean, st?: { hidden?: boolean; locked?: boolean }): React.CSSProperties =>
    ({ ...mediaBar(color, startMs, endMs, sel, on, fits, st), paddingRight: 0 })
  const barHead = (kind: 'video' | 'broll' | 'photo' | 'text' | 'music', name: string, ms: number, st: { hidden?: boolean; muted?: boolean; locked?: boolean }, extra?: React.ReactNode) => (
    <div className="relative shrink-0 flex items-center gap-1 min-w-0 pointer-events-none" style={{ height: BAR_HEAD_H, padding: '2px 8px 0 4px' }}>
      <MediaIcon kind={kind} />
      <span className="truncate text-[10.5px] font-semibold" style={BAR_TAG}>{name}</span>
      <span className="shrink-0 text-[10px] font-medium tabular-nums" style={BAR_TAG}>{timecode(ms)}</span>
      <StateBadges st={st} />
      {extra}
    </div>
  )
  /** The pictures under the header (inset a little: the bar's coloured edge and the picked ring stay visible) */
  const barBody = (children: React.ReactNode, style?: React.CSSProperties) => (
    <div className="relative flex-1 min-h-0 overflow-hidden pointer-events-none" style={{ margin: '0 1.5px 1.5px', borderRadius: '0 0 4px 4px', ...style }}>{children}</div>
  )
  /** A video on top: B-roll (stock footage) or one of the user's own videos */
  const shotBar = (seg: SegmentLocal) => {
    const kind = isStock?.(seg) ? 'broll' as const : 'video' as const
    const color = MEDIA_COLORS[kind], what = kind === 'broll' ? 'B-roll' : 'Video'
    const sel = seg.id === activeSegmentId || seg.id === pickedSegmentId
    const on = !!dragging?.startsWith('broll-') && dragging.endsWith(seg.id)
    const at = brollGhost?.id === seg.id ? { start_ms: brollGhost.start, end_ms: brollGhost.end } : seg
    const box = seg.crop_boxes[0]
    const name = (videoTitles[box?.source_video_id ?? ''] ?? what).replace(/^(Pixabay|Pexels): /, '').split(',')[0]
    const url = videoUrls[box?.source_video_id ?? '']
    return (
      <div key={seg.id} onPointerDown={e => handleBrollDown(e, seg, 'body')}
        title={`${what} · ${name} · ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)} · click to pick it, drag to move (up or down: another track), drag the ends to trim`}
        className="absolute inset-y-0 flex flex-col overflow-hidden"
        style={barStyle(color, at.start_ms, at.end_ms, sel, on, false, { hidden: box?.hidden, locked: seg.locked })}>
        <MediaGrip onPointerDown={e => handleBrollDown(e, seg, 'start')} side="left" label={`Trim the start of the ${what === 'B-roll' ? 'B-roll' : 'video'}`} />
        {barHead(kind, name, seg.end_ms - seg.start_ms, { hidden: box?.hidden, muted: box?.muted !== false, locked: seg.locked })}
        {barBody(url && <VideoThumbnails tile videoUrl={url} startMs={box?.source_offset_ms ?? 0} durationMs={seg.end_ms - seg.start_ms} radius={0} dim={false} />)}
        <MediaGrip onPointerDown={e => handleBrollDown(e, seg, 'end')} side="right" label={`Trim the end of the ${what === 'B-roll' ? 'B-roll' : 'video'}`} />
      </div>
    )
  }
  const photoBar = (ph: (typeof photos)[number]) => {
    const sel = ph.id === activePhotoId
    const on = dragging === `photo-${ph.id}`
    const fits = fitLabel(ph.start_ms, ph.end_ms)
    return (
      <div key={ph.id} onPointerDown={e => handlePhotoDrag(e, ph, 'body')}
        title={`Photo · ${msToLabel(ph.start_ms)}–${msToLabel(ph.end_ms)} · click to change it, drag to move (up or down: another track), drag the ends to trim`}
        className="absolute inset-y-0 flex flex-col overflow-hidden"
        style={barStyle(MEDIA_COLORS.photo, ph.start_ms, ph.end_ms, sel, on, !!fits, ph)}>
        <MediaGrip onPointerDown={e => handlePhotoDrag(e, ph, 'start')} side="left" label="Trim the start of the photo" />
        {barHead('photo', 'Photo', ph.end_ms - ph.start_ms, ph, (sel || on) && fitTag(fits))}
        {/* The photo, side by side across the bar */}
        {barBody(null, ph.url ? { backgroundImage: `url("${ph.url}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x', backgroundPosition: 'left center' } : undefined)}
        <MediaGrip onPointerDown={e => handlePhotoDrag(e, ph, 'end')} side="right" label="Trim the end of the photo" />
      </div>
    )
  }
  const textBar = (o: TextOverlay) => {
    const sel = o.id === activeTextOverlayId
    const on = dragging === `text-${o.id}`
    const fits = fitLabel(o.start_ms, o.end_ms)
    return (
      <div key={o.id}
        onPointerDown={e => { onSelectTextOverlay?.(o.id); handleTextOverlayBodyDrag(e, o.id, o.start_ms, o.end_ms) }}
        title={`Text · “${o.text}” · ${msToLabel(o.start_ms)}–${msToLabel(o.end_ms)} · click to change it, drag to move (up or down: another track), drag the ends to trim`}
        className="absolute inset-y-0 flex flex-col overflow-hidden"
        style={barStyle(MEDIA_COLORS.text, o.start_ms, o.end_ms, sel, on, !!fits, o)}>
        <MediaGrip onPointerDown={e => { onSelectTextOverlay?.(o.id); handleTextOverlayEdgeDrag(e, o.id, o.start_ms, o.end_ms, 'left') }} side="left" label="Trim the start of the text" />
        {barHead('text', 'Text', o.end_ms - o.start_ms, o, (sel || on) && fitTag(fits))}
        {/* The words themselves */}
        {barBody(<span className="absolute inset-0 flex items-center px-2 truncate text-[12px] font-bold" style={{ color: '#fdf2f8' }}>{o.text}</span>)}
        <MediaGrip onPointerDown={e => { onSelectTextOverlay?.(o.id); handleTextOverlayEdgeDrag(e, o.id, o.start_ms, o.end_ms, 'right') }} side="right" label="Trim the end of the text" />
      </div>
    )
  }
  const musicBar = (m: (typeof musicTracks)[number]) => {
    const end = musicEnd(m)
    const on = dragging === `music-${m.id}`
    const sel = selectedMusicId === m.id
    const fits = fitLabel(m.start_ms, end)
    return (
      <div key={m.id} onPointerDown={e => handleMusicDrag(e, m)}
        title={`Music · ${m.name} · ${msToLabel(m.start_ms)}–${msToLabel(end)} · click to change it, drag to move (up or down: another track), drag the ends to trim`}
        className="absolute inset-y-0 flex flex-col overflow-hidden"
        style={barStyle(MEDIA_COLORS.music, m.start_ms, end, sel, on, !!fits, m)}>
        {onMusicTrim && <MediaGrip onPointerDown={e => handleMusicTrim(e, m, 'start')} side="left" label="Trim the start of the music" />}
        {barHead('music', m.name, end - m.start_ms, m, (sel || on) && fitTag(fits))}
        {/* The song's waveform: loud parts tall, quiet parts low — the part of the song this bar plays */}
        {barBody(<Waveform url={m.url} srcKey={m.key} offsetMs={m.offset_ms ?? 0} durationMs={end - m.start_ms} />)}
        {onMusicTrim && <MediaGrip onPointerDown={e => handleMusicTrim(e, m, 'end')} side="right" label="Trim the end of the music" />}
      </div>
    )
  }
  /** A track's row: lit while something is dragged onto it; the lime line marks a new track past the last */
  const trackRow = (family: 'visual' | 'audio', t: number, edge: 'top' | 'bottom' | null, children: React.ReactNode) => {
    const hover = trackHover?.family === family ? trackHover.target : null
    return (
      <div key={`${family}-${t}`} data-lane={`${family === 'visual' ? 'track' : 'audio'}-${t}`} data-track-row={family} data-track={t}
        className="lane-track relative"
        style={{ height: MEDIA_ROW_H, borderRadius: 6, ...(hover === t ? { boxShadow: `inset 0 0 0 1.5px ${ACCENT}`, background: 'rgba(200,255,0,0.07)' } : {}) }}>
        {hover === 'new' && edge && (
          <div className="absolute left-0 right-0 pointer-events-none rounded-full" aria-hidden="true"
            style={{ [edge]: -MEDIA_GAP / 2 - 1.5, height: 3, background: ACCENT, boxShadow: '0 0 8px rgba(200,255,0,0.6)', zIndex: 20 }} />
        )}
        {children}
      </div>
    )
  }

  return (
    <div className="flex flex-col select-none flex-auto min-h-0" style={{ gap: 6 }}>
      {/* ── Toolbar: zoom (hidden when the editor's control bar holds the zoom buttons) ── */}
      {showToolbar && (
        <div className="flex items-center gap-3">
          <TimelineZoom zoom={zoom} onZoom={setZoom} />
        </div>
      )}

      <div className="flex items-stretch gap-3 flex-auto min-h-0">
      {/* Lane icons, lined up with their rows: what each sub-timeline is. Media icons add that kind at the playhead. */}
      <div className="relative shrink-0 self-stretch overflow-hidden" style={{ width: laneCtl ? 40 + 3 * 22 + 4 : 40 }} aria-label="Timeline lanes">
        {/* + : add a video, B-roll, photo, music or text at the playhead (beside the ruler) */}
        {onAddKind && (
          <>
            <button type="button" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setAddMenu(m => (m ? null : r)) }}
              aria-haspopup="menu" aria-expanded={!!addMenu} aria-label="Add media at the playhead" title="Add media at the playhead"
              className="absolute flex items-center justify-center rounded-lg transition-transform active:scale-95"
              style={{ top: 2, left: 4, width: 32, height: 26, background: ACCENT, color: '#000', boxShadow: '0 2px 8px rgba(200,255,0,0.25)' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                <path d={addMenu ? 'M6 6l12 12M18 6L6 18' : 'M12 5v14M5 12h14'} />
              </svg>
            </button>
            {addMenu && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 90 }} onClick={() => setAddMenu(null)} aria-hidden="true" />
                <div role="menu" aria-label="Add at the playhead" className="fixed flex flex-col py-1.5 rounded-xl"
                  style={{ zIndex: 91, left: addMenu.left, top: Math.min(addMenu.bottom + 6, window.innerHeight - 214), minWidth: 168, background: 'var(--ed-popover, var(--ed-panel))', border: '1px solid rgb(var(--ed-fg) / 0.14)', boxShadow: '0 12px 32px rgba(0,0,0,0.55)' }}>
                  {ADD_KINDS.map(({ kind, label }) => (
                    <button key={kind} type="button" role="menuitem" onClick={() => { setAddMenu(null); onAddKind(kind) }}
                      className="flex items-center gap-2.5 px-3 py-1.5 text-[12.5px] font-medium text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.07)]"
                      style={{ color: 'var(--ed-text)' }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={MEDIA_COLORS[kind]} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{LANE_META[kind].icon}</svg>
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {laneSpans.map(sp => {
          const meta = metaOf(sp.kind)
          if (!meta) return null
          // Room around each icon: it's a little smaller than its lane
          const size = Math.max(14, Math.min(26, sp.h - 2))
          const add = meta.add && onAddKind ? () => onAddKind(meta.add!) : undefined
          const ctl = laneCtl?.(sp.kind)
          return (
            <Fragment key={sp.kind}>
            {/* Lock · view · sound for the whole lane (a lane without one keeps its place empty) */}
            {ctl && (
              <span className="absolute flex items-center gap-0.5" style={{ top: sp.top + sp.h / 2 - 10, left: 40, height: 20 }}>
                {LANE_CTL_KEYS.map(k => {
                  if (!ctl.can.includes(k)) return <span key={k} style={{ width: 20 }} />
                  const on = !!ctl.state[k]
                  const what = meta.label.toLowerCase() + (ctl.note && k !== 'locked' ? ` (${ctl.note})` : '')
                  const label = k === 'locked' ? (on ? `Unlock ${what}` : `Lock ${what} (nothing on it can be moved, trimmed or deleted)`)
                    : k === 'hidden' ? (on ? `Show ${what} again` : `Hide ${what} (not shown or exported)`)
                      : on ? `Turn the sound of ${what} back on` : `Mute ${what}`
                  return (
                    <button key={k} type="button" disabled={ctl.empty} onClick={() => onLaneCtl?.(sp.kind, k)}
                      aria-pressed={on} aria-label={label} title={ctl.empty ? `${meta.label}: nothing here yet` : label}
                      className="lane-ctl flex items-center justify-center rounded-md" data-on={on || undefined} data-key={k}
                      style={{ width: 20, height: 20 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        {k === 'locked'
                          ? (on ? <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></> : <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.6-1.7" /></>)
                          : k === 'hidden'
                            ? (on ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0112 5c5 0 9 5 9 7a11 11 0 01-2.2 3.2M6.6 6.6C4.4 8 3 10.4 3 12c0 2 4 7 9 7a9.6 9.6 0 004.4-1.1" /></> : <><path d="M3 12c0-2 4-7 9-7s9 5 9 7-4 7-9 7-9-5-9-7z" /><circle cx="12" cy="12" r="3" /></>)
                            : (on ? <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></> : <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /></>)}
                      </svg>
                    </button>
                  )
                })}
              </span>
            )}
            <button type="button" onClick={add} disabled={!add}
              title={add ? `${meta.label} — click to add at the playhead` : meta.label}
              aria-label={add ? `Add ${meta.label.toLowerCase()} at the playhead` : meta.label}
              className="lane-ico group absolute left-0 flex items-center justify-center rounded-lg"
              style={{ top: sp.top + sp.h / 2 - size / 2, left: 4, width: 32, height: size, cursor: add ? 'pointer' : 'default', '--lane-c': meta.color } as React.CSSProperties}>
              <svg width={Math.min(15, size - 4)} height={Math.min(15, size - 4)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{meta.icon}</svg>
              {add && size >= 16 && (
                <svg className="absolute pointer-events-none" style={{ right: 3, bottom: size >= 22 ? 1 : -1 }} width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" aria-hidden="true">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              )}
            </button>
            </Fragment>
          )
        })}
      </div>
      {/* No visible scrollbar: when zoomed in, the wheel scrolls sideways and the view follows the playhead */}
      <div ref={scrollRef} onScroll={measureLanes} className="relative flex-1 min-w-0 overflow-auto rounded-2xl no-scrollbar"
        style={{
          background: 'linear-gradient(180deg, rgb(var(--ed-fg) / 0.035), rgb(var(--ed-fg) / 0.01)), var(--ed-ruler)',
          border: '1px solid rgb(var(--ed-fg) / 0.08)',
          boxShadow: 'inset 0 1px 0 rgb(var(--ed-fg) / 0.05), 0 12px 32px -18px rgba(0,0,0,0.8)',
          scrollbarWidth: 'none',
        }}>
        {/* Side padding keeps the handles at the very ends of the clip clear of the rounded border */}
        {/* Drops (files from the computer, stock footage) are taken anywhere here: the strip and every media lane */}
        <div className="relative" style={{ width: `${zoom * 100}%`, minWidth: '100%', padding: '0 14px' }}
          onDragOver={onDragOver} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null) }} onDrop={onDrop}>
          {/* Where a dragged file or stock clip would go (the box has 14 px of padding each side) */}
          {dropAt && (
            <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `calc(14px + (100% - 28px) * ${pct(dropAt.ms) / 100})`, zIndex: 60 }}>
              <div className="absolute top-0 bottom-0" style={{ left: -1, width: 2, background: ACCENT, boxShadow: '0 0 8px rgba(200,255,0,0.6)' }} />
              <span className="absolute whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ top: 2, left: 4, background: ACCENT, color: '#000' }}>
                Drop {dropAt.what} at {msToLabel(dropAt.ms)}
              </span>
            </div>
          )}
          {/* (sticky: the ruler and the main video stay put; the frame lanes and the tracks scroll under them) */}
          <div ref={trackRef} style={{ position: 'sticky', top: 0, zIndex: 50, background: 'var(--ed-ruler)', cursor: 'pointer', paddingBottom: 4 }} onPointerDown={handleTrackDrag}>

            {/* ── Ruler ─────────────────────────────────────────────── */}
            <div className="relative" style={{ height: RULER_H }}>
              {ticks.map(({ t, major }) => {
                const p = pct(t)
                return (
                  <div key={t} className="absolute pointer-events-none" style={major
                    ? { left: `${p}%`, bottom: 2, width: 1, height: 7, marginLeft: -0.5, background: 'rgb(var(--ed-fg) / 0.28)', borderRadius: 1 }
                    : { left: `${p}%`, bottom: 4, width: 2, height: 2, marginLeft: -1, background: 'rgb(var(--ed-fg) / 0.16)', borderRadius: 999 }}>
                    {major && (
                      <span className="absolute tabular-nums" style={{
                        bottom: 11, fontSize: 10, fontWeight: 500, letterSpacing: '0.03em', color: 'rgb(var(--ed-fg) / 0.42)', whiteSpace: 'nowrap',
                        transform: p < 2 ? 'translateX(2px)' : p > 98 ? 'translateX(-100%)' : 'translateX(-50%)',
                      }}>{msToLabel(t)}</span>
                    )}
                  </div>
                )
              })}
            </div>


            {/* ── Joins lane: a handle wherever two sections touch ── */}
            <div className="relative" style={{ height: LANE_H }}>
              {junctions.map(({ left, right }) => {
                const key = `join-${left.id}`
                const active = dragging === key
                const cl = colorOf(left), cr = colorOf(right)
                const li = mains.indexOf(left) + 1
                return (
                  <button key={key}
                    onPointerDown={e => handleJunctionDown(e, left, right)}
                    onKeyDown={e => {
                      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                      e.preventDefault(); e.stopPropagation()
                      const step = (e.shiftKey ? 1000 : 100) * (e.key === 'ArrowLeft' ? -1 : 1)
                      moveJunction(left, right, clampJunction(left, right, left.end_ms + step))
                    }}
                    aria-label={`Join between format ${li} and ${li + 1} at ${msToLabel(left.end_ms)}. Drag or use arrow keys to move both`}
                    title={`Join · format ${li} → ${li + 1} · ${msToLabel(left.end_ms)} · drag to move both together`}
                    className="absolute flex items-center justify-center"
                    style={{
                      left: `${pct(left.end_ms)}%`, top: '50%', transform: 'translate(-50%, -50%)',
                      width: 26, height: 14, borderRadius: 7,
                      background: `linear-gradient(90deg, ${cl} 0 50%, ${cr} 50% 100%)`,
                      border: '1.5px solid rgba(0,0,0,0.6)',
                      boxShadow: active ? `0 0 0 3px rgb(var(--ed-fg) / 0.35)` : '0 1px 3px rgba(0,0,0,0.6)',
                      cursor: 'ew-resize', touchAction: 'none', zIndex: 34,
                    }}>
                    <svg width="14" height="8" viewBox="0 0 14 8" aria-hidden="true">
                      <path d="M4 1L1 4l3 3M10 1l3 3-3 3M1 4h12" stroke="#000" strokeOpacity="0.7" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )
              })}
            </div>

            {/* ── Original sound (the main video's sound, detached): right over the video it comes from ── */}
            {originals.length > 0 && (
              <div data-lane="original" className="relative" style={{ height: ORIG_H, paddingBottom: 4 }}>
                <div className="relative h-full">
                  {originals.map(m => {
                    const end = musicEnd(m)
                    const on = dragging === `music-${m.id}`
                    const sel = selectedMusicId === m.id
                    return (
                      <div key={m.id} onPointerDown={e => handleMusicDrag(e, m)}
                        title={`Original sound · ${msToLabel(m.start_ms)}–${msToLabel(end)} · click to change it, drag to move, drag the ends to trim`}
                        className="absolute inset-y-0 flex items-center gap-1.5 overflow-hidden"
                        style={{ ...mediaBar(MEDIA_COLORS.music, m.start_ms, end, sel, on, false, m), zIndex: 33 }}>
                        {/* A faint sound wave so it reads as audio at a glance */}
                        <span className="absolute inset-0 pointer-events-none opacity-30" aria-hidden="true"
                          style={{ background: 'repeating-linear-gradient(90deg, transparent 0 3px, rgba(255,255,255,0.35) 3px 4px)', WebkitMaskImage: 'linear-gradient(180deg, transparent 25%, #000 50%, transparent 75%)', maskImage: 'linear-gradient(180deg, transparent 25%, #000 50%, transparent 75%)' }} />
                        {onMusicTrim && <MediaGrip onPointerDown={e => handleMusicTrim(e, m, 'start')} side="left" label="Trim the start of the original sound" />}
                        <MediaIcon kind="music" />
                        <span className="relative truncate text-[10px] font-semibold pointer-events-none" style={{ color: '#f3e8ff' }}>{m.name}</span>
                        <StateBadges st={m} />
                        {onMusicTrim && <MediaGrip onPointerDown={e => handleMusicTrim(e, m, 'end')} side="right" label="Trim the end of the original sound" />}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* ── Film strip: tinted per format, hatched where no format is set ── */}
            <div data-lane="main" className="relative overflow-hidden" style={{ height: STRIP_H, borderRadius: 12, boxShadow: '0 0 0 1px rgb(var(--ed-fg) / 0.1), 0 10px 24px -12px rgba(0,0,0,0.9)' }}>
              {videoUrl
                ? <VideoThumbnails videoUrl={videoUrl} startMs={clipStartMs} durationMs={duration} radius={12} dim={false} sourceAt={sourceAt} sourceKey={sourceKey} />
                : <div className="absolute inset-0" style={{ background: 'var(--ed-raise)' }} />}

              {gaps.map(g => (
                <div key={`gap-${g.start_ms}`} className="absolute inset-y-0 pointer-events-none flex items-center justify-center overflow-hidden"
                  title={`${msToLabel(g.start_ms)}–${msToLabel(g.end_ms)} · no format: default Vertical framing`}
                  style={{
                    left: `${pct(g.start_ms)}%`, width: `${pct(g.end_ms - g.start_ms)}%`,
                    background: 'repeating-linear-gradient(135deg, rgba(0,0,0,0.6) 0 6px, rgba(0,0,0,0.4) 6px 12px)',
                    boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)',
                  }}>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ color: 'rgba(255,255,255,0.8)', background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.12)' }}>Default framing</span>
                </div>
              ))}

              {/* Each format: the selected one stays bright inside a lime trim frame (its handles are the
                  frame's sides), the others are dimmed. Its colour only shows as the dot on its chip. */}
              {mains.map(seg => {
                const isActive = seg.id === (pickedSegmentId ?? (selectedMusicId ? null : activeSegmentId))
                const widthPx = (pct(seg.end_ms - seg.start_ms) / 100) * contentW
                return (
                  <div key={seg.id} className="absolute inset-y-0 pointer-events-none"
                    style={{
                      left: `${pct(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`,
                      background: isActive
                        ? 'linear-gradient(180deg, transparent 55%, rgba(0,0,0,0.45))'
                        : 'linear-gradient(180deg, rgba(0,0,0,0.3), rgba(0,0,0,0.5))',
                      boxShadow: isActive
                        ? `inset 0 2px 0 ${ACCENT}, inset 0 -2px 0 ${ACCENT}, 0 0 10px -3px rgba(200,255,0,0.4)`
                        : 'inset 0 0 0 1px rgba(255,255,255,0.12)',
                      borderRadius: 12,
                      transition: 'box-shadow .25s, background .25s',
                    }}>
                    <StateBadges st={mainMuted ? { ...seg, muted: true } : seg} corner />
                  </div>
                )
              })}
            </div>

            {/* ── The clip's own start and end: lime handles just outside the strip ── */}
            {clipEdgeLimits && onClipEdge && (['start', 'end'] as const).map(edge => {
              const dragging = clipDrag?.edge === edge
              const lim = clipEdgeLimits
              const can = edge === 'start' ? lim.startEarlier + lim.startLater > 0 : lim.endEarlier + lim.endLater > 0
              const label = edge === 'start' ? 'Drag to start the clip earlier or later' : 'Drag to end the clip earlier or later'
              return (
                <span key={edge} role="slider" aria-label={label} title={`${label} (up to 5 min)`}
                  aria-valuenow={dragging ? clipDrag!.delta : 0}
                  onPointerDown={e => handleClipEdgeDown(e, edge)}
                  className="group/ce absolute flex items-center justify-center"
                  style={{
                    top: STRIP_TOP, height: STRIP_H, width: 12, zIndex: 40,
                    ...(edge === 'start' ? { left: -13 } : { right: -13 }),
                    cursor: can ? 'ew-resize' : 'not-allowed',
                  }}>
                  <span className="block rounded-full transition-[background,height,box-shadow]"
                    style={{
                      width: 5, height: dragging ? STRIP_H : STRIP_H - 16,
                      background: can ? ACCENT : 'rgb(var(--ed-fg) / 0.25)',
                      boxShadow: dragging ? '0 0 12px rgba(200,255,0,0.6)' : undefined,
                    }} />
                </span>
              )
            })}
            {clipDrag && clipDrag.delta !== 0 && (() => {
              const { edge, delta } = clipDrag
              const more = edge === 'start' ? delta < 0 : delta > 0
              const secs = `${(Math.abs(delta) / 1000).toFixed(1)} s`
              const text = edge === 'start' ? (more ? `Starts ${secs} earlier` : `Starts ${secs} later`) : (more ? `Ends ${secs} later` : `Ends ${secs} earlier`)
              // (the clip already shows the change: the strip, the sections and the length follow the drag)
              return (
                <span className="absolute pointer-events-none px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                  style={{
                    ...(edge === 'start' ? { left: 0 } : { right: 0 }), top: RULER_H + LANE_H / 2, transform: 'translateY(-50%)', zIndex: 45,
                    background: more ? ACCENT : '#ef4444', color: more ? '#111' : '#fff',
                  }}>
                  {text} · {msToLabel(duration)} long
                </span>
              )
            })()}

            {/* A section about to go (its join dragged onto the next one): red, with what releasing does */}
            {doomed && (
              <>
                <div className="absolute pointer-events-none" style={{
                  left: `${pct(doomed.start)}%`, width: `${pct(doomed.end - doomed.start)}%`, top: STRIP_TOP, height: STRIP_H, zIndex: 31,
                  borderRadius: 12, background: 'repeating-linear-gradient(135deg, rgba(239,68,68,0.55) 0 8px, rgba(239,68,68,0.38) 8px 16px)',
                  boxShadow: 'inset 0 0 0 2px #ef4444',
                }} />
                <span className="absolute pointer-events-none px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                  style={{ left: `${pct((doomed.start + doomed.end) / 2)}%`, top: RULER_H + LANE_H / 2, transform: 'translate(-50%, -50%)', zIndex: 45, background: '#ef4444', color: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                  {doomed.label}
                </span>
              </>
            )}

            {/* ── Views: one ◆ per view change of the format under the playhead ── */}
            <div className="relative" style={{ height: 20, marginTop: 4 }}>
              {/* Faint guide the markers sit on */}
              <div className="absolute inset-x-0 top-1/2 pointer-events-none" style={{ height: 1, background: 'rgb(var(--ed-fg) / 0.06)' }} />
              {viewMarkers.length === 0 && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 flex items-center gap-1.5 pr-2 text-[10px] font-medium pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.3)', background: 'var(--ed-ruler)' }}>
                  <span className="w-1.5 h-1.5 rotate-45" style={{ background: 'rgb(var(--ed-fg) / 0.35)', borderRadius: 1 }} />
                  Move the view at any moment — each change shows here
                </span>
              )}
              {/* The ◆ being dragged: the frame at that moment and its time, above it */}
              {viewDragT !== null && (() => {
                const cache = videoUrl ? thumbCache.get(videoUrl) : undefined
                const src = cache ? nearestThumb(cache, sourceAt ? sourceAt(viewDragT) : clipStartMs + viewDragT, Math.max(1500, duration / 40)) : undefined
                return (
                  <div className="absolute pointer-events-none flex flex-col items-center gap-1"
                    style={{ left: `${pct(viewDragT)}%`, bottom: 'calc(100% + 6px)', transform: 'translateX(-50%)', zIndex: 60 }}>
                    {src && <img src={src} alt="" draggable={false} style={{ width: 80, height: 56, objectFit: 'cover', borderRadius: 8, boxShadow: `0 0 0 2px ${ACCENT}, 0 8px 18px rgba(0,0,0,0.6)` }} />}
                    <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold tabular-nums" style={{ background: ACCENT, color: '#111' }}>{msToLabel(viewDragT)}</span>
                  </div>
                )
              })()}
              {viewMarkers.map((v, i) => {
                const on = selectedViewT === v.t_ms
                const first = i === 0
                const size = on ? 13 : 10
                return (
                  <Fragment key={`view-${v.t_ms}`}>
                    <button
                      type="button"
                      onPointerDown={e => handleViewDown(e, v.t_ms, first)}
                      onKeyDown={e => {
                        if ((e.key === 'Delete' || e.key === 'Backspace') && !first) { e.preventDefault(); e.stopPropagation(); onRemoveView?.(v.t_ms) }
                        if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); e.stopPropagation(); onDuplicateView?.(v.t_ms) }
                      }}
                      aria-label={`${first ? 'First view' : v.cut ? 'View change' : 'Motion point'} at ${msToLabel(v.t_ms)}${first ? '' : '. Drag to move, Delete to remove'}`}
                      title={`${first ? 'First view' : v.cut ? 'View change (cut)' : 'Motion point (glide)'} · ${msToLabel(v.t_ms)}${first ? '' : ' · drag to move · Delete to remove'}`}
                      className="absolute top-1/2"
                      style={{
                        left: `${pct(v.t_ms)}%`, width: size, height: size,
                        transform: `translate(${v.t_ms <= 0 ? '0' : '-50%'}, -50%) rotate(45deg)`,
                        borderRadius: v.cut || first ? 3 : 999,
                        background: on ? ACCENT : v.cut || first ? 'rgb(var(--ed-fg) / 0.9)' : 'rgb(var(--ed-fg) / 0.5)',
                        border: '1.5px solid rgba(0,0,0,0.7)',
                        boxShadow: dragging === `view-${v.t_ms}` ? '0 0 0 4px rgba(200,255,0,0.35)' : on ? '0 0 10px rgba(200,255,0,0.6)' : '0 1px 3px rgba(0,0,0,0.6)',
                        cursor: first ? 'pointer' : 'ew-resize', touchAction: 'none', zIndex: on ? 36 : 35,
                      }} />
                    {on && onDuplicateView && (
                      <button type="button" onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); onDuplicateView(v.t_ms) }}
                        aria-label={`Duplicate the view at ${msToLabel(v.t_ms)}`} title="Duplicate this view — then drag the copy wherever you want it (Ctrl+D)"
                        className="absolute top-1/2 flex items-center justify-center rounded-full"
                        style={{ left: `calc(${pct(v.t_ms)}% + 10px)`, transform: 'translateY(-50%)', width: 16, height: 16, zIndex: 37, background: ACCENT, color: '#111' }}>
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" />
                        </svg>
                      </button>
                    )}
                    {on && !first && onRemoveView && (
                      <button type="button" onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); onRemoveView(v.t_ms) }}
                        aria-label={`Remove the view change at ${msToLabel(v.t_ms)}`} title="Remove this view change (Delete)"
                        className="absolute top-1/2 flex items-center justify-center rounded-full"
                        style={{ left: `calc(${pct(v.t_ms)}% + ${onDuplicateView ? 30 : 10}px)`, transform: 'translateY(-50%)', width: 16, height: 16, zIndex: 37, background: '#ef4444', color: '#fff', fontSize: 10, lineHeight: 1 }}>
                        ✕
                      </button>
                    )}
                  </Fragment>
                )
              })}
            </div>

            {/* ── Trim handles: the start and end of every format ── */}
            {mains.flatMap((seg, i) => {
              const selected = seg.id === activeSegmentId
              const label = formatName(seg)
              return (['start', 'end'] as const).map(edge => {
                const t = edge === 'start' ? seg.start_ms : seg.end_ms
                const key = `${edge}-${seg.id}`
                const active = dragging === key
                return (
                  <button key={key}
                    onPointerDown={e => handleEdgeDown(e, seg, edge)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSeek(edge === 'start' ? seg.start_ms : Math.max(seg.start_ms, seg.end_ms - 100)); return }
                      // Arrow keys nudge the edge by 0.1 s (1 s with Shift)
                      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                      e.preventDefault(); e.stopPropagation()
                      const step = (e.shiftKey ? 1000 : 100) * (e.key === 'ArrowLeft' ? -1 : 1)
                      setEdge(seg, edge, clampEdge(seg, edge, t + step))
                    }}
                    aria-label={`${edge === 'start' ? 'Start' : 'End'} of format ${i + 1} (${label}) at ${msToLabel(t)}. Drag or use arrow keys to trim`}
                    title={`${edge === 'start' ? 'Start' : 'End'} of format ${i + 1} · ${label} · ${msToLabel(t)} · drag to trim`}
                    // Grip bars sit just inside their format, so where two formats touch the end
                    // of one and the start of the next stand side by side instead of overlapping
                    className="group absolute flex items-center justify-center transition-[background,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    style={{
                      left: `${pct(t)}%`, top: STRIP_TOP, height: STRIP_H, width: selected || active ? 10 : 6,
                      transform: edge === 'start' ? 'translateX(0)' : 'translateX(-100%)',
                      borderRadius: edge === 'start' ? '12px 3px 3px 12px' : '3px 12px 12px 3px',
                      background: selected || active ? ACCENT : 'transparent',
                      boxShadow: active ? '0 0 0 2px rgba(200,255,0,0.3), 0 0 10px rgba(200,255,0,0.6)' : 'none',
                      cursor: 'ew-resize', touchAction: 'none', zIndex: selected ? 32 : 30,
                    }}>
                    {selected || active ? (
                      <svg width="5" height="9" viewBox="0 0 8 12" aria-hidden="true" style={{ transform: edge === 'start' ? 'none' : 'scaleX(-1)' }}>
                        <path d="M6 1.5L1.8 6 6 10.5" stroke="#000" strokeOpacity="0.8" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <span className="transition-colors group-hover:bg-white" style={{ width: 2, height: 14, borderRadius: 2, background: 'rgba(255,255,255,0.45)' }} />
                    )}
                  </button>
                )
              })
            })}

            {/* Snap guide while trimming */}
            {snapLine !== null && (
              <div className="absolute top-0 bottom-0 pointer-events-none z-20" style={{ left: `${pct(snapLine)}%`, width: 1, background: 'rgb(var(--ed-fg) / 0.6)' }} />
            )}

            {/* ── Playhead ─────────────────────────────────────────── */}
            {/* White line with the current time on a pill at the top (the pill stays on screen at the ends).
                White keeps it distinct from the lime trim frame. */}
            <AtPlayhead pctOf={pct} className="absolute top-0 bottom-0 pointer-events-none z-40">
              {(ms, p) => (
                <>
                  <div className="absolute" style={{ top: 18, bottom: 0, left: -1, width: 2, borderRadius: 2, background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 0 12px rgba(255,255,255,0.35)' }} />
                  <div className="absolute rounded-full" style={{ top: 15, left: -4, width: 8, height: 8, background: '#fff', boxShadow: '0 0 0 2px rgba(0,0,0,0.5)' }} />
                  <div className="absolute" style={{ top: 0, transform: p < 3 ? 'translateX(-8px)' : p > 97 ? 'translateX(calc(-100% + 8px))' : 'translateX(-50%)' }}>
                    <span className="block px-2 rounded-full text-[10px] font-bold tabular-nums leading-[16px]" style={{ background: '#fff', color: '#0a0a0a', boxShadow: '0 4px 12px rgba(0,0,0,0.5)' }}>
                      {msToLabel(ms)}
                    </span>
                  </div>
                </>
              )}
            </AtPlayhead>
          </div>


          {/* ── Frame lanes: what each slot and the text band shows over this frame's time ── */}
          {(() => {
            const active = frameSeg && isFrameLayout(frameSeg.layout) ? frameSeg : null
            const others = byTime.filter(x => isFrameLayout(x.layout) && x.id !== active?.id)
            const activeRows = active ? visibleLanes(active) : []
            const thinRows = Math.max(0, ...others.map(x => visibleLanes(x).length))
            if (!activeRows.length && !thinRows) return null
            const seg = active
            const frame = seg ? frameOf(seg) : null
            const main = frame?.main_slots ?? [0]
            const inSection = !!seg && currentTimeMs >= seg.start_ms && currentTimeMs < seg.end_ms
            const plusAt = seg ? (inSection ? currentTimeMs : seg.start_ms) : 0
            return (
              <div ref={lanesRef} data-lane="frame" className="relative flex flex-col pb-1.5"
                style={{ gap: 2, paddingTop: 4, borderTop: '1px solid rgb(var(--ed-fg) / 0.05)', minHeight: 4 + thinRows * (THIN_H + THIN_GAP) + 6 }}>
                {/* Other frames: the same lanes as thin lines (blue video, green photo, pink text) */}
                {others.flatMap(o => {
                  const of = frameOf(o)
                  const om = of.main_slots ?? [0]
                  return visibleLanes(o).flatMap((row, li) => {
                    const top = 4 + li * (THIN_H + THIN_GAP)
                    const bars: React.ReactNode[] = []
                    if (row.lane !== 'band' && om.includes(row.lane)) {
                      bars.push(
                        <button key={`${o.id}-main-${row.lane}`} aria-label={`${row.label} · Main video, ${msToLabel(o.start_ms)}–${msToLabel(o.end_ms)}`}
                          title={`${row.label} · Main video · ${msToLabel(o.start_ms)}–${msToLabel(o.end_ms)}`}
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); onSeek(o.start_ms) }}
                          className="absolute rounded-full hover:brightness-150"
                          style={{ top, height: THIN_H, left: `${pct(o.start_ms)}%`, width: `${pct(o.end_ms - o.start_ms)}%`, background: `${FRAME_ITEM_COLORS.main}66`, zIndex: 5 }} />,
                      )
                    }
                    for (const it of laneItems(of, row.lane, o)) {
                      const from = Math.max(it.start_ms, o.start_ms), to = Math.min(it.end_ms, o.end_ms)
                      const name = it.kind === 'video' ? (videoTitles[it.source_video_id ?? ''] ?? 'Video')
                        : it.kind === 'photo' ? 'Photo' : it.captions ? 'Captions' : (it.text?.trim() || 'Text')
                      bars.push(
                        <button key={`${o.id}-${it.id}`} aria-label={`${name}, ${row.label}, ${msToLabel(from)}–${msToLabel(to)}`}
                          title={`${name} · ${row.label} · ${msToLabel(from)}–${msToLabel(to)}`}
                          onPointerDown={e => e.stopPropagation()}
                          onClick={e => { e.stopPropagation(); onJumpToFrameItem?.(o.id, it.id) }}
                          className="absolute rounded-full hover:brightness-125"
                          style={{ top, height: THIN_H, left: `${pct(from)}%`, width: `max(4px, ${pct(to - from)}%)`, background: frameItemColor(it), zIndex: 6 }} />,
                      )
                    }
                    return bars
                  })
                })}
                {seg && frame && activeRows.map(row => {
                  const laneKey = String(row.lane)
                  const isMain = row.lane !== 'band' && main.includes(row.lane)
                  const mainId = `main:${row.lane}`
                  const pulsing = pulseLane === row.lane
                  return (
                    <div key={laneKey} className="relative" style={{ height: FRAME_LANE_H, cursor: 'pointer' }}
                      onPointerDown={e => { onSelectFrameItem?.(null); handleTrackDrag(e) }}>
                      {/* This frame's stretch of the lane */}
                      <div className="absolute inset-y-0.5 pointer-events-none" style={{
                        left: `${pct(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`, borderRadius: 5,
                        background: pulsing ? 'rgba(200,255,0,0.12)' : 'rgb(var(--ed-fg) / 0.045)',
                        boxShadow: pulsing ? 'inset 0 0 0 1.5px #c8ff00' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)',
                        transition: 'background 0.3s, box-shadow 0.3s',
                      }}>
                        <span className="absolute top-1/2 -translate-y-1/2 text-[10px] font-semibold whitespace-nowrap" style={{ left: 8, color: 'rgb(var(--ed-fg) / 0.3)' }}>
                          {row.label}{row.lane === 'band' ? ' band' : ''}
                        </span>
                      </div>
                      {/* The main video under this slot's items */}
                      {isMain && (() => {
                        const on = activeFrameItemId === mainId
                        return (
                          <div className="absolute inset-y-0.5 flex items-center overflow-hidden"
                            onPointerDown={e => { e.stopPropagation(); onSelectFrameItem?.(mainId); handleTrackDrag(e) }}
                            title="Main video · select it to change its sound or take it out of this slot"
                            style={{
                              left: `${pct(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`, borderRadius: 5,
                              background: `${FRAME_ITEM_COLORS.main}${on ? '40' : '24'}`,
                              boxShadow: on ? `inset 0 0 0 1.5px ${FRAME_ITEM_COLORS.main}` : `inset 2px 0 0 ${FRAME_ITEM_COLORS.main}`,
                            }}>
                            <span className="px-2 truncate text-[10px] font-semibold pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>{row.label} · Main video</span>
                          </div>
                        )
                      })()}
                      {/* Items */}
                      {laneItems(frame, row.lane, seg).map(it => {
                        const from = Math.max(it.start_ms, seg.start_ms), to = Math.min(it.end_ms, seg.end_ms)
                        const on = it.id === activeFrameItemId
                        const color = frameItemColor(it)
                        const name = it.kind === 'video' ? (videoTitles[it.source_video_id ?? ''] ?? 'Video')
                          : it.kind === 'photo' ? 'Photo'
                          : it.captions ? 'Captions' : (it.text?.trim() || 'Text')
                        return (
                          <div key={it.id} className="absolute inset-y-0.5 flex items-center overflow-hidden"
                            onPointerDown={e => handleFrameItemDown(e, it, 'move')}
                            title={`${name} · ${msToLabel(from)}–${msToLabel(to)} · drag to move, drag the ends to trim`}
                            style={{
                              left: `${pct(from)}%`, width: `max(8px, ${pct(to - from)}%)`, borderRadius: 5, zIndex: on ? 3 : 2,
                              background: `${color}${on ? '55' : '38'}`,
                              boxShadow: on ? `inset 0 0 0 1.5px ${color}, 0 0 0 1px rgba(0,0,0,0.5)` : `inset 0 0 0 1px ${color}88`,
                              cursor: dragging === `item-${it.id}` ? 'grabbing' : 'grab', touchAction: 'none',
                            }}>
                            <div className="absolute left-0 inset-y-0 w-2 cursor-col-resize z-10" style={{ background: 'rgba(0,0,0,0.25)' }}
                              onPointerDown={e => handleFrameItemDown(e, it, 'start')} />
                            {it.kind === 'photo' && it.image_url && (
                              // crossOrigin must match FrameMediaPool's <img> for the same URL (frameMedia.ts) —
                              // a mismatched second request for the same URL fails as a CORS error, not a fresh fetch.
                              <img src={it.image_url} alt="" crossOrigin="anonymous" className="h-full w-7 object-cover shrink-0 pointer-events-none" style={{ marginLeft: 8, opacity: 0.9 }} />
                            )}
                            <span className="px-2.5 truncate text-[10px] font-semibold pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.92)' }}>
                              {it.kind === 'text' && !it.captions ? 'T · ' : ''}{name}
                            </span>
                            <div className="absolute right-0 inset-y-0 w-2 cursor-col-resize z-10" style={{ background: 'rgba(0,0,0,0.25)' }}
                              onPointerDown={e => handleFrameItemDown(e, it, 'end')} />
                          </div>
                        )
                      })}
                      {/* "+" rides on the playhead: adds from here (splitting an item that's showing) */}
                      <button
                        ref={el => { if (el) plusRefs.current.set(laneKey, el); else plusRefs.current.delete(laneKey) }}
                        onPointerDown={e => e.stopPropagation()}
                        onClick={e => { e.stopPropagation(); onAddFrameItem?.(row.lane, e.currentTarget.getBoundingClientRect()) }}
                        aria-label={`Add to the ${row.label.toLowerCase()} ${row.lane === 'band' ? 'band' : 'slot'} at ${msToLabel(plusAt)}`}
                        title={row.lane === 'band' ? 'Add text or captions here' : 'Add a photo, video or text here'}
                        className="absolute top-1/2 flex items-center justify-center rounded-full transition-transform hover:scale-110 focus-visible:outline-none"
                        style={{
                          left: `${pct(plusAt)}%`, transform: 'translate(-50%, -50%)', width: 18, height: 18, zIndex: 41,
                          background: '#c8ff00', color: '#000', border: '1.5px solid rgba(0,0,0,0.7)',
                          boxShadow: pulsing ? '0 0 0 4px rgba(200,255,0,0.35), 0 0 12px rgba(200,255,0,0.8)' : '0 1px 4px rgba(0,0,0,0.6)',
                        }}>
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                      </button>
                    </div>
                  )
                })}
                {/* Playhead through the lanes */}
                <AtPlayhead pctOf={pct} className="absolute top-0 bottom-0 pointer-events-none" style={{ width: 2, marginLeft: -1, background: 'rgba(200,255,0,0.5)', zIndex: 40 }} />
              </div>
            )
          })()}

          {/* ── Tracks under the main video: everything added from outside it — videos, photos, text
              (any of them on any visual track) and music (audio tracks). One colour per kind ── */}
          {(visual.length > 0 || songs.length > 0) && (
            <div className="relative flex flex-col" style={{ gap: MEDIA_GAP, paddingTop: 6, paddingBottom: 4, borderTop: '1px solid rgb(var(--ed-fg) / 0.05)' }}>
              {laneGuide('broll-') ?? laneGuide('photo-') ?? laneGuide('music-') ?? laneGuide('text-')}
              {/* Playhead through all the media rows */}
              <AtPlayhead pctOf={pct} className="absolute top-0 bottom-0 w-px pointer-events-none" style={{ background: 'rgba(255,255,255,0.55)', zIndex: 15 }} />

              {/* The visual tracks (highest first: drawn over the ones under it), then the audio tracks */}
              {visualTracks.map((t, i) => trackRow('visual', t, i === 0 ? 'top' : null,
                visual.filter(v => v.track === t).map(v => (v.kind === 'shot' ? shotBar(v.seg) : v.kind === 'photo' ? photoBar(v.ph) : textBar(v.o)))))}
              {songTracks.map((t, i) => trackRow('audio', t, i === songTracks.length - 1 ? 'bottom' : null,
                songs.filter(m => (m.track ?? 0) === t).map(musicBar)))}

            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}

/** What the + at the top of the lanes adds (its track appears once something is on it) */
const ADD_KINDS: Array<{ kind: 'broll' | 'video' | 'photo' | 'music' | 'text'; label: string }> = [
  { kind: 'broll', label: 'B-roll' }, { kind: 'video', label: 'Video' }, { kind: 'photo', label: 'Photo' },
  { kind: 'music', label: 'Music' }, { kind: 'text', label: 'Text' },
]

/** The buttons beside a lane, in this order (CapCut's track header) */
export type LaneCtlKey = 'locked' | 'hidden' | 'muted'
export const LANE_CTL_KEYS: LaneCtlKey[] = ['locked', 'hidden', 'muted']
export interface LaneCtl {
  can: LaneCtlKey[]; state: Partial<Record<LaneCtlKey, boolean>>; empty: boolean
  /** What the buttons act on, when not the whole lane (the main video: "section 2") */
  note?: string
}

/** The drag type of an item dragged from the Media library (its LibraryItem as JSON; MediaLibrary.tsx) */
export const MEDIA_DRAG_TYPE = 'application/x-shortcut-media'

/** The drag type of stock footage dragged from the B-roll search (its StockResult as JSON) */
export const STOCK_DRAG_TYPE = 'application/x-shortcut-stock'

// The icon column next to the timeline: one per kind of lane
type LaneMeta = { label: string; color: string; icon: React.ReactNode; add?: 'video' | 'broll' | 'photo' | 'music' | 'text' }
const LANE_META: Record<string, LaneMeta> = {
  original: { label: 'Original sound', color: '#c084fc', icon: <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7" /></> },
  main: { label: 'Main video', color: 'rgb(var(--ed-fg) / 0.75)', icon: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" /></> },
  frame: { label: 'Frame slots', color: '#2dd4bf', icon: <><rect x="6" y="2.5" width="12" height="19" rx="2" /><path d="M6 9.5h12M6 14.5h12" /></> },
  broll: { label: 'B-roll', color: '#eab308', add: 'broll' as const, icon: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M10 9.5v5l4.5-2.5z" /></> },
  video: { label: 'Videos', color: '#f97316', add: 'video' as const, icon: <><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></> },
  photo: { label: 'Photos', color: '#60a5fa', add: 'photo' as const, icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></> },
  music: { label: 'Music', color: '#c084fc', add: 'music' as const, icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></> },
  text: { label: 'Text', color: '#f472b6', add: 'text' as const, icon: <path d="M4 7V4h16v3M9 20h6M12 4v16" /> },
}

// Media rows under the strip: one colour per kind (video is the orange bar over the strip)
const MEDIA_COLORS = { video: '#f97316', broll: '#eab308', photo: '#60a5fa', text: '#f472b6', music: '#c084fc' } as const
/** The main video's strip on the timeline */
const STRIP_H = 42
/** A track's row: as tall as the main video's strip */
const MEDIA_ROW_H = STRIP_H
/** The name and the length on a bar's header (CapCut's tags) */
const BAR_TAG: React.CSSProperties = { background: 'rgba(255,255,255,0.13)', color: '#fff', padding: '0 5px', borderRadius: 4, lineHeight: '15px' }
/** A length as CapCut shows it: hours:minutes:seconds:frames (30 a second) */
function timecode(ms: number): string {
  const f = Math.floor(Math.max(0, ms) / (1000 / 30))
  const p = (x: number) => String(x).padStart(2, '0')
  return `${p(Math.floor(f / 108000))}:${p(Math.floor(f / 1800) % 60)}:${p(Math.floor(f / 30) % 60)}:${p(f % 30)}`
}
const MEDIA_GAP = 8

/** Little marks on a bar (or a section's corner on the strip): hidden, muted, locked */
function StateBadges({ st, corner }: { st?: { hidden?: boolean; muted?: boolean; locked?: boolean }; corner?: boolean }) {
  if (!st || !(st.hidden || st.muted || st.locked)) return null
  const mark = (key: string, title: string, d: React.ReactNode) => (
    <span key={key} title={title} className="flex items-center justify-center rounded-full" style={{ width: 14, height: 14, background: 'rgba(0,0,0,0.7)', color: '#fff' }}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
    </span>
  )
  return (
    <span className={corner ? 'absolute left-2 top-1.5 flex gap-0.5 pointer-events-none' : 'relative shrink-0 flex items-center gap-0.5 pointer-events-none'} style={{ zIndex: 2 }}>
      {st.hidden && mark('h', 'Hidden: not shown or exported', <><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0112 5c5 0 9 5 9 7a11 11 0 01-2.2 3.2M6.6 6.6C4.4 8 3 10.4 3 12c0 2 4 7 9 7a9.6 9.6 0 004.4-1.1" /></>)}
      {st.muted && mark('m', 'Muted', <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></>)}
      {st.locked && mark('l', 'Locked: can\u2019t be moved, trimmed or deleted', <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>)}
    </span>
  )
}

/** Small icon in its kind's colour at the start of a media bar */
function MediaIcon({ kind }: { kind: 'video' | 'broll' | 'photo' | 'text' | 'music' }) {
  return (
    <svg className="relative shrink-0 pointer-events-none" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={MEDIA_COLORS[kind]} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ marginLeft: 8 }}>
      {kind === 'broll' ? <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M10 9.5v5l4.5-2.5z" /></>
        : kind === 'video' ? <><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></>
        : kind === 'photo' ? <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>
        : kind === 'music' ? <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>
          : <path d="M4 7V4h16v3M9 20h6M12 4v16" />}
    </svg>
  )
}

/**
 * Something at the playhead, moved with it every frame from the player's live feed (the timeline
 * around it redraws less often: see the player store)
 */
function AtPlayhead({ pctOf, className, style, children }: {
  pctOf: (ms: number) => number; className?: string; style?: React.CSSProperties
  children?: (ms: number, pct: number) => React.ReactNode
}) {
  const ms = useLiveTimeMs()
  const p = pctOf(ms)
  return <div className={className} style={{ ...style, left: `${p}%` }}>{children?.(ms, p)}</div>
}

/** Trim handle at one end of a media bar: a thin strip, with a small grip line */
function MediaGrip({ side, label, onPointerDown }: { side: 'left' | 'right'; label: string; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <span onPointerDown={onPointerDown} aria-label={label}
      className={`group/grip absolute inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} w-1.5 flex items-center justify-center cursor-col-resize z-10`}>
      <span className="w-[2px] h-2.5 rounded-full transition-colors bg-[rgba(255,255,255,0.35)] group-hover/grip:bg-white" />
    </span>
  )
}

