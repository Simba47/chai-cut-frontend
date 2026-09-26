'use client'

import { useState, useEffect, useRef, useMemo, Fragment } from 'react'
import type { Clip, Segment, CropBox, BoxKeyframe, CaptionStyle, TextOverlay, AudioTrack, Transition, TranscriptWord, LayoutType, Overlay } from '@chai-cut/shared'
import { VideoPreview, OutputCanvas } from '@/components/editor/VideoPreview'
import { SegmentTimeline, LAYOUT_COLORS } from '@/components/editor/SegmentTimeline'
import { TranscriptPanel } from '@/components/editor/TranscriptPanel'
import { CaptionStyler } from '@/components/editor/CaptionStyler'
import { TextOverlayPanel } from '@/components/editor/TextOverlayPanel'
import { MediaPickerModal } from '@/components/editor/MediaPickerModal'
import { AccountMenu } from '@/components/editor/AccountMenu'
import { useSession, signOut } from 'next-auth/react'
import { PlatformOverlay, PLATFORM_SAFE, type Platform } from '@/components/editor/PlatformOverlay'
// ── Domain stores ──────────────────────────────────────────────────────────────
import { useEditorStore, type KeyframeMap } from '@/modules/editor/store'
import { usePlayerStore } from '@/modules/player/store'
import { useVideoSync } from '@/modules/player/useSync'
import { useCaptionStore } from '@/modules/captions/store'
import { useMediaStore } from '@/modules/media/store'
import { rowsToLocal, normalizeCoverage, uncoveredRanges, defaultCropForSlot, msToLabel } from '@/modules/editor/utils'
import type { SegmentLocal } from '@chai-cut/shared'

type Tool = 'format' | 'captions' | 'text' | 'media'
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
  { id: 'vertical', label: 'Vertical' }, { id: 'split', label: 'Split screen' },
  { id: 'trio', label: 'Trio' }, { id: 'horizontal', label: 'Horizontal' },
]
const BROLL_COLOR = '#f97316'
// Stand-in format for time no format covers: centred Vertical, the same default render.py uses
const PLATFORM_OPTIONS: { id: Platform; label: string; icon: React.ReactNode }[] = [
  { id: 'off', label: 'Off', icon: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10 18.5h4" /></> },
  { id: 'instagram', label: 'Instagram', icon: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" /></> },
  { id: 'youtube', label: 'YouTube', icon: <><rect x="2.5" y="5" width="19" height="14" rx="4" /><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" /></> },
]
// Options sidebar width (px)
const OPTIONS_W = 272
const DEFAULT_SEG_ID = '__default-format'
const DEFAULT_BOX_ID = '__default-box'
const ACCENT = '#c8ff00'

const TOOLS: { id: Tool; label: string; title: string; hint: string; icon: React.ReactNode }[] = [
  {
    id: 'format', label: 'Format', title: 'Formats',
    hint: 'Each format is a section of the clip with its own layout and framing. Picking a layout mid-format starts a new one at the playhead.',
    icon: <path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  },
  {
    id: 'captions', label: 'Captions', title: 'Captions',
    hint: 'Auto-generated from the audio. Style changes show on the preview straight away.',
    icon: <><rect x="2.5" y="5" width="19" height="14" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M10 10.2a2.2 2.2 0 100 3.6M17 10.2a2.2 2.2 0 100 3.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" /></>,
  },
  {
    id: 'text', label: 'Text', title: 'Text',
    hint: 'Add titles, hooks or call-outs on top of the video.',
    icon: <path d="M5 6V4h14v2M12 4v16M9 20h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  },
  {
    id: 'media', label: 'Media', title: 'B-roll & images',
    hint: 'Cut away to another video, or place an image over the clip.',
    icon: <><rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none" /><circle cx="9" cy="10" r="1.8" fill="currentColor" /><path d="M21 16l-5-5-8 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>,
  },
]

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
    hydrate: hydrateEditor, updateSegment, removeSegment,
    splitAtMs, updateBoxSource, insertBrollAtMs, applyLayout, setSegmentEdge, addFormat, moveJunction,
    upsertKeyframe, setBoxKeyframes, getPositionAt,
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
    hydrate: hydrateMedia, setOverlays, setTextOverlays,
    setActiveOverlayId, updateOverlay, deleteOverlay,
    updateTextOverlay, deleteTextOverlay,
  } = useMediaStore()

  // ── Hydrate stores from server props (once on mount) ─────────────────────────
  useEffect(() => {
    const localSegments = normalizeCoverage(rowsToLocal(initialSegments), clip.end_ms - clip.start_ms)
    const initialKeyframeMap: KeyframeMap = {}
    for (const seg of initialSegments) {
      for (const box of seg.crop_boxes) {
        initialKeyframeMap[box.id] = (box.box_keyframes.length > 0
          ? box.box_keyframes
          : [{ t_ms: seg.start_ms, ...defaultCropForSlot(seg.layout as LayoutType, box.slot_index) }]) as typeof initialKeyframeMap[string]
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

    return () => useEditorStore.getState().reset()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local UI state (not shared across components) ─────────────────────────────
  const [activeTextOverlayId, setActiveTextOverlayId] = useState<string | null>(null)
  const videoStatus = (clip as unknown as { video_status?: string }).video_status
  const [transcribing, setTranscribing] = useState(
    initialWords.length === 0 && videoStatus !== 'ready' && videoStatus !== 'failed'
  )
  const [isFreePlan, setIsFreePlan] = useState(false)
  const [planName, setPlanName] = useState<string | null>(null)
  const { data: session } = useSession()
  const [tool, setTool] = useState<Tool>('format')
  const [optionsOpen, setOptionsOpen] = useState(true)
  const [editingTranscript, setEditingTranscript] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [pickerAtMs, setPickerAtMs] = useState<number | null>(null)
  const [pendingBrollMs, setPendingBrollMs] = useState<number | null>(null)
  const [clipStatus, setClipStatus] = useState<string>(clip.status)
  const [outputUrl, setOutputUrl] = useState<string | null>(clip.output_url)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const renderQuality = '2160p' as const
  const [renderStuckSince, setRenderStuckSince] = useState<number | null>(clip.status === 'rendering' ? Date.now() : null)
  const [renderElapsed, setRenderElapsed] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [motionMode, setMotionMode] = useState(false)
  const motionModeRef = useRef(false)
  useEffect(() => { motionModeRef.current = motionMode }, [motionMode])

  const retranscribeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitializedRef = useRef(false)
  const unsavedRef = useRef(false)
  // Saves run one at a time: an edit made during a save queues exactly one more save after it
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const saveAgainRef = useRef(false)
  const editVersionRef = useRef(0)
  const latestHandleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const skipCanvasTransitionRef = useRef(false)

  // ── Derived values ────────────────────────────────────────────────────────────
  // The format under the playhead, or null where no format is set (default framing applies).
  // At the very end of the clip the format that ends there still counts.
  const clipLengthMs = clip.end_ms - clip.start_ms
  const playingSegment = useMemo(() => {
    const byTime = [...segments].sort((a, b) => a.start_ms - b.start_ms)
    return byTime.find(s => currentTimeMs >= s.start_ms && currentTimeMs < s.end_ms)
      ?? byTime.find(s => s.end_ms >= clipLengthMs && currentTimeMs >= clipLengthMs && s.start_ms < clipLengthMs)
      ?? null
  }, [segments, currentTimeMs, clipLengthMs])
  // Uncovered stretch under the playhead, if any
  const currentGap = useMemo(
    () => playingSegment ? null : uncoveredRanges(segments, clipLengthMs).find(g => currentTimeMs >= g.start_ms && currentTimeMs <= g.end_ms) ?? null,
    [playingSegment, segments, clipLengthMs, currentTimeMs],
  )
  // Selection follows the playhead: selecting a format seeks to it, so the crop boxes,
  // layout buttons, timeline highlight and preview always talk about the same format.
  const activeSegment = playingSegment ?? undefined
  useEffect(() => {
    if (playingSegment && playingSegment.id !== activeSegmentId) setActiveSegmentId(playingSegment.id)
  }, [playingSegment, activeSegmentId, setActiveSegmentId])

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
    // source_word keeps the original punctuation so the preview can break lines at sentence ends
    () => romanize ? words.map(w => ({ ...w, word: w.word_roman ?? w.word, source_word: w.word })) : words,
    [words, romanize],
  )
  const clipDurationMs = (clip.end_ms - clip.start_ms) || durationMs || 1
  const clipTitle = (clip as unknown as { title?: string | null }).title?.trim() || 'Untitled clip'
  const videoId = (clip as unknown as { video_id: string }).video_id
  const videoTitle = (clip as unknown as { video_title?: string | null }).video_title?.trim() || 'Video'

  // Crop positions in playback order — sort_order drifts from time order after splits and B-roll inserts
  const cropPositions = useMemo(
    () => segments.filter(s => s.end_ms - s.start_ms > 50).sort((a, b) => a.start_ms - b.start_ms),
    [segments],
  )
  const uncovered = useMemo(() => uncoveredRanges(segments, clipLengthMs), [segments, clipLengthMs])
  const brollSegments = cropPositions.filter(s => s.crop_boxes.some(b => b.source_video_id))
  const imageOverlays = overlays.filter(o => o.type === 'image')

  function getVideoAR() {
    const v = videoRef.current
    return v && v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : undefined
  }

  // What the canvases show: the format under the playhead, or the default framing in a gap
  const defaultFormat = useMemo<SegmentLocal | null>(() => currentGap ? {
    id: DEFAULT_SEG_ID, start_ms: currentGap.start_ms, end_ms: currentGap.end_ms, layout: 'vertical', sort_order: -1,
    crop_boxes: [{ id: DEFAULT_BOX_ID, slot_index: 0, source_video_id: null, source_offset_ms: currentGap.start_ms, keyframes: [] }],
  } : null, [currentGap])
  const viewSegment = playingSegment ?? defaultFormat
  const viewGetPositionAt = useMemo(
    () => (boxId: string, t: number) => boxId === DEFAULT_BOX_ID ? defaultCropForSlot('vertical', 0, getVideoAR()) : getPositionAt(boxId, t),
    [getPositionAt], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Free plan: lock captions, stop spinner
  useEffect(() => {
    fetch('/api/billing/plan')
      .then(r => r.json())
      .then((d: { autoCaption?: boolean; planName?: string }) => {
        if (d.planName) setPlanName(d.planName)
        if (d.autoCaption === false) {
          setIsFreePlan(true)
          setTranscribing(false)
        }
      })
      .catch(() => {})
  }, [])

  // ── Polls ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!transcribing || isFreePlan) return
    const videoId = (clip as unknown as { video_id: string }).video_id
    const interval = setInterval(async () => {
      const res = await fetch(`/api/transcribe/words?video_id=${videoId}`)
      if (!res.ok) return
      const { words: newWords, video_status: vs } = await res.json()
      if (newWords && newWords.length > 0) {
        setWords(newWords)
        setShowCaptions(true)
        setTranscribing(false)
        clearInterval(interval)
      } else if (vs === 'ready' || vs === 'failed') {
        setTranscribing(false)
        clearInterval(interval)
      }
    }, 3000)
    return () => clearInterval(interval)
  }, [transcribing, isFreePlan, clip, setWords, setShowCaptions])

  const refreshWordsOnDoneRef = useRef(false)

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
      if (data.status === 'done' && refreshWordsOnDoneRef.current) {
        refreshWordsOnDoneRef.current = false
        const videoId = (clip as unknown as { video_id: string }).video_id
        fetch(`/api/transcribe/words?video_id=${videoId}`).then(r => r.ok ? r.json() : null)
          .then(d => { if (d?.words?.length) setWords(d.words) }).catch(() => {})
      }
      if (data.status === 'failed') setExportError('Render failed. Try exporting again.')
      if (data.status !== 'rendering') clearInterval(poll)
    }, 3000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [clip.id, clipStatus])

  // ── Auto-save: trigger 2.5 s after any meaningful edit ───────────────────────

  useEffect(() => {
    if (!isInitializedRef.current) { isInitializedRef.current = true; return }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    unsavedRef.current = true
    editVersionRef.current++
    autoSaveTimerRef.current = setTimeout(() => latestHandleSaveRef.current(), 2500)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, keyframes, captionStyle, textOverlays, audioTracks, transitions, filters, overlays])

  // Options sidebar open/closed and the social media preview choice are remembered per browser
  const [platform, setPlatformState] = useState<Platform>('off')
  useEffect(() => {
    try {
      if (localStorage.getItem('editor.optionsOpen') === 'false') setOptionsOpen(false)
      const p = localStorage.getItem('editor.platformPreview')
      if (p === 'instagram' || p === 'youtube') setPlatformState(p)
    } catch { /* storage blocked */ }
  }, [])
  function setPlatform(p: Platform) {
    setPlatformState(p)
    try { localStorage.setItem('editor.platformPreview', p) } catch { /* storage blocked */ }
  }
  function toggleOptions(open: boolean) {
    setOptionsOpen(open)
    try { localStorage.setItem('editor.optionsOpen', String(open)) } catch { /* storage blocked */ }
  }

  // Two-step reset: the button arms for 3 s, a second click confirms
  useEffect(() => {
    if (!confirmReset) return
    const t = setTimeout(() => setConfirmReset(false), 3000)
    return () => clearTimeout(t)
  }, [confirmReset])

  // ── Save / export ─────────────────────────────────────────────────────────────

  // Two saves writing the same clip at once can collide (one deletes a format the other is still
  // writing) — so never overlap them. Callers get a promise that resolves once everything is saved.
  // Resolves true when the latest save succeeded
  const lastSaveOkRef = useRef(true)
  function handleSave(): Promise<void> {
    if (saveInFlightRef.current) { saveAgainRef.current = true; return saveInFlightRef.current }
    const run = async () => {
      do { saveAgainRef.current = false; lastSaveOkRef.current = await saveOnce() } while (saveAgainRef.current)
    }
    saveInFlightRef.current = run().finally(() => { saveInFlightRef.current = null })
    return saveInFlightRef.current
  }

  async function saveOnce(): Promise<boolean> {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    setSaveState('saving')
    const version = editVersionRef.current
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
      // Only clear "unsaved" if nothing changed while this save was in flight
      if (editVersionRef.current === version) unsavedRef.current = false
      setSaveState('saved')
      saveTimerRef.current = setTimeout(() => setSaveState('idle'), 2500)
      return true
    } catch (err) {
      console.error('[save]', err)
      setSaveState('error')
      return false
    }
  }
  latestHandleSaveRef.current = handleSave

  // Leaving the editor: flush a pending auto-save first so the last edit isn't lost
  const [leaving, setLeaving] = useState(false)
  async function leaveTo(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return // let new-tab clicks through
    e.preventDefault()
    leave(() => { window.location.href = href })
  }
  async function leave(go: () => void) {
    if (leaving) return
    setLeaving(true)
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    if (unsavedRef.current) await handleSave()
    // Save failed: stay put so the edit isn't lost; the header shows "Couldn't save · Retry"
    if (unsavedRef.current) { setLeaving(false); return }
    go()
  }

  // retranscribe: Re-render also regenerates captions (Gemini) before rendering
  async function handleExport(retranscribe = false) {
    setExporting(true); setExportError(null)
    try {
      await handleSave()
      // Rendering now would export the previous version and silently drop the latest edits
      if (!lastSaveOkRef.current) throw new Error("Couldn't save your latest edits, so nothing was exported. Check your connection and try again.")
      const res = await fetch('/api/export', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clip_id: clip.id, quality: renderQuality, retranscribe }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? 'Export failed')
      refreshWordsOnDoneRef.current = retranscribe
      setClipStatus('rendering')
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  async function handleResetStuckRender() {
    await fetch(`/api/clips/${clip.id}/reedit`, { method: 'POST' })
    setClipStatus('draft'); setOutputUrl(null); setRenderStuckSince(null); setRenderElapsed(0)
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

  // A layout applies from the playhead to the end of the current position. What came before the
  // playhead keeps its layout and framing; at the very start of a position the whole position changes.
  const LAYOUT_SNAP_MS = 300
  function handleLayoutChange(layout: LayoutType) {
    const t = currentTimeMs
    if (!activeSegment && currentGap) {
      // No format here yet: create one from the playhead (or the gap's start) to the gap's end
      const start = t - currentGap.start_ms <= LAYOUT_SNAP_MS ? currentGap.start_ms : t
      if (currentGap.end_ms - start < 300) return
      pause()
      skipCanvasTransitionRef.current = true
      addFormat(start, currentGap.end_ms, layout, getVideoAR())
      if (start !== t) seekToMs(start)
      return
    }
    const seg = activeSegment
    if (!seg || seg.layout === layout) return
    pause()
    skipCanvasTransitionRef.current = true
    setActiveBoxId(null)

    if (t - seg.start_ms <= LAYOUT_SNAP_MS) {
      applyLayout(seg.id, layout, getVideoAR())
      return
    }
    if (seg.end_ms - t <= LAYOUT_SNAP_MS) {
      // Playhead is on the line into what follows: change the next format if it touches this one
      const next = [...segments].sort((a, b) => a.start_ms - b.start_ms).find(s => s.start_ms >= seg.end_ms - 1)
      if (next && next.start_ms - seg.end_ms < LAYOUT_SNAP_MS) {
        if (next.layout !== layout) { applyLayout(next.id, layout, getVideoAR()); seekToMs(next.start_ms) }
        return
      }
      // Default framing follows: give that stretch the new format
      const gapEnd = next ? next.start_ms : clipLengthMs
      if (gapEnd - seg.end_ms >= 300) { addFormat(seg.end_ms, gapEnd, layout, getVideoAR()); seekToMs(seg.end_ms) }
      return
    }
    const newId = splitAtMs(seg.id, t, getPositionAt)
    if (newId) applyLayout(newId, layout, getVideoAR())
  }

  // Crop edits: with Motion off the box frames the whole position (one keyframe at its start).
  // With Motion on, each drag records a keyframe at the playhead, and the renderer pans between them.
  function handleBoxChange(boxId: string, pos: { x: number; y: number; w: number; h: number }) {
    if (boxId === DEFAULT_BOX_ID) {
      // First move creates a format over the gap; the rest of the same drag (whose handler still
      // points at the default box) reframes that new format instead of creating more
      const gap = currentGap
      if (!gap) return
      const made = useEditorStore.getState().segments.find(x => x.start_ms === gap.start_ms && x.end_ms === gap.end_ms)
      if (made?.crop_boxes[0]) { setBoxKeyframes(made.crop_boxes[0].id, [{ t_ms: made.start_ms, ...pos }]); return }
      addFormat(gap.start_ms, gap.end_ms, 'vertical', getVideoAR(), pos)
      return
    }
    const vid = videoRef.current
    if (motionModeRef.current) {
      const t_ms = vid && !vid.paused ? Math.round(vid.currentTime * 1000) - clip.start_ms : currentTimeMs
      upsertKeyframe(boxId, { t_ms: Math.max(0, t_ms), ...pos })
      return
    }
    const seg = segments.find(s => s.crop_boxes.some(b => b.id === boxId))
    setBoxKeyframes(boxId, [{ t_ms: seg?.start_ms ?? 0, ...pos }])
  }

  function trimSelectedTo(edge: 'start' | 'end') {
    if (!activeSegment) return
    setSegmentEdge(activeSegment.id, edge, currentTimeMs, clipLengthMs)
  }

  function addFormatInGap(gap: { start_ms: number; end_ms: number }) {
    addFormat(gap.start_ms, gap.end_ms, 'vertical', getVideoAR())
    seekToMs(gap.start_ms)
  }

  function handleResetPositions() {
    if (!confirmReset) { setConfirmReset(true); return }
    setConfirmReset(false)
    const first = [...segments].sort((a, b) => a.start_ms - b.start_ms)[0]
    if (!first) return
    segments.filter(s => s.id !== first.id).forEach(s => removeSegment(s.id))
    updateSegment(first.id, { start_ms: 0, end_ms: clipLengthMs })
    setActiveSegmentId(first.id)
  }

  function handleDeleteFormat(segId: string) {
    if (cropPositions.length > 1) { removeSegment(segId); return }
    const seg = cropPositions[0]
    if (!seg) return
    pause()
    skipCanvasTransitionRef.current = true
    applyLayout(seg.id, 'vertical', getVideoAR())
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

  // ── Keyboard shortcuts: Space play/pause · [ ] trim · Delete · ←/→ 1 s (Shift: 5 s) ──────────
  const shortcutsRef = useRef({ togglePlay, seekToMs, currentTimeMs, clipDurationMs, trimSelectedTo, deleteSelected: () => {} })
  shortcutsRef.current = {
    togglePlay, seekToMs, currentTimeMs, clipDurationMs, trimSelectedTo,
    // Delete acts on what's selected most specifically: a text overlay, then an image, then the format
    // (an overlay only counts while it's on screen at the playhead, so a stale selection can't be deleted by surprise)
    deleteSelected: () => {
      const onScreen = (o: { start_ms: number; end_ms: number }) => currentTimeMs >= o.start_ms && currentTimeMs < o.end_ms
      const text = textOverlays.find(o => o.id === activeTextOverlayId && onScreen(o))
      if (text) { deleteTextOverlay(text.id); setActiveTextOverlayId(null); return }
      const image = overlays.find(o => o.id === activeOverlayId && onScreen(o))
      if (image) { deleteOverlay(image.id); setActiveOverlayId(null); return }
      if (activeSegment) handleDeleteFormat(activeSegment.id)
    },
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      const s = shortcutsRef.current
      if (e.code === 'Space') {
        // A focused button already handles Space itself
        if (target?.closest('button, a')) return
        e.preventDefault(); s.togglePlay()
      } else if (e.key === '[') {
        e.preventDefault(); s.trimSelectedTo('start')
      } else if (e.key === ']') {
        e.preventDefault(); s.trimSelectedTo('end')
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (target?.closest('button, a, [role="button"]') && e.key === 'Backspace') return
        e.preventDefault(); s.deleteSelected()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = (e.shiftKey ? 5000 : 1000) * (e.key === 'ArrowLeft' ? -1 : 1)
        s.seekToMs(Math.max(0, Math.min(s.clipDurationMs, s.currentTimeMs + step)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────

  const rendering = clipStatus === 'rendering' || exporting
  const hasOutput = !!outputUrl && clipStatus === 'done'
  const activeTool = TOOLS.find(t => t.id === tool)!

  return (
    <div className="editor-theme h-screen flex flex-col overflow-hidden" style={{ background: 'var(--ed-app)', color: 'var(--ed-text)' }}>

      {/* ── Header: logo · where am I · is it saved · export ───────────────────── */}
      {/* Above everything in the body (preview overlays use z-index 10–20), so the account menu isn't drawn underneath them */}
      <header className="relative shrink-0 flex items-center gap-3 px-4"
        style={{ height: 56, background: 'var(--ed-panel)', borderBottom: '1px solid rgb(var(--ed-fg) / 0.07)', zIndex: 60 }}>
        <a href="/dashboard" onClick={e => leaveTo(e, '/dashboard')} title="Go to the dashboard"
          className="flex items-center gap-2 shrink-0 rounded-lg transition-opacity hover:opacity-85">
          {/* The logo file has a black square around the mark: crop to the mark, blend the black away */}
          <span className="relative block overflow-hidden rounded-lg" style={{ width: 28, height: 28 }}>
            <img src="/logo-icon.png" alt="" style={{ position: 'absolute', width: 56, height: 56, left: -14, top: -12, maxWidth: 'none', mixBlendMode: 'screen' }} />
          </span>
          <span className="text-[15px] font-bold text-[var(--ed-text)]" style={{ letterSpacing: '-0.02em' }}>Shortcut</span>
        </a>

        <div className="w-px h-6 shrink-0" style={{ background: 'rgb(var(--ed-fg) / 0.1)' }} />

        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 text-sm">
          <a href="/dashboard" onClick={e => leaveTo(e, '/dashboard')}
            className="shrink-0 transition-colors hover:text-[var(--ed-text)]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
            Dashboard
          </a>
          <BreadcrumbChevron />
          <a href={`/videos/${videoId}`} onClick={e => leaveTo(e, `/videos/${videoId}`)} title={`${videoTitle}: all clips`}
            className="truncate transition-colors hover:text-[var(--ed-text)]" style={{ color: 'rgb(var(--ed-fg) / 0.5)', maxWidth: 200 }}>
            {videoTitle}
          </a>
          <BreadcrumbChevron />
          <span aria-current="page" className="font-semibold text-[var(--ed-text)] truncate" title={clipTitle} style={{ maxWidth: 260 }}>{clipTitle}</span>
        </nav>

        <SaveIndicator state={leaving ? 'saving' : saveState} leaving={leaving} onRetry={handleSave} />

        <div className="flex-1" />

        <div className="flex items-center gap-3 shrink-0">
          <AccountMenu
            email={session?.user?.email ?? ''}
            planName={planName}
            onNavigate={href => leave(() => { window.location.href = href })}
            onSignOut={() => leave(() => { signOut({ callbackUrl: '/login' }) })}
          />
        </div>
      </header>

      {exportError && (
        <div role="alert" className="shrink-0 flex items-center gap-3 px-4 py-2 text-xs"
          style={{ background: 'rgba(239,68,68,0.12)', borderBottom: '1px solid rgba(239,68,68,0.25)', color: '#fca5a5' }}>
          <span className="flex-1">{exportError}</span>
          <button onClick={() => setExportError(null)} className="px-2 py-0.5 rounded hover:bg-[rgb(var(--ed-fg)/0.1)]" aria-label="Dismiss">✕</button>
        </div>
      )}

      {/* ── Body: tools · inspector · canvas + timeline · preview ────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Tool rail */}
        <nav aria-label="Editor tools" className="shrink-0 flex flex-col items-center gap-1 py-3"
          style={{ width: 72, background: 'var(--ed-panel)', borderRight: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
          {TOOLS.map(t => {
            const active = tool === t.id && optionsOpen
            return (
              <button key={t.id}
                onClick={() => {
                  if (active) { toggleOptions(false); return }
                  setTool(t.id); setEditingTranscript(false); toggleOptions(true)
                }}
                aria-pressed={active}
                title={active ? `Hide ${t.label.toLowerCase()} options` : t.title}
                className="flex flex-col items-center justify-center gap-1 rounded-xl transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]"
                style={{ width: 60, height: 58, background: active ? 'rgba(200,255,0,0.1)' : undefined, color: active ? 'var(--ed-accent-text)' : 'rgb(var(--ed-fg) / 0.5)' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">{t.icon}</svg>
                <span className="text-[11px] font-medium">{t.label}</span>
              </button>
            )
          })}
          <div className="flex-1" />
          <button onClick={() => toggleOptions(!optionsOpen)}
            aria-label={optionsOpen ? 'Close options sidebar' : 'Open options sidebar'}
            aria-expanded={optionsOpen} aria-controls="options-sidebar"
            title={optionsOpen ? 'Close options sidebar' : 'Open options sidebar'}
            className="flex items-center justify-center rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
            style={{ width: 36, height: 36, color: 'rgb(var(--ed-fg) / 0.55)' }}>
            <SidebarIcon open={optionsOpen} />
          </button>
        </nav>

        {/* Options sidebar — settings for the selected tool only; collapsible */}
        <aside id="options-sidebar" aria-label={`${activeTool.title} options`} aria-hidden={!optionsOpen}
          className="shrink-0 min-h-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none"
          style={{ width: optionsOpen ? OPTIONS_W : 0, background: 'var(--ed-panel)', borderRight: optionsOpen ? '1px solid rgb(var(--ed-fg) / 0.07)' : 'none' }}
          {...(!optionsOpen ? { inert: true } : {})}>
          <div className="h-full flex flex-col min-h-0" style={{ width: OPTIONS_W }}>
          <div className="shrink-0 pl-4 pr-2 pt-3 pb-3 flex items-start gap-2" style={{ borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <div className="flex-1 min-w-0 pt-1">
            {tool === 'captions' && editingTranscript ? (
              <button onClick={() => setEditingTranscript(false)} className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ed-text)] hover:opacity-80">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M9 2.5L4.5 7 9 11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Edit caption text
              </button>
            ) : (
              <>
                <h2 className="text-sm font-semibold text-[var(--ed-text)]">{activeTool.title}</h2>
                <p className="text-xs mt-1 leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{activeTool.hint}</p>
              </>
            )}
            </div>
            <button onClick={() => toggleOptions(false)} aria-label="Close options sidebar" title="Close options sidebar"
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
              style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
              <SidebarIcon open />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto">
            {tool === 'format' && (
              <div className="flex flex-col">
                <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                  <span className="text-xs font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                    {cropPositions.length} format{cropPositions.length === 1 ? '' : 's'}
                    {uncovered.length > 0 && <span style={{ color: 'rgb(var(--ed-fg) / 0.35)' }}> · {uncovered.length} default</span>}
                  </span>
                  <div className="flex-1" />
                  {cropPositions.length > 1 && (
                    <button onClick={handleResetPositions}
                      title="Remove every format except the first"
                      className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
                      style={confirmReset
                        ? { background: '#ef4444', color: '#fff', border: '1px solid #ef4444' }
                        : { color: 'rgb(var(--ed-fg) / 0.55)', border: '1px solid rgb(var(--ed-fg) / 0.12)' }}>
                      {confirmReset ? 'Confirm' : 'Reset'}
                    </button>
                  )}
                </div>
                <div className="px-2 pb-3 flex flex-col gap-0.5">
                  {uncovered.filter(g => g.start_ms < (cropPositions[0]?.start_ms ?? Infinity)).map(g => (
                    <GapRow key={`gap-${g.start_ms}`} gap={g} active={currentGap?.start_ms === g.start_ms}
                      onSelect={() => seekToMs(g.start_ms)} onAdd={() => addFormatInGap(g)} />
                  ))}
                  {cropPositions.map((seg, i) => {
                    const gapAfter = uncovered.find(g => g.start_ms === seg.end_ms)
                    const broll = seg.crop_boxes.some(b => b.source_video_id)
                    const col = broll ? BROLL_COLOR : LAYOUT_COLORS[seg.layout]
                    const box = seg.crop_boxes[0]
                    const p = box ? getPositionAt(box.id, seg.start_ms) : { x: 0, w: 1, y: 0, h: 1 }
                    const isActiveSeg = seg.id === activeSegment?.id
                    const only = cropPositions.length === 1
                    const deleteLabel = only ? 'Reset this format to Vertical' : `Delete format ${i + 1} (its time goes back to default framing)`
                    return (
                      <Fragment key={seg.id}>
                      <div
                        role="button" tabIndex={0}
                        aria-current={isActiveSeg || undefined}
                        className="group flex items-center gap-2.5 px-2.5 py-2.5 rounded-lg cursor-pointer transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]"
                        style={{ background: isActiveSeg ? 'rgb(var(--ed-fg) / 0.07)' : undefined }}
                        onClick={() => { setActiveSegmentId(seg.id); seekToMs(seg.start_ms) }}
                        onKeyDown={e => { if (e.key === 'Enter') { setActiveSegmentId(seg.id); seekToMs(seg.start_ms) } }}>
                        <span className="w-5 text-[11px] font-semibold tabular-nums text-center shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.35)' }}>{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: col }} />
                            <span className="text-xs font-medium tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.85)' }}>{msToLabel(seg.start_ms)} – {msToLabel(seg.end_ms)}</span>
                            <span className="text-xs truncate" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>{broll ? 'B-roll' : LAYOUTS.find(l => l.id === seg.layout)?.label ?? seg.layout}</span>
                          </div>
                          {/* Where the crop sits horizontally in the source frame */}
                          <div className="relative h-1 rounded-full overflow-hidden mt-2" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }}>
                            <div className="absolute h-full rounded-full" style={{ left: `${p.x * 100}%`, width: `${p.w * 100}%`, background: col }} />
                          </div>
                        </div>
                        <button onClick={e => { e.stopPropagation(); handleDeleteFormat(seg.id) }}
                          aria-label={deleteLabel} title={`${deleteLabel} (Delete)`}
                          className={`shrink-0 w-7 h-7 flex items-center justify-center rounded-md transition-opacity hover:bg-[rgb(var(--ed-fg)/0.1)] ${isActiveSeg ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                          style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                          <TrashIcon />
                        </button>
                      </div>
                      {gapAfter && (
                        <GapRow gap={gapAfter} active={currentGap?.start_ms === gapAfter.start_ms}
                          onSelect={() => seekToMs(gapAfter.start_ms)} onAdd={() => addFormatInGap(gapAfter)} />
                      )}
                      </Fragment>
                    )
                  })}
                </div>
              </div>
            )}

            {tool === 'captions' && (
              isFreePlan ? (
                <div className="m-4 flex flex-col items-center gap-3 py-8 px-4 rounded-xl text-center"
                  style={{ background: 'rgb(var(--ed-fg) / 0.03)', border: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="5" y="11" width="14" height="10" rx="2" stroke="rgb(var(--ed-fg) / 0.6)" strokeWidth="1.8" />
                    <path d="M8 11V8a4 4 0 118 0v3" stroke="rgb(var(--ed-fg) / 0.6)" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-[var(--ed-text)]">Auto-captions are a paid feature</p>
                    <p className="text-xs mt-1" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Available on Starter and above.</p>
                  </div>
                  <a href="/pricing" className="px-4 py-2 rounded-lg text-xs font-bold" style={{ background: ACCENT, color: '#000' }}>See plans</a>
                </div>
              ) : editingTranscript ? (
                <TranscriptPanel words={displayWords} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms} currentTimeMs={currentTimeMs} onSeek={seekToMs} onWordChange={(id, text) => updateWord(id, text, romanize ? 'word_roman' : 'word')} />
              ) : (
                <div className="flex flex-col">
                  <div className="p-4 flex flex-col gap-3" style={{ borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
                    <SwitchRow label="Show captions" checked={showCaptions} onChange={setShowCaptions} />
                    {(transcribing || retranscribing) ? (
                      <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg" style={{ background: 'rgba(200,255,0,0.07)', border: '1px solid rgba(200,255,0,0.18)' }}>
                        <span className="w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin shrink-0" style={{ borderColor: ACCENT, borderTopColor: 'transparent' }} />
                        <p className="text-xs font-medium" style={{ color: 'var(--ed-accent-text)' }}>Generating captions… this can take a minute</p>
                      </div>
                    ) : words.length > 0 ? (
                      <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                        <span style={{ color: '#4ade80' }}>✓</span> {words.length} words transcribed
                      </p>
                    ) : (
                      <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>No captions for this clip yet.</p>
                    )}
                    {showCaptions && hasRoman && (
                      <SwitchRow label={scriptLabel} description="Show captions in English letters" checked={romanize} onChange={setRomanize} />
                    )}
                    {showCaptions && words.length > 0 && (
                      <button onClick={() => setEditingTranscript(true)}
                        className="flex items-center justify-center gap-2 w-full py-2 rounded-lg text-xs font-medium transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                        style={{ color: 'rgb(var(--ed-fg) / 0.85)', border: '1px solid rgb(var(--ed-fg) / 0.12)' }}>
                        <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M9.5 2L12 4.5M2 12l.7-2.8L10 1.5 12.5 4 4.8 11.3 2 12z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                        Edit caption text
                      </button>
                    )}
                  </div>
                  {showCaptions && (
                    <CaptionStyler
                      style={captionStyle} textCase={captionTextCase}
                      onChange={updateCaptionStyle}
                      onTextCaseChange={setCaptionTextCase}
                      onEditCaptions={() => setEditingTranscript(true)}
                      onRetranscribe={handleRetranscribe}
                      retranscribing={retranscribing} retranscribeElapsed={retranscribeElapsed}
                      retranscribeError={retranscribeError} hasWords={words.length > 0}
                      hasRoman={hasRoman} romanize={romanize} romanizeLabel={scriptLabel}
                      onRomanizeChange={setRomanize}
                    />
                  )}
                </div>
              )
            )}

            {tool === 'text' && (
              <TextOverlayPanel
                overlays={textOverlays}
                currentTimeMs={currentTimeMs}
                clipDurationMs={clip.end_ms - clip.start_ms}
                onAdd={o => setTextOverlays(prev => [...prev, { ...o, id: crypto.randomUUID(), clip_id: clip.id }])}
                onUpdate={updateTextOverlay}
                onRemove={deleteTextOverlay}
              />
            )}

            {tool === 'media' && (
              <div className="p-4 flex flex-col gap-5">
                <button onClick={() => { pause(); setPickerAtMs(currentTimeMs) }}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90"
                  style={{ background: ACCENT, color: '#000' }}>
                  + Add at {msToLabel(currentTimeMs)}
                </button>
                <p className="text-xs -mt-3 leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                  B-roll replaces the main video for 5 seconds. Images stay on screen until the end of the current format.
                </p>

                <MediaList
                  title="B-roll"
                  empty="No B-roll yet."
                  items={brollSegments.map(seg => ({
                    id: seg.id, start: seg.start_ms, end: seg.end_ms, color: BROLL_COLOR,
                    onSelect: () => { setActiveSegmentId(seg.id); seekToMs(seg.start_ms) },
                    // Back to the main video at this format's own point in it (render.py trims from source_offset_ms)
                    onRemove: () => seg.crop_boxes.forEach(b => { if (b.source_video_id) updateBoxSource(seg.id, b.id, null, seg.start_ms) }),
                  }))}
                />
                <MediaList
                  title="Images"
                  empty="No images yet."
                  items={imageOverlays.map(ov => ({
                    id: ov.id, start: ov.start_ms, end: ov.end_ms, color: 'rgb(var(--ed-fg) / 0.6)',
                    thumb: ov.preview_url,
                    onSelect: () => { setActiveOverlayId(ov.id); seekToMs(ov.start_ms) },
                    onRemove: () => deleteOverlay(ov.id),
                  }))}
                />
              </div>
            )}
          </div>
          </div>
        </aside>

        {/* Canvas + transport + timeline */}
        <main className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Canvas toolbar: formats, centred */}
          <div className="shrink-0 flex items-center justify-center gap-3 px-4" style={{ minHeight: 52, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <div role="radiogroup" aria-label="Format" className="flex items-center gap-1 p-1 rounded-xl shrink-0"
              style={{ background: 'rgb(var(--ed-fg) / 0.04)', border: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
              {LAYOUTS.map(l => {
                const on = activeSegment?.layout === l.id
                // Shortcut theme: lime when selected, neutral otherwise (like the preview toggle)
                const color = on ? 'var(--ed-accent-text)' : 'rgb(var(--ed-fg) / 0.45)'
                return (
                  <button key={l.id} role="radio" aria-checked={on} onClick={() => handleLayoutChange(l.id)}
                    title={`${l.label} format`}
                    className={`flex items-center gap-2 h-8 pl-2.5 pr-3 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${on ? '' : 'hover:text-[rgb(var(--ed-fg)/0.8)]'}`}
                    style={on
                      ? { background: 'rgb(var(--ed-fg) / 0.12)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }
                      : { color: 'rgb(var(--ed-fg) / 0.5)' }}>
                    <LayoutGlyph layout={l.id} color={color} active={on} />
                    {l.label}
                  </button>
                )
              })}
            </div>

            <div className="w-px h-6 shrink-0" style={{ background: 'rgb(var(--ed-fg) / 0.1)' }} />

            <button
              onClick={() => setMotionMode(m => !m)}
              aria-pressed={motionMode}
              title={motionMode ? 'Motion is on: drag the crop while the video plays to record movement' : 'Turn on to make the crop follow movement: drag it while the video plays'}
              className={`flex items-center gap-2 h-8 px-3 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors select-none ${motionMode ? '' : 'hover:bg-[rgb(var(--ed-fg)/0.05)]'}`}
              style={{
                background: motionMode ? 'rgba(239,68,68,0.15)' : 'rgb(var(--ed-fg) / 0.04)',
                color: motionMode ? '#fca5a5' : 'rgb(var(--ed-fg) / 0.62)',
                boxShadow: motionMode ? 'inset 0 0 0 1px rgba(239,68,68,0.5)' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.07)',
              }}
            >
              <span style={{
                display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                background: motionMode ? '#ef4444' : 'rgb(var(--ed-fg) / 0.3)',
                boxShadow: motionMode ? '0 0 6px #ef4444' : 'none',
              }} />
              Motion
            </button>
          </div>

          <div className="relative flex-1 min-h-0" style={{ background: 'var(--ed-canvas)' }}>
            <div className="absolute flex flex-col rounded-xl overflow-hidden" style={{ inset: 8, border: '1px solid rgb(var(--ed-fg) / 0.1)' }}>
              <VideoPreview
                videoRef={videoRef} videoUrl={clipVideoUrl} currentTimeMs={currentTimeMs}
                activeSegment={viewSegment} getPositionAt={viewGetPositionAt}
                activeBoxId={activeBoxId ?? null}
                onSelectBox={(segId, boxId) => { setActiveSegmentId(segId); setActiveBoxId(boxId) }}
                onBoxChange={handleBoxChange}
              />
              {activeSegment?.crop_boxes[0]?.source_video_id && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold pointer-events-none"
                  style={{ background: 'rgba(249,115,22,0.85)', color: '#fff' }}>B-roll</div>
              )}
            </div>
          </div>

          {/* Transport */}
          <div className="shrink-0 grid items-center px-4" style={{ gridTemplateColumns: '1fr auto 1fr', height: 52, borderTop: '1px solid rgb(var(--ed-fg) / 0.06)', background: 'var(--ed-panel)' }}>
            <div />
            <div className="flex items-center gap-3">
              <button onClick={() => seekToMs(Math.max(0, currentTimeMs - 5000))} aria-label="Back 5 seconds" title="Back 5 seconds (Shift + ←)"
                className="w-9 h-9 flex items-center justify-center rounded-full transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]" style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>
                <SkipFiveIcon dir="back" />
              </button>
              <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title={`${playing ? 'Pause' : 'Play'} (Space)`}
                className="w-10 h-10 flex items-center justify-center rounded-full shrink-0 transition-opacity hover:opacity-90" style={{ background: ACCENT }}>
                {playing
                  ? <svg width="12" height="12" viewBox="0 0 12 12" fill="black"><rect x="2" y="1.5" width="3" height="9" rx="1"/><rect x="7" y="1.5" width="3" height="9" rx="1"/></svg>
                  : <svg width="12" height="12" viewBox="0 0 12 12" fill="black"><path d="M3 1.5l7.5 4.5L3 10.5V1.5z"/></svg>
                }
              </button>
              <button onClick={() => seekToMs(Math.min(clipDurationMs, currentTimeMs + 5000))} aria-label="Forward 5 seconds" title="Forward 5 seconds (Shift + →)"
                className="w-9 h-9 flex items-center justify-center rounded-full transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]" style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>
                <SkipFiveIcon dir="forward" />
              </button>
            </div>
            <span className="justify-self-end text-xs tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>
              {msToTenths(currentTimeMs)}<span style={{ color: 'rgb(var(--ed-fg) / 0.25)' }}> / </span>{msToLabel(clipDurationMs)}
            </span>
          </div>

          {/* Timeline */}
          <div className="shrink-0 overflow-y-auto px-4 pt-3 pb-4" style={{ maxHeight: '38vh', background: 'var(--ed-track)', borderTop: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <SegmentTimeline
              segments={segments} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
              currentTimeMs={currentTimeMs} activeSegmentId={activeSegment?.id ?? null}
              videoUrl={videoUrl} safeDurationMs={clipDurationMs} onSeek={seekToMs}
              onSelectSegment={id => setActiveSegmentId(id)}
              onUpdateSegment={(id, updates) => updateSegment(id, updates)}
              onSetEdge={(id, edge, t) => setSegmentEdge(id, edge, t, clipLengthMs)}
              onMoveJunction={moveJunction}
              onInsertBrollAfter={handleInsertBrollAfterSeg}
              textOverlays={textOverlays} activeTextOverlayId={activeTextOverlayId}
              onSelectTextOverlay={id => { setActiveTextOverlayId(id); if (id) { setTool('text'); toggleOptions(true) } }}
              onTextOverlayUpdate={updateTextOverlay}
            />
          </div>
        </main>

        {/* Right column: 9:16 output preview, always visible */}
        <aside className="shrink-0 flex flex-col min-h-0" style={{ width: 360, background: 'var(--ed-panel)', borderLeft: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
          <div className="shrink-0 px-4 flex items-center justify-between" style={{ height: 48, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <span className="text-sm font-semibold text-[var(--ed-text)]">Preview</span>
            <div className="flex items-center gap-1.5">
              {rendering ? (
                <span className="flex items-center gap-2 h-8 px-3 rounded-lg text-xs font-semibold"
                  style={{ background: 'rgba(200,255,0,0.12)', color: 'var(--ed-accent-text)', boxShadow: 'inset 0 0 0 1px rgba(200,255,0,0.3)' }}>
                  <span className="w-3 h-3 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--ed-accent-text)', borderTopColor: 'transparent' }} />
                  {exporting ? 'Starting…' : `Rendering ${formatElapsed(renderElapsed)}`}
                </span>
              ) : hasOutput ? (
                <>
                  <button onClick={() => handleExport(true)} aria-label="Re-render"
                    title="Render again with your latest edits. Captions are regenerated too."
                    className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                    style={{ color: 'rgb(var(--ed-fg) / 0.75)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.14)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
                    </svg>
                  </button>
                  <a href={outputUrl!} download="export.mp4" target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold transition-opacity hover:opacity-90"
                    style={{ background: ACCENT, color: '#000' }}>
                    <DownloadIcon /> Download
                  </a>
                </>
              ) : (
                <button onClick={() => handleExport()}
                  title="Render the reel so you can download it"
                  className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold transition-opacity hover:opacity-90"
                  style={{ background: ACCENT, color: '#000' }}>
                  <DownloadIcon /> Export
                </button>
              )}
            </div>
          </div>

          {/* How the reel looks inside each app */}
          <div className="shrink-0 px-4 pt-3">
            <div role="radiogroup" aria-label="Show preview as" className="grid grid-cols-3 gap-1 p-1 rounded-xl"
              style={{ background: 'rgb(var(--ed-fg) / 0.04)', border: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
              {PLATFORM_OPTIONS.map(({ id, label, icon }) => {
                const on = platform === id
                return (
                  <button key={id} role="radio" aria-checked={on} onClick={() => setPlatform(id)}
                    title={id === 'off' ? 'Plain preview' : `See how it looks on ${PLATFORM_SAFE[id].name}`}
                    className="flex items-center justify-center gap-1.5 h-8 rounded-lg text-xs font-medium transition-colors"
                    style={on
                      ? { background: 'rgb(var(--ed-fg) / 0.12)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }
                      : { color: 'rgb(var(--ed-fg) / 0.5)' }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                      style={{ color: on && id !== 'off' ? 'var(--ed-accent-text)' : undefined }}>
                      {icon}
                    </svg>
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Preview fills the column: as wide as it can be while the full 9:16 frame fits the height */}
          <div className="flex-1 min-h-0 flex items-start justify-center p-4 overflow-hidden">
            <div style={{ width: 'min(100%, calc((100vh - 200px) * 9 / 16))' }}>
              <div className="relative">
              {rendering ? (
                <div className="flex flex-col items-center justify-center gap-4 rounded-xl" style={{ aspectRatio: '9/16', background: 'var(--ed-app)', border: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
                  <span className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: ACCENT, borderTopColor: 'transparent' }} />
                  <div className="text-center flex flex-col gap-1 px-6">
                    <p className="text-sm font-semibold text-[var(--ed-text)]">Rendering your reel…</p>
                    <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Usually takes a minute or two. You can keep editing.</p>
                    {renderElapsed > 0 && <p className="text-xs tabular-nums mt-1" style={{ color: 'rgba(200,255,0,0.75)' }}>{formatElapsed(renderElapsed)}</p>}
                  </div>
                  {clipStatus === 'rendering' && renderElapsed > 180 && (
                    <button onClick={handleResetStuckRender}
                      className="text-xs px-4 py-1.5 rounded-lg"
                      style={{ color: '#f87171', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                      Taking too long? Cancel render
                    </button>
                  )}
                </div>
              ) : (
                <OutputCanvas
                  videoRef={videoRef} currentTimeMs={currentTimeMs} clipStartMs={clip.start_ms}
                  activeSegment={viewSegment} getPositionAt={viewGetPositionAt}
                  skipTransitionRef={skipCanvasTransitionRef} words={displayWords}
                  captionStyle={captionStyle} captionTextCase={captionTextCase} showCaptions={showCaptions}
                  overlays={overlays} activeOverlayId={activeOverlayId}
                  onOverlayChange={updateOverlay} onSelectOverlay={setActiveOverlayId} onDeleteOverlay={deleteOverlay}
                  textOverlays={textOverlays} activeTextOverlayId={activeTextOverlayId}
                  onTextOverlayChange={updateTextOverlay} onSelectTextOverlay={setActiveTextOverlayId} onDeleteTextOverlay={deleteTextOverlay}
                  onCaptionPositionChange={y => updateCaptionStyle({ position_y: y })}
                  style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10, border: '1px solid rgb(var(--ed-fg) / 0.1)', boxShadow: '0 4px 24px rgba(0,0,0,0.6)' }}
                />
              )}
              {!rendering && <PlatformOverlay platform={platform} />}
              </div>
            </div>
          </div>

        </aside>
      </div>

      {pickerAtMs !== null && (
        <MediaPickerModal clipId={clip.id} atMs={pickerAtMs}
          onInsertVideo={handleInsertBroll} onInsertImage={handleInsertImage}
          onClose={() => setPickerAtMs(null)} />
      )}
    </div>
  )
}

// ── Small UI pieces ───────────────────────────────────────────────────────────

function GapRow({ gap, active, onSelect, onAdd }: {
  gap: { start_ms: number; end_ms: number }
  active: boolean
  onSelect: () => void
  onAdd: () => void
}) {
  return (
    <div role="button" tabIndex={0} onClick={onSelect} onKeyDown={e => { if (e.key === 'Enter') onSelect() }}
      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]"
      style={{ background: active ? 'rgb(var(--ed-fg) / 0.05)' : undefined, border: '1px dashed rgb(var(--ed-fg) / 0.12)' }}>
      <span className="w-5 shrink-0" />
      <span className="w-2 h-2 rounded-full shrink-0" style={{ border: '1.5px dashed rgb(var(--ed-fg) / 0.5)' }} />
      <span className="text-xs tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>{msToLabel(gap.start_ms)} – {msToLabel(gap.end_ms)}</span>
      <span className="text-xs flex-1 truncate" style={{ color: 'rgb(var(--ed-fg) / 0.35)' }}>Default framing</span>
      <button onClick={e => { e.stopPropagation(); onAdd() }} title="Add a format here"
        className="shrink-0 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors hover:bg-[rgb(var(--ed-fg)/0.15)]"
        style={{ color: 'var(--ed-accent-text)', background: 'rgba(200,255,0,0.12)' }}>
        + Add
      </button>
    </div>
  )
}

/** Circular arrow with a 5 inside: jump 5 seconds back or forward */
function SkipFiveIcon({ dir }: { dir: 'back' | 'forward' }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"
      style={dir === 'forward' ? { transform: 'scaleX(-1)' } : undefined}>
      <path d="M4.5 12a7.5 7.5 0 107.5-7.5H8.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10.5 2L8 4.5 10.5 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <text x="12" y="15.6" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="currentColor"
        style={dir === 'forward' ? { transform: 'scaleX(-1)', transformOrigin: '12px 12px' } : undefined}>5</text>
    </svg>
  )
}

/** Tiny 9:16 frame showing how a format divides the reel */
function LayoutGlyph({ layout, color, active }: { layout: LayoutType; color: string; active: boolean }) {
  const fill = color
  return (
    <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true" className="shrink-0">
      <rect x="0.75" y="0.75" width="10.5" height="16.5" rx="2" fill="none" stroke={fill} strokeWidth="1.5" />
      {layout === 'vertical' && <rect x="2.5" y="2.5" width="7" height="13" rx="1" fill={fill} opacity="0.55" />}
      {layout === 'split' && <><rect x="2.5" y="2.5" width="7" height="5.6" rx="1" fill={fill} opacity="0.55" /><rect x="2.5" y="9.9" width="7" height="5.6" rx="1" fill={fill} opacity="0.55" /></>}
      {layout === 'trio' && <><rect x="2.5" y="2.5" width="7" height="3.7" rx="0.8" fill={fill} opacity="0.55" /><rect x="2.5" y="7.15" width="7" height="3.7" rx="0.8" fill={fill} opacity="0.55" /><rect x="2.5" y="11.8" width="7" height="3.7" rx="0.8" fill={fill} opacity="0.55" /></>}
      {layout === 'horizontal' && <rect x="2.5" y="6.5" width="7" height="5" rx="1" fill={fill} opacity="0.55" />}
    </svg>
  )
}

function BreadcrumbChevron() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="shrink-0">
      <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="rgb(var(--ed-fg) / 0.3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Save status chip next to the breadcrumb */
function SaveIndicator({ state, leaving, onRetry }: { state: SaveState; leaving?: boolean; onRetry: () => void }) {
  const chip = 'flex items-center gap-1.5 shrink-0 h-6 px-2 rounded-full text-[11px] font-medium'
  if (state === 'error') {
    return (
      <span role="alert" className={chip} style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.12)' }}>
        Couldn&apos;t save · <button onClick={onRetry} className="underline hover:opacity-80">Retry</button>
      </span>
    )
  }
  if (state === 'saving') {
    return (
      <span className={chip} style={{ color: 'rgb(var(--ed-fg) / 0.55)', background: 'rgb(var(--ed-fg) / 0.05)' }} aria-live="polite">
        <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-t-transparent animate-spin" style={{ borderColor: 'rgb(var(--ed-fg) / 0.55)', borderTopColor: 'transparent' }} />
        {leaving ? 'Saving and leaving…' : 'Saving…'}
      </span>
    )
  }
  return (
    <span className={chip} style={{ color: 'rgb(var(--ed-fg) / 0.45)' }} aria-live="polite">
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 6.5l2.2 2.2L9.5 3.8" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      Saved
    </span>
  )
}

function SwitchRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--ed-text)]">{label}</p>
        {description && <p className="text-xs mt-0.5" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>{description}</p>}
      </div>
      <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
        className="relative shrink-0 rounded-full transition-colors"
        style={{ width: 40, height: 22, background: checked ? ACCENT : 'rgb(var(--ed-fg) / 0.15)' }}>
        <span className="absolute rounded-full bg-white transition-all"
          style={{ top: 3, left: checked ? 21 : 3, width: 16, height: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
      </button>
    </div>
  )
}

function StatusChip({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {children}
    </span>
  )
}

function MediaList({ title, empty, items }: {
  title: string
  empty: string
  items: { id: string; start: number; end: number; color: string; thumb?: string; onSelect: () => void; onRemove: () => void }[]
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{title}</p>
      {items.length === 0 ? (
        <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.3)' }}>{empty}</p>
      ) : items.map(item => (
        <div key={item.id} role="button" tabIndex={0} onClick={item.onSelect}
          onKeyDown={e => { if (e.key === 'Enter') item.onSelect() }}
          className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]">
          {item.thumb
            ? <img src={item.thumb} alt="" className="w-8 h-8 rounded object-cover shrink-0" />
            : <span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.color }} />}
          <span className="flex-1 text-xs tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.8)' }}>{msToLabel(item.start)} – {msToLabel(item.end)}</span>
          <button onClick={e => { e.stopPropagation(); item.onRemove() }} aria-label={`Remove ${title.toLowerCase()} item`} title="Remove"
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity hover:bg-[rgb(var(--ed-fg)/0.1)]"
            style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  )
}

function SidebarIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 4v16" stroke="currentColor" strokeWidth="1.8" />
      <path d={open ? 'M16 10l-2 2 2 2' : 'M14 10l2 2-2 2'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function DownloadIcon() {
  return <svg width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true"><path d="M7.5 2v8M4 7l3.5 3.5L11 7M2 13h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

function TrashIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 3h8M5 3V2h2v1M4.5 3v6M7.5 3v6M3 3l.5 7h5L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

function msToTenths(ms: number) {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const s = Math.floor(tenths / 10)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`
}

function formatElapsed(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
