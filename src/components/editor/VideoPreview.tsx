'use client'

import { useRef, useEffect, useCallback, useState, useMemo, useId } from 'react'
import type { RefObject } from 'react'
import type { SegmentLocal, Overlay, TextOverlay as TextOverlayType, CaptionStyle, TranscriptWord, FrameItem, FrameLane } from '@chai-cut/shared'
import type { BoxPosition } from '@/lib/interpolation'
import type { TextCase } from './CaptionStyler'
import { applyCase } from './CaptionStyler'
import { normalizedSlotAspect, fitToAspect } from '@/modules/editor/utils'
import { isFrameLayout, frameSlotLabels, frameLanesFor, frameBandShown, frameOf, itemAt, captionBandAt } from '@/modules/editor/frames'
import type { FrameMediaPool } from '@/modules/editor/frameMedia'

const BOX_COLORS = ['#22c55e', '#3b82f6', '#f59e0b']
// What each slot becomes in the 9:16 output, top to bottom
const SLOT_LABELS: Record<string, string[]> = {
  vertical: ['9:16'], split: ['Top', 'Bottom'], trio: ['Top', 'Middle', 'Bottom'], horizontal: ['Full frame'],
}

const HANDLES: { cursor: string; pos: React.CSSProperties; dir: string }[] = [
  { cursor: 'nw-resize', pos: { top: -5, left: -5 },                                       dir: 'nw' },
  { cursor: 'n-resize',  pos: { top: -5, left: '50%', transform: 'translateX(-50%)' },     dir: 'n'  },
  { cursor: 'ne-resize', pos: { top: -5, right: -5 },                                      dir: 'ne' },
  { cursor: 'e-resize',  pos: { top: '50%', right: -5, transform: 'translateY(-50%)' },    dir: 'e'  },
  { cursor: 'se-resize', pos: { bottom: -5, right: -5 },                                   dir: 'se' },
  { cursor: 's-resize',  pos: { bottom: -5, left: '50%', transform: 'translateX(-50%)' },  dir: 's'  },
  { cursor: 'sw-resize', pos: { bottom: -5, left: -5 },                                    dir: 'sw' },
  { cursor: 'w-resize',  pos: { top: '50%', left: -5, transform: 'translateY(-50%)' },     dir: 'w'  },
]

// ── Source video with crop box overlay ───────────────────────────────────────

interface VideoPreviewProps {
  videoRef: RefObject<HTMLVideoElement | null>
  videoUrl: string
  currentTimeMs: number
  activeSegment: SegmentLocal | null
  getPositionAt: (boxId: string, t_ms: number) => BoxPosition
  activeBoxId: string | null
  onSelectBox: (segmentId: string, boxId: string) => void
  onBoxChange: (boxId: string, pos: BoxPosition) => void
}

export function VideoPreview({
  videoRef, videoUrl, currentTimeMs, activeSegment,
  getPositionAt, activeBoxId, onSelectBox, onBoxChange,
}: VideoPreviewProps) {
  const [videoAR, setVideoAR] = useState<number | null>(null)
  const maskId = `crop-mask-${useId().replace(/:/g, '')}`

  const isHorizontal = activeSegment?.layout === 'horizontal'

  return (
    <div
      className="flex-1 flex items-center justify-center overflow-hidden"
      style={{ background: '#0a0a0a' }}
    >
      {/* For horizontal layout: fill full width so any source AR looks as large as possible.
          The AR prop still controls height, and maxHeight prevents overflow. */}
      <div
        className="relative overflow-hidden"
        style={
          isHorizontal
            ? { width: '100%', ...(videoAR ? { aspectRatio: String(videoAR) } : { height: '100%' }), maxHeight: '100%', background: '#000', flexShrink: 0 }
            : { ...(videoAR ? { aspectRatio: String(videoAR) } : { width: '100%', height: '100%' }), maxWidth: '100%', maxHeight: '100%', background: '#000', flexShrink: 0 }
        }
      >
        <video
          ref={videoRef}
          src={videoUrl || undefined}
          crossOrigin="anonymous"
          preload="auto"
          style={{ width: '100%', height: '100%', display: 'block' }}
          onLoadedMetadata={e => {
            const v = e.currentTarget
            if (v.videoWidth && v.videoHeight) setVideoAR(v.videoWidth / v.videoHeight)
          }}
        />

        {/* Crop boxes — each is locked to the shape of its slot in the output, so what's
            inside the box is exactly what gets exported */}
        {activeSegment && (() => {
          const layout = activeSegment.layout
          const aspect = normalizedSlotAspect(layout, videoAR ?? undefined, frameBandShown(activeSegment))
          const frame = isFrameLayout(layout)
          const count = frame ? activeSegment.crop_boxes.length : layout === 'trio' ? 3 : layout === 'split' ? 2 : 1
          const labels = frame ? frameSlotLabels(layout) : SLOT_LABELS[layout]
          const mainSlots = frame ? frameOf(activeSegment).main_slots ?? [0] : null
          const boxes = activeSegment.crop_boxes.slice(0, count)
            // In a frame only the slots showing the main video are framed on it
            .filter(box => !mainSlots || mainSlots.includes(box.slot_index))
            .map(box => ({ box, label: labels?.[box.slot_index] ?? String(box.slot_index + 1), pos: fitToAspect(getPositionAt(box.id, currentTimeMs), aspect) }))
          return (
            <div className="absolute inset-0" style={{ pointerEvents: 'none', zIndex: 10 }}>
              {/* One shared dim layer with a hole per box, so boxes never darken each other */}
              <svg className="absolute inset-0" width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <mask id={maskId}>
                    <rect x="0" y="0" width="1" height="1" fill="white" />
                    {boxes.map(({ box, pos }) => <rect key={box.id} x={pos.x} y={pos.y} width={pos.w} height={pos.h} fill="black" />)}
                  </mask>
                </defs>
                <rect x="0" y="0" width="1" height="1" fill="rgba(0,0,0,0.55)" mask={`url(#${maskId})`} />
              </svg>
              {boxes.map(({ box, pos, label }, slotIdx) => (
                <DraggableBox
                  key={box.id}
                  pos={pos}
                  aspect={aspect}
                  color={BOX_COLORS[slotIdx % BOX_COLORS.length]}
                  isActive={box.id === activeBoxId || boxes.length === 1}
                  label={label}
                  onSelect={() => onSelectBox(activeSegment.id, box.id)}
                  onChange={newPos => onBoxChange(box.id, newPos)}
                />
              ))}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ── Cover-crop helper: scale src region to fill dst rect without stretching ──

function coverCrop(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number,
) {
  const srcAR = sw / (sh || 1)
  const dstAR = dw / (dh || 1)
  if (srcAR > dstAR) {
    const fitW = sh * dstAR
    ctx.drawImage(video, sx + (sw - fitW) / 2, sy, fitW, sh, dx, dy, dw, dh)
  } else if (srcAR < dstAR) {
    const fitH = sw / dstAR
    ctx.drawImage(video, sx, sy + (sh - fitH) / 2, sw, fitH, dx, dy, dw, dh)
  } else {
    ctx.drawImage(video, sx, sy, sw, sh, dx, dy, dw, dh)
  }
}

// ── Segment rendering — pure function so RAF callbacks can call it without stale closures ──

const CROSSFADE_MS = 250

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
}

/** Cover-fit any image/video source into a rect, with an optional zoom and horizontal pan */
function coverSource(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number,
  zoom = 1, panX = 0,
) {
  if (!sw || !sh) return
  const scale = Math.max(dw / sw, dh / sh) * zoom
  const w = dw / scale, h = dh / scale
  const spareX = sw - w
  const sx = Math.max(0, Math.min(spareX, spareX / 2 + panX * spareX / 2))
  const sy = (sh - h) / 2
  ctx.drawImage(src, sx, sy, w, h, dx, dy, dw, dh)
}

/** Zoom and pan of a photo slot at progress p (0–1) through its format */
function photoMotion(motion: string | null | undefined, p: number): { zoom: number; panX: number } {
  const e = Math.max(0, Math.min(1, p))
  switch (motion) {
    case 'zoom_in': return { zoom: 1 + 0.15 * e, panX: 0 }
    case 'zoom_out': return { zoom: 1.15 - 0.15 * e, panX: 0 }
    case 'pan_left': return { zoom: 1.15, panX: 1 - 2 * e }
    case 'pan_right': return { zoom: 1.15, panX: -1 + 2 * e }
    default: return { zoom: 1, panX: 0 }
  }
}

/**
 * Line breaks for frame text. Counts characters rather than measuring, exactly like render.py's
 * wrap_band_text, so the preview breaks lines in the same places as the export.
 */
function wrapFrameText(text: string, widthPx: number, sizePx: number): string[] {
  const maxChars = Math.max(8, Math.floor((widthPx * 0.88) / Math.max(1, sizePx * 0.56)))
  const lines: string[] = []
  for (const para of (text || '').split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const probe = line ? `${line} ${word}` : word
      if (line && probe.length > maxChars) { lines.push(line); line = word } else line = probe
    }
    lines.push(line)
  }
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  return lines
}

// Frame text is drawn in Montserrat Bold on export; make sure the preview has it too
let frameFontRequested = false
function ensureFrameFont() {
  if (frameFontRequested || typeof document === 'undefined') return
  frameFontRequested = true
  const href = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@700&display=swap'
  if (document.querySelector(`link[href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

/** A text item: its background filling the row, its text centred */
function paintFrameText(ctx: CanvasRenderingContext2D, it: FrameItem, fallbackBg: string, y: number, h: number) {
  const W = ctx.canvas.width
  ctx.fillStyle = it.bg || fallbackBg
  ctx.fillRect(0, y, W, h)
  const text = it.text?.trim()
  if (!text) return
  ensureFrameFont()
  const size1080 = it.size ?? 64
  const size = Math.round((size1080 / 1080) * W)
  // Wrap at export scale (1080 wide) so the breaks don't depend on the preview's size
  const lines = wrapFrameText(text, 1080, size1080)
  const lh = size * 1.2
  ctx.save()
  ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip()
  ctx.font = `700 ${size}px Montserrat, ${it.font || 'sans-serif'}`
  ctx.fillStyle = it.color || '#ffffff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, y + h / 2 + (i - (lines.length - 1) / 2) * lh))
  ctx.restore()
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  seg: SegmentLocal,
  tMs: number,
  getPositionAt: (id: string, t: number) => BoxPosition,
  pool: FrameMediaPool | null | undefined,
) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const vW = video.videoWidth, vH = video.videoHeight
  const frame = frameOf(seg)
  const main = new Set(frame.main_slots ?? [0])
  const bandBg = frame.band?.bg || '#000000'
  for (const row of frameLanesFor(seg)) {
    const y = Math.round(row.y * H), h = Math.round((row.y + row.h) * H) - Math.round(row.y * H)
    const it = itemAt(frame, row.lane, tMs, seg)
    if (row.lane === 'band') {
      ctx.fillStyle = bandBg
      ctx.fillRect(0, y, W, h)
      // Captions on the band are drawn with the other captions, positioned here
      if (it?.kind === 'text' && !it.captions) paintFrameText(ctx, it, bandBg, y, h)
      continue
    }
    // Underneath: the main video if this slot shows it, otherwise an empty (dark) slot
    ctx.fillStyle = '#111'
    ctx.fillRect(0, y, W, h)
    if (main.has(row.lane) && vW && vH) {
      const box = seg.crop_boxes.find(b => b.slot_index === row.lane)
      if (box) {
        const p = getPositionAt(box.id, tMs)
        coverCrop(ctx, video, p.x * vW, p.y * vH, p.w * vW, p.h * vH, 0, y, W, h)
      }
    }
    if (!it) continue
    if (it.kind === 'text') { paintFrameText(ctx, it, '#000000', y, h); continue }
    if (it.kind === 'photo') {
      const img = it.image_url ? pool?.image(it.image_url) : null
      if (img && img.complete && img.naturalWidth) {
        const from = Math.max(it.start_ms, seg.start_ms), to = Math.min(it.end_ms, seg.end_ms)
        const m = photoMotion(it.motion, (tMs - from) / Math.max(1, to - from))
        coverSource(ctx, img, img.naturalWidth, img.naturalHeight, 0, y, W, h, m.zoom, m.panX)
      }
      continue
    }
    const v = pool?.video(it)
    if (v && v.readyState >= 2) coverSource(ctx, v, v.videoWidth, v.videoHeight, 0, y, W, h)
  }
}

function paintSegment(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  seg: SegmentLocal | null,
  tMs: number,
  getPositionAt: (id: string, t: number) => BoxPosition,
  pool?: FrameMediaPool | null,
) {
  if (seg && isFrameLayout(seg.layout)) { paintFrame(ctx, video, seg, tMs, getPositionAt, pool); return }
  const W = ctx.canvas.width, H = ctx.canvas.height
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  const vW = video.videoWidth, vH = video.videoHeight
  if (!vW || !vH) return

  if (!seg) {
    const scale = Math.min(W / vW, H / vH)
    ctx.drawImage(video, (W - vW * scale) / 2, (H - vH * scale) / 2, vW * scale, vH * scale)
    return
  }

  const { layout, crop_boxes } = seg
  if (layout === 'vertical' || layout === 'spotlight' || layout === 'centered') {
    const box = crop_boxes[0]; if (!box) return
    const p = getPositionAt(box.id, tMs)
    const srcW = p.w * vW, srcH = p.h * vH
    const srcAR = srcW / (srcH || 1), dstAR = W / H
    if (srcAR > dstAR) {
      const fitW = srcH * dstAR
      ctx.drawImage(video, p.x * vW + (srcW - fitW) / 2, p.y * vH, fitW, srcH, 0, 0, W, H)
    } else if (srcAR < dstAR) {
      const fitH = srcW / dstAR
      ctx.drawImage(video, p.x * vW, p.y * vH + (srcH - fitH) / 2, srcW, fitH, 0, 0, W, H)
    } else {
      ctx.drawImage(video, p.x * vW, p.y * vH, srcW, srcH, 0, 0, W, H)
    }
  } else if (layout === 'split') {
    const slotH = H / 2
    crop_boxes.slice(0, 2).forEach((box, i) => {
      const p = getPositionAt(box.id, tMs)
      coverCrop(ctx, video, p.x * vW, p.y * vH, p.w * vW, p.h * vH, 0, i * slotH, W, slotH)
    })
  } else if (layout === 'trio') {
    const slotH = H / 3
    crop_boxes.slice(0, 3).forEach((box, i) => {
      const p = getPositionAt(box.id, tMs)
      coverCrop(ctx, video, p.x * vW, p.y * vH, p.w * vW, p.h * vH, 0, i * slotH, W, slotH)
    })
  } else if (layout === 'horizontal') {
    const box = crop_boxes[0]; if (!box) return
    const p = getPositionAt(box.id, tMs)
    const srcAR = (p.w * vW) / (p.h * vH || 1)
    const dH = W / (srcAR || 1)
    ctx.drawImage(video, p.x * vW, p.y * vH, p.w * vW, p.h * vH, 0, (H - dH) / 2, W, dH)
  }
}

// ── Caption rendering ────────────────────────────────────────────────────────

const CAPTION_MAX_WORDS = 5
const CAPTION_GAP_MS = 300

// Tag words whose timestamps were estimated from a phrase-level Sarvam token.
type FlatWord = TranscriptWord & { _est?: true }

function buildCaptionChunks(words: TranscriptWord[]): FlatWord[][] {
  if (words.length === 0) return []
  const sorted = [...words].sort((a, b) => a.start_ms - b.start_ms)
  const chunks: FlatWord[][] = []
  let wordChunk: FlatWord[] = []   // accumulator for genuine single-word tokens

  const flushWordChunk = () => {
    if (wordChunk.length > 0) { chunks.push(wordChunk); wordChunk = [] }
  }

  for (const w of sorted) {
    const parts = w.word.trim().split(/\s+/).filter(Boolean)
    // Line rules use the original word (romanizing can turn one word into two, e.g. "opium ni"),
    // matching render.py _group_sentences so the preview and the download break lines alike
    const source = (w as TranscriptWord & { source_word?: string }).source_word ?? w.word

    if (source.trim().split(/\s+/).length <= 1) {
      // Real word-level token — group up to CAPTION_MAX_WORDS together.
      const prev = wordChunk[wordChunk.length - 1]
      const gap = prev ? w.start_ms - prev.end_ms : 0
      // A different speaker always starts a new line (never mix two people's words)
      const speakerChange = !!prev && prev.speaker_id != null && w.speaker_id != null && prev.speaker_id !== w.speaker_id
      if (wordChunk.length >= CAPTION_MAX_WORDS || (prev && gap > CAPTION_GAP_MS) || speakerChange) {
        flushWordChunk()
      }
      wordChunk.push(w)
      // End the line at a sentence end — same rule as the renderer (render.py _group_sentences),
      // so the preview doesn't carry the next sentence's first words on the current line
      if (/[.!?।]$/.test(source.trim())) flushWordChunk()
    } else {
      // Phrase-level token (Sarvam returned a multi-word "word").
      // Split into display chunks and divide the phrase's actual time evenly
      // across those chunks — so chunk boundaries stay anchored to the real
      // phrase start/end instead of drifting with character-count estimates.
      flushWordChunk()

      const numDisplayChunks = Math.ceil(parts.length / CAPTION_MAX_WORDS)
      const phraseDurMs = w.end_ms - w.start_ms
      const chunkDurMs = phraseDurMs / numDisplayChunks

      for (let ci = 0; ci < numDisplayChunks; ci++) {
        const chunkWords = parts.slice(ci * CAPTION_MAX_WORDS, (ci + 1) * CAPTION_MAX_WORDS)
        const chunkStartMs = Math.round(w.start_ms + ci * chunkDurMs)
        const chunkEndMs = ci === numDisplayChunks - 1
          ? w.end_ms
          : Math.round(w.start_ms + (ci + 1) * chunkDurMs)
        const wordDurMs = (chunkEndMs - chunkStartMs) / chunkWords.length

        chunks.push(
          chunkWords.map((word, wi) => ({
            ...w,
            word,
            start_ms: Math.round(chunkStartMs + wi * wordDurMs),
            end_ms: wi === chunkWords.length - 1
              ? chunkEndMs
              : Math.round(chunkStartMs + (wi + 1) * wordDurMs),
            _est: true,
          } as FlatWord))
        )
      }
    }
  }
  flushWordChunk()

  // Line end — same rule as render.py _write_ass: hold 200 ms after the last word, bridge
  // gaps under 500 ms to the next line, never overlap it. Larger gaps are real pauses and
  // stay empty. Copies the word (never mutate: words are shared with editor state).
  for (let i = 0; i < chunks.length; i++) {
    const last = chunks[i][chunks[i].length - 1]
    const nextStart = chunks[i + 1]?.[0].start_ms
    let end = last.end_ms + 200
    if (nextStart !== undefined) {
      if (nextStart - last.end_ms < 500) end = nextStart
      end = Math.min(end, nextStart)
    }
    if (end > last.end_ms) chunks[i][chunks[i].length - 1] = { ...last, end_ms: end }
  }

  return chunks
}

function findCaptionChunk(chunks: FlatWord[][], tMs: number) {
  return chunks.find(c => tMs >= c[0].start_ms && tMs <= c[c.length - 1].end_ms) ?? null
}

function drawCaptions(
  ctx: CanvasRenderingContext2D,
  chunks: FlatWord[][],
  tMs: number,
  style: Partial<CaptionStyle>,
  textCase: TextCase,
  /** A frame's text band showing the captions: centre them in it instead of at position_y */
  band?: { y: number; h: number } | null,
) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const chunk = findCaptionChunk(chunks, tMs)
  if (!chunk) return

  const color     = style.color    ?? '#FFFFFF'
  const animation = style.animation ?? 'karaoke'

  const fontSize   = Math.round(Math.min(((style.size ?? 48) / 1080) * W, W / 18))
  const lineHeight = Math.round(fontSize * 1.4)
  const PAD_X      = Math.round(W * 0.05)
  const maxLineW   = W - PAD_X * 2
  const fontFamily = style.font ?? 'sans-serif'

  ctx.save()
  ctx.font         = `700 ${fontSize}px ${fontFamily}`
  ctx.textBaseline = 'middle'
  ctx.shadowColor  = 'rgba(0,0,0,0.92)'
  ctx.shadowBlur   = 9

  // Words are already single-token after buildCaptionChunks explodes phrases.
  const wordTexts = chunk.map(w => applyCase(w.word, textCase))

  // Wrap into screen lines.
  const lines: string[][] = []
  let cur: string[] = []
  for (const wt of wordTexts) {
    const probe = [...cur, wt]
    if (cur.length > 0 && ctx.measureText(probe.join(' ')).width > maxLineW) {
      lines.push(cur)
      cur = [wt]
    } else {
      cur = probe
    }
  }
  if (cur.length > 0) lines.push(cur)

  const totalH = lines.length * lineHeight
  const yBase  = band
    ? (band.y + band.h / 2) * H - totalH / 2 + lineHeight / 2
    : (style.position_y ?? 0.84) * H - totalH + lineHeight / 2

  // Only do per-word karaoke when timestamps are real (not evenly distributed from a phrase split).
  // Estimated words (_est=true) have proportional-but-approximate timestamps that look wrong when highlighted.
  const hasEstimated = chunk.some(w => w._est)
  const activeWIdx = (animation === 'karaoke' && !hasEstimated)
    ? chunk.findIndex(w => tMs >= w.start_ms && tMs <= w.end_ms)
    : -1

  // Track cumulative word index so each token maps to its chunk position.
  let wordOffset = 0
  lines.forEach((ln, li) => {
    const y = yBase + li * lineHeight
    const lineStart = wordOffset
    wordOffset += ln.length

    const activeInLine = activeWIdx >= lineStart && activeWIdx < wordOffset

    if (!activeInLine) {
      ctx.fillStyle = color
      ctx.textAlign = 'center'
      ctx.fillText(ln.join(' '), W / 2, y)
    } else {
      const spW    = ctx.measureText(' ').width
      const widths = ln.map(w => ctx.measureText(w).width)
      const rowW   = widths.reduce((s, w) => s + w, 0) + spW * (ln.length - 1)
      let x        = (W - rowW) / 2
      ln.forEach((word, i) => {
        ctx.textAlign = 'left'
        ctx.fillStyle = color
        ctx.fillText(word, x, y)
        x += widths[i] + (i < ln.length - 1 ? spW : 0)
      })
    }
  })

  ctx.restore()
}

// ── Text overlay rendering ────────────────────────────────────────────────────

function drawTextOverlays(
  ctx: CanvasRenderingContext2D,
  overlays: TextOverlayType[],
  tMs: number,
) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  for (const o of overlays) {
    if (tMs < o.start_ms || tMs >= o.end_ms) continue
    const x = (o.x ?? 0.1) * W
    const y = (o.y ?? 0.4) * H
    const fontSize = Math.max(14, Math.round(((o.size ?? 72) / 1080) * H))
    const fontFamily = o.font ?? 'sans-serif'
    ctx.save()
    ctx.font = `700 ${fontSize}px ${fontFamily}`
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 8
    ctx.fillStyle = o.color ?? '#ffffff'
    ctx.fillText(o.text, x, y)
    ctx.restore()
  }
}

// ── 9:16 output canvas ────────────────────────────────────────────────────────

interface OutputCanvasProps {
  videoRef: RefObject<HTMLVideoElement | null>
  currentTimeMs: number
  clipStartMs?: number
  activeSegment: SegmentLocal | null
  getPositionAt: (boxId: string, t_ms: number) => BoxPosition
  overlays?: Overlay[]
  activeOverlayId?: string | null
  onOverlayChange?: (id: string, updates: Partial<Overlay>) => void
  onSelectOverlay?: (id: string) => void
  onDeleteOverlay?: (id: string) => void
  className?: string
  style?: React.CSSProperties
  // Set .current = true before a manual layout change to suppress the crossfade animation
  skipTransitionRef?: RefObject<boolean>
  // Caption rendering
  words?: TranscriptWord[]
  captionStyle?: Partial<CaptionStyle>
  captionTextCase?: TextCase
  showCaptions?: boolean
  // Text overlays
  textOverlays?: TextOverlayType[]
  activeTextOverlayId?: string | null
  onTextOverlayChange?: (id: string, updates: Partial<TextOverlayType>) => void
  onSelectTextOverlay?: (id: string | null) => void
  onDeleteTextOverlay?: (id: string) => void
  onCaptionPositionChange?: (y: number) => void
  /** Other videos and photos shown in frame slots */
  frameMedia?: FrameMediaPool | null
  /** "+" on an empty frame slot or band: takes the user to that lane on the timeline */
  onFrameLaneClick?: (lane: FrameLane) => void
  /** Clicking a photo, video or text in a frame selects it */
  onFrameItemClick?: (id: string) => void
  activeFrameItemId?: string | null
}

export function OutputCanvas({
  videoRef, currentTimeMs, clipStartMs = 0, activeSegment, getPositionAt,
  overlays = [], activeOverlayId, onOverlayChange, onSelectOverlay, onDeleteOverlay,
  className, style, skipTransitionRef,
  words, captionStyle, captionTextCase = 'title', showCaptions = false,
  textOverlays = [], activeTextOverlayId, onTextOverlayChange, onSelectTextOverlay, onDeleteTextOverlay,
  onCaptionPositionChange, frameMedia, onFrameLaneClick, onFrameItemClick, activeFrameItemId,
}: OutputCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameMediaRef = useRef(frameMedia)
  frameMediaRef.current = frameMedia

  // Updated synchronously during render so the RAF loop always reads fresh values
  // without needing to be recreated or scheduled via useEffect.
  const activeSegmentRef = useRef(activeSegment)
  const currentTimeMsRef = useRef(currentTimeMs)
  const clipStartMsRef   = useRef(clipStartMs)
  const getPositionAtRef = useRef(getPositionAt)
  activeSegmentRef.current = activeSegment
  currentTimeMsRef.current = currentTimeMs
  clipStartMsRef.current   = clipStartMs
  getPositionAtRef.current = getPositionAt

  const prevSegIdRef    = useRef<string | null>(null)
  const snapshotRef     = useRef<HTMLCanvasElement | null>(null)
  const transitionStart = useRef<number | null>(null)

  // Caption refs — updated synchronously at render time (same pattern as above)
  const captionStyleRef  = useRef(captionStyle)
  const captionCaseRef   = useRef(captionTextCase)
  const showCaptionsRef  = useRef(showCaptions)
  captionStyleRef.current = captionStyle
  captionCaseRef.current  = captionTextCase
  showCaptionsRef.current = showCaptions

  const textOverlaysRef = useRef(textOverlays)
  textOverlaysRef.current = textOverlays

  // Pre-build caption chunks so the RAF loop doesn't re-sort on every frame.
  // Rebuild only when the words array identity changes.
  const captionChunksRef  = useRef<FlatWord[][]>([])
  const prevWordsRef      = useRef<typeof words>(undefined)
  if (words !== prevWordsRef.current) {
    prevWordsRef.current   = words
    captionChunksRef.current = buildCaptionChunks(words ?? [])
  }

  useEffect(() => {
    let rafId: number

    const loop = () => {
      const canvas = canvasRef.current
      const video  = videoRef.current

      if (canvas && video && video.readyState >= 2) {
        const ctx    = canvas.getContext('2d')
        const seg    = activeSegmentRef.current
        const newId  = seg?.id ?? null

        if (ctx) {
          // Detect segment boundary — snapshot MUST be captured before paintSegment
          // overwrites the canvas with new-segment content.
          if (newId !== prevSegIdRef.current && prevSegIdRef.current !== null) {
            const skip = skipTransitionRef?.current ?? false
            if (skipTransitionRef) skipTransitionRef.current = false
            if (!skip) {
              if (!snapshotRef.current) snapshotRef.current = document.createElement('canvas')
              const snap = snapshotRef.current
              snap.width  = canvas.width
              snap.height = canvas.height
              snap.getContext('2d')!.drawImage(canvas, 0, 0)
              transitionStart.current = performance.now()
            } else {
              transitionStart.current = null
            }
          }
          prevSegIdRef.current = newId

          // Read current time directly from the video element — this is always
          // frame-accurate and never lags behind the React state update cycle.
          const liveMs = video.currentTime * 1000
          // Keyframes are stored with clip-relative t_ms (0 = clip start).
          // Caption words use absolute timestamps matching liveMs directly.
          const clipRelativeMs = Math.max(0, liveMs - clipStartMsRef.current)

          // Keep frame slots' own videos in step with the main player, then draw
          frameMediaRef.current?.sync(seg, clipRelativeMs, !video.paused, video)
          paintSegment(ctx, video, seg, clipRelativeMs, getPositionAtRef.current, frameMediaRef.current)

          // Composite the outgoing snapshot on top with decreasing alpha
          if (transitionStart.current !== null && snapshotRef.current) {
            const elapsed = performance.now() - transitionStart.current
            if (elapsed < CROSSFADE_MS) {
              const alpha = 1 - easeInOut(elapsed / CROSSFADE_MS)
              ctx.save()
              ctx.globalAlpha = alpha
              ctx.drawImage(snapshotRef.current, 0, 0, canvas.width, canvas.height)
              ctx.restore()
            } else {
              transitionStart.current = null
            }
          }

          // Draw captions on top of the video frame
          if (showCaptionsRef.current && captionChunksRef.current.length > 0) {
            const captionLookupMs = liveMs - (captionStyleRef.current?.timing_offset_ms ?? 0)
            drawCaptions(ctx, captionChunksRef.current, captionLookupMs, captionStyleRef.current ?? {}, captionCaseRef.current, captionBandAt(seg, clipRelativeMs))
          }

          // Draw text overlays (clip-relative time)
          if (textOverlaysRef.current.length > 0) {
            drawTextOverlays(ctx, textOverlaysRef.current, clipRelativeMs)
          }
        }
      }

      rafId = requestAnimationFrame(loop)
    }

    rafId = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafId)
  }, [videoRef])

  // Active overlays at current time
  const activeOverlays = overlays.filter(o => o.start_ms <= currentTimeMs && currentTimeMs < o.end_ms)
  const activeTextOverlays = textOverlays.filter(o => currentTimeMs >= o.start_ms && currentTimeMs < o.end_ms)

  // Frame rows with nothing in them right now get a "+" that leads to their timeline lane
  const emptyLanes = useMemo(() => {
    if (!onFrameLaneClick || !activeSegment || !isFrameLayout(activeSegment.layout)) return []
    const frame = frameOf(activeSegment)
    const main = frame.main_slots ?? [0]
    return frameLanesFor(activeSegment).filter(r =>
      !itemAt(frame, r.lane, currentTimeMs, activeSegment) && (r.lane === 'band' || !main.includes(r.lane)))
  }, [activeSegment, currentTimeMs, onFrameLaneClick])

  // Frame rows showing an item right now: click to select it (text opens in the Text tool).
  // No z-index on these or the "+" tiles: overlay boxes come later in the DOM and stay clickable above them.
  const itemRows = useMemo(() => {
    if (!onFrameItemClick || !activeSegment || !isFrameLayout(activeSegment.layout)) return []
    const frame = frameOf(activeSegment)
    return frameLanesFor(activeSegment).flatMap(r => {
      const it = itemAt(frame, r.lane, currentTimeMs, activeSegment)
      return it ? [{ ...r, item: it }] : []
    })
  }, [activeSegment, currentTimeMs, onFrameItemClick])

  return (
    <div className={className} style={{ ...style, position: 'relative', containerType: 'inline-size' }} onClick={() => onSelectTextOverlay?.(null)}>
      <canvas
        ref={canvasRef}
        width={540}
        height={960}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
      {itemRows.map(r => {
        const on = r.item.id === activeFrameItemId
        return (
          <button key={r.item.id}
            onClick={e => { e.stopPropagation(); onFrameItemClick?.(r.item.id) }}
            aria-label={`Select the ${r.item.kind === 'text' ? 'text' : r.item.kind} in the ${r.label.toLowerCase()} ${r.lane === 'band' ? 'band' : 'slot'}`}
            className="absolute left-0 right-0 transition-shadow hover:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)]"
            style={{ top: `${r.y * 100}%`, height: `${r.h * 100}%`, boxShadow: on ? 'inset 0 0 0 2px #c8ff00' : undefined }} />
        )
      })}
      {emptyLanes.map(r => (
        <button key={String(r.lane)}
          onClick={e => { e.stopPropagation(); onFrameLaneClick?.(r.lane) }}
          aria-label={`Add to the ${r.label.toLowerCase()} ${r.lane === 'band' ? 'band' : 'slot'} on the timeline`}
          title="Add a photo, video or text on the timeline"
          className="group absolute left-0 right-0 flex items-center justify-center"
          style={{ top: `${r.y * 100}%`, height: `${r.h * 100}%` }}>
          <span className="flex items-center gap-1.5 rounded-full transition-transform group-hover:scale-105"
            style={{ padding: '5px 11px 5px 7px', background: 'rgba(255,255,255,0.1)', border: '1px dashed rgba(255,255,255,0.35)', color: 'rgba(255,255,255,0.85)', fontSize: 'max(10px, 3.2cqw)', fontWeight: 600 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            {r.lane === 'band' ? 'Text' : 'Add'}
          </span>
        </button>
      ))}
      {/* Image overlay boxes */}
      {activeOverlays.map(ov => (
        <OverlayBox
          key={ov.id}
          overlay={ov}
          isActive={ov.id === activeOverlayId}
          onChange={updates => onOverlayChange?.(ov.id, updates)}
          onSelect={() => onSelectOverlay?.(ov.id)}
          onDelete={() => onDeleteOverlay?.(ov.id)}
        />
      ))}
      {/* Text overlay boxes — drag to reposition */}
      {activeTextOverlays.map(o => (
        <TextOverlayBox
          key={o.id}
          overlay={o}
          isActive={o.id === activeTextOverlayId}
          onChange={updates => onTextOverlayChange?.(o.id, updates)}
          onSelect={onSelectTextOverlay ?? (() => {})}
          onDelete={() => onDeleteTextOverlay?.(o.id)}
        />
      ))}
      {/* Caption position drag handle */}
      {showCaptions && onCaptionPositionChange && (
        <CaptionDragHandle
          position_y={captionStyle?.position_y ?? 0.84}
          onChange={onCaptionPositionChange}
        />
      )}
    </div>
  )
}

// ── OverlayBox — free-position drag+resize for image/video overlays ──────────

interface OverlayBoxProps {
  overlay: Overlay
  isActive: boolean
  onChange: (updates: Partial<Overlay>) => void
  onSelect: () => void
  onDelete: () => void
}

function OverlayBox({ overlay, isActive, onChange, onSelect, onDelete }: OverlayBoxProps) {
  const ref = useRef<HTMLDivElement>(null)

  function cRect() {
    const r = ref.current?.parentElement?.getBoundingClientRect()
    return r ? { w: r.width, h: r.height } : { w: 1, h: 1 }
  }

  function startDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).dataset.handle) return
    e.stopPropagation()
    onSelect()
    const sx = e.clientX, sy = e.clientY
    const start = { x: overlay.x, y: overlay.y }
    let moved = false
    function move(ev: MouseEvent) {
      moved = true
      const { w, h } = cRect()
      onChange({
        x: Math.max(0, Math.min(1 - overlay.w, start.x + (ev.clientX - sx) / w)),
        y: Math.max(0, Math.min(1 - overlay.h, start.y + (ev.clientY - sy) / h)),
      })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function startResize(e: React.MouseEvent, dir: string) {
    e.stopPropagation()
    const sx = e.clientX, sy = e.clientY
    const start = { x: overlay.x, y: overlay.y, w: overlay.w, h: overlay.h }
    const re = start.x + start.w, be = start.y + start.h
    function move(ev: MouseEvent) {
      const { w, h } = cRect()
      const dx = (ev.clientX - sx) / w, dy = (ev.clientY - sy) / h
      let { x, y, w: bw, h: bh } = start
      if (dir.includes('e')) bw = Math.max(0.04, Math.min(1 - x, bw + dx))
      if (dir.includes('s')) bh = Math.max(0.04, Math.min(1 - y, bh + dy))
      if (dir.includes('w')) { const nx = Math.max(0, Math.min(re - 0.04, x + dx)); bw = re - nx; x = nx }
      if (dir.includes('n')) { const ny = Math.max(0, Math.min(be - 0.04, y + dy)); bh = be - ny; y = ny }
      onChange({ x, y, w: Math.max(0.04, bw), h: Math.max(0.04, bh) })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const imageUrl = useMemo(() => {
    if (overlay.type !== 'image') return null
    return overlay.preview_url ?? null
  }, [overlay.type, overlay.preview_url])

  const color = '#f59e0b'
  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: `${overlay.x * 100}%`, top: `${overlay.y * 100}%`,
        width: `${overlay.w * 100}%`, height: `${overlay.h * 100}%`,
        border: `2px solid ${isActive ? color : `${color}66`}`,
        boxSizing: 'border-box', cursor: 'move', userSelect: 'none',
        boxShadow: isActive ? `0 0 0 1px ${color}55` : 'none',
        overflow: 'hidden',
      }}
      onMouseDown={startDrag}
    >
      {/* Image content */}
      {imageUrl
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none', display: 'block' }} />
        : <div style={{ width: '100%', height: '100%', background: `${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color }}>IMG</span>
          </div>
      }

      {/* Delete button — top-right corner, always visible */}
      <button
        data-handle="1"
        onMouseDown={e => { e.stopPropagation(); onDelete() }}
        style={{
          position: 'absolute', top: -10, right: -10,
          width: 20, height: 20, borderRadius: '50%',
          background: '#ef4444', border: '2px solid #1a1a1a',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', pointerEvents: 'auto', boxSizing: 'border-box',
        }}
      >
        <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="white" strokeWidth="1.4" strokeLinecap="round"/></svg>
      </button>

      {/* Resize handles */}
      {HANDLES.map(({ cursor, pos: hPos, dir }) => (
        <div
          key={dir}
          data-handle="1"
          style={{
            position: 'absolute', width: 10, height: 10,
            background: '#fff', border: `2px solid ${color}`,
            borderRadius: 2, cursor, pointerEvents: 'auto', boxSizing: 'border-box',
            opacity: isActive ? 1 : 0.4,
            ...hPos,
          }}
          onMouseDown={e => startResize(e, dir)}
        />
      ))}
    </div>
  )
}

// ── CaptionDragHandle — drag to set caption vertical position ────────────────

function CaptionDragHandle({ position_y, onChange }: { position_y: number; onChange: (y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)

  function startDrag(e: React.MouseEvent) {
    e.stopPropagation()
    const sy = e.clientY
    const oy = position_y
    function move(ev: MouseEvent) {
      const h = ref.current?.parentElement?.getBoundingClientRect().height ?? 1
      onChange(Math.max(0.05, Math.min(0.98, oy + (ev.clientY - sy) / h)))
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div
      ref={ref}
      onMouseDown={startDrag}
      title="Drag to reposition captions"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: `${position_y * 100}%`,
        transform: 'translateY(-50%)',
        height: 40,
        cursor: 'ns-resize',
        userSelect: 'none',
        zIndex: 10,
        background: 'transparent',
      }}
    />
  )
}

// ── TextOverlayBox — draggable positioning handle for text overlays ───────────

interface TextOverlayBoxProps {
  overlay: TextOverlayType
  isActive: boolean
  onChange: (updates: Partial<TextOverlayType>) => void
  onSelect: (id: string | null) => void
  onDelete: () => void
}

function TextOverlayBox({ overlay, isActive, onChange, onSelect, onDelete }: TextOverlayBoxProps) {
  const ref = useRef<HTMLDivElement>(null)

  function cRect() {
    const r = ref.current?.parentElement?.getBoundingClientRect()
    return r ? { w: r.width, h: r.height } : { w: 1, h: 1 }
  }

  function startDrag(e: React.MouseEvent) {
    e.stopPropagation()
    onSelect(overlay.id)
    const sx = e.clientX, sy = e.clientY
    const ox = overlay.x ?? 0.1, oy = overlay.y ?? 0.4
    function move(ev: MouseEvent) {
      const { w, h } = cRect()
      onChange({
        x: Math.max(0, Math.min(0.92, ox + (ev.clientX - sx) / w)),
        y: Math.max(0, Math.min(0.92, oy + (ev.clientY - sy) / h)),
      })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function startResize(e: React.MouseEvent) {
    e.stopPropagation()
    const sx = e.clientX
    const initialSize = overlay.size ?? 72
    function move(ev: MouseEvent) {
      const { w } = cRect()
      const dx = ev.clientX - sx
      onChange({ size: Math.max(20, Math.min(300, Math.round(initialSize + dx * 270 / w))) })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const x = overlay.x ?? 0.1
  const y = overlay.y ?? 0.4
  const color = overlay.color ?? '#ffffff'
  const accent = '#c8ff00'

  return (
    <div
      ref={ref}
      onMouseDown={startDrag}
      onClick={e => { e.stopPropagation(); onSelect(overlay.id) }}
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        cursor: 'move',
        userSelect: 'none',
        border: `1.5px solid ${isActive ? accent : 'transparent'}`,
        borderRadius: 3,
        padding: 0,
        background: isActive ? 'rgba(200,255,0,0.12)' : 'transparent',
        backdropFilter: 'none',
        boxShadow: isActive ? `0 0 0 1px ${accent}44` : 'none',
        maxWidth: '90%',
      }}
    >
      {/* Invisible text — sized to match canvas text (canvas 540×960; size/6.075 cqw = size/1080*960/540 of container width) */}
      <span style={{ color: 'transparent', fontSize: `${(overlay.size ?? 72) / 6.075}cqw`, fontWeight: 700, fontFamily: 'sans-serif', whiteSpace: 'nowrap', display: 'block', pointerEvents: 'none', lineHeight: 1, userSelect: 'none', margin: 0, padding: 0 }}>
        {overlay.text || '…'}
      </span>
      {isActive && (
        <button
          onMouseDown={e => { e.stopPropagation(); onDelete() }}
          style={{
            position: 'absolute', top: -9, right: -9,
            width: 18, height: 18, borderRadius: '50%',
            background: '#ef4444', border: '2px solid #111',
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'auto',
          }}
        >
          <svg width="7" height="7" viewBox="0 0 8 8" fill="none"><path d="M1 1l6 6M7 1L1 7" stroke="white" strokeWidth="1.4" strokeLinecap="round"/></svg>
        </button>
      )}
      {isActive && (
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          style={{
            position: 'absolute', bottom: -6, right: -6,
            width: 14, height: 14, borderRadius: 3,
            background: accent, border: '2px solid #111',
            cursor: 'ew-resize', pointerEvents: 'auto',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <svg width="6" height="6" viewBox="0 0 8 8" fill="none">
            <path d="M1 4h6M5 2l2 2-2 2" stroke="black" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
    </div>
  )
}

// ── DraggableBox ─────────────────────────────────────────────────────────────

interface DraggableBoxProps {
  pos: BoxPosition
  /** Locked w/h in normalised units; null = free resize (Horizontal) */
  aspect: number | null
  color: string
  isActive: boolean
  label: string
  onSelect: () => void
  onChange: (newPos: BoxPosition) => void
}

const MIN_BOX = 0.05

function DraggableBox({ pos, aspect, color, isActive, label, onSelect, onChange }: DraggableBoxProps) {
  const ref = useRef<HTMLDivElement>(null)

  function cRect() {
    const r = ref.current?.parentElement?.getBoundingClientRect()
    return r ? { w: r.width, h: r.height } : { w: 1, h: 1 }
  }

  function startDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).dataset.handle) return
    e.stopPropagation()
    e.preventDefault()
    onSelect()
    const sx = e.clientX, sy = e.clientY, start = { ...pos }
    function move(ev: MouseEvent) {
      const { w, h } = cRect()
      onChange({
        ...start,
        x: Math.max(0, Math.min(1 - start.w, start.x + (ev.clientX - sx) / w)),
        y: Math.max(0, Math.min(1 - start.h, start.y + (ev.clientY - sy) / h)),
      })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function startResize(e: React.MouseEvent, dir: string) {
    e.stopPropagation()
    e.preventDefault()
    onSelect()
    const sx = e.clientX, sy = e.clientY, start = { ...pos }
    const re = start.x + start.w, be = start.y + start.h
    function move(ev: MouseEvent) {
      const { w, h } = cRect()
      const dx = (ev.clientX - sx) / w, dy = (ev.clientY - sy) / h
      if (aspect) {
        // Locked shape: resize from a corner while the opposite corner stays put
        const west = dir.includes('w'), north = dir.includes('n')
        const ax = west ? re : start.x, ay = north ? be : start.y
        const growW = west ? -dx : dx, growH = (north ? -dy : dy) * aspect
        const maxW = Math.min(west ? ax : 1 - ax, (north ? ay : 1 - ay) * aspect)
        const nw = Math.max(Math.min(MIN_BOX, maxW), Math.min(maxW, start.w + (growW + growH) / 2))
        const nh = nw / aspect
        onChange({ x: west ? ax - nw : ax, y: north ? ay - nh : ay, w: nw, h: nh })
        return
      }
      let { x, y, w: bw, h: bh } = start
      if (dir.includes('e')) bw = Math.max(MIN_BOX, Math.min(1 - x, bw + dx))
      if (dir.includes('s')) bh = Math.max(MIN_BOX, Math.min(1 - y, bh + dy))
      if (dir.includes('w')) { const nx = Math.max(0, Math.min(re - MIN_BOX, x + dx)); bw = re - nx; x = nx }
      if (dir.includes('n')) { const ny = Math.max(0, Math.min(be - MIN_BOX, y + dy)); bh = be - ny; y = ny }
      onChange({ x, y, w: bw, h: bh })
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Locked boxes resize from the corners only; edge handles would break the shape
  const handles = aspect ? HANDLES.filter(h => h.dir.length === 2) : HANDLES

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        left: `${pos.x * 100}%`, top: `${pos.y * 100}%`,
        width: `${pos.w * 100}%`, height: `${pos.h * 100}%`,
        border: `2px solid ${color}`,
        background: isActive ? `${color}10` : 'transparent',
        boxSizing: 'border-box', cursor: 'move', pointerEvents: 'auto', userSelect: 'none',
        zIndex: isActive ? 2 : 1,
      }}
      onMouseDown={startDrag}
      onClick={e => { e.stopPropagation(); onSelect() }}
    >
      {/* Slot label — what this box becomes in the output */}
      <div style={{
        position: 'absolute', top: 6, left: 6,
        fontSize: 10, fontWeight: 700, color: '#fff', lineHeight: 1.4,
        background: color, padding: '1px 7px', borderRadius: 4, pointerEvents: 'none',
        textShadow: '0 1px 2px rgba(0,0,0,0.4)',
      }}>{label}</div>

      {/* Zoom badge — how far this crop is punched in */}
      <div style={{
        position: 'absolute', top: 6, right: 6,
        fontSize: 10, fontWeight: 700, color: '#fff', lineHeight: 1.4,
        background: 'rgba(0,0,0,0.65)', padding: '1px 7px', borderRadius: 4, pointerEvents: 'none',
      }}>
        {(Math.round(10 / Math.max(0.1, pos.h)) / 10).toFixed(1)}x
      </div>

      {handles.map(({ cursor, pos: hPos, dir }) => (
        <div
          key={dir}
          data-handle="1"
          style={{
            position: 'absolute', width: 12, height: 12,
            background: '#fff', border: `2px solid ${color}`,
            borderRadius: 3, cursor, pointerEvents: 'auto', boxSizing: 'border-box',
            ...hPos,
          }}
          onMouseDown={e => startResize(e, dir)}
        />
      ))}
    </div>
  )
}
