'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CaptionStyle, SegmentLocal, TextOverlay, TranscriptWord } from '@chai-cut/shared'
import { OutputCanvas } from '@/components/editor/VideoPreview'
import { getBoxPositionAtLerp } from '@/lib/interpolation'

/**
 * A clip played in 9:16 without exporting it: the source video drawn through the clip's framing,
 * captions and text, exactly as the editor's preview draws it (OutputCanvas).
 */
export function ClipPlayer({ videoUrl, startMs, endMs, segments, words, captionStyle, textOverlays }: {
  videoUrl: string
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
  const activeSegment = bySegmentTime.find(s => tMs >= s.start_ms && tMs < s.end_ms) ?? bySegmentTime[bySegmentTime.length - 1] ?? null

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
        if (rel >= lengthMs) { v.pause(); v.currentTime = startMs / 1000; setPlaying(false); setTMs(0); return }
        setTMs(Math.max(0, rel))
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, startMs, lengthMs])

  function toggle() {
    const v = videoRef.current
    if (!v) return
    if (playing) { v.pause(); setPlaying(false); return }
    if (v.currentTime * 1000 < startMs || v.currentTime * 1000 >= endMs) v.currentTime = startMs / 1000
    v.play().then(() => setPlaying(true)).catch(() => setPlaying(false))
  }

  function seekTo(fraction: number) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = (startMs + fraction * lengthMs) / 1000
    setTMs(fraction * lengthMs)
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
      <OutputCanvas
        videoRef={videoRef} currentTimeMs={tMs} clipStartMs={startMs}
        activeSegment={activeSegment} getPositionAt={getPositionAt}
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
