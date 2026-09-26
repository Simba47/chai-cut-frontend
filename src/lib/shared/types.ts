// ─── Domain types mirroring the database schema ───────────────────────────────

export type VideoStatus = 'uploaded' | 'transcribing' | 'ready' | 'failed'
export type ClipStatus = 'draft' | 'rendering' | 'done' | 'failed'
export type JobType = 'transcribe' | 'render'
export type JobStatus = 'queued' | 'processing' | 'done' | 'failed'
export type SourceType = 'upload' | 'link'
export type FrameLayout = 'frame_single' | 'frame_video_photo' | 'frame_dual' | 'frame_dual_letterbox' | 'frame_triple'
export type LayoutType = 'vertical' | 'split' | 'trio' | 'spotlight' | 'centered' | 'horizontal' | FrameLayout
/** How a photo slot moves over its format's duration */
export type SlotMotion = 'none' | 'zoom_in' | 'zoom_out' | 'pan_left' | 'pan_right'

/** Letterbox band of a frame: a solid strip holding text */
export interface FrameBand {
  text: string
  bg: string
  color: string
  /** Font size in px at 1080 wide */
  size: number
  font?: string | null
}

/** A lane of a frame: one of its media slots (0 = top) or the letterbox band */
export type FrameLane = number | 'band'
export type FrameItemKind = 'video' | 'photo' | 'text'

/**
 * Something placed on a frame lane for part of the format's time. A lane can hold several items
 * one after another (a slideshow); they never overlap. Times are clip time, like text overlays,
 * and anything outside the format's own range isn't shown.
 */
export interface FrameItem {
  id: string
  lane: FrameLane
  kind: FrameItemKind
  start_ms: number
  end_ms: number
  // Video: another uploaded video, starting at source_offset_ms at start_ms (loops if shorter)
  source_video_id?: string | null
  source_offset_ms?: number
  /** This video's share in the audio mix (0–1) */
  volume?: number
  muted?: boolean
  // Photo
  image_path?: string | null
  /** Signed URL for image_path — preview only, never saved */
  image_url?: string | null
  motion?: SlotMotion | null
  // Text (a card in a slot, or text on the band)
  text?: string
  bg?: string
  color?: string
  size?: number
  font?: string | null
  /** Band only: show the clip's captions here instead of fixed text */
  captions?: boolean
}

/** Extra settings of a format that uses a frame layout */
export interface FrameSettings {
  /** The band's look when nothing is on it, and the default style for new text */
  band?: FrameBand
  /** Slots that show the main video underneath their items (default: the top slot) */
  main_slots?: number[]
  /** The main video's sound in this frame */
  main_volume?: number
  main_muted?: boolean
  items?: FrameItem[]
}
export type AnimationType = 'karaoke' | 'fade' | 'none'
export type TransitionType = 'cut' | 'fade' | 'wipe'

export interface Video {
  id: string
  user_id: string
  title: string | null
  source_type: SourceType
  source_url: string | null
  storage_path: string | null
  duration_ms: number | null
  status: VideoStatus
  download_progress: number
  created_at: string
}

export interface Transcript {
  id: string
  video_id: string
  language: string | null
  created_at: string
}

export interface TranscriptWord {
  id: string
  transcript_id: string
  word: string
  word_roman: string | null
  start_ms: number
  end_ms: number
  speaker_id: string | null
  confidence: number | null
}

export interface Clip {
  id: string
  video_id: string
  start_ms: number
  end_ms: number
  aspect_ratio: string
  status: ClipStatus
  output_url: string | null
  output_storage_path: string | null
  created_at: string
}

export interface Segment {
  id: string
  clip_id: string
  start_ms: number
  end_ms: number
  layout: LayoutType
  sort_order: number
  /** Frame layouts only: letterbox band settings */
  frame?: FrameSettings | null
}

export interface CropBox {
  id: string
  segment_id: string
  slot_index: number
  /** null = the clip's main video */
  source_video_id: string | null
  /** Main video: where in it this format starts. Other video: where in that video to start. */
  source_offset_ms: number
  /** Frame slots: a photo instead of a video (storage path) */
  image_path?: string | null
  /** Signed URL for image_path — preview only, never saved */
  image_url?: string | null
  image_motion?: SlotMotion | null
  /** Frame slots: this video's share in the audio mix (0–1) */
  volume?: number
  muted?: boolean
}

export interface BoxKeyframe {
  id: string
  box_id: string
  t_ms: number
  x: number
  y: number
  w: number
  h: number
}

export interface CaptionStyle {
  id: string
  clip_id: string
  font: string | null
  size: number | null
  color: string | null
  position: string | null
  position_y: number | null
  animation: AnimationType
  /** Letters the captions are shown in: 'roman' = English letters (e.g. Tenglish); 'auto'/null = the spoken language's own script */
  language: string | null
  translated_from_language: string | null
  timing_offset_ms: number | null
}

export interface TextOverlay {
  id: string
  clip_id: string
  text: string
  start_ms: number
  end_ms: number
  x: number | null
  y: number | null
  font: string | null
  size: number | null
  color: string | null
}

export interface AudioTrack {
  id: string
  clip_id: string
  storage_path: string
  start_ms: number
  volume: number
  duck_under_speech: boolean
}

export interface Transition {
  id: string
  clip_id: string
  after_segment_id: string
  type: TransitionType
  duration_ms: number
}

export interface Job {
  id: string
  type: JobType
  payload: Record<string, unknown>
  status: JobStatus
  error: string | null
  created_at: string
  updated_at: string
}

// ─── Render payload shapes ─────────────────────────────────────────────────────

export interface TranscribeJobPayload {
  video_id: string
  storage_path: string
  language_code?: string
  is_retranscribe?: boolean
  // When set, only the clip's audio range is transcribed (clip-level transcription)
  clip_id?: string
  clip_start_ms?: number
  clip_end_ms?: number
}

export type RenderQuality = '480p' | '720p' | '1080p' | '2160p'

export interface RenderJobPayload {
  clip_id: string
  video_storage_path: string
  quality?: RenderQuality
}

export interface Overlay {
  id: string
  clip_id: string
  type: 'image' | 'video'
  storage_path: string | null
  preview_url?: string
  source_video_id: string | null
  source_offset_ms: number
  x: number
  y: number
  w: number
  h: number
  start_ms: number
  end_ms: number
  z_index: number
  created_at: string
}

// ─── Editor state (client-only, not persisted as a single blob) ────────────────

export interface BoxKeyframeLocal extends Omit<BoxKeyframe, 'id' | 'box_id'> {}

export interface CropBoxLocal extends Omit<CropBox, 'segment_id'> {
  keyframes: BoxKeyframeLocal[]
}

export interface SegmentLocal extends Omit<Segment, 'id' | 'clip_id'> {
  id: string
  crop_boxes: CropBoxLocal[]
}

// ─── Layout slot counts ────────────────────────────────────────────────────────

export const LAYOUT_SLOT_COUNT: Record<LayoutType, number> = {
  vertical: 1,
  split: 2,
  trio: 3,
  spotlight: 1,
  centered: 1,
  horizontal: 1,
  frame_single: 1,
  frame_video_photo: 2,
  frame_dual: 2,
  frame_dual_letterbox: 2,
  frame_triple: 3,
}
