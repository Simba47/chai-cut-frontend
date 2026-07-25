// ─── Domain types mirroring the database schema ───────────────────────────────

export type VideoStatus = 'uploaded' | 'transcribing' | 'ready' | 'failed'
export type ClipStatus = 'draft' | 'rendering' | 'done' | 'failed'
export type JobType = 'transcribe' | 'render'
export type JobStatus = 'queued' | 'processing' | 'done' | 'failed'
export type SourceType = 'upload' | 'link'
export type LayoutType = 'vertical' | 'split' | 'trio' | 'spotlight' | 'centered' | 'horizontal'
export type AnimationType = 'karaoke' | 'fade' | 'none'
export type TransitionType = 'cut' | 'fade' | 'wipe'

export interface Video {
  id: string
  user_id: string
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
}

export interface CropBox {
  id: string
  segment_id: string
  slot_index: number
  source_video_id: string | null
  source_offset_ms: number
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
  language: string | null
  translated_from_language: string | null
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
}
