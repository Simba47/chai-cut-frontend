'use client'

import { useRef, useEffect, useCallback } from 'react'
import { usePlayerStore } from './store'

// Wires a <video> element to the playerStore.
// Returns videoRef + imperative controls. State (currentTimeMs, playing) is in the store.
export function useVideoSync(clipStartMs = 0, clipEndMs?: number) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const rafRef = useRef<number>(0)
  const { setCurrentTimeMs, setDurationMs, setPlaying } = usePlayerStore()

  const toRelative = useCallback(
    (absoluteMs: number) => Math.max(0, absoluteMs - clipStartMs),
    [clipStartMs],
  )

  const tick = useCallback(() => {
    const el = videoRef.current
    if (!el) return
    const absoluteMs = el.currentTime * 1000
    if (clipEndMs !== undefined && absoluteMs >= clipEndMs) {
      el.pause()
      el.currentTime = clipEndMs / 1000
      setPlaying(false)
      setCurrentTimeMs(toRelative(clipEndMs))
      return
    }
    setCurrentTimeMs(toRelative(absoluteMs))
    rafRef.current = 'requestVideoFrameCallback' in el
      ? el.requestVideoFrameCallback(tick)
      : requestAnimationFrame(tick) as unknown as number
  }, [clipStartMs, clipEndMs, toRelative, setCurrentTimeMs, setPlaying])

  useEffect(() => {
    const el = videoRef.current
    if (!el) return

    const onPlay = () => {
      setPlaying(true)
      rafRef.current = 'requestVideoFrameCallback' in el
        ? el.requestVideoFrameCallback(tick)
        : requestAnimationFrame(tick) as unknown as number
    }
    const onPause = () => {
      setPlaying(false)
      cancelAnimationFrame(rafRef.current)
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
    return () => {
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('loadedmetadata', onLoaded)
      cancelAnimationFrame(rafRef.current)
    }
  }, [tick, clipStartMs, clipEndMs, setDurationMs, setPlaying])

  function safePlay(el: HTMLVideoElement) {
    el.play().catch(e => { if (e?.name !== 'AbortError') console.error(e) })
  }

  const play = useCallback(() => { const el = videoRef.current; if (el) safePlay(el) }, [])
  const pause = useCallback(() => videoRef.current?.pause(), [])
  const togglePlay = useCallback(() => {
    const el = videoRef.current; if (!el) return
    el.paused ? safePlay(el) : el.pause()
  }, [])
  const seekToMs = useCallback((ms: number) => {
    const el = videoRef.current; if (!el) return
    el.currentTime = (clipStartMs + ms) / 1000
    setCurrentTimeMs(Math.max(0, ms))
  }, [clipStartMs, setCurrentTimeMs])

  return { videoRef, play, pause, togglePlay, seekToMs }
}

// Polyfill for environments without requestVideoFrameCallback
declare global {
  interface HTMLVideoElement {
    requestVideoFrameCallback(callback: FrameRequestCallback): number
  }
}
