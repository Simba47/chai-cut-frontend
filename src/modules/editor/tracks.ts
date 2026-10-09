// ── Timeline tracks (as in CapCut) ────────────────────────────────────────────
// The rows under the main video are tracks, not one lane per kind of media: videos on top,
// B-roll, photos and text share the visual tracks and can be dragged from one to another; music
// has its own audio tracks. A higher visual track is drawn over a lower one (videos on top: see
// flattenShots; photos: their z_index). Two things on one track never overlap in time.

export interface TrackItem { id: string; start_ms: number; end_ms: number; track?: number }

const clash = (s: TrackItem, t: number, start: number, end: number, exceptId?: string) =>
  s.id !== exceptId && (s.track ?? 0) === t && s.start_ms < end && s.end_ms > start

/** Whether [start, end) has room on track `t` */
export function fitsOn(items: TrackItem[], t: number, start: number, end: number, exceptId?: string): boolean {
  return !items.some(s => clash(s, t, start, end, exceptId))
}

/** The lowest track (from `from` up) with room for [start, end) */
export function freeTrackIn(items: TrackItem[], start: number, end: number, exceptId?: string, from = 0): number {
  for (let t = Math.max(0, from); ; t++) if (fitsOn(items, t, start, end, exceptId)) return t
}

/**
 * A track for each item: the one it has (`track`, else `saved[id]`) where there is room, kept in
 * that order (lower tracks first); the rest go on the lowest track with room.
 */
export function settleTracks(items: TrackItem[], saved: Record<string, number> = {}): Record<string, number> {
  const want = (it: TrackItem) => {
    const t = it.track ?? saved[it.id]
    return Number.isInteger(t) && t >= 0 ? t : null
  }
  const known = items.filter(i => want(i) != null).sort((a, b) => want(a)! - want(b)! || a.start_ms - b.start_ms)
  const rest = items.filter(i => want(i) == null).sort((a, b) => a.start_ms - b.start_ms)
  const out: Record<string, number> = {}
  const placed: TrackItem[] = []
  for (const it of [...known, ...rest]) {
    const w = want(it)
    const t = w != null && fitsOn(placed, w, it.start_ms, it.end_ms) ? w : freeTrackIn(placed, it.start_ms, it.end_ms)
    out[it.id] = t
    placed.push({ ...it, track: t })
  }
  return out
}

/** The tracks of photos, text and music, saved beside the clip (clips.layers.lanes: id → track) */
export function savedLanes(layers: unknown): Record<string, number> {
  const lanes = (layers as { lanes?: unknown } | null)?.lanes
  if (!lanes || typeof lanes !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [id, t] of Object.entries(lanes as Record<string, unknown>)) if (Number.isInteger(t) && (t as number) >= 0) out[id] = t as number
  return out
}

/** Something on a track, as the timeline names it when it is dragged to another */
export interface TrackRef { kind: 'shot' | 'photo' | 'text' | 'music'; id: string }
