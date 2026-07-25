'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import type { Clip, Segment, CropBox, BoxKeyframe, CaptionStyle, TextOverlay, AudioTrack, Transition, TranscriptWord, LayoutType, TransitionType, Overlay } from '@chai-cut/shared'
import { VideoPreview, OutputCanvas } from '@/components/editor/VideoPreview'
import { SegmentTimeline } from '@/components/editor/SegmentTimeline'
import { KeyframeTrack } from '@/components/editor/KeyframeTrack'
import { TranscriptPanel } from '@/components/editor/TranscriptPanel'
import { CaptionStyler, type TextCase } from '@/components/editor/CaptionStyler'
import { TextOverlayPanel } from '@/components/editor/TextOverlayPanel'
import { FilterPanel, type FilterValues } from '@/components/editor/FilterPanel'
import { AudioMixerPanel } from '@/components/editor/AudioMixerPanel'
import { TransitionPicker } from '@/components/editor/TransitionPicker'
import { MediaPickerModal } from '@/components/editor/MediaPickerModal'
import { LayersPanel } from '@/components/editor/LayersPanel'
// ── Domain stores ──────────────────────────────────────────────────────────────
import { useEditorStore, type KeyframeMap } from '@/modules/editor/store'
import { usePlayerStore } from '@/modules/player/store'
import { useVideoSync } from '@/modules/player/useSync'
import { useCaptionStore } from '@/modules/captions/store'
import { useMediaStore } from '@/modules/media/store'
import { rowsToLocal, defaultCropForSlot, msToLabel } from '@/modules/editor/utils'

type Panel = 'transcript' | 'captions' | 'text' | 'filters' | 'audio' | 'transitions' | 'layers'
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

const LAYOUTS: { id: LayoutType; label: string }[] = [
  { id: 'vertical', label: 'Vertical' }, { id: 'split', label: 'Split' },
  { id: 'trio', label: 'Trio' }, { id: 'spotlight', label: 'Spotlight' },
  { id: 'centered', label: 'Centered' }, { id: 'horizontal', label: 'Horizontal' },
]
const PANELS: { id: Panel; label: string }[] = [
  { id: 'transcript', label: 'Transcript' }, { id: 'text', label: 'Text' },
]
const SEG_COLORS = ['#22c55e','#3b82f6','#a855f7','#f59e0b','#ef4444','#06b6d4','#ec4899','#84cc16']

export function EditorShell({
  clip, videoUrl, words: initialWords, initialSegments,
  initialCaptionStyles, initialTextOverlays, initialAudioTracks, initialTransitions, initialOverlays,
}: Props) {
  // ── Video player ─────────────────────────────────────────────────────────────
  const { videoRef, seekToMs, togglePlay, pause } = useVideoSync(clip.start_ms, clip.end_ms)
  const { currentTimeMs, durationMs, playing } = usePlayerStore()
  // Append media fragment so browser seeks to clip start at network level,
  // preventing a flash of the video's frame 0 on page load / cache hit.
  const clipVideoUrl = videoUrl && clip.start_ms > 0
    ? `${videoUrl}#t=${clip.start_ms / 1000}`
    : videoUrl

  // ── Domain stores ────────────────────────────────────────────────────────────
  const {
    segments, keyframes, activeSegmentId, activeBoxId,
    hydrate: hydrateEditor, addSegment, updateSegment, removeSegment,
    splitAtMs, updateBoxSource, insertBrollAtMs,
    upsertKeyframe, removeKeyframe, getPositionAt,
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

  // ── Hydrate stores from server props (once on mount) ─────────────────────────
  useEffect(() => {
    const localSegments = rowsToLocal(initialSegments)
    const initialKeyframeMap: KeyframeMap = {}
    for (const seg of initialSegments) {
      for (const box of seg.crop_boxes) {
        initialKeyframeMap[box.id] = box.box_keyframes
      }
    }
    hydrateEditor(localSegments, initialKeyframeMap)

    const showCaptions = initialCaptionStyles.length > 0 || initialWords.length > 0
    hydrateCaptions(initialWords, initialCaptionStyles[0] ?? { color: '#FFE700' }, showCaptions)

    hydrateMedia({
      overlays: initialOverlays,
      textOverlays: initialTextOverlays,
      audioTracks: initialAudioTracks,
      transitions: initialTransitions,
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local UI state (not shared across components) ─────────────────────────────
  const [activeTextOverlayId, setActiveTextOverlayId] = useState<string | null>(null)
  const [transcribing, setTranscribing] = useState(initialWords.length === 0)
  const [activePanel, setActivePanel] = useState<Panel>('transcript')
  const [panelOpen, setPanelOpen] = useState(false)
  const [pickerAtMs, setPickerAtMs] = useState<number | null>(null)
  const [pendingBrollMs, setPendingBrollMs] = useState<number | null>(null)
  const [clipStatus, setClipStatus] = useState<string>(clip.status)
  const [outputUrl, setOutputUrl] = useState<string | null>(clip.output_url)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [renderQuality, setRenderQuality] = useState<'480p' | '720p' | '1080p' | '2160p'>('1080p')
  const [saveState, setSaveState] = useState<SaveState>('idle')

  const retranscribeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitializedRef = useRef(false)
  const latestHandleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const pendingLayoutRef = useRef<{ segId: string; layout: LayoutType } | null>(null)
  const justSplitRef = useRef(false)
  const skipCanvasTransitionRef = useRef(false)

  // ── Derived values ────────────────────────────────────────────────────────────
  const activeSegment = segments.find(s => s.id === activeSegmentId)
    ?? segments.find(s => currentTimeMs >= s.start_ms && currentTimeMs < s.end_ms)
    ?? segments[0]

  const playingSegment = segments.find(s => currentTimeMs >= s.start_ms && currentTimeMs < s.end_ms)
    ?? segments[0] ?? null

  const activeBox = activeSegment?.crop_boxes.find(b => b.id === activeBoxId)
    ?? activeSegment?.crop_boxes[0]

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
  const progress = Math.min(1, currentTimeMs / clipDurationMs)

  // ── Polls ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!transcribing) return
    const videoId = (clip as unknown as { video_id: string }).video_id
    const interval = setInterval(async () => {
      const res = await fetch(`/api/transcribe/words?video_id=${videoId}`)
      if (!res.ok) return
      const { words: newWords } = await res.json()
      if (newWords && newWords.length > 0) {
        setWords(newWords)
        setShowCaptions(true)
        setTranscribing(false)
        clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [transcribing, clip, setWords, setShowCaptions])

  useEffect(() => {
    if (clipStatus !== 'rendering') return
    const interval = setInterval(async () => {
      const res = await fetch(`/api/clips/${clip.id}/status`)
      if (!res.ok) return
      const data = await res.json()
      setClipStatus(data.status)
      if (data.output_url) setOutputUrl(data.output_url)
      if (data.status === 'failed') setExportError('Render failed — check backend logs or try again')
      if (data.status !== 'rendering') clearInterval(interval)
    }, 3000)
    return () => clearInterval(interval)
  }, [clip.id, clipStatus])

  // ── Auto-save: trigger 2.5 s after any meaningful edit ───────────────────────

  useEffect(() => {
    if (!isInitializedRef.current) { isInitializedRef.current = true; return }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(() => latestHandleSaveRef.current(), 2500)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, keyframes, captionStyle, textOverlays, audioTracks, transitions, filters, overlays])

  // Apply default crops after a layout split creates new box IDs
  useEffect(() => {
    if (!pendingLayoutRef.current) return
    const { segId, layout } = pendingLayoutRef.current
    const seg = segments.find(s => s.id === segId)
    if (!seg) return
    pendingLayoutRef.current = null
    seg.crop_boxes.forEach((box, i) => {
      upsertKeyframe(box.id, { t_ms: seg.start_ms, ...defaultCropForSlot(layout, i) })
    })
    justSplitRef.current = true
  }, [segments]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Save / export ─────────────────────────────────────────────────────────────

  async function handleSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveState('saving')
    // Read fresh state imperatively — avoids stale closure in auto-save ref
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
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        throw new Error(errBody?.error ?? `Retranscription failed (${res.status})`)
      }
      const videoId = (clip as unknown as { video_id: string }).video_id
      const queuedAt = new Date().toISOString()
      const poll = async () => {
        const deadline = Date.now() + 5 * 60 * 1000
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 3000))
          const res = await fetch(`/api/transcribe/words?video_id=${videoId}&since=${encodeURIComponent(queuedAt)}`)
          if (res.ok) {
            const { words: newWords } = await res.json()
            if (newWords && newWords.length > 0) {
              setWords(newWords)
              stopTimer(); setRetranscribing(false); return
            }
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

  // ── Editor actions ────────────────────────────────────────────────────────────

  function handleUpdateTransition(afterSegmentId: string, type: TransitionType, durationMs: number) {
    setTransitions(prev => {
      const existing = prev.find(t => t.after_segment_id === afterSegmentId)
      if (existing) return prev.map(t => t.after_segment_id === afterSegmentId ? { ...t, type, duration_ms: durationMs } : t)
      return [...prev, { id: crypto.randomUUID(), clip_id: clip.id, after_segment_id: afterSegmentId, type, duration_ms: durationMs }]
    })
  }

  function handleLayoutChange(layout: LayoutType) {
    const seg = playingSegment ?? activeSegment
    if (!seg) return
    skipCanvasTransitionRef.current = true
    pause()
    const wasFreshSplit = justSplitRef.current
    justSplitRef.current = false
    const sameLayout = layout === seg.layout
    const atSegStart = !wasFreshSplit && currentTimeMs <= seg.start_ms + 100
    if (sameLayout || atSegStart) {
      if (!sameLayout) updateSegment(seg.id, { layout })
      seg.crop_boxes.forEach((box, i) => upsertKeyframe(box.id, { t_ms: currentTimeMs, ...defaultCropForSlot(layout, i) }))
      setActiveSegmentId(seg.id)
    } else {
      const newId = splitAtMs(seg.id, currentTimeMs, getPositionAt)
      if (newId) {
        updateSegment(newId, { layout })
        setActiveSegmentId(newId)
        pendingLayoutRef.current = { segId: newId, layout }
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

  function handleInsertBroll(videoId: string) {
    const atMs = pickerAtMs ?? pendingBrollMs ?? currentTimeMs
    setPickerAtMs(null); setPendingBrollMs(null)
    const newId = insertBrollAtMs(videoId, atMs, 5000, getPositionAt)
    if (newId) { setActiveSegmentId(newId); seekToMs(atMs) }
  }

  function handleInsertBrollAfterSeg(afterSegId: string) {
    const seg = segments.find(s => s.id === afterSegId)
    if (seg) setPickerAtMs(seg.end_ms)
  }

  function handleInsertImage(storagePath: string, previewUrl: string) {
    const atMs = pickerAtMs ?? currentTimeMs
    setPickerAtMs(null)
    const seg = segments.find(s => atMs >= s.start_ms && atMs <= s.end_ms)
    const endMs = seg ? seg.end_ms : atMs + 5000
    setOverlays(prev => [...prev, {
      id: crypto.randomUUID(), clip_id: clip.id, type: 'image' as const,
      storage_path: storagePath, preview_url: previewUrl || undefined,
      source_video_id: null, source_offset_ms: 0,
      x: 0, y: 0, w: 1, h: 1, start_ms: atMs, end_ms: endMs,
      z_index: prev.length + 1, created_at: new Date().toISOString(),
    }])
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#0d0d0d' }}>

      {/* Header */}
      <header className="shrink-0 flex items-center gap-3 px-4"
        style={{ height: 52, background: '#111', borderBottom: '1px solid rgba(255,255,255,0.07)', zIndex: 10 }}>
        <a href="/dashboard" className="flex items-center justify-center rounded-lg transition-opacity hover:opacity-70 shrink-0"
          style={{ width: 32, height: 32, background: 'rgba(255,255,255,0.05)' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 2.5L4.5 7 9 11.5" stroke="rgba(255,255,255,0.7)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </a>
        <div className="shrink-0">
          <p className="text-sm font-semibold text-white leading-tight">Position the Crop</p>
          <p className="text-[10px] leading-tight" style={{ color: 'rgba(255,255,255,0.33)' }}>Click or drag to position. Drag edges to resize.</p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 rounded-xl p-0.5" style={{ background: 'rgba(0,0,0,0.4)' }}>
          {LAYOUTS.map(l => (
            <button key={l.id} onClick={() => handleLayoutChange(l.id)}
              className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ background: activeSegment?.layout === l.id ? '#00b4d8' : 'transparent', color: activeSegment?.layout === l.id ? '#fff' : 'rgba(255,255,255,0.4)' }}>
              {l.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 shrink-0">
          {exportError && (
            <span className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}>{exportError}</span>
          )}
          <button onClick={handleSave} disabled={saveState === 'saving'}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
            style={{
              background: saveState === 'saved' ? 'rgba(34,197,94,0.15)' : saveState === 'error' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.07)',
              color: saveState === 'saved' ? '#4ade80' : saveState === 'error' ? '#f87171' : 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}>
            {saveState === 'saving' && <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />}
            {saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? 'Save error' : saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Left: Video + controls + panels */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="flex-1 min-h-0 relative overflow-hidden">
            <VideoPreview
              videoRef={videoRef} videoUrl={clipVideoUrl} currentTimeMs={currentTimeMs}
              activeSegment={activeSegment ?? null} getPositionAt={getPositionAt}
              activeBoxId={activeBoxId ?? null}
              onSelectBox={(segId, boxId) => { setActiveSegmentId(segId); setActiveBoxId(boxId) }}
              onBoxChange={(boxId, pos) => upsertKeyframe(boxId, { t_ms: currentTimeMs, ...pos })}
            />
            {activeSegment?.crop_boxes[0]?.source_video_id && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold pointer-events-none"
                style={{ background: 'rgba(249,115,22,0.85)', color: '#fff' }}>B-roll</div>
            )}
          </div>

          {/* Scrubber */}
          <div className="relative shrink-0 cursor-pointer" style={{ height: 3, background: 'rgba(255,255,255,0.07)' }}
            onClick={e => { const r = e.currentTarget.getBoundingClientRect(); seekToMs(Math.round(((e.clientX - r.left) / r.width) * clipDurationMs)) }}>
            <div className="h-full" style={{ width: `${progress * 100}%`, background: '#00b4d8' }} />
          </div>

          {/* Playback controls */}
          <div className="shrink-0 flex items-center gap-2 px-4"
            style={{ height: 44, borderTop: '1px solid rgba(255,255,255,0.06)', background: '#111' }}>
            <button onClick={() => seekToMs(Math.max(0, currentTimeMs - 5000))}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M9.5 3L5 7l4.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="3" y1="2.5" x2="3" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <button onClick={togglePlay} className="w-9 h-9 flex items-center justify-center rounded-full shrink-0" style={{ background: '#00b4d8' }}>
              {playing
                ? <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><rect x="2" y="1.5" width="3" height="9" rx="1"/><rect x="7" y="1.5" width="3" height="9" rx="1"/></svg>
                : <svg width="12" height="12" viewBox="0 0 12 12" fill="white"><path d="M3 1.5l7.5 4.5L3 10.5V1.5z"/></svg>
              }
            </button>
            <button onClick={() => seekToMs(Math.min(clipDurationMs, currentTimeMs + 5000))}
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity hover:opacity-70" style={{ color: 'rgba(255,255,255,0.4)' }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M4.5 3L9 7l-4.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <line x1="11" y1="2.5" x2="11" y2="11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
            <div className="w-px h-5 shrink-0" style={{ background: 'rgba(255,255,255,0.1)' }} />
            <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.4)' }}>▶▶ 1x</span>
            <div className="flex-1" />
            <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.5)' }}>
              {msToLabel(currentTimeMs)}<span style={{ color: 'rgba(255,255,255,0.2)' }}> / </span>{msToLabel(clipDurationMs)}
            </span>
          </div>

          {/* Panel tabs */}
          <div className="shrink-0 flex flex-col" style={{ background: '#0d0d0d', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="flex items-center overflow-x-auto">
              {PANELS.map(p => (
                <button key={p.id}
                  onClick={() => { if (activePanel === p.id && panelOpen) setPanelOpen(false); else { setActivePanel(p.id); setPanelOpen(true) } }}
                  className="shrink-0 px-3 py-2 text-xs font-medium whitespace-nowrap"
                  style={{ color: activePanel === p.id && panelOpen ? '#fff' : 'rgba(255,255,255,0.28)', borderBottom: activePanel === p.id && panelOpen ? '2px solid #00b4d8' : '2px solid transparent' }}>
                  {p.label}
                </button>
              ))}
              <div className="flex-1" />
              {panelOpen && <button onClick={() => setPanelOpen(false)} className="px-3 py-2 text-xs shrink-0" style={{ color: 'rgba(255,255,255,0.2)' }}>✕</button>}
            </div>
            {panelOpen && (
              <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
                {activePanel === 'transcript' && (
                  <TranscriptPanel words={displayWords} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms} currentTimeMs={currentTimeMs} onSeek={seekToMs} onWordChange={(id, text) => updateWord(id, text, romanize ? 'word_roman' : 'word')} />
                )}
                {activePanel === 'text' && (
                  <TextOverlayPanel
                    overlays={textOverlays}
                    currentTimeMs={currentTimeMs}
                    clipDurationMs={clip.end_ms - clip.start_ms}
                    onAdd={o => setTextOverlays(prev => [...prev, { ...o, id: crypto.randomUUID(), clip_id: clip.id }])}
                    onUpdate={updateTextOverlay}
                    onRemove={deleteTextOverlay}
                  />
                )}
                {activePanel === 'layers' && (
                  <LayersPanel overlays={overlays} clipId={clip.id} currentTimeMs={currentTimeMs} clipEndMs={clip.end_ms}
                    activeOverlayId={activeOverlayId} onSelect={setActiveOverlayId}
                    onAdd={ov => setOverlays(prev => [...prev, ov])}
                    onUpdate={(id, updates) => updateOverlay(id, updates)}
                    onRemove={id => deleteOverlay(id)} />
                )}
                {activePanel === 'filters' && <FilterPanel values={filters} onChange={setFilters} />}
                {activePanel === 'audio' && (
                  <AudioMixerPanel tracks={audioTracks}
                    onAddTrack={f => setAudioTracks(prev => [...prev, { id: crypto.randomUUID(), clip_id: clip.id, storage_path: f.name, start_ms: 0, volume: 0.5, duck_under_speech: true }])}
                    onRemoveTrack={id => setAudioTracks(prev => prev.filter(t => t.id !== id))}
                    onUpdateTrack={(id, updates) => setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t))} />
                )}
                {activePanel === 'transitions' && (
                  <TransitionPicker segments={segments} transitions={transitions} onUpdate={handleUpdateTransition} />
                )}
              </div>
            )}
          </div>

          {/* Timeline footer */}
          <div className="shrink-0" style={{ background: '#0f0f0f', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
            <div className="flex items-center gap-2 px-4" style={{ height: 36 }}>
              <button onClick={handleCut} disabled={!activeSegment}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium disabled:opacity-30 transition-opacity hover:opacity-80"
                style={{ background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', border: '1px solid rgba(255,255,255,0.1)' }}>
                <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
                  <circle cx="4" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                  <circle cx="4" cy="4" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                  <path d="M6 5.5L13 2M6 8.5L13 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Cut
              </button>
              {activeBox && (
                <button onClick={() => upsertKeyframe(activeBox.id, { t_ms: currentTimeMs, ...getPositionAt(activeBox.id, currentTimeMs) })}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-opacity hover:opacity-80"
                  style={{ background: 'rgba(0,180,216,0.12)', color: '#00b4d8', border: '1px solid rgba(0,180,216,0.2)' }}>
                  <svg width="7" height="7" viewBox="0 0 10 10" fill="currentColor"><path d="M5 0l1.5 3.5L10 5 6.5 6.5 5 10 3.5 6.5 0 5l3.5-1.5L5 0z"/></svg>
                  Keyframe
                </button>
              )}
              <div className="flex-1" />
              <span className="text-xs tabular-nums" style={{ color: 'rgba(255,255,255,0.3)' }}>{msToLabel(currentTimeMs)} / {msToLabel(clipDurationMs)}</span>
            </div>
            <div className="px-4 pb-3">
              <SegmentTimeline
                segments={segments} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
                currentTimeMs={currentTimeMs} activeSegmentId={activeSegment?.id ?? null}
                videoUrl={videoUrl} onSeek={seekToMs}
                onSelectSegment={id => setActiveSegmentId(id)}
                onUpdateSegment={(id, updates) => updateSegment(id, updates)}
                onInsertBrollAfter={handleInsertBrollAfterSeg}
                textOverlays={textOverlays} activeTextOverlayId={activeTextOverlayId}
                onSelectTextOverlay={setActiveTextOverlayId}
                onTextOverlayUpdate={updateTextOverlay}
              />
              {activeBox && (
                <KeyframeTrack
                  boxId={activeBox.id} keyframes={keyframes[activeBox.id] ?? []}
                  clipStartMs={clip.start_ms} clipEndMs={clip.end_ms} currentTimeMs={currentTimeMs}
                  onAddKeyframe={() => upsertKeyframe(activeBox.id, { t_ms: currentTimeMs, ...getPositionAt(activeBox.id, currentTimeMs) })}
                  onRemoveKeyframe={t => removeKeyframe(activeBox.id, t)}
                  onSeek={seekToMs}
                />
              )}
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="shrink-0 flex flex-col overflow-y-auto" style={{ width: 300, background: '#111', borderLeft: '1px solid rgba(255,255,255,0.07)' }}>

          {/* 9:16 Output preview */}
          <div className="shrink-0 flex flex-col" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="px-4 pt-3 pb-1 flex items-center gap-2">
              <span className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>Preview 9:16</span>
              {clipStatus === 'done' && <span className="text-xs" style={{ color: '#22c55e' }}>✓ Ready</span>}
              {clipStatus === 'rendering' && <span className="flex items-center gap-1 text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}><span className="w-2.5 h-2.5 border-2 border-current border-t-transparent rounded-full animate-spin" />Rendering</span>}
            </div>
            <div className="flex items-center justify-center p-3">
              <OutputCanvas
                videoRef={videoRef} currentTimeMs={currentTimeMs} clipStartMs={clip.start_ms}
                activeSegment={playingSegment} getPositionAt={getPositionAt}
                skipTransitionRef={skipCanvasTransitionRef} words={displayWords}
                captionStyle={captionStyle} captionTextCase={captionTextCase} showCaptions={showCaptions}
                overlays={overlays} activeOverlayId={activeOverlayId}
                onOverlayChange={updateOverlay} onSelectOverlay={setActiveOverlayId} onDeleteOverlay={deleteOverlay}
                textOverlays={textOverlays} activeTextOverlayId={activeTextOverlayId}
                onTextOverlayChange={updateTextOverlay} onSelectTextOverlay={setActiveTextOverlayId} onDeleteTextOverlay={deleteTextOverlay}
                onCaptionPositionChange={y => updateCaptionStyle({ position_y: y })}
                style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 8, border: '1px solid rgba(255,255,255,0.07)', boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
              />
            </div>
          </div>

          {/* Crop positions */}
          <div className="p-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-white" style={{ letterSpacing: '0.05em', textTransform: 'uppercase' }}>Crop Positions</span>
              <div className="flex items-center gap-2">
                {segments.length > 1 && (
                  <button onClick={() => {
                    const first = segments[0]; if (!first) return
                    segments.slice(1).forEach(s => removeSegment(s.id))
                    updateSegment(first.id, { start_ms: clip.start_ms, end_ms: clip.end_ms })
                    setActiveSegmentId(first.id)
                  }} className="text-xs px-2 py-0.5 rounded transition-opacity hover:opacity-70"
                    style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }} title="Remove all extra positions">
                    Reset
                  </button>
                )}
                <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.5)' }}>
                  {segments.filter(s => s.end_ms - s.start_ms > 50).length}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-0.5">
              {segments.filter(seg => seg.end_ms - seg.start_ms > 50).map((seg, i) => {
                const col = SEG_COLORS[i % SEG_COLORS.length]
                const box = seg.crop_boxes[0]
                const p = box ? getPositionAt(box.id, seg.start_ms) : { x: 0, w: 1, y: 0, h: 1 }
                const isActiveSeg = seg.id === activeSegment?.id
                return (
                  <div key={seg.id} className="flex items-center gap-2 px-2 py-2.5 rounded-lg cursor-pointer transition-colors"
                    style={{ background: isActiveSeg ? 'rgba(255,255,255,0.06)' : 'transparent' }}
                    onClick={() => { setActiveSegmentId(seg.id); seekToMs(seg.start_ms) }}
                    onMouseEnter={e => { if (!isActiveSeg) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)' }}
                    onMouseLeave={e => { if (!isActiveSeg) (e.currentTarget as HTMLElement).style.background = 'transparent' }}>
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                    <span className="text-xs tabular-nums shrink-0" style={{ color: 'rgba(255,255,255,0.65)' }}>{msToLabel(seg.start_ms)} — {msToLabel(seg.end_ms)}</span>
                    <span className="text-xs shrink-0 capitalize" style={{ color: 'rgba(255,255,255,0.3)' }}>{seg.layout}</span>
                    <div className="flex-1 relative h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
                      <div className="absolute h-full rounded-full" style={{ left: `${p.x * 100}%`, width: `${p.w * 100}%`, background: col }} />
                    </div>
                    {segments.length > 1 && (
                      <button onClick={e => { e.stopPropagation(); removeSegment(seg.id) }}
                        className="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-opacity hover:opacity-70"
                        style={{ color: 'rgba(255,255,255,0.25)', opacity: isActiveSeg ? 1 : 0 }}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.opacity = '1'}
                        onMouseLeave={e => { if (!isActiveSeg) (e.currentTarget as HTMLElement).style.opacity = '0' }}>
                        <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
                          <path d="M2 3h8M5 3V2h2v1M4.5 3v6M7.5 3v6M3 3l.5 7h5L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <button onClick={() => addSegment({ start_ms: currentTimeMs, end_ms: Math.min(currentTimeMs + 5000, clip.end_ms), layout: activeSegment?.layout ?? 'vertical', sort_order: segments.length }, id => setActiveSegmentId(id))}
              className="mt-2 w-full py-2 text-xs rounded-lg transition-colors hover:opacity-80"
              style={{ color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.08)' }}>
              + New Position
            </button>
          </div>

          {/* Slot source info */}
          {activeSegment?.crop_boxes.some(b => b.source_video_id) && (
            <div className="px-4 py-3" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
              {activeSegment.crop_boxes.map((box, i) => box.source_video_id && (
                <div key={box.id} className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>Slot {i + 1}</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'rgba(249,115,22,0.15)', color: '#fb923c' }}>B-roll</span>
                    <button onClick={() => updateBoxSource(activeSegment.id, box.id, null, 0)} className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Auto-captions */}
          <div style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <div className="px-4 py-3 flex items-center justify-between">
              <span className="flex items-center gap-2 text-xs font-medium" style={{ color: showCaptions ? '#fff' : 'rgba(255,255,255,0.45)' }}>
                <span style={{ letterSpacing: 0.5 }}>Cc</span><span>Auto-captions</span>
                {transcribing && (
                  <span className="flex items-center gap-1 text-xs" style={{ color: '#00b4d8' }}>
                    <span className="w-2.5 h-2.5 border border-current border-t-transparent rounded-full animate-spin" />Transcribing…
                  </span>
                )}
              </span>
              <div className="w-10 h-5 rounded-full flex items-center px-0.5 cursor-pointer transition-colors"
                style={{ background: showCaptions ? '#00b4d8' : 'rgba(255,255,255,0.1)' }}
                onClick={() => setShowCaptions(!showCaptions)}>
                <div className="w-4 h-4 rounded-full bg-white transition-transform" style={{ transform: showCaptions ? 'translateX(20px)' : 'translateX(0)' }} />
              </div>
            </div>
            {showCaptions && (
              <CaptionStyler
                style={captionStyle} textCase={captionTextCase}
                onChange={updateCaptionStyle}
                onTextCaseChange={setCaptionTextCase}
                onEditCaptions={() => { setActivePanel('transcript'); setPanelOpen(true) }}
                onRetranscribe={handleRetranscribe}
                retranscribing={retranscribing} retranscribeElapsed={retranscribeElapsed}
                retranscribeError={retranscribeError} hasWords={words.length > 0}
                hasRoman={hasRoman} romanize={romanize} romanizeLabel={scriptLabel}
                onRomanizeChange={setRomanize}
              />
            )}
          </div>

          {/* Export */}
          <div className="p-4 mt-auto flex flex-col gap-3">
            {/* Quality selector */}
            {clipStatus !== 'rendering' && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.3)' }}>Quality</span>
                <div className="grid grid-cols-4 gap-1">
                  {(['480p', '720p', '1080p', '2160p'] as const).map(q => (
                    <button
                      key={q}
                      onClick={() => setRenderQuality(q)}
                      className="py-1.5 rounded-lg text-xs font-semibold transition-colors"
                      style={{
                        background: renderQuality === q ? 'rgba(0,180,216,0.2)' : 'rgba(255,255,255,0.04)',
                        color: renderQuality === q ? '#00b4d8' : 'rgba(255,255,255,0.35)',
                        border: `1px solid ${renderQuality === q ? 'rgba(0,180,216,0.5)' : 'rgba(255,255,255,0.07)'}`,
                      }}
                    >
                      {q === '2160p' ? '4K' : q}
                    </button>
                  ))}
                </div>
                {renderQuality === '2160p' && (
                  <p className="text-xs" style={{ color: 'rgba(255,165,0,0.8)' }}>⚠ 4K takes longer to render</p>
                )}
              </div>
            )}
            {outputUrl && clipStatus === 'done' ? (
              <div className="flex flex-col gap-2">
                <a href={outputUrl} download="export.mp4" className="block w-full py-3 text-center rounded-xl text-sm font-semibold text-white" style={{ background: '#16a34a' }}>Download</a>
                <button onClick={handleReEdit} className="w-full py-2 text-xs rounded-xl font-medium" style={{ background: 'rgba(124,58,237,0.15)', color: '#a78bfa', border: '1px solid rgba(124,58,237,0.2)' }}>Re-edit</button>
              </div>
            ) : (
              <button onClick={handleExport} disabled={exporting || clipStatus === 'rendering'}
                className="w-full py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-opacity hover:opacity-90"
                style={{ background: clipStatus === 'rendering' ? 'rgba(255,255,255,0.1)' : '#00b4d8' }}>
                {exporting ? 'Queuing…' : clipStatus === 'rendering'
                  ? <span className="flex items-center justify-center gap-2"><span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />Rendering…</span>
                  : `Process video`}
              </button>
            )}
          </div>
        </div>
      </div>

      {pickerAtMs !== null && (
        <MediaPickerModal clipId={clip.id} atMs={pickerAtMs}
          onInsertVideo={handleInsertBroll} onInsertImage={handleInsertImage}
          onClose={() => setPickerAtMs(null)} />
      )}
    </div>
  )
}
