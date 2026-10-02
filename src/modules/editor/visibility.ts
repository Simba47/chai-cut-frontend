import type { SegmentLocal, CropBoxLocal } from '@chai-cut/shared'
import { isFrameLayout } from './frames'
import { defaultCropForSlot } from './utils'

/** The video added over the main video in a section (B-roll / an inserted video), if any: its crop box */
export function addedVideoBox(seg: SegmentLocal, mainVideoId: string | null | undefined): CropBoxLocal | null {
  const box = seg.crop_boxes[0]
  return !isFrameLayout(seg.layout) && box?.source_video_id && box.source_video_id !== mainVideoId ? box : null
}

/** Crop box id of the main video standing in for a hidden added video (default framing) */
export const STAND_IN_SUFFIX = ':main'

/**
 * A section as the preview and the export show it (render.ts does the same):
 *  - an added video shows unless it's hidden; hidden, the main video shows there (default framing).
 *    Its sound is its own switch: on, it's heard (instead of the main video's) even while hidden
 *  - hidden photos, videos and text in a frame aren't shown
 *  - `hidden` stays on only where the main video itself shows and is hidden — painted black
 */
export function shownSegment(seg: SegmentLocal, mainVideoId: string | null | undefined, videoAR?: number): SegmentLocal {
  const box = addedVideoBox(seg, mainVideoId)
  if (box && !box.hidden) return seg.hidden ? { ...seg, hidden: false } : seg
  if (box) {
    return {
      ...seg,
      ...(box.muted === false && box.source_video_id
        ? { sound_only: { video_id: box.source_video_id, offset_ms: box.source_offset_ms ?? 0, volume: box.volume } } : {}),
      crop_boxes: [{
        ...box, id: `${box.id}${STAND_IN_SUFFIX}`, source_video_id: null, source_offset_ms: seg.start_ms, muted: false, hidden: false,
        keyframes: [{ t_ms: seg.start_ms, ...defaultCropForSlot('vertical', 0, videoAR) }],
      }],
    }
  }
  if (isFrameLayout(seg.layout)) {
    const items = seg.frame?.items
    const shown = items?.some(i => i.hidden) ? { ...seg, frame: { ...seg.frame!, items: items.filter(i => !i.hidden) } } : seg
    // A frame's main video isn't hidden as a whole (its slots are the frame)
    return shown.hidden ? { ...shown, hidden: false } : shown
  }
  return seg
}
