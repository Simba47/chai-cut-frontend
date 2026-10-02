'use client'

import { useState, useEffect, useLayoutEffect, useRef, useMemo, Fragment } from 'react'
import type { Clip, Segment, CropBox, BoxKeyframe, CaptionStyle, TextOverlay, AudioTrack, Transition, TranscriptWord, LayoutType, Overlay } from '@chai-cut/shared'
import { VideoPreview, OutputCanvas } from '@/components/editor/VideoPreview'
import { computeCutRanges, reactionRanges, removedMs } from '@/lib/cuts'
import { PostText, type PostTextValue } from '@/components/clips/PostText'
import { BrollPanel, type StockResult } from '@/components/editor/BrollPanel'
import { useBrollSources, useBorrowedSlots } from '@/modules/editor/brollSources'
import { SegmentTimeline, ZOOM_STEPS, LAYOUT_COLORS } from '@/components/editor/SegmentTimeline'
import { TranscriptPanel } from '@/components/editor/TranscriptPanel'
import { CaptionStyler } from '@/components/editor/CaptionStyler'
import { TextOverlayPanel } from '@/components/editor/TextOverlayPanel'
import { AudioMixerPanel } from '@/components/editor/AudioMixerPanel'
import { MediaPickerModal } from '@/components/editor/MediaPickerModal'
import { AccountMenu } from '@/components/ui/account-menu'
import { BrandLogo } from '@/components/ui/brand-logo'
import { BrandLoader } from '@/components/ui/brand-loader'
import { ShinyButton } from '@/components/ui/shiny-button'
import { FramesPanel } from '@/components/editor/FramesPanel'
import { FrameTextPanel } from '@/components/editor/FrameTextPanel'
import { useConfirm } from '@/components/editor/ConfirmDialog'
import { EditorTour, hasSeenEditorTour } from '@/components/editor/EditorTour'
import { FrameAddMenu, type AddChoice } from '@/components/editor/FrameAddMenu'
import { createFrameMediaPool } from '@/modules/editor/frameMedia'
import { FRAME_TEMPLATES, isFrameLayout, frameOf, frameLanes, frameSlotLabels, emptySlotStretches, slotOffers, DEFAULT_BAND } from '@/modules/editor/frames'
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
import { viewChanges } from '@/modules/editor/views'
import type { SegmentLocal, FrameLayout, FrameLane, FrameItem } from '@chai-cut/shared'

type Tool = 'format' | 'frames' | 'captions' | 'text' | 'broll' | 'music' | 'cleanup' | 'post'
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
    hint: 'Each format is a section of the clip with its own layout. Picking a layout changes the whole format under the playhead (use Split or S to cut one in two). Move the view at any moment to change it from there on — each change is a ◆ on the timeline.',
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
    neighbourFraming, joinSameLayoutNeighbours, setViewAt, recordMotionAt, removeViewChange, moveViewChange,
    placeBroll, removeBroll: removeBrollShot,
    upsertKeyframe, setBoxKeyframes, getPositionAt, updateFrameBand,
    updateFrame, addFrameItem, updateFrameItem, removeFrameItem,
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
    setActiveOverlayId, updateOverlay, deleteOverlay,
    updateTextOverlay, deleteTextOverlay,
  } = useMediaStore()

  // Loading the clip changes the stores but isn't an edit: remember the loaded state, and only
  // start auto-saving once the state differs from it (opening a clip must not write anything)
  const loadedStateRef = useRef<EditableSnapshot | null>(null)
  const editedSinceLoadRef = useRef(false)

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

    // Captions on/off: the saved choice when the clip has a caption style; a clip without one yet
    // starts with captions on if it has words (a style saved before the on/off field counts as on)
    const savedStyle = initialCaptionStyles[0]
    // Off until switched on (captions cost money to make); a clip with a saved style keeps its choice
    const showCaptions = savedStyle ? savedStyle.enabled !== false : false
    hydrateCaptions(initialWords, savedStyle ?? { color: '#FFE700' }, showCaptions)

    hydrateMedia({
      overlays: initialOverlays,
      textOverlays: initialTextOverlays,
      audioTracks: initialAudioTracks,
      transitions: initialTransitions,
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
  const clipHasWords = (list: { start_ms: number }[]) => list.some(w => w.start_ms >= clip.start_ms && w.start_ms < clip.end_ms)
  const [transcribing, setTranscribing] = useState(
    !clipHasWords(initialWords) && (captionsPending || (videoStatus !== 'ready' && videoStatus !== 'failed'))
  )
  const [isFreePlan, setIsFreePlan] = useState(false)
  const [tool, setTool] = useState<Tool>('format')
  const [optionsOpen, setOptionsOpen] = useState(true)
  // First-time tour: opens once the page has settled; the header's "?" replays it
  const [tourOpen, setTourOpen] = useState(false)
  useEffect(() => {
    if (hasSeenEditorTour()) return
    const t = setTimeout(() => setTourOpen(true), 900)
    return () => clearTimeout(t)
  }, [])
  const [editingTranscript, setEditingTranscript] = useState(false)
  const [pickerAtMs, setPickerAtMs] = useState<number | null>(null)
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
  const brollSource = useBrollSources(videoRef, clip.start_ms, id => videoLibraryRef.current[id]?.url, mainVideoId)
  // Borrowed reaction slots (Make my clips): the clip's own video from another moment, per slot
  const borrowed = useBorrowedSlots(videoRef, clip.start_ms, mainVideoId, videoUrl)
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
  // Lengths of music files added in this session (read from the file), so their timeline bars
  // show the right length; tracks without one run to the clip's end
  const [musicDurations, setMusicDurations] = useState<Record<string, number>>({})
  // The main video's own sound (top of the Music panel). Applied to the preview here.
  // TODO(backend): save originalVolume / originalMuted with the clip and mix them in at export
  const [originalVolume, setOriginalVolume] = useState(1)
  const [originalMuted, setOriginalMuted] = useState(false)
  // The frame sound sync sets the main video's volume every frame, so the level goes through it
  // (it multiplies each frame's own slot sound); mute is the element's own switch
  useEffect(() => {
    framePool.setMainGain(originalVolume)
    const v = videoRef.current
    if (!v) return
    v.volume = Math.max(0, Math.min(1, originalVolume))
    v.muted = originalMuted
  }, [originalVolume, originalMuted]) // framePool never changes (made once), so it isn't a dependency
  // Music heard in the preview: one <audio> per track added in this session, playing the picked
  // file in step with the video (tracks loaded from a saved clip have no file here yet)
  const musicEls = useRef(new Map<string, HTMLAudioElement>())
  function addMusicTrack(f: File) {
    const id = crypto.randomUUID()
    // The music starts where the playhead is (where you paused), not at the start of the clip
    const startMs = Math.max(0, Math.round(currentTimeMs))
    setAudioTracks(prev => [...prev, { id, clip_id: clip.id, storage_path: f.name, start_ms: startMs, volume: 0.5, duck_under_speech: true }])
    const a = new Audio()
    a.preload = 'auto'
    a.onloadedmetadata = () => { if (isFinite(a.duration)) setMusicDurations(d => ({ ...d, [id]: Math.round(a.duration * 1000) })) }
    a.src = URL.createObjectURL(f)
    musicEls.current.set(id, a)
  }
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
      el.volume = Math.max(0, Math.min(1, tr.volume ?? 0.5))
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
  }, [playing, currentTimeMs, audioTracks])
  useEffect(() => () => { for (const el of musicEls.current.values()) { el.pause(); URL.revokeObjectURL(el.src) } }, [])
  // The timeline's "+" menu: where it was opened (start / end of the clip) and where to show it
  const [plusMenu, setPlusMenu] = useState<{ where: 'start' | 'end'; anchor: DOMRect } | null>(null)
  // The section the user clicked (on the timeline strip or its card): the Delete buttons show only then
  const [pickedSegId, setPickedSegIdState] = useState<string | null>(null)
  // Music track selected on the timeline (Trim / Delete act on it). Only one thing is selected:
  // picking a video section clears the music, and the other way round
  const [pickedMusicId, setPickedMusicId] = useState<string | null>(null)
  const setPickedSegId = (id: string | null) => { setPickedSegIdState(id); setPickedMusicId(null) }
  const pickMusic = (id: string) => { setPickedSegIdState(null); setPickedMusicId(id) }
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
          removeFillers: removeFillersRef.current,
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

  /** Captions on: made now for this clip if it has none yet (nothing is captioned until asked) */
  function turnCaptions(on: boolean) {
    setShowCaptions(on)
    if (on && !clipHasWords(words) && !transcribing && !retranscribing && !isFreePlan) handleRetranscribe('unknown')
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

  // Format buttons ('section'): the layout changes the WHOLE format under the playhead (or the whole
  // uncovered stretch there). It starts from the view of the nearest format with that layout, and
  // joins touching neighbours with the same layout — so Split → Vertical leaves no pieces behind.
  // Cutting a format in two is its own action (Split, below).
  // Frames ('fromPlayhead'): picking a frame mid-format starts a new frame at the playhead; what
  // came before keeps its layout. At the very start of a format the whole format changes.
  const LAYOUT_SNAP_MS = 300
  const transitionAfter = () => new Set(transitions.map(tr => tr.after_segment_id))
  function handleLayoutChange(layout: LayoutType, mode: 'section' | 'fromPlayhead' = 'section') {
    const t = currentTimeMs
    const ar = getVideoAR()
    if (!activeSegment && currentGap) {
      // No format here yet: create one over the uncovered stretch (frames: from the playhead)
      const start = mode === 'section' || t - currentGap.start_ms <= LAYOUT_SNAP_MS ? currentGap.start_ms : t
      if (currentGap.end_ms - start < 300) return
      pause()
      skipCanvasTransitionRef.current = true
      const id = addFormat(start, currentGap.end_ms, layout, ar, neighbourFraming(layout, start, currentGap.end_ms))
      if (mode === 'section') joinSameLayoutNeighbours(id, transitionAfter())
      else if (start !== t) seekToMs(start)
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

  // Split: cut the format under the playhead in two. Both halves keep its layout and views, so a
  // different layout can then be picked for one of them.
  const canSplitHere = !!activeSegment && currentTimeMs > activeSegment.start_ms + 100 && currentTimeMs < activeSegment.end_ms - 100
  function splitHere() {
    const seg = activeSegment
    if (!seg || !canSplitHere) return
    pause()
    skipCanvasTransitionRef.current = true
    splitAtMs(seg.id, currentTimeMs, getPositionAt)
  }

  const musicName = (t: { storage_path: string }) => (t.storage_path.split('/').pop() ?? 'Music').replace(/\.[a-z0-9]+$/i, '')
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
  function deleteMusic(id: string) {
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
      const made = useEditorStore.getState().segments.find(x => x.start_ms === gap.start_ms && x.end_ms === gap.end_ms)
      if (made?.crop_boxes[0]) { setBoxKeyframes(made.crop_boxes[0].id, [{ t_ms: made.start_ms, ...pos }]); return }
      addFormat(gap.start_ms, gap.end_ms, 'vertical', getVideoAR(), pos)
      return
    }
    const vid = videoRef.current
    if (motionModeRef.current) {
      const t_ms = vid && !vid.paused ? Math.round(vid.currentTime * 1000) - clip.start_ms : currentTimeMs
      recordMotionAt(boxId, Math.max(0, t_ms), pos)
      return
    }
    const seg = segments.find(s => s.crop_boxes.some(b => b.id === boxId))
    if (!seg) return
    // One drag = one view change at one moment: stop playback so the playhead can't run on
    if (vid && !vid.paused) pause()
    const t = Math.max(seg.start_ms, Math.min(seg.end_ms - 1, currentTimeMs))
    setViewAt(boxId, t, pos, seg.start_ms)
  }

  // Frames work like the Format layouts: picking one mid-frame starts a new frame at the playhead
  // (e.g. Single 0:00–0:15, then Dual Video from 0:15), each with its own ◆ keys and lanes
  function handleApplyFrame(layout: FrameLayout) {
    handleLayoutChange(layout, 'fromPlayhead')
  }
  // What a frame picked now will cover (see handleLayoutChange)
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
  function selectFrameItem(id: string | null, segId = frameSeg?.id) {
    if (segId && segId !== frameSeg?.id) pendingFrameSelectRef.current = id
    else setActiveFrameItemId(id)
    if (!id) return
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
    if (!seg) return
    pause()
    const band = { ...DEFAULT_BAND, ...seg.frame?.band }
    addToLane(segId, 'band', t, { kind: 'text', text: '', bg: band.bg, color: band.color, size: band.size })
  }

  function handleAddChoice(choice: AddChoice) {
    if (!addMenu) return
    const { segId, lane, t } = addMenu
    setAddMenu(null)
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
    if (p.lane !== undefined) addToLane(p.segId, p.lane, p.t ?? currentTimeMs, { kind: 'video', source_video_id: videoId, source_offset_ms: 0, volume: 1, muted: false })
  }

  function handlePickedPhoto(storagePath: string, url: string) {
    const p = framePicker
    setFramePicker(null)
    if (!p) return
    if (p.replaceId) { updateFrameItem(p.segId, p.replaceId, { kind: 'photo', image_path: storagePath, image_url: url || null, source_video_id: null }); return }
    if (p.lane !== undefined) addToLane(p.segId, p.lane, p.t ?? currentTimeMs, { kind: 'photo', image_path: storagePath, image_url: url || null, motion: 'none' })
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
  // Back to how a fresh clip starts: one Vertical format over the whole clip, no frames, text,
  // media, music, transitions or filters, and the default caption look. The captions themselves
  // (words, language, on/off) stay. It's one undo step, so Undo brings everything back.
  const [confirmResetAll, setConfirmResetAll] = useState(false)
  function handleResetAll() {
    setConfirmResetAll(false)
    pause()
    skipCanvasTransitionRef.current = true
    setActiveFrameItemId(null)
    setActiveTextOverlayId(null)
    useEditorStore.setState({ segments: [], keyframes: {}, activeSegmentId: null, activeBoxId: null })
    addFormat(0, clipLengthMs, 'vertical', getVideoAR())
    useMediaStore.setState({
      overlays: [], textOverlays: [], audioTracks: [], transitions: [],
      filters: { brightness: 100, contrast: 100, saturation: 100 }, activeOverlayId: null,
    })
    // Explicit defaults (not blanks): the save only writes caption fields that have a value
    useCaptionStore.setState(st => ({
      captionStyle: { ...st.captionStyle, font: null, size: null, color: '#FFE700', position: null, position_y: null, animation: 'karaoke' },
    }))
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

  // ── Every delete asks first ─────────────────────────────────────────────────
  const { confirm, dialog: confirmDialog } = useConfirm()
  const UNDO_NOTE = 'You can undo this.'

  function askDeleteFormat(segId: string) {
    const i = cropPositions.findIndex(x => x.id === segId)
    const seg = cropPositions[i]
    if (!seg) return
    const range = `${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)}`
    const frameNote = isFrameLayout(seg.layout) ? ' Everything in its frame (photos, videos, text) is removed too.' : ''
    if (cropPositions.length === 1) {
      confirm({ title: 'Reset this format to Vertical?', body: `It becomes a plain Vertical format again.${frameNote} ${UNDO_NOTE}`, confirmLabel: 'Reset' }, () => handleDeleteFormat(segId))
      return
    }
    confirm({ title: `Delete format ${i + 1}?`, body: `${range} goes back to the default framing.${frameNote} ${UNDO_NOTE}` }, () => handleDeleteFormat(segId))
  }

  function askRemoveFrame(segId: string) {
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
    confirm({ title: `Remove ${frameItemName(segId, id)}?`, body: UNDO_NOTE, confirmLabel: 'Remove' }, () => {
      removeFrameItem(segId, id)
      setActiveFrameItemId(cur => cur === id ? null : cur)
    })
  }

  function askRemoveMain(segId: string, slot: number) {
    const seg = segments.find(x => x.id === segId)
    if (!seg || !isFrameLayout(seg.layout)) return
    const label = frameLanes(seg.layout).find(l => l.lane === slot)?.label ?? ''
    confirm({ title: `Take the main video out of the ${label.toLowerCase()} slot?`, body: `The slot will be empty until you add something. ${UNDO_NOTE}`, confirmLabel: 'Take it out' }, () => {
      updateFrame(segId, { main_slots: (frameOf(seg).main_slots ?? [0]).filter(i => i !== slot) })
      setActiveFrameItemId(cur => cur === `main:${slot}` ? null : cur)
    })
  }

  function askDeleteTextOverlay(id: string) {
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
    const o = overlays.find(x => x.id === id)
    confirm({ title: `Delete this ${o?.type === 'video' ? 'video' : 'image'}?`, body: UNDO_NOTE }, () => {
      deleteOverlay(id)
      if (activeOverlayId === id) setActiveOverlayId(null)
    })
  }

  function handleInsertBroll(videoId: string) {
    const atMs = pickerAtMs ?? pendingBrollMs ?? currentTimeMs
    setPickerAtMs(null); setPendingBrollMs(null)
    const newId = insertBrollAtMs(videoId, atMs, 5000, getPositionAt)
    if (newId) { setActiveSegmentId(newId); seekToMs(atMs) }
  }

  // Borrowed reaction slots look ahead through the parts to start each one on time
  const trackBorrowed = borrowed.track
  useEffect(() => { trackBorrowed(segments) }, [segments, trackBorrowed])

  // ── B-roll panel ──────────────────────────────────────────────────────────────
  const brollShots = useMemo(() => segments
    .filter(sg => !isFrameLayout(sg.layout) && sg.crop_boxes[0]?.source_video_id && sg.crop_boxes[0].source_video_id !== mainVideoId)
    .sort((a, b) => a.start_ms - b.start_ms)
    .map(sg => ({ id: sg.id, start_ms: sg.start_ms, end_ms: sg.end_ms, title: (videoTitles[sg.crop_boxes[0].source_video_id!] ?? 'Stock video').replace(/^(Pixabay|Pexels): /, '') })),
  [segments, videoTitles])

  /** Save the stock video as the user's asset, then put it in at the playhead as a muted cutaway */
  async function addStockBroll(item: StockResult, lengthMs: number) {
    const res = await fetch('/api/stock/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: item.ref, url: item.url, title: item.title }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Could not add that video')
    videoLibraryRef.current = { ...videoLibraryRef.current, [data.video_id]: { url: data.url, title: data.title } }
    setVideoLibrary(videoLibraryRef.current)
    const at = Math.min(currentTimeMs, Math.max(0, clipLengthMs - 500))
    const segId = placeBroll(data.video_id, at, Math.min(clipLengthMs, at + lengthMs), getPositionAt)
    setActiveSegmentId(segId)
    seekToMs(at)
  }

  const neighbours = (id: string) => {
    const byTime = [...useEditorStore.getState().segments].sort((a, b) => a.start_ms - b.start_ms)
    const i = byTime.findIndex(sg => sg.id === id)
    const seg = byTime[i], prev = byTime[i - 1], next = byTime[i + 1]
    return { seg, prev: prev && prev.end_ms === seg?.start_ms ? prev : undefined, next: next && next.start_ms === seg?.end_ms ? next : undefined }
  }
  /**
   * Give a shot a new time: it is taken out (the framing around it takes the time back) and put
   * back in at the new place, as a new shot is. Same video, muted.
   */
  function retimeBroll(id: string, startMs: number, endMs: number) {
    const { seg } = neighbours(id)
    const videoId = seg?.crop_boxes[0]?.source_video_id
    if (!seg || !videoId) return
    const start = Math.max(0, Math.min(clipLengthMs - 500, startMs))
    const end = Math.min(clipLengthMs, Math.max(start + 500, endMs))
    removeBrollShot(id)
    setActiveSegmentId(placeBroll(videoId, start, end, getPositionAt))
  }
  const moveBroll = (id: string, delta: number) => { const { seg } = neighbours(id); if (seg) retimeBroll(id, seg.start_ms + delta, seg.end_ms + delta) }
  const resizeBroll = (id: string, delta: number) => { const { seg } = neighbours(id); if (seg) retimeBroll(id, seg.start_ms, seg.end_ms + delta) }

  /** Remove a shot: the framing before it (or after it, at the start) takes its time back */
  const removeBroll = (id: string) => removeBrollShot(id)

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

  // ── Keyboard shortcuts: Space play/pause · S split · [ ] trim · Delete · ←/→ 1 s (Shift: 5 s) ──
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
        const step = (e.shiftKey ? 5000 : 1000) * (e.key === 'ArrowLeft' ? -1 : 1)
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
  const fillerCuts = useMemo(() => computeCutRanges(words, clip.start_ms, clip.end_ms, reactionRanges(segments, clip.start_ms)), [words, clip.start_ms, clip.end_ms, segments])
  const fillerCutMs = useMemo(() => removedMs(fillerCuts), [fillerCuts])
  /** Each cut, clip-relative, with the words it takes out (none = a pause) */
  const fillerCutList = useMemo(() => fillerCuts.map(([a, b]) => ({
    at: a - clip.start_ms,
    ms: b - a,
    words: words.filter(w => (w.start_ms + w.end_ms) / 2 >= a && (w.start_ms + w.end_ms) / 2 < b).map(w => w.word),
  })), [fillerCuts, words, clip.start_ms])
  /** "Remove pauses & filler words": in the preview column and in the Captions panel, one setting */
  const fillersToggle = (place: string) => words.length > 0 && (
    <label className={`shrink-0 ${place} flex items-start gap-2.5 px-3 py-2.5 rounded-xl cursor-pointer`}
      style={{ background: 'rgb(var(--ed-fg) / 0.04)', border: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
      <input type="checkbox" checked={removeFillers} onChange={e => setRemoveFillers(e.target.checked)}
        className="mt-0.5" style={{ accentColor: '#c8ff00' }} />
      <span className="flex flex-col gap-0.5">
        <span className="text-xs font-semibold text-[var(--ed-text)]">Remove pauses &amp; filler words</span>
        <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
          {fillerCutMs >= 500 ? `Removes about ${Math.round(fillerCutMs / 1000)} s. ` : 'Nothing much to remove in this clip. '}
          Applied when you export; the preview plays the full clip.
        </span>
      </span>
    </label>
  )

  function setRemoveFillers(on: boolean) {
    setRemoveFillersState(on)
    removeFillersRef.current = on
    unsavedRef.current = true
    editVersionRef.current++
    latestHandleSaveRef.current()
  }
  const activeTool = TOOLS.find(t => t.id === tool)!

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

        <UndoRedo />
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
                    Formats, frames, text, media, music and the caption look go back to the start. Your captions stay. You can undo this.
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
                <div className="px-4 pt-4 pb-3 flex flex-col gap-1.5">
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
                <p className="text-[11px] leading-relaxed" style={{ color: 'rgb(var(--ed-fg) / 0.42)' }}>
                  Your clip is made of sections, each with its own layout. Click one to edit it.
                </p>
                </div>
                <div className="px-3 pb-3 flex flex-col gap-1">
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
                    const broll = seg.crop_boxes.some(b => b.source_video_id && b.source_video_id !== mainVideoId)
                    const col = broll ? BROLL_COLOR : LAYOUT_COLORS[shown]
                    const isActiveSeg = seg.id === activeSegment?.id
                    const only = cropPositions.length === 1
                    const deleteLabel = only ? 'Reset this format to Vertical' : `Delete format ${i + 1} (its time goes back to default framing)`
                    const name = broll ? 'B-roll' : LAYOUTS.find(l => l.id === shown)?.label ?? shown
                    return (
                      <Fragment key={seg.id}>
                      <div
                        role="button" tabIndex={0}
                        aria-current={isActiveSeg || undefined}
                        aria-label={`Section ${i + 1}: ${name}, ${msToLabel(seg.start_ms)} to ${msToLabel(seg.end_ms)}`}
                        className="group relative flex flex-col px-2 py-1.5 rounded-lg cursor-pointer transition-[background,border-color,box-shadow] duration-200 hover:border-[rgb(var(--ed-fg)/0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(200,255,0,0.6)]"
                        style={isActiveSeg
                          ? { background: 'linear-gradient(180deg, rgba(200,255,0,0.07), rgba(200,255,0,0.02))', border: '1px solid rgba(200,255,0,0.45)', boxShadow: '0 8px 24px -14px rgba(200,255,0,0.45)' }
                          : { background: 'rgb(var(--ed-fg) / 0.03)', border: '1px solid rgb(var(--ed-fg) / 0.08)' }}
                        onClick={() => { setActiveSegmentId(seg.id); setPickedSegId(seg.id); seekToMs(seg.start_ms) }}
                        onKeyDown={e => { if (e.key === 'Enter') { setActiveSegmentId(seg.id); setPickedSegId(seg.id); seekToMs(seg.start_ms) } }}>
                        <div className="flex items-center gap-2">
                          {/* Layout icon on a tile tinted with the section's colour */}
                          <span className="relative shrink-0 w-7 h-8 flex items-center justify-center rounded-md"
                            style={{ background: `${col}1f`, boxShadow: `inset 0 0 0 1px ${col}55` }}>
                            {broll
                              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></svg>
                              : <LayoutGlyph layout={shown} color={col} active={isActiveSeg} />}
                          </span>
                          <div className="flex-1 min-w-0 flex flex-col">
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="text-xs font-semibold truncate text-[var(--ed-text)]">{name}</span>
                              {isActiveSeg && (
                                <span className="shrink-0 px-1.5 py-px rounded text-[9px] font-bold uppercase tracking-wider"
                                  style={{ background: 'rgba(200,255,0,0.14)', color: 'var(--ed-accent-text)' }}>Editing</span>
                              )}
                            </span>
                            <span className="text-[10px] leading-tight tabular-nums" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>
                              {msToLabel(seg.start_ms)} → {msToLabel(seg.end_ms)}
                              <span style={{ color: 'rgb(var(--ed-fg) / 0.25)' }}> · </span>
                              {lengthLabel(seg.end_ms - seg.start_ms)}
                            </span>
                            {/* Where this section sits in the whole clip */}
                            <div className="relative h-[3px] mt-1 rounded-full overflow-hidden" style={{ background: 'rgb(var(--ed-fg) / 0.07)' }}
                              title={`${msToLabel(seg.start_ms)}–${msToLabel(seg.end_ms)} of ${msToLabel(clipDurationMs)}`}>
                              <div className="absolute h-full rounded-full" style={{
                                left: `${(seg.start_ms / clipDurationMs) * 100}%`,
                                width: `max(3px, ${((seg.end_ms - seg.start_ms) / clipDurationMs) * 100}%)`,
                                background: col,
                                boxShadow: isActiveSeg ? `0 0 6px ${col}` : 'none',
                              }} />
                            </div>
                          </div>
                          <button onClick={e => { e.stopPropagation(); askDeleteFormat(seg.id) }}
                            aria-label={deleteLabel} title={`${deleteLabel} (Delete)`}
                            className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-[opacity,background,color] hover:bg-[rgba(239,68,68,0.12)] hover:text-[#f87171] ${isActiveSeg ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
                            style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                            <TrashIcon />
                          </button>
                        </div>
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
                onUpdateItem={updateFrameItem}
                onRemoveItem={askRemoveFrameItem}
                onUpdateFrame={updateFrame}
                onReplaceMedia={(segId, id, kind) => { pause(); setFramePicker({ segId, kind, replaceId: id }) }}
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
                  <div className="p-4 flex flex-col gap-3" style={{ borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
                    <SwitchRow label="Show captions" description={!showCaptions && !clipHasWords(words) ? 'Turning them on makes captions for this clip' : undefined}
                      checked={showCaptions} onChange={turnCaptions} />
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
                    {showCaptions && words.length > 0 && (
                      <div className="flex flex-col gap-1.5">
                        <span className="text-xs font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Caption language</span>
                        <div role="radiogroup" aria-label="Caption language" className="grid grid-cols-2 gap-1 p-0.5 rounded-lg" style={{ background: 'rgb(var(--ed-fg) / 0.05)' }}>
                          {([[false, 'Auto language', 'As spoken, in its own script'], [true, 'English', hasRoman ? `In English letters (${scriptLabel})` : "English letters aren't available for these captions"]] as const).map(([v, label, title]) => {
                            const on = romanize === v
                            const disabled = v && !hasRoman
                            return (
                              <button key={label} role="radio" aria-checked={on} disabled={disabled} title={title}
                                onClick={() => setRomanize(v)}
                                className="h-8 rounded-md text-xs font-medium transition-colors disabled:opacity-40"
                                style={on ? { background: 'rgb(var(--ed-fg) / 0.14)', color: 'var(--ed-text)' } : { color: 'rgb(var(--ed-fg) / 0.6)' }}>
                                {label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
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

            {tool === 'cleanup' && (
              <div className="flex flex-col gap-3 p-4 min-h-0">
                {fillersToggle('')}
                {words.length === 0 && <p className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>This needs the clip's captions (transcript) first.</p>}
                {fillerCutList.length > 0 && (
                  <div className="flex flex-col gap-1 min-h-0">
                    <span className="text-xs font-medium" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                      {fillerCutList.length} cut{fillerCutList.length === 1 ? '' : 's'}{removeFillers ? '' : ' (when switched on)'}
                    </span>
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
              <AudioMixerPanel tracks={audioTracks}
                onAddTrack={addMusicTrack}
                onRemoveTrack={deleteMusic}
                onUpdateTrack={(id, u) => setAudioTracks(prev => prev.map(t => t.id === id ? { ...t, ...u } : t))} />
              </>
            )}

            {tool === 'broll' && (
              <BrollPanel
                clipId={clip.id}
                currentTimeMs={currentTimeMs}
                shots={brollShots}
                onAdd={addStockBroll}
                onMove={moveBroll}
                onResize={resizeBroll}
                onRemove={removeBroll}
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
                onUpdate={(id, patch) => { if (frameSeg) updateFrameItem(frameSeg.id, id, patch) }}
                onRemove={id => { if (frameSeg) askRemoveFrameItem(frameSeg.id, id) }}
                onUpdateBand={patch => { if (frameSeg) updateFrameBand(frameSeg.id, patch) }}
              />
              <TextOverlayPanel
                overlays={textOverlays}
                currentTimeMs={currentTimeMs}
                clipDurationMs={clip.end_ms - clip.start_ms}
                onAdd={o => setTextOverlays(prev => [...prev, { ...o, id: crypto.randomUUID(), clip_id: clip.id }])}
                onUpdate={updateTextOverlay}
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
          <div className="shrink-0 flex items-center justify-center gap-3 px-4" style={{ minHeight: 60, borderBottom: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <FormatSwitcher
              activeId={activeSegment ? formatLayoutOf(activeSegment.layout) : null}
              play={formatPlay}
              onPick={id => { setFormatPlay(p => ({ id, n: (p?.n ?? 0) + 1 })); handleLayoutChange(id) }}
            />

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
                {motionMode ? 'Recording motion' : 'Motion'}
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
              {activeSegment?.crop_boxes[0]?.source_video_id && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold pointer-events-none"
                  style={{ background: 'rgba(249,115,22,0.85)', color: '#fff' }}>B-roll</div>
              )}
            </div>
          </div>

          {/* Transport */}
          {/* Timeline bar: [show/hide timeline · trim · delete] [previous section · play · next section · time]
              [zoom slider]. Every button has a plain-words tooltip. */}
          <div className="shrink-0 grid items-center px-3" style={{ gridTemplateColumns: '1fr auto 1fr', height: 52, borderTop: '1px solid rgb(var(--ed-fg) / 0.06)', background: 'var(--ed-panel)' }}>
            {/* Left: timeline tools */}
            <div className="justify-self-start flex items-center gap-1">
              {/* Show / hide the timeline. The icon is a little timeline (three track bars with a playhead)
                  plus an arrow saying what a click does (down = tuck it away, up = bring it back); a
                  label pops up instantly on hover (.ed-tip in globals.css) */}
              <button onClick={() => setTimelineHidden(h => !h)} aria-expanded={!timelineHidden}
                aria-label={timelineHidden ? 'Show the timeline' : 'Hide the timeline'}
                data-tip={timelineHidden ? 'Show timeline' : 'Hide timeline'}
                className="ed-tl-btn ed-tip gap-1 px-2" data-active={timelineHidden || undefined}>
                <svg width="18" height="16" viewBox="0 0 24 20" fill="none" aria-hidden="true">
                  <rect x="2" y="3" width="13" height="3" rx="1.5" fill="currentColor" opacity=".9" />
                  <rect x="2" y="8.5" width="17" height="3" rx="1.5" fill="currentColor" opacity=".6" />
                  <rect x="2" y="14" width="10" height="3" rx="1.5" fill="currentColor" opacity=".4" />
                  <path d="M7.5 1v18" stroke="#c8ff00" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
                <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
                  style={{ transform: timelineHidden ? 'rotate(180deg)' : 'none', transition: 'transform .25s' }}>
                  <path d="M3 4.5l3 3 3-3" />
                </svg>
              </button>
              <span className="ed-tl-sep" aria-hidden="true" />
              {/* What's selected — Trim and Delete act on exactly this (click video or music on the timeline) */}
              {(() => {
                const seg = pickedSegId ? segments.find(x => x.id === pickedSegId) ?? null : null
                const segName = seg ? (isFrameLayout(seg.layout) ? `Frame · ${FRAME_TEMPLATES[seg.layout].name}` : LAYOUTS.find(l => l.id === seg.layout)?.label ?? 'Section') : ''
                const kind: 'music' | 'video' | null = pickedMusic ? 'music' : seg ? 'video' : null
                const videoCanTrim = !!seg && canSplitHere && activeSegment?.id === seg.id
                const trimOk = kind === 'music' ? canTrimMusic : kind === 'video' ? videoCanTrim : canSplitHere
                const trimTitle = kind === 'music'
                  ? (canTrimMusic ? 'Trim the selected music: cut it in two at the playhead (then delete the part you don\u2019t want)' : 'Move the playhead inside the selected music to trim it')
                  : kind === 'video'
                    ? (videoCanTrim ? 'Trim the selected video section: cut it in two at the playhead (S)' : 'Move the playhead inside the selected video section to trim it')
                    : (canSplitHere ? 'Trim (S): cut the video section under the playhead in two' : 'Move the playhead inside a section to trim it')
                return (
                  <>
                    <span className="ed-sel-chip" data-kind={kind ?? undefined} aria-live="polite"
                      title={kind === 'music' ? `Selected: music · ${musicName(pickedMusic!)}` : kind === 'video' ? `Selected: video · ${segName} · ${msToLabel(seg!.start_ms)}–${msToLabel(seg!.end_ms)}` : 'Click the video or the music on the timeline to select it'}>
                      {kind === 'music' ? (
                        <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
                          <span className="truncate">Music: {musicName(pickedMusic!)}</span></>
                      ) : kind === 'video' ? (
                        <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></svg>
                          <span className="truncate">Video: {segName} · {msToLabel(seg!.start_ms)}–{msToLabel(seg!.end_ms)}</span></>
                      ) : (
                        <span className="truncate">Select video or music</span>
                      )}
                    </span>
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
                    {/* Delete: removes the selected music. For a video section it's a button only for now —
                        TODO(backend): delete the selected trimmed video part */}
                    <button
                      onClick={() => { if (kind === 'music' && pickedMusic) deleteMusic(pickedMusic.id) }}
                      disabled={!kind}
                      aria-label={kind === 'music' ? 'Delete the selected music' : 'Delete the selected video section'}
                      title={kind === 'music' ? 'Delete the selected music' : kind === 'video' ? 'Delete the selected video section' : 'Click the video or the music on the timeline to delete it'}
                      className="ed-tl-btn ed-tl-danger"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                      </svg>
                    </button>
                  </>
                )
              })()}
            </div>

            {/* Centre: jump between sections, play, and the time */}
            <div className="flex items-center gap-2">
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
              <span className="ml-2 flex items-baseline gap-1.5 tabular-nums" aria-label={`${msToClock(currentTimeMs)} of ${msToClock(clipDurationMs)}`}>
                <span className="text-sm font-semibold text-[var(--ed-text)]">{msToClock(currentTimeMs)}</span>
                <span className="text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.38)' }}>/ {msToClock(clipDurationMs)}</span>
              </span>
            </div>

            {/* Right: timeline zoom */}
            <div className="justify-self-end">
              <ZoomSlider zoom={timelineZoom} onZoom={setTimelineZoom} />
            </div>
          </div>

          {/* Timeline (hidden with "Hide timeline") */}
          <div data-tour="timeline" hidden={timelineHidden} className="shrink-0 overflow-y-auto px-4 pt-3 pb-4" style={{ maxHeight: '38vh', background: 'var(--ed-track)', borderTop: '1px solid rgb(var(--ed-fg) / 0.06)' }}>
            <SegmentTimeline
              selectedMusicId={pickedMusicId} onSelectMusic={pickMusic}
              musicTracks={audioTracks.map(t => ({
                id: t.id, start_ms: t.start_ms,
                duration_ms: t.end_ms != null ? t.end_ms - t.start_ms
                  : musicDurations[t.id] != null ? musicDurations[t.id] - (t.offset_ms ?? 0) : undefined,
                name: (t.storage_path.split('/').pop() ?? 'Music').replace(/\.[a-z0-9]+$/i, ''),
              }))}
              onMusicMove={(id, startMs) => setAudioTracks(prev => prev.map(t => {
                if (t.id !== id) return t
                // A trimmed track keeps its length when moved
                const len = t.end_ms != null ? t.end_ms - t.start_ms : null
                return { ...t, start_ms: startMs, ...(len != null ? { end_ms: startMs + len } : {}) }
              }))}
              onAddAt={(where, anchor) => { pause(); seekToMs(where === 'start' ? 0 : Math.max(0, clipDurationMs - 50)); setPlusMenu({ where, anchor }) }}
              zoom={timelineZoom} onZoomChange={setTimelineZoom} showToolbar={false}
              segments={segments} clipStartMs={clip.start_ms} clipEndMs={clip.end_ms}
              currentTimeMs={currentTimeMs} activeSegmentId={activeSegment?.id ?? null}
              videoUrl={videoUrl} safeDurationMs={clipDurationMs} onSeek={seekToMs}
              onSelectSegment={id => setActiveSegmentId(id)}
              onBrollChange={retimeBroll}
              videoUrls={videoUrls}
              onUpdateSegment={(id, updates) => updateSegment(id, updates)}
              onSetEdge={(id, edge, t) => setSegmentEdge(id, edge, t, clipLengthMs)}
              onMoveJunction={moveJunction}
              onInsertBrollAfter={handleInsertBrollAfterSeg}
              pickedSegmentId={pickedSegId} onPickSegment={setPickedSegId}
              textOverlays={textOverlays} activeTextOverlayId={activeTextOverlayId}
              onSelectTextOverlay={id => { setActiveTextOverlayId(id); if (id) { setTool('text'); toggleOptions(true) } }}
              onTextOverlayUpdate={updateTextOverlay}
              frameSeg={frameSeg}
              activeFrameItemId={activeFrameItemId}
              laneHighlight={laneHighlight}
              videoTitles={videoTitles}
              onSelectFrameItem={selectFrameItem}
              onUpdateFrameItem={(id, patch) => { if (frameSeg) updateFrameItem(frameSeg.id, id, patch) }}
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
                if (!viewBox || !activeSegment) return
                moveViewChange(viewBox.id, from, to, activeSegment.start_ms, activeSegment.end_ms)
                const moved = viewChanges(useEditorStore.getState().keyframes[viewBox.id] ?? [])
                  .reduce((best, v) => Math.abs(v.t_ms - to) < Math.abs(best - to) ? v.t_ms : best, from)
                setSelectedView({ boxId: viewBox.id, t: moved })
                return moved
              }}
              onRemoveView={t => {
                if (!viewBox || viewMarkers.length <= 1) return
                removeViewChange(viewBox.id, t)
                setSelectedView(null)
              }}
            />
          </div>
        </main>

        {/* Right column: 9:16 output preview, always visible */}
        <aside data-tour="export" className="shrink-0 flex flex-col min-h-0" style={{ width: 360, background: 'var(--ed-panel)', borderLeft: '1px solid rgb(var(--ed-fg) / 0.07)' }}>
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
                  <button onClick={() => requestExport(true)} aria-label="Re-render"
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
                <ShinyButton onClick={pressExport}
                  title="Render the reel so you can download it"
                  aria-busy={exportPress || undefined}
                  data-pressed={exportPress || undefined}
                  className="ed-export flex items-center gap-1.5 h-8 px-3.5 rounded-lg text-xs font-bold overflow-hidden">
                  <ExportIcon /> Export
                </ShinyButton>
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
                  videoRef={videoRef} currentTimeMs={currentTimeMs} clipStartMs={clip.start_ms}
                  activeSegment={viewSegment} getPositionAt={viewGetPositionAt} sourceFor={brollSource} slotSourceFor={borrowed.slotSourceFor}
                  skipTransitionRef={skipCanvasTransitionRef} words={displayWords}
                  captionStyle={captionStyle} captionTextCase={captionTextCase} showCaptions={showCaptions}
                  overlays={overlays} activeOverlayId={activeOverlayId}
                  onOverlayChange={updateOverlay} onSelectOverlay={setActiveOverlayId} onDeleteOverlay={askDeleteOverlay}
                  textOverlays={textOverlays} activeTextOverlayId={activeTextOverlayId}
                  onTextOverlayChange={updateTextOverlay} onSelectTextOverlay={setActiveTextOverlayId} onDeleteTextOverlay={askDeleteTextOverlay}
                  onCaptionPositionChange={y => updateCaptionStyle({ position_y: y })}
                  frameMedia={framePool}
                  onFrameLaneClick={focusLane}
                  activeFrameItemId={activeFrameItemId}
                  onFrameItemClick={selectFrameItem}
                  onFrameItemChange={(id, patch) => { if (frameSeg) updateFrameItem(frameSeg.id, id, patch) }}
                  style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 10, border: '1px solid rgb(var(--ed-fg) / 0.1)', boxShadow: '0 4px 24px rgba(0,0,0,0.6)' }}
                />
              )}
              {!rendering && <PlatformOverlay platform={platform} />}
              </div>
            </div>
          </div>

        </aside>
      </div>

      {confirmDialog}

      {/* The timeline's "+" menu: photos / videos into a frame slot (Dual, Trio…), B-roll, music, text */}
      {plusMenu && (() => {
        const t = plusMenu.where === 'start' ? 0 : Math.max(0, clipDurationMs - 50)
        const seg = cropPositions.find(x => t >= x.start_ms && t < x.end_ms) ?? null
        const frameSlots = seg && isFrameLayout(seg.layout)
          ? frameLanes(seg.layout).filter(l => l.lane !== 'band').map(l => ({ lane: l.lane as FrameLane, label: l.label, offers: slotOffers(seg.layout as FrameLayout, l.lane as number) }))
          : []
        const openTool = (id: Tool) => { setPlusMenu(null); setTool(id); toggleOptions(true) }
        return (
          <TimelineAddMenu
            where={plusMenu.where} anchor={plusMenu.anchor}
            frameName={seg && isFrameLayout(seg.layout) ? FRAME_TEMPLATES[seg.layout].name : null}
            slots={frameSlots}
            onSlot={lane => { setPlusMenu(null); if (seg) setAddMenu({ segId: seg.id, lane, t: seg.start_ms, anchor: plusMenu.anchor }) }}
            onPickFrame={() => openTool('frames')}
            onBroll={() => openTool('broll')}
            onMusic={() => openTool('music')}
            onText={() => openTool('text')}
            onClose={() => setPlusMenu(null)}
          />
        )
      })()}

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
          onInsertVideo={handleInsertBroll} onInsertImage={handleInsertImage}
          onClose={() => setPickerAtMs(null)} />
      )}
    </div>
  )
}

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
 * Menu of the timeline's "+" buttons. In a frame (Dual, Trio…) it lists the frame's slots, so a
 * photo or video goes straight into the right one (then drag its ends on the timeline to set
 * when it shows). Outside a frame it explains the first step: pick a frame. B-roll, music and
 * text are always offered.
 */
function TimelineAddMenu({ where, anchor, frameName, slots, onSlot, onPickFrame, onBroll, onMusic, onText, onClose }: {
  where: 'start' | 'end'
  anchor: DOMRect
  frameName: string | null
  slots: { lane: FrameLane; label: string; offers: { video: boolean; photo: boolean } }[]
  onSlot: (lane: FrameLane) => void
  onPickFrame: () => void
  onBroll: () => void
  onMusic: () => void
  onText: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  const W = 268
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, where === 'start' ? anchor.left : anchor.right - W))
  const bottom = window.innerHeight - anchor.top + 8
  const what = (o: { video: boolean; photo: boolean }) => o.video && o.photo ? 'Photo or video' : o.photo ? 'Photo' : 'Video'
  const row = 'w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.07)] focus-visible:outline-none focus-visible:bg-[rgb(var(--ed-fg)/0.07)]'
  const icon = (d: React.ReactNode, tint = 'rgb(var(--ed-fg) / 0.8)') => (
    <span className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg" style={{ background: 'rgb(var(--ed-fg) / 0.06)', color: tint }}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
    </span>
  )
  return (
    <div ref={ref} role="menu" aria-label={`Add at the ${where}`} className="fixed flex flex-col p-1.5 rounded-xl ed-tour-card"
      style={{ left, bottom, width: W, zIndex: 120, background: 'var(--ed-popover)', border: '1px solid rgb(var(--ed-fg) / 0.12)', boxShadow: '0 18px 48px -12px rgba(0,0,0,0.8)' }}>
      <p className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'rgb(var(--ed-fg) / 0.4)' }}>
        Add at the {where}
      </p>

      {frameName ? (
        <>
          <p className="px-2.5 pb-1 text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>Into the {frameName} frame</p>
          {slots.map(sl => (
            <button key={String(sl.lane)} role="menuitem" className={row} onClick={() => onSlot(sl.lane)}>
              {icon(<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>, '#60a5fa')}
              <span className="min-w-0 flex flex-col">
                <span className="text-[13px] font-medium text-[var(--ed-text)]">{what(sl.offers)} · {sl.label}</span>
                <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>Drag its ends on the timeline to set the time</span>
              </span>
            </button>
          ))}
        </>
      ) : (
        <button role="menuitem" className={row} onClick={onPickFrame}>
          {icon(<><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M5 12h14" /></>, '#2dd4bf')}
          <span className="min-w-0 flex flex-col">
            <span className="text-[13px] font-medium text-[var(--ed-text)]">Photos &amp; videos in a frame</span>
            <span className="text-[11px]" style={{ color: 'rgb(var(--ed-fg) / 0.45)' }}>First pick a Dual or Trio frame here</span>
          </span>
        </button>
      )}

      <span className="my-1 h-px" style={{ background: 'rgb(var(--ed-fg) / 0.08)' }} aria-hidden="true" />
      <button role="menuitem" className={row} onClick={onBroll}>
        {icon(<><rect x="2" y="5" width="15" height="14" rx="2" /><path d="M17 10l5-3v10l-5-3z" /></>, '#f97316')}
        <span className="text-[13px] font-medium text-[var(--ed-text)]">Videos</span>
      </button>
      <button role="menuitem" className={row} onClick={onMusic}>
        {icon(<><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>, '#c084fc')}
        <span className="text-[13px] font-medium text-[var(--ed-text)]">Music</span>
      </button>
      <button role="menuitem" className={row} onClick={onText}>
        {icon(<path d="M4 7V4h16v3M9 20h6M12 4v16" />, '#f472b6')}
        <span className="text-[13px] font-medium text-[var(--ed-text)]">Text</span>
      </button>
    </div>
  )
}

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
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
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
            {l.label}
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

// Header undo/redo buttons (shortcuts: Ctrl/⌘+Z, Ctrl/⌘+Shift+Z)
function UndoRedo() {
  const { canUndo, canRedo } = useHistory()
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const mod = mac ? '⌘' : 'Ctrl+'
  const btn = 'w-8 h-8 flex items-center justify-center rounded-lg transition-colors hover:bg-[rgb(var(--ed-fg)/0.1)] disabled:opacity-30 disabled:hover:bg-transparent'
  return (
    <div className="flex items-center gap-0.5 shrink-0 pl-3" style={{ borderLeft: '1px solid rgb(var(--ed-fg) / 0.1)', color: 'rgb(var(--ed-fg) / 0.75)' }}>
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

/** Download arrow over a tray, drawn in two parts so the Export press can animate them */
function ExportIcon() {
  return (
    <svg className="ed-export-icon" width="14" height="14" viewBox="0 0 15 15" fill="none" aria-hidden="true" style={{ overflow: 'visible' }}>
      <g className="ed-export-arrow"><path d="M7.5 2v8M4 7l3.5 3.5L11 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></g>
      <path className="ed-export-tray" d="M2 13h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

/** Timeline zoom as − [slider] + */
function ZoomSlider({ zoom, onZoom }: { zoom: number; onZoom: (z: number) => void }) {
  const i = Math.max(0, ZOOM_STEPS.indexOf(zoom))
  const last = ZOOM_STEPS.length - 1
  const set = (k: number) => onZoom(ZOOM_STEPS[Math.max(0, Math.min(last, k))])
  return (
    <div className="flex items-center gap-1.5" role="group" aria-label="Timeline zoom">
      <button onClick={() => set(i - 1)} disabled={i === 0} aria-label="Zoom out" title="Zoom out" className="ed-tl-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M8 11h6M20 20l-4-4" /></svg>
      </button>
      <input type="range" min={0} max={last} step={1} value={i} onChange={e => set(Number(e.target.value))}
        aria-label="Timeline zoom" title={zoom === 1 ? 'Whole clip' : `${zoom}× zoom`}
        className="ed-zoom-range" style={{ '--p': `${(i / last) * 100}%` } as React.CSSProperties} />
      <button onClick={() => set(i + 1)} disabled={i === last} aria-label="Zoom in" title="Zoom in" className="ed-tl-btn">
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
