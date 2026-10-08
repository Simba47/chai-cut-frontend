import type { AudioTrack, BoxKeyframe, CropBoxLocal, FrameItem, Overlay, SegmentLocal, TextOverlay, Transition } from '@chai-cut/shared'
import { getBoxPositionAtLerp, type BoxPosition } from '@/lib/interpolation'
import type { TrimMap } from '@/lib/trims'
import type { KeyframeMap } from './store'

// ── Removing a part of the video ("delete this part") ─────────────────────────
// The editor works in TIMELINE time: the clip as it plays, removed parts closed up. What is saved
// keeps SOURCE clip time (as if nothing were removed) plus the list of removed parts (lib/trims.ts),
// so everything that reads a saved clip — the export, the clip board, an older editor — still
// finds it in the times it expects.
//   • loading:  toTimelineState  (source clip time → timeline)
//   • saving:   toSourceState    (timeline → source clip time)
//   • deleting: rippleDelete     (close the gap: what's inside goes, what's after moves up)

/** Everything in a clip that sits at a time */
export interface TimedState {
  segments: SegmentLocal[]
  keyframes: KeyframeMap
  overlays: Overlay[]
  textOverlays: TextOverlay[]
  audioTracks: AudioTrack[]
  transitions: Transition[]
}

const MAIN_AUDIO_PREFIX = 'main-video:'
/** The main video's own sound as a bar on the Music lane (detached audio): it plays the source file from offset_ms */
export const isMainAudioTrack = (t: { storage_path: string }) => t.storage_path.startsWith(MAIN_AUDIO_PREFIX)

/** A crop box showing the clip's main video at the playhead (not a photo, not another video) */
const isMainBox = (b: CropBoxLocal) => !b.source_video_id && !b.image_path

type KF = BoxKeyframe
const samePos = (p: BoxPosition, q: BoxPosition) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) + Math.abs(p.w - q.w) + Math.abs(p.h - q.h) <= 0.002
const byTime = (a: { t_ms: number }, b: { t_ms: number }) => a.t_ms - b.t_ms
/** One keyframe per moment (the later one wins), in order */
function tidy(kfs: KF[]): KF[] {
  const out: KF[] = []
  for (const k of [...kfs].sort(byTime)) {
    if (out.length && Math.abs(out[out.length - 1].t_ms - k.t_ms) < 0.5) out[out.length - 1] = k
    else out.push(k)
  }
  return out
}

/**
 * Every time moved by `start` (where things begin, and moments like keyframes) and `end` (where
 * things stop). Nothing else changes: this is a change of clock, not an edit.
 */
function mapTimes(state: TimedState, start: (t: number) => number, end: (t: number) => number): TimedState {
  const keyframes: KeyframeMap = {}
  for (const [boxId, kfs] of Object.entries(state.keyframes)) keyframes[boxId] = tidy(kfs.map(k => ({ ...k, t_ms: start(k.t_ms) })))
  const segments = state.segments.map(seg => {
    const s = start(seg.start_ms), e = end(seg.end_ms)
    return {
      ...seg,
      start_ms: s, end_ms: e,
      frame: seg.frame?.items
        ? { ...seg.frame, items: seg.frame.items.map(it => ({ ...it, start_ms: start(it.start_ms), end_ms: end(it.end_ms) })) }
        : seg.frame,
      crop_boxes: seg.crop_boxes.map(b => ({
        ...b,
        // A main-video box says where in the clip its section starts: it moves with the section
        source_offset_ms: isMainBox(b) ? Math.max(0, (b.source_offset_ms ?? 0) + (s - seg.start_ms)) : b.source_offset_ms,
        keyframes: (keyframes[b.id] ?? tidy((b.keyframes ?? []).map(k => ({ ...k, t_ms: start(k.t_ms) })) as KF[]))
          .map(({ t_ms, x, y, w, h }) => ({ t_ms, x, y, w, h })),
      })),
    }
  })
  return {
    segments, keyframes,
    overlays: state.overlays.map(o => ({ ...o, start_ms: start(o.start_ms), end_ms: end(o.end_ms) })),
    textOverlays: state.textOverlays.map(o => ({ ...o, start_ms: start(o.start_ms), end_ms: end(o.end_ms) })),
    audioTracks: state.audioTracks.map(t => ({ ...t, start_ms: start(t.start_ms), ...(t.end_ms != null ? { end_ms: end(t.end_ms) } : {}) })),
    transitions: state.transitions,
  }
}

/** Things with no time left are gone (and what hangs on them: a section's keyframes and transition) */
function dropEmpty(state: TimedState): TimedState {
  const segments = state.segments.filter(s => s.end_ms > s.start_ms).map(s => s.frame?.items
    ? { ...s, frame: { ...s.frame, items: s.frame.items.filter(it => it.end_ms > it.start_ms) } }
    : s)
  const live = new Set(segments.map(s => s.id))
  const boxes = new Set(segments.flatMap(s => s.crop_boxes.map(b => b.id)))
  return {
    segments,
    keyframes: Object.fromEntries(Object.entries(state.keyframes).filter(([boxId]) => boxes.has(boxId))),
    overlays: state.overlays.filter(o => o.end_ms > o.start_ms),
    textOverlays: state.textOverlays.filter(o => o.end_ms > o.start_ms),
    audioTracks: state.audioTracks.filter(t => t.end_ms == null || t.end_ms > t.start_ms),
    transitions: state.transitions.filter(t => live.has(t.after_segment_id)),
  }
}

/** A saved clip (source clip time) as the editor shows it (timeline time) */
export function toTimelineState(state: TimedState, map: TrimMap, clipStartMs: number): TimedState {
  const f = (t: number) => map.toTimeline(clipStartMs + t)
  return dropEmpty(mapTimes(state, f, f))
}

/** The editor's state (timeline time) as it is saved (source clip time) */
export function toSourceState(state: TimedState, map: TrimMap, clipStartMs: number): TimedState {
  return mapTimes(state, t => map.toSource(t) - clipStartMs, t => map.toSourceEnd(t) - clipStartMs)
}

/**
 * Timeline [a, b) taken out and the gap closed: what lies wholly inside it is removed, what
 * reaches into it loses that part, what comes after moves up by its length.
 *  • a section's view (crop keyframes) keeps what it showed on each side of the join;
 *  • a video that started inside (B-roll, a video on top, a frame video) starts from where it had got to;
 *  • music keeps playing through the join (it only gets shorter); a song that started inside
 *    starts from where it had got to;
 *  • the main video's own sound, when detached, is cut like the picture: it splits at the join.
 * `newId` makes the id of the second half of a split bar.
 */
export function rippleDelete(state: TimedState, a: number, b: number, newId: () => string = () => crypto.randomUUID()): TimedState {
  if (!(b > a)) return state
  const d = b - a
  const f = (t: number) => (t <= a ? t : t >= b ? t - d : a)
  /** How much of something starting at `s` was skipped by the cut (it started inside the removed part) */
  const skipped = (s: number) => (s >= a && s < b ? b - s : 0)

  // Crop keyframes: before the join as they were, after it moved up, with the view on each side
  // of the join pinned to what it was at a and at b (the picture itself jumps there)
  const keyframes: KeyframeMap = {}
  const segOf = new Map<string, SegmentLocal>()
  for (const seg of state.segments) for (const box of seg.crop_boxes) segOf.set(box.id, seg)
  for (const [boxId, kfs] of Object.entries(state.keyframes)) {
    const seg = segOf.get(boxId)
    if (!seg || kfs.length === 0) { keyframes[boxId] = kfs; continue }
    const before = seg.start_ms < a, after = seg.end_ms > b
    if (!before && !after) continue // the whole section goes
    const sorted = [...kfs].sort(byTime)
    let out: KF[] = [
      ...sorted.filter(k => k.t_ms < a),
      ...sorted.filter(k => k.t_ms >= b).map(k => ({ ...k, t_ms: k.t_ms - d })),
    ]
    const make = (t_ms: number, p: BoxPosition): KF => ({ id: newId(), box_id: boxId, t_ms, x: p.x, y: p.y, w: p.w, h: p.h })
    const wantAfter = getBoxPositionAtLerp(b, sorted)
    const needCut = () => after && (out.length === 0 || !samePos(getBoxPositionAtLerp(a, out), wantAfter))
    if (needCut()) out = [...out, make(a, wantAfter)].sort(byTime)
    if (before && a - 1 > seg.start_ms) {
      const wantBefore = getBoxPositionAtLerp(a - 1, sorted)
      if (!samePos(getBoxPositionAtLerp(a - 1, out), wantBefore)) {
        out = [...out, make(a - 1, wantBefore)].sort(byTime)
        if (needCut()) out = [...out, make(a, wantAfter)].sort(byTime)
      }
    }
    keyframes[boxId] = tidy(out)
  }

  const segments = state.segments.map(seg => {
    const s = f(seg.start_ms), e = f(seg.end_ms)
    const cutIn = skipped(seg.start_ms)
    const items = seg.frame?.items?.map((it): FrameItem => ({
      ...it, start_ms: f(it.start_ms), end_ms: f(it.end_ms),
      ...(it.kind === 'video' && skipped(it.start_ms) ? { source_offset_ms: (it.source_offset_ms ?? 0) + skipped(it.start_ms) } : {}),
    }))
    return {
      ...seg,
      start_ms: s, end_ms: e,
      frame: seg.frame && items ? { ...seg.frame, items } : seg.frame,
      crop_boxes: seg.crop_boxes.map(box => ({
        ...box,
        source_offset_ms: isMainBox(box)
          ? Math.max(0, (box.source_offset_ms ?? 0) + (s - seg.start_ms))
          : box.source_video_id ? (box.source_offset_ms ?? 0) + cutIn : box.source_offset_ms,
        keyframes: (keyframes[box.id] ?? []).map(({ t_ms, x, y, w, h }) => ({ t_ms, x, y, w, h })),
      })),
    }
  })

  const audioTracks = state.audioTracks.flatMap((t): AudioTrack[] => {
    const s = t.start_ms, e = t.end_ms ?? Infinity
    if (s >= a && e <= b) return []                    // wholly inside
    const endOf = (v: number) => (v === Infinity ? {} : { end_ms: v })
    if (isMainAudioTrack(t) && s < a && e > b) {
      // The picture jumps from a to b: so does its sound. Two bars, each fading only at its outer end.
      return [
        { ...t, ...endOf(a), fade_out: false },
        { ...t, id: newId(), start_ms: a, ...endOf(e - d), ...(t.offset_ms != null ? { offset_ms: t.offset_ms + (b - s) } : {}), fade_in: false },
      ]
    }
    const cutIn = skipped(s)
    return [{
      ...t, start_ms: f(s), ...endOf(e === Infinity ? Infinity : f(e)),
      ...(cutIn && (t.offset_ms != null || !isMainAudioTrack(t)) ? { offset_ms: (t.offset_ms ?? 0) + cutIn } : {}),
    }]
  })

  return dropEmpty({
    segments, keyframes,
    overlays: state.overlays.map(o => ({
      ...o, start_ms: f(o.start_ms), end_ms: f(o.end_ms),
      ...(o.type === 'video' && skipped(o.start_ms) ? { source_offset_ms: (o.source_offset_ms ?? 0) + skipped(o.start_ms) } : {}),
    })),
    textOverlays: state.textOverlays.map(o => ({ ...o, start_ms: f(o.start_ms), end_ms: f(o.end_ms) })),
    audioTracks,
    transitions: state.transitions,
  })
}

/**
 * Locked things the removal would cut into or remove (they must be unlocked first), by what they
 * are. Locked things after it only move up with the video they sit on: that is allowed.
 */
export function lockedInRange(state: TimedState, a: number, b: number): string[] {
  const hit = (x: { start_ms: number; end_ms?: number | null; locked?: boolean }) => !!x.locked && x.start_ms < b && (x.end_ms ?? Infinity) > a
  const out: string[] = []
  if (state.segments.some(hit)) out.push('a section')
  if (state.overlays.some(hit)) out.push('a photo or video')
  if (state.textOverlays.some(hit)) out.push('a text')
  if (state.audioTracks.some(hit)) out.push('a sound')
  return out
}

// ── Moving the clip's own start and end (bug #8) ──────────────────────────────
// Shortening either end is rippleDelete of that end. Lengthening adds new video:

/**
 * `d` ms of video added before the clip's start: everything moves `d` later, and what started at
 * the very start (the first section, the video's own sound) starts at the new start instead, so
 * the new part looks and sounds like the start did.
 */
export function insertAtStart(state: TimedState, d: number, isLayer: (seg: SegmentLocal) => boolean = () => false): TimedState {
  if (!(d > 0)) return state
  // (a video on top — `isLayer` — doesn't grow over the new part: it moves later with the rest)
  const atStart = new Set(state.segments.filter(s => s.start_ms <= 0 && !isLayer(s)).map(s => s.id))
  const keyframes: KeyframeMap = {}
  const segOf = new Map<string, SegmentLocal>()
  for (const seg of state.segments) for (const box of seg.crop_boxes) segOf.set(box.id, seg)
  for (const [boxId, kfs] of Object.entries(state.keyframes)) {
    const first = segOf.get(boxId) && atStart.has(segOf.get(boxId)!.id)
    const sorted = [...kfs].sort(byTime).map(k => ({ ...k, t_ms: k.t_ms + d }))
    // The first view of a section that starts with the clip holds from the new start
    if (first && sorted.length && sorted[0].t_ms <= d) sorted[0] = { ...sorted[0], t_ms: 0 }
    keyframes[boxId] = tidy(sorted)
  }
  const segments = state.segments.map(seg => {
    const grow = atStart.has(seg.id)
    const s = grow ? 0 : seg.start_ms + d
    return {
      ...seg,
      start_ms: s, end_ms: seg.end_ms + d,
      frame: seg.frame?.items ? { ...seg.frame, items: seg.frame.items.map(it => ({ ...it, start_ms: it.start_ms + d, end_ms: it.end_ms + d })) } : seg.frame,
      crop_boxes: seg.crop_boxes.map(box => ({
        ...box,
        // A main-video box points at its section's start in the clip; an added video starts d later
        // in its section when the section grew, so it shows the same frames at the same moments
        source_offset_ms: isMainBox(box) ? s : box.source_video_id && grow ? Math.max(0, (box.source_offset_ms ?? 0) - d) : box.source_offset_ms,
        keyframes: (keyframes[box.id] ?? []).map(({ t_ms, x, y, w, h }) => ({ t_ms, x, y, w, h })),
      })),
    }
  })
  const audioTracks = state.audioTracks.map((t): AudioTrack => {
    // The video's own sound from the clip's start reaches back over the new part too
    if (isMainAudioTrack(t) && t.start_ms <= 0 && t.offset_ms != null && t.offset_ms >= d) {
      return { ...t, start_ms: 0, offset_ms: t.offset_ms - d, ...(t.end_ms != null ? { end_ms: t.end_ms + d } : {}) }
    }
    return { ...t, start_ms: t.start_ms + d, ...(t.end_ms != null ? { end_ms: t.end_ms + d } : {}) }
  })
  return {
    segments, keyframes, audioTracks,
    overlays: state.overlays.map(o => ({ ...o, start_ms: o.start_ms + d, end_ms: o.end_ms + d })),
    textOverlays: state.textOverlays.map(o => ({ ...o, start_ms: o.start_ms + d, end_ms: o.end_ms + d })),
    transitions: state.transitions,
  }
}

/**
 * Video added after the clip's end (it was `oldLen` long, now `newLen`): what ran to the end — the
 * last section, the video's own sound — carries on to the new end. Nothing else moves.
 */
export function extendEnd(state: TimedState, oldLen: number, newLen: number, isLayer: (seg: SegmentLocal) => boolean = () => false): TimedState {
  if (!(newLen > oldLen)) return state
  const reachesEnd = (end: number | null | undefined) => end != null && end >= oldLen - 1
  return {
    ...state,
    // (a video on top — `isLayer` — keeps its length)
    segments: state.segments.map(seg => (reachesEnd(seg.end_ms) && !isLayer(seg) ? { ...seg, end_ms: newLen } : seg)),
    audioTracks: state.audioTracks.map(t => (isMainAudioTrack(t) && reachesEnd(t.end_ms) ? { ...t, end_ms: newLen } : t)),
  }
}
