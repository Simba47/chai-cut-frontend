'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionStyle, SegmentLocal, TextOverlay, TranscriptWord } from '@chai-cut/shared'
import { OutputCanvas } from '@/components/editor/VideoPreview'
import { getBoxPositionAtLerp } from '@/lib/interpolation'
import { BorrowedPool, isBorrowedSlot } from '@/modules/editor/brollSources'

/**
 * A clip played in 9:16 without exporting it: the source video drawn through the clip's framing,
 * captions and text, exactly as the editor's preview draws it (OutputCanvas), with hard cuts
 * between formats and the B-roll shots in place, as in the export.
 */
export function ClipPlayer({ videoUrl, mainVideoId, stockUrls = {}, startMs, endMs, segments, words, captionStyle, textOverlays }: {
  videoUrl: string
  /** The clip's own video: split/trio slots naming it are borrowed reactions from another moment */
  mainVideoId?: string | null
  /** Signed URLs of the B-roll videos the clip shows, by video id */
  stockUrls?: Record<string, string>
  startMs: number
  endMs: number
  segments: SegmentLocal[]
  words: TranscriptWord[]
  captionStyle: Partial<CaptionStyle> | null
  textOverlays: TextOverlay[]
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [tMs, setTMs] = useState(0)   // clip-relative
  const lengthMs = endMs - startMs

  const keyframes = useMemo(() => {
    const map: Record<string, SegmentLocal['crop_boxes'][number]['keyframes']> = {}
    for (const s of segments) for (const b of s.crop_boxes) map[b.id] = b.keyframes
    return map
  }, [segments])
  const getPositionAt = useMemo(() => (boxId: string, t: number) => getBoxPositionAtLerp(t, keyframes[boxId] ?? []), [keyframes])
  const bySegmentTime = useMemo(() => [...segments].sort((a, b) => a.start_ms - b.start_ms), [segments])
  const segmentAt = useMemo(() => (t: number) =>
    bySegmentTime.find(s => t >= s.start_ms && t < s.end_ms) ?? bySegmentTime[bySegmentTime.length - 1] ?? null,
  [bySegmentTime])
  const activeSegment = segmentAt(tMs)

  // B-roll: the stock videos, drawn in place of the source during their shots (muted: the
  // speaker keeps talking, as in the export)
  const stockRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const brollOf = (seg: SegmentLocal | null) => {
    const box = seg?.crop_boxes[0]
    return box?.source_video_id && box.source_video_id !== mainVideoId && stockUrls[box.source_video_id] ? box : null
  }

  // Borrowed reaction slots: the same video from another moment, from a small shared pool that
  // loads nothing until the clip plays and parks the next split/trio ahead of time
  const hasBorrowed = useMemo(() => segments.some(seg => seg.crop_boxes.some(b => isBorrowedSlot(seg, b, mainVideoId))), [segments, mainVideoId])
  const poolRef = useRef<BorrowedPool | null>(null)
  useEffect(() => {
    if (!hasBorrowed || !mainVideoId) return
    poolRef.current = new BorrowedPool(videoUrl, mainVideoId)
    return () => { poolRef.current?.dispose(); poolRef.current = null }
  }, [hasBorrowed, mainVideoId, videoUrl])
  const slotSourceFor = (seg: SegmentLocal | null, box: SegmentLocal['crop_boxes'][number]) =>
    isBorrowedSlot(seg, box, mainVideoId) ? poolRef.current?.source(box.id) ?? false : null
  function syncBorrowed(rel: number, play: boolean) {
    poolRef.current?.sync(bySegmentTime, rel, play)
  }
  const sourceFor = (seg: SegmentLocal | null) => {
    const box = brollOf(seg)
    return box ? stockRefs.current[box.source_video_id!] ?? null : null
  }
  /** Keep the stock video of the shot under the playhead in step; pause the others */
  function syncStock(rel: number, play: boolean) {
    const seg = segmentAt(rel)
    const box = brollOf(seg)
    for (const [id, el] of Object.entries(stockRefs.current)) {
      if (!el) continue
      if (box && id === box.source_video_id && seg) {
        const want = ((box.source_offset_ms ?? 0) + rel - seg.start_ms) / 1000
        if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want
        if (play && el.paused) el.play().catch(() => {})
        if (!play && !el.paused) el.pause()
      } else if (!el.paused) el.pause()
    }
  }

  // Captions: Roman letters when the style says so
  const shownWords = useMemo(
    () => captionStyle?.language === 'roman' ? words.map(w => ({ ...w, word: w.word_roman ?? w.word, source_word: w.word })) : words,
    [words, captionStyle?.language],
  )
  const showCaptions = !!captionStyle && captionStyle.enabled !== false && words.length > 0

  // Follow the video: the time drives which format is on screen; the clip loops within its range
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const v = videoRef.current
      if (v) {
        const rel = v.currentTime * 1000 - startMs
        if (rel >= lengthMs) { v.pause(); v.currentTime = startMs / 1000; setPlaying(false); setTMs(0); syncStock(0, false); syncBorrowed(0, false); return }
        setTMs(Math.max(0, rel))
        syncStock(Math.max(0, rel), true)
        syncBorrowed(Math.max(0, rel), true)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, startMs, lengthMs]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle() {
    const v = videoRef.current
    if (!v) return
    if (playing) { v.pause(); setPlaying(false); syncStock(tMs, false); syncBorrowed(tMs, false); return }
    if (v.currentTime * 1000 < startMs || v.currentTime * 1000 >= endMs) v.currentTime = startMs / 1000
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  function seekTo(fraction: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = (startMs + fraction * lengthMs) / 1000
    setTMs(fraction * lengthMs)
    syncStock(fraction * lengthMs, playing)
    syncBorrowed(fraction * lengthMs, playing)
  }

  const fmt = (ms: number) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-black" style={{ aspectRatio: '9 / 16' }}>
      {/* The source video, drawn onto the 9:16 canvas below (kept in the page so it decodes) */}
      <video
        ref={videoRef}
        src={`${videoUrl}#t=${startMs / 1000}`}
        preload="auto"
        playsInline
        onLoadedData={() => setReady(true)}
        onSeeked={() => setReady(true)}
        style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      {Object.entries(stockUrls).map(([id, url]) => (
        <video key={id} ref={el => { stockRefs.current[id] = el }} src={url} muted playsInline preload="auto"
          style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />
      ))}
      <OutputCanvas
        videoRef={videoRef} currentTimeMs={tMs} clipStartMs={startMs}
        activeSegment={activeSegment} getPositionAt={getPositionAt}
        segmentAt={segmentAt} hardCuts sourceFor={sourceFor} slotSourceFor={slotSourceFor}
        words={shownWords} captionStyle={captionStyle ?? {}} showCaptions={showCaptions}
        textOverlays={textOverlays}
        style={{ width: '100%', height: '100%', display: 'block' }}
      />
      {/* Play / pause over the whole picture */}
      <button onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}
        className="absolute inset-0 flex items-center justify-center transition-opacity"
        style={{ background: playing ? 'transparent' : 'rgba(0,0,0,0.25)' }}>
        {!playing && (
          <span className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
            {ready
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="white" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              : <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          </span>
        )}
      </button>
      {/* Progress: click to jump */}
      <div className="absolute left-0 right-0 bottom-0 px-2 pb-2 pt-4 flex items-center gap-2"
        style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.6))' }}>
        <div className="flex-1 h-1.5 rounded-full cursor-pointer" style={{ background: 'rgba(255,255,255,0.25)' }}
          onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seekTo(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))) }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, (tMs / lengthMs) * 100)}%`, background: '#c8ff00' }} />
        </div>
        <span className="text-[10px] tabular-nums text-white/80">{fmt(tMs)} / {fmt(lengthMs)}</span>
      </div>
    </div>
  )
}
