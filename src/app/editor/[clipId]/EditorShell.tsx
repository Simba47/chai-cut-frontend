'use client'

import { InfoTip } from '@/components/ui/info-tip'
import { musicGainAt, speechRangesInVideo, speechRanges, heardSpeech, type Range as SpeechRange } from '@/modules/editor/musicGain'
import { useState, useEffect, useLayoutEffect, useRef, useMemo, Fragment } from 'react'
import type { Clip, Segment, CropBox, BoxKeyframe, CaptionStyle, TextOverlay, AudioTrack, Transition, TranscriptWord, LayoutType, Overlay } from '@chai-cut/shared'
import { VideoPreview, OutputCanvas } from '@/components/editor/VideoPreview'
import { computeCutRanges, reactionRanges, removedMs, withoutRanges } from '@/lib/cuts'
import { cleanTrims, trimMap, addTrim, wordsOnTimeline, MAX_CLIP_MS, MIN_CLIP_MS } from '@/lib/trims'
import { toTimelineState, toSourceState, rippleDelete, lockedInRange, insertAtStart, extendEnd, type TimedState } from '@/modules/editor/trimState'
import { PostText, type PostTextValue } from '@/components/clips/PostText'
import { BrollPanel, type StockResult } from '@/components/editor/BrollPanel'
import { useBrollSources, useBorrowedSlots } from '@/modules/editor/brollSources'
import { SegmentTimeline, LAYOUT_COLORS, MAX_ZOOM, zoomStep, zoomLabel } from '@/components/editor/SegmentTimeline'
import { TranscriptPanel } from '@/components/editor/TranscriptPanel'
import { CaptionStyler } from '@/components/editor/CaptionStyler'
import { TextOverlayPanel } from '@/components/editor/TextOverlayPanel'
import { PhotoPanel } from '@/components/editor/PhotoPanel'
import { AudioMixerPanel } from '@/components/editor/AudioMixerPanel'
import { MediaPickerModal } from '@/components/editor/MediaPickerModal'
import { shownSegment, addedVideoBox, STAND_IN_SUFFIX } from '@/modules/editor/visibility'
import { AccountMenu } from '@/components/ui/account-menu'
import { BrandLogo } from '@/components/ui/brand-logo'
import { BrandLoader } from '@/components/ui/brand-loader'
import { SpinningBorderButton } from '@/components/ui/spinning-border-button'
import { FramesPanel } from '@/components/editor/FramesPanel'
import { FrameTextPanel } from '@/components/editor/FrameTextPanel'
import { useConfirm } from '@/components/editor/ConfirmDialog'
import { EditorTour, hasSeenEditorTour } from '@/components/editor/EditorTour'
import { FrameAddMenu, type AddChoice } from '@/components/editor/FrameAddMenu'
import { createFrameMediaPool } from '@/modules/editor/frameMedia'
import { FRAME_TEMPLATES, isFrameLayout, frameOf, mainAudioVolume, frameLanes, frameSlotLabels, emptySlotStretches, slotOffers, DEFAULT_BAND, DEFAULT_CORNERS } from '@/modules/editor/frames'
import { signOut } from 'next-auth/react'
import { PlatformOverlay, PLATFORM_SAFE, type Platform } from '@/components/editor/PlatformOverlay'
// ── Domain stores ──────────────────────────────────────────────────────────────
import { useEditorStore, type KeyframeMap } from '@/modules/editor/store'
import { startHistory, undo, redo, useHistory, editableSnapshot, sameEditable, type EditableSnapshot } from '@/modules/editor/history'
import { usePlayerStore } from '@/modules/player/store'
import { useVideoSync } from '@/modules/player/useSync'
import { useCaptionStore } from '@/modules/captions/store'
import { useMediaStore } from '@/modules/media/store'
import { rowsToLocal, normalizeCoverage, uncoveredRanges, defaultCropForSlot, msToLabel } from '@/modules/editor/utils'
import { isShot, flattenShots, toSaved, restoreLayers } from '@/modules/editor/shots'
import { viewChanges } from '@/modules/editor/views'
import type { SegmentLocal, FrameLayout, FrameLane, FrameItem } from '@chai-cut/shared'

type Tool = 'format' | 'frames' | 'captions' | 'text' | 'broll' | 'photos' | 'music' | 'cleanup' | 'post'
type SaveState = 'idle' | 'saving' | 'saved' | 'error' | 'retrying'

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
  /** Playable links for stored songs, by track id (songs saved before uploads existed have none) */
  initialMusicUrls?: Record<string, string>
  /** The clip's own sound as saved (top of the Music panel) */
  initialOriginalSound?: { volume: number; muted: boolean }
  initialTransitions: Transition[]
  initialOverlays: Overlay[]
}

const LAYOUTS: { id: LayoutType; label: string }[] = [
  { id: 'vertical', label: 'Vertical' }, { id: 'split', label: 'Split screen' },
  { id: 'trio', label: 'Trio' }, { id: 'horizontal', label: 'Horizontal' },
]
// Stand-in format for time no format covers: centred Vertical, the same default render.py uses
const PLATFORM_OPTIONS: { id: Platform; label: string; icon: React.ReactNode }[] = [
  { id: 'off', label: 'Off', icon: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10 18.5h4" /></> },
  { id: 'instagram', label: 'Instagram', icon: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17.5 6.5h.01" /></> },
  { id: 'youtube', label: 'YouTube', icon: <><rect x="2.5" y="5" width="19" height="14" rx="4" /><path d="M10 9.2v5.6l4.8-2.8z" fill="currentColor" /></> },
]
// Options sidebar width (px)
const OPTIONS_W = 272
const PREVIEW_W = 360
// How wide the side columns can be dragged
const OPTIONS_RANGE: [number, number] = [220, 520]
const PREVIEW_RANGE: [number, number] = [260, 620]
const DEFAULT_SEG_ID = '__default-format'
const DEFAULT_BOX_ID = '__default-box'
const ACCENT = '#c8ff00'

const TOOLS: { id: Tool; label: string; title: string; hint: string; icon: React.ReactNode }[] = [
  {
    id: 'format', label: 'Format', title: 'Formats',
    hint: 'Pick a layout and it starts at the playhead. Drag the view to reframe — each change is a ◆.',
    icon: <path d="M6 2v14a2 2 0 002 2h14M2 6h14a2 2 0 012 2v14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" />,
  },
  {
    id: 'frames', label: 'Frames', title: 'Frames',
    hint: 'Combine videos, photos and a text letterbox in one reel. Pick a frame for the selected format.',
    icon: <><rect x="6" y="2.5" width="12" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M6 9.5h12M6 14.5h12" stroke="currentColor" strokeWidth="1.8" fill="none" /></>,
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
    id: 'broll', label: 'B-roll', title: 'B-roll',
    hint: 'Short stock shots over the clip while the speaker keeps talking. Pick one, then add it at the playhead.',
    icon: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M10 9.5v5l4.5-2.5z" fill="currentColor" /></>,
  },
  {
    id: 'photos', label: 'Photos', title: 'Photos',
    hint: 'Photos on top of the clip. Pick one here, on the Photos lane of the timeline or on the preview to change its size, place and timing.',
    icon: <><rect x="3" y="3" width="18" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.8" fill="none" /><circle cx="8.5" cy="8.5" r="1.6" stroke="currentColor" strokeWidth="1.6" fill="none" /><path d="M21 15l-5-5L5 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>,
  },
  {
    id: 'music', label: 'Music', title: 'Music',
    hint: 'Add background music under your clip and set how loud it is. It gets quieter by itself while someone is talking.',
    icon: <><path d="M9 18V5l12-2v13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" fill="none" /><circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" /><circle cx="18" cy="16" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" /></>,
  },
  {
    id: 'cleanup', label: 'Cleanup', title: 'Remove pauses & filler words',
    hint: 'Cuts long pauses and filler words (um, uh, matlab, ante…) out of the export. Laughs and reaction moments (splits, trios) are kept. The preview plays the full clip.',
    icon: <><circle cx="6" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.8" fill="none" /><circle cx="6" cy="18" r="2.6" stroke="currentColor" strokeWidth="1.8" fill="none" /><path d="M8.2 7.6L20 17M8.2 16.4L20 7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" /></>,
  },
  {
    id: 'post', label: 'Post', title: 'Post text',
    hint: 'A title, caption and hashtags to post the clip with. Copy them, or have AI write them again.',
    icon: <path d="M9 4L7 20M17 4l-2 16M4.5 9h16M3.5 15h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />,
  },
]

export function EditorShell({
  clip: savedClip, videoUrl, words: initialWords, initialSegments,
  initialCaptionStyles, initialTextOverlays, initialAudioTracks, initialTransitions, initialOverlays,
  initialMusicUrls, initialOriginalSound,
}: Props) {
  // ── Removed parts of the video (lib/trims.ts, modules/editor/trimState.ts) ───
  // The editor works on the clip as it plays. `rawClip` is the clip's stretch of the source video
  // (as saved, or as its start / end was dragged since: clipRange). `clip` is that with the removed
  // parts closed up — it ends where what's left ends, and every time below is timeline time.
  // Nothing removed: the two are the same.
  const trims = useEditorStore(s => s.trims)
  const clipRange = useEditorStore(s => s.clipRange)
  const rawClip = useMemo(
    () => (clipRange ? { ...savedClip, start_ms: clipRange[0], end_ms: clipRange[1] } : savedClip),
    [savedClip, clipRange],
  )
  const trim = useMemo(() => trimMap(trims, rawClip.start_ms, rawClip.end_ms), [trims, rawClip.start_ms, rawClip.end_ms])
  const trimmed = trims.length > 0
  const clip = useMemo(() => (trimmed ? { ...rawClip, end_ms: rawClip.start_ms + trim.lengthMs } : rawClip), [rawClip, trimmed, trim.lengthMs])
  /** The main video's own time (ms) → timeline time; undefined while nothing is removed */
  const videoToTimeline = trimmed ? trim.toTimeline : undefined
  /** Whether this database can save removed parts yet (its backend adds the field when it starts) */
  const canTrim = 'trim_ranges' in (rawClip as object)

  // ── Video player ─────────────────────────────────────────────────────────────
  const { videoRef, seekToMs, togglePlay, pause } = useVideoSync(rawClip.start_ms, rawClip.end_ms, undefined, trimmed ? trim.kept : undefined)
  const { currentTimeMs, durationMs, playing } = usePlayerStore()
  // Append media fragment so browser seeks to clip start at network level,
  // preventing a flash of the video's frame 0 on page load / cache hit.
  const clipVideoUrl = videoUrl && savedClip.start_ms > 0
    ? `${videoUrl}#t=${savedClip.start_ms / 1000}`
    : videoUrl

  // ── Domain stores ────────────────────────────────────────────────────────────
  const {
    segments, keyframes, activeSegmentId, activeBoxId,
    hydrate: hydrateEditor, updateSegment, removeSegment,
    splitAtMs, updateBoxSource, applyLayout, setSegmentEdge, addFormat, moveJunction, absorbSection,
    neighbourFraming, joinSameLayoutNeighbours, setViewAt, recordMotionAt, removeViewChange, moveViewChange,
    placeBroll, retimeBroll: retimeShot, removeBroll: removeBrollShot, duplicateViewChange,
    upsertKeyframe, setBoxKeyframes, getPositionAt, updateFrameBand,
    updateFrame, addFrameItem, updateFrameItem, removeFrameItem,
    setActiveSegmentId, setActiveBoxId,
  } = useEditorStore()

  const {
    words: sourceWords, captionStyle, captionTextCase, showCaptions, romanize,
    retranscribing, retranscribeElapsed, retranscribeError,
    hydrate: hydrateCaptions, setWords, updateWord, updateCaptionStyle,
    setCaptionTextCase, setShowCaptions, setRomanize,
    setRetranscribing, setRetranscribeElapsed, setRetranscribeError,
  } = useCaptionStore()

  // Words where they are heard in the clip as it plays (those in removed parts are left out)
  const words = useMemo(
    () => (trimmed ? wordsOnTimeline(sourceWords, trim, rawClip.start_ms, rawClip.end_ms) : sourceWords),
    [sourceWords, trimmed, trim, rawClip.start_ms, rawClip.end_ms],
  )

  const {
    overlays, textOverlays, audioTracks, transitions, filters, activeOverlayId,
    hydrate: hydrateMedia, setOverlays, setTextOverlays, setAudioTracks, setTransitions,
    setActiveOverlayId, updateOverlay, deleteOverlay,
    updateTextOverlay, deleteTextOverlay,
  } = useMediaStore()

  // Loading the clip changes the stores but isn't an edit: remember the loaded state, and only
  // start auto-saving once the state differs from it (opening a clip must not write anything)
  const loadedStateRef = useRef<EditableSnapshot | null>(null)
  const editedSinceLoadRef = useRef(false)

  // ── Hydrate stores from server props (once on mount) ─────────────────────────
  useEffect(() => {
    // Saved as one row of parts, a video on top (B-roll) cutting the section under it: here the
    // sections are whole again and the videos lie over them (shots.ts)
    const lenMs = savedClip.end_ms - savedClip.start_ms
    const ownVideoId = (savedClip as unknown as { video_id: string }).video_id
    const restored = restoreLayers(rowsToLocal(initialSegments), (savedClip as unknown as { layers?: unknown }).layers, ownVideoId)
    const localSegments = [
      ...normalizeCoverage(restored.segments.filter(s => !isShot(s, ownVideoId)), lenMs),
      ...restored.segments.filter(s => isShot(s, ownVideoId)).map(s => ({ ...s, end_ms: Math.min(s.end_ms, lenMs) })).filter(s => s.end_ms - s.start_ms >= 100),
    ].sort((a, b) => a.start_ms - b.start_ms)
    const initialKeyframeMap: KeyframeMap = {}
    for (const seg of localSegments) {
      for (const box of seg.crop_boxes) {
        const kfs = box.keyframes?.length ? box.keyframes : [{ t_ms: seg.start_ms, ...defaultCropForSlot(seg.layout as LayoutType, box.slot_index) }]
        initialKeyframeMap[box.id] = kfs.map(k => ({ id: (k as { id?: string }).id ?? crypto.randomUUID(), box_id: box.id, t_ms: k.t_ms, x: k.x, y: k.y, w: k.w, h: k.h })) as typeof initialKeyframeMap[string]
      }
    }
    // A transition after a part that was joined back into its section stays with that section
    const loadedTransitions = initialTransitions
      .map(t => (restored.renamed[t.after_segment_id] ? { ...t, after_segment_id: restored.renamed[t.after_segment_id] } : t))
      .filter((t, i, all) => all.findIndex(x => x.after_segment_id === t.after_segment_id) === i)
    // Saved in source clip time; shown with the removed parts closed up
    const savedTrims = cleanTrims((savedClip as unknown as { trim_ranges?: unknown }).trim_ranges, savedClip.start_ms, savedClip.end_ms)
    let loaded: TimedState = {
      segments: localSegments, keyframes: initialKeyframeMap,
      overlays: initialOverlays, textOverlays: initialTextOverlays, audioTracks: initialAudioTracks, transitions: loadedTransitions,
    }
    if (savedTrims.length) loaded = toTimelineState(loaded, trimMap(savedTrims, savedClip.start_ms, savedClip.end_ms), savedClip.start_ms)
    hydrateEditor(loaded.segments, loaded.keyframes, savedTrims, ownVideoId)

    // Captions on/off: the saved choice when the clip has a caption style; a clip without one yet
    // starts with captions on if it has words (a style saved before the on/off field counts as on)
    const savedStyle = initialCaptionStyles[0]
    // Off until switched on (captions cost money to make); a clip with a saved style keeps its choice
    const showCaptions = savedStyle ? savedStyle.enabled !== false : false
    hydrateCaptions(initialWords, savedStyle ?? { color: '#FFE700' }, showCaptions)

    hydrateMedia({
      overlays: loaded.overlays,
      textOverlays: loaded.textOverlays,
      audioTracks: loaded.audioTracks,
      transitions: loaded.transitions,
    })

    // The clip as loaded: the auto-save stays quiet until the state differs from this
    loadedStateRef.current = editableSnapshot()

    // Undo/redo records from here on: the loaded clip is the starting point
    const stopHistory = startHistory()
    return () => { stopHistory(); useEditorStore.getState().reset() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Local UI state (not shared across components) ─────────────────────────────
  const [activeTextOverlayId, setActiveTextOverlayId] = useState<string | null>(null)
  const videoStatus = (clip as unknown as { video_status?: string }).video_status
  // Captions are on their way while a caption job for this video is waiting/running (e.g. the
  // whole-video job right after upload) and this clip doesn't have its words yet
  const captionsPending = !!(clip as unknown as { captions_pending?: boolean }).captions_pending
  // (lists from the server are in the video's own time: the saved clip's stretch)
  const clipHasWords = (list: { start_ms: number }[]) => list.some(w => w.start_ms >= rawClip.start_ms && w.start_ms < rawClip.end_ms)
  const [transcribing, setTranscribing] = useState(
    !clipHasWords(initialWords) && (captionsPending || (videoStatus !== 'ready' && videoStatus !== 'failed'))
  )
  const [isFreePlan, setIsFreePlan] = useState(false)
  const [tool, setTool] = useState<Tool>('format')
  const [optionsOpen, setOptionsOpen] = useState(true)
  // The Preview column on the right: closed for more room to edit (remembered per browser)
  const [previewOpen, setPreviewOpen] = useState(true)
  // Widths of the two side columns, dragged at their inner edge (remembered per browser)
  const [optionsW, setOptionsW] = useState(OPTIONS_W)
  const [previewW, setPreviewW] = useState(PREVIEW_W)
  const [resizing, setResizing] = useState<'options' | 'preview' | 'timeline' | null>(null)
  // The timeline's height, dragged at the line above the play bar (null = its usual size); remembered per browser
  const [timelineH, setTimelineH] = useState<number | null>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    try { const h = Number(localStorage.getItem('editor.timelineH')); if (h) setTimelineH(h) } catch { /* storage blocked */ }
  }, [])
  /** Drag the line between the video and the play bar: up makes the timeline taller, down the video bigger */
  function startTimelineResize(e: React.PointerEvent) {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const y0 = e.clientY
    const h0 = timelineRef.current?.offsetHeight ?? 220
    const max = Math.round(window.innerHeight * 0.7)
    let h = h0
    setResizing('timeline')
    const move = (ev: PointerEvent) => { h = Math.round(Math.max(90, Math.min(max, h0 + (y0 - ev.clientY)))); setTimelineH(h) }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setResizing(null)
      try { localStorage.setItem('editor.timelineH', String(h)) } catch { /* storage blocked */ }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function resetTimelineHeight() {
    setTimelineH(null)
    try { localStorage.removeItem('editor.timelineH') } catch { /* storage blocked */ }
  }
  useEffect(() => {
    try {
      const o = Number(localStorage.getItem('editor.optionsW')), pv = Number(localStorage.getItem('editor.previewW'))
      if (o) setOptionsW(Math.max(OPTIONS_RANGE[0], Math.min(OPTIONS_RANGE[1], o)))
      if (pv) setPreviewW(Math.max(PREVIEW_RANGE[0], Math.min(PREVIEW_RANGE[1], pv)))
    } catch { /* storage blocked */ }
  }, [])
  /** Drag a side column's inner edge to resize it; double-click puts its usual width back */
  function startColumnResize(e: React.PointerEvent, which: 'options' | 'preview') {
    if (e.button !== 0) return
    e.preventDefault(); e.stopPropagation()
    const x0 = e.clientX
    const w0 = which === 'options' ? optionsW : previewW
    const [lo, hi] = which === 'options' ? OPTIONS_RANGE : PREVIEW_RANGE
    let w = w0
    setResizing(which)
    const move = (ev: PointerEvent) => {
      // The options column grows to the right, the preview column to the left
      const d = which === 'options' ? ev.clientX - x0 : x0 - ev.clientX
      w = Math.round(Math.max(lo, Math.min(hi, w0 + d)))
      if (which === 'options') setOptionsW(w); else setPreviewW(w)
    }
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      setResizing(null)
      try { localStorage.setItem(which === 'options' ? 'editor.optionsW' : 'editor.previewW', String(w)) } catch { /* storage blocked */ }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function resetColumn(which: 'options' | 'preview') {
    if (which === 'options') setOptionsW(OPTIONS_W); else setPreviewW(PREVIEW_W)
    try { localStorage.removeItem(which === 'options' ? 'editor.optionsW' : 'editor.previewW') } catch { /* storage blocked */ }
  }
  // First-time tour: opens once the page has settled; the header's "?" replays it
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    if (hasSeenEditorTour()) return
    const t = setTimeout(() => setTourOpen(true), 900)
    return () => clearTimeout(t)
  }, [])
  const [editingTranscript, setEditingTranscript] = useState(false)
  const [pickerAtMs, setPickerAtMs] = useState<number | null>(null)
  // The "+" menu opens the picker for one kind only (a video or a photo)
  const [pickerOnly, setPickerOnly] = useState<'video' | 'photo' | null>(null)
  // A text just added from the "+" menu: its box in the Text panel takes focus to type into
  const [focusTextId, setFocusTextId] = useState<string | null>(null)
  // A text just added: typed in right on the preview (or in the Text panel when the preview is closed)
  const [editTextId, setEditTextId] = useState<string | null>(null)
  // Hidden file input for "+" → Music, and where that music goes
  const musicInputRef = useRef<HTMLInputElement>(null)
  const musicAtRef = useRef<number | 'end'>(0)
  // Frames: the selected lane item (or `main:<slot>`), the "+" menu, and the media picker filling a lane
  const [activeFrameItemId, setActiveFrameItemId] = useState<string | null>(null)
  const [laneHighlight, setLaneHighlight] = useState<{ lane: FrameLane; n: number; focusPlus?: boolean; openMenu?: boolean } | null>(null)
  const [addMenu, setAddMenu] = useState<{ segId: string; lane: FrameLane; t: number; anchor: DOMRect } | null>(null)
  const [framePicker, setFramePicker] = useState<{ segId: string; kind: 'video' | 'photo'; lane?: FrameLane; t?: number; replaceId?: string } | null>(null)
  const [videoLibrary, setVideoLibrary] = useState<Record<string, { url: string; title: string }>>({})
  const videoLibraryRef = useRef(videoLibrary)
  videoLibraryRef.current = videoLibrary
  const framePool = useMemo(() => createFrameMediaPool(id => videoLibraryRef.current[id]?.url), [])
  useEffect(() => () => framePool.dispose(), [framePool])
  async function loadVideoLibrary() {
    const res = await fetch('/api/videos?assets=1').catch(() => null)
    if (!res?.ok) return
    const { videos } = await res.json() as { videos: { id: string; title?: string | null; video_url?: string | null; index?: number }[] }
    setVideoLibrary(Object.fromEntries(videos.filter(v => v.video_url).map(v => [v.id, { url: v.video_url!, title: v.title?.trim() || `Video ${v.index ?? ''}`.trim() }])))
  }
  useEffect(() => { loadVideoLibrary() }, [])
  const videoTitles = useMemo(() => Object.fromEntries(Object.entries(videoLibrary).map(([id, v]) => [id, v.title])), [videoLibrary])
  const videoUrls = useMemo(() => Object.fromEntries(Object.entries(videoLibrary).map(([id, v]) => [id, v.url])), [videoLibrary])
  // B-roll shots are drawn from their own videos in the preview (muted; the speaker carries on)
  const mainVideoId = (clip as unknown as { video_id: string }).video_id
  // `segments` holds the sections (they frame the main video and never overlap) AND the videos
  // put on top of them (B-roll: layers, see shots.ts). `playParts` is the clip as it plays: each
  // section cut where a video plays over it — what the preview draws and what is saved.
  const sections = useMemo(() => segments.filter(s => !isShot(s, mainVideoId)), [segments, mainVideoId])
  const shots = useMemo(() => segments.filter(s => isShot(s, mainVideoId)).sort((a, b) => a.start_ms - b.start_ms), [segments, mainVideoId])
  const playParts = useMemo(() => flattenShots(segments, mainVideoId), [segments, mainVideoId])
  const brollSource = useBrollSources(videoRef, clip.start_ms, id => videoLibraryRef.current[id]?.url, mainVideoId, videoToTimeline)
  // Borrowed reaction slots (Make my clips): the clip's own video from another moment, per slot
  const borrowed = useBorrowedSlots(videoRef, clip.start_ms, mainVideoId, videoUrl, videoToTimeline)
  const [pendingBrollMs, setPendingBrollMs] = useState<number | null>(null)
  const [clipStatus, setClipStatus] = useState<string>(clip.status)
  const [outputUrl, setOutputUrl] = useState<string | null>(clip.output_url)
  const [exporting, setExporting] = useState(false)
  // Remove pauses and filler words (the cut is made by the export; see src/lib/cuts.ts)
  const [removeFillers, setRemoveFillersState] = useState(!!(clip as Clip & { remove_fillers?: boolean }).remove_fillers)
  const removeFillersRef = useRef(removeFillers)
  // Words to post the clip with (AI clips come with them; any clip can have them written)
  const [postText, setPostText] = useState<PostTextValue>(() => {
    const c = clip as Clip & { title?: string | null; post_caption?: string | null; hashtags?: string[] | null }
    return { title: c.title ?? null, post_caption: c.post_caption ?? null, hashtags: c.hashtags ?? null }
  })
  const [exportError, setExportError] = useState<string | null>(null)
  // What exports have always been rendered at (the worker ignored the 2160p asked for here)
  const renderQuality = '1080p' as const
  const [renderStuckSince, setRenderStuckSince] = useState<number | null>(clip.status === 'rendering' ? Date.now() : null)
  const [renderElapsed, setRenderElapsed] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [motionMode, setMotionMode] = useState(false)
  const [timelineZoom, setTimelineZoom] = useState(1)
  const [timelineHidden, setTimelineHidden] = useState(false)
  // Cleanup: the list of cuts can be folded away
  const [cutsOpen, setCutsOpen] = useState(true)
  // Lengths of music files added in this session (read from the file), so their timeline bars
  // show the right length; tracks without one run to the clip's end
  const [musicDurations, setMusicDurations] = useState<Record<string, number>>({})
  // The main video's own sound (top of the Music panel): applied to the preview here, saved with
  // the clip and used by the export
  const [originalVolume, setOriginalVolume] = useState(initialOriginalSound?.volume ?? 1)
  const [originalMuted, setOriginalMuted] = useState(initialOriginalSound?.muted ?? false)
  const originalSoundRef = useRef({ volume: originalVolume, muted: originalMuted })
  const originalLoadedRef = useRef(true)
  useEffect(() => {
    originalSoundRef.current = { volume: originalVolume, muted: originalMuted }
    if (originalLoadedRef.current) { originalLoadedRef.current = false; return }
    // A change is saved like any other edit (2.5 s later)
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    unsavedRef.current = true
    editVersionRef.current++
    autoSaveTimerRef.current = setTimeout(() => latestHandleSaveRef.current(), 2500)
  }, [originalVolume, originalMuted]) // eslint-disable-line react-hooks/exhaustive-deps
  // A muted section (its own sound off): the video is silent while the playhead is in it
  const [sectionMuted, setSectionMuted] = useState(false)
  // The frame sound sync sets the main video's volume every frame, so the level goes through it
  // (it multiplies each frame's own slot sound); mute is the element's own switch
  useEffect(() => {
    framePool.setMainGain(originalVolume)
    const v = videoRef.current
    if (!v) return
    v.volume = Math.max(0, Math.min(1, originalVolume))
    v.muted = originalMuted || sectionMuted
  }, [originalVolume, originalMuted, sectionMuted]) // framePool never changes (made once), so it isn't a dependency
  // Music heard in the preview: one <audio> per track added in this session, playing the picked
  // file in step with the video (tracks loaded from a saved clip have no file here yet)
  const musicEls = useRef(new Map<string, HTMLAudioElement>())
  // Stored songs' playable links, songs still uploading or whose upload failed, and the last message
  const [musicUrls, setMusicUrls] = useState<Record<string, string>>(initialMusicUrls ?? {})
  const [musicUploads, setMusicUploads] = useState<Record<string, 'uploading' | 'failed'>>({})
  const [musicNotice, setMusicNotice] = useState<string | null>(null)
  /** Stores a picked song (any audio, or a video's sound; up to 20 MB) */
  async function uploadMusicFile(f: File): Promise<{ storage_path: string; url: string }> {
    const form = new FormData()
    form.append('file', f)
    const res = await fetch('/api/audio/upload', { method: 'POST', body: form })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error ?? 'The song could not be uploaded')
    return data
  }
  /** Plays a song file in the preview (and learns its length for the timeline bar) */
  function attachMusicEl(id: string, src: string) {
    const old = musicEls.current.get(id)
    if (old) { old.pause(); if (old.src.startsWith('blob:')) URL.revokeObjectURL(old.src) }
    const a = new Audio()
    a.preload = 'auto'
    a.onloadedmetadata = () => { if (isFinite(a.duration)) setMusicDurations(d => ({ ...d, [id]: Math.round(a.duration * 1000) })) }
    a.src = src
    musicEls.current.set(id, a)
    return a
  }
  function sendMusic(id: string, f: File) {
    setMusicUploads(u => ({ ...u, [id]: 'uploading' }))
    uploadMusicFile(f).then(({ storage_path, url }) => {
      setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, storage_path } : t))
      setMusicUrls(m => ({ ...m, [id]: url }))
      setMusicUploads(u => { const n = { ...u }; delete n[id]; return n })
    }).catch((e: unknown) => {
      setMusicUploads(u => ({ ...u, [id]: 'failed' }))
      setMusicNotice(e instanceof Error ? e.message : 'The song could not be uploaded')
    })
  }
  const MAX_MUSIC_MB = 20
  function musicTooBig(f: File) {
    if (f.size <= MAX_MUSIC_MB * 1024 * 1024) return false
    setMusicNotice(`Music files can be up to ${MAX_MUSIC_MB} MB. Pick a smaller file or a shorter song.`)
    return true
  }
  /** "Re-add this song": a song saved before uploads existed (or whose upload failed) gets its file */
  function readdMusic(id: string, f: File) {
    if (musicTooBig(f)) return
    setMusicNotice(null)
    attachMusicEl(id, URL.createObjectURL(f))
    sendMusic(id, f)
  }
  function addMusicTrack(f: File, at?: number | 'end') {
    if (musicTooBig(f)) return
    setMusicNotice(null)
    const id = crypto.randomUUID()
    // The music starts where the playhead is (where you paused), not at the start of the clip —
    // or where the "+" menu says: the start, or so that it ends with the clip
    const startMs = typeof at === 'number' ? at : at === 'end' ? 0 : Math.max(0, Math.round(currentTimeMs))
    // It plays until the section it starts in ends (the next section edge); drag its end on the
    // timeline to carry it on into the next section. Added "at the end" it runs to the clip's end.
    const lenMs = clip.end_ms - clip.start_ms
    const edges = useEditorStore.getState().segments.flatMap(s => [s.start_ms, s.end_ms]).filter(t => t > startMs + 200 && t < lenMs)
    const sectionEnd = at === 'end' ? undefined : Math.min(lenMs, ...edges)
    // Fades on by default (the buttons switch them off); the name stands in until the upload is stored
    setAudioTracks(prev => [...prev, { id, clip_id: clip.id, storage_path: f.name, start_ms: startMs, ...(sectionEnd !== undefined ? { end_ms: sectionEnd } : {}), volume: 0.5, duck_under_speech: true, fade_in: true, fade_out: true }])
    sendMusic(id, f)
    const a = attachMusicEl(id, URL.createObjectURL(f))
    a.onloadedmetadata = () => {
      if (!isFinite(a.duration)) return
      const lenMs = Math.round(a.duration * 1000)
      setMusicDurations(d => ({ ...d, [id]: lenMs }))
      if (at === 'end') {
        const start = Math.max(0, clip.end_ms - clip.start_ms - lenMs)
        setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, start_ms: start } : t))
      } else {
        // A song shorter than its section stops where the song ends
        setAudioTracks(prev => prev.map(t => t.id === id && t.end_ms != null && t.end_ms > t.start_ms + lenMs ? { ...t, end_ms: t.start_ms + lenMs } : t))
      }
    }
  }
  // Stored songs (a saved clip, or after "Re-add") play from storage
  useEffect(() => {
    for (const t of audioTracks) {
      if (isMainAudio(t) || musicEls.current.has(t.id) || !musicUrls[t.id]) continue
      attachMusicEl(t.id, musicUrls[t.id])
    }
  }, [audioTracks, musicUrls]) // eslint-disable-line react-hooks/exhaustive-deps
  // Where the voice is actually heard (clip time): music dips only there, as in the export — not
  // while the original sound is muted, in muted sections, under a B-roll's own sound, in a frame
  // whose main video is silent; with the sound detached, where its bars play
  const speech = useMemo(() => {
    const originals = audioTracks.filter(isMainAudio)
    const span = (s: { start_ms: number; end_ms: number }): SpeechRange => [s.start_ms, s.end_ms]
    return heardSpeech({
      // Detached sound bars play the video's own file: the words in the video's own time
      speechInVideo: speechRangesInVideo(sourceWords, rawClip.start_ms, rawClip.end_ms),
      ...(trimmed ? { speechInClip: speechRanges(words, clip.start_ms, clip.end_ms) } : {}),
      clipStartMs: clip.start_ms, clipLenMs: clip.end_ms - clip.start_ms,
      originals: originals.length ? originals : null,
      mainVolume: originalMuted ? 0 : originalVolume,
      mutedSections: playParts.filter(s => s.muted).map(span),
      quietSections: playParts.filter(s => isFrameLayout(s.layout)
        ? mainAudioVolume(frameOf(s)) <= 0
        : addedVideoBox(s, mainVideoId)?.muted === false).map(span),
    })
  }, [words, sourceWords, trimmed, clip.start_ms, clip.end_ms, audioTracks, originalMuted, originalVolume, playParts, mainVideoId]) // eslint-disable-line react-hooks/exhaustive-deps
  // Keep every track's audio in step with the playhead: play while the playhead is inside it,
  // re-sync if it drifts, pause otherwise; follow each track's volume
  useEffect(() => {
    for (const [id, el] of musicEls.current) {
      const tr = audioTracks.find(t => t.id === id)
      if (!tr) {
        el.pause(); musicEls.current.delete(id)
        if (![...musicEls.current.values()].some(o => o.src === el.src)) URL.revokeObjectURL(el.src)
        continue
      }
      // Volume, fades and the dip under speech — the same rules as the export's mix
      el.volume = isMainAudio(tr) && sectionMuted ? 0 : musicGainAt(tr, currentTimeMs, musicDurations[id], speech, clipLengthMs)
      const local = (currentTimeMs - tr.start_ms + (tr.offset_ms ?? 0)) / 1000
      const stop = tr.end_ms ?? Infinity
      const inside = currentTimeMs >= tr.start_ms && currentTimeMs < stop && (!isFinite(el.duration) || local < el.duration)
      if (playing && inside) {
        if (el.paused || Math.abs(el.currentTime - local) > 0.6) el.currentTime = local
        if (el.paused) el.play().catch(() => {})
      } else if (!el.paused) {
        el.pause()
      }
    }
  }, [playing, currentTimeMs, audioTracks, sectionMuted, musicDurations, speech]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { for (const el of musicEls.current.values()) { el.pause(); URL.revokeObjectURL(el.src) } }, [])
  // Format panel: sections whose "what's in it" list is open, the kind of item shown, and the list
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set())
  const [sectionFilter, setSectionFilter] = useState<'all' | SectionItemKind>('all')
  const sectionListRef = useRef<HTMLDivElement>(null)
  // Picking a photo, text or music (timeline, preview or its panel) opens its settings on the left
  const openSettings = (t: Tool) => { setTool(t); toggleOptions(true) }
  // (`open` false: select only — a single click on the timeline doesn't open the sidebar)
  // One thing is picked at a time — a section, a video on top, a photo, a text or music: picking
  // one lets go of the others, so Hide / Mute / Lock, Trim and Delete are always about what was
  // picked last (they used to act on an earlier pick that was still held: bug #5)
  function pickPhoto(id: string, open = true) { setActiveOverlayId(id); setActiveTextOverlayId(null); setPickedSegIdState(null); setPickedMusicId(null); setLastPick('overlay'); if (open) openSettings('photos') }
  function pickText(id: string, open = true) { setActiveTextOverlayId(id); setActiveOverlayId(null); setPickedSegIdState(null); setPickedMusicId(null); setLastPick('text'); if (open) openSettings('text') }
  function pickMusicTrack(id: string, open = true) { pickMusic(id); if (open) openSettings('music') }
  // Timeline clicks select; the same thing clicked again quickly (a double tap) opens its settings
  const lastTapRef = useRef<{ key: string; at: number } | null>(null)
  function doubleTap(key: string) {
    const now = performance.now(), last = lastTapRef.current
    lastTapRef.current = { key, at: now }
    return !!last && last.key === key && now - last.at < 450
  }
  // "Locked" note: a short message when an edit is refused because something is locked
  const [lockNote, setLockNote] = useState<string | null>(null)
  const lockNoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function notifyLocked(msg: string) {
    setLockNote(msg)
    if (lockNoteTimer.current) clearTimeout(lockNoteTimer.current)
    lockNoteTimer.current = setTimeout(() => setLockNote(null), 2200)
  }
  // The section the user clicked (on the timeline strip or its card): the Delete buttons show only then
  const [pickedSegId, setPickedSegIdState] = useState<string | null>(null)
  // Music track selected on the timeline (Trim / Delete act on it). Only one thing is selected:
  // picking a video section clears the music, a photo and a text, and the other way round
  const [pickedMusicId, setPickedMusicId] = useState<string | null>(null)
  const setPickedSegId = (id: string | null) => {
    setPickedSegIdState(id); setPickedMusicId(null)
    if (id) { setActiveOverlayId(null); setActiveTextOverlayId(null); setLastPick('section') }
  }
  const pickMusic = (id: string) => { setPickedSegIdState(null); setActiveOverlayId(null); setActiveTextOverlayId(null); setPickedMusicId(id); setLastPick('music') }
  // What was picked last (on the timeline, the preview or a panel): the Delete button and key act on it
  const [lastPick, setLastPick] = useState<'music' | 'overlay' | 'text' | 'section' | 'frameItem' | null>(null)
  // Export press: the download animation plays first, then the render starts (see .ed-export in globals.css)
  const [exportPress, setExportPress] = useState(false)
  function pressExport() {
    if (exportPress) return
    setExportPress(true)
    setTimeout(() => { setExportPress(false); requestExport() }, 750)
  }
  // Click counters that replay each toolbar button's own animation (keys remount the icon)
  const [formatPlay, setFormatPlay] = useState<{ id: LayoutType; n: number } | null>(null)
  const [splitPlay, setSplitPlay] = useState(0)
  const motionModeRef = useRef(false)
  useEffect(() => { motionModeRef.current = motionMode }, [motionMode])

  const retranscribeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsavedRef = useRef(false)
  // Saves run one at a time: an edit made during a save queues exactly one more save after it
  const saveInFlightRef = useRef<Promise<void> | null>(null)
  const saveAgainRef = useRef(false)
  // A dropped connection (or a DB hiccup) retries on its own: 2s, 4s, 8s … up to 30s
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryDelayRef = useRef(2000)
  const editVersionRef = useRef(0)
  const latestHandleSaveRef = useRef<() => Promise<void>>(() => Promise.resolve())
  const skipCanvasTransitionRef = useRef(false)

  // ── Derived values ────────────────────────────────────────────────────────────
  // The part under the playhead, or null where there is none. At the very end of the clip the
  // part that ends there still counts.
  const clipLengthMs = clip.end_ms - clip.start_ms
  const partAt = (parts: SegmentLocal[], t: number) => {
    const byTime = [...parts].sort((a, b) => a.start_ms - b.start_ms)
    return byTime.find(s => t >= s.start_ms && t < s.end_ms)
      ?? byTime.find(s => s.end_ms >= clipLengthMs && t >= clipLengthMs && s.start_ms < clipLengthMs)
      ?? null
  }
  // What plays here: a video on top, else the section (default framing where no format is set)
  const playingSegment = useMemo(() => partAt(playParts, currentTimeMs), [playParts, currentTimeMs, clipLengthMs]) // eslint-disable-line react-hooks/exhaustive-deps
  // The section here, whatever lies over it: formats, views, frames and trims are about it
  const playingSection = useMemo(() => partAt(sections, currentTimeMs), [sections, currentTimeMs, clipLengthMs]) // eslint-disable-line react-hooks/exhaustive-deps
  const playingAdded = playingSegment ? addedVideoBox(playingSegment, mainVideoId) : null
  const brollSoundOn = !!playingAdded && playingAdded.muted === false
  useEffect(() => { setSectionMuted(!!playingSegment?.muted || brollSoundOn) }, [playingSegment?.muted, brollSoundOn])
  // Uncovered stretch under the playhead, if any
  const currentGap = useMemo(
    () => playingSection ? null : uncoveredRanges(sections, clipLengthMs).find(g => currentTimeMs >= g.start_ms && currentTimeMs <= g.end_ms) ?? null,
    [playingSection, sections, clipLengthMs, currentTimeMs],
  )
  // Selection follows the playhead: selecting a format seeks to it, so the crop boxes,
  // layout buttons, timeline highlight and preview always talk about the same format.
  const activeSegment = playingSection ?? undefined
  useEffect(() => {
    if (playingSection && playingSection.id !== activeSegmentId) setActiveSegmentId(playingSection.id)
  }, [playingSection, activeSegmentId, setActiveSegmentId])

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
    () => sections.filter(s => s.end_ms - s.start_ms > 50).sort((a, b) => a.start_ms - b.start_ms),
    [sections],
  )
  const uncovered = useMemo(() => uncoveredRanges(sections, clipLengthMs), [sections, clipLengthMs])

  function getVideoAR() {
    const v = videoRef.current
    return v && v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : undefined
  }

  // What the canvases show: the format under the playhead, or the default framing in a gap
  const defaultFormat = useMemo<SegmentLocal | null>(() => currentGap ? {
    id: DEFAULT_SEG_ID, start_ms: currentGap.start_ms, end_ms: currentGap.end_ms, layout: 'vertical', sort_order: -1,
    crop_boxes: [{ id: DEFAULT_BOX_ID, slot_index: 0, source_video_id: null, source_offset_ms: currentGap.start_ms, keyframes: [] }],
  } : null, [currentGap])
  // As the export shows it: a hidden added video gives way to the main video, hidden frame items
  // aren't drawn, a hidden main video is black
  const shownPlaying = useMemo(() => playingSegment ? shownSegment(playingSegment, mainVideoId, getVideoAR()) : null, [playingSegment, mainVideoId]) // eslint-disable-line react-hooks/exhaustive-deps
  const viewSegment = shownPlaying ?? defaultFormat
  const viewGetPositionAt = useMemo(
    () => (boxId: string, t: number) => boxId === DEFAULT_BOX_ID || boxId.endsWith(STAND_IN_SUFFIX) ? defaultCropForSlot('vertical', 0, getVideoAR()) : getPositionAt(boxId, t),
    [getPositionAt], // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Free plan: lock captions, stop spinner
  useEffect(() => {
    fetch('/api/billing/plan')
      .then(r => r.json())
      .then((d: { autoCaption?: boolean }) => {
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
      const { words: newWords, video_status: vs, pending } = await res.json()
      if (newWords && clipHasWords(newWords)) {
        setWords(newWords)
        setShowCaptions(true)
        setTranscribing(false)
        clearInterval(interval)
      } else if (!pending && (vs === 'ready' || vs === 'failed')) {
        // Nothing left running: show whatever exists (e.g. a clip with no speech)
        if (newWords?.length) setWords(newWords)
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
    if (!editedSinceLoadRef.current) {
      const loaded = loadedStateRef.current
      if (!loaded || sameEditable(editableSnapshot(), loaded)) return
      editedSinceLoadRef.current = true
    }
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    unsavedRef.current = true
    editVersionRef.current++
    autoSaveTimerRef.current = setTimeout(() => latestHandleSaveRef.current(), 2500)
    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segments, keyframes, trims, clipRange, captionStyle, textOverlays, audioTracks, transitions, filters, overlays])

  // Options sidebar open/closed and the social media preview choice are remembered per browser
  const [platform, setPlatformState] = useState<Platform>('off')
  useEffect(() => {
    try {
      if (localStorage.getItem('editor.optionsOpen') === 'false') setOptionsOpen(false)
      if (localStorage.getItem('editor.previewOpen') === 'false') setPreviewOpen(false)
      const p = localStorage.getItem('editor.platformPreview')
      if (p === 'instagram' || p === 'youtube') setPlatformState(p)
    } catch { /* storage blocked */ }
  }, [])
  function setPlatform(p: Platform) {
    setPlatformState(p)
    try { localStorage.setItem('editor.platformPreview', p) } catch { /* storage blocked */ }
  }
  /**
   * Add a video, photo, song or text at a time (the playhead): from a sub timeline (its icon or its
   * empty row). A video or photo lasts 5 s, text 3 s (moved back to fit before the clip's end);
   * music plays until the section ends.
   */
  function addMediaAt(kind: 'video' | 'photo' | 'music' | 'text', atMs: number) {
    pause()
    const t = Math.max(0, Math.min(atMs, clipLengthMs - 50))
    if (kind === 'video' || kind === 'photo') {
      setPickerOnly(kind); setPickerAtMs(Math.max(0, Math.min(t, clipLengthMs - 5000)))
      return
    }
    if (kind === 'music') {
      musicAtRef.current = t
      musicInputRef.current?.click()
      return
    }
    const len = Math.min(3000, clipLengthMs)
    const start = Math.max(0, Math.min(t, clipLengthMs - len))
    const id = crypto.randomUUID()
    setTextOverlays(prev => [...prev, {
      id, clip_id: clip.id, text: 'Your text', start_ms: start, end_ms: start + len,
      x: 0.1, y: 0.4, font: 'sans-serif', size: 72, color: '#ffffff',
    }])
    setActiveTextOverlayId(id)
    if (previewOpen) setEditTextId(id); else setFocusTextId(id)
    seekToMs(start)
    setTool('text'); toggleOptions(true)
  }
  function togglePreview(open: boolean) {
    setPreviewOpen(open)
    try { localStorage.setItem('editor.previewOpen', String(open)) } catch { /* storage blocked */ }
  }
  function toggleOptions(open: boolean) {
    setOptionsOpen(open)
    try { localStorage.setItem('editor.optionsOpen', String(open)) } catch { /* storage blocked */ }
  }


  // ── Save / export ─────────────────────────────────────────────────────────────

  // Two saves writing the same clip at once can collide (one deletes a format the other is still
  // writing) — so never overlap them. Callers get a promise that resolves once everything is saved.
  // Resolves true when the latest save succeeded
  const lastSaveOkRef = useRef(true)
  function handleSave(): Promise<void> {
    if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null }
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
    const editor = useEditorStore.getState()
    const { captionStyle } = useCaptionStore.getState()
    const media = useMediaStore.getState()
    const { filters } = media
    // The editor holds timeline time; a clip is saved in source clip time, with what was removed
    let state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    // (the clip's start and end as they are now: they may have been dragged)
    const range = editor.clipRange ?? [savedClip.start_ms, savedClip.end_ms]
    if (editor.trims.length) state = toSourceState(state, trimMap(editor.trims, range[0], range[1]), range[0])
    const { segments, keyframes, overlays, textOverlays, audioTracks, transitions } = state
    // A video on top (B-roll) is a layer here; a clip is saved as one row of parts that never
    // overlap, which the export and the clip board read (shots.ts)
    const saved = toSaved(segments.map(s => ({
      ...s,
      crop_boxes: s.crop_boxes.map(b => ({ ...b, keyframes: (keyframes[b.id] ?? b.keyframes ?? []).map(({ t_ms, x, y, w, h }) => ({ t_ms, x, y, w, h })) })),
    })), mainVideoId)
    try {
      const res = await fetch(`/api/clips/${clip.id}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: saved.rows,
          layers: saved.layers,
          captionStyle, textOverlays, audioTracks, transitions, filters, overlays,
          ...(canTrim ? { trims: editor.trims } : {}),
          // Always the clip's start and end as they are now (an undo back to how it loaded must be saved too;
          // the server only writes a change)
          ...(canTrim ? { range } : {}),
          removeFillers: removeFillersRef.current,
          originalSound: originalSoundRef.current,
        }),
      })
      if (!res.ok) {
        const msg = await res.json().then(j => j.error, () => null)
        throw Object.assign(new Error(msg ?? 'Save failed'), { status: res.status })
      }
      // Only clear "unsaved" if nothing changed while this save was in flight
      if (editVersionRef.current === version) unsavedRef.current = false
      retryDelayRef.current = 2000
      setSaveState('saved')
      saveTimerRef.current = setTimeout(() => setSaveState('idle'), 2500)
      return true
    } catch (err) {
      console.error('[save]', err)
      // No response at all (offline, DNS) or a server-side failure: nothing is wrong with the
      // edit itself, so keep trying quietly. A 4xx means the save was refused — show Retry.
      const status = (err as { status?: number }).status
      if (status === undefined || status >= 500 || status === 429) {
        setSaveState('retrying')
        const delay = retryDelayRef.current
        retryDelayRef.current = Math.min(delay * 2, 30000)
        if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
        retryTimerRef.current = setTimeout(() => { retryTimerRef.current = null; latestHandleSaveRef.current?.() }, delay)
      } else {
        setSaveState('error')
      }
      return false
    }
  }
  latestHandleSaveRef.current = handleSave

  // Back online: don't wait out the backoff
  useEffect(() => {
    const onOnline = () => { if (retryTimerRef.current) { retryDelayRef.current = 2000; latestHandleSaveRef.current?.() } }
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

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
        body: JSON.stringify({ clip_id: clip.id, quality: renderQuality, retranscribe, remove_fillers: removeFillersRef.current }),
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

  /**
   * Whether part of the clip as it plays was never captioned: no words at all, or a stretch of
   * more than CAPTION_GAP_MS at its start or end with none (the clip was made longer after its
   * captions were made). A pause that long at an end is rare; captioning it again is cheap.
   */
  const CAPTION_GAP_MS = 4000
  function needsCaptions(): boolean {
    const kept = trim.kept
    if (!kept.length) return false
    const inside = sourceWords.filter(w => kept.some(([a, b]) => w.start_ms >= a && w.start_ms < b)).sort((a, b) => a.start_ms - b.start_ms)
    if (!inside.length) return true
    return inside[0].start_ms - kept[0][0] > CAPTION_GAP_MS || kept[kept.length - 1][1] - inside[inside.length - 1].end_ms > CAPTION_GAP_MS
  }
  /** Make captions for the clip as it is now: save first, so the job reads its current start and end */
  async function makeCaptions() {
    if (transcribing || retranscribing || isFreePlan) return
    setRetranscribing(true)
    await handleSave()
    handleRetranscribe('unknown')
  }
  /** Captions on: made now for this clip if any part of it has none yet (nothing is captioned until asked) */
  function turnCaptions(on: boolean) {
    setShowCaptions(on)
    if (on && needsCaptions()) makeCaptions()
  }
  // Captions are on and the clip was just made longer: caption the new part too (once the drag is over)
  const captionAfterEdgeRef = useRef(false)
  const [edgeDragsDone, setEdgeDragsDone] = useState(0)
  useEffect(() => {
    if (!captionAfterEdgeRef.current) return
    captionAfterEdgeRef.current = false
    if (showCaptions && needsCaptions()) makeCaptions()
  }, [edgeDragsDone]) // eslint-disable-line react-hooks/exhaustive-deps

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
      const { job_id: jobId } = await res.json().catch(() => ({})) as { job_id?: string | null }
      const poll = async () => {
        const deadline = Date.now() + 5 * 60 * 1000
        while (Date.now() < deadline) {
          await new Promise(r => setTimeout(r, 3000))
          const res = await fetch(`/api/transcribe/words?video_id=${videoId}&since=${encodeURIComponent(queuedAt)}${jobId ? `&job=${jobId}` : ''}`)
          if (res.ok) {
            const { words: newWords, failed } = await res.json()
            if (newWords && newWords.length > 0) {
              setWords(newWords)
              stopTimer(); setRetranscribing(false); return
            }
            // The caption job stopped with an error: say so instead of waiting on
            if (failed) {
              stopTimer(); setRetranscribing(false)
              setRetranscribeError(`Captions couldn't be made: ${failed}`)
              return
            }
          }
        }
        stopTimer(); setRetranscribing(false)
        setRetranscribeError('Captions are taking too long. Try again in a minute.')
      }
      poll()
    } catch (err) {
      stopTimer(); setRetranscribing(false)
      setRetranscribeError(err instanceof Error ? err.message : 'Retranscription failed')
    }
  }

  // ── Editor actions ────────────────────────────────────────────────────────────

  // Format buttons and Frames ('fromPlayhead'): picking a layout mid-section starts it at the
  // playhead and it runs to the end of that section; what came before keeps its layout (e.g. Single
  // 0:00–0:20, then pick Split at 0:20 → Split 0:20–1:00, no Split button needed). At the very start
  // of a section the whole section changes. A new layout starts from the view of the nearest
  // section with that layout, and joins a touching neighbour with the same layout so no pieces are
  // left behind (frames never join: each keeps its own lanes).
  // 'section': the layout changes the WHOLE section under the playhead.
  const LAYOUT_SNAP_MS = 300
  const transitionAfter = () => new Set(transitions.map(tr => tr.after_segment_id))
  function handleLayoutChange(layout: LayoutType, mode: 'section' | 'fromPlayhead' = 'section') {
    const t = currentTimeMs
    const ar = getVideoAR()
    if (activeSegment && sectionBlocked(activeSegment.id)) return
    if (!activeSegment && currentGap) {
      // No format here yet: create one over the uncovered stretch (from the playhead, unless 'section')
      const start = mode === 'section' || t - currentGap.start_ms <= LAYOUT_SNAP_MS ? currentGap.start_ms : t
      if (currentGap.end_ms - start < 300) return
      pause()
      skipCanvasTransitionRef.current = true
      const id = addFormat(start, currentGap.end_ms, layout, ar, neighbourFraming(layout, start, currentGap.end_ms))
      joinSameLayoutNeighbours(id, transitionAfter())
      if (mode !== 'section' && start !== t) seekToMs(start)
      return
    }
    const seg = activeSegment
    // A frame already is Vertical as a format: picking Vertical keeps the frame
    if (!seg || seg.layout === layout || formatLayoutOf(seg.layout) === layout) return
    pause()
    skipCanvasTransitionRef.current = true
    setActiveBoxId(null)

    if (mode === 'section') {
      applyLayout(seg.id, layout, ar, neighbourFraming(layout, seg.start_ms, seg.end_ms, seg.id))
      joinSameLayoutNeighbours(seg.id, transitionAfter())
      return
    }

    if (t - seg.start_ms <= LAYOUT_SNAP_MS) {
      applyLayout(seg.id, layout, ar, neighbourFraming(layout, seg.start_ms, seg.end_ms, seg.id))
      joinSameLayoutNeighbours(seg.id, transitionAfter())
      return
    }
    if (seg.end_ms - t <= LAYOUT_SNAP_MS) {
      // Playhead is on the line into what follows: change the next format if it touches this one
      const next = [...sections].sort((a, b) => a.start_ms - b.start_ms).find(s => s.start_ms >= seg.end_ms - 1)
      if (next && next.start_ms - seg.end_ms < LAYOUT_SNAP_MS) {
        if (next.layout !== layout && formatLayoutOf(next.layout) !== layout && !sectionBlocked(next.id)) {
          applyLayout(next.id, layout, ar, neighbourFraming(layout, next.start_ms, next.end_ms, next.id))
          seekToMs(joinSameLayoutNeighbours(next.id, transitionAfter()) === next.id ? next.start_ms : seg.end_ms)
        }
        return
      }
      // Default framing follows: give that stretch the new format
      const gapEnd = next ? next.start_ms : clipLengthMs
      if (gapEnd - seg.end_ms >= 300) {
        const id = addFormat(seg.end_ms, gapEnd, layout, ar, neighbourFraming(layout, seg.end_ms, gapEnd))
        joinSameLayoutNeighbours(id, transitionAfter())
        seekToMs(seg.end_ms)
      }
      return
    }
    const newId = splitAtMs(seg.id, t, getPositionAt)
    if (newId) {
      applyLayout(newId, layout, ar, neighbourFraming(layout, t, seg.end_ms, newId))
      joinSameLayoutNeighbours(newId, transitionAfter())
    }
  }

  /**
   * A join dragged onto the next join: the section between goes and the section it was dragged
   * from takes its time (keeping its own layout); then it joins a neighbour with the same layout.
   * A frame with photos, videos or text in it asks first. One undo step.
   */
  function swallowSection(removeId: string, keepId: string) {
    if (blocked({ kind: 'section', id: removeId }) || blocked({ kind: 'section', id: keepId })) return
    const gone = segments.find(x => x.id === removeId)
    if (!gone) return
    const go = () => {
      pause()
      skipCanvasTransitionRef.current = true
      absorbSection(removeId, keepId)
      const kept = transitions.filter(tr => tr.after_segment_id !== removeId)
      if (kept.length !== transitions.length) setTransitions(kept)
      joinSameLayoutNeighbours(keepId, new Set(kept.map(tr => tr.after_segment_id)))
      if (pickedSegId === removeId) setPickedSegId(null)
    }
    const n = isFrameLayout(gone.layout) ? (frameOf(gone).items ?? []).length : 0
    if (n > 0) {
      confirm({
        title: `This frame has ${n} item${n === 1 ? '' : 's'}, remove it?`,
        body: `${FRAME_TEMPLATES[gone.layout as FrameLayout]?.name ?? 'The frame'} ${msToLabel(gone.start_ms)}–${msToLabel(gone.end_ms)} goes, with the photos, videos and text in its slots. ${UNDO_NOTE}`,
        confirmLabel: 'Remove',
      }, go)
    } else go()
  }

  // Split: cut the format under the playhead in two. Both halves keep its layout and views, so a
  // different layout can then be picked for one of them.
  // A video on top that is picked, with the playhead inside it, is the one cut; else the section here
  const pickedShot = pickedSegId ? shots.find(x => x.id === pickedSegId) : undefined
  const splitSeg = pickedShot && currentTimeMs > pickedShot.start_ms && currentTimeMs < pickedShot.end_ms ? pickedShot : activeSegment
  const canSplitHere = !!splitSeg && currentTimeMs > splitSeg.start_ms + 100 && currentTimeMs < splitSeg.end_ms - 100
  function splitHere() {
    const seg = splitSeg
    if (!seg || !canSplitHere || sectionBlocked(seg.id)) return
    pause()
    skipCanvasTransitionRef.current = true
    splitAtMs(seg.id, currentTimeMs, getPositionAt)
  }

  const musicName = (t: { storage_path: string }) => isMainAudio(t) ? 'Original sound' : (t.storage_path.split('/').pop() ?? 'Music').replace(/\.[a-z0-9]+$/i, '')
  /** Where a music track stops on the clip's timeline */
  const musicEnd = (t: AudioTrack) => t.end_ms
    ?? (musicDurations[t.id] != null ? t.start_ms + musicDurations[t.id] - (t.offset_ms ?? 0) : clipDurationMs)
  const pickedMusic = audioTracks.find(t => t.id === pickedMusicId) ?? null
  const canTrimMusic = !!pickedMusic && currentTimeMs > pickedMusic.start_ms + 200 && currentTimeMs < musicEnd(pickedMusic) - 200
  /** Trim music: cut the selected track in two at the playhead (the right part plays on from the same moment of the song) */
  function trimMusicAtPlayhead() {
    const tr = pickedMusic
    if (!tr || !canTrimMusic) return
    pause()
    const t = Math.round(currentTimeMs)
    const id = crypto.randomUUID()
    const right: AudioTrack = { ...tr, id, start_ms: t, offset_ms: (tr.offset_ms ?? 0) + (t - tr.start_ms) }
    setAudioTracks(prev => prev.flatMap(x => x.id === tr.id ? [{ ...x, end_ms: t }, right] : [x]))
    const el = musicEls.current.get(tr.id)
    if (el) { const copy = new Audio(); copy.preload = 'auto'; copy.src = el.src; musicEls.current.set(id, copy) }
    if (musicDurations[tr.id] != null) setMusicDurations(d => ({ ...d, [id]: d[tr.id] }))
  }
  /**
   * A music bar's end dragged on the timeline. The start cuts into the song (the track's end stays
   * where it was; never before the song's own start), the end shortens or lengthens the track
   * (never past the song's end or the clip's).
   */
  function trimMusicEdge(id: string, edge: 'start' | 'end', ms: number) {
    if (blocked({ kind: 'music', id })) return
    setAudioTracks(prev => prev.map(t => {
      if (t.id !== id) return t
      const off = t.offset_ms ?? 0
      const end = Math.min(clipLengthMs, musicEnd(t))
      if (edge === 'end') {
        const songEnd = musicDurations[t.id] != null ? t.start_ms + musicDurations[t.id] - off : clipLengthMs
        return { ...t, end_ms: Math.round(Math.min(songEnd, clipLengthMs, Math.max(t.start_ms + 200, ms))) }
      }
      const s = Math.round(Math.max(0, t.start_ms - off, Math.min(end - 200, ms)))
      return { ...t, start_ms: s, offset_ms: off + (s - t.start_ms), end_ms: end }
    }))
  }
  /**
   * Detach audio: the main video's sound becomes its own bar on the Music lane (trim it, move it,
   * change its volume) and the video itself goes quiet. It plays from the main video's file, so it
   * comes back after a reload too. Already detached: picks that bar.
   */
  function detachAudio() {
    const existing = audioTracks.find(isMainAudio)
    if (existing) { pickMusicTrack(existing.id, false); return }
    pause()
    const id = crypto.randomUUID()
    // Its "song" is the whole main video: one bar for each part of it that stays in the clip
    // (one bar from the clip's start when nothing was removed)
    setAudioTracks(prev => [...prev, ...trim.kept.map(([from, to], i) => ({
      id: i === 0 ? id : crypto.randomUUID(), clip_id: clip.id, storage_path: `${MAIN_AUDIO_PREFIX}${mainVideoId}`,
      start_ms: trim.starts[i], end_ms: trim.starts[i] + (to - from), offset_ms: from,
      volume: originalMuted ? 1 : Math.min(1, originalVolume), duck_under_speech: false,
    }))])
    pickMusicTrack(id, false)
  }
  // Each detached-sound track plays the main video's own file (so it also works after a reload / undo)
  useEffect(() => {
    // Saving keeps only a track's start, volume and ducking (not where in its file it starts), so a
    // reloaded detached sound gets its place in the video back: in step with the clip
    if (audioTracks.some(t => isMainAudio(t) && t.offset_ms == null)) {
      setAudioTracks(prev => prev.map(t => isMainAudio(t) && t.offset_ms == null ? { ...t, offset_ms: trim.toSource(t.start_ms) } : t))
      return
    }
    for (const t of audioTracks) {
      if (!isMainAudio(t) || musicEls.current.has(t.id) || !videoUrl) continue
      const a = new Audio()
      a.preload = 'metadata'
      a.onloadedmetadata = () => { if (isFinite(a.duration)) setMusicDurations(d => ({ ...d, [t.id]: Math.round(a.duration * 1000) })) }
      a.src = videoUrl
      musicEls.current.set(t.id, a)
    }
  }, [audioTracks, videoUrl])
  // While the sound is detached the video itself is quiet (and comes back when that bar is deleted)
  const hasMainAudio = audioTracks.some(isMainAudio)
  const hadMainAudioRef = useRef(hasMainAudio)
  useEffect(() => {
    if (hadMainAudioRef.current === hasMainAudio) return
    hadMainAudioRef.current = hasMainAudio
    setOriginalMuted(hasMainAudio)
  }, [hasMainAudio])

  function deleteMusic(id: string) {
    if (blocked({ kind: 'music', id })) return
    setAudioTracks(prev => prev.filter(t => t.id !== id))
    setPickedMusicId(null)
  }

  // Moving the view (the crop box):
  //  • Motion off — a VIEW CHANGE at the playhead: the new view shows from here until the next
  //    change (a cut); everything before stays as it was. On an existing change (◆ on the timeline)
  //    it edits that change; at the format's start it edits the first view.
  //  • Motion on — records points while the video plays; the view glides between them.
  // The preview and the export both follow these changes (see views.ts).
  const [selectedView, setSelectedView] = useState<{ boxId: string; t: number } | null>(null)
  // The ◆ markers on the timeline: view changes of the selected crop box (or the first one) in the
  // format under the playhead
  const viewBox = activeSegment ? (activeSegment.crop_boxes.find(b => b.id === activeBoxId) ?? activeSegment.crop_boxes[0]) : undefined
  const viewMarkers = useMemo(
    () => viewBox && activeSegment
      ? viewChanges(keyframes[viewBox.id] ?? []).filter(v => v.t_ms >= activeSegment.start_ms - 1 && v.t_ms < activeSegment.end_ms)
      : [],
    [viewBox, activeSegment, keyframes],
  )
  useEffect(() => { setSelectedView(null) }, [viewBox?.id])
  function handleBoxChange(boxId: string, pos: { x: number; y: number; w: number; h: number }) {
    if (boxId === DEFAULT_BOX_ID) {
      // First move creates a format over the gap; the rest of the same drag (whose handler still
      // points at the default box) reframes that new format instead of creating more
      const gap = currentGap
      if (!gap) return
      const made = useEditorStore.getState().segments.find(x => x.start_ms === gap.start_ms && x.end_ms === gap.end_ms && !isShot(x, mainVideoId))
      if (made?.crop_boxes[0]) { setBoxKeyframes(made.crop_boxes[0].id, [{ t_ms: made.start_ms, ...pos }]); return }
      addFormat(gap.start_ms, gap.end_ms, 'vertical', getVideoAR(), pos)
      return
    }
    const vid = videoRef.current
    if (sectionBlocked(segments.find(s => s.crop_boxes.some(b => b.id === boxId))?.id)) return
    if (motionModeRef.current) {
      const t_ms = vid && !vid.paused ? Math.round(trim.toTimeline(vid.currentTime * 1000)) : currentTimeMs
      recordMotionAt(boxId, Math.max(0, t_ms), pos)
      return
    }
    const seg = segments.find(s => s.crop_boxes.some(b => b.id === boxId))
    if (!seg || sectionBlocked(seg.id)) return
    // One drag = one view change at one moment: stop playback so the playhead can't run on
    if (vid && !vid.paused) pause()
    const t = Math.max(seg.start_ms, Math.min(seg.end_ms - 1, currentTimeMs))
    setViewAt(boxId, t, pos, seg.start_ms)
  }

  // Frames work like the Format layouts: picking one mid-section starts a new frame at the playhead
  // (e.g. Single 0:00–0:15, then Dual Video from 0:15), each with its own ◆ keys and lanes
  function handleApplyFrame(layout: FrameLayout) {
    handleLayoutChange(layout, 'fromPlayhead')
  }
  // What a layout or frame picked now will cover (see handleLayoutChange)
  const frameTarget = (() => {
    const t = currentTimeMs
    if (activeSegment) {
      const whole = t - activeSegment.start_ms <= LAYOUT_SNAP_MS || activeSegment.end_ms - t <= LAYOUT_SNAP_MS
      return `${msToLabel(whole ? activeSegment.start_ms : t)}–${msToLabel(activeSegment.end_ms)}`
    }
    if (currentGap) return `${msToLabel(t - currentGap.start_ms <= LAYOUT_SNAP_MS ? currentGap.start_ms : t)}–${msToLabel(currentGap.end_ms)}`
    return null
  })()

  // ── Frame lanes ─────────────────────────────────────────────────────────────
  const frameSeg = activeSegment && isFrameLayout(activeSegment.layout) ? activeSegment : null
  // A selection belongs to the frame it was made in
  // (a pick made in the Frames list for another frame lands once the playhead has moved there)
  const pendingFrameSelectRef = useRef<string | null>(null)
  useEffect(() => {
    setActiveFrameItemId(pendingFrameSelectRef.current)
    pendingFrameSelectRef.current = null
    setAddMenu(null)
  }, [frameSeg?.id])

  // Text (band text, text cards, captions) is edited in the Text tool; photos, videos and the main video in Frames
  function selectFrameItem(id: string | null, segId = frameSeg?.id, open = true) {
    if (segId && segId !== frameSeg?.id) pendingFrameSelectRef.current = id
    else setActiveFrameItemId(id)
    if (id) setLastPick('frameItem')
    if (!id || !open) return
    const seg = segments.find(x => x.id === segId)
    const it = seg ? frameOf(seg).items?.find(x => x.id === id) : undefined
    setTool(it?.kind === 'text' ? 'text' : 'frames')
    toggleOptions(true)
  }

  function addToLane(segId: string, lane: FrameLane, t: number, item: Omit<FrameItem, 'id' | 'lane' | 'start_ms' | 'end_ms'>) {
    const id = addFrameItem(segId, lane, t, item)
    if (id) {
      setActiveFrameItemId(id)
      setTool(item.kind === 'text' ? 'text' : 'frames')
      toggleOptions(true)
    }
    else setLaneHighlight(h => ({ lane, n: (h?.n ?? 0) + 1 }))
    return id
  }

  // Text on a frame's band: added straight away at the playhead, then typed in the Text tool
  function addBandText(segId: string, t: number) {
    const seg = segments.find(x => x.id === segId)
    if (!seg || sectionBlocked(segId)) return
    pause()
    const band = { ...DEFAULT_BAND, ...seg.frame?.band }
    addToLane(segId, 'band', t, { kind: 'text', text: '', bg: band.bg, color: band.color, size: band.size })
  }

  function handleAddChoice(choice: AddChoice) {
    if (!addMenu) return
    const { segId, lane, t } = addMenu
    setAddMenu(null)
    if (sectionBlocked(segId)) return
    const seg = segments.find(x => x.id === segId)
    if (!seg) return
    if (choice === 'photo' || choice === 'video') { setFramePicker({ segId, kind: choice, lane, t }); return }
    // Text on the band — the band appears with its first text
    if (choice === 'bandtext') { addBandText(segId, t); return }
    if (choice === 'main') {
      const f = frameOf(seg)
      const main = f.main_slots ?? [0]
      // "Same video" is the same sound as the slot already showing it, so this slot starts muted
      // (its own sound setting; unmute it to hear both)
      if (typeof lane === 'number' && !main.includes(lane)) {
        updateFrame(segId, {
          main_slots: [...main, lane].sort(),
          main_mutes: { ...f.main_mutes, [String(lane)]: main.length > 0 },
          main_volumes: { ...f.main_volumes, [String(lane)]: 1 },
        })
      }
      selectFrameItem(`main:${lane}`)
    }
  }

  function handlePickedVideo(videoId: string) {
    const p = framePicker
    setFramePicker(null)
    if (!videoLibraryRef.current[videoId]) loadVideoLibrary()
    if (!p) return
    if (p.replaceId) { updateFrameItem(p.segId, p.replaceId, { kind: 'video', source_video_id: videoId, source_offset_ms: 0, image_path: null, image_url: null }); return }
    if (p.lane !== undefined) addToLane(p.segId, p.lane, p.t ?? currentTimeMs, { kind: 'video', source_video_id: videoId, source_offset_ms: 0, volume: 1, muted: false, corners: DEFAULT_CORNERS })
  }

  function handlePickedPhoto(storagePath: string, url: string) {
    const p = framePicker
    setFramePicker(null)
    if (!p) return
    if (p.replaceId) { updateFrameItem(p.segId, p.replaceId, { kind: 'photo', image_path: storagePath, image_url: url || null, source_video_id: null }); return }
    if (p.lane !== undefined) addToLane(p.segId, p.lane, p.t ?? currentTimeMs, { kind: 'photo', image_path: storagePath, image_url: url || null, motion: 'none', corners: DEFAULT_CORNERS })
  }

  // "+" in the preview (or an empty lane in the panel) points at the lane on the timeline.
  // On the band it adds the text right away: it shows up on the band lane, ready to type and time.
  function focusLane(lane: FrameLane) {
    pause()
    // Band: the new text's box takes the keyboard focus, so the lane's "+" doesn't.
    // Slot: the lane's own "+" menu opens on the timeline (same video / upload video / photo).
    setLaneHighlight(h => ({ lane, n: (h?.n ?? 0) + 1, focusPlus: lane !== 'band', openMenu: lane !== 'band' }))
    if (lane === 'band' && frameSeg) addBandText(frameSeg.id, currentTimeMs)
  }

  // Frames list: pick something in a frame. The playhead moves onto it unless it's already showing.
  function selectInFrame(segId: string, id: string | null, atMs?: number) {
    const seg = segments.find(x => x.id === segId)
    if (!seg) return
    const it = id ? frameOf(seg).items?.find(x => x.id === id) : undefined
    const from = it ? Math.max(it.start_ms, seg.start_ms) : seg.start_ms
    const to = it ? Math.min(it.end_ms, seg.end_ms) : seg.end_ms
    if (id && atMs !== undefined && (currentTimeMs < from || currentTimeMs >= to)) { pause(); seekToMs(atMs) }
    selectFrameItem(id, segId)
  }

  function openFrame(segId: string) {
    const seg = segments.find(x => x.id === segId)
    if (!seg) return
    setActiveSegmentId(seg.id)
    if (currentTimeMs < seg.start_ms || currentTimeMs >= seg.end_ms) seekToMs(seg.start_ms)
  }

  function removeFrame(segId: string) {
    pause()
    skipCanvasTransitionRef.current = true
    applyLayout(segId, 'vertical', getVideoAR())
  }

  // ── Reset all edits ─────────────────────────────────────────────────────────
  // Back to how the clip was made: its original start and end (before any drag of its ends), no
  // part of it cut out, one Vertical format over the whole of it, no frames, text, media, music,
  // transitions or filters, pauses kept, and the default caption look. The captions themselves
  // (words, language, on/off) stay. It's one undo step, so Undo brings everything back.
  const [confirmResetAll, setConfirmResetAll] = useState(false)
  function handleResetAll() {
    setConfirmResetAll(false)
    pause()
    skipCanvasTransitionRef.current = true
    setActiveFrameItemId(null)
    setActiveTextOverlayId(null)
    setSelectedView(null)
    edgeBaseRef.current = null
    // Where the clip was made: kept when its ends were first dragged (else: as it was loaded)
    const made = savedClip as typeof savedClip & { original_start_ms?: number | null; original_end_ms?: number | null }
    const origStart = made.original_start_ms ?? savedClip.start_ms
    const origEnd = made.original_end_ms ?? savedClip.end_ms
    useEditorStore.setState({
      segments: [], keyframes: {}, trims: [], activeSegmentId: null, activeBoxId: null,
      clipRange: origStart === savedClip.start_ms && origEnd === savedClip.end_ms ? null : [origStart, origEnd],
    })
    seekAfterTrimRef.current = 0
    addFormat(0, origEnd - origStart, 'vertical', getVideoAR())
    if (removeFillers) setRemoveFillers(false)
    useMediaStore.setState({
      overlays: [], textOverlays: [], audioTracks: [], transitions: [],
      filters: { brightness: 100, contrast: 100, saturation: 100 }, activeOverlayId: null,
    })
    // Explicit defaults (not blanks): the save only writes caption fields that have a value
    useCaptionStore.setState(st => ({
      captionStyle: { ...st.captionStyle, font: null, size: null, color: '#FFE700', position: null, position_y: null, animation: 'karaoke' },
    }))
    // The video's own sound: full volume, not muted; and nothing stays selected
    setOriginalVolume(1)
    setOriginalMuted(false)
    setPickedSegIdState(null)
    setPickedMusicId(null)
  }
  useEffect(() => {
    if (!confirmResetAll) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setConfirmResetAll(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirmResetAll])

  function trimSelectedTo(edge: 'start' | 'end') {
    if (!activeSegment) return
    setSegmentEdge(activeSegment.id, edge, currentTimeMs, clipLengthMs)
  }

  function addFormatInGap(gap: { start_ms: number; end_ms: number }) {
    addFormat(gap.start_ms, gap.end_ms, 'vertical', getVideoAR())
    seekToMs(gap.start_ms)
  }

  function handleResetPositions() {
    const first = [...sections].sort((a, b) => a.start_ms - b.start_ms)[0]
    if (!first) return
    if (sections.some(x => x.locked)) { notifyLocked('Some sections are locked — unlock them first'); return }
    sections.filter(s => s.id !== first.id).forEach(s => removeSegment(s.id))
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

  // ── Every delete asks first ─────────────────────────────────────────────────
  const { confirm, dialog: confirmDialog } = useConfirm()
  const UNDO_NOTE = 'You can undo this.'

  /**
   * Cut timeline [a, b) out of the clip and close the gap (trimState.ts rippleDelete): that part
   * of the video is removed, what was only in it goes with it, what comes after moves up. One
   * undo step. Saved as a removed part of the source video; the export cuts it out.
   */
  function removePart(a: number, b: number) {
    pause()
    const editor = useEditorStore.getState(), media = useMediaStore.getState()
    const state: TimedState = {
      segments: editor.segments, keyframes: editor.keyframes,
      overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions,
    }
    const locked = lockedInRange(state, a, b)
    if (locked.length) { notifyLocked(`${locked[0][0].toUpperCase()}${locked[0].slice(1)} in this part is locked — unlock it first`); return }
    const map = trimMap(editor.trims, rawClip.start_ms, rawClip.end_ms)
    const nextTrims = addTrim(editor.trims, map, Math.round(a), Math.round(b), rawClip.start_ms, rawClip.end_ms)
    const gone = map.lengthMs - trimMap(nextTrims, rawClip.start_ms, rawClip.end_ms).lengthMs
    // (a start or end dragged back over a removed part makes it part of the clip again: see moveClipEdge)
    const added = withoutRanges(nextTrims, editor.trims)
    if (gone <= 0 || !added.length) return
    // What went, in the timeline as it was (a sliver left beside an earlier cut goes with it)
    const from = map.toTimeline(added[0][0])
    const next = rippleDelete(state, from, from + gone)
    skipCanvasTransitionRef.current = true
    seekAfterTrimRef.current = from
    editor.applyTrim(next.segments, next.keyframes, nextTrims)
    useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: next.audioTracks, transitions: next.transitions })
  }
  // The removed parts changed (a part cut out, an undo, a redo): the video may be standing in a
  // part that no longer plays, so put the playhead back on the timeline — at the join after a cut
  const seekAfterTrimRef = useRef<number | null>(null)
  const trimsKey = `${rawClip.start_ms}:${rawClip.end_ms}|${trims.map(r => r.join('-')).join(',')}`
  const trimsSeenRef = useRef(trimsKey)
  useEffect(() => {
    if (trimsSeenRef.current === trimsKey) return
    trimsSeenRef.current = trimsKey
    const at = seekAfterTrimRef.current ?? usePlayerStore.getState().currentTimeMs
    seekAfterTrimRef.current = null
    pause()
    seekToMs(Math.max(0, Math.min(at, trim.lengthMs - 1)))
  }, [trimsKey]) // eslint-disable-line react-hooks/exhaustive-deps

  /** The least of a clip that must stay when a part is cut out */
  const MIN_CLIP_LEFT_MS = MIN_CLIP_MS

  // ── The clip's own start and end (dragged at the ends of the timeline) ─────────
  // A clip can play at most MAX_CLIP_MS (one that is already longer can only get shorter), and
  // can't reach past the start or end of its video.
  const videoDurationMs = Number((savedClip as unknown as { video_duration_ms?: number | null }).video_duration_ms) || 0
  const maxClipMs = Math.max(MAX_CLIP_MS, trim.lengthMs)
  const clipEdgeLimits = {
    startEarlier: Math.max(0, Math.min(rawClip.start_ms, maxClipMs - trim.lengthMs)),
    startLater: Math.max(0, trim.lengthMs - MIN_CLIP_MS),
    endEarlier: Math.max(0, trim.lengthMs - MIN_CLIP_MS),
    endLater: videoDurationMs > rawClip.end_ms ? Math.max(0, Math.min(videoDurationMs - rawClip.end_ms, maxClipMs - trim.lengthMs)) : 0,
  }
  /**
   * Move the clip's start (`delta` < 0: earlier, more video; > 0: later, cut from the front) or its
   * end (> 0: later; < 0: earlier). Cutting works like deleting that part (rippleDelete); adding
   * video carries the first / last section over it.
   * While the handle is dragged this runs many times (`done` false), each time from the clip as it
   * was when the drag began, so the timeline and preview show the change live; the whole drag is
   * one undo step.
   */
  type EdgeBase = { state: TimedState; trims: typeof trims; clipRange: typeof clipRange; start: number; end: number; map: typeof trim; limits: typeof clipEdgeLimits }
  const edgeBaseRef = useRef<EdgeBase | null>(null)
  function moveClipEdge(edge: 'start' | 'end', delta: number, done = true) {
    let base = edgeBaseRef.current
    if (!base) {
      const editor = useEditorStore.getState(), media = useMediaStore.getState()
      base = {
        state: { segments: editor.segments, keyframes: editor.keyframes, overlays: media.overlays, textOverlays: media.textOverlays, audioTracks: media.audioTracks, transitions: media.transitions },
        trims: editor.trims, clipRange: editor.clipRange, start: rawClip.start_ms, end: rawClip.end_ms, map: trim, limits: clipEdgeLimits,
      }
      edgeBaseRef.current = base
      pause()
    }
    if (done) { edgeBaseRef.current = null; setEdgeDragsDone(n => n + 1) }
    const lim = base.limits
    const d = Math.round(edge === 'start'
      ? Math.max(-lim.startEarlier, Math.min(lim.startLater, delta))
      : Math.max(-lim.endEarlier, Math.min(lim.endLater, delta)))
    const editor = useEditorStore.getState()
    if (!d) {
      // Back where it started: the clip as it was
      useEditorStore.setState({ segments: base.state.segments, keyframes: base.state.keyframes, trims: base.trims, clipRange: base.clipRange })
      useMediaStore.setState({ overlays: base.state.overlays, textOverlays: base.state.textOverlays, audioTracks: base.state.audioTracks, transitions: base.state.transitions })
      return
    }
    const state = base.state
    const trim0 = base.map
    const len = trim0.lengthMs
    let next: TimedState, start = base.start, end = base.end, playhead: number
    const onTop = (s: SegmentLocal) => isShot(s, mainVideoId)
    if (edge === 'start' && d < 0) { next = insertAtStart(state, -d, onTop); start += d; playhead = 0; captionAfterEdgeRef.current = true }
    else if (edge === 'end' && d > 0) { next = extendEnd(state, len, len + d, onTop); end += d; playhead = len + d - 1; captionAfterEdgeRef.current = true }
    else {
      // Cutting from an end: what's there goes, as when a part is deleted
      const [a, b] = edge === 'start' ? [0, d] : [len + d, len]
      const locked = lockedInRange(state, a, b)
      if (locked.length) { notifyLocked(`${locked[0][0].toUpperCase()}${locked[0].slice(1)} there is locked — unlock it first`); return }
      next = rippleDelete(state, a, b)
      if (edge === 'start') { start = trim0.toSource(d); playhead = 0 } else { end = trim0.toSourceEnd(len + d); playhead = Math.max(0, len + d - 1) }
    }
    if (!done) captionAfterEdgeRef.current = false   // only once the drag is over
    skipCanvasTransitionRef.current = true
    seekAfterTrimRef.current = playhead
    editor.applyTrim(next.segments, next.keyframes, cleanTrims(base.trims, start, end), [start, end])
    useMediaStore.setState({ overlays: next.overlays, textOverlays: next.textOverlays, audioTracks: next.audioTracks, transitions: next.transitions })
  }

  function askDeleteFormat(segId: string) {
    if (blocked({ kind: 'section', id: segId })) return
    const i = cropPositions.findIndex(x => x.id === segId)
    const seg = cropPositions[i]
    if (!seg) return
    const range = `${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)}`
    const frameNote = isFrameLayout(seg.layout) ? ' Everything in its frame (photos, videos, text) is removed too.' : ''
    const resetLook = cropPositions.length === 1
      ? { title: 'Reset this format to Vertical?', body: `It becomes a plain Vertical format again.${frameNote} ${UNDO_NOTE}`, confirmLabel: 'Reset' }
      : { title: `Delete format ${i + 1}?`, body: `${range} goes back to the default framing.${frameNote} ${UNDO_NOTE}` }
    // Deleting a section cuts that part of the video out — unless it is (nearly) the whole clip,
    // or this database can't save removed parts yet: then only its look is reset, as before
    const length = seg.end_ms - seg.start_ms
    if (!canTrim || clipLengthMs - length < MIN_CLIP_LEFT_MS) {
      confirm(resetLook, () => handleDeleteFormat(segId))
      return
    }
    confirm({
      title: 'Delete this part of the video?',
      body: `${range} is cut out: the clip gets ${lengthLabel(length)} shorter and what comes after moves up. Text, photos and sounds that are only in this part go with it.${frameNote} ${UNDO_NOTE}`,
      extraLabel: cropPositions.length === 1 ? 'Keep the video, reset it to Vertical' : 'Keep the video, only remove this section\u2019s look',
      onExtra: () => handleDeleteFormat(segId),
    }, () => removePart(seg.start_ms, seg.end_ms))
  }

  function askRemoveFrame(segId: string) {
    if (sectionBlocked(segId)) return
    confirm({ title: 'Remove this frame?', body: `This part goes back to Vertical, and the photos, videos and text in the frame are removed. ${UNDO_NOTE}`, confirmLabel: 'Remove' },
      () => removeFrame(segId))
  }

  function frameItemName(segId: string, id: string) {
    const seg = segments.find(x => x.id === segId)
    const it = seg ? frameOf(seg).items?.find(x => x.id === id) : undefined
    if (!it) return 'this'
    if (it.kind === 'video') return `the video "${videoTitles[it.source_video_id ?? ''] ?? 'Video'}"`
    if (it.kind === 'photo') return 'this photo'
    if (it.captions) return 'the captions from the band'
    return it.text?.trim() ? `the text "${it.text.trim().slice(0, 40)}"` : 'this text'
  }

  function askRemoveFrameItem(segId: string, id: string) {
    if (sectionBlocked(segId)) return
    confirm({ title: `Remove ${frameItemName(segId, id)}?`, body: UNDO_NOTE, confirmLabel: 'Remove' }, () => {
      removeFrameItem(segId, id)
      setActiveFrameItemId(cur => cur === id ? null : cur)
    })
  }

  function askRemoveMain(segId: string, slot: number) {
    if (sectionBlocked(segId)) return
    const seg = segments.find(x => x.id === segId)
    if (!seg || !isFrameLayout(seg.layout)) return
    const label = frameLanes(seg.layout).find(l => l.lane === slot)?.label ?? ''
    confirm({ title: `Take the main video out of the ${label.toLowerCase()} slot?`, body: `The slot will be empty until you add something. ${UNDO_NOTE}`, confirmLabel: 'Take it out' }, () => {
      updateFrame(segId, { main_slots: (frameOf(seg).main_slots ?? [0]).filter(i => i !== slot) })
      setActiveFrameItemId(cur => cur === `main:${slot}` ? null : cur)
    })
  }

  function askDeleteTextOverlay(id: string) {
    if (blocked({ kind: 'text', id })) return
    const o = textOverlays.find(x => x.id === id)
    confirm({ title: o?.text?.trim() ? `Delete the text "${o.text.trim().slice(0, 40)}"?` : 'Delete this text?', body: UNDO_NOTE }, () => {
      deleteTextOverlay(id)
      setActiveTextOverlayId(cur => cur === id ? null : cur)
    })
  }

  // ── Export: warn about empty frame slots first ─────────────────────────────
  // If the user goes ahead, the time where a slot is empty becomes plain Vertical (the main
  // video) — visible on the timeline, and one Undo step — and then the export starts.
  // Previous / next buttons in the timeline bar: jump to where a section starts (or the clip's ends)
  function jumpPrevSection() {
    const starts = [0, ...cropPositions.map(x => x.start_ms)].sort((a, b) => a - b)
    const prev = [...starts].reverse().find(t => t < currentTimeMs - 300) ?? 0
    seekToMs(prev)
  }
  function jumpNextSection() {
    const starts = cropPositions.map(x => x.start_ms).sort((a, b) => a - b)
    seekToMs(starts.find(t => t > currentTimeMs + 1) ?? clipDurationMs)
  }

  function requestExport(retranscribe = false) {
    const frames = cropPositions.filter(x => isFrameLayout(x.layout))
    const found = frames.flatMap(seg => emptySlotStretches(seg).map(st => ({ seg, ...st })))
    if (!found.length) { handleExport(retranscribe); return }
    pause()
    const lines = found.slice(0, 6).map(f => {
      const names = frameSlotLabels(f.seg.layout as FrameLayout)
      const slots = f.slots.map(i => names[i] ?? `Slot ${i + 1}`).join(' & ')
      return `• Frame ${frames.indexOf(f.seg) + 1} · ${FRAME_TEMPLATES[f.seg.layout as FrameLayout].name}: ${slots} slot empty ${msToLabel(f.start_ms)}–${msToLabel(f.end_ms)}`
    })
    if (found.length > 6) lines.push(`…and ${found.length - 6} more`)
    confirm({
      title: found.length === 1 ? 'A frame slot is empty' : 'Some frame slots are empty',
      body: `${lines.join('\n')}\n\nIf you export anyway, these parts become plain Vertical (just the main video). You can undo this afterwards.`,
      confirmLabel: 'Convert to Vertical & export',
      cancelLabel: 'Go to it',
      tone: 'warning',
      onCancel: () => { seekToMs(found[0].start_ms); setTool('frames'); toggleOptions(true) },
    }, () => {
      convertEmptyToVertical(found)
      handleExport(retranscribe)
    })
  }

  function convertEmptyToVertical(found: { seg: SegmentLocal; start_ms: number; end_ms: number }[]) {
    skipCanvasTransitionRef.current = true
    // Per frame, the empty time as merged stretches
    const bySeg = new Map<string, { a: number; b: number }[]>()
    for (const f of found) {
      const list = bySeg.get(f.seg.id) ?? []
      list.push({ a: f.start_ms, b: f.end_ms })
      bySeg.set(f.seg.id, list)
    }
    for (const [segId, raw] of bySeg) {
      const merged: { a: number; b: number }[] = []
      for (const r of raw.sort((x, y) => x.a - y.a)) {
        const last = merged[merged.length - 1]
        if (last && r.a <= last.b) last.b = Math.max(last.b, r.b)
        else merged.push({ ...r })
      }
      // Right to left: splitting keeps the left part's id, so the rest of the frame stays addressable
      for (const { a, b } of merged.reverse()) {
        const cur = useEditorStore.getState().segments.find(x => x.id === segId)
        if (!cur) break
        if (b < cur.end_ms - 100) splitAtMs(cur.id, b, getPositionAt)
        let target = cur.id
        if (a > cur.start_ms + 100) target = splitAtMs(cur.id, a, getPositionAt) ?? cur.id
        applyLayout(target, 'vertical', getVideoAR())
      }
    }
  }

  function askDeleteOverlay(id: string) {
    if (blocked({ kind: 'photo', id })) return
    const o = overlays.find(x => x.id === id)
    confirm({ title: `Delete this ${o?.type === 'video' ? 'video' : 'image'}?`, body: UNDO_NOTE }, () => {
      deleteOverlay(id)
      if (activeOverlayId === id) setActiveOverlayId(null)
    })
  }

  function handleInsertBroll(videoId: string) {
    const atMs = pickerAtMs ?? pendingBrollMs ?? currentTimeMs
    setPickerAtMs(null); setPendingBrollMs(null); setPickerOnly(null)
    // 5 s from here, across section edges if it gets there (it isn't cut off at the section's end)
    const at = Math.max(0, Math.min(atMs, clipLengthMs - 500))
    if (rangeBlocked(at, Math.min(clipLengthMs, at + 5000))) return
    const newId = placeBroll(videoId, at, Math.min(clipLengthMs, at + 5000))
    pickShot(newId); seekToMs(at)
  }

  // Borrowed reaction slots look ahead through the parts to start each one on time
  const trackBorrowed = borrowed.track
  useEffect(() => { trackBorrowed(playParts) }, [playParts, trackBorrowed])

  // ── B-roll panel ──────────────────────────────────────────────────────────────
  const brollShots = useMemo(() => shots
    .map(sg => ({ id: sg.id, start_ms: sg.start_ms, end_ms: sg.end_ms, title: (videoTitles[sg.crop_boxes[0].source_video_id!] ?? 'Video').replace(/^(Pixabay|Pexels): /, '') })),
  [shots, videoTitles])
  /** A video on top picked (on its lane, in a list): Hide / Mute / Lock, Trim and Delete act on it. The section under it is not picked. */
  function pickShot(id: string, open = false) {
    setPickedSegId(id)
    if (open) openSettings('broll')
  }

  /** Save the stock video as the user's asset, then put it in at the playhead as a muted cutaway */
  async function addStockBroll(item: StockResult, lengthMs: number) {
    { const at0 = Math.min(currentTimeMs, Math.max(0, clipLengthMs - 500)); if (rangeBlocked(at0, Math.min(clipLengthMs, at0 + lengthMs))) return }
    const res = await fetch('/api/stock/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: item.ref, url: item.url, title: item.title }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Could not add that video')
    videoLibraryRef.current = { ...videoLibraryRef.current, [data.video_id]: { url: data.url, title: data.title } }
    setVideoLibrary(videoLibraryRef.current)
    const at = Math.min(currentTimeMs, Math.max(0, clipLengthMs - 500))
    const segId = placeBroll(data.video_id, at, Math.min(clipLengthMs, at + lengthMs))
    pickShot(segId)
    seekToMs(at)
  }

  /**
   * Give a video on top a new time. It is a layer: only it moves, the sections under it stay as
   * they are. Dragged as a whole it keeps its length (and shows the same pictures); an end
   * dragged trims it.
   */
  function retimeBroll(id: string, startMs: number, endMs: number) {
    if (blocked({ kind: 'broll', id })) return
    const shot = useEditorStore.getState().segments.find(x => x.id === id)
    if (!shot) return
    const len = shot.end_ms - shot.start_ms
    const moved = Math.abs((endMs - startMs) - len) < 1
    const start = moved ? Math.max(0, Math.min(clipLengthMs - len, startMs)) : Math.max(0, Math.min(clipLengthMs - 500, startMs))
    const end = moved ? start + len : Math.min(clipLengthMs, Math.max(start + 500, endMs))
    if (rangeBlocked(start, end, id)) return
    retimeShot(id, Math.round(start), Math.round(end), moved)
  }
  const moveBroll = (id: string, delta: number) => { const shot = shots.find(x => x.id === id); if (shot) retimeBroll(id, shot.start_ms + delta, shot.end_ms + delta) }
  const resizeBroll = (id: string, delta: number) => { const shot = shots.find(x => x.id === id); if (shot) retimeBroll(id, shot.start_ms, shot.end_ms + delta) }

  /** Remove a video on top: the sections under it show again, as they were */
  const removeBroll = (id: string) => {
    if (blocked({ kind: 'broll', id })) return
    removeBrollShot(id)
    if (pickedSegId === id) setPickedSegId(null)
  }

  function handleInsertBrollAfterSeg(afterSegId: string) {
    const seg = segments.find(s => s.id === afterSegId)
    if (seg) setPickerAtMs(seg.end_ms)
  }

  function handleInsertImage(storagePath: string, previewUrl: string) {
    const atMs = pickerAtMs ?? currentTimeMs
    const fromPlus = pickerOnly === 'photo'
    setPickerAtMs(null); setPickerOnly(null)
    const seg = sections.find(s => atMs >= s.start_ms && atMs <= s.end_ms)
    // From the "+" menu a photo shows for 5 s (then drag its ends on the timeline)
    const endMs = fromPlus ? Math.min(clipLengthMs, atMs + 5000) : seg ? seg.end_ms : atMs + 5000
    const id = crypto.randomUUID()
    if (fromPlus) { setActiveOverlayId(id); seekToMs(atMs); openSettings('photos') }
    setOverlays(prev => [...prev, {
      id, clip_id: clip.id, type: 'image' as const,
      storage_path: storagePath, preview_url: previewUrl || undefined,
      source_video_id: null, source_offset_ms: 0,
      x: 0, y: 0, w: 1, h: 1, start_ms: atMs, end_ms: endMs,
      z_index: prev.length + 1, created_at: new Date().toISOString(),
    }])
  }

  // ── Keyboard shortcuts: Space play/pause · S split · [ ] trim · Delete · ←/→ 0.5 s (Shift: 5 s) ──
  /**
   * What the Delete button / key removes: the thing picked last — a song, a photo or video on top,
   * a text, something in a frame, an added video, or a section — if it's still there; otherwise
   * whatever is still picked, most specific first. Each asks first (except music) and can be undone.
   */
  function deleteTarget(): { label: string; run: () => void } | null {
    const music = pickedMusicId ? audioTracks.find(t => t.id === pickedMusicId) : undefined
    const overlay = activeOverlayId ? overlays.find(o => o.id === activeOverlayId) : undefined
    const text = activeTextOverlayId ? textOverlays.find(o => o.id === activeTextOverlayId) : undefined
    const fItem = frameSeg && activeFrameItemId ? activeFrameItemId : null
    const seg = pickedSegId ? segments.find(x => x.id === pickedSegId) : undefined
    const options = {
      music: music && { label: 'the selected music', run: () => deleteMusic(music.id) },
      overlay: overlay && { label: overlay.type === 'video' ? 'the selected video' : 'the selected photo', run: () => askDeleteOverlay(overlay.id) },
      text: text && { label: 'the selected text', run: () => askDeleteTextOverlay(text.id) },
      frameItem: fItem && frameSeg && {
        label: fItem.startsWith('main:') ? 'the main video in this slot' : 'the selected item in the frame',
        run: () => fItem.startsWith('main:') ? askRemoveMain(frameSeg.id, Number(fItem.slice(5))) : askRemoveFrameItem(frameSeg.id, fItem),
      },
      section: seg && (brollShots.some(b => b.id === seg.id)
        ? { label: 'the selected video', run: () => confirm({ title: 'Delete this video?', body: `The main video shows here again. ${UNDO_NOTE}` }, () => removeBroll(seg.id)) }
        : { label: 'the selected section', run: () => askDeleteFormat(seg.id) }),
    }
    if (lastPick && options[lastPick]) return options[lastPick] || null
    return options.frameItem || options.music || options.overlay || options.text || options.section || null
  }

  const shortcutsRef = useRef({ togglePlay, seekToMs, currentTimeMs, clipDurationMs, trimSelectedTo, splitHere, deleteSelected: () => {} })
  shortcutsRef.current = {
    togglePlay, seekToMs, currentTimeMs, clipDurationMs, trimSelectedTo, splitHere,
    // Delete acts on what's selected most specifically: a view change (◆), a text overlay, then an
    // image, then the format (an overlay only counts while it's on screen at the playhead, so a
    // stale selection can't be deleted by surprise)
    deleteSelected: () => {
      if (selectedView && viewMarkers.some(v => v.t_ms === selectedView.t) && viewMarkers.length > 1) {
        removeViewChange(selectedView.boxId, selectedView.t)
        setSelectedView(null)
        return
      }
      // What was picked (the same as the Delete button)
      const target = deleteTarget()
      if (target) { target.run(); return }
      const onScreen = (o: { start_ms: number; end_ms: number }) => currentTimeMs >= o.start_ms && currentTimeMs < o.end_ms
      const text = textOverlays.find(o => o.id === activeTextOverlayId && onScreen(o))
      if (text) { askDeleteTextOverlay(text.id); return }
      const image = overlays.find(o => o.id === activeOverlayId && onScreen(o))
      if (image) { askDeleteOverlay(image.id); return }
      if (frameSeg && activeFrameItemId) {
        if (activeFrameItemId.startsWith('main:')) askRemoveMain(frameSeg.id, Number(activeFrameItemId.slice(5)))
        else askRemoveFrameItem(frameSeg.id, activeFrameItemId)
        return
      }
      if (activeSegment) askDeleteFormat(activeSegment.id)
    },
  }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      // Ctrl/⌘+Z undo · Ctrl/⌘+Shift+Z or Ctrl+Y redo. While typing in a text box the browser's own
      // text undo applies (sliders, colour pickers and the like don't count)
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'z' || e.key === 'Z' || e.key === 'y' || e.key === 'Y')) {
        if (isTextEntry(target)) return
        e.preventDefault()
        if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo()
        return
      }
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
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault(); s.splitHere()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (target?.closest('button, a, [role="button"]') && e.key === 'Backspace') return
        e.preventDefault(); s.deleteSelected()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const step = (e.shiftKey ? 5000 : 500) * (e.key === 'ArrowLeft' ? -1 : 1)
        s.seekToMs(Math.max(0, Math.min(s.clipDurationMs, s.currentTimeMs + step)))
      }
    }
    window.addEventListener('keydown', onKey)
    // Pressing anywhere outside a text box ends typing in it. The timeline's handles stop the
    // browser from moving focus, so without this a text box stays focused through a drag and
    // takes the next Ctrl+Z (or Delete) for itself.
    function onPointerDown(e: PointerEvent) {
      const el = document.activeElement as HTMLElement | null
      if (!isTextEntry(el) || el!.contains(e.target as Node) || isTextEntry(e.target as HTMLElement)) return
      el!.blur()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('pointerdown', onPointerDown, true) }
  }, [])

  // ── Render ────────────────────────────────────────────────────────────────────

  const rendering = clipStatus === 'rendering' || exporting
  const hasOutput = !!outputUrl && clipStatus === 'done'
  // What "Remove pauses and filler words" takes out of this clip, from the transcript
  // Reaction parts (splits, trios) are never cut; at export, pauses with a laugh in them are kept too
  const fillerCuts = useMemo(() => computeCutRanges(words, clip.start_ms, clip.end_ms, reactionRanges(playParts, clip.start_ms)), [words, clip.start_ms, clip.end_ms, playParts])
  const fillerCutMs = useMemo(() => removedMs(fillerCuts), [fillerCuts])
  /** Each cut, clip-relative, with the words it takes out (none = a pause) */
  const fillerCutList = useMemo(() => fillerCuts.map(([a, b]) => ({
    at: a - clip.start_ms,
    ms: b - a,
    words: words.filter(w => (w.start_ms + w.end_ms) / 2 >= a && (w.start_ms + w.end_ms) / 2 < b).map(w => w.word),
  })), [fillerCuts, words, clip.start_ms])
  /** "Remove pauses & filler words": in the preview column and in the Captions panel, one setting */
  // On / off switch (not a checkbox): the whole card toggles it; lime with a black knob when on
  const fillersToggle = (place: string) => words.length > 0 && (
    <button type="button" role="switch" aria-checked={removeFillers} onClick={() => setRemoveFillers(!removeFillers)}
      className={`shrink-0 ${place} w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-[background,box-shadow] duration-200`}
      style={removeFillers
        ? { background: 'rgba(200,255,0,0.06)', boxShadow: 'inset 0 0 0 1px rgba(200,255,0,0.4)' }
        : { background: 'rgb(var(--ed-fg) / 0.04)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.07)' }}>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-[var(--ed-text)]">Remove pauses &amp; filler words</span>
        <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
          {fillerCutMs >= 500 ? `Removes about ${Math.round(fillerCutMs / 1000)} s. ` : 'Nothing much to remove in this clip. '}
          Applied when you export; the preview plays the full clip.
        </span>
      </span>
      <span aria-hidden="true" className="relative shrink-0 rounded-full transition-colors mt-0.5"
        style={{ width: 36, height: 20, background: removeFillers ? '#c8ff00' : 'rgb(var(--ed-fg) / 0.15)' }}>
        <span className="absolute rounded-full transition-all"
          style={{ top: 3, left: removeFillers ? 19 : 3, width: 14, height: 14, background: removeFillers ? '#0a0a0a' : '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
      </span>
    </button>
  )

  function setRemoveFillers(on: boolean) {
    setRemoveFillersState(on)
    removeFillersRef.current = on
    unsavedRef.current = true
    editVersionRef.current++
    latestHandleSaveRef.current()
  }
  const activeTool = TOOLS.find(t => t.id === tool)!

  /** A section picked: its card in the Format panel shows its contents (opened on a double tap on the timeline) */
  function pickSection(id: string | null, open = true) {
    setPickedSegId(id)
    if (!id) return
    setActiveSegmentId(id)
    setOpenSections(prev => new Set(prev).add(id))
    if (open) openSettings('format')
  }
  useEffect(() => {
    if (tool !== 'format' || !pickedSegId) return
    sectionListRef.current?.querySelector(`[data-section-id="${pickedSegId}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [tool, pickedSegId])

  // ── Hide / mute / lock ──────────────────────────────────────────────────────
  /** The hide / mute / lock state of a section, photo, text or music track */
  function ctlState(t: CtlTarget): { hidden?: boolean; muted?: boolean; locked?: boolean } | undefined {
    if (t.kind === 'section') return segments.find(x => x.id === t.id)
    if (t.kind === 'broll') {
      const seg = segments.find(x => x.id === t.id)
      // Shown unless hidden; its own sound off unless switched on (then it plays instead of the main video's)
      return seg && { hidden: seg.crop_boxes[0]?.hidden, locked: seg.locked, muted: seg.crop_boxes[0]?.muted !== false }
    }
    if (t.kind === 'frameItem') {
      const it = frameOf(segments.find(x => x.id === t.segId) ?? ({} as SegmentLocal)).items?.find(x => x.id === t.id)
      return it && { hidden: it.hidden, muted: it.muted }
    }
    if (t.kind === 'photo') return overlays.find(x => x.id === t.id)
    if (t.kind === 'text') return textOverlays.find(x => x.id === t.id)
    return audioTracks.find(x => x.id === t.id)
  }
  /** The locked section an item's time falls in, if any: everything inside a locked section is locked too */
  function lockedSectionOver(startMs: number, endMs: number, exceptId?: string) {
    return sections.find(x => x.locked && x.id !== exceptId && x.start_ms < endMs && x.end_ms > startMs) ?? null
  }
  /** A thing's own time (for the section lock) */
  function spanOf(t: CtlTarget): [number, number] | null {
    if (t.kind === 'broll') { const o = shots.find(x => x.id === t.id); return o ? [o.start_ms, o.end_ms] : null }
    if (t.kind === 'photo') { const o = overlays.find(x => x.id === t.id); return o ? [o.start_ms, o.end_ms] : null }
    if (t.kind === 'text') { const o = textOverlays.find(x => x.id === t.id); return o ? [o.start_ms, o.end_ms] : null }
    if (t.kind === 'music') { const o = audioTracks.find(x => x.id === t.id); return o ? [o.start_ms, Math.min(clipLengthMs, musicEnd(o))] : null }
    return null
  }
  /** Locked itself, or inside a locked section (a frame item: its frame's section) */
  function isLocked(t: CtlTarget): boolean {
    if (ctlState(t)?.locked) return true
    if (t.kind === 'frameItem') return !!segments.find(x => x.id === t.segId)?.locked
    const span = spanOf(t)
    return !!span && !!lockedSectionOver(span[0], span[1])
  }
  /** Lock check for an edit: true (and a short note why) when the thing can't be changed */
  function blocked(t: CtlTarget): boolean {
    if (!isLocked(t)) return false
    const own = !!ctlState(t)?.locked
    notifyLocked(own ? 'This is locked — unlock it to change it' : 'Its section is locked — unlock the section to change it')
    return true
  }
  /** A section by id (frames, layouts, views): blocked when it's locked */
  function sectionBlocked(segId: string | null | undefined) { return !!segId && blocked({ kind: 'section', id: segId }) }
  /** Something new put over this time (a video on top): blocked by a locked section there */
  function rangeBlocked(startMs: number, endMs: number, exceptId?: string) {
    const sec = lockedSectionOver(startMs, endMs, exceptId)
    if (sec) notifyLocked(`The section ${msToLabel(sec.start_ms)}–${msToLabel(sec.end_ms)} is locked — unlock it first`)
    return !!sec
  }
  /** Which controls a thing has: the main video mutes and locks, an added video hides, mutes and locks, photos and text hide and lock, music mutes and locks */
  function canCtl(t: CtlTarget): CtlKey[] {
    if (t.kind === 'section') return isFrameLayout(segments.find(x => x.id === t.id)?.layout ?? 'vertical') ? ['muted', 'locked'] : ['hidden', 'muted', 'locked']
    if (t.kind === 'broll') return ['hidden', 'muted', 'locked']
    if (t.kind === 'frameItem') {
      const it = frameOf(segments.find(x => x.id === t.segId) ?? ({} as SegmentLocal)).items?.find(x => x.id === t.id)
      return it?.kind === 'video' ? ['hidden', 'muted'] : ['hidden']
    }
    if (t.kind === 'photo') return overlays.find(o => o.id === t.id)?.type === 'video' ? ['hidden', 'muted', 'locked'] : ['hidden', 'locked']
    return t.kind === 'music' ? ['muted', 'locked'] : ['hidden', 'locked']
  }
  function toggleCtl(t: CtlTarget, k: CtlKey) {
    const patch = { [k]: !ctlState(t)?.[k] } as Partial<Record<CtlKey, boolean>>
    if (t.kind === 'section') updateSegment(t.id, patch)
    else if (t.kind === 'broll') {
      const seg = segments.find(x => x.id === t.id)
      if (!seg) return
      if (k === 'locked') updateSegment(seg.id, patch)
      else updateSegment(seg.id, { crop_boxes: seg.crop_boxes.map((b, i) => i === 0 ? { ...b, [k]: !!patch[k] } : b) })
    }
    else if (t.kind === 'frameItem') { if (t.segId) updateFrameItem(t.segId, t.id, patch) }
    else if (t.kind === 'photo') updateOverlay(t.id, patch)
    else if (t.kind === 'text') updateTextOverlay(t.id, patch)
    else setAudioTracks(prev => prev.map(x => x.id === t.id ? { ...x, ...patch } : x))
  }

  /** Everything shown during a section — its video, photos, text and music — each one a click from its settings */
  function sectionItems(seg: SegmentLocal): SectionItem[] {
    const out: SectionItem[] = []
    const inside = (s: number, e: number) => s < seg.end_ms && e > seg.start_ms
    const from = (s: number) => Math.max(s, seg.start_ms)
    const go = (s: number) => { pause(); seekToMs(from(s)) }
    for (const shot of shots) {
      if (!inside(shot.start_ms, shot.end_ms)) continue
      out.push({ key: `broll-${shot.id}`, kind: 'video', name: (videoTitles[shot.crop_boxes[0].source_video_id!] ?? 'Video').replace(/^(Pixabay|Pexels): /, ''), start: from(shot.start_ms), end: Math.min(shot.end_ms, seg.end_ms),
        focus: () => { go(shot.start_ms); pickShot(shot.id, true) }, ctl: { kind: 'broll', id: shot.id } })
    }
    if (isFrameLayout(seg.layout)) {
      for (const it of frameOf(seg).items ?? []) {
        if (!inside(it.start_ms, it.end_ms)) continue
        const kind: SectionItemKind = it.kind === 'video' ? 'video' : it.kind === 'photo' ? 'photo' : 'text'
        const name = it.kind === 'video' ? (videoTitles[it.source_video_id ?? ''] ?? 'Video') : it.kind === 'photo' ? 'Photo in the frame' : it.captions ? 'Captions' : (it.text?.trim() || 'Text')
        out.push({ key: it.id, kind, name, start: from(it.start_ms), end: Math.min(it.end_ms, seg.end_ms), thumb: it.kind === 'photo' ? it.image_url : null,
          focus: () => { selectInFrame(seg.id, it.id, from(it.start_ms)); openSettings(kind === 'text' ? 'text' : 'frames') },
          ctl: it.captions ? undefined : { kind: 'frameItem', id: it.id, segId: seg.id } })
      }
    }
    for (const o of overlays) {
      if (!inside(o.start_ms, o.end_ms)) continue
      out.push({ key: o.id, kind: o.type === 'image' ? 'photo' : 'video', name: o.type === 'image' ? 'Photo' : 'Video on top', start: from(o.start_ms), end: Math.min(o.end_ms, seg.end_ms), thumb: o.type === 'image' ? o.preview_url : null,
        focus: () => { go(o.start_ms); if (o.type === 'image') pickPhoto(o.id); else setActiveOverlayId(o.id) }, ctl: { kind: 'photo', id: o.id } })
    }
    for (const t of textOverlays) {
      if (!inside(t.start_ms, t.end_ms)) continue
      out.push({ key: t.id, kind: 'text', name: t.text.trim() || 'Text', start: from(t.start_ms), end: Math.min(t.end_ms, seg.end_ms),
        focus: () => { go(t.start_ms); pickText(t.id) }, ctl: { kind: 'text', id: t.id } })
    }
    for (const t of audioTracks) {
      const end = Math.min(clipLengthMs, t.end_ms ?? (musicDurations[t.id] != null ? t.start_ms + musicDurations[t.id] - (t.offset_ms ?? 0) : clipLengthMs))
      if (!inside(t.start_ms, end)) continue
      out.push({ key: t.id, kind: 'music', name: musicName(t), start: from(t.start_ms), end: Math.min(end, seg.end_ms),
        focus: () => { go(t.start_ms); pickMusicTrack(t.id) }, ctl: { kind: 'music', id: t.id } })
    }
    const order: SectionItemKind[] = ['video', 'photo', 'text', 'music']
    return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.start - b.start)
  }
  const itemsBySection = new Map(cropPositions.map(sg => [sg.id, sectionItems(sg)]))
  // What the Hide / Mute / Lock buttons by Trim and Delete act on: the last thing picked, as
  // Delete does (deleteTarget) — otherwise whatever is still picked, most specific first
  const pickedFrameItem = frameSeg && activeFrameItemId && !activeFrameItemId.startsWith('main:')
    ? frameOf(frameSeg).items?.find(x => x.id === activeFrameItemId && !x.captions) : undefined
  const selTargets: Record<NonNullable<typeof lastPick>, CtlTarget | null> = {
    music: pickedMusicId && audioTracks.some(t => t.id === pickedMusicId) ? { kind: 'music', id: pickedMusicId } : null,
    overlay: activeOverlayId && overlays.some(o => o.id === activeOverlayId) ? { kind: 'photo', id: activeOverlayId } : null,
    text: activeTextOverlayId && textOverlays.some(o => o.id === activeTextOverlayId) ? { kind: 'text', id: activeTextOverlayId } : null,
    frameItem: pickedFrameItem && frameSeg ? { kind: 'frameItem', id: pickedFrameItem.id, segId: frameSeg.id } : null,
    section: pickedSegId && segments.some(x => x.id === pickedSegId)
      ? { kind: brollShots.some(b => b.id === pickedSegId) ? 'broll' : 'section', id: pickedSegId } : null,
  }
  const selTarget: CtlTarget | null = (lastPick && selTargets[lastPick])
    || selTargets.frameItem || selTargets.music || selTargets.overlay || selTargets.text || selTargets.section || null
  const selName = !selTarget ? '' : selTarget.kind === 'section' ? 'the picked section' : selTarget.kind === 'broll' ? 'the picked video'
    : selTarget.kind === 'frameItem' ? (pickedFrameItem?.kind === 'video' ? 'the picked video' : pickedFrameItem?.kind === 'photo' ? 'the picked photo' : 'the picked text')
      : selTarget.kind === 'photo' && overlays.find(o => o.id === selTarget.id)?.type === 'video' ? 'the picked video'
        : `the picked ${selTarget.kind}`

  return (
    <div className="editor-theme h-screen flex flex-col overflow-hidden" style={{ background: 'var(--ed-app)', color: 'var(--ed-text)' }}>

      <EditorTour open={tourOpen} onClose={() => setTourOpen(false)} />

      {/* ── Header: logo · where am I · is it saved · export ───────────────────── */}
      {/* Above everything in the body (preview overlays use z-index 10–20), so the account menu isn't drawn underneath them */}
      <header className="relative shrink-0 flex items-center gap-3 px-4"
        style={{ height: 56, background: 'var(--ed-panel)', borderBottom: '1px solid rgb(var(--ed-fg) / 0.07)', zIndex: 60 }}>
        {/* Same vector logo (with its intro) as the landing page, dashboard and clip board */}
        <a href="/dashboard" onClick={e => leaveTo(e, '/dashboard')} title="Go to the dashboard" aria-label="Shortcut dashboard"
          className="flex items-center shrink-0 rounded-lg">
          <BrandLogo shine />
        </a>

        <div className="w-px h-6 shrink-0" style={{ background: 'rgb(var(--ed-fg) / 0.1)' }} />

        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 text-sm">
          <a href="/dashboard" onClick={e => leaveTo(e, '/dashboard')}
            className="shrink-0 transition-colors hover:text-[var(--ed-text)]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
            Dashboard
          </a>
          <BreadcrumbChevron />
          <a href={`/videos/${videoId}`} onClick={e => leaveTo(e, `/videos/${videoId}`)} title={`Clip board: ${videoTitle}`}
            className="shrink-0 transition-colors hover:text-[var(--ed-text)]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
            Clip board
          </a>
          <BreadcrumbChevron />
          <span aria-current="page" className="font-semibold text-[var(--ed-text)] shrink-0" title={clipTitle}>Editing board</span>
        </nav>

        <SaveIndicator state={leaving ? 'saving' : saveState} leaving={leaving} onRetry={handleSave} />

        <div className="flex-1" />

        <div className="flex items-center gap-3 shrink-0">
          <button type="button" onClick={() => setTourOpen(true)} aria-label="Show the editor tour" title="How the editor works"
            className="w-8 h-8 flex items-center justify-center rounded-full transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
            style={{ color: 'rgb(var(--ed-fg) / 0.7)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.14)' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 015 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01" />
            </svg>
          </button>
          {/* Shared profile button; saves pending edits before leaving the editor */}
          <AccountMenu
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
        <nav aria-label="Editor tools" data-tour="tools" className="shrink-0 flex flex-col items-center gap-1 py-3"
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
                className="ed-tool" data-active={active || undefined}
                style={{ width: 60, height: 58 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">{t.icon}</svg>
                <span className="text-[11px] font-medium">{t.label}</span>
              </button>
            )
          })}
          <div className="flex-1" />
          <div className="relative">
            <button onClick={() => setConfirmResetAll(v => !v)} aria-expanded={confirmResetAll}
              title="Reset all edits"
              className="ed-tool ed-tool-danger" data-active={confirmResetAll || undefined}
              style={{ width: 60, height: 52 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" />
              </svg>
              <span className="text-[11px] font-medium">Reset</span>
            </button>
            {confirmResetAll && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 70 }} onClick={() => setConfirmResetAll(false)} aria-hidden="true" />
                <div role="alertdialog" aria-labelledby="reset-all-title" aria-describedby="reset-all-desc"
                  className="absolute left-full bottom-0 ml-2 flex flex-col gap-3 p-4 rounded-xl"
                  style={{ width: 280, zIndex: 71, background: 'var(--ed-panel)', border: '1px solid rgb(var(--ed-fg) / 0.12)', boxShadow: '0 12px 32px rgba(0,0,0,0.55)' }}>
                  <p id="reset-all-title" className="text-sm font-semibold text-[var(--ed-text)]">Reset all edits?</p>
                  <p id="reset-all-desc" className="text-xs leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                    The clip goes back to how it was made: its original start and end, nothing cut out. Formats, frames, text, media, music, the video’s sound and the caption look go back to the start. Your captions stay. You can undo this.
                  </p>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => setConfirmResetAll(false)} autoFocus
                      className="h-8 px-3 rounded-lg text-xs font-medium transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]"
                      style={{ color: 'rgb(var(--ed-fg) / 0.75)' }}>Cancel</button>
                    <button onClick={handleResetAll}
                      className="h-8 px-3 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
                      style={{ background: '#ef4444', color: '#fff' }}>Reset everything</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </nav>

        {/* Options sidebar — settings for the selected tool only; collapsible */}
        <aside id="options-sidebar" aria-label={`${activeTool.title} options`} aria-hidden={!optionsOpen}
          className="ed-options relative shrink-0 min-h-0 overflow-hidden" data-open={optionsOpen || undefined} data-resizing={resizing === 'options' || undefined}
          style={{ width: optionsOpen ? optionsW : 0, background: 'var(--ed-panel)' }}
          {...(!optionsOpen ? { inert: true } : {})}>
          {/* Its right edge: drag to make the column wider or narrower */}
          {optionsOpen && (
            <div role="separator" aria-orientation="vertical" aria-label="Drag to resize the options panel. Double-click to reset."
              title="Drag to resize · double-click to reset" className="ed-col-handle" style={{ right: 0 }} data-on={resizing === 'options' || undefined}
              onPointerDown={e => startColumnResize(e, 'options')} onDoubleClick={() => resetColumn('options')} />
          )}
          {/* Fixed width inside, so the panel slides and fades as one piece while the column opens */}
          <div className="ed-options-inner h-full flex flex-col min-h-0" style={{ width: optionsW }}>
          <div className="shrink-0 pl-4 pr-2 pt-3 pb-3 flex items-start gap-2" style={{ borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <div className="flex-1 min-w-0 pt-1">
            {tool === 'captions' && editingTranscript ? (
              <button onClick={() => setEditingTranscript(false)} className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ed-text)] hover:opacity-80">
                <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M9 2.5L4.5 7 9 11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Edit caption text
              </button>
            ) : (
              <>
                {/* The tool's explanation sits behind the ⓘ */}
                <h2 className="flex items-center gap-1.5 text-sm font-semibold text-[var(--ed-text)]">
                  {activeTool.title}
                  <InfoTip label={`About ${activeTool.title}`}>{activeTool.hint}</InfoTip>
                </h2>
              </>
            )}
            </div>
            <button onClick={() => toggleOptions(false)} aria-label="Close options sidebar" title="Close options sidebar"
              className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
              style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
              <SidebarIcon open />
            </button>
          </div>

          {/* Keyed by tool: switching tools fades the new panel in */}
          <div key={tool} className="ed-options-body flex-1 min-h-0 overflow-y-auto">
            {tool === 'format' && (
              <div className="flex flex-col">
                <div className="px-4 pt-3 pb-2 flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--ed-text)]">Sections</span>
                  <span className="h-5 min-w-5 px-1.5 flex items-center justify-center rounded-full text-[11px] font-bold tabular-nums"
                    style={{ background: 'rgba(200,255,0,0.12)', color: 'var(--ed-accent-text)' }}>
                    {cropPositions.length}
                  </span>
                  {uncovered.length > 0 && (
                    <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>+ {uncovered.length} default</span>
                  )}
                  <div className="flex-1" />
                  {cropPositions.length > 1 && (
                    <button onClick={() => confirm({
                        title: 'Remove every format except the first?',
                        body: 'The first format will cover the whole clip, and any frames among the others are removed too. You can undo this.',
                        confirmLabel: 'Remove',
                      }, handleResetPositions)}
                      title="Remove every format except the first"
                      className="h-7 px-2.5 flex items-center gap-1.5 rounded-lg text-[11px] font-medium transition-colors hover:bg-[rgb(var(--ed-fg)/0.06)] hover:text-[var(--ed-text)]"
                      style={{ color: 'rgb(var(--ed-fg) / 0.55)', border: '1px solid rgb(var(--ed-fg) / 0.12)' }}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" /><path d="M3 3v5h5" />
                      </svg>
                      Reset
                    </button>
                  )}
                </div>
                {/* Show what's in the sections: everything, or one kind (sections without it fade) */}
                <div role="radiogroup" aria-label="Show in the sections" className="flex gap-1 mt-1 overflow-x-auto no-scrollbar -mx-1 px-1">
                  {(['all', ...SECTION_KINDS.map(k => k.id)] as const).map(id => {
                    const on = sectionFilter === id
                    const meta = SECTION_KINDS.find(k => k.id === id)
                    const n = id === 'all' ? null : [...itemsBySection.values()].reduce((c, list) => c + list.filter(x => x.kind === id).length, 0)
                    return (
                      <button key={id} role="radio" aria-checked={on} onClick={() => setSectionFilter(id)}
                        className="shrink-0 h-6 px-2 flex items-center gap-1 rounded-full text-[11px] font-medium transition-colors"
                        style={on
                          ? { background: meta ? `${meta.color}26` : 'rgb(var(--ed-fg) / 0.12)', color: 'var(--ed-text)', boxShadow: `inset 0 0 0 1px ${meta ? meta.color : 'rgb(var(--ed-fg) / 0.25)'}` }
                          : { color: 'rgb(var(--ed-fg) / 0.55)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.1)' }}>
                        {meta && <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />}
                        {meta ? meta.plural : 'All'}
                        {n != null && <span className="tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>{n}</span>}
                      </button>
                    )
                  })}
                </div>
                </div>
                <div ref={sectionListRef} className="px-3 pb-3 flex flex-col gap-1.5">
                  {uncovered.filter(g => g.start_ms < (cropPositions[0]?.start_ms ?? Infinity)).map(g => (
                    <GapRow key={`gap-${g.start_ms}`} gap={g} active={currentGap?.start_ms === g.start_ms}
                      onSelect={() => seekToMs(g.start_ms)} onAdd={() => addFormatInGap(g)} />
                  ))}
                  {cropPositions.map((seg, i) => {
                    const gapAfter = uncovered.find(g => g.start_ms === seg.end_ms)
                    const gapRow = gapAfter && (
                      <GapRow gap={gapAfter} active={currentGap?.start_ms === gapAfter.start_ms}
                        onSelect={() => seekToMs(gapAfter.start_ms)} onAdd={() => addFormatInGap(gapAfter)} />
                    )
                    // A frame is one vertical 9:16 reel, so as a format it's Vertical (its contents live in Frames)
                    const shown = formatLayoutOf(seg.layout)
                    const col = LAYOUT_COLORS[shown]
                    const isActiveSeg = seg.id === activeSegment?.id
                    const only = cropPositions.length === 1
                    // Deleting a section cuts that part of the video out (askDeleteFormat); only the whole clip is reset instead
                    const deleteLabel = !canTrim ? (only ? 'Reset this format to Vertical' : `Delete format ${i + 1} (its time goes back to default framing)`)
                      : clipLengthMs - (seg.end_ms - seg.start_ms) < MIN_CLIP_LEFT_MS ? 'Reset this format to Vertical' : `Delete this part of the video (${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)})`
                    const name = LAYOUTS.find(l => l.id === shown)?.label ?? shown
                    const all = itemsBySection.get(seg.id) ?? []
                    const items = sectionFilter === 'all' ? all : all.filter(x => x.kind === sectionFilter)
                    // Open when toggled open, or when a kind is picked and this section has some
                    const open = openSections.has(seg.id) || (sectionFilter !== 'all' && items.length > 0)
                    const faded = sectionFilter !== 'all' && items.length === 0
                    return (
                      <Fragment key={seg.id}>
                      <div
                        data-section-id={seg.id}
                        role="button" tabIndex={0}
                        aria-current={isActiveSeg || undefined}
                        aria-label={`Section ${i + 1}: ${name}, ${msToLabel(seg.start_ms)} to ${msToLabel(seg.end_ms)}`}
                        className="group relative flex flex-col rounded-xl cursor-pointer overflow-hidden transition-[background,box-shadow,opacity] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(200,255,0,0.6)]"
                        style={{
                          background: isActiveSeg ? 'linear-gradient(180deg, rgba(200,255,0,0.06), rgba(200,255,0,0.015))' : 'rgb(var(--ed-fg) / 0.03)',
                          boxShadow: isActiveSeg ? 'inset 0 0 0 1px rgba(200,255,0,0.45), 0 8px 22px -16px rgba(200,255,0,0.5)' : 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.07)',
                          opacity: faded ? 0.45 : 1,
                        }}
                        onClick={() => { setActiveSegmentId(seg.id); setPickedSegId(seg.id); seekToMs(seg.start_ms) }}
                        onKeyDown={e => { if (e.key === 'Enter') { setActiveSegmentId(seg.id); setPickedSegId(seg.id); seekToMs(seg.start_ms) } }}>
                        <div className="flex items-start gap-2.5 pl-2.5 pr-1.5 pt-2 pb-1.5">
                          <span className="shrink-0 w-8 h-8 mt-px flex items-center justify-center rounded-lg"
                            style={{ background: isActiveSeg ? 'rgba(200,255,0,0.1)' : 'rgb(var(--ed-fg) / 0.06)' }}>
                            <LayoutGlyph layout={shown} color={isActiveSeg ? '#c8ff00' : '#9ca3af'} active={isActiveSeg} />
                          </span>
                          <div className="flex-1 min-w-0 flex flex-col">
                            {/* Line 1: name · time range · open */}
                            <div className="flex items-center gap-2 min-w-0 h-6">
                              <span className="text-[13px] font-semibold truncate text-[var(--ed-text)]">{name}</span>
                              {isActiveSeg && <span className="shrink-0 w-1.5 h-1.5 rounded-full" style={{ background: '#c8ff00' }} title="Under the playhead" />}
                              <span className="ml-auto shrink-0 whitespace-nowrap text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                                {msToLabel(seg.start_ms)} – {msToLabel(seg.end_ms)}
                              </span>
                            </div>
                            {/* Line 2: length and what's in it · lock · delete */}
                            <div className="flex items-center gap-1 min-w-0 h-6">
                              <span className="flex-1 min-w-0 truncate text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.42)' }}>
                                {[lengthLabel(seg.end_ms - seg.start_ms), ...SECTION_KINDS.flatMap(k => {
                                  const c = all.filter(x => x.kind === k.id).length
                                  return c ? [`${c} ${(c === 1 ? k.one : k.plural).toLowerCase()}`] : []
                                })].join(' · ')}
                              </span>
                              <span className={`shrink-0 flex items-center transition-opacity ${isActiveSeg || seg.locked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                                <CtlButtons size="sm" state={seg} can={['locked']} onToggle={k => toggleCtl({ kind: 'section', id: seg.id }, k)}
                                  what={name.toLowerCase() === 'video' ? 'this video section' : 'this section'} />
                              </span>
                              <button onClick={e => { e.stopPropagation(); askDeleteFormat(seg.id) }}
                                aria-label={deleteLabel} title={`${deleteLabel} (Delete)`}
                                className={`shrink-0 w-[22px] h-[22px] flex items-center justify-center rounded-md transition-[opacity,background,color] hover:bg-[rgba(239,68,68,0.12)] hover:text-[#f87171] ${isActiveSeg ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                                style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                                <TrashIcon />
                              </button>
                            </div>
                          </div>
                          {/* What's in this section: open / close its list */}
                          <button onClick={e => { e.stopPropagation(); setOpenSections(prev => { const n = new Set(prev); if (n.has(seg.id)) n.delete(seg.id); else n.add(seg.id); return n }) }}
                            aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} what's in section ${i + 1}`} title={open ? 'Hide what\u2019s in it' : 'Show what\u2019s in it'}
                            className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]"
                            style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                              style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}><path d="M6 9l6 6 6-6" /></svg>
                          </button>
                        </div>
                        {open && (
                          <div className="mx-2 mb-2 flex flex-col rounded-lg overflow-hidden" onClick={e => e.stopPropagation()}
                            style={{ background: 'rgb(var(--ed-fg) / 0.035)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.05)' }}>
                            {/* The main video, in every section (under a video section its sound carries on) */}
                            {sectionFilter === 'all' && (
                              <div className="flex items-center gap-1 pr-1" style={{ opacity: seg.hidden ? 0.5 : 1 }}>
                                <button onClick={() => { pause(); seekToMs(seg.start_ms); setActiveSegmentId(seg.id); setPickedSegId(seg.id) }}
                                  title={`Main video · ${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)}`}
                                  className="flex-1 min-w-0 h-8 flex items-center gap-2 pl-2 pr-1 text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]">
                                  <span className="w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-[5px]" style={{ background: 'rgba(200,255,0,0.14)', color: 'var(--ed-accent-text)' }}>
                                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                      <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
                                    </svg>
                                  </span>
                                  <span className="flex-1 min-w-0 truncate text-[11.5px] font-medium text-[var(--ed-text)]">
                                    Main video
                                  </span>
                                </button>
                                <CtlButtons size="sm" state={seg} can={isFrameLayout(seg.layout) ? ['muted'] : ['hidden', 'muted']} onToggle={k => toggleCtl({ kind: 'section', id: seg.id }, k)} what="the main video here" />
                              </div>
                            )}
                            {items.length === 0 ? (
                              sectionFilter === 'all' ? null : (
                                <span className="px-2.5 py-2 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>None of this kind here.</span>
                              )
                            ) : items.map(it => {
                              const k = SECTION_KINDS.find(x => x.id === it.kind)!
                              const st = it.ctl ? ctlState(it.ctl) : undefined
                              return (
                                <div key={it.key} className="flex items-center gap-1 pr-1" style={{ opacity: st?.hidden ? 0.5 : 1, borderTop: '1px solid rgb(var(--ed-fg) / 0.045)' }}>
                                <button onClick={it.focus}
                                  title={`${k.one} · ${msToLabel(it.start)}–${msToLabel(it.end)} · open its settings`}
                                  className="group/row flex-1 min-w-0 h-8 flex items-center gap-2 pl-2 pr-1 text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.05)]">
                                  {it.thumb
                                    // eslint-disable-next-line @next/next/no-img-element
                                    ? <img src={it.thumb} alt="" className="w-[18px] h-[18px] rounded-[5px] object-cover shrink-0" />
                                    : <span className="w-[18px] h-[18px] shrink-0 flex items-center justify-center rounded-[5px]" style={{ background: `${k.color}24`, color: k.color }}>
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{k.icon}</svg>
                                      </span>}
                                  <span className="flex-1 min-w-0 truncate text-[11.5px] font-medium text-[var(--ed-text)]">{it.name}</span>
                                  <span className="shrink-0 text-[10px] tabular-nums opacity-0 group-hover/row:opacity-100 transition-opacity" style={{ color: 'rgb(var(--ed-fg) / 0.42)' }}>{msToLabel(it.start)}–{msToLabel(it.end)}</span>
                                </button>
                                {it.ctl && <CtlButtons size="sm" state={st} can={it.ctl.kind === 'broll' ? ['hidden', 'muted'] : canCtl(it.ctl)} onToggle={key => toggleCtl(it.ctl!, key)} what={`this ${k.one.toLowerCase()}`} />}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      {gapRow}
                      </Fragment>
                    )
                  })}
                  <p className="flex items-center gap-2 mt-1 px-1 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.38)' }}>
                    <kbd className="px-1.5 py-px rounded text-[10px] font-semibold" style={{ background: 'rgb(var(--ed-fg) / 0.08)', color: 'rgb(var(--ed-fg) / 0.7)', boxShadow: 'inset 0 -1px 0 rgb(var(--ed-fg) / 0.12)' }}>S</kbd>
                    Split at the playhead to add a section
                  </p>
                </div>
              </div>
            )}

            {tool === 'frames' && (
              <FramesPanel
                frames={cropPositions.filter(x => isFrameLayout(x.layout))}
                segment={activeSegment ?? null}
                targetLabel={frameTarget}
                currentTimeMs={currentTimeMs}
                videoTitles={videoTitles}
                selected={activeFrameItemId}
                onApply={handleApplyFrame}
                onOpenFrame={openFrame}
                onSelectItem={selectInFrame}
                onToggleLock={segId => toggleCtl({ kind: 'section', id: segId }, 'locked')}
                onUpdateItem={(segId, id, patch) => {
                  const switchOnly = Object.keys(patch).every(k => k === 'hidden' || k === 'muted')
                  if (switchOnly || !sectionBlocked(segId)) updateFrameItem(segId, id, patch)
                }}
                onRemoveItem={askRemoveFrameItem}
                onUpdateFrame={(segId, patch) => { if (!sectionBlocked(segId)) updateFrame(segId, patch) }}
                onReplaceMedia={(segId, id, kind) => { if (sectionBlocked(segId)) return; pause(); setFramePicker({ segId, kind, replaceId: id }) }}
                onRemoveFrame={askRemoveFrame}
                onRemoveMain={askRemoveMain}
              />
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
                  {/* ── Captions: on/off with its status, the language, and editing the words ── */}
                  <div className="p-4 flex flex-col gap-3">
                    <div className="cap-card">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-2.5">
                          <span className="cap-card-icon" data-on={showCaptions || undefined} aria-hidden="true">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="5" width="18" height="14" rx="3" /><path d="M10 10.5a2 2 0 100 3M16 10.5a2 2 0 100 3" />
                            </svg>
                          </span>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold text-[var(--ed-text)]">Show captions</p>
                            {(transcribing || retranscribing) ? (
                              <p className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ed-accent-text)' }}>
                                <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-t-transparent animate-spin shrink-0" style={{ borderColor: ACCENT, borderTopColor: 'transparent' }} />
                                Generating… this can take a minute
                              </p>
                            ) : words.length > 0 ? (
                              <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                                <span style={{ color: '#4ade80' }}>●</span> {words.length} words ready
                              </p>
                            ) : (
                              <p className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>No captions for this clip yet</p>
                            )}
                          </div>
                        </div>
                        <button role="switch" aria-checked={showCaptions} aria-label="Show captions" onClick={() => turnCaptions(!showCaptions)}
                          className="relative shrink-0 rounded-full transition-colors"
                          style={{ width: 40, height: 22, background: showCaptions ? ACCENT : 'rgb(var(--ed-fg) / 0.15)' }}>
                          <span className="absolute rounded-full transition-all"
                            style={{ top: 3, left: showCaptions ? 21 : 3, width: 16, height: 16, background: showCaptions ? '#0a0a0a' : '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                        </button>
                      </div>
                    </div>

                    {showCaptions && words.length > 0 && (
                      <>
                        <div className="cap-row">
                          <span className="cap-label">Language</span>
                          <div role="radiogroup" aria-label="Caption language" className="cap-seg">
                            {([[false, 'Original', 'As spoken, in its own script'], [true, 'English letters', hasRoman ? `In English letters (${scriptLabel})` : "English letters aren't available for these captions"]] as const).map(([v, label, title]) => {
                              const on = romanize === v
                              const disabled = v && !hasRoman
                              return (
                                <button key={label} role="radio" aria-checked={on} disabled={disabled} title={title}
                                  onClick={() => setRomanize(v)} className="cap-seg-btn" data-on={on || undefined}>
                                  {label}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                        <button onClick={() => setEditingTranscript(true)} className="cap-link">
                          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M9.5 2L12 4.5M2 12l.7-2.8L10 1.5 12.5 4 4.8 11.3 2 12z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          <span className="flex-1 text-left">Edit caption words</span>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                        </button>
                      </>
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

            {tool === 'cleanup' && (
              <div className="flex flex-col gap-3 p-4 min-h-0">
                {fillersToggle('')}
                {words.length === 0 && <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>This needs the clip's captions (transcript) first.</p>}
                {fillerCutList.length > 0 && (
                  <div className="flex flex-col gap-2 min-h-0">
                    {/* The list of cuts folds away with the collapse / expand chevron */}
                    <button type="button" onClick={() => setCutsOpen(v => !v)} aria-expanded={cutsOpen}
                      title={cutsOpen ? 'Hide the list of cuts' : 'Show the list of cuts'} className="tx-fold">
                      <span className="text-xs font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>
                        {fillerCutList.length} cut{fillerCutList.length === 1 ? '' : 's'}{removeFillers ? '' : ' (when switched on)'}
                      </span>
                      <span className="ed-collapse" data-open={cutsOpen || undefined} aria-hidden="true">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
                      </span>
                    </button>
                    {cutsOpen && (
                    <div className="flex flex-col gap-1 overflow-y-auto -mr-2 pr-2" style={{ maxHeight: 420 }}>
                      {fillerCutList.map(c => (
                        <button key={c.at} onClick={() => seekToMs(Math.max(0, c.at - 1000))} title="Play from just before this cut"
                          className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)]"
                          style={{ background: 'rgb(var(--ed-fg) / 0.04)' }}>
                          <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{msToLabel(c.at)}</span>
                          <span className="flex-1 text-xs truncate" style={{ color: 'var(--ed-text)' }}>
                            {c.words.length ? `“${c.words.join(' ')}”` : 'Pause'}
                          </span>
                          <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>−{(c.ms / 1000).toFixed(1)}s</span>
                        </button>
                      ))}
                    </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {tool === 'post' && (
              <div className="p-4">
                <PostText clipId={clip.id} value={postText} onChange={v => setPostText({ title: v.title, post_caption: v.post_caption, hashtags: v.hashtags })} />
              </div>
            )}

            {/* Background music. The file isn't uploaded yet (same as the phone editor):
                TODO(backend): upload the track so the export can mix it in */}
            {tool === 'music' && (
              <>
              {/* The clip's own sound, always first: turn it down or off before adding music */}
              <div className="mx-4 mt-4 p-3 flex flex-col gap-2.5 rounded-xl"
                style={{ background: 'rgb(var(--ed-fg) / 0.04)', border: '1px solid rgb(var(--ed-fg) / 0.1)' }}>
                <div className="flex items-center gap-2.5">
                  <span className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg" style={{ background: 'rgba(200,255,0,0.12)', color: 'var(--ed-accent-text)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" />
                    </svg>
                  </span>
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[13px] font-semibold text-[var(--ed-text)]">Original video sound</span>
                    <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                      {originalMuted ? 'Muted' : `${Math.round(originalVolume * 100)}%`}
                    </span>
                  </span>
                  <button type="button" onClick={() => setOriginalMuted(m => !m)} aria-pressed={originalMuted}
                    aria-label={originalMuted ? 'Turn the original sound back on' : 'Mute the original sound'}
                    title={originalMuted ? 'Turn the original sound back on' : 'Mute the original sound'}
                    className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
                    style={originalMuted
                      ? { background: 'rgba(239,68,68,0.16)', color: '#fca5a5', boxShadow: 'inset 0 0 0 1px rgba(239,68,68,0.45)' }
                      : { background: 'rgb(var(--ed-fg) / 0.06)', color: 'rgb(var(--ed-fg) / 0.8)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M11 5L6 9H2v6h4l5 4V5z" />
                      {originalMuted ? <path d="M22 9l-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" />}
                    </svg>
                  </button>
                </div>
                <input type="range" min={0} max={100} step={1} value={originalMuted ? 0 : Math.round(originalVolume * 100)}
                  onChange={e => { const v = Number(e.target.value) / 100; setOriginalVolume(v); setOriginalMuted(v === 0) }}
                  aria-label="Original video sound volume"
                  className="ed-zoom-range w-full"
                  style={{ '--p': `${originalMuted ? 0 : Math.round(originalVolume * 100)}%` } as React.CSSProperties} />
              </div>
              <AudioMixerPanel tracks={audioTracks} nameOf={musicName}
                selectedId={pickedMusicId} onSelect={pickMusic}
                currentTimeMs={currentTimeMs} clipLengthMs={clipLengthMs} durations={musicDurations}
                onAddTrack={addMusicTrack}
                uploads={musicUploads}
                missing={t => !isMainAudio(t) && !t.storage_path.startsWith('audio/') && !musicEls.current.has(t.id)}
                onReadd={readdMusic}
                notice={musicNotice}
                onRemoveTrack={deleteMusic}
                onUpdateTrack={(id, u) => { if (!blocked({ kind: 'music', id })) setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, ...u } : t)) }} />
              </>
            )}

            {tool === 'broll' && (
              <BrollPanel
                clipId={clip.id}
                currentTimeMs={currentTimeMs}
                shots={brollShots}
                selectedId={pickedShot?.id ?? (playingAdded ? playingSegment?.id ?? null : null)}
                onAdd={addStockBroll}
                onMove={moveBroll}
                onResize={resizeBroll}
                onRemove={removeBroll}
                onSeek={seekToMs}
              />
            )}

            {tool === 'photos' && (
              <PhotoPanel
                photos={overlays.filter(o => o.type === 'image')}
                selectedId={activeOverlayId}
                currentTimeMs={currentTimeMs}
                clipLengthMs={clipLengthMs}
                onSelect={pickPhoto}
                onAdd={() => { pause(); setPickerOnly('photo'); setPickerAtMs(Math.min(currentTimeMs, Math.max(0, clipLengthMs - 500))) }}
                onUpdate={(id, patch) => { if (!blocked({ kind: 'photo', id })) updateOverlay(id, patch) }}
                onRemove={askDeleteOverlay}
                onSeek={seekToMs}
              />
            )}

            {tool === 'text' && (
              <>
              <FrameTextPanel
                segment={frameSeg}
                currentTimeMs={currentTimeMs}
                selectedId={activeFrameItemId}
                onSelect={setActiveFrameItemId}
                onAdd={lane => { if (frameSeg && lane === 'band') addBandText(frameSeg.id, currentTimeMs) }}
                onUpdate={(id, patch) => { if (frameSeg && !sectionBlocked(frameSeg.id)) updateFrameItem(frameSeg.id, id, patch) }}
                onRemove={id => { if (frameSeg) askRemoveFrameItem(frameSeg.id, id) }}
                onUpdateBand={patch => { if (frameSeg && !sectionBlocked(frameSeg.id)) updateFrameBand(frameSeg.id, patch) }}
              />
              <TextOverlayPanel
                overlays={textOverlays}
                currentTimeMs={currentTimeMs}
                clipDurationMs={clip.end_ms - clip.start_ms}
                onAdd={o => setTextOverlays(prev => [...prev, { ...o, id: crypto.randomUUID(), clip_id: clip.id }])}
                focusId={focusTextId}
                onFocused={() => setFocusTextId(null)}
                selectedId={activeTextOverlayId}
                onSelect={pickText}
                onUpdate={(id, patch) => { if (!blocked({ kind: 'text', id })) updateTextOverlay(id, patch) }}
                onRemove={askDeleteTextOverlay}
              />
              </>
            )}

          </div>
          </div>
        </aside>

        {/* Canvas + transport + timeline */}
        <main className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Canvas toolbar: two docks, centred — Layout (a segmented switch with a sliding lime
              highlight) and Tools (Split · Motion · Delete). Styles: .ed-dock* in globals.css */}
          <div className="ed-canvas-bar shrink-0 flex items-center justify-center gap-3 px-4" style={{ minHeight: 60, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <FormatSwitcher
              activeId={activeSegment ? formatLayoutOf(activeSegment.layout) : null}
              play={formatPlay}
              onPick={id => { setFormatPlay(p => ({ id, n: (p?.n ?? 0) + 1 })); handleLayoutChange(id, 'fromPlayhead') }}
            />
            {/* Where a layout picked now goes: from the playhead to the end of this section */}
            {frameTarget && (
              <span className="ed-applies flex flex-col leading-tight text-[10px] tabular-nums whitespace-nowrap" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}
                title="Pick a layout: it starts here and runs to the end of this section">
                <span className="uppercase tracking-wider font-semibold" style={{ color: 'rgb(var(--ed-fg) / 0.35)' }}>Applies</span>
                {frameTarget}
              </span>
            )}

            <div className="ed-dock" role="toolbar" aria-label="Tools">
              <button
                onClick={() => setMotionMode(m => !m)}
                aria-pressed={motionMode}
                title={motionMode
                  ? 'Motion is on: drag the view while the video plays and it follows your hand smoothly'
                  : 'Motion is off: moving the view changes it from the playhead on (a cut). Turn on to record a smooth follow while the video plays'}
                className="ed-press ed-dock-btn select-none" data-rec={motionMode || undefined}
              >
                <span key={motionMode ? 'on' : 'off'} className={motionMode ? 'ed-rec ed-rec-on' : 'ed-rec'} style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: motionMode ? '#ef4444' : 'rgb(var(--ed-fg) / 0.35)',
                }} />
                <span className="ed-dock-label">{motionMode ? 'Recording motion' : 'Motion'}</span>
              </button>
            </div>
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
              {playingAdded && !playingAdded.hidden && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold pointer-events-none"
                  style={{ background: 'rgba(249,115,22,0.85)', color: '#fff' }}>B-roll</div>
              )}
            </div>
          </div>

          {/* The line between the video and the play bar: drag to resize (double-click resets) */}
          {!timelineHidden && (
            <div className="relative shrink-0" style={{ height: 0, zIndex: 30 }}>
              <div role="separator" aria-orientation="horizontal" aria-label="Drag to resize the video and the timeline. Double-click to reset."
                title="Drag to resize · double-click to reset" className="ed-row-handle" data-on={resizing === 'timeline' || undefined}
                onPointerDown={startTimelineResize} onDoubleClick={resetTimelineHeight} />
            </div>
          )}
          {/* Transport */}
          {/* Timeline bar: [show/hide timeline · trim · delete] [previous section · play · next section · time]
              [zoom slider]. Every button has a plain-words tooltip. */}
          <div className="ed-transport shrink-0 grid items-center gap-2 px-3" style={{ gridTemplateColumns: 'minmax(0,1fr) auto minmax(0,1fr)', height: 52, borderTop: '1px solid rgb(var(--ed-fg) / 0.06)', background: 'var(--ed-panel)' }}>
            {/* Left: timeline tools */}
            <div className="ed-transport-tools justify-self-start min-w-0 flex items-center gap-1">
              {/* Show / hide the timeline. The icon is the editor with its bottom panel (the timeline)
                  and an arrow saying what a click does (down = tuck it away, up = bring it back); a
                  label pops up instantly on hover (.ed-tip in globals.css) */}
              <button onClick={() => setTimelineHidden(h => !h)} aria-expanded={!timelineHidden}
                aria-label={timelineHidden ? 'Show the timeline' : 'Hide the timeline'}
                data-tip={timelineHidden ? 'Show timeline' : 'Hide timeline'}
                className="ed-tl-btn ed-tip" data-active={timelineHidden || undefined}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="3" width="18" height="18" rx="3" />
                  <path d="M3 15h18" />
                  <path d="M3.9 15h16.2v4.1a1.9 1.9 0 01-1.9 1.9H5.8a1.9 1.9 0 01-1.9-1.9z" fill="#c8ff00" fillOpacity={timelineHidden ? 0.15 : 0.45} stroke="none" />
                  <path d={timelineHidden ? 'M9 10.5l3-3 3 3' : 'M9 7.5l3 3 3-3'} />
                </svg>
              </button>
              <span className="ed-tl-sep" aria-hidden="true" />
              {/* What's selected — Trim and Delete act on exactly this (click video or music on the timeline) */}
              {(() => {
                const seg = pickedSegId ? segments.find(x => x.id === pickedSegId) ?? null : null
                const segName = seg ? (isShot(seg, mainVideoId) ? 'Video on top' : isFrameLayout(seg.layout) ? `Frame · ${FRAME_TEMPLATES[seg.layout].name}` : LAYOUTS.find(l => l.id === seg.layout)?.label ?? 'Section') : ''
                const kind: 'music' | 'video' | null = pickedMusic ? 'music' : seg ? 'video' : null
                const videoCanTrim = !!seg && canSplitHere && splitSeg?.id === seg.id
                const trimOk = kind === 'music' ? canTrimMusic : kind === 'video' ? videoCanTrim : canSplitHere
                const trimTitle = kind === 'music'
                  ? (canTrimMusic ? 'Trim the selected music: cut it in two at the playhead (then delete the part you don\u2019t want)' : 'Move the playhead inside the selected music to trim it')
                  : kind === 'video'
                    ? (videoCanTrim ? 'Trim the selected video section: cut it in two at the playhead (S)' : 'Move the playhead inside the selected video section to trim it')
                    : (canSplitHere ? 'Trim (S): cut the video section under the playhead in two' : 'Move the playhead inside a section to trim it')
                return (
                  <>
                    <button
                      onClick={() => {
                        setSplitPlay(n => n + 1)
                        if (kind === 'music') trimMusicAtPlayhead(); else splitHere()
                      }}
                      disabled={!trimOk}
                      aria-label={kind === 'music' ? 'Trim the selected music at the playhead' : 'Trim the video at the playhead'}
                      title={trimTitle}
                      className="ed-tl-btn"
                    >
                      <svg key={splitPlay} className={splitPlay ? 'ed-snip' : undefined} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12" />
                      </svg>
                    </button>
                    {/* Delete: whatever is selected — a song, photo, video, text, frame item or section */}
                    {(() => {
                      const del = deleteTarget()
                      return (
                    <button
                      onClick={() => del?.run()}
                      disabled={!del}
                      aria-label={del ? `Delete ${del.label}` : 'Delete'}
                      title={del ? `Delete ${del.label} (Delete key)` : 'Select a video, photo, song, text or section to delete it'}
                      className="ed-tl-btn ed-tl-danger"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                      </svg>
                    </button>
                      )
                    })()}
                    {/* Detach audio: the main video's sound onto its own Music bar */}
                    <button onClick={detachAudio}
                      aria-label={hasMainAudio ? 'Select the detached original sound' : 'Detach the audio from the main video'}
                      title={hasMainAudio ? 'The original sound is on the Music lane — click to select it' : 'Detach audio: the main video\u2019s sound becomes its own bar on the Music lane (trim, move or change its volume)'}
                      className="ed-tl-btn" data-active={hasMainAudio || undefined}>
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9 17V5l10-2v6" /><circle cx="6.5" cy="17" r="2.5" />
                        <path d="M15 14v7M12 18l3 3 3-3" stroke="#c084fc" />
                      </svg>
                    </button>
                    {/* Hide / mute / lock what's picked (a section, a video on top, a photo, a text, music or something in a frame) */}
                    {selTarget && (
                      <>
                        <span className="ed-tl-sep" aria-hidden="true" />
                        <CtlButtons size="md" state={ctlState(selTarget)} can={canCtl(selTarget)} onToggle={k => toggleCtl(selTarget, k)} what={selName} />
                      </>
                    )}
                  </>
                )
              })()}
            </div>

            {/* Centre: previous section · play · next section (the play button sits exactly in the middle) */}
            <div className="flex items-center gap-1.5">
              <button onClick={jumpPrevSection} aria-label="Go to the previous section" title="Previous section"
                className="ed-tl-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="5" y="5" width="2.4" height="14" rx="1" /><path d="M19 5.8v12.4a.8.8 0 01-1.2.7L9.5 12.7a.8.8 0 010-1.4l8.3-6.2a.8.8 0 011.2.7z" /></svg>
              </button>
              {/* Film-reel play button (styles: .ed-play in globals.css) */}
              <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} title={`${playing ? 'Pause' : 'Play'} (Space)`}
                data-playing={playing || undefined}
                className="ed-play w-10 h-10 flex items-center justify-center rounded-full shrink-0 transition-opacity hover:opacity-90" style={{ background: ACCENT }}>
                <span key={playing ? 'pause' : 'play'} className="ed-play-icon flex">
                  {playing
                    ? <svg width="12" height="12" viewBox="0 0 12 12" fill="black"><rect x="2" y="1.5" width="3" height="9" rx="1"/><rect x="7" y="1.5" width="3" height="9" rx="1"/></svg>
                    : <svg width="12" height="12" viewBox="0 0 12 12" fill="black"><path d="M3 1.5l7.5 4.5L3 10.5V1.5z"/></svg>
                  }
                </span>
              </button>
              <button onClick={jumpNextSection} aria-label="Go to the next section" title="Next section"
                className="ed-tl-btn">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="16.6" y="5" width="2.4" height="14" rx="1" /><path d="M5 5.8v12.4a.8.8 0 001.2.7l8.3-6.2a.8.8 0 000-1.4L6.2 5.1A.8.8 0 005 5.8z" /></svg>
              </button>
            </div>

            {/* Right: the time (small) and the timeline zoom */}
            <div className="min-w-0 flex items-center justify-between gap-2">
              <span className="ed-transport-time shrink-0 whitespace-nowrap text-[11px] tabular-nums" aria-label={`${msToClock(currentTimeMs)} of ${msToClock(clipDurationMs)}`}>
                <span className="font-semibold" style={{ color: 'rgb(var(--ed-fg) / 0.85)' }}>{msToTenths(currentTimeMs)}</span>
                <span className="ed-transport-total" style={{ color: 'rgb(var(--ed-fg) / 0.38)' }}> / {msToLabel(clipDurationMs)}</span>
              </span>
              {/* Always at the far end of the bar, with or without the time beside it: undo / redo, then zoom */}
              <div className="ml-auto shrink-0 flex items-center gap-1">
                <UndoRedo />
                <span className="ed-tl-sep" aria-hidden="true" />
                <ZoomSlider zoom={timelineZoom} onZoom={setTimelineZoom} />
              </div>
            </div>
          </div>

          {/* Timeline (hidden with "Hide timeline") */}
          <div ref={timelineRef} data-tour="timeline" hidden={timelineHidden} className="shrink-0 overflow-y-auto px-4 pt-3 pb-4"
            style={{ ...(timelineH ? { height: timelineH } : { maxHeight: '38vh' }), background: 'var(--ed-track)', borderTop: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <SegmentTimeline
              selectedMusicId={pickedMusicId} onSelectMusic={id => pickMusicTrack(id, doubleTap(`m${id}`))}
              photos={overlays.filter(o => o.type === 'image').map(o => ({ id: o.id, start_ms: o.start_ms, end_ms: o.end_ms, url: o.preview_url, hidden: o.hidden, locked: isLocked({ kind: 'photo', id: o.id }) }))}
              activePhotoId={activeOverlayId} onSelectPhoto={id => pickPhoto(id, doubleTap(`p${id}`))}
              onPhotoTimeChange={(id, t) => { if (!blocked({ kind: 'photo', id })) updateOverlay(id, t) }}
              musicTracks={audioTracks.map(t => ({
                id: t.id, start_ms: t.start_ms,
                duration_ms: t.end_ms != null ? t.end_ms - t.start_ms
                  : musicDurations[t.id] != null ? musicDurations[t.id] - (t.offset_ms ?? 0) : undefined,
                name: musicName(t), original: isMainAudio(t), muted: t.muted, locked: isLocked({ kind: 'music', id: t.id }),
              }))}
              onMusicTrim={trimMusicEdge}
              onMusicMove={(id, startMs) => !blocked({ kind: 'music', id }) && setAudioTracks(prev => prev.map(t => {
                if (t.id !== id) return t
                // A trimmed track keeps its length when moved
                const len = t.end_ms != null ? t.end_ms - t.start_ms : null
                return { ...t, start_ms: startMs, ...(len != null ? { end_ms: startMs + len } : {}) }
              }))}
              onAddKind={kind => addMediaAt(kind, Math.round(currentTimeMs))}
              zoom={timelineZoom} onZoomChange={setTimelineZoom} showToolbar={false}
              segments={segments} mainVideoId={mainVideoId} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
              currentTimeMs={currentTimeMs} activeSegmentId={activeSegment?.id ?? null}
              videoUrl={videoUrl} safeDurationMs={clipDurationMs} onSeek={seekToMs}
              sourceAt={trim.toSource} sourceKey={trimsKey}
              clipEdgeLimits={canTrim ? clipEdgeLimits : undefined} onClipEdge={moveClipEdge}
              onSelectSegment={id => setActiveSegmentId(id)}
              onBrollChange={retimeBroll}
              videoUrls={videoUrls}
              onUpdateSegment={(id, updates) => updateSegment(id, updates)}
              onSetEdge={(id, edge, t) => { if (!blocked({ kind: 'section', id })) setSegmentEdge(id, edge, t, clipLengthMs) }}
              onMoveJunction={(l, r, t) => { if (!blocked({ kind: 'section', id: l }) && !blocked({ kind: 'section', id: r })) moveJunction(l, r, t) }}
              onSwallowSection={swallowSection}
              onInsertBrollAfter={handleInsertBrollAfterSeg}
              pickedSegmentId={pickedSegId}
              onPickSegment={id => (id && shots.some(x => x.id === id) ? pickShot(id, doubleTap(`s${id}`)) : pickSection(id, !!id && doubleTap(`s${id}`)))}
              textOverlays={textOverlays.map(o => o.locked || !isLocked({ kind: 'text', id: o.id }) ? o : { ...o, locked: true })} activeTextOverlayId={activeTextOverlayId}
              onSelectTextOverlay={id => { if (id) pickText(id, doubleTap(`t${id}`)); else setActiveTextOverlayId(null) }}
              onTextOverlayUpdate={(id, u) => { if (!blocked({ kind: 'text', id })) updateTextOverlay(id, u) }}
              frameSeg={frameSeg}
              activeFrameItemId={activeFrameItemId}
              laneHighlight={laneHighlight}
              videoTitles={videoTitles}
              onSelectFrameItem={id => selectFrameItem(id, undefined, !!id && doubleTap(`f${id}`))}
              onUpdateFrameItem={(id, patch) => { if (frameSeg && !sectionBlocked(frameSeg.id)) updateFrameItem(frameSeg.id, id, patch) }}
              onJumpToFrameItem={(segId, itemId) => {
                const sg = segments.find(x => x.id === segId)
                const it = sg ? frameOf(sg).items?.find(x => x.id === itemId) : undefined
                if (sg && it) selectInFrame(segId, itemId, Math.max(it.start_ms, sg.start_ms))
              }}
              onAddFrameItem={(lane, anchor) => {
                if (!frameSeg) return
                pause()
                if (lane === 'band') { addBandText(frameSeg.id, currentTimeMs); return }
                setAddMenu({ segId: frameSeg.id, lane, t: currentTimeMs, anchor })
              }}
              viewMarkers={viewMarkers}
              selectedViewT={selectedView && viewBox && selectedView.boxId === viewBox.id ? selectedView.t : null}
              onSelectView={t => {
                if (!viewBox) return
                pause()
                setSelectedView({ boxId: viewBox.id, t })
                seekToMs(t)
              }}
              onMoveView={(from, to) => {
                if (!viewBox || !activeSegment || sectionBlocked(activeSegment.id)) return
                moveViewChange(viewBox.id, from, to, activeSegment.start_ms, activeSegment.end_ms)
                const moved = viewChanges(useEditorStore.getState().keyframes[viewBox.id] ?? [])
                  .reduce((best, v) => Math.abs(v.t_ms - to) < Math.abs(best - to) ? v.t_ms : best, from)
                setSelectedView({ boxId: viewBox.id, t: moved })
                // The preview shows that moment, with this view: you see where the key is going
                pause()
                seekToMs(moved)
                return moved
              }}
              onRemoveView={t => {
                if (!viewBox || viewMarkers.length <= 1 || (activeSegment && sectionBlocked(activeSegment.id))) return
                removeViewChange(viewBox.id, t)
                setSelectedView(null)
              }}
              onDuplicateView={t => {
                if (!viewBox || !activeSegment || sectionBlocked(activeSegment.id)) return
                pause()
                const at = duplicateViewChange(viewBox.id, t, activeSegment.end_ms)
                if (at == null) { notifyLocked('No room for a copy right after this view — move the next one or pick another'); return }
                // The copy is picked, under the playhead: drag it wherever it should go
                setSelectedView({ boxId: viewBox.id, t: at })
                seekToMs(at)
              }}
            />
          </div>
        </main>

        {/* Right column: 9:16 output preview, always visible */}
        {/* Closed: a slim rail to bring the Preview back */}
        {!previewOpen && (
          <div className="ed-preview-rail shrink-0 flex flex-col items-center gap-2 py-3" style={{ width: 52, background: 'var(--ed-panel)', borderLeft: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
            <button onClick={() => togglePreview(true)} aria-label="Open the preview" title="Open the preview"
              className="w-9 h-9 flex items-center justify-center rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
              style={{ color: 'rgb(var(--ed-fg) / 0.7)' }}>
              <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><SidebarIcon open={false} /></span>
            </button>
            <button onClick={() => togglePreview(true)} title="Open the preview to watch and export"
              className="text-[11px] font-semibold tracking-wide transition-colors hover:text-[var(--ed-text)]"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', color: 'rgb(var(--ed-fg) / 0.5)' }}>
              Preview · Export
            </button>
          </div>
        )}
        <aside data-tour="export" aria-hidden={!previewOpen} className="ed-preview-col relative shrink-0 flex flex-col min-h-0 overflow-hidden" data-open={previewOpen || undefined} data-resizing={resizing === 'preview' || undefined}
          style={{ width: previewOpen ? previewW : 0, background: 'var(--ed-panel)' }}
          {...(!previewOpen ? { inert: true } : {})}>
          {/* Its left edge: drag to make the preview wider or narrower */}
          {previewOpen && (
            <div role="separator" aria-orientation="vertical" aria-label="Drag to resize the preview. Double-click to reset."
              title="Drag to resize · double-click to reset" className="ed-col-handle" style={{ left: 0 }} data-on={resizing === 'preview' || undefined}
              onPointerDown={e => startColumnResize(e, 'preview')} onDoubleClick={() => resetColumn('preview')} />
          )}
          <div className="ed-preview-inner flex flex-col min-h-0 h-full" style={{ width: previewW }}>
          <div className="shrink-0 px-4 flex items-center justify-between" style={{ height: 48, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <span className="flex items-center gap-1">
              <button onClick={() => togglePreview(false)} aria-label="Close the preview" title="Close the preview (more room to edit)"
                className="-ml-1.5 w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                style={{ color: 'rgb(var(--ed-fg) / 0.55)' }}>
                <span style={{ display: 'inline-flex', transform: 'scaleX(-1)' }}><SidebarIcon open /></span>
              </button>
              <span className="text-sm font-semibold text-[var(--ed-text)]">Preview</span>
            </span>
            <div className="flex items-center gap-1.5">
              {rendering ? (
                // While the reel renders, the Export button stays and keeps playing its download
                // animation on a loop (.ed-export[data-busy] in globals.css) until it's done
                <span className="sbb ed-export" data-busy role="status"
                  aria-label={exporting ? 'Starting the export' : `Exporting, ${formatElapsed(renderElapsed)} so far`}
                  title={exporting ? 'Starting…' : `Exporting · ${formatElapsed(renderElapsed)}`}>
                  <span className="sbb-beam" aria-hidden="true" />
                  <span className="sbb-surface gap-1.5 h-8 px-3.5 text-xs font-bold">
                    <ExportIcon /> Exporting
                  </span>
                </span>
              ) : hasOutput ? (
                <>
                  <button onClick={() => requestExport(true)} aria-label="Re-render"
                    title="Render again with your latest edits. Captions are regenerated too."
                    className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]"
                    style={{ color: 'rgb(var(--ed-fg) / 0.75)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.14)' }}>
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M20 11a8 8 0 10-2.3 5.7M20 4v7h-7" />
                    </svg>
                  </button>
                  <a href={`/api/clips/${clip.id}/download`} download
                    className="flex items-center gap-1.5 h-8 px-3 rounded-lg text-xs font-bold transition-opacity hover:opacity-90"
                    style={{ background: ACCENT, color: '#000' }}>
                    <DownloadIcon /> Download
                  </a>
                </>
              ) : (
                // Lime button with a light spinning round its border on hover (SpinningBorderButton);
                // clicking plays the download animation (.ed-export) before the render starts
                <SpinningBorderButton onClick={pressExport}
                  title="Render the reel so you can download it"
                  aria-busy={exportPress || undefined}
                  data-pressed={exportPress || undefined}
                  className="ed-export rounded-[10px]"
                  surfaceClassName="gap-1.5 h-8 px-3.5 text-xs font-bold">
                  <ExportIcon /> Export
                </SpinningBorderButton>
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
                  <BrandLoader size={48} />
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
                  videoRef={videoRef} currentTimeMs={currentTimeMs} clipStartMs={clip.start_ms} videoToTimeline={videoToTimeline}
                  activeSegment={viewSegment} getPositionAt={viewGetPositionAt} sourceFor={brollSource} slotSourceFor={borrowed.slotSourceFor}
                  skipTransitionRef={skipCanvasTransitionRef} words={displayWords}
                  captionStyle={captionStyle} captionTextCase={captionTextCase} showCaptions={showCaptions}
                  overlays={overlays.filter(o => !o.hidden)} activeOverlayId={activeOverlayId}
                  onOverlayChange={(id, u) => { if (!blocked({ kind: 'photo', id })) updateOverlay(id, u) }} onSelectOverlay={id => { const o = overlays.find(x => x.id === id); if (o?.type === 'image') pickPhoto(id); else { setActiveOverlayId(id); setLastPick('overlay') } }} onDeleteOverlay={askDeleteOverlay}
                  textOverlays={textOverlays.filter(o => !o.hidden)} activeTextOverlayId={activeTextOverlayId}
                  onTextOverlayChange={(id, u) => { if (!blocked({ kind: 'text', id })) updateTextOverlay(id, u) }} onSelectTextOverlay={id => { if (id) pickText(id, false); else setActiveTextOverlayId(null) }}
                  editTextOverlayId={previewOpen ? editTextId : null} onEditTextDone={() => setEditTextId(null)} onDeleteTextOverlay={askDeleteTextOverlay}
                  onCaptionPositionChange={y => updateCaptionStyle({ position_y: y })}
                  frameMedia={framePool}
                  onFrameLaneClick={focusLane}
                  activeFrameItemId={activeFrameItemId}
                  onFrameItemClick={selectFrameItem}
                  onFrameItemChange={(id, patch) => { if (frameSeg && !sectionBlocked(frameSeg.id)) updateFrameItem(frameSeg.id, id, patch) }}
                  onFrameRowsChange={heights => { if (frameSeg && !sectionBlocked(frameSeg.id)) updateFrame(frameSeg.id, { row_h: heights }) }}
                  onFrameMainRectChange={(slot, rect) => {
                    if (!frameSeg || sectionBlocked(frameSeg.id)) return
                    const rects = { ...frameOf(frameSeg).main_rects }
                    if (rect) rects[String(slot)] = rect; else delete rects[String(slot)]
                    updateFrame(frameSeg.id, { main_rects: rects })
                  }}
                  style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10, border: '1px solid rgb(var(--ed-fg) / 0.1)', boxShadow: '0 4px 24px rgba(0,0,0,0.6)' }}
                />
              )}
              {!rendering && <PlatformOverlay platform={platform} />}
              </div>
            </div>
          </div>

          </div>
        </aside>
      </div>

      {confirmDialog}

      {/* Why an edit didn't happen: something is locked */}
      {lockNote && (
        <div role="status" className="fixed left-1/2 bottom-6 -translate-x-1/2 flex items-center gap-2 px-3.5 h-9 rounded-full text-xs font-medium pointer-events-none"
          style={{ zIndex: 130, background: 'var(--ed-popover)', color: 'var(--ed-text)', boxShadow: '0 0 0 1px rgba(200,255,0,0.35), 0 12px 32px -8px rgba(0,0,0,0.7)' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#c8ff00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
          {lockNote}
        </div>
      )}

      {/* The timeline's "+" menu: photos / videos into a frame slot (Dual, Trio…), B-roll, music, text */}
      {addMenu && (() => {
        const seg = segments.find(x => x.id === addMenu.segId)
        if (!seg || !isFrameLayout(seg.layout)) return null
        const lane = frameLanes(seg.layout).find(l => l.lane === addMenu.lane)
        const main = frameOf(seg).main_slots ?? [0]
        return (
          <FrameAddMenu lane={addMenu.lane} laneLabel={lane?.label ?? ''} anchor={addMenu.anchor}
            offers={slotOffers(seg.layout, typeof addMenu.lane === 'number' ? addMenu.lane : 0)}
            canAddMain={typeof addMenu.lane === 'number' && !main.includes(addMenu.lane)}
            onChoose={handleAddChoice}
            onClose={() => setAddMenu(null)} />
        )
      })()}

      {framePicker && (
        <MediaPickerModal clipId={clip.id} atMs={currentTimeMs} initialTab={framePicker.kind === 'photo' ? 'image' : framePicker.replaceId ? 'videos' : 'upload'}
          only={framePicker.kind === 'photo' ? 'photo' : 'video'}
          onInsertVideo={handlePickedVideo} onInsertImage={handlePickedPhoto}
          onClose={() => setFramePicker(null)} />
      )}

      {pickerAtMs !== null && (
        <MediaPickerModal clipId={clip.id} atMs={pickerAtMs}
          only={pickerOnly ?? undefined}
          initialTab={pickerOnly === 'photo' ? 'image' : pickerOnly === 'video' ? 'videos' : undefined}
          onInsertVideo={handleInsertBroll} onInsertImage={handleInsertImage}
          onClose={() => { setPickerAtMs(null); setPickerOnly(null) }} />
      )}

      {/* "+" → Music: pick an audio file; it goes in at the start, or so it ends with the clip */}
      <input ref={musicInputRef} type="file" accept="audio/*,video/*" className="hidden" aria-hidden="true" tabIndex={-1}
        onChange={e => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          addMusicTrack(f, musicAtRef.current)
          setTool('music'); toggleOptions(true)
        }} />
    </div>
  )
}

// ── Hide / mute / lock ─────────────────────────────────────────────────────────

type CtlKey = 'hidden' | 'muted' | 'locked'
// 'section' = the main video in a section (its sound, its lock); 'broll' = a video added over the
// main video (shown or hidden, its own sound on or off — it IS its section, so its lock is the section's)
// 'frameItem' = a photo, video or text in a frame (segId: its frame)
type CtlTarget = { kind: 'section' | 'broll' | 'photo' | 'text' | 'music' | 'frameItem'; id: string; segId?: string }

/** Eye / speaker / lock toggles. Lit (red for hide and mute, lime for lock) when that state is on. */
function CtlButtons({ state, can, onToggle, size, what, inert }: {
  state: { hidden?: boolean; muted?: boolean; locked?: boolean } | undefined
  can: CtlKey[]
  onToggle: (k: CtlKey) => void
  size: 'sm' | 'md'
  what: string
  /** Switches that have no effect right now (e.g. the main video under a video on top): dimmed, with why */
  inert?: CtlKey[]
}) {
  const label = (k: CtlKey, on: boolean) => k === 'hidden' ? (on ? `Show ${what} again` : `Hide ${what} (not shown or exported)`)
    : k === 'muted' ? (on ? `Turn the sound of ${what} back on` : `Mute ${what}`)
      : on ? `Unlock ${what}` : `Lock ${what} (it can't be moved, trimmed or deleted)`
  const icon = (k: CtlKey, on: boolean) => k === 'hidden'
    ? (on ? <><path d="M3 3l18 18" /><path d="M10.6 5.1A10 10 0 0112 5c5 0 9 5 9 7a11 11 0 01-2.2 3.2M6.6 6.6C4.4 8 3 10.4 3 12c0 2 4 7 9 7a9.6 9.6 0 004.4-1.1" /><path d="M9.9 9.9a3 3 0 004.2 4.2" /></>
      : <><path d="M3 12c0-2 4-7 9-7s9 5 9 7-4 7-9 7-9-5-9-7z" /><circle cx="12" cy="12" r="3" /></>)
    : k === 'muted'
      ? (on ? <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M22 9l-6 6M16 9l6 6" /></> : <><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" /></>)
      : (on ? <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></> : <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 017.6-1.7" /></>)
  const px = size === 'sm' ? 22 : 30, ic = size === 'sm' ? 12 : 16
  return (
    <span className={`shrink-0 flex items-center ${size === 'sm' ? 'gap-px' : 'gap-0.5'}`} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
      {can.map(k => {
        const on = !!state?.[k]
        const tint = k === 'locked' ? 'var(--ed-accent-text)' : '#f87171'
        const why = inert?.includes(k)
          ? (k === 'hidden' ? ' — no change yet: the video on top covers the main video here (hide that video to see this)'
            : ' — no change yet: the video on top plays its own sound here (mute that video to hear this)')
          : ''
        return (
          <button key={k} type="button" onClick={() => onToggle(k)} aria-pressed={on} aria-label={label(k, on) + why} title={label(k, on) + why}
            className={size === 'md' ? 'ed-tl-btn' : 'flex items-center justify-center rounded-md transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)]'}
            style={{ width: px, height: px, color: on ? tint : 'rgb(var(--ed-fg) / 0.45)', background: on ? (k === 'locked' ? 'rgba(200,255,0,0.12)' : 'rgba(239,68,68,0.12)') : undefined, opacity: why ? 0.4 : 1 }}>
            <svg width={ic} height={ic} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icon(k, on)}</svg>
          </button>
        )
      })}
    </span>
  )
}

// A music track that is the main video's own sound, detached onto the Music lane
const MAIN_AUDIO_PREFIX = 'main-video:'
const isMainAudio = (t: { storage_path: string }) => t.storage_path.startsWith(MAIN_AUDIO_PREFIX)

// ── What's in a section (Format panel) ─────────────────────────────────────────

type SectionItemKind = 'video' | 'photo' | 'text' | 'music'
type SectionItem = { key: string; kind: SectionItemKind; name: string; start: number; end: number; thumb?: string | null; focus: () => void; ctl?: CtlTarget }
const SECTION_KINDS: { id: SectionItemKind; one: string; plural: string; color: string; icon: React.ReactNode }[] = [
  { id: 'video', one: 'Video', plural: 'Videos', color: '#f97316', icon: <><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></> },
  { id: 'photo', one: 'Photo', plural: 'Photos', color: '#60a5fa', icon: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></> },
  { id: 'text', one: 'Text', plural: 'Text', color: '#f472b6', icon: <path d="M4 7V4h16v3M9 20h6M12 4v16" /> },
  { id: 'music', one: 'Song', plural: 'Music', color: '#c084fc', icon: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></> },
]

// ── Small UI pieces ───────────────────────────────────────────────────────────

/** A length in words people read at a glance: "11s", "1m 05s" */
function lengthLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function GapRow({ gap, active, onSelect, onAdd }: {
  gap: { start_ms: number; end_ms: number }
  active: boolean
  onSelect: () => void
  onAdd: () => void
}) {
  return (
    <div role="button" tabIndex={0} onClick={onSelect} onKeyDown={e => { if (e.key === 'Enter') onSelect() }}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-[rgb(var(--ed-fg)/0.04)]"
      style={{ background: active ? 'rgb(var(--ed-fg) / 0.05)' : undefined, border: '1px dashed rgb(var(--ed-fg) / 0.16)' }}>
      <span className="shrink-0 w-7 h-8 flex items-center justify-center rounded-md" style={{ border: '1px dashed rgb(var(--ed-fg) / 0.25)', color: 'rgb(var(--ed-fg) / 0.4)' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2" /></svg>
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="text-xs font-medium truncate" style={{ color: 'rgb(var(--ed-fg) / 0.6)' }}>Default framing</span>
        <span className="text-[11px] tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.38)' }}>{msToLabel(gap.start_ms)} → {msToLabel(gap.end_ms)}</span>
      </span>
      <button onClick={e => { e.stopPropagation(); onAdd() }} title="Give this part its own layout"
        className="shrink-0 h-7 px-2.5 flex items-center gap-1 rounded-lg text-[11px] font-bold transition-opacity hover:opacity-90"
        style={{ color: '#000', background: '#C8FF00' }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        Add
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
/**
 * Layout switch for the section under the playhead: a dock of the four formats with a lime highlight
 * that slides to the picked one (measured from the buttons, so it fits any label length or language).
 */
function FormatSwitcher({ activeId, play, onPick }: {
  activeId: LayoutType | null
  play: { id: LayoutType; n: number } | null
  onPick: (id: LayoutType) => void
}) {
  const btns = useRef(new Map<LayoutType, HTMLButtonElement>())
  const [box, setBox] = useState<{ left: number; width: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const el = activeId ? btns.current.get(activeId) : null
      setBox(el ? { left: el.offsetLeft, width: el.offsetWidth } : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    for (const el of btns.current.values()) ro.observe(el)
    window.addEventListener('resize', measure)
    return () => { ro.disconnect(); window.removeEventListener('resize', measure) }
  }, [activeId])

  return (
    <div role="radiogroup" aria-label="Layout" data-tour="formats" className="ed-dock relative">
      {box && <span className="ed-dock-glider" style={{ left: box.left, width: box.width }} aria-hidden="true" />}
      {LAYOUTS.map(l => {
        const on = activeId === l.id
        return (
          <button key={l.id} role="radio" aria-checked={on}
            ref={el => { if (el) btns.current.set(l.id, el); else btns.current.delete(l.id) }}
            onClick={() => onPick(l.id)}
            title={`${l.label} layout`}
            className="ed-press ed-dock-btn ed-dock-choice" data-on={on || undefined}>
            <LayoutGlyph key={play?.id === l.id ? play.n : 0} layout={l.id}
              color={on ? 'var(--ed-accent-text)' : 'rgb(var(--ed-fg) / 0.5)'} active={on} play={play?.id === l.id} />
            <span className="ed-dock-label">{l.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/**
 * Phone-shaped icon of a format. When `play` is set (just clicked) it acts out its format
 * (styles: .ed-glyph-* in globals.css): Vertical fills the screen top to bottom, Split screen
 * slides its two halves in from the top and bottom, Trio stacks its three panes one by one,
 * Horizontal widens into a landscape band.
 */
function LayoutGlyph({ layout, color, play = false }: { layout: LayoutType; color: string; active: boolean; play?: boolean }) {
  const fill = color
  return (
    <svg width="12" height="18" viewBox="0 0 12 18" aria-hidden="true" className={`shrink-0 overflow-visible${play ? ` ed-glyph ed-glyph-${layout}` : ''}`}>
      <rect className="ed-glyph-frame" x="0.75" y="0.75" width="10.5" height="16.5" rx="2" fill="none" stroke={fill} strokeWidth="1.5" />
      {layout === 'vertical' && <rect className="ed-glyph-p1" x="2.5" y="2.5" width="7" height="13" rx="1" fill={fill} opacity="0.55" />}
      {layout === 'split' && <><rect className="ed-glyph-p1" x="2.5" y="2.5" width="7" height="5.6" rx="1" fill={fill} opacity="0.55" /><rect className="ed-glyph-p2" x="2.5" y="9.9" width="7" height="5.6" rx="1" fill={fill} opacity="0.55" /></>}
      {layout === 'trio' && <><rect className="ed-glyph-p1" x="2.5" y="2.5" width="7" height="3.7" rx="0.8" fill={fill} opacity="0.55" /><rect className="ed-glyph-p2" x="2.5" y="7.15" width="7" height="3.7" rx="0.8" fill={fill} opacity="0.55" /><rect className="ed-glyph-p3" x="2.5" y="11.8" width="7" height="3.7" rx="0.8" fill={fill} opacity="0.55" /></>}
      {layout === 'horizontal' && <rect className="ed-glyph-p1" x="2.5" y="6.5" width="7" height="5" rx="1" fill={fill} opacity="0.55" />}
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
/** The format a section counts as: frames are one vertical 9:16 reel, so they're Vertical */
function formatLayoutOf(layout: LayoutType): LayoutType {
  return isFrameLayout(layout) ? 'vertical' : layout
}

/** A field the user types text into (not a slider, colour picker, checkbox…) */
function isTextEntry(el: Element | null | undefined): boolean {
  if (!el) return false
  if ((el as HTMLElement).isContentEditable || el.tagName === 'TEXTAREA') return true
  if (el.tagName !== 'INPUT') return false
  return ['text', 'number', 'search', 'email', 'url', 'tel', 'password', ''].includes((el as HTMLInputElement).type)
}

// Undo / redo, in the play bar next to the zoom (shortcuts: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z)
function UndoRedo() {
  const { canUndo, canRedo } = useHistory()
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const mod = mac ? '⌘' : 'Ctrl+'
  const btn = 'ed-tl-btn'
  return (
    <div className="flex items-center gap-0.5 shrink-0" role="group" aria-label="Undo and redo">
      <button onClick={undo} disabled={!canUndo} aria-label="Undo" title={`Undo (${mod}Z)`} className={btn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 010 11H11" /></svg>
      </button>
      <button onClick={redo} disabled={!canRedo} aria-label="Redo" title={`Redo (${mod}${mac ? '⇧Z' : 'Shift+Z'})`} className={btn}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 14l5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 000 11H13" /></svg>
      </button>
    </div>
  )
}

function SaveIndicator({ state, leaving, onRetry }: { state: SaveState; leaving?: boolean; onRetry: () => void }) {
  const chip = 'flex items-center gap-1.5 shrink-0 h-6 px-2 rounded-full text-[11px] font-medium'
  if (state === 'error') {
    return (
      <span role="alert" className={chip} style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.12)' }}>
        Couldn&apos;t save · <button onClick={onRetry} className="underline hover:opacity-80">Retry</button>
      </span>
    )
  }
  if (state === 'retrying') {
    return (
      <span className={chip} style={{ color: '#fcd34d', background: 'rgba(245,158,11,0.12)' }} aria-live="polite"
        title="The connection dropped — your changes are kept here and will save as soon as it's back">
        Connection lost · retrying… <button onClick={onRetry} className="underline hover:opacity-80">Now</button>
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

/** A clean up-right arrow (the reel going out); the Export press and the exporting loop animate it */
function ExportIcon() {
  return (
    <svg className="ed-export-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ overflow: 'visible' }}>
      <g className="ed-export-arrow"><path d="M4.5 11.5l7-7M6 4.5h5.5V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></g>
    </svg>
  )
}

function TrashIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 3h8M5 3V2h2v1M4.5 3v6M7.5 3v6M3 3l.5 7h5L9 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/></svg>
}

/** 00:26.10 — minutes, seconds and hundredths, like a video editor's timecode */
function msToClock(ms: number) {
  const cs = Math.floor(Math.max(0, ms) / 10)
  const s = Math.floor(cs / 100)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

/** Timeline zoom as − 1x +: each press one step (1x → 1.25x → 1.5x → 2x → 3x → 4x); click the value for 1x */
function ZoomSlider({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const i = zoom > 1 ? 1 : 0   // zoomed in or not
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Timeline zoom"
      title="Pinch on the trackpad, or scroll the mouse wheel over the video strip, to zoom">
      <button onClick={() => onZoom(zoomStep(zoom, -1))} disabled={i === 0} aria-label="Zoom out" title="Zoom out" className="ed-tl-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-4-4" /></svg>
      </button>
      <button onClick={() => onZoom(1)} disabled={i === 0} aria-live="polite" aria-label={`Zoom ${zoomLabel(zoom)}x${i ? ', back to 1x' : ''}`}
        title={i ? 'Back to the whole clip (1x)' : 'Whole clip'}
        className="h-7 min-w-[46px] px-2 rounded-md text-xs font-semibold tabular-nums transition-colors disabled:cursor-default"
        style={i ? { background: 'rgba(200,255,0,0.14)', color: 'var(--ed-accent-text)', boxShadow: 'inset 0 0 0 1px rgba(200,255,0,0.35)' }
          : { color: 'rgb(var(--ed-fg) / 0.7)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.12)' }}>
        {zoomLabel(zoom)}x
      </button>
      <button onClick={() => onZoom(zoomStep(zoom, 1))} disabled={zoom >= MAX_ZOOM} aria-label="Zoom in" title="Zoom in" className="ed-tl-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M11 8v6M20 20l-4-4" /></svg>
      </button>
    </div>
  )
}

function msToTenths(ms: number) {
  const tenths = Math.floor(Math.max(0, ms) / 100)
  const s = Math.floor(tenths / 10)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`
}

function formatElapsed(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
