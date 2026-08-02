'use client'

import React, { useState, useEffect, useRef, useMemo } from 'react'
import type {
  Clip, Segment, CropBox, BoxKeyframe, CaptionStyle, TextOverlay,
  AudioTrack, Transition, TranscriptWord, LayoutType, TransitionType, Overlay,
} from '@chai-cut/shared'
import { VideoPreview, OutputCanvas } from '@/components/editor/VideoPreview'
import { SegmentTimeline } from '@/components/editor/SegmentTimeline'
import { CaptionStyler } from '@/components/editor/CaptionStyler'
import { TextOverlayPanel } from '@/components/editor/TextOverlayPanel'
import { AudioMixerPanel } from '@/components/editor/AudioMixerPanel'
import { FilterPanel } from '@/components/editor/FilterPanel'
import { TranscriptPanel } from '@/components/editor/TranscriptPanel'
import { useEditorStore, type KeyframeMap } from '@/modules/editor/store'
import { usePlayerStore } from '@/modules/player/store'
import { useVideoSync } from '@/modules/player/useSync'
import { useCaptionStore } from '@/modules/captions/store'
import { useMediaStore } from '@/modules/media/store'
import { rowsToLocal, defaultCropForSlot, msToLabel } from '@/modules/editor/utils'

// ── Types ────────────────────────────────────────────────────────────────────

type MobileTab = 'timeline' | 'crop' | 'captions' | 'text' | 'audio' | 'filters' | 'export'
type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface SegmentRow extends Omit<Segment, never> {
  crop_boxes: (CropBox & { box_keyframes: BoxKeyframe[] })[]
}

interface Props {
  clip: Clip
  videoUrl: string
  words: TranscriptWord[]
  initialSegments: SegmentRow[]
  initialCaptionStyles: CaptionStyle[]
  initialTextOverlays: TextOverlay[]
  initialAudioTracks: AudioTrack[]
  initialTransitions: Transition[]
  initialOverlays: Overlay[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const LAYOUTS: { id: LayoutType; label: string }[] = [
  { id: 'vertical', label: 'V' },
  { id: 'split', label: 'S' },
  { id: 'trio', label: 'T' },
  { id: 'horizontal', label: 'H' },
]

const TABS: { id: MobileTab; icon: string; label: string }[] = [
  { id: 'timeline', icon: '≡', label: 'Timeline' },
  { id: 'crop', icon: '⊡', label: 'Crop' },
  { id: 'captions', icon: 'CC', label: 'Captions' },
  { id: 'text', icon: 'T', label: 'Text' },
  { id: 'audio', icon: '♪', label: 'Audio' },
  { id: 'filters', icon: '✦', label: 'Filters' },
  { id: 'export', icon: '↓', label: 'Export' },
]

const SEG_COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']

// ── Component ────────────────────────────────────────────────────────────────

export function EditorShellMobile({
  clip, videoUrl, words: initialWords, initialSegments,
  initialCaptionStyles, initialTextOverlays, initialAudioTracks, initialTransitions, initialOverlays,
}: Props) {
  // ── Video player ─────────────────────────────────────────────────────────────
  const { videoRef, seekToMs, togglePlay, pause } = useVideoSync(clip.start_ms, clip.end_ms)
  const { currentTimeMs, durationMs, playing } = usePlayerStore()
  const clipVideoUrl = videoUrl && clip.start_ms > 0
    ? `${videoUrl}#t=${clip.start_ms / 1000}`
    : videoUrl

  // ── Domain stores ─────────────────────────────────────────────────────────────
  const {
    segments, keyframes, activeSegmentId, activeBoxId,
    hydrate: hydrateEditor, updateSegment, removeSegment,
    splitAtMs, upsertKeyframe, getPositionAt,
    setActiveSegmentId, setActiveBoxId,
  } = useEditorStore()

  const {
    words, captionStyle, captionTextCase, showCaptions, romanize,
    retranscribing, retranscribeElapsed, retranscribeError,
    hydrate: hydrateCaptions, setWords, updateWord, updateCaptionStyle,
    setCaptionTextCase, setShowCaptions, setRomanize,
    setRetranscribing, setRetranscribeElapsed, setRetranscribeError,
  } = useCaptionStore()

  const {
    overlays, textOverlays, audioTracks, transitions, filters, activeOverlayId,
    hydrate: hydrateMedia, setOverlays, setTextOverlays, setAudioTracks,
    setTransitions, setFilters, setActiveOverlayId, updateOverlay, deleteOverlay,
    updateTextOverlay, deleteTextOverlay,
  } = useMediaStore()

  // ── Hydrate stores from server props ─────────────────────────────────────────
  useEffect(() => {
    const localSegments = rowsToLocal(initialSegments)
    const initialKeyframeMap: KeyframeMap = {}
    for (const seg of initialSegments) {
      for (const box of seg.crop_boxes) {
        initialKeyframeMap[box.id] = box.box_keyframes
      }
    }
    hydrateEditor(localSegments, initialKeyframeMap)
    const hasCaptions = initialCaptionStyles.length > 0 || initialWords.length > 0
    hydrateCaptions(initialWords, initialCaptionStyles[0] ?? { color: '#FFE700' }, hasCaptions)
    hydrateMedia({
      overlays: initialOverlays,
      textOverlays: initialTextOverlays,
      audioTracks: initialAudioTracks,
      transitions: initialTransitions,
    })
    return () => useEditorStore.getState().reset()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local UI state ────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<MobileTab>('timeline')
  const [activeTextOverlayId, setActiveTextOverlayId] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState(initialWords.length === 0)
  const [clipStatus, setClipStatus] = useState<string>(clip.status)
  const [outputUrl, setOutputUrl] = useState<string | null>(clip.output_url)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const renderQuality = '2160p' as const
  const [renderStuckSince, setRenderStuckSince] = useState<number | null>(clip.status === 'rendering' ? Date.now() : null)
  const [renderElapsed, setRenderElapsed] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [pendingLayout, setPendingLayout] = useState<{ segId: string; layout: LayoutType } | null>(null)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitializedRef = useRef(false)
  const latestHandleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const retranscribeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const skipCanvasTransitionRef = useRef(false)
  const previewInnerRef = useRef<HTMLDivElement>(null)
  const cropDragRef = useRef<{ startFx: number; startFy: number; startX: number; startY: number } | null>(null)

  // ── Derived values ────────────────────────────────────────────────────────────
  const activeSegment = segments.find(s => s.id === activeSegmentId)
    ?? segments.find(s => currentTimeMs >= s.start_ms && currentTimeMs < s.end_ms)
    ?? segments[0]

  const playingSegment = segments.find(s => currentTimeMs >= s.start_ms && currentTimeMs < s.end_ms)
    ?? segments[0] ?? null

  const activeBox = activeSegment?.crop_boxes.find(b => b.id === activeBoxId)
    ?? activeSegment?.crop_boxes[0]

  const cropPos = activeBox
    ? getPositionAt(activeBox.id, currentTimeMs)
    : { x: 0, y: 0, w: 1, h: 1 }

  const hasRoman = words.some(w => w.word_roman)
  const scriptLabel = useMemo(() => {
    const sample = words.find(w => w.word.trim())?.word ?? ''
    if (/[ఀ-౿]/.test(sample)) return 'Tenglish'
    if (/[ऀ-ॿ]/.test(sample)) return 'Hinglish'
    if (/[஀-௿]/.test(sample)) return 'Tanglish'
    if (/[ಀ-೿]/.test(sample)) return 'Kanglish'
    if (/[ഀ-ൿ]/.test(sample)) return 'Manglish'
    if (/[ঀ-৿]/.test(sample)) return 'Banglish'
    return 'Romanize'
  }, [words])
  const displayWords = useMemo(
    () => romanize ? words.map(w => ({ ...w, word: w.word_roman ?? w.word })) : words,
    [words, romanize],
  )
  const clipDurationMs = (clip.end_ms - clip.start_ms) || durationMs || 1

  // ── Polls ─────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!transcribing) return
    const videoId = (clip as unknown as { video_id: string }).video_id
    const interval = setInterval(async () => {
      const res = await fetch(`/api/transcribe/words?video_id=${videoId}`)
      if (!res.ok) return
      const { words: newWords } = await res.json()
      if (newWords && newWords.length > 0) {
        setWords(newWords); setShowCaptions(true); setTranscribing(false); clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [transcribing, clip, setWords, setShowCaptions])

  useEffect(() => {
    if (clipStatus !== 'rendering') { setRenderStuckSince(null); setRenderElapsed(0); return }
    const startedAt = renderStuckSince ?? Date.now()
    if (!renderStuckSince) setRenderStuckSince(startedAt)
    const tick = setInterval(() => setRenderElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    const poll = setInterval(async () => {
      const res = await fetch(`/api/clips/${clip.id}/status`)
      if (!res.ok) return
      const data = await res.json()
      setClipStatus(data.status)
      if (data.output_url) setOutputUrl(data.output_url)
      if (data.status === 'failed') setExportError('Render failed — try again')
      if (data.status !== 'rendering') clearInterval(poll)
    }, 3000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [clip.id, clipStatus])

  // ── Auto-save ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isInitializedRef.current) { isInitializedRef.current = true; return }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => latestHandleSaveRef.current(), 2500)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, keyframes, captionStyle, textOverlays, audioTracks, transitions, filters, overlays])

  // ── Apply default crops after layout split ────────────────────────────────────
  useEffect(() => {
    if (!pendingLayout) return
    const { segId, layout } = pendingLayout
    const seg = segments.find(s => s.id === segId)
    if (!seg) return
    setPendingLayout(null)
    seg.crop_boxes.forEach((box, i) => {
      upsertKeyframe(box.id, { t_ms: seg.start_ms, ...defaultCropForSlot(layout, i) })
    })
  }, [segments]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save / export ─────────────────────────────────────────────────────────────
  async function handleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveState('saving')
    const { segments, keyframes } = useEditorStore.getState()
    const { captionStyle } = useCaptionStore.getState()
    const { overlays, textOverlays, audioTracks, transitions, filters } = useMediaStore.getState()
    try {
      const res = await fetch(`/api/clips/${clip.id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: segments.map(s => ({
            ...s,
            crop_boxes: s.crop_boxes.map(b => ({ ...b, keyframes: keyframes[b.id] ?? b.keyframes })),
          })),
          captionStyle, textOverlays, audioTracks, transitions, filters, overlays,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed')
      setSaveState('saved')
      saveTimerRef.current = setTimeout(() => setSaveState('idle'), 2500)
    } catch (err) {
      console.error('[save]', err)
      setSaveState('error')
      saveTimerRef.current = setTimeout(() => setSaveState('idle'), 3000)
    }
  }
  latestHandleSaveRef.current = handleSave

  async function handleExport() {
    setExporting(true); setExportError(null)
    try {
      const res = await fetch('/api/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clip.id, quality: renderQuality }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Export failed')
      setClipStatus('rendering')
      setActiveTab('export')
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function handleReEdit() {
    await fetch(`/api/clips/${clip.id}/reedit`, { method: 'POST' })
    setClipStatus('draft'); setOutputUrl(null)
  }

  async function handleRetranscribe(languageCode: string) {
    setRetranscribing(true); setRetranscribeElapsed(0); setRetranscribeError(null)
    if (retranscribeTimerRef.current) clearInterval(retranscribeTimerRef.current)
    const startedAt = Date.now()
    retranscribeTimerRef.current = setInterval(
      () => setRetranscribeElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000,
    )
    const stopTimer = () => {
      if (retranscribeTimerRef.current) { clearInterval(retranscribeTimerRef.current); retranscribeTimerRef.current = null }
    }
    try {
      const res = await fetch('/api/transcribe/retranscribe', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clip.id, language_code: languageCode }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Retranscription failed')
      const videoId = (clip as unknown as { video_id: string }).video_id
      const queuedAt = new Date().toISOString()
      const poll = async () => {
        const deadline = Date.now() + 5 * 60 * 1000
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 3000))
          const r = await fetch(`/api/transcribe/words?video_id=${videoId}&since=${encodeURIComponent(queuedAt)}`)
          if (r.ok) {
            const { words: newWords } = await r.json()
            if (newWords?.length > 0) { setWords(newWords); stopTimer(); setRetranscribing(false); return }
          }
        }
        stopTimer(); setRetranscribing(false)
      }
      poll()
    } catch (err) {
      stopTimer(); setRetranscribing(false)
      setRetranscribeError(err instanceof Error ? err.message : 'Retranscription failed')
    }
  }

  function handleLayoutChange(layout: LayoutType) {
    const seg = playingSegment ?? activeSegment
    if (!seg) return
    pause()
    const sameLayout = layout === seg.layout
    const atSegStart = currentTimeMs <= seg.start_ms + 100
    if (sameLayout || atSegStart) {
      if (!sameLayout) updateSegment(seg.id, { layout })
      seg.crop_boxes.forEach((box, i) => upsertKeyframe(box.id, { t_ms: currentTimeMs, ...defaultCropForSlot(layout, i) }))
      setActiveSegmentId(seg.id)
    } else {
      const newId = splitAtMs(seg.id, currentTimeMs, getPositionAt)
      if (newId) {
        updateSegment(newId, { layout })
        setActiveSegmentId(newId)
        setPendingLayout({ segId: newId, layout })
      } else {
        updateSegment(seg.id, { layout })
        seg.crop_boxes.forEach((box, i) => upsertKeyframe(box.id, { t_ms: currentTimeMs, ...defaultCropForSlot(layout, i) }))
        setActiveSegmentId(seg.id)
      }
    }
  }

  function handleCut() {
    if (!activeSegment) return
    const newId = splitAtMs(activeSegment.id, currentTimeMs, getPositionAt)
    if (newId) setActiveSegmentId(newId)
  }

  function handleCropChange(field: 'x' | 'y' | 'w' | 'h', value: number) {
    if (!activeBox) return
    upsertKeyframe(activeBox.id, { t_ms: currentTimeMs, ...cropPos, [field]: value })
  }

  function handleInsertBrollAfterSeg(_afterSegId: string) {}

  // ── Touch-drag crop (translates finger movement to crop position) ─────────────

  function getVideoFrame() {
    const video = videoRef.current
    const container = previewInnerRef.current
    if (!video || !container || !video.videoWidth) return null
    const cW = container.clientWidth
    const cH = container.clientHeight
    const vA = video.videoWidth / video.videoHeight
    const cA = cW / cH
    if (vA > cA) {
      const fW = cW, fH = cW / vA
      return { left: 0, top: (cH - fH) / 2, width: fW, height: fH }
    } else {
      const fH = cH, fW = cH * vA
      return { left: (cW - fW) / 2, top: 0, width: fW, height: fH }
    }
  }

  function touchToFraction(touch: React.Touch) {
    const frame = getVideoFrame()
    const container = previewInnerRef.current
    if (!frame || !container) return null
    const rect = container.getBoundingClientRect()
    const tx = touch.clientX - rect.left - frame.left
    const ty = touch.clientY - rect.top - frame.top
    return { fx: tx / frame.width, fy: ty / frame.height }
  }

  function onCropTouchStart(e: React.TouchEvent) {
    e.preventDefault()
    const pos = touchToFraction(e.touches[0])
    if (!pos) return
    const { fx, fy } = pos
    if (fx >= cropPos.x && fx <= cropPos.x + cropPos.w &&
        fy >= cropPos.y && fy <= cropPos.y + cropPos.h) {
      cropDragRef.current = { startFx: fx, startFy: fy, startX: cropPos.x, startY: cropPos.y }
    }
  }

  function onCropTouchMove(e: React.TouchEvent) {
    e.preventDefault()
    if (!cropDragRef.current || !activeBox) return
    const pos = touchToFraction(e.touches[0])
    if (!pos) return
    const dx = pos.fx - cropDragRef.current.startFx
    const dy = pos.fy - cropDragRef.current.startFy
    upsertKeyframe(activeBox.id, {
      t_ms: currentTimeMs,
      ...cropPos,
      x: Math.max(0, Math.min(1 - cropPos.w, cropDragRef.current.startX + dx)),
      y: Math.max(0, Math.min(1 - cropPos.h, cropDragRef.current.startY + dy)),
    })
  }

  function onCropTouchEnd() { cropDragRef.current = null }

  // ── Render ────────────────────────────────────────────────────────────────────

  // Shared header JSX reused in both orientations
  const headerJSX = (
    <header style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12, paddingRight: 12, background: '#111', borderBottom: '1px solid rgba(255,255,255,0.07)', zIndex: 20 }}>
      <a href="/dashboard" style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.06)', borderRadius: 10, flexShrink: 0 }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M9 2.5L4.5 7 9 11.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </a>
      <div style={{ display: 'flex', gap: 2, background: 'rgba(0,0,0,0.4)', borderRadius: 10, padding: 3, flexShrink: 0 }}>
        {LAYOUTS.map(l => (
          <button key={l.id} onClick={() => handleLayoutChange(l.id)}
            style={{ padding: '4px 8px', borderRadius: 7, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: activeSegment?.layout === l.id ? '#00b4d8' : 'transparent', color: activeSegment?.layout === l.id ? '#fff' : 'rgba(255,255,255,0.4)' }}>
            {l.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11, flexShrink: 0, color: saveState === 'saved' ? '#22c55e' : saveState === 'saving' ? 'rgba(255,255,255,0.4)' : saveState === 'error' ? '#f87171' : 'transparent' }}>
        {saveState === 'saving' ? '●' : saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? '! Error' : '·'}
      </span>
      {exportError && <span style={{ fontSize: 10, color: '#f87171', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exportError}</span>}
    </header>
  )

  // Shared playback bar JSX
  const playbackJSX = (compact = false) => (
    <div style={{ flexShrink: 0, height: compact ? 40 : 44, display: 'flex', alignItems: 'center', gap: compact ? 6 : 8, paddingLeft: compact ? 8 : 12, paddingRight: compact ? 8 : 12, background: '#111', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <button onClick={() => seekToMs(Math.max(0, currentTimeMs - 5000))} style={{ width: compact ? 30 : 36, height: compact ? 30 : 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: 8, border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9.5 3L5 7l4.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><line x1="3" y1="2.5" x2="3" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
      <button onClick={togglePlay} style={{ width: compact ? 36 : 44, height: compact ? 36 : 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#00b4d8', borderRadius: compact ? 18 : 22, border: 'none', cursor: 'pointer', flexShrink: 0 }}>
        {playing
          ? <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><rect x="2" y="1.5" width="3" height="9" rx="1"/><rect x="7" y="1.5" width="3" height="9" rx="1"/></svg>
          : <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M3 1.5l7.5 4.5L3 10.5V1.5z"/></svg>
        }
      </button>
      <button onClick={() => seekToMs(Math.min(clipDurationMs, currentTimeMs + 5000))} style={{ width: compact ? 30 : 36, height: compact ? 30 : 36, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)', borderRadius: 8, border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.5)' }}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4.5 3L9 7l-4.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><line x1="11" y1="2.5" x2="11" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </button>
      {compact && <button onClick={handleCut} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(0,180,216,0.12)', color: '#00b4d8', fontSize: 11, fontWeight: 700, border: '1px solid rgba(0,180,216,0.2)', cursor: 'pointer' }}>✂</button>}
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontVariantNumeric: 'tabular-nums' }}>
        {msToLabel(currentTimeMs)} / {msToLabel(clipDurationMs)}
      </span>
    </div>
  )

  // Shared right sidebar content (9:16 preview + controls) — used in landscape
  const sidebarJSX = (
    <div style={{ width: 240, flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#111', borderLeft: '1px solid rgba(255,255,255,0.07)', overflowY: 'auto' }}>

      {/* 9:16 Output preview */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ padding: '8px 12px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', letterSpacing: 0.5, textTransform: 'uppercase' as const }}>Preview 9:16</span>
          {clipStatus === 'done' && <span style={{ fontSize: 10, fontWeight: 700, color: '#22c55e' }}>Ready</span>}
          {(clipStatus === 'rendering' || exporting) && <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>Processing…</span>}
        </div>
        <div style={{ padding: '0 10px' }}>
          {(clipStatus === 'rendering' || exporting) ? (
            <div style={{ aspectRatio: '9/16', background: '#0d0d0d', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <span style={{ width: 28, height: 28, borderRadius: 14, border: '2px solid #00b4d8', borderTopColor: 'transparent', display: 'block', animation: 'spin 1s linear infinite' }} />
              <p style={{ fontSize: 11, color: '#fff', fontWeight: 600 }}>Processing…</p>
              {renderElapsed > 0 && <p style={{ fontSize: 10, color: 'rgba(0,180,216,0.7)', fontVariantNumeric: 'tabular-nums' }}>{Math.floor(renderElapsed / 60)}m {renderElapsed % 60}s</p>}
            </div>
          ) : (
            <OutputCanvas
              videoRef={videoRef} currentTimeMs={currentTimeMs} clipStartMs={clip.start_ms}
              activeSegment={playingSegment} getPositionAt={getPositionAt}
              skipTransitionRef={skipCanvasTransitionRef}
              words={displayWords} captionStyle={captionStyle} captionTextCase={captionTextCase} showCaptions={showCaptions}
              overlays={overlays} activeOverlayId={activeOverlayId}
              onOverlayChange={updateOverlay} onSelectOverlay={setActiveOverlayId} onDeleteOverlay={deleteOverlay}
              textOverlays={textOverlays} activeTextOverlayId={activeTextOverlayId}
              onTextOverlayChange={updateTextOverlay} onSelectTextOverlay={setActiveTextOverlayId} onDeleteTextOverlay={deleteTextOverlay}
              onCaptionPositionChange={y => updateCaptionStyle({ position_y: y })}
              style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }}
            />
          )}
        </div>
        <div style={{ padding: '8px 10px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {outputUrl && clipStatus === 'done' ? (
            <>
              <a href={outputUrl} download="export.mp4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 0', borderRadius: 10, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', color: '#fff', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>
                <svg width="13" height="13" viewBox="0 0 15 15" fill="none"><path d="M7.5 2v8M4 7l3.5 3.5L11 7M2 13h11" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Download
              </a>
              <button onClick={handleExport} disabled={exporting} style={{ padding: '8px 0', borderRadius: 8, background: 'rgba(0,180,216,0.1)', color: '#00b4d8', fontSize: 11, fontWeight: 600, border: '1px solid rgba(0,180,216,0.2)', cursor: 'pointer', opacity: exporting ? 0.5 : 1 }}>{exporting ? 'Queuing…' : 'Re-render'}</button>
              <button onClick={handleReEdit} style={{ padding: '8px 0', borderRadius: 8, background: 'rgba(124,58,237,0.1)', color: '#a78bfa', fontSize: 11, fontWeight: 600, border: '1px solid rgba(124,58,237,0.2)', cursor: 'pointer' }}>Re-edit</button>
            </>
          ) : clipStatus !== 'rendering' && !exporting ? (
            <button onClick={handleExport} style={{ padding: '11px 0', borderRadius: 10, background: '#00b4d8', color: '#fff', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}>Process video</button>
          ) : clipStatus === 'rendering' && renderElapsed > 180 ? (
            <button onClick={handleReEdit} style={{ fontSize: 11, padding: '8px 0', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>Stuck? Reset</button>
          ) : null}
        </div>
      </div>

      {/* Crop positions */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.5)', letterSpacing: 0.5, textTransform: 'uppercase' as const }}>Crop Positions</span>
          {segments.length > 1 && (
            <button onClick={() => { const f = segments[0]; if (!f) return; segments.slice(1).forEach(s => removeSegment(s.id)); updateSegment(f.id, { start_ms: 0, end_ms: clip.end_ms - clip.start_ms }); setActiveSegmentId(f.id) }}
              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 5, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>Reset</button>
          )}
        </div>
        {segments.filter(s => s.end_ms - s.start_ms > 50).map((seg, i) => {
          const col = SEG_COLORS[i % SEG_COLORS.length]
          const isActive = seg.id === activeSegment?.id
          return (
            <div key={seg.id} onClick={() => { setActiveSegmentId(seg.id); seekToMs(seg.start_ms) }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', marginBottom: 2, background: isActive ? 'rgba(255,255,255,0.06)' : 'transparent' }}>
              <div style={{ width: 6, height: 6, borderRadius: 3, background: col, flexShrink: 0 }} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums', flex: 1 }}>{msToLabel(seg.start_ms)}–{msToLabel(seg.end_ms)}</span>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'capitalize' as const }}>{seg.layout}</span>
              {segments.length > 1 && <button onClick={e => { e.stopPropagation(); removeSegment(seg.id) }} style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.1)', borderRadius: 4, border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 12 }}>×</button>}
            </div>
          )
        })}
      </div>

      {/* Auto-captions */}
      <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: showCaptions ? '#fff' : 'rgba(255,255,255,0.45)' }}>Auto-captions</span>
          <div onClick={() => setShowCaptions(!showCaptions)} style={{ width: 36, height: 20, borderRadius: 10, display: 'flex', alignItems: 'center', paddingLeft: 2, cursor: 'pointer', background: showCaptions ? '#00b4d8' : 'rgba(255,255,255,0.1)', transition: 'background 0.2s' }}>
            <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', transition: 'transform 0.2s', transform: showCaptions ? 'translateX(16px)' : 'translateX(0)' }} />
          </div>
        </div>
        {(transcribing || retranscribing) && (
          <div style={{ margin: '0 12px 10px', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', background: 'rgba(0,180,216,0.08)', borderRadius: 8, border: '1px solid rgba(0,180,216,0.2)' }}>
            <span style={{ width: 12, height: 12, borderRadius: 6, border: '2px solid #00b4d8', borderTopColor: 'transparent', display: 'block', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
            <p style={{ fontSize: 11, color: '#00b4d8', fontWeight: 600 }}>Generating captions…</p>
          </div>
        )}
        {showCaptions && (
          <div style={{ padding: '0 12px 10px' }}>
            <CaptionStyler
              style={captionStyle} textCase={captionTextCase}
              onChange={updateCaptionStyle} onTextCaseChange={setCaptionTextCase}
              onEditCaptions={() => {}} onRetranscribe={handleRetranscribe}
              retranscribing={retranscribing} retranscribeElapsed={retranscribeElapsed} retranscribeError={retranscribeError}
              hasWords={words.length > 0} hasRoman={hasRoman} romanize={romanize} romanizeLabel={scriptLabel} onRomanizeChange={setRomanize}
            />
          </div>
        )}
      </div>

      {/* Filters */}
      <div style={{ padding: '10px 12px 12px' }}>
        <p style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.35)', letterSpacing: 0.5, textTransform: 'uppercase' as const, marginBottom: 8 }}>Filters</p>
        <FilterPanel values={filters} onChange={setFilters} />
      </div>
    </div>
  )

  // Shared source video + touch crop overlay JSX
  const videoPreviewJSX = (
    <div ref={previewInnerRef} style={{ position: 'absolute', inset: 0, borderRadius: 0, overflow: 'hidden' }}>
      <VideoPreview
        videoRef={videoRef} videoUrl={clipVideoUrl} currentTimeMs={currentTimeMs}
        activeSegment={activeSegment ?? null} getPositionAt={getPositionAt}
        activeBoxId={activeBoxId ?? null}
        onSelectBox={(segId, boxId) => { setActiveSegmentId(segId); setActiveBoxId(boxId) }}
        onBoxChange={(boxId, pos) => upsertKeyframe(boxId, { t_ms: currentTimeMs, ...pos })}
      />
      {/* Always-on touch overlay so crop dragging works in both orientations */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 10, touchAction: 'none' }}
        onTouchStart={onCropTouchStart} onTouchMove={onCropTouchMove} onTouchEnd={onCropTouchEnd}
      />
      {activeSegment?.crop_boxes[0]?.source_video_id && (
        <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 20, background: 'rgba(249,115,22,0.85)', color: '#fff', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6, pointerEvents: 'none' }}>B-roll</div>
      )}
    </div>
  )

  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#0d0d0d', overflow: 'hidden' }}>
      {headerJSX}

      {/* ══ LANDSCAPE: exactly like the desktop — video left, sidebar right ══ */}
      <div className="chai-landscape" style={{ flex: 1, minHeight: 0, flexDirection: 'row', overflow: 'hidden' }}>

          {/* Left — source video + playback controls + timeline */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#1a1a2e' }}>
            <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
              {videoPreviewJSX}
            </div>
            {playbackJSX(true)}
            <div style={{ flexShrink: 0, background: '#0d0d0d', borderTop: '1px solid rgba(255,255,255,0.06)', overflowX: 'auto', padding: '4px 8px' }}>
              <SegmentTimeline
                segments={segments} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
                currentTimeMs={currentTimeMs} activeSegmentId={activeSegmentId ?? null}
                onSeek={seekToMs} onSelectSegment={setActiveSegmentId}
                onUpdateSegment={(id, u) => updateSegment(id, u)}
                onInsertBrollAfter={handleInsertBrollAfterSeg}
              />
            </div>
          </div>

          {/* Right — desktop-style sidebar */}
          {sidebarJSX}
        </div>

      {/* ══ PORTRAIT: source video top, tab-based controls below ══ */}
      <div className="chai-portrait" style={{ flex: 1, minHeight: 0, flexDirection: 'column', overflow: 'hidden' }}>

          {/* Source video — visible directly, no overlay hiding it */}
          <div style={{ flexShrink: 0, height: 'calc(40dvh)', background: '#1a1a2e', position: 'relative' }}>
            <div style={{ position: 'absolute', inset: 6, border: '1.5px solid rgba(255,255,255,0.12)', borderRadius: 14, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.6)' }}>
              {videoPreviewJSX}
            </div>
          </div>

          {playbackJSX(false)}

          {/* Tab bar */}
          <div style={{ flexShrink: 0, height: 52, display: 'flex', alignItems: 'stretch', overflowX: 'auto', overflowY: 'hidden', background: '#0d0d0d', borderBottom: '1px solid rgba(255,255,255,0.07)', scrollbarWidth: 'none' }}>
            {TABS.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                style={{ flexShrink: 0, minWidth: 68, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'transparent', border: 'none', cursor: 'pointer', borderBottom: activeTab === tab.id ? '2px solid #00b4d8' : '2px solid transparent', paddingTop: 2 }}>
                <span style={{ fontSize: 15, lineHeight: 1, color: activeTab === tab.id ? '#00b4d8' : 'rgba(255,255,255,0.4)' }}>{tab.icon}</span>
                <span style={{ fontSize: 10, fontWeight: 600, color: activeTab === tab.id ? '#fff' : 'rgba(255,255,255,0.35)', letterSpacing: 0.2 }}>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Active tab panels */}
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>

            {activeTab === 'timeline' && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '10px 12px', display: 'flex', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <button onClick={handleCut} style={{ flex: 1, padding: '10px 0', borderRadius: 10, background: 'rgba(0,180,216,0.12)', color: '#00b4d8', fontSize: 13, fontWeight: 600, border: '1px solid rgba(0,180,216,0.25)', cursor: 'pointer' }}>✂ Cut here</button>
                  {segments.length > 1 && (
                    <button onClick={() => { const f = segments[0]; if (!f) return; segments.slice(1).forEach(s => removeSegment(s.id)); updateSegment(f.id, { start_ms: 0, end_ms: clip.end_ms - clip.start_ms }); setActiveSegmentId(f.id) }}
                      style={{ padding: '10px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 13, fontWeight: 600, border: '1px solid rgba(239,68,68,0.2)', cursor: 'pointer' }}>Reset</button>
                  )}
                </div>
                <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {segments.filter(s => s.end_ms - s.start_ms > 50).map((seg, i) => {
                    const col = SEG_COLORS[i % SEG_COLORS.length]
                    const isActive = seg.id === activeSegment?.id
                    return (
                      <div key={seg.id} onClick={() => { setActiveSegmentId(seg.id); seekToMs(seg.start_ms) }}
                        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, cursor: 'pointer', background: isActive ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)', border: isActive ? `1px solid ${col}33` : '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ width: 8, height: 8, borderRadius: 4, background: col, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' }}>{msToLabel(seg.start_ms)} — {msToLabel(seg.end_ms)}</span>
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', textTransform: 'capitalize' }}>{seg.layout}</span>
                        <div style={{ flex: 1 }} />
                        {segments.length > 1 && <button onClick={e => { e.stopPropagation(); removeSegment(seg.id) }} style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(239,68,68,0.1)', borderRadius: 7, border: 'none', cursor: 'pointer', color: '#f87171', fontSize: 14 }}>×</button>}
                      </div>
                    )
                  })}
                </div>
                <div style={{ padding: '0 12px 12px', overflowX: 'auto' }}>
                  <SegmentTimeline
                    segments={segments} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
                    currentTimeMs={currentTimeMs} activeSegmentId={activeSegmentId ?? null}
                    onSeek={seekToMs} onSelectSegment={setActiveSegmentId}
                    onUpdateSegment={(id, u) => updateSegment(id, u)}
                    onInsertBrollAfter={handleInsertBrollAfterSeg}
                  />
                </div>
              </div>
            )}

            {activeTab === 'crop' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center' }}>Drag the crop box in the video above, or use sliders:</p>
                {!activeBox ? (
                  <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Tap a segment to edit its crop</p>
                ) : (
                  <>
                    {[
                      { key: 'x' as const, label: 'Left (X)' },
                      { key: 'w' as const, label: 'Width (W)' },
                      { key: 'y' as const, label: 'Top (Y)' },
                      { key: 'h' as const, label: 'Height (H)' },
                    ].map(({ key, label }) => (
                      <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)' }}>{label}</span>
                          <span style={{ fontSize: 12, color: '#00b4d8', fontVariantNumeric: 'tabular-nums' }}>{Math.round(cropPos[key] * 100)}%</span>
                        </div>
                        <input type="range" min={0} max={100} value={Math.round(cropPos[key] * 100)}
                          onChange={e => handleCropChange(key, +e.target.value / 100)}
                          style={{ width: '100%', accentColor: '#00b4d8' }} />
                      </div>
                    ))}
                  </>
                )}
              </div>
            )}

            {activeTab === 'captions' && (
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.04)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.07)' }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: showCaptions ? '#fff' : 'rgba(255,255,255,0.45)' }}>Auto-captions</span>
                  <div onClick={() => setShowCaptions(!showCaptions)} style={{ width: 44, height: 24, borderRadius: 12, display: 'flex', alignItems: 'center', paddingLeft: 2, cursor: 'pointer', background: showCaptions ? '#00b4d8' : 'rgba(255,255,255,0.12)', transition: 'background 0.2s' }}>
                    <div style={{ width: 20, height: 20, borderRadius: 10, background: '#fff', transition: 'transform 0.2s', transform: showCaptions ? 'translateX(20px)' : 'translateX(0)' }} />
                  </div>
                </div>
                {(transcribing || retranscribing) ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: 'rgba(0,180,216,0.08)', borderRadius: 10, border: '1px solid rgba(0,180,216,0.2)' }}>
                    <span style={{ width: 16, height: 16, borderRadius: 8, border: '2px solid #00b4d8', borderTopColor: 'transparent', display: 'block', animation: 'spin 0.8s linear infinite' }} />
                    <p style={{ fontSize: 12, color: '#00b4d8', fontWeight: 600 }}>Generating captions…</p>
                  </div>
                ) : words.length > 0 ? (
                  <div style={{ padding: '8px 14px', background: 'rgba(34,197,94,0.07)', borderRadius: 10, border: '1px solid rgba(34,197,94,0.15)' }}>
                    <p style={{ fontSize: 12, color: '#4ade80', fontWeight: 600 }}>✓ Captions ready · {words.length} words</p>
                  </div>
                ) : null}
                {showCaptions && (
                  <CaptionStyler
                    style={captionStyle} textCase={captionTextCase}
                    onChange={updateCaptionStyle} onTextCaseChange={setCaptionTextCase}
                    onEditCaptions={() => {}} onRetranscribe={handleRetranscribe}
                    retranscribing={retranscribing} retranscribeElapsed={retranscribeElapsed} retranscribeError={retranscribeError}
                    hasWords={words.length > 0} hasRoman={hasRoman} romanize={romanize} romanizeLabel={scriptLabel} onRomanizeChange={setRomanize}
                  />
                )}
                {showCaptions && words.length > 0 && (
                  <TranscriptPanel words={displayWords} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
                    currentTimeMs={currentTimeMs} onSeek={seekToMs}
                    onWordChange={(id, text) => updateWord(id, text, romanize ? 'word_roman' : 'word')} />
                )}
              </div>
            )}

            {activeTab === 'text' && (
              <div style={{ padding: 12 }}>
                <TextOverlayPanel overlays={textOverlays} currentTimeMs={currentTimeMs} clipDurationMs={clip.end_ms - clip.start_ms}
                  onAdd={o => setTextOverlays(prev => [...prev, { ...o, id: crypto.randomUUID(), clip_id: clip.id }])}
                  onUpdate={updateTextOverlay} onRemove={deleteTextOverlay} />
              </div>
            )}

            {activeTab === 'audio' && (
              <div style={{ padding: 12 }}>
                <AudioMixerPanel tracks={audioTracks}
                  onAddTrack={f => setAudioTracks(prev => [...prev, { id: crypto.randomUUID(), clip_id: clip.id, storage_path: f.name, start_ms: 0, volume: 0.5, duck_under_speech: true }])}
                  onRemoveTrack={id => setAudioTracks(prev => prev.filter(t => t.id !== id))}
                  onUpdateTrack={(id, u) => setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, ...u } : t))} />
              </div>
            )}

            {activeTab === 'filters' && (
              <div style={{ padding: 12 }}>
                <FilterPanel values={filters} onChange={setFilters} />
              </div>
            )}

            {activeTab === 'export' && (
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                  {(clipStatus === 'rendering' || exporting) ? (
                    <div style={{ aspectRatio: '9/16', background: '#0d0d0d', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                      <span style={{ width: 40, height: 40, borderRadius: 20, border: '2px solid #00b4d8', borderTopColor: 'transparent', display: 'block', animation: 'spin 1s linear infinite' }} />
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>Processing video…</p>
                      {renderElapsed > 0 && <p style={{ fontSize: 12, color: 'rgba(0,180,216,0.7)', fontVariantNumeric: 'tabular-nums' }}>{Math.floor(renderElapsed / 60)}m {renderElapsed % 60}s</p>}
                      {clipStatus === 'rendering' && renderElapsed > 180 && <button onClick={handleReEdit} style={{ fontSize: 12, padding: '8px 16px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', cursor: 'pointer' }}>Stuck? Reset</button>}
                    </div>
                  ) : (
                    <OutputCanvas
                      videoRef={videoRef} currentTimeMs={currentTimeMs} clipStartMs={clip.start_ms}
                      activeSegment={playingSegment} getPositionAt={getPositionAt}
                      skipTransitionRef={skipCanvasTransitionRef}
                      words={displayWords} captionStyle={captionStyle} captionTextCase={captionTextCase} showCaptions={showCaptions}
                      overlays={overlays} activeOverlayId={activeOverlayId}
                      onOverlayChange={updateOverlay} onSelectOverlay={setActiveOverlayId} onDeleteOverlay={deleteOverlay}
                      textOverlays={textOverlays} activeTextOverlayId={activeTextOverlayId}
                      onTextOverlayChange={updateTextOverlay} onSelectTextOverlay={setActiveTextOverlayId} onDeleteTextOverlay={deleteTextOverlay}
                      onCaptionPositionChange={y => updateCaptionStyle({ position_y: y })}
                      style={{ width: '100%', height: 'auto', display: 'block' }}
                    />
                  )}
                </div>
                {outputUrl && clipStatus === 'done' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <a href={outputUrl} download="export.mp4" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px 0', borderRadius: 12, background: '#00b4d8', color: '#fff', fontSize: 15, fontWeight: 700, textDecoration: 'none' }}>
                      <svg width="16" height="16" viewBox="0 0 15 15" fill="none"><path d="M7.5 2v8M4 7l3.5 3.5L11 7M2 13h11" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      Download
                    </a>
                    <button onClick={handleExport} disabled={exporting} style={{ padding: '12px 0', borderRadius: 10, background: 'rgba(0,180,216,0.1)', color: '#00b4d8', fontSize: 13, fontWeight: 600, border: '1px solid rgba(0,180,216,0.2)', cursor: 'pointer', opacity: exporting ? 0.5 : 1 }}>{exporting ? 'Queuing…' : 'Re-render'}</button>
                    <button onClick={handleReEdit} style={{ padding: '12px 0', borderRadius: 10, background: 'rgba(124,58,237,0.1)', color: '#a78bfa', fontSize: 13, fontWeight: 600, border: '1px solid rgba(124,58,237,0.2)', cursor: 'pointer' }}>Re-edit</button>
                  </div>
                ) : clipStatus !== 'rendering' && !exporting ? (
                  <button onClick={handleExport} style={{ padding: '16px 0', borderRadius: 12, background: '#00b4d8', color: '#fff', fontSize: 15, fontWeight: 700, border: 'none', cursor: 'pointer' }}>Process video</button>
                ) : null}
              </div>
            )}

          </div>
        </div>

      <style>{`
        .chai-landscape { display: none; }
        .chai-portrait  { display: flex; }
        @media (orientation: landscape) {
          .chai-landscape { display: flex; }
          .chai-portrait  { display: none; }
        }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
