import type { SegmentLocal } from '@chai-cut/shared'
import type { KeyframeMap } from './store'
import { asMainPart, isShot } from './shots'
import { isInsert, mainFrom, piecesOf } from './inserts'
import { isGapPart, isMainShot } from './visibility'
import { isFrameLayout } from './frames'

type Main = string | null | undefined
type Placed = { segments: SegmentLocal[]; keyframes: KeyframeMap }

/** The room after the main video (the editor's tail): a hidden video put in at the end */
const isTailOf = (s: SegmentLocal, mainVideoId: Main) => isInsert(s, mainVideoId) && !!s.hidden && !!s.crop_boxes[0]?.hidden
const mainBox = (b: { source_video_id?: string | null; image_path?: string | null }) => !b.source_video_id && !b.image_path

/**
 * Every part of the main video saying which moment of it it starts at, as it plays now (in a clip
 * that isn't pieces yet a part plays the moment at its own time): so moved parts keep playing their
 * own stretch of the video.
 */
function pinned(segments: SegmentLocal[], mainVideoId: Main, piecesOn: boolean): SegmentLocal[] {
  return segments.map(x => {
    if (isShot(x, mainVideoId) || isInsert(x, mainVideoId)) return x
    const was = mainFrom(x)
    const off = (piecesOn ? was ?? x.start_ms : x.start_ms) - (was ?? 0)
    return off ? { ...x, crop_boxes: x.crop_boxes.map(box => (mainBox(box) ? { ...box, source_offset_ms: Math.max(0, (box.source_offset_ms ?? 0) + off) } : box)) } : x
  })
}

/** Makes empty stretches of the main row, shaped like the part each stands in for (its box and keyframe new, in `kfs`) */
function gapMaker(kfs: KeyframeMap, newId: () => string) {
  return (like: SegmentLocal, from: number, to: number): SegmentLocal => {
    const boxId = newId()
    kfs[boxId] = [{ id: newId(), box_id: boxId, t_ms: from, x: 0, y: 0, w: 1, h: 1 }]
    return {
      ...like, id: newId(), start_ms: from, end_ms: to, hidden: true, muted: true, locked: false, frame: undefined,
      crop_boxes: like.crop_boxes.slice(0, 1).map(b => ({ ...b, id: boxId, hidden: true })),
    }
  }
}

/** The main row and what's on the rows, in time order, numbered so; empty space left at the end of the main row goes (the clip ends with its last part) */
function tidy(row: SegmentLocal[], onTop: SegmentLocal[], mainVideoId: Main): SegmentLocal[] {
  row.sort((x, y) => x.start_ms - y.start_ms)
  while (row.length > 1 && isGapPart(row[row.length - 1], mainVideoId)) row.pop()
  return [...row, ...onTop].sort((x, y) => x.start_ms - y.start_ms || x.sort_order - y.sort_order).map((x, i) => ({ ...x, sort_order: i }))
}

/**
 * `me` put in the main row `row` (which hasn't got it) over [s, s + its length): the empty space
 * there is cut round it, and empty space added up to it when it's past the end of the row.
 * 'between' when a part of the main video is in the way.
 */
function landIn(row: SegmentLocal[], me: SegmentLocal, s: number, mainVideoId: Main, gapOf: ReturnType<typeof gapMaker>): SegmentLocal[] | 'between' {
  const z = s + (me.end_ms - me.start_ms)
  const rowEnd = Math.max(0, ...row.map(x => x.end_ms))
  if (s > rowEnd) row = [...row, gapOf(me, rowEnd, s)]
  if (row.some(x => !isGapPart(x, mainVideoId) && x.start_ms < z && x.end_ms > s)) return 'between'
  const d = s - me.start_ms
  return [
    ...row.flatMap(x => {
      if (x.end_ms <= s || x.start_ms >= z) return [x]
      const out: SegmentLocal[] = []
      if (x.start_ms < s) out.push({ ...x, end_ms: s })
      if (x.end_ms > z) out.push(x.start_ms < s ? gapOf(x, z, x.end_ms) : { ...x, start_ms: z })
      return out
    }),
    {
      ...me, start_ms: s, end_ms: z,
      frame: me.frame?.items ? { ...me.frame, items: me.frame.items.map(it => ({ ...it, start_ms: it.start_ms + d, end_ms: it.end_ms + d })) } : me.frame,
    },
  ]
}

/**
 * A part of the main row put exactly at `startMs` (as in CapCut): nothing else moves. Where it was
 * becomes empty space (visibility.ts isGapPart), the empty space it lands in is cut round it, and
 * empty space left at the end of the row goes (the clip ends with its last part). Each part of the
 * main video says which moment of it it starts at (as it plays now), so the moved part plays just
 * what it played. Used by the editor's placePart (EditorShell), which applies it as one step.
 *
 * Returns the new segments and keyframes; 'between' when another part of the main video is in the
 * way (it goes in between instead: movePart); null when there is nothing to do.
 */
export function placeInRow(
  segments: SegmentLocal[],
  keyframes: KeyframeMap,
  segId: string,
  startMs: number,
  mainVideoId: Main,
  piecesOn: boolean,
  maxMs: number,
  newId: () => string = () => crypto.randomUUID(),
): Placed | 'between' | null {
  const seg = segments.find(x => x.id === segId)
  if (!seg || isShot(seg, mainVideoId) || isInsert(seg, mainVideoId) || isTailOf(seg, mainVideoId) || isGapPart(seg, mainVideoId)) return null
  const a = seg.start_ms, len = seg.end_ms - seg.start_ms
  const s = Math.max(0, Math.min(Math.round(startMs), maxMs - len))
  if (Math.abs(s - a) < 30) return null
  const all = pinned(segments, mainVideoId, piecesOn)
  const me = all.find(x => x.id === segId)!
  const kfs: KeyframeMap = { ...keyframes }
  const gapOf = gapMaker(kfs, newId)
  // (the room after the main video is made again by the editor, from what reaches past the row)
  const rest = all.filter(x => !isShot(x, mainVideoId) && x.id !== segId && !isTailOf(x, mainVideoId))
  const row = landIn([...rest, gapOf(me, a, a + len)], me, s, mainVideoId, gapOf)
  if (row === 'between') return 'between'
  for (const box of seg.crop_boxes) kfs[box.id] = (keyframes[box.id] ?? []).map(k => ({ ...k, t_ms: k.t_ms + s - a }))
  return { segments: tidy(row, all.filter(x => isShot(x, mainVideoId)), mainVideoId), keyframes: kfs }
}

/** Why a part of the main video can't go onto a row: it shows more than one picture (a frame, a split, a trio), or plays faster or slower */
export function liftBlock(seg: SegmentLocal): 'format' | 'speed' | null {
  if (isFrameLayout(seg.layout) || seg.layout === 'split' || seg.layout === 'trio' || seg.crop_boxes.length !== 1 || !mainBox(seg.crop_boxes[0])) return 'format'
  return (seg.speed ?? 1) !== 1 ? 'speed' : null
}

/**
 * A part of the main video dragged off the main row onto row `track`, from `atMs` (as in Resolve):
 * it becomes a video on that row showing the same stretch of the main video (visibility.ts
 * isMainShot), with its framing, its sound and its switches; where it was becomes empty space.
 * `mainStart`: where the clip starts in the main video (a video on a row says its moment in the
 * video's own time). Null when it can't go (liftBlock) or isn't a part of the main video.
 */
export function liftToRow(
  segments: SegmentLocal[],
  keyframes: KeyframeMap,
  segId: string,
  atMs: number,
  track: number,
  mainVideoId: Main,
  piecesOn: boolean,
  mainStart: number,
  newId: () => string = () => crypto.randomUUID(),
): Placed | null {
  const seg = segments.find(x => x.id === segId)
  if (!seg || !mainVideoId || isShot(seg, mainVideoId) || isInsert(seg, mainVideoId) || isTailOf(seg, mainVideoId) || isGapPart(seg, mainVideoId) || liftBlock(seg)) return null
  const a = seg.start_ms, len = seg.end_ms - seg.start_ms
  const at = Math.max(0, Math.round(atMs))
  const all = pinned(segments, mainVideoId, piecesOn)
  const me = all.find(x => x.id === segId)!
  const kfs: KeyframeMap = { ...keyframes }
  const gapOf = gapMaker(kfs, newId)
  const box = me.crop_boxes[0]
  // (its own switches go onto its box, as a video on a row has them)
  const { hidden, muted, locked: _l, speed: _s, smooth: _m, pitch: _p, frame: _f, ...rest } = me
  const shot: SegmentLocal = {
    ...rest, start_ms: at, end_ms: at + len, track,
    crop_boxes: [{ ...box, source_video_id: mainVideoId, source_offset_ms: mainStart + (mainFrom(me) ?? a), muted: !!muted, volume: box.volume ?? 1, ...(hidden ? { hidden: true } : {}) }],
  }
  for (const b of seg.crop_boxes) kfs[b.id] = (keyframes[b.id] ?? []).map(k => ({ ...k, t_ms: k.t_ms + at - a }))
  const row = [...all.filter(x => !isShot(x, mainVideoId) && x.id !== segId && !isTailOf(x, mainVideoId)), gapOf(me, a, a + len)]
  return { segments: tidy(row, [...all.filter(x => isShot(x, mainVideoId)), shot], mainVideoId), keyframes: kfs }
}

/**
 * A part of the main video on a row (liftToRow) dragged back onto the main row with its start at
 * `startMs`: a part of the main row again, playing the same stretch, at that time, over empty room
 * there (cut round it). 'between' when a part of the main video is in the way; null when it isn't one.
 */
export function lowerToRow(
  segments: SegmentLocal[],
  keyframes: KeyframeMap,
  shotId: string,
  startMs: number,
  mainVideoId: Main,
  piecesOn: boolean,
  mainStart: number,
  maxMs: number,
  newId: () => string = () => crypto.randomUUID(),
): Placed | 'between' | null {
  const shot = segments.find(x => x.id === shotId)
  if (!shot || !isMainShot(shot, mainVideoId)) return null
  const len = shot.end_ms - shot.start_ms
  const s = Math.max(0, Math.min(Math.round(startMs), maxMs - len))
  const all = pinned(segments.filter(x => x.id !== shotId), mainVideoId, piecesOn)
  const kfs: KeyframeMap = { ...keyframes }
  const gapOf = gapMaker(kfs, newId)
  const row = landIn(all.filter(x => !isShot(x, mainVideoId) && !isTailOf(x, mainVideoId)), asMainPart(shot, mainStart), s, mainVideoId, gapOf)
  if (row === 'between') return 'between'
  for (const b of shot.crop_boxes) kfs[b.id] = (keyframes[b.id] ?? []).map(k => ({ ...k, t_ms: k.t_ms + s - shot.start_ms }))
  return { segments: tidy(row, all.filter(x => isShot(x, mainVideoId)), mainVideoId), keyframes: kfs }
}

/**
 * Stretches no part covers (clips saved before deleting a part left empty space, or changed by
 * an older editor) as parts of their own: a Vertical part each, playing just what played there
 * (the video carrying on from the part before it), so a clip never has time with no part, and
 * "default framing" is never seen. Up to `lenMs`, the clip's length. Their boxes have no keyframes
 * (the layout's own framing, as it showed). Used when a clip is opened.
 */
export function fillUncovered(segments: SegmentLocal[], lenMs: number, mainVideoId: Main, newId: () => string = () => crypto.randomUUID()): SegmentLocal[] {
  const pieces = piecesOf(segments, mainVideoId, () => false)
  const holes = pieces.filter(p => p.id.startsWith('gap-') && p.ms >= 50).map(p => ({ a: p.at, b: p.at + p.ms, from: p.from ?? p.at }))
  const last = pieces[pieces.length - 1]
  const end = last ? last.at + last.ms : 0
  if (lenMs - end >= 50) holes.push({ a: end, b: lenMs, from: !last ? 0 : last.hold != null ? last.hold : (last.from ?? last.at) + last.ms * (last.speed ?? 1) })
  if (!holes.length) return segments
  const made = holes.map((h): SegmentLocal => ({
    id: newId(), start_ms: Math.round(h.a), end_ms: Math.round(h.b), layout: 'vertical', sort_order: 0,
    crop_boxes: [{ id: newId(), slot_index: 0, source_video_id: null, source_offset_ms: Math.max(0, Math.round(h.from)), keyframes: [] } as SegmentLocal['crop_boxes'][number]],
  }))
  return [...segments, ...made].sort((x, y) => x.start_ms - y.start_ms || x.sort_order - y.sort_order).map((x, i) => ({ ...x, sort_order: i }))
}
