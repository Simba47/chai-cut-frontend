'use client'

import { useRef, useState, useEffect, useLayoutEffect, useCallback, Fragment } from 'react'
import type { SegmentLocal, TextOverlay, FrameItem, FrameLane } from '@chai-cut/shared'
import type { TrackRef } from '@/modules/editor/tracks'
import { Waveform } from '../Waveform'
import { liveTime, usePlayerStore } from '@/modules/player/store'
import { isFrameLayout, FRAME_TEMPLATES, frameOf, laneItems, itemBounds, MIN_ITEM_MS, isTextLane } from '@/modules/editor/frames'
import { isShot } from '@/modules/editor/shots'
import { TransitionGlyph, TRANSITION_DRAG_TYPE, TRANSITION_DEFAULT_MS, playedTransitionMs, transitionName, transitionSecs } from '../TransitionsPanel'
import {
  VideoThumbnails, LAYOUT_COLORS, FRAME_ITEM_COLORS, frameItemColor, visibleLanes, thumbsFor, nearestThumb,
  ACCENT, SELECTED_RING, msToLabel, LANE_META, type LaneMeta, InsertTag, MEDIA_COLORS,
  StateBadges, MediaIcon, MAX_ZOOM, STOCK_DRAG_TYPE, MEDIA_DRAG_TYPE, markTimelineOpened,
} from '../SegmentTimeline'

/**
 * The editor's timeline: the whole clip across the width, the playhead line moving over it. Press
 * or drag anywhere to move the playhead (near a cut it clicks onto it); pinch or Ctrl + wheel to
 * zoom, and the view then follows the playhead. Each part of the main video is its own block (its
 * format, its length), with a transition button in the gap between two parts; tap a block to
 * select it and drag its lime grips to trim. Videos on top, photos, text and music are slim
 * coloured bars on rows under it.
 *
 * The whole timeline is one layer, scrolled by moving it sideways; the playhead line is moved every
 * frame from the player's live time (no redraw while playing). Times are placed in % of the layer,
 * so every drag works out its time from where the layer is on screen (msFromClientX).
 */

export interface TimelineProps {
  segments: SegmentLocal[]
  clipStartMs: number
  clipEndMs: number
  currentTimeMs: number
  activeSegmentId: string | null
  videoUrl?: string
  sourceAt?: (clipMs: number) => number
  sourceKey?: string
  safeDurationMs?: number
  onSeek: (ms: number) => void
  /** Moving through the clip by hand starts: playback stops */
  onScrubStart?: () => void
  onSelectSegment: (id: string) => void
  /** A part's grip dragged (live: `done` false; once more on release) — see SegmentTimeline */
  onEdgeTrim?: (segId: string, edge: 'start' | 'end', fromMs: number, toMs: number, done: boolean) => void
  textOverlays?: TextOverlay[]
  activeTextOverlayId?: string | null
  onSelectTextOverlay?: (id: string) => void
  onTextOverlayUpdate?: (id: string, updates: { start_ms?: number; end_ms?: number }) => void
  frameSeg?: SegmentLocal | null
  activeFrameItemId?: string | null
  laneHighlight?: { lane: FrameLane; n: number; focusPlus?: boolean; openMenu?: boolean } | null
  videoTitles?: Record<string, string>
  onSelectFrameItem?: (id: string | null) => void
  onUpdateFrameItem?: (id: string, patch: Partial<Pick<FrameItem, 'start_ms' | 'end_ms' | 'source_offset_ms'>>) => void
  onAddFrameItem?: (lane: FrameLane, anchor: DOMRect) => void
  onJumpToFrameItem?: (segId: string, itemId: string) => void
  viewMarkers?: { t_ms: number; cut: boolean }[]
  selectedViewT?: number | null
  onSelectView?: (t: number) => void
  onMoveView?: (from: number, to: number) => number | void
  onRemoveView?: (t: number) => void
  onDuplicateView?: (t: number) => void
  videoUrls?: Record<string, string>
  mediaLengths?: Record<string, number>
  mainVideoId?: string | null
  onBrollChange?: (segId: string, startMs: number, endMs: number, done?: boolean) => void
  pickedSegmentId?: string | null
  selectedId?: string | null
  onPickSegment?: (id: string | null) => void
  musicTracks?: { id: string; name: string; start_ms: number; duration_ms?: number; original?: boolean; muted?: boolean; locked?: boolean; track?: number; url?: string; key?: string; offset_ms?: number }[]
  onMusicMove?: (id: string, startMs: number) => void
  onMusicTrim?: (id: string, edge: 'start' | 'end', ms: number) => void
  selectedMusicId?: string | null
  onSelectMusic?: (id: string) => void
  onAddKind?: (kind: 'video' | 'broll' | 'photo' | 'music' | 'text' | 'insert' | 'pip' | 'overlay', atMs?: number) => void
  /** Where a removed part closed up inside a part (timeline ms): drawn as a cut in its block */
  cutJoins?: number[]
  isStock?: (seg: SegmentLocal) => boolean
  /** The main video's own sound is off: the button at the start of the main row shows it */
  mainMuted?: boolean
  /** "Mute clip audio" at the start of the main row */
  onToggleMainMute?: () => void
  /** The clip's transitions (after which part, which kind, how long): the marker on each cut shows it */
  transitions?: { after_segment_id: string; type: string; duration_ms?: number | null }[]
  /** A cut's transition taken away (its marker's menu, or Delete on it) */
  onRemoveTransition?: (afterSegmentId: string) => void
  /** This cut's kind on every cut (each keeps its own length) */
  onApplyTransitionToAll?: (afterSegmentId: string) => void
  /** A tile from the Transitions panel dropped on a cut */
  onDropTransition?: (afterSegmentId: string, type: string) => void
  /** The transition button between two parts: open the Transition tool on that cut */
  onOpenTransition?: (afterSegmentId: string, atMs: number) => void
  onDropFiles?: (files: File[], atMs: number, lane: string | null) => void
  onDropStock?: (json: string, atMs: number, lane?: string | null) => void
  onDropMedia?: (json: string, atMs: number, lane: string | null) => void
  photos?: { id: string; start_ms: number; end_ms: number; url?: string; hidden?: boolean; locked?: boolean; track?: number; video?: { url?: string; offset: number; muted?: boolean }; /** covers the whole frame */ full?: boolean }[]
  onTrackDrop?: (ref: TrackRef, target: number | 'new') => void
  /** A block of the main row (a part, or a video put in) dragged along it, let go at `toMs` (where it goes in, timeline ms) */
  onMovePart?: (segId: string, toMs: number) => void
  activePhotoId?: string | null
  onSelectPhoto?: (id: string) => void
  onPhotoTimeChange?: (id: string, updates: { start_ms: number; end_ms: number }) => void
  zoom?: number
  onZoomChange?: (z: number) => void
}

/** What the + adds (at the playhead) */
const ADD_CHOICES: { kind: 'insert' | 'overlay' | 'music' | 'text'; label: string; hint: string; color: string; icon: React.ReactNode }[] = [
  { kind: 'insert', label: 'Main video', hint: 'Put a video into the clip here', color: ACCENT,
    icon: <><rect x="2" y="6" width="5" height="12" rx="1.5" /><rect x="17" y="6" width="5" height="12" rx="1.5" /><path d="M12 8v8M9 12h6" /></> },
  { kind: 'overlay', label: 'Overlay', hint: 'A video or photo on top — full screen or a window', color: MEDIA_COLORS.video,
    icon: <><rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><rect x="11" y="10" width="8" height="7" rx="1.2" fill="currentColor" fillOpacity=".3" /></> },
  { kind: 'music', label: 'Music & sound', hint: 'Background music, effects, your own audio', color: MEDIA_COLORS.music,
    icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></> },
  { kind: 'text', label: 'Text', hint: 'Words on the video', color: MEDIA_COLORS.text,
    icon: <path d="M4 7V4h16v3M9 20h6M12 4v16" /> },
]

const RULER_H = 26
const BLOCK_H = 48
const MAIN_PAD = 6
const VIEW_ROW_H = 20
const ORIG_ROW_H = 24
const ROW_H = 30
const ROW_GAP = 3
const FRAME_LANE_H = 26
const LEFT_W = 52
/** Room at each end of the timeline, so the grips at the clip's very ends stay clear of the border */
const PAD = 16
const GRIP_W = 14
/** Within this many pixels of a cut (or an item's edge) the playhead clicks onto it */
const SNAP_PX = 8
const MIN_PART_MS = 300

/** A clip time as the playhead's bubble shows it: 0:12.4 */
function clockLabel(ms: number) {
  // (to tenths first: 9.96 s is 0:10.0, not 0:010.0)
  const tenths = Math.round(Math.max(0, ms) / 100)
  const m = Math.floor(tenths / 600), s = (tenths % 600) / 10
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}
/** How long a part just made longer shows what it gained (then it looks as any other part) */
const GROWN_SHOW_MS = 1600
/** A block's length: 12.4s, or 1:05.2 */
function lenLabel(ms: number) {
  return ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : clockLabel(ms)
}
/** A format's short name on its block */
function formatTag(seg: SegmentLocal): string {
  if (isFrameLayout(seg.layout)) return FRAME_TEMPLATES[seg.layout].name
  if (seg.layout === 'split') return 'Split'
  return seg.layout.charAt(0).toUpperCase() + seg.layout.slice(1)
}

export function Timeline({
  segments, mainVideoId, clipStartMs, clipEndMs, currentTimeMs, activeSegmentId, videoUrl, sourceAt, sourceKey,
  safeDurationMs, onSeek, onScrubStart, onSelectSegment, onEdgeTrim,
  textOverlays = [], photos = [], activePhotoId = null, onSelectPhoto, onPhotoTimeChange,
  musicTracks = [], onMusicMove, onMusicTrim, selectedMusicId = null, onSelectMusic,
  activeTextOverlayId, onSelectTextOverlay, onTextOverlayUpdate,
  frameSeg, activeFrameItemId, laneHighlight, videoTitles = {}, onSelectFrameItem, onUpdateFrameItem, onAddFrameItem, onJumpToFrameItem,
  viewMarkers = [], selectedViewT = null, onSelectView, onMoveView, onRemoveView, onDuplicateView,
  onBrollChange, videoUrls = {}, mediaLengths = {}, zoom: zoomProp, onZoomChange,
  onAddKind, cutJoins = [], isStock, onDropFiles, onDropStock, onDropMedia,
  mainMuted = false, onToggleMainMute, transitions = [], onOpenTransition, onRemoveTransition, onApplyTransitionToAll, onDropTransition,
  onTrackDrop, onMovePart, pickedSegmentId = null, selectedId, onPickSegment,
}: TimelineProps) {
  const viewRef = useRef<HTMLDivElement>(null)        // what shows (the playhead sits in its middle)
  const contentRef = useRef<HTMLDivElement>(null)     // the layer that slides under it
  const trackRef = useRef<HTMLDivElement>(null)       // the ruler + main row: times are measured on it
  const lineRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLSpanElement>(null)
  const [viewW, setViewW] = useState(0)
  const [zoomState, setZoomState] = useState(1)
  const zoom = zoomProp ?? zoomState
  const setZoom = (z: number) => { if (onZoomChange) onZoomChange(z); else setZoomState(z) }
  const [dragging, setDragging] = useState<string | null>(null)
  const [snapLine, setSnapLine] = useState<number | null>(null)
  const [viewDragT, setViewDragT] = useState<number | null>(null)
  /** A grip being dragged: where its edge is now (the start of a block applies on release) */
  const [edgeGhost, setEdgeGhost] = useState<{ id: string; from: number; to: number; edge: 'start' | 'end' } | null>(null)
  // A part just made longer by dragging an edge out: which, at which edge, and how long it was before —
  // what it gained shows for a moment (GROWN_SHOW_MS), then it looks as any other part
  const [grown, setGrown] = useState<{ id: string; edge: 'start' | 'end'; before: number; key: number } | null>(null)
  useEffect(() => {
    if (!grown) return
    const t = setTimeout(() => setGrown(g => (g && g.key === grown.key ? null : g)), GROWN_SHOW_MS)
    return () => clearTimeout(t)
  }, [grown])
  /** While a grip is dragged the timeline keeps its scale (the clip's length changes under it) */
  const [frozenDur, setFrozenDur] = useState<number | null>(null)
  const [brollGhost, setBrollGhost] = useState<{ id: string; start: number; end: number } | null>(null)
  /** A bar dragged by its body: it follows the pointer up and down too (it lands on the row it's let go
   *  over), and its new time shows over the timeline */
  const [lift, setLift] = useState<{ id: string; dy: number; start: number; end: number } | null>(null)
  /** A video put in the main row, carried along it: where it will go in (`to`), how far it's carried */
  const [insertDrag, setInsertDrag] = useState<{ id: string; to: number; dx: number; dy: number } | null>(null)
  const [addMenu, setAddMenu] = useState<DOMRect | null>(null)
  const [dropAt, setDropAt] = useState<{ ms: number; lane: string | null; what: string } | null>(null)
  // A transition tile dragged over the timeline: the cut it would land on
  const [dropCut, setDropCut] = useState<string | null>(null)
  // A cut's marker right-clicked: its menu (where, which cut)
  const [cutMenu, setCutMenu] = useState<{ afterId: string; at: number; x: number; y: number } | null>(null)
  const [trackHover, setTrackHover] = useState<{ family: 'visual' | 'audio'; target: number | 'new' } | null>(null)
  const trackHoverRef = useRef<typeof trackHover>(null)
  const [pulseLane, setPulseLane] = useState<FrameLane | null>(null)
  const lanesRef = useRef<HTMLDivElement>(null)
  const plusRefs = useRef(new Map<string, HTMLButtonElement>())
  const noSnapRef = useRef(false)
  const nowRef = useRef(currentTimeMs)
  nowRef.current = currentTimeMs

  useEffect(() => { markTimelineOpened() }, [])
  useEffect(() => {
    if (!addMenu) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setAddMenu(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [addMenu])
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    setViewW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  // A lane pointed at from the preview: scroll to it, focus its "+", pulse it
  useEffect(() => {
    if (!laneHighlight) return
    setPulseLane(laneHighlight.lane)
    lanesRef.current?.scrollIntoView({ block: 'nearest', behavior: laneHighlight.openMenu ? 'auto' : 'smooth' })
    const plus = plusRefs.current.get(String(laneHighlight.lane))
    if (laneHighlight.focusPlus !== false) plus?.focus({ preventScroll: true })
    if (laneHighlight.openMenu && plus) onAddFrameItem?.(laneHighlight.lane, plus.getBoundingClientRect())
    const t = setTimeout(() => setPulseLane(null), 1800)
    return () => clearTimeout(t)
  }, [laneHighlight]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scale: at 1× the whole clip fills the width; zoomed in, the view scrolls along it ──
  const duration = (clipEndMs - clipStartMs) || safeDurationMs || 0
  const base = Math.max(120, viewW - PAD * 2)
  const scaleDur = Math.max(1, frozenDur ?? duration)
  const pxPerMs = (zoom * base) / scaleDur
  const viewDur = Math.max(duration, frozenDur ?? 0, 1)
  const contentW = viewDur * pxPerMs
  const pct = (ms: number) => (ms / viewDur) * 100
  const at = pct

  // ── The playhead line moves over the clip (every frame from the live time); zoomed in, the view
  //    follows it when it would leave the view ──
  /** How far the view is scrolled along the clip (px) */
  const scrollRef = useRef(0)
  /** While a grip is dragged the view keeps still (set: the layer's x) */
  const freezeRef = useRef<number | null>(null)
  /** When the view was last scrolled by hand: it doesn't follow the playhead right after */
  const handScrollAt = useRef(0)
  const geoRef = useRef({ viewW, pxPerMs, contentW })
  geoRef.current = { viewW, pxPerMs, contentW }
  const maxScroll = () => Math.max(0, geoRef.current.contentW - (geoRef.current.viewW - PAD * 2))
  const clampScroll = (x: number) => Math.max(0, Math.min(maxScroll(), x))
  const place = useCallback(() => {
    const c = contentRef.current, line = lineRef.current
    if (!c) return
    const { viewW: w, pxPerMs: k } = geoRef.current
    const now = liveTime.get()
    if (freezeRef.current == null) {
      scrollRef.current = clampScroll(scrollRef.current)
      // (the playhead about to leave the view: the view moves on, the playhead at a fifth of it)
      const x = now * k - scrollRef.current, span = w - PAD * 2
      if ((x < 0 || x > span - 16) && performance.now() - handScrollAt.current > 800) scrollRef.current = clampScroll(now * k - span * 0.2)
    }
    const tx = freezeRef.current ?? PAD - scrollRef.current
    c.style.transform = `translate3d(${tx}px,0,0)`
    if (line) line.style.transform = `translate3d(${tx + now * k}px,0,0)`
    if (bubbleRef.current) bubbleRef.current.textContent = clockLabel(now)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(place)
  useEffect(() => liveTime.subscribe(place), [place])
  /** The layer's x offset right now */
  const currentTx = () => freezeRef.current ?? PAD - scrollRef.current
  /** Let go of a frozen view: it stays where it was */
  const unfreeze = () => {
    if (freezeRef.current != null) scrollRef.current = clampScroll(PAD - freezeRef.current)
    freezeRef.current = null
    handScrollAt.current = performance.now()
    place()
  }
  // Zoomed with the wheel: the moment under the pointer stays under the pointer
  const zoomAnchor = useRef<{ t: number; x: number } | null>(null)
  useLayoutEffect(() => {
    const a = zoomAnchor.current
    if (!a) return
    zoomAnchor.current = null
    scrollRef.current = clampScroll(a.t * pxPerMs - a.x)
    handScrollAt.current = performance.now()
    place()
  }, [pxPerMs]) // eslint-disable-line react-hooks/exhaustive-deps

  function msFromClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return Math.max(0, Math.min(((clientX - rect.left) / rect.width) * viewDur, duration))
  }
  const msPerPx = () => 1 / Math.max(1e-9, pxPerMs)

  // ── The parts of the main row, the videos on top, the rows under it ──
  const byTime = [...segments].sort((a, b) => a.start_ms - b.start_ms)
  const brolls = byTime.filter(sg => isShot(sg, mainVideoId))
  const mains = byTime.filter(sg => !isShot(sg, mainVideoId))
  const junctions: { left: SegmentLocal; right: SegmentLocal }[] = []
  for (let i = 0; i + 1 < mains.length; i++) {
    if (Math.abs(mains[i + 1].start_ms - mains[i].end_ms) <= 1) junctions.push({ left: mains[i], right: mains[i + 1] })
  }
  const gaps: { start_ms: number; end_ms: number }[] = []
  {
    let cursor = 0
    for (const seg of mains) {
      if (seg.start_ms - cursor >= 50) gaps.push({ start_ms: cursor, end_ms: seg.start_ms })
      cursor = Math.max(cursor, seg.end_ms)
    }
    if (duration - cursor >= 50) gaps.push({ start_ms: cursor, end_ms: duration })
  }
  const isSel = (id: string, own: boolean) => (selectedId !== undefined ? id === selectedId : own)
  const musicEnd = (m: { start_ms: number; duration_ms?: number }) => Math.min(duration, m.start_ms + (m.duration_ms ?? duration))
  const originals = musicTracks.filter(m => m.original)
  const songs = musicTracks.filter(m => !m.original)
  type Visual = { kind: 'shot'; id: string; track: number; seg: SegmentLocal }
    | { kind: 'photo'; id: string; track: number; ph: (typeof photos)[number] }
    | { kind: 'text'; id: string; track: number; o: TextOverlay }
  const visual: Visual[] = [
    ...brolls.map(seg => ({ kind: 'shot' as const, id: seg.id, track: seg.track ?? 0, seg })),
    ...photos.map(ph => ({ kind: 'photo' as const, id: ph.id, track: ph.track ?? 0, ph })),
    ...textOverlays.map(o => ({ kind: 'text' as const, id: o.id, track: o.track ?? 0, o })),
  ]
  const visualTracks = [...new Set(visual.map(v => v.track))].sort((a, b) => b - a)
  const songTracks = [...new Set(songs.map(m => m.track ?? 0))].sort((a, b) => a - b)
  const transitionAfter = new Map(transitions.map(t => [t.after_segment_id, t]))

  // ── Moving the playhead: press or drag anywhere on the ruler or the rows; it clicks onto cuts ──
  /** Where the playhead clicks to: cuts, the clip's ends, and the edges of everything on the rows */
  const snapTargets = () => {
    const out = [0, duration, ...cutJoins]
    for (const s of segments) out.push(s.start_ms, s.end_ms)
    for (const p of photos) out.push(p.start_ms, p.end_ms)
    for (const o of textOverlays) out.push(o.start_ms, o.end_ms)
    for (const m of musicTracks) out.push(m.start_ms, musicEnd(m))
    return out
  }
  const [snapFlash, setSnapFlash] = useState(0)
  function scrubTo(t: number, snap = true) {
    let best = Math.max(0, Math.min(duration, t))
    if (snap) {
      const tol = SNAP_PX * msPerPx()
      let bestD = tol, hit: number | null = null
      for (const x of snapTargets()) { const d = Math.abs(x - t); if (d < bestD) { bestD = d; hit = x } }
      if (hit !== null) {
        // (on the last frame of the part before a cut, not past the clip's end)
        best = Math.min(hit, Math.max(0, duration - 1))
        if (snapAtRef.current !== hit) { snapAtRef.current = hit; setSnapFlash(n => n + 1) }
      } else snapAtRef.current = null
    }
    onSeek(best)
  }
  const snapAtRef = useRef<number | null>(null)
  /** The main row's part under the pointer (null: none there) */
  const partAt = (clientX: number, clientY: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return undefined
    const y = clientY - rect.top
    if (y < RULER_H + MAIN_PAD || y > RULER_H + MAIN_PAD + BLOCK_H) return undefined
    const t = msFromClientX(clientX)
    return mains.find(m => t >= m.start_ms && t < m.end_ms) ?? null
  }
  function handleScrubDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    // The block under the finger (a very short part is drawn a little wider than its time: it is
    // still the one picked), else the part at that time on the main row
    const blockEl = (e.target as Element | null)?.closest?.('.tl2-block[data-part]')
    const hit = blockEl ? mains[Number(blockEl.getAttribute('data-part')) - 1] ?? null : partAt(e.clientX, e.clientY)
    // On the main row: that part is picked. Anywhere else (the ruler, an empty spot): nothing is —
    // a click outside the selected part lets go of it (the playhead still moves there)
    onPickSegment?.(hit?.id ?? null)
    // A block of the main row: dragged, it moves (a tap still moves the playhead). With only one
    // part there's nowhere to move it: dragging moves the playhead, as on the ruler
    if (hit && onMovePart && !hit.locked && mains.length > 1) { handlePartDown(e, hit); return }
    const { setScrubbing } = usePlayerStore.getState()
    onScrubStart?.()
    setScrubbing(true)
    setDragging('scrub')
    scrubTo(msFromClientX(e.clientX), !e.altKey)
    const move = (ev: PointerEvent) => scrubTo(msFromClientX(ev.clientX), !ev.altKey)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      setScrubbing(false); setDragging(null); snapAtRef.current = null
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  /**
   * A block of the main row (a part of the main video, or a video put in) dragged: it's carried with
   * the pointer, and a line shows where it will go in — between two parts (it clicks onto the
   * joins), or into a part, which it cuts in two. Let go: it moves there (onMovePart). Not moved:
   * a tap, the playhead goes there.
   */
  function handlePartDown(e: React.PointerEvent, seg: SegmentLocal) {
    e.preventDefault()
    const sx = e.clientX, sy = e.clientY
    const joins = [0, duration, ...mains.flatMap(m => [m.start_ms, m.end_ms])]
    let moved = false, to = seg.start_ms
    setDragging(`insert-${seg.id}`)
    track(ev => {
      if (!moved && Math.abs(ev.clientX - sx) < 4 && Math.abs(ev.clientY - sy) < 4) return
      moved = true
      const raw = msFromClientX(ev.clientX)
      let best = raw, bestD = ev.altKey ? 0 : 14 * msPerPx()
      for (const j of joins) { const d = Math.abs(j - raw); if (d < bestD) { best = j; bestD = d } }
      to = Math.round(best)
      setInsertDrag({ id: seg.id, to, dx: ev.clientX - sx, dy: ev.clientY - sy })
    }, () => {
      setInsertDrag(null)
      if (!moved) { scrubTo(msFromClientX(sx)); return }
      // (let go over itself: it stays)
      if (to > seg.start_ms && to < seg.end_ms) return
      onMovePart?.(seg.id, to)
    })
  }
  // Wheel / trackpad: Ctrl + wheel or a pinch zooms (the moment under the pointer stays put);
  // sideways (or Shift) scrolls the zoomed timeline; up and down goes through the rows
  const zoomRef = useRef(zoom)
  zoomRef.current = zoom
  const setZoomRef = useRef(setZoom)
  setZoomRef.current = setZoom
  useEffect(() => {
    const el = viewRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        const k = e.ctrlKey && Math.abs(e.deltaY) < 40 ? 0.012 : 0.0026
        const z0 = zoomRef.current
        const z = Math.round(Math.max(1, Math.min(MAX_ZOOM, z0 * Math.exp(-e.deltaY * k))) * 100) / 100
        if (z === z0) return
        const x = e.clientX - el.getBoundingClientRect().left - PAD
        zoomAnchor.current = { t: (scrollRef.current + x) / geoRef.current.pxPerMs, x }
        setZoomRef.current(z)
        return
      }
      const sideways = Math.abs(e.deltaX) > Math.abs(e.deltaY)
      if (!sideways && !e.shiftKey) return   // (up and down through the rows)
      // (taken even with nothing to scroll: a sideways swipe must never reach the browser, which
      // would take it as "go back" and leave the editor)
      e.preventDefault()
      if (maxScroll() <= 0) return
      scrollRef.current = clampScroll(scrollRef.current + (sideways ? e.deltaX : e.deltaY))
      handScrollAt.current = performance.now()
      place()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Grips: trim the selected part (live for an end; a start applies on release) ──
  function handleEdgeDown(e: React.PointerEvent, seg: SegmentLocal, edge: 'start' | 'end') {
    e.stopPropagation()
    e.preventDefault()
    if (e.button !== 0) return
    onSelectSegment(seg.id)
    if (seg.locked || !onEdgeTrim) return
    const sx = e.clientX
    const from = edge === 'start' ? seg.start_ms : seg.end_ms
    let to = from, moved = false, lastX = sx
    const k = msPerPx()
    // A start dragged out brings back the video before the part — as far back as the video goes
    // (its own start: 0 s of the video). Holding at the view's left edge keeps bringing more back:
    // the layer stays still meanwhile (the part's end and its grip stay where they are, in view), the
    // start stays at the view's edge, and how much is coming back counts up (`extra`, on the tip)
    let extra = 0
    const isMain = !(seg.video_offset_ms != null && seg.crop_boxes[0]?.source_video_id)
    const videoBefore = edge === 'start' && isMain ? Math.max(0, sourceAt ? sourceAt(seg.start_ms) : clipStartMs + seg.start_ms) : 0
    const minTo = edge === 'start' ? from - videoBefore : -Infinity
    // The layer keeps still meanwhile (the playhead line goes to the edge being cut, as in CapCut)
    const tx0 = currentTx()
    freezeRef.current = tx0
    setFrozenDur(duration)
    setDragging(`${edge}-${seg.id}`)
    const vr = viewRef.current?.getBoundingClientRect()
    let raf = 0, seekRaf = 0, auto = 0
    // The preview shows the frame the cut lands on (a start dragged in: its new first frame; an end:
    // its new last frame — after the clip was redrawn with the cut)
    const follow = () => {
      if (seekRaf) return
      seekRaf = requestAnimationFrame(() => {
        seekRaf = requestAnimationFrame(() => {
          seekRaf = 0
          if (edge === 'start' && to > from) onSeek(Math.round(to))
          if (edge === 'end' && to < from) onSeek(Math.max(seg.start_ms, Math.round(to) - 1))
        })
      })
    }
    const apply = () => { raf = 0; onEdgeTrim(seg.id, edge, Math.round(from), Math.round(to), false); follow() }
    const update = () => {
      // (the layer may have been scrolled along by holding near the view's edge)
      const shift = (freezeRef.current ?? tx0) - tx0
      const t = from + (lastX - sx - shift) * k - extra
      to = edge === 'start' ? Math.max(minTo, Math.min(seg.end_ms - MIN_PART_MS, t)) : Math.max(seg.start_ms + MIN_PART_MS, t)
      setEdgeGhost({ id: seg.id, from, to, edge })
      if (edge === 'end' && !raf) raf = requestAnimationFrame(apply)
      if (edge === 'start') follow()
    }
    // Holding near the view's edge scrolls the timeline along (more to cut, or to bring back)
    const autoScroll = () => {
      auto = 0
      if (!vr || freezeRef.current == null) return
      const edgeZone = 40
      const v = lastX < vr.left + edgeZone ? (vr.left + edgeZone - lastX) : lastX > vr.right - edgeZone ? -(lastX - (vr.right - edgeZone)) : 0
      // A start held at the left edge with the layer as far left as it goes (the clip's 0:00 in view):
      // more video comes back, faster the further into the edge, the layer still
      if (v > 0 && moved && edge === 'start' && freezeRef.current >= PAD - 0.5 && to > minTo + 1) {
        extra = Math.min(from - minTo, extra + Math.min(18, v * 0.35) * k)
        update()
        auto = requestAnimationFrame(autoScroll)
        return
      }
      if (v !== 0 && moved) {
        // (only as far as there is more of the clip to show: at 1× the whole clip is in view)
        const next = Math.max(PAD - maxScroll(), Math.min(PAD, freezeRef.current + Math.max(-18, Math.min(18, v * 0.35))))
        if (next !== freezeRef.current) {
          freezeRef.current = next
          place()
          update()
        }
      }
      auto = requestAnimationFrame(autoScroll)
    }
    auto = requestAnimationFrame(autoScroll)
    const move = (ev: PointerEvent) => {
      lastX = ev.clientX
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      update()
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (raf) cancelAnimationFrame(raf)
      if (seekRaf) cancelAnimationFrame(seekRaf)
      if (auto) cancelAnimationFrame(auto)
      setDragging(null)
      setEdgeGhost(null)
      setFrozenDur(null)
      if (moved) onEdgeTrim(seg.id, edge, Math.round(from), Math.round(to), true)
      // (dragged out: what it gained shows for a moment)
      if (moved && (edge === 'start' ? to < from : to > from)) setGrown({ id: seg.id, edge, before: seg.end_ms - seg.start_ms, key: performance.now() })
      unfreeze()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // ── Bars on the rows (as before: the body moves them, the ends trim them, up / down: another
  //    track). A tap selects; it doesn't move the playhead ──
  function edgeSnap(t: number, ignoreId?: string): number | null {
    if (noSnapRef.current) return null
    const tol = 10 * msPerPx()
    let best: number | null = null, bestD = tol
    for (const x of [0, duration, nowRef.current, ...segments.filter(sg => sg.id !== ignoreId).flatMap(sg => [sg.start_ms, sg.end_ms])]) {
      const d = Math.abs(x - t)
      if (d < bestD) { best = x; bestD = d }
    }
    return best
  }
  function snapEdgeAt(t: number, ignoreId?: string): number {
    const sn = edgeSnap(t, ignoreId)
    setSnapLine(sn)
    return sn ?? t
  }
  function snapSpanAt(st: number, len: number, ignoreId?: string): number {
    const a = edgeSnap(st, ignoreId), b = edgeSnap(st + len, ignoreId)
    const da = a === null ? Infinity : Math.abs(a - st), db = b === null ? Infinity : Math.abs(b - (st + len))
    if (a !== null && da <= db) { setSnapLine(a); return a }
    if (b !== null) { setSnapLine(b); return Math.max(0, b - len) }
    setSnapLine(null)
    return st
  }
  function track(move: (ev: PointerEvent) => void, done?: () => void) {
    const up = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up)
      setDragging(null); setSnapLine(null); setLift(null); done?.()
    }
    const onMove = (ev: PointerEvent) => { noSnapRef.current = ev.altKey; move(ev) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
  }
  function hoverTrack(ev: PointerEvent, family: 'visual' | 'audio', current: number) {
    const rows = [...(viewRef.current?.querySelectorAll<HTMLElement>(`[data-track-row="${family}"]`) ?? [])]
    if (!rows.length) return
    const y = ev.clientY
    const first = rows[0].getBoundingClientRect(), last = rows[rows.length - 1].getBoundingClientRect()
    let target: number | 'new'
    if (family === 'visual' ? y < first.top - ROW_GAP : y > last.bottom + ROW_GAP) target = 'new'
    else target = Number((rows.find(r => y < r.getBoundingClientRect().bottom + ROW_GAP / 2) ?? rows[rows.length - 1]).dataset.track)
    const next = target === current ? null : { family, target }
    trackHoverRef.current = next
    setTrackHover(prev => (prev?.family === next?.family && prev?.target === next?.target ? prev : next))
  }
  function endTrackDrag(ref: TrackRef, current: number) {
    const h = trackHoverRef.current
    trackHoverRef.current = null
    setTrackHover(null)
    onTrackDrop?.(ref, h?.target ?? current)
  }
  function handleBrollDown(e: React.PointerEvent, seg: SegmentLocal, part: 'body' | 'start' | 'end') {
    e.stopPropagation(); e.preventDefault()
    onPickSegment?.(seg.id)
    if (seg.locked) return
    const sx = e.clientX, sy = e.clientY
    const grab = msFromClientX(e.clientX) - seg.start_ms
    const len = seg.end_ms - seg.start_ms
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
        setLift({ id: seg.id, dy: ev.clientY - sy, ...next })
        return
      }
      if (part === 'start') next = { start: Math.max(minStart, Math.min(seg.end_ms - 500, snapEdgeAt(t, seg.id))), end: seg.end_ms }
      else next = { start: seg.start_ms, end: Math.min(maxEnd, Math.max(seg.start_ms + 500, snapEdgeAt(t, seg.id))) }
      onBrollChange?.(seg.id, Math.round(next.start), Math.round(next.end), false)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setDragging(null); setBrollGhost(null); setSnapLine(null); setLift(null)
      if (!moved) return
      onBrollChange?.(seg.id, Math.round(next.start), Math.round(next.end), true)
      endTrackDrag({ kind: 'shot', id: seg.id }, seg.track ?? 0)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function handleMusicDrag(e: React.PointerEvent, m: (typeof musicTracks)[number]) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectMusic?.(m.id)
    if (m.locked) return
    const k = msPerPx(), sx = e.clientX, sy = e.clientY, len = musicEnd(m) - m.start_ms
    setDragging(`music-${m.id}`)
    let dragged = false
    track(ev => {
      if (!dragged && Math.abs(ev.clientX - sx) < 3 && Math.abs(ev.clientY - sy) < 3) return
      dragged = true
      const st = Math.round(snapSpanAt(Math.max(0, Math.min(duration - 200, m.start_ms + (ev.clientX - sx) * k)), len))
      onMusicMove?.(m.id, st)
      // (the clip's own sound stays on its row: only along)
      setLift({ id: m.id, dy: m.original ? 0 : ev.clientY - sy, start: st, end: Math.min(duration, st + len) })
      if (!m.original) hoverTrack(ev, 'audio', m.track ?? 0)
    }, () => { if (dragged && !m.original) endTrackDrag({ kind: 'music', id: m.id }, m.track ?? 0) })
  }
  function handleMusicTrim(e: React.PointerEvent, m: (typeof musicTracks)[number], edge: 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectMusic?.(m.id)
    if (m.locked) return
    const k = msPerPx(), sx = e.clientX
    const orig = edge === 'start' ? m.start_ms : musicEnd(m)
    setDragging(`music-${m.id}`)
    track(ev => onMusicTrim?.(m.id, edge, Math.round(snapEdgeAt(orig + (ev.clientX - sx) * k))),
      () => { if (!m.original) endTrackDrag({ kind: 'music', id: m.id }, m.track ?? 0) })
  }
  function handlePhotoDrag(e: React.PointerEvent, ph: (typeof photos)[number], part: 'body' | 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectPhoto?.(ph.id)
    if (ph.locked) return
    const k = msPerPx(), sx = e.clientX, sy = e.clientY, len = ph.end_ms - ph.start_ms
    setDragging(`photo-${ph.id}`)
    let dragged = false
    track(ev => {
      if (!dragged && Math.abs(ev.clientX - sx) < 3 && (part !== 'body' || Math.abs(ev.clientY - sy) < 3)) return
      dragged = true
      const d = (ev.clientX - sx) * k
      if (part === 'body') {
        const st = Math.round(snapSpanAt(Math.max(0, Math.min(duration - len, ph.start_ms + d)), len))
        onPhotoTimeChange?.(ph.id, { start_ms: st, end_ms: Math.min(duration, st + len) })
        setLift({ id: ph.id, dy: ev.clientY - sy, start: st, end: Math.min(duration, st + len) })
        hoverTrack(ev, 'visual', ph.track ?? 0)
      } else if (part === 'start') {
        onPhotoTimeChange?.(ph.id, { start_ms: Math.round(Math.max(0, Math.min(ph.end_ms - 200, snapEdgeAt(ph.start_ms + d)))), end_ms: ph.end_ms })
      } else {
        onPhotoTimeChange?.(ph.id, { start_ms: ph.start_ms, end_ms: Math.round(Math.min(duration, Math.max(ph.start_ms + 200, snapEdgeAt(ph.end_ms + d)))) })
      }
    }, () => { if (dragged) endTrackDrag({ kind: 'photo', id: ph.id }, ph.track ?? 0) })
  }
  function handleTextDrag(e: React.PointerEvent, o: TextOverlay, part: 'body' | 'start' | 'end') {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectTextOverlay?.(o.id)
    if (o.locked) return
    const k = msPerPx(), sx = e.clientX, sy = e.clientY, len = o.end_ms - o.start_ms, trackNo = o.track ?? 0
    setDragging(`text-${o.id}`)
    let dragged = false
    track(ev => {
      if (!dragged && Math.abs(ev.clientX - sx) < 3 && (part !== 'body' || Math.abs(ev.clientY - sy) < 3)) return
      dragged = true
      const d = (ev.clientX - sx) * k
      if (part === 'body') {
        const st = Math.round(snapSpanAt(Math.max(0, Math.min(duration - len, o.start_ms + d)), len))
        onTextOverlayUpdate?.(o.id, { start_ms: st, end_ms: Math.min(duration, st + len) })
        setLift({ id: o.id, dy: ev.clientY - sy, start: st, end: Math.min(duration, st + len) })
        hoverTrack(ev, 'visual', trackNo)
      } else if (part === 'start') {
        onTextOverlayUpdate?.(o.id, { start_ms: Math.round(Math.max(0, Math.min(o.end_ms - 200, snapEdgeAt(o.start_ms + d)))) })
      } else {
        onTextOverlayUpdate?.(o.id, { end_ms: Math.round(Math.min(duration, Math.max(o.start_ms + 200, snapEdgeAt(o.end_ms + d)))) })
      }
    }, () => { if (dragged) endTrackDrag({ kind: 'text', id: o.id }, trackNo) })
  }
  function handleFrameItemDown(e: React.PointerEvent, item: FrameItem, mode: 'move' | 'start' | 'end') {
    if (e.button !== 0 || !frameSeg) return
    e.stopPropagation(); e.preventDefault()
    onSelectFrameItem?.(item.id)
    if (frameSeg.locked || item.locked) return
    const frame = frameOf(frameSeg)
    const { min, max } = itemBounds(frame, item, frameSeg)
    const s0 = Math.max(item.start_ms, frameSeg.start_ms), e0 = Math.min(item.end_ms, frameSeg.end_ms)
    const len = Math.min(e0 - s0, max - min)
    const tol = SNAP_PX * msPerPx()
    const targets = [nowRef.current, frameSeg.start_ms, frameSeg.end_ms]
    for (const it of frame.items ?? []) if (it.id !== item.id) targets.push(it.start_ms, it.end_ms)
    const snapT = (t: number) => { let best = t, bestD = tol; for (const x of targets) { const d = Math.abs(x - t); if (d < bestD) { best = x; bestD = d } } return best }
    const sx = e.clientX, k = msPerPx()
    let moved = false
    setDragging(`item-${item.id}`)
    track(ev => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const d = (ev.clientX - sx) * k
      if (mode === 'move') {
        const a = snapT(s0 + d), b = snapT(s0 + d + len) - len
        const ns = Math.round(Math.max(min, Math.min(max - len, a !== s0 + d ? a : b)))
        onUpdateFrameItem?.(item.id, { start_ms: ns, end_ms: ns + len })
      } else if (mode === 'start') {
        const ns = Math.round(Math.max(min, Math.min(e0 - MIN_ITEM_MS, snapT(s0 + d))))
        const off = item.kind === 'video' ? { source_offset_ms: Math.max(0, (item.source_offset_ms ?? 0) + (ns - item.start_ms)) } : {}
        onUpdateFrameItem?.(item.id, { start_ms: ns, ...off })
        setSnapLine(ns)
      } else {
        const ne = Math.round(Math.min(max, Math.max(s0 + MIN_ITEM_MS, snapT(e0 + d))))
        onUpdateFrameItem?.(item.id, { end_ms: ne })
        setSnapLine(ne)
      }
    })
  }
  function handleViewDown(e: React.PointerEvent, t: number, first: boolean) {
    if (e.button !== 0) return
    e.stopPropagation(); e.preventDefault()
    onSelectView?.(t)
    if (first || !onMoveView) return
    const sx = e.clientX
    let cur = t, moved = false
    setDragging(`view-${t}`)
    track(ev => {
      if (!moved && Math.abs(ev.clientX - sx) < 3) return
      moved = true
      const landed = onMoveView(cur, Math.round(msFromClientX(ev.clientX)))
      if (typeof landed === 'number') { cur = landed; setSnapLine(landed); setViewDragT(landed) }
    }, () => setViewDragT(null))
  }

  // ── Drops from outside (files, stock footage, the Media library) ──
  const laneAt = (el: Element) => el.closest?.('[data-lane]')?.getAttribute('data-lane') ?? null
  const dropKind = (e: React.DragEvent) => e.dataTransfer.types.includes(STOCK_DRAG_TYPE) ? 'stock' : e.dataTransfer.types.includes(MEDIA_DRAG_TYPE) ? 'media' : e.dataTransfer.types.includes('Files') ? 'files' : null
  /** The cut a transition dropped at this x lands on: the nearest one, if within reach (24 px) */
  const cutNear = (clientX: number) => {
    const ms = msFromClientX(clientX)
    let best: { id: string; d: number } | null = null
    for (const { left } of junctions) {
      const d = Math.abs(left.end_ms - ms) * pxPerMs
      if (d <= 24 && (!best || d < best.d)) best = { id: left.id, d }
    }
    return best?.id ?? null
  }
  function onDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(TRANSITION_DRAG_TYPE)) {
      // A transition tile: only over a cut can it be dropped (elsewhere: not allowed)
      const id = onDropTransition ? cutNear(e.clientX) : null
      setDropCut(prev => (prev === id ? prev : id))
      if (id) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
      return
    }
    const kind = dropKind(e)
    if (!kind || (kind === 'files' && !onDropFiles) || (kind === 'stock' && !onDropStock) || (kind === 'media' && !onDropMedia)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const lane = laneAt(e.target as Element)
    const ms = Math.round(msFromClientX(e.clientX))
    // (on the main row a video goes into the clip; anywhere else it goes on top)
    const what = lane === 'main' ? 'Put in the clip' : 'Overlay'
    setDropAt(prev => (prev && prev.ms === ms && prev.lane === lane ? prev : { ms, lane, what }))
  }
  function onDrop(e: React.DragEvent) {
    if (e.dataTransfer.types.includes(TRANSITION_DRAG_TYPE)) {
      const id = cutNear(e.clientX), type = e.dataTransfer.getData(TRANSITION_DRAG_TYPE)
      setDropCut(null)
      if (id && type && onDropTransition) { e.preventDefault(); onDropTransition(id, type) }
      return
    }
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

  // ── The left column: what each row is (lined up with the rows) ──
  const [laneSpans, setLaneSpans] = useState<{ kind: string; top: number; h: number }[]>([])
  const measureLanes = () => {
    const box = viewRef.current
    if (!box) return
    const base0 = box.getBoundingClientRect().top
    const by = new Map<string, { top: number; bottom: number }>()
    box.querySelectorAll<HTMLElement>('[data-lane]').forEach(el => {
      const r = el.getBoundingClientRect(), k = el.dataset.lane!
      const cur = by.get(k)
      by.set(k, { top: Math.min(cur?.top ?? Infinity, r.top - base0), bottom: Math.max(cur?.bottom ?? -Infinity, r.bottom - base0) })
    })
    const cover = trackRef.current ? trackRef.current.getBoundingClientRect().bottom - base0 : 0
    const next = [...by].map(([kind, v]) => ({ kind, top: Math.round(v.top), h: Math.round(v.bottom - v.top) }))
      .filter(sp => sp.kind === 'main' || sp.kind === 'original' || sp.kind === 'views' || sp.top + sp.h / 2 > cover)
    setLaneSpans(prev => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }
  useLayoutEffect(measureLanes)
  const metaOf = (kind: string): LaneMeta | undefined => {
    if (kind === 'main' || kind === 'views' || kind === 'frame') return undefined
    if (LANE_META[kind]) return LANE_META[kind]
    const vt = /^track-(\d+)$/.exec(kind)
    if (vt) {
      const on = visual.filter(v => v.track === Number(vt[1]))
      const like = on.some(v => v.kind === 'shot') ? LANE_META.video : on.some(v => v.kind === 'photo') ? LANE_META.photo : LANE_META.text
      return { label: like.label, color: like.color, icon: like.icon }
    }
    if (/^audio-\d+$/.test(kind)) return { ...LANE_META.music, label: 'Music' }
    if (kind.startsWith('frame:')) return LANE_META.frame
    return undefined
  }

  // ── Ruler ticks ──
  const TICKS: [number, number][] = [[100, 2], [200, 2], [500, 5], [1000, 5], [2000, 4], [5000, 5], [10000, 5], [15000, 3], [30000, 6], [60000, 6], [120000, 4], [300000, 5]]
  const [majorMs, minorPer] = TICKS.find(([ms]) => ms * pxPerMs >= 64) ?? TICKS[TICKS.length - 1]
  const minorMs = majorMs / minorPer
  const ticks: { t: number; major: boolean }[] = []
  for (let i = 0; i * minorMs <= viewDur + 1; i++) ticks.push({ t: i * minorMs, major: i % minorPer === 0 })
  const tickLabel = (t: number) => (majorMs < 1000 ? clockLabel(t) : msToLabel(t))

  // ── Pieces of the main row ──
  const trimming = edgeGhost
  const blockBox = (start: number, end: number): React.CSSProperties => ({
    left: `calc(${at(start)}% + 1.5px)`, width: `max(6px, calc(${pct(end - start)}% - 3px))`, top: MAIN_PAD, height: BLOCK_H,
  })
  const mainBlock = (seg: SegmentLocal, i: number) => {
    const isInsert = seg.video_offset_ms != null && !!seg.crop_boxes[0]?.source_video_id
    const sel = isSel(seg.id, seg.id === (pickedSegmentId ?? activeSegmentId))
    const g = trimming && trimming.id === seg.id ? trimming : null
    // A start being dragged: the block shows where it will start (applied on release) — from no
    // further left than the view's edge, so its grip stays in sight (dragged out before the clip's 0:00)
    const viewLeftMs = freezeRef.current != null ? (2 - freezeRef.current) / pxPerMs : -Infinity
    const start = g && g.edge === 'start' ? Math.max(g.to, viewLeftMs) : seg.start_ms
    const end = seg.end_ms
    const box = seg.crop_boxes[0]
    const name = isInsert ? (videoTitles[box?.source_video_id ?? ''] ?? 'Video').replace(/^(Pixabay|Pexels): /, '').split(',')[0] : formatTag(seg)
    const color = isInsert ? MEDIA_COLORS.video : LAYOUT_COLORS[seg.layout]
    const url = isInsert ? videoUrls[box?.source_video_id ?? ''] : videoUrl
    const st = mainMuted && !isInsert ? { ...seg, muted: true } : seg
    const comingBack = g && g.edge === 'start' && g.to < g.from
    return (
      <div key={seg.id} className="tl2-block absolute" data-part={i + 1} data-selected={sel || undefined}
        title={`${isInsert ? 'Inserted video' : 'Part'} ${i + 1} · ${name} · ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)} · tap to select it${onMovePart && mains.length > 1 ? ', drag to move it' : ''}`}
        // (a part narrower than it is drawn lies over its neighbours: it can still be tapped)
        style={{
          ...blockBox(start, end), zIndex: sel ? 3 : (end - start) * pxPerMs < 12 ? 2 : 1,
          ...(onMovePart && mains.length > 1 && !seg.locked ? { cursor: 'grab' } : {}),
          // (carried along the row: it follows the pointer, over everything)
          ...(insertDrag?.id === seg.id ? { transform: `translate(${insertDrag.dx}px, ${insertDrag.dy}px)`, zIndex: 40, opacity: 0.85, cursor: 'grabbing', filter: 'drop-shadow(0 8px 14px rgba(0,0,0,0.6))' } : {}),
        }}>
        <div className="absolute inset-0 overflow-hidden" style={{ borderRadius: 8 }}>
          {url && (
            <VideoThumbnails tile videoUrl={url} radius={0} dim={false}
              startMs={isInsert ? (box?.source_offset_ms ?? 0) : (sourceAt ? sourceAt(seg.start_ms) : clipStartMs + seg.start_ms)}
              durationMs={Math.max(1, seg.end_ms - seg.start_ms)}
              sourceAt={!isInsert && sourceAt ? (c => sourceAt(seg.start_ms + c)) : undefined}
              sourceKey={`${sourceKey ?? ''}|${seg.start_ms}`} />
          )}
          {/* what comes back over the part before it, while a start is dragged out */}
          {comingBack && <div className="tl2-grow absolute inset-y-0 left-0" data-edge="start" style={{ width: `${(Math.max(0, g!.from - start) / Math.max(1, end - start)) * 100}%` }} />}
          <div className="absolute inset-0 pointer-events-none" style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.45), transparent 38%, transparent 62%, rgba(0,0,0,0.55))' }} />
        </div>
        {/* its format (an inserted video: just "Video" — its name shows for 3 s after it goes in, in
            InsertTag, and stays in the tooltip), its length, its state */}
        <span className="tl2-tag absolute left-1.5 top-1">
          <i style={{ background: color }} />{isInsert ? 'Video' : name}
        </span>
        <span className="tl2-len absolute right-1.5 bottom-1">{lenLabel(end - start)}</span>
        <span className="absolute right-1 top-1"><StateBadges st={st} /></span>
        {isInsert && <InsertTag id={`${box?.source_video_id}@${seg.video_offset_ms}`} name={name} />}
        {/* cuts inside the part (where a removed piece closed up) */}
        {cutJoins.filter(t => t > seg.start_ms + 50 && t < seg.end_ms - 50).map(t => (
          <span key={t} className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${((t - start) / Math.max(1, end - start)) * 100}%`, width: 3, marginLeft: -1.5, background: 'var(--ed-track)' }} />
        ))}
        {/* just made longer: what it gained, for a moment (then fades) */}
        {grown && grown.id === seg.id && !g && (() => {
          const gain = (seg.end_ms - seg.start_ms) - grown.before
          if (gain < 50) return null
          const w = (gain / Math.max(1, seg.end_ms - seg.start_ms)) * 100
          return <div key={grown.key} className="tl2-grow tl2-grown absolute inset-y-0 pointer-events-none" data-edge={grown.edge}
            style={{ width: `${w}%`, [grown.edge === 'start' ? 'left' : 'right']: 0, borderRadius: grown.edge === 'start' ? '8px 0 0 8px' : '0 8px 8px 0' }} />
        })()}
        {/* selected: a plain outline (the grips say it's selected) */}
        {sel && <div className="absolute inset-0 pointer-events-none" style={{ borderRadius: 8, boxShadow: `inset 0 0 0 2px ${ACCENT}` }} />}
        {sel && (['start', 'end'] as const).map(edge => grip(seg, i, edge))}
      </div>
    )
  }
  const grip = (seg: SegmentLocal, i: number, edge: 'start' | 'end') => {
    const t = edge === 'start' ? seg.start_ms : seg.end_ms
    const label = `${edge === 'start' ? 'Start' : 'End'} of part ${i + 1} (`
    return (
      <button key={edge} type="button" className="tl2-grip absolute" data-edge={edge} data-on={dragging === `${edge}-${seg.id}` || undefined}
        onPointerDown={e => handleEdgeDown(e, seg, edge)}
        onKeyDown={e => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
          e.preventDefault(); e.stopPropagation()
          if (seg.locked || !onEdgeTrim) return
          const step = (e.shiftKey ? 1000 : 100) * (e.key === 'ArrowLeft' ? -1 : 1)
          const to = edge === 'start' ? Math.min(seg.end_ms - MIN_PART_MS, t + step) : Math.max(seg.start_ms + MIN_PART_MS, t + step)
          if (Math.abs(to - t) < 50) return
          onEdgeTrim(seg.id, edge, Math.round(t), Math.round(to), true)
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const again = [...document.querySelectorAll<HTMLElement>('button[aria-label]')].find(b => b.getAttribute('aria-label')!.startsWith(label))
            if (again && document.activeElement !== again) again.focus()
          }))
        }}
        aria-label={`${label}${formatTag(seg)}) at ${msToLabel(t)}. Drag or use arrow keys to trim`}
        title={`Drag to trim the ${edge === 'start' ? 'start' : 'end'} of this part (arrow keys: 0.1 s)`}
        style={{ [edge === 'start' ? 'left' : 'right']: 0, width: GRIP_W }}>
        <svg width="7" height="12" viewBox="0 0 8 12" aria-hidden="true" style={{ transform: edge === 'start' ? 'none' : 'scaleX(-1)' }}>
          <path d="M6 1.5L1.8 6 6 10.5" stroke="#0a0a0a" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    )
  }

  // ── Bars on the rows: slim, in their kind's colour; selected: taller, with grips ──
  const bar = (key: string, kind: 'video' | 'broll' | 'photo' | 'text' | 'music', start: number, end: number, sel: boolean, on: boolean,
    st: { hidden?: boolean; muted?: boolean; locked?: boolean }, name: string, onBody: (e: React.PointerEvent) => void,
    onEdge: ((e: React.PointerEvent, edge: 'start' | 'end') => void) | null, title: string, inside?: React.ReactNode) => {
    const color = MEDIA_COLORS[kind]
    const lifted = lift?.id === key ? lift : null
    return (
      <div key={key} className="tl2-bar absolute" data-sel={sel || undefined} data-kind={kind} data-item-id={key} onPointerDown={onBody} title={title}
        style={{
          left: `${at(start)}%`, width: `max(10px, ${pct(end - start)}%)`,
          '--bar-c': color, cursor: st.locked ? 'pointer' : on ? 'grabbing' : 'grab', zIndex: sel ? 3 : 1,
          ...(st.hidden ? { opacity: 0.45 } : {}),
          // (carried: over the other rows, with a shadow under it)
          ...(lifted ? { transform: `translateY(${lifted.dy}px)`, zIndex: 40, cursor: 'grabbing', filter: 'drop-shadow(0 6px 10px rgba(0,0,0,0.55))' } : {}),
        } as React.CSSProperties}>
        {inside && <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ borderRadius: 'inherit', opacity: sel ? 0.55 : 0.35 }}>{inside}</div>}
        <span className="relative flex items-center gap-1 min-w-0 pointer-events-none" style={{ paddingLeft: sel ? GRIP_W - 4 : 2, paddingRight: 6 }}>
          <MediaIcon kind={kind} />
          <span className="truncate">{name}</span>
          {sel && <span className="tl2-bar-len">{lenLabel(end - start)}</span>}
          <StateBadges st={st} />
        </span>
        {sel && onEdge && !st.locked && (['start', 'end'] as const).map(edge => (
          <span key={edge} role="slider" aria-valuenow={edge === 'start' ? start : end} aria-label={`Trim the ${edge} of the ${kind === 'broll' ? 'B-roll' : kind}`}
            className="tl2-bar-grip absolute" data-edge={edge} onPointerDown={e => onEdge(e, edge)} />
        ))}
      </div>
    )
  }
  const trackRow = (family: 'visual' | 'audio', t: number, edge: 'top' | 'bottom' | null, children: React.ReactNode) => {
    const hover = trackHover?.family === family ? trackHover.target : null
    return (
      <div key={`${family}-${t}`} data-lane={`${family === 'visual' ? 'track' : 'audio'}-${t}`} data-track-row={family} data-track={t}
        className="relative" style={{ height: ROW_H, ...(hover === t ? { boxShadow: `inset 0 0 0 1.5px ${ACCENT}`, background: 'rgba(200,255,0,0.07)', borderRadius: 6 } : {}) }}
        onPointerDown={handleScrubDown}>
        {hover === 'new' && edge && (
          <div className="absolute left-0 right-0 pointer-events-none rounded-full" aria-hidden="true"
            style={{ [edge]: -ROW_GAP / 2 - 1.5, height: 3, background: ACCENT, boxShadow: '0 0 8px rgba(200,255,0,0.6)', zIndex: 20 }} />
        )}
        {children}
      </div>
    )
  }
  const visualBar = (v: Visual) => {
    if (v.kind === 'shot') {
      const seg = v.seg
      const kind = isStock?.(seg) ? 'broll' as const : 'video' as const
      const sel = isSel(seg.id, seg.id === activeSegmentId || seg.id === pickedSegmentId)
      const shown = brollGhost?.id === seg.id ? { start_ms: brollGhost.start, end_ms: brollGhost.end } : seg
      const box = seg.crop_boxes[0]
      const name = (videoTitles[box?.source_video_id ?? ''] ?? (kind === 'broll' ? 'B-roll' : 'Video')).replace(/^(Pixabay|Pexels): /, '').split(',')[0]
      const url = videoUrls[box?.source_video_id ?? '']
      return bar(seg.id, kind, shown.start_ms, shown.end_ms, sel, !!dragging?.endsWith(seg.id), { hidden: box?.hidden, muted: box?.muted !== false, locked: seg.locked }, `${name} · full screen`,
        e => handleBrollDown(e, seg, 'body'), (e, edge) => handleBrollDown(e, seg, edge),
        `Overlay (full screen) · ${name} · ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)} · click to select, drag to move`,
        url && <VideoThumbnails tile videoUrl={url} startMs={box?.source_offset_ms ?? 0} durationMs={seg.end_ms - seg.start_ms} radius={0} dim={false} />)
    }
    if (v.kind === 'photo') {
      const ph = v.ph
      const sel = isSel(ph.id, ph.id === activePhotoId)
      const full = !ph.video && ph.full
      return bar(ph.id, ph.video ? 'video' : 'photo', ph.start_ms, ph.end_ms, sel, dragging === `photo-${ph.id}`, ph.video ? { ...ph, muted: ph.video.muted } : ph,
        ph.video ? 'Video · window' : full ? 'Photo · full screen' : 'Photo · window', e => handlePhotoDrag(e, ph, 'body'), (e, edge) => handlePhotoDrag(e, ph, edge),
        `Overlay (${ph.video ? 'video' : 'photo'}, ${full ? 'full screen' : 'window'}) · ${msToLabel(ph.start_ms)}–${msToLabel(ph.end_ms)} · click to select, drag to move`,
        ph.video ? (ph.video.url && <VideoThumbnails tile videoUrl={ph.video.url} startMs={ph.video.offset} durationMs={ph.end_ms - ph.start_ms} radius={0} dim={false} />)
          : ph.url ? <div className="absolute inset-0" style={{ backgroundImage: `url("${ph.url}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }} /> : null)
    }
    const o = v.o
    const sel = isSel(o.id, o.id === activeTextOverlayId)
    return bar(o.id, 'text', o.start_ms, o.end_ms, sel, dragging === `text-${o.id}`, o, o.text?.trim() || 'Text',
      e => handleTextDrag(e, o, 'body'), (e, edge) => handleTextDrag(e, o, edge),
      `Text · “${o.text}” · ${msToLabel(o.start_ms)}–${msToLabel(o.end_ms)} · tap to select, drag to move`)
  }
  const musicBar = (m: (typeof musicTracks)[number]) => {
    const end = musicEnd(m)
    const sel = isSel(m.id, selectedMusicId === m.id)
    return bar(m.id, 'music', m.start_ms, end, sel, dragging === `music-${m.id}`, m, m.original ? 'Original sound' : m.name,
      e => handleMusicDrag(e, m), onMusicTrim ? (e, edge) => handleMusicTrim(e, m, edge) : null,
      `${m.original ? 'Original sound' : `Music · ${m.name}`} · ${msToLabel(m.start_ms)}–${msToLabel(end)} · tap to select, drag to move`,
      <Waveform url={m.url} srcKey={m.key} offsetMs={m.offset_ms ?? 0} durationMs={end - m.start_ms} />)
  }

  // ── Frame lanes (the frame under the playhead: its slots and items) ──
  const frameLanes = () => {
    const frames = mains.filter(s => isFrameLayout(s.layout))
    const active = frameSeg && isFrameLayout(frameSeg.layout) ? frameSeg : null
    const rows: ReturnType<typeof visibleLanes> = []
    for (const f of active ? [active, ...frames.filter(x => x.id !== active.id)] : frames) {
      for (const r of visibleLanes(f)) if (!rows.some(x => x.lane === r.lane)) rows.push(r)
    }
    if (!rows.length) return null
    const seg = active
    const frame = seg ? frameOf(seg) : null
    const main = frame?.main_slots ?? [0]
    const inSection = !!seg && currentTimeMs >= seg.start_ms && currentTimeMs < seg.end_ms
    const plusAt = seg ? (inSection ? currentTimeMs : seg.start_ms) : 0
    const itemName = (it: FrameItem) => it.kind === 'video' ? (videoTitles[it.source_video_id ?? ''] ?? 'Video') : it.kind === 'photo' ? 'Photo' : it.captions ? 'Captions' : (it.text?.trim() || 'Text')
    return (
      <div ref={lanesRef} className="relative flex flex-col" style={{ gap: 2, paddingTop: 4, paddingBottom: 2 }}>
        {rows.map(lane => {
          const laneKey = String(lane.lane)
          const row = seg ? visibleLanes(seg).find(r => r.lane === lane.lane) : undefined
          const isMain = !!row && !isTextLane(row.lane) && main.includes(row.lane)
          const mainId = `main:${lane.lane}`
          const pulsing = pulseLane === lane.lane
          return (
            <div key={laneKey} data-lane={`frame:${laneKey}`} className="group/lane relative" style={{ height: FRAME_LANE_H }}
              onPointerDown={e => { onSelectFrameItem?.(null); handleScrubDown(e) }}>
              {frames.filter(o => o.id !== seg?.id).map(o => {
                const r2 = visibleLanes(o).find(r => r.lane === lane.lane)
                if (!r2) return null
                const of = frameOf(o)
                return (
                  <Fragment key={o.id}>
                    <div className="absolute inset-y-0.5 pointer-events-none" style={{ left: `${at(o.start_ms)}%`, width: `${pct(o.end_ms - o.start_ms)}%`, borderRadius: 5, background: 'rgb(var(--ed-fg) / 0.045)' }} />
                    {laneItems(of, r2.lane, o).map(it => {
                      const from = Math.max(it.start_ms, o.start_ms), to = Math.min(it.end_ms, o.end_ms), color = frameItemColor(it)
                      return (
                        <button key={it.id} type="button" className="absolute inset-y-0.5 flex items-center overflow-hidden"
                          aria-label={`${itemName(it)}, ${r2.label}, ${msToLabel(from)}–${msToLabel(to)}: go there and pick it`}
                          onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onJumpToFrameItem?.(o.id, it.id) }}
                          style={{ left: `${at(from)}%`, width: `max(8px, ${pct(to - from)}%)`, borderRadius: 5, background: `${color}38`, boxShadow: `inset 0 0 0 1px ${color}88` }}>
                          <span className="px-2 truncate text-[10px] font-semibold pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.9)' }}>{itemName(it)}</span>
                        </button>
                      )
                    })}
                  </Fragment>
                )
              })}
              {seg && frame && row && (<>
                <div className="absolute inset-y-0.5 pointer-events-none" style={{
                  left: `${at(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`, borderRadius: 5,
                  background: pulsing ? 'rgba(200,255,0,0.12)' : 'rgb(var(--ed-fg) / 0.045)', boxShadow: pulsing ? `inset 0 0 0 1.5px ${ACCENT}` : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.06)',
                }}>
                  <span className="absolute top-1/2 -translate-y-1/2 text-[10px] font-semibold whitespace-nowrap" style={{ left: 8, color: 'rgb(var(--ed-fg) / 0.3)' }}>{row.label}</span>
                </div>
                {isMain && (() => {
                  const on = isSel(mainId, activeFrameItemId === mainId)
                  return (
                    <div className="absolute inset-y-0.5 flex items-center overflow-hidden"
                      onPointerDown={e => { e.stopPropagation(); onSelectFrameItem?.(mainId) }}
                      title="Main video · select it to change its sound or take it out of this slot"
                      style={{ left: `${at(seg.start_ms)}%`, width: `${pct(seg.end_ms - seg.start_ms)}%`, borderRadius: 5, background: `${FRAME_ITEM_COLORS.main}${on ? '40' : '24'}`, boxShadow: on ? SELECTED_RING : `inset 2px 0 0 ${FRAME_ITEM_COLORS.main}`, zIndex: on ? 3 : undefined }}>
                      <span className="px-2 truncate text-[10px] font-semibold pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>{row.label} · Main video</span>
                    </div>
                  )
                })()}
                {laneItems(frame, row.lane, seg).map(it => {
                  const from = Math.max(it.start_ms, seg.start_ms), to = Math.min(it.end_ms, seg.end_ms)
                  const on = isSel(it.id, it.id === activeFrameItemId)
                  const color = frameItemColor(it)
                  return (
                    <div key={it.id} className="absolute inset-y-0.5 flex items-center overflow-hidden"
                      onPointerDown={e => handleFrameItemDown(e, it, 'move')}
                      title={`${itemName(it)} · ${msToLabel(from)}–${msToLabel(to)} · drag to move, drag the ends to trim`}
                      style={{ left: `${at(from)}%`, width: `max(8px, ${pct(to - from)}%)`, borderRadius: 5, zIndex: on ? 3 : 2, background: `${color}${on ? '55' : '38'}`, boxShadow: on ? SELECTED_RING : `inset 0 0 0 1px ${color}88`, cursor: 'grab', touchAction: 'none' }}>
                      <div className="absolute left-0 inset-y-0 w-2 cursor-col-resize z-10" style={{ background: 'rgba(0,0,0,0.25)' }} onPointerDown={e => handleFrameItemDown(e, it, 'start')} />
                      {it.kind === 'photo' && it.image_url && <img src={it.image_url} alt="" crossOrigin="anonymous" className="h-full w-7 object-cover shrink-0 pointer-events-none" style={{ marginLeft: 8, opacity: 0.9 }} />}
                      <span className="px-2.5 truncate text-[10px] font-semibold pointer-events-none" style={{ color: 'rgb(var(--ed-fg) / 0.92)' }}>{it.kind === 'text' && !it.captions ? 'T · ' : ''}{itemName(it)}</span>
                      <span className="shrink-0 pr-2.5 pointer-events-none"><StateBadges st={it} /></span>
                      <div className="absolute right-0 inset-y-0 w-2 cursor-col-resize z-10" style={{ background: 'rgba(0,0,0,0.25)' }} onPointerDown={e => handleFrameItemDown(e, it, 'end')} />
                    </div>
                  )
                })}
                {(() => {
                  const taken = laneItems(frame, row.lane, seg).some(it => it.start_ms <= plusAt && plusAt < it.end_ms)
                  if (taken && !pulsing) return null
                  return (
                    <button ref={el => { if (el) plusRefs.current.set(laneKey, el); else plusRefs.current.delete(laneKey) }}
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); onAddFrameItem?.(row.lane, e.currentTarget.getBoundingClientRect()) }}
                      aria-label={`Add to the ${row.label.toLowerCase()} ${isTextLane(row.lane) ? 'area' : 'slot'} at ${msToLabel(plusAt)}`}
                      title={isTextLane(row.lane) ? 'Add text here' : 'Add a photo, video or text here'}
                      className="absolute top-1/2 flex items-center justify-center rounded-full hover:scale-110"
                      style={{ left: `${at(plusAt)}%`, transform: 'translate(-50%, -50%)', width: 18, height: 18, zIndex: 41, background: ACCENT, color: '#000', border: '1.5px solid rgba(0,0,0,0.7)' }}>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                  )
                })()}
              </>)}
            </div>
          )
        })}
      </div>
    )
  }

  const mainTop = RULER_H
  const mainRowH = BLOCK_H + MAIN_PAD * 2
  const headH = RULER_H + mainRowH + (originals.length ? ORIG_ROW_H : 0) + (viewMarkers.length ? VIEW_ROW_H : 0)

  return (
    <div className="tl2 flex items-stretch flex-auto min-h-0 select-none"
      // A click anywhere else in the timeline (under the rows, the margins, the left column) also
      // lets go of the selected part; what handles its own clicks (the rows, parts, bars, buttons,
      // grips, menus) is left to do so
      onPointerDown={e => {
        if (e.button !== 0) return
        const el = e.target as Element
        if (el.closest?.('[data-tl-head], .tl2-block, .tl2-bar, button, a, input, [role="menu"], [data-lane], [data-keep-selection]')) return
        onPickSegment?.(null)
      }}>
      {/* ── Left column: add, the main video's sound, what each row is ── */}
      <div className="tl2-left relative shrink-0" style={{ width: LEFT_W }} aria-label="Timeline rows">
        {onAddKind && (
          <>
            <button type="button" className="tl2-add" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); setAddMenu(addMenu ? null : r) }}
              aria-haspopup="menu" aria-expanded={!!addMenu} aria-label="Add media at the playhead" title="Add media at the playhead"
              style={{ top: 2 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
                <path d={addMenu ? 'M6 6l12 12M18 6L6 18' : 'M12 5v14M5 12h14'} />
              </svg>
            </button>
            {addMenu && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 90 }} onClick={() => setAddMenu(null)} aria-hidden="true" />
                {/* Four choices, as in CapCut / VN / InShot: into the main video, on top of it, sound, text */}
                <div role="menu" aria-label="Add at the playhead" className="tl2-menu fixed flex flex-col py-1.5"
                  style={{ zIndex: 91, left: Math.min(addMenu.left, window.innerWidth - 270), ...(addMenu.bottom + 240 <= window.innerHeight ? { top: addMenu.bottom + 6 } : { bottom: window.innerHeight - addMenu.top + 6 }) }}>
                  {ADD_CHOICES.map(c => (
                    <button key={c.kind} type="button" role="menuitem" onClick={() => { setAddMenu(null); onAddKind(c.kind) }}>
                      <span className="tl2-menu-ico" style={{ color: c.color }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{c.icon}</svg>
                      </span>
                      <span className="flex flex-col min-w-0">
                        <span>{c.label}</span>
                        <span className="tl2-menu-hint">{c.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
        {cutMenu && (() => {
          const tr = transitionAfter.get(cutMenu.afterId)
          const close = () => setCutMenu(null)
          return (
            <>
              <div className="fixed inset-0" style={{ zIndex: 90 }} onClick={close} onContextMenu={e => { e.preventDefault(); close() }} aria-hidden="true" />
              <div role="menu" aria-label={`Transition at ${msToLabel(cutMenu.at)}`} className="tl2-menu fixed flex flex-col py-1.5"
                onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close() } }}
                ref={el => { if (el && !el.dataset.focused) { el.dataset.focused = '1'; el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }) } }}
                style={{ zIndex: 91, left: Math.min(cutMenu.x, window.innerWidth - 230), top: Math.min(cutMenu.y + 4, window.innerHeight - 150), minWidth: 210 }}>
                <span className="tl2-menu-hint px-3 pb-1">{tr ? `${transitionName(tr.type)} at ${msToLabel(cutMenu.at)}` : ''}</span>
                <button type="button" role="menuitem" onClick={() => { close(); onOpenTransition?.(cutMenu.afterId, cutMenu.at) }}>Change…</button>
                {onApplyTransitionToAll && junctions.length > 1 && (
                  <button type="button" role="menuitem" onClick={() => { close(); onApplyTransitionToAll(cutMenu.afterId) }}>Apply to all cuts</button>
                )}
                {onRemoveTransition && (
                  <button type="button" role="menuitem" onClick={() => { close(); onRemoveTransition(cutMenu.afterId) }}>Remove</button>
                )}
              </div>
            </>
          )
        })()}
        {/* "Mute clip audio" (as in CapCut), level with the main row */}
        {onToggleMainMute && (
          <button type="button" className="tl2-mute" data-on={mainMuted || undefined} onClick={onToggleMainMute}
            aria-pressed={mainMuted} aria-label={mainMuted ? 'Turn the clip’s audio back on' : 'Mute clip audio'} title={mainMuted ? 'Clip audio is off — click to turn it on' : 'Mute clip audio'}
            style={{ top: mainTop + MAIN_PAD + BLOCK_H / 2 - 20 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              {mainMuted ? <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></> : <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /></>}
            </svg>
            <span>{mainMuted ? 'Off' : 'Audio'}</span>
          </button>
        )}
        {laneSpans.map(sp => {
          const meta = metaOf(sp.kind)
          if (!meta) return null
          return (
            <span key={sp.kind} className="tl2-row-ico" title={meta.label}
              style={{ top: sp.top + sp.h / 2 - 9, color: meta.color }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{meta.icon}</svg>
            </span>
          )
        })}
      </div>

      {/* ── The timeline: the layer slides under the playhead in the middle ── */}
      <div className="tl2-frame relative flex-1 min-w-0">
      <div ref={viewRef} className="tl2-view" onScroll={measureLanes}
        onDragOver={onDragOver} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { setDropAt(null); setDropCut(null) } }} onDrop={onDrop}>
        <div ref={contentRef} className="relative" style={{ width: contentW, willChange: 'transform' }}>
          {dropAt && (
            <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${at(dropAt.ms)}%`, zIndex: 60 }}>
              <div className="absolute top-0 bottom-0" style={{ left: -1, width: 2, background: ACCENT }} />
              <span className="absolute whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ top: 2, left: 4, background: ACCENT, color: '#000' }}>{dropAt.what} at {msToLabel(dropAt.ms)}</span>
            </div>
          )}
          {/* Ruler and main row stay at the top; the rows under them scroll */}
          <div ref={trackRef} data-tl-head className="tl2-head" style={{ height: headH }} onPointerDown={handleScrubDown}>
            <div className="relative" style={{ height: RULER_H }}>
              {ticks.map(({ t, major }) => (
                <div key={t} className={major ? 'tl2-tick tl2-tick-major' : 'tl2-tick'} style={{ left: `${pct(t)}%` }}>
                  {major && <span>{tickLabel(t)}</span>}
                </div>
              ))}
            </div>
            {/* Main row: one block per part; a transition button between touching parts */}
            <div data-lane="main" className="relative" style={{ height: mainRowH }}>
              {gaps.map(g => (
                <div key={`gap-${g.start_ms}`} className="tl2-gap absolute" style={blockBox(g.start_ms, g.end_ms)}
                  title={`${msToLabel(g.start_ms)}–${msToLabel(g.end_ms)} · no format: default framing`}>
                  <span>Default framing</span>
                </div>
              ))}
              {mains.map((seg, i) => mainBlock(seg, i))}
              {/* a video in the main row being carried: where it will go in */}
              {insertDrag && (() => {
                const seg = mains.find(m => m.id === insertDrag.id)
                if (!seg) return null
                const stays = insertDrag.to > seg.start_ms && insertDrag.to < seg.end_ms
                const lands = insertDrag.to >= seg.end_ms ? insertDrag.to - (seg.end_ms - seg.start_ms) : insertDrag.to
                return (
                  <div className="absolute pointer-events-none" style={{ left: `${at(insertDrag.to)}%`, top: 0, bottom: 0, zIndex: 35 }}>
                    {!stays && <div className="absolute top-0 bottom-0 rounded-full" style={{ left: -1.5, width: 3, background: ACCENT, boxShadow: '0 0 8px rgba(200,255,0,0.6)' }} />}
                    <span className="absolute whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ top: -2, left: 6, background: ACCENT, color: '#000' }}>
                      {stays ? 'Let go: it stays here' : `Move here · starts at ${clockLabel(lands)}`}
                    </span>
                  </div>
                )
              })()}
              {!dragging && junctions.map(({ left, right }) => {
                // A marker on every cut, as in CapCut: lime with its kind's picture when it has a
                // transition, a grey "+" when not. Beside the selected part it moves off the cut, onto
                // the other part, so the selected part's grip stays free to drag
                const selPart = selectedId !== undefined ? selectedId : (pickedSegmentId ?? activeSegmentId)
                const room = Math.min(left.end_ms - left.start_ms, right.end_ms - right.start_ms)
                const tr = transitionAfter.get(left.id)
                const on = !!tr && tr.type !== 'cut'
                // (a part too narrow on screen to hold it: a cut with a transition keeps a small dot, one
                // without none. The dot sits just under the row, so the narrow part stays free to tap)
                const small = room * pxPerMs < 30
                if (small && !on) return null
                const set = on ? (tr!.duration_ms || TRANSITION_DEFAULT_MS) : 0
                const played = on ? playedTransitionMs(set, room) : 0
                const name = on ? transitionName(tr!.type) : ''
                const half = small ? 3.5 : 10
                const shift = small || !selPart ? -half : left.id === selPart ? 1.5 : right.id === selPart ? -half * 2 - 1.5 : -half
                const what = on ? (played ? `${name} · ${transitionSecs(played)}${played < set ? ' (a part beside it is short)' : ''}` : `${name} · a part beside it is too short: plays as a plain cut`) : ''
                return (
                  <button key={`tr-${left.id}`} type="button" className="tl2-trans absolute" data-on={on || undefined} data-small={small || undefined}
                    data-off={(on && !played) || undefined} data-drop={dropCut === left.id || undefined} data-kind={on ? tr!.type : undefined}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); onOpenTransition?.(left.id, left.end_ms) }}
                    onContextMenu={e => {
                      e.preventDefault(); e.stopPropagation()
                      if (!on) { onOpenTransition?.(left.id, left.end_ms); return }
                      setCutMenu({ afterId: left.id, at: left.end_ms, x: e.clientX, y: e.clientY })
                    }}
                    onKeyDown={e => {
                      // (Delete on a marker takes its transition away, never the part that is selected)
                      if (e.key !== 'Delete' && e.key !== 'Backspace') return
                      e.preventDefault(); e.stopPropagation()
                      if (on) onRemoveTransition?.(left.id)
                    }}
                    aria-label={on ? `Transition at ${msToLabel(left.end_ms)}: ${what}. Change it` : `Add a transition at ${msToLabel(left.end_ms)}`}
                    title={on ? `${what} — click to change it, right-click for more` : 'Add a transition between these parts'}
                    style={{ left: `${at(left.end_ms)}%`, top: small ? MAIN_PAD + BLOCK_H + 3 : MAIN_PAD + BLOCK_H / 2, marginLeft: shift }}>
                    {!small && <TransitionGlyph type={on ? tr!.type : 'cut'} size={on ? 12 : 10} />}
                  </button>
                )
              })}
              {/* a transition tile dragged over the timeline: the cut it will land on */}
              {dropCut && (() => {
                const j = junctions.find(x => x.left.id === dropCut)
                if (!j) return null
                return (
                  <div className="absolute pointer-events-none" style={{ left: `${at(j.left.end_ms)}%`, top: 0, bottom: 0, zIndex: 7 }}>
                    <div className="absolute top-0 bottom-0" style={{ left: -1, width: 2, background: ACCENT }} />
                    <span className="absolute whitespace-nowrap text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ top: -2, left: 6, background: ACCENT, color: '#000' }}>Transition at {msToLabel(j.left.end_ms)}</span>
                  </div>
                )
              })()}
              {/* while a grip is dragged: the part's new length, over the grip */}
              {edgeGhost && (() => {
                const seg = mains.find(m => m.id === edgeGhost.id)
                if (!seg) return null
                const len = edgeGhost.edge === 'start' ? seg.end_ms - edgeGhost.to : seg.end_ms - seg.start_ms
                const viewLeftMs = freezeRef.current != null ? (2 - freezeRef.current) / pxPerMs : -Infinity
                const x = edgeGhost.edge === 'start' ? Math.max(edgeGhost.to, viewLeftMs + 40 / Math.max(1e-6, pxPerMs)) : seg.end_ms
                const gain = edgeGhost.edge === 'start' ? seg.start_ms - edgeGhost.to : 0
                return <span className="tl2-trim-tip absolute" style={{ left: `${at(x)}%` }}>{lenLabel(len)}{gain >= 100 ? ` · +${lenLabel(gain)}` : ''}</span>
              })()}
            </div>
            {originals.length > 0 && (
              <div data-lane="original" className="relative" style={{ height: ORIG_ROW_H }}>
                {originals.map(musicBar)}
              </div>
            )}
            {viewMarkers.length > 0 && (
              <div data-lane="views" className="relative" style={{ height: VIEW_ROW_H }}>
                <div className="absolute left-0 right-0 top-1/2 pointer-events-none" style={{ height: 1, background: 'rgb(var(--ed-fg) / 0.08)' }} />
                {viewDragT !== null && (() => {
                  const cache = videoUrl ? thumbsFor(videoUrl) : undefined
                  const src = cache ? nearestThumb(cache, sourceAt ? sourceAt(viewDragT) : clipStartMs + viewDragT, Math.max(1500, duration / 40)) : undefined
                  return (
                    <div className="absolute pointer-events-none flex flex-col items-center gap-1" style={{ left: `${at(viewDragT)}%`, bottom: 'calc(100% + 6px)', transform: 'translateX(-50%)', zIndex: 60 }}>
                      {src && <img src={src} alt="" draggable={false} style={{ width: 80, height: 56, objectFit: 'cover', borderRadius: 8, boxShadow: `0 0 0 2px ${ACCENT}` }} />}
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
                      <button type="button" onPointerDown={e => handleViewDown(e, v.t_ms, first)}
                        onKeyDown={e => {
                          if ((e.key === 'Delete' || e.key === 'Backspace') && !first) { e.preventDefault(); e.stopPropagation(); onRemoveView?.(v.t_ms) }
                          if ((e.ctrlKey || e.metaKey) && (e.key === 'd' || e.key === 'D')) { e.preventDefault(); e.stopPropagation(); onDuplicateView?.(v.t_ms) }
                        }}
                        aria-label={`${first ? 'First view' : v.cut ? 'View change' : 'Motion point'} at ${msToLabel(v.t_ms)}${first ? '' : '. Drag to move, Delete to remove'}`}
                        title={`${first ? 'First view' : v.cut ? 'View change (cut)' : 'Motion point (glide)'} · ${msToLabel(v.t_ms)}`}
                        className="absolute top-1/2"
                        style={{
                          left: `${at(v.t_ms)}%`, width: size, height: size, transform: 'translate(-50%, -50%) rotate(45deg)',
                          borderRadius: v.cut || first ? 3 : 999, background: on ? ACCENT : v.cut || first ? 'rgb(var(--ed-fg) / 0.9)' : 'rgb(var(--ed-fg) / 0.5)',
                          border: '1.5px solid rgba(0,0,0,0.7)', cursor: first ? 'pointer' : 'ew-resize', touchAction: 'none', zIndex: on ? 36 : 35,
                        }} />
                      {on && onDuplicateView && (
                        <button type="button" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onDuplicateView(v.t_ms) }}
                          aria-label={`Duplicate the view at ${msToLabel(v.t_ms)}`} title="Duplicate this view (Ctrl+D)"
                          className="absolute top-1/2 flex items-center justify-center rounded-full"
                          style={{ left: `calc(${at(v.t_ms)}% + 10px)`, transform: 'translateY(-50%)', width: 16, height: 16, zIndex: 37, background: ACCENT, color: '#111' }}>
                          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
                        </button>
                      )}
                      {on && !first && onRemoveView && (
                        <button type="button" onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onRemoveView(v.t_ms) }}
                          aria-label={`Remove the view change at ${msToLabel(v.t_ms)}`} title="Remove this view change (Delete)"
                          className="absolute top-1/2 flex items-center justify-center rounded-full"
                          style={{ left: `calc(${at(v.t_ms)}% + ${onDuplicateView ? 30 : 10}px)`, transform: 'translateY(-50%)', width: 16, height: 16, zIndex: 37, background: '#ef4444', color: '#fff', fontSize: 10, lineHeight: 1 }}>✕</button>
                      )}
                    </Fragment>
                  )
                })}
              </div>
            )}
            {snapLine !== null && <div className="absolute pointer-events-none" style={{ left: `${at(snapLine)}%`, top: RULER_H, bottom: 0, width: 0, borderLeft: `1.5px dashed ${ACCENT}`, zIndex: 20 }} />}
            {/* a bar being dragged: where it will play */}
            {lift && <span className="tl2-trim-tip absolute" style={{ left: `clamp(60px, ${at(lift.start)}%, calc(100% - 60px))` }}>{clockLabel(lift.start)} – {clockLabel(lift.end)}</span>}
          </div>

          {frameLanes()}

          {(visual.length > 0 || songs.length > 0) && (
            <div className="relative flex flex-col" style={{ gap: ROW_GAP, paddingTop: 6, paddingBottom: 8 }}>
              {visualTracks.map((t, i) => trackRow('visual', t, i === 0 ? 'top' : null, visual.filter(v => v.track === t).map(visualBar)))}
              {songTracks.map((t, i) => trackRow('audio', t, i === songTracks.length - 1 ? 'bottom' : null, songs.filter(m => (m.track ?? 0) === t).map(musicBar)))}
            </div>
          )}
        </div>

      </div>
        {/* The playhead: in the middle of the view (while a grip is dragged: at the edge being cut) */}
        <div ref={lineRef} className="tl2-playhead" data-snap={snapFlash % 2 ? 'a' : 'b'} aria-hidden="true">
          <span ref={bubbleRef} className="tl2-bubble">{clockLabel(currentTimeMs)}</span>
        </div>
      </div>
    </div>
  )
}
