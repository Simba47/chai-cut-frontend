'use client'

import { useRef, useEffect, useCallback } from 'react'
import { usePlayerStore } from './store'

type PushedSeg = { start_ms: number; end_ms: number; video_offset_ms?: number | null }

interface InsertState {
  insertStartMs: number  // timeline start of INSERT (= video_offset_ms of pushed seg)
  insertEndMs: number    // timeline end of INSERT (= pushed seg's start_ms)
  videoHoldMs: number    // video position frozen here during INSERT
  startWallMs: number    // wall-clock anchor; timelineMs = insertStartMs + (now - startWallMs)
}

// Wires a <video> element to the playerStore.
// Returns videoRef + imperative controls. State (currentTimeMs, playing) is in the store.
// segments: non-broll segments from the editor store — used to honour video_offset_ms for true INSERTs.
export function useVideoSync(clipStartMs = 0, clipEndMs?: number, segments?: PushedSeg[]) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number>(0)
  // true when rafRef holds a requestVideoFrameCallback handle (separate ID space from rAF)
  const isVFCRef = useRef(false)
  const segmentsRef = useRef<PushedSeg[] | undefined>(segments)
  // INSERT playback state (wall-clock driven while main video is frozen)
  const insertRef = useRef<InsertState | null>(null)
  // video_offset_ms of the pushed seg we are legitimately playing through (post-INSERT resume)
  const playingThroughRef = useRef<number | null>(null)
  const { setCurrentTimeMs, setDurationMs, setPlaying } = usePlayerStore()

  useEffect(() => { segmentsRef.current = segments }, [segments])

  // ── helpers (use refs so closures never go stale) ────────────────────────────

  // Cancel whichever tick type is currently scheduled.
  // cancelAnimationFrame is a no-op on VFC handles (separate ID space) — must use
  // cancelVideoFrameCallback for those, otherwise orphan ticks accumulate and multiple
  // concurrent ticks cause competing el.play() / el.pause() calls that abort each other.
  function cancelTick(el?: HTMLVideoElement | null) {
    if (isVFCRef.current && el) {
      el.cancelVideoFrameCallback(rafRef.current)
      isVFCRef.current = false
    } else {
      cancelAnimationFrame(rafRef.current)
    }
    rafRef.current = 0
  }

  // Schedule the main-video tick (VFC when supported, rAF otherwise).
  function scheduleTick(el: HTMLVideoElement) {
    if ('requestVideoFrameCallback' in el) {
      rafRef.current = el.requestVideoFrameCallback(tick)
      isVFCRef.current = true
    } else {
      rafRef.current = requestAnimationFrame(tick) as unknown as number
      isVFCRef.current = false
    }
  }

  function safePlay(el: HTMLVideoElement) {
    el.play().catch(e => { if (e?.name !== 'AbortError') console.error(e) })
  }

  // video ms → timeline ms.
  // For positions within a pushed segment (Part B after an INSERT): direct mapping.
  // For positions past all pushed segments: add the accumulated B-roll durations that were
  // inserted before this video position so the timeline stays extended correctly.
  function videoToTimeline(videoMs: number): number {
    const segs = segmentsRef.current ?? []
    const pushed = segs.find(s =>
      s.video_offset_ms != null &&
      videoMs >= (s.video_offset_ms as number) &&
      videoMs < (s.video_offset_ms as number) + (s.end_ms - s.start_ms),
    )
    if (pushed?.video_offset_ms != null) return pushed.start_ms + (videoMs - pushed.video_offset_ms)

    // Accumulate B-roll offset for every pushed segment whose video range ends before videoMs
    let offset = 0
    for (const s of segs) {
      if (s.video_offset_ms == null) continue
      const segVideoEnd = (s.video_offset_ms as number) + (s.end_ms - s.start_ms)
      if (videoMs >= segVideoEnd) {
        offset += s.start_ms - (s.video_offset_ms as number)  // B-roll duration at this insert
      }
    }
    return videoMs + offset
  }

  // timeline ms → video ms (used by seekToMs)
  function timelineToVideo(ms: number): number {
    const segs = segmentsRef.current ?? []
    const pushed = segs.find(s => s.video_offset_ms != null && ms >= s.start_ms && ms < s.end_ms)
    if (pushed?.video_offset_ms != null) return pushed.video_offset_ms + (ms - pushed.start_ms)

    // Subtract accumulated B-roll offsets for pushed segments whose timeline range ends before ms
    let offset = 0
    for (const s of segs) {
      if (s.video_offset_ms == null) continue
      if (ms >= s.end_ms) {
        offset += s.start_ms - (s.video_offset_ms as number)
      }
    }
    return ms - offset
  }

  // Find the pushed segment whose INSERT range contains `ms` (INSERT = [video_offset_ms, start_ms))
  function findInsertOwner(ms: number): PushedSeg | undefined {
    return (segmentsRef.current ?? []).find(s =>
      s.video_offset_ms != null && ms >= (s.video_offset_ms as number) && ms < s.start_ms,
    )
  }

  // Wall-clock RAF that advances currentTimeMs through the INSERT duration
  function doInsertTick() {
    // Guard: if paused, let any zombie RAF chain die here instead of continuing to
    // advance currentTimeMs. cancelAnimationFrame only cancels the next *pending* frame;
    // the frame that is already executing will still schedule one more — this check kills it.
    if (!usePlayerStore.getState().playing) return
    const state = insertRef.current
    if (!state) return
    const timelineMs = state.insertStartMs + (Date.now() - state.startWallMs)
    if (timelineMs >= state.insertEndMs) {
      // INSERT done — clear state and resume main video from video_offset_ms
      const holdMs = state.videoHoldMs
      const endMs = state.insertEndMs
      insertRef.current = null
      playingThroughRef.current = holdMs  // next tick knows we're legitimately in pushed seg
      setCurrentTimeMs(endMs)
      const el = videoRef.current
      if (el) {
        // The video is already parked at holdMs (set when INSERT started).
        // Seeking again to the same position triggers an unnecessary seek cycle in
        // Chromium that can flush decoded frames and leave the canvas black.
        // Just resume playback from the current position.
        safePlay(el)
      }
    } else {
      setCurrentTimeMs(timelineMs)
      rafRef.current = requestAnimationFrame(doInsertTick) as unknown as number
    }
  }

  // ── Main video tick ──────────────────────────────────────────────────────────

  const tick = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    const absoluteMs = el.currentTime * 1000
    if (clipEndMs !== undefined && absoluteMs >= clipEndMs) {
      el.pause()
      el.currentTime = clipEndMs / 1000
      setPlaying(false)
      setCurrentTimeMs(Math.max(0, videoToTimeline(clipEndMs - clipStartMs)))
      return
    }
    const videoMs = absoluteMs - clipStartMs
    const segs = segmentsRef.current ?? []

    // Are we in a pushed segment's video range?
    const pushedMatch = segs.find(s =>
      s.video_offset_ms != null &&
      videoMs >= (s.video_offset_ms as number) &&
      videoMs < (s.video_offset_ms as number) + (s.end_ms - s.start_ms),
    )

    if (pushedMatch?.video_offset_ms != null) {
      if (playingThroughRef.current === pushedMatch.video_offset_ms) {
        // Legitimately playing through pushed seg after INSERT ended — normal mapping
        setCurrentTimeMs(Math.max(0, videoToTimeline(videoMs)))
      } else {
        // Entered pushed range naturally (video played past A_left) → trigger INSERT playback
        // Set state BEFORE pause so onPause guard fires correctly
        // Do NOT backward-seek to video_offset_ms: the video is already at or just past
        // that position (tick fired because videoMs >= video_offset_ms). A backward seek
        // to the same approximate position triggers a CORS re-validation cycle in Chromium
        // which can leave subsequent ctx.drawImage calls drawing black frames.
        insertRef.current = {
          insertStartMs: pushedMatch.video_offset_ms,
          insertEndMs: pushedMatch.start_ms,
          videoHoldMs: pushedMatch.video_offset_ms,
          startWallMs: Date.now(),
        }
        playingThroughRef.current = null
        el.pause()
        setCurrentTimeMs(pushedMatch.video_offset_ms)
        setPlaying(true)  // keep UI in playing state while INSERT wall-clock runs
        isVFCRef.current = false  // INSERT RAF uses rAF, not VFC
        rafRef.current = requestAnimationFrame(doInsertTick) as unknown as number
        return
      }
    } else {
      playingThroughRef.current = null
      setCurrentTimeMs(Math.max(0, videoToTimeline(videoMs)))
    }

    scheduleTick(el)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipStartMs, clipEndMs, setCurrentTimeMs, setPlaying])

  // ── Event wiring ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    const onPlay = () => {
      setPlaying(true)
      const current = usePlayerStore.getState().currentTimeMs
      const ins = insertRef.current
      // Only honour INSERT state if the playhead is actually inside the INSERT range.
      // A stale insertRef (from a previous INSERT that the user seeked away from) must
      // not re-freeze the video — it would make the player appear broken.
      if (ins && current >= ins.insertStartMs && current < ins.insertEndMs) {
        // Video started playing but we're in INSERT mode — re-pause and resume INSERT RAF
        const elapsed = Math.max(0, current - ins.insertStartMs)
        insertRef.current = { ...ins, startWallMs: Date.now() - elapsed }
        el.pause()  // re-freeze video; onPause guard will suppress setPlaying(false)
        isVFCRef.current = false
        rafRef.current = requestAnimationFrame(doInsertTick) as unknown as number
      } else {
        insertRef.current = null  // drop any stale INSERT state
        scheduleTick(el)
      }
    }
    const onPause = () => {
      if (insertRef.current) return  // we paused the video ourselves for INSERT — ignore
      setPlaying(false)
      cancelTick(el)
    }
    const onLoaded = () => {
      const clipDuration = clipEndMs !== undefined
        ? clipEndMs - clipStartMs
        : el.duration * 1000 - clipStartMs
      setDurationMs(clipDuration)
      if (clipStartMs > 0) el.currentTime = clipStartMs / 1000
    }

    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('loadedmetadata', onLoaded)
    if (el.readyState >= 1) onLoaded()
    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('loadedmetadata', onLoaded)
      cancelTick(el)
    }
  }, [tick, clipStartMs, clipEndMs, setDurationMs, setPlaying])

  // ── Public controls ───────────────────────────────────────────────────────────

  const play = useCallback(() => {
    const el = videoRef.current; if (!el) return
    const current = usePlayerStore.getState().currentTimeMs
    // Discard stale INSERT state when playhead is outside the INSERT range.
    if (insertRef.current) {
      const { insertStartMs, insertEndMs } = insertRef.current
      if (current < insertStartMs || current >= insertEndMs) insertRef.current = null
    }
    if (insertRef.current) {
      // Resume INSERT at the current timeline position
      const elapsed = Math.max(0, current - insertRef.current.insertStartMs)
      insertRef.current = { ...insertRef.current, startWallMs: Date.now() - elapsed }
      setPlaying(true)
      rafRef.current = requestAnimationFrame(doInsertTick) as unknown as number
    } else {
      safePlay(el)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPlaying])

  const pause = useCallback(() => {
    // Cancel whichever tick type is running (INSERT RAF = rAF, main tick = rAF or VFC)
    cancelTick(videoRef.current)
    cancelAnimationFrame(rafRef.current)  // also cancel if it was a plain rAF (INSERT RAF)
    // Keep insertRef.current so user can resume from within INSERT
    setPlaying(false)
    videoRef.current?.pause()
  }, [setPlaying])

  const togglePlay = useCallback(() => {
    const isPlaying = usePlayerStore.getState().playing
    if (isPlaying) {
      cancelTick(videoRef.current)
      cancelAnimationFrame(rafRef.current)  // also cancel INSERT RAF if running
      setPlaying(false)
      videoRef.current?.pause()
    } else {
      play()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play, setPlaying])

  const seekToMs = useCallback((ms: number) => {
    const el = videoRef.current; if (!el) return
    cancelTick(el)
    cancelAnimationFrame(rafRef.current)  // also cancel INSERT RAF if running
    playingThroughRef.current = null

    // Seeking into INSERT range: park video at video_offset_ms, keep currentTimeMs = ms
    const insertOwner = findInsertOwner(ms)
    if (insertOwner?.video_offset_ms != null) {
      el.currentTime = (clipStartMs + insertOwner.video_offset_ms) / 1000
      setCurrentTimeMs(ms)
      // Preserve INSERT state so pressing play resumes from this point within INSERT
      insertRef.current = {
        insertStartMs: insertOwner.video_offset_ms,
        insertEndMs: insertOwner.start_ms,
        videoHoldMs: insertOwner.video_offset_ms,
        startWallMs: Date.now() - (ms - insertOwner.video_offset_ms),
      }
      if (usePlayerStore.getState().playing) {
        rafRef.current = requestAnimationFrame(doInsertTick) as unknown as number
      }
      return
    }

    // Seeking into pushed segment range
    insertRef.current = null
    const pushedSeg = (segmentsRef.current ?? []).find(
      s => s.video_offset_ms != null && ms >= s.start_ms && ms < s.end_ms,
    )
    if (pushedSeg?.video_offset_ms != null) {
      const videoMs = pushedSeg.video_offset_ms + (ms - pushedSeg.start_ms)
      el.currentTime = (clipStartMs + videoMs) / 1000
      playingThroughRef.current = pushedSeg.video_offset_ms  // tick can play through normally
      setCurrentTimeMs(ms)
      if (usePlayerStore.getState().playing) {
        // If INSERT froze the video, resume it; onPlay will call scheduleTick.
        // If already playing (normal seek), onPlay won't fire — scheduleTick manually.
        if (el.paused) safePlay(el)
        else scheduleTick(el)
      }
      return
    }

    // Normal segment
    insertRef.current = null
    el.currentTime = (clipStartMs + ms) / 1000
    setCurrentTimeMs(Math.max(0, ms))
    if (usePlayerStore.getState().playing) {
      // If INSERT froze the video, resume it; onPlay will call scheduleTick.
      // If already playing (normal seek), onPlay won't fire — scheduleTick manually.
      if (el.paused) safePlay(el)
      else scheduleTick(el)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipStartMs, setCurrentTimeMs])

  return { videoRef, play, pause, togglePlay, seekToMs }
}

// Polyfill for environments without requestVideoFrameCallback / cancelVideoFrameCallback
declare global {
  interface HTMLVideoElement {
    requestVideoFrameCallback(callback: FrameRequestCallback): number
    cancelVideoFrameCallback(handle: number): void
  }
}
