'use client'

import { useRef, useEffect, useCallback, useState, useMemo, useId } from 'react'
import type { RefObject } from 'react'
import type { SegmentLocal, Overlay, TextOverlay as TextOverlayType, CaptionStyle, TranscriptWord, FrameItem, FrameLane, CornerStyle } from '@chai-cut/shared'
import type { BoxPosition } from '@/lib/interpolation'
import type { TextCase } from './CaptionStyler'
import { applyCase } from './CaptionStyler'
import { normalizedSlotAspect, fitToAspect } from '@/modules/editor/utils'
import { isFrameLayout, frameSlotLabels, frameLanesFor, frameBandShown, frameOf, itemAt, captionBandAt, cornerGeometry, frameRows } from '@/modules/editor/frames'
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
            .map(box => {
              // Slots can differ in shape (Big + Small): each box is locked to its own slot's
              const a = frame ? normalizedSlotAspect(layout, videoAR ?? undefined, frameBandShown(activeSegment), box.slot_index) : aspect
              return { box, aspect: a, label: labels?.[box.slot_index] ?? String(box.slot_index + 1), pos: fitToAspect(getPositionAt(box.id, currentTimeMs), a) }
            })
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
              {boxes.map(({ box, pos, label, aspect }, slotIdx) => (
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
  const cx = (it.x ?? 0.5) * W, cy = y + (it.y ?? 0.5) * h
  lines.forEach((ln, i) => ctx.fillText(ln, cx, cy + (i - (lines.length - 1) / 2) * lh))
  ctx.restore()
}

// Size of a text block as shares of the 1080×1920 frame, measured with the same font as the preview
let measureCtx: CanvasRenderingContext2D | null = null
function frameTextBlock(text: string, size1080: number): { lines: string[]; w: number; h: number } {
  const lines = text.trim() ? wrapFrameText(text, 1080, size1080) : ['Your text']
  if (!measureCtx && typeof document !== 'undefined') measureCtx = document.createElement('canvas').getContext('2d')
  let widest = 0
  if (measureCtx) {
    measureCtx.font = `700 ${size1080}px Montserrat, sans-serif`
    for (const ln of lines) widest = Math.max(widest, measureCtx.measureText(ln).width)
  } else widest = Math.max(...lines.map(l => l.length)) * size1080 * 0.56
  const pad = size1080 * 0.4
  return { lines, w: Math.min(1, (widest + pad) / 1080), h: (lines.length * size1080 * 1.2 + pad) / 1920 }
}

/**
 * A frame's text in the preview: drag it to move it around its band (or slot), drag the corner to
 * make it bigger or smaller. Position and size are saved on the text, and the export uses them.
 */
function FrameTextBox({ row, item, selected, onSelect, onChange }: {
  row: { y: number; h: number }
  item: FrameItem
  selected: boolean
  onSelect: () => void
  onChange: (patch: Partial<Pick<FrameItem, 'x' | 'y' | 'size'>>) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const size = item.size ?? 64
  const empty = !item.text?.trim()
  const block = frameTextBlock(item.text ?? '', size)
  const x = item.x ?? 0.5, y = item.y ?? 0.5
  // Keep the whole block inside its row
  const clampX = (v: number) => block.w >= 1 ? 0.5 : Math.max(block.w / 2, Math.min(1 - block.w / 2, v))
  const halfH = block.h / 2 / row.h
  const clampY = (v: number) => halfH >= 0.5 ? 0.5 : Math.max(halfH, Math.min(1 - halfH, v))
  const cx = clampX(x), cy = row.y + row.h * clampY(y)

  function start(e: React.PointerEvent, mode: 'move' | 'resize') {
    e.stopPropagation(); e.preventDefault()
    onSelect()
    const rect = ref.current?.parentElement?.getBoundingClientRect()
    if (!rect) return
    const sx = e.clientX, sy = e.clientY, x0 = cx, y0 = clampY(y), size0 = size, w0 = block.w * rect.width
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - sx) / rect.width, dy = (ev.clientY - sy) / rect.height
      if (mode === 'move') onChange({ x: clampX(x0 + dx), y: clampY(y0 + dy / row.h) })
      else onChange({ size: Math.round(Math.max(24, Math.min(200, size0 * (w0 + 2 * (ev.clientX - sx)) / w0))) })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div ref={ref} role="button" tabIndex={-1} aria-label="Text in the frame: drag to move, drag the corner to resize"
      onPointerDown={e => start(e, 'move')} onClick={e => e.stopPropagation()}
      className="group absolute flex items-center justify-center"
      style={{
        left: `${(cx - block.w / 2) * 100}%`, top: `${(cy - block.h / 2) * 100}%`, width: `${block.w * 100}%`, height: `${block.h * 100}%`,
        cursor: 'move', touchAction: 'none', borderRadius: 4,
        outline: selected ? '1.5px dashed #c8ff00' : undefined,
      }}>
      <span className="absolute inset-0 rounded pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ boxShadow: selected ? undefined : 'inset 0 0 0 1px rgba(255,255,255,0.45)' }} />
      {empty && (
        <span className="pointer-events-none font-bold" style={{ fontSize: `${(size / 1080) * 100}cqw`, color: 'rgba(255,255,255,0.35)' }}>Your text</span>
      )}
      {selected && (
        <span onPointerDown={e => start(e, 'resize')} aria-label="Drag to resize the text"
          className="absolute rounded-full" style={{ right: -6, bottom: -6, width: 12, height: 12, background: '#c8ff00', border: '1.5px solid #000', cursor: 'nwse-resize', touchAction: 'none' }} />
      )}
    </div>
  )
}

/**
 * Draw media into a slot row. With rounded corners the row is black and the media sits inset in a
 * rounded box (the same look render.py builds with its corner mask); without, it fills the row.
 */
function inSlot(ctx: CanvasRenderingContext2D, corners: CornerStyle | undefined, y: number, h: number,
  draw: (dx: number, dy: number, dw: number, dh: number) => void) {
  const W = ctx.canvas.width
  const g = cornerGeometry(corners)
  if (!g) { draw(0, y, W, h); return }
  const k = W / 1080, m = g.inset * k, r = g.radius * k
  ctx.fillStyle = '#000'
  ctx.fillRect(0, y, W, h)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(m, y + m, W - 2 * m, h - 2 * m, r)
  ctx.clip()
  draw(m, y + m, W - 2 * m, h - 2 * m)
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
  // Caption strip (no lane): a plain band the captions are drawn on
  for (const r of frameRows(seg.layout as Parameters<typeof frameRows>[0])) {
    if (r.kind !== 'caption') continue
    ctx.fillStyle = bandBg
    ctx.fillRect(0, Math.round(r.y * H), W, Math.round((r.y + r.h) * H) - Math.round(r.y * H))
  }
  for (const row of frameLanesFor(seg)) {
    const y = Math.round(row.y * H), h = Math.round((row.y + row.h) * H) - Math.round(row.y * H)
    // A hidden item (kept only for its sound) isn't drawn: what's under it shows
    const at = itemAt(frame, row.lane, tMs, seg)
    const it = at?.hidden ? null : at
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
        inSlot(ctx, frame.main_corners?.[String(row.lane)], y, h,
          (dx, dy, dw, dh) => coverCrop(ctx, video, p.x * vW, p.y * vH, p.w * vW, p.h * vH, dx, dy, dw, dh))
      }
    }
    if (!it) continue
    if (it.kind === 'text') { paintFrameText(ctx, it, '#000000', y, h); continue }
    if (it.kind === 'photo') {
      const img = it.image_url ? pool?.image(it.image_url) : null
      if (img && img.complete && img.naturalWidth) {
        const from = Math.max(it.start_ms, seg.start_ms), to = Math.min(it.end_ms, seg.end_ms)
        const m = photoMotion(it.motion, (tMs - from) / Math.max(1, to - from))
        inSlot(ctx, it.corners, y, h, (dx, dy, dw, dh) => coverSource(ctx, img, img.naturalWidth, img.naturalHeight, dx, dy, dw, dh, m.zoom, m.panX))
      }
      continue
    }
    const v = pool?.video(it)
    if (v && v.readyState >= 2) inSlot(ctx, it.corners, y, h, (dx, dy, dw, dh) => coverSource(ctx, v, v.videoWidth, v.videoHeight, dx, dy, dw, dh))
  }
}

function paintSegment(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  seg: SegmentLocal | null,
  tMs: number,
  getPositionAt: (id: string, t: number) => BoxPosition,
  pool?: FrameMediaPool | null,
  /** A split/trio slot's own picture (a borrowed reaction from another moment): null = draw `video`,
   *  false = it has its own picture but it isn't ready (stays dark for that moment, never the wrong one) */
  slotSource?: ((seg: SegmentLocal, box: SegmentLocal['crop_boxes'][number]) => HTMLVideoElement | null | false) | null,
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
  } else if (layout === 'split' || layout === 'trio') {
    const n = layout === 'split' ? 2 : 3
    const slotH = H / n
    crop_boxes.slice(0, n).forEach((box, i) => {
      const p = getPositionAt(box.id, tMs)
      const own = slotSource?.(seg, box)
      // A borrowed slot still loading stays dark for a moment rather than showing the wrong moment
      if (own === false || (own && own.readyState < 2)) return
      const src = own ?? video
      const sW = own ? own.videoWidth || vW : vW, sH = own ? own.videoHeight || vH : vH
      // A slot framing the whole picture (a related visual) shows it whole, fitted with bars,
      // as the export does (render.py _is_full_frame)
      if (p.x < 0.005 && p.y < 0.005 && p.w > 0.995 && p.h > 0.995) {
        const k = Math.min(W / sW, slotH / sH)
        ctx.drawImage(src, 0, 0, sW, sH, (W - sW * k) / 2, i * slotH + (slotH - sH * k) / 2, sW * k, sH * k)
        return
      }
      coverCrop(ctx, src, p.x * sW, p.y * sH, p.w * sW, p.h * sH, 0, i * slotH, W, slotH)
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

function buildCaptionChunks(words: TranscriptWord[], maxWords = CAPTION_MAX_WORDS): FlatWord[][] {
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
      if (wordChunk.length >= maxWords || (prev && gap > CAPTION_GAP_MS) || speakerChange) {
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

      const numDisplayChunks = Math.ceil(parts.length / maxWords)
      const phraseDurMs = w.end_ms - w.start_ms
      const chunkDurMs = phraseDurMs / numDisplayChunks

      for (let ci = 0; ci < numDisplayChunks; ci++) {
        const chunkWords = parts.slice(ci * maxWords, (ci + 1) * maxWords)
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

// ── Animated caption presets ──────────────────────────────────────────────────
// Mirrors render.py _preset_events: same lines, timing and colours as the export.
//   pop       — each word appears when spoken, scaling 80% → 110% → 100% in 150 ms
//   highlight — 3 words a line; a highlight_color box behind the spoken word
//   bounce    — the line slides up into place and fades in; the spoken word in highlight_color
//   word      — one big word at a time, centre screen
//   hormozi   — 3 capitalised words a line, thick outline; the spoken word in highlight_color, 115%
//   box       — the line on a dark box, no outline; the spoken word in highlight_color
//   glow      — words glow in highlight_color; the spoken word bright, the others dimmed
// Emphasised words (style.emphasis, keyed by the word's start_ms) are highlight_color and 15% larger.

export const PRESET_ANIMATIONS = ['pop', 'highlight', 'bounce', 'word', 'hormozi', 'box', 'glow'] as const
const isPreset = (a?: string | null) => (PRESET_ANIMATIONS as readonly string[]).includes(a ?? '')
const POP_MS = 150
const BOUNCE_MS = 180
const BOX_PAD = 14
const WORD_SCALE = 1.5
const EMPHASIS_SCALE = 1.15
const HORMOZI_SCALE = 1.15      // the spoken word
const HORMOZI_STROKE = 2        // added to the outline
const LINE_BOX = 'rgba(0,0,0,0.62)'   // box preset (render.py &H60000000)
const GLOW_BLUR = 6             // px at 1080 wide
const GLOW_DIM = 0.65           // the words not being spoken

/** The karaoke colour of the spoken word: the highlight colour, unless it is the text's own */
export function karaokeLive(color: string, hl: string) {
  if (hl.toLowerCase() !== color.toLowerCase()) return hl
  return color.toLowerCase() === '#ffffff' ? '#FFE700' : '#FFFFFF'
}

// The export draws captions with these bundled fonts (render.py _FONT_FILES; anything else falls
// back to Roboto) through libass, which sizes a font so its full height (OS/2 winAscent +
// winDescent) equals the caption size. The preview loads the same files (public/caption-fonts)
// and applies the same factor (unitsPerEm / (winAscent + winDescent)), so preset captions come
// out the size they will be in the download.
const EXPORT_FONTS: Record<string, { family: string; file: string; em: number }> = {
  'noto-sans-telugu':     { family: 'CC Noto Sans Telugu', file: 'NotoSansTelugu-Regular.ttf', em: 0.677 },
  'noto-sans-devanagari': { family: 'CC Noto Sans Devanagari', file: 'NotoSansDevanagari-Regular.ttf', em: 0.525 },
  'roboto':               { family: 'CC Roboto', file: 'Roboto-Regular.ttf', em: 0.758 },
  'montserrat-bold':      { family: 'CC Montserrat Bold', file: 'Montserrat-Bold.ttf', em: 0.640 },
}
const loadedExportFonts = new Set<string>()
function exportFont(id?: string | null) {
  const f = EXPORT_FONTS[id ?? ''] ?? EXPORT_FONTS.roboto
  if (!loadedExportFonts.has(f.family) && typeof FontFace !== 'undefined') {
    loadedExportFonts.add(f.family)
    new FontFace(f.family, `url(/caption-fonts/${f.file})`).load()
      .then(face => document.fonts.add(face))
      .catch(() => loadedExportFonts.delete(f.family))
  }
  return f
}

/** Words per caption line for a style (render.py _preset_events uses the same rule) */
export function captionWordsPerLine(style: Partial<CaptionStyle>) {
  if (style.animation === 'word') return 1
  if (style.words_per_line) return Math.max(1, Math.min(8, style.words_per_line))
  return style.animation === 'highlight' || style.animation === 'hormozi' ? 3 : CAPTION_MAX_WORDS
}

/** Black or white, whichever reads on a box of this colour (render.py _text_on) */
function textOn(hex: string) {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#FFFFFF'
}

function drawPresetCaptions(
  ctx: CanvasRenderingContext2D,
  chunk: FlatWord[],
  tMs: number,
  style: Partial<CaptionStyle>,
  band?: { y: number; h: number } | null,
) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const k = W / 1080                                   // export is laid out at 1080 wide
  const anim = style.animation!
  const color = style.color ?? '#FFFFFF'
  const hl = style.highlight_color ?? '#FFE700'
  const stroke = ((style.stroke_width ?? 4) + (anim === 'hormozi' ? HORMOZI_STROKE : 0)) * k * (anim === 'box' ? 0 : 1)
  const upper = style.uppercase || anim === 'hormozi'
  const emphasis = style.emphasis ?? {}
  const baseScale = anim === 'word' ? WORD_SCALE : 1
  // The Noto Indic fonts have no Latin letters: Roman-letter captions use Roboto (as render.py)
  const font = exportFont(style.language === 'roman' ? 'roboto' : style.font)
  const fontPx = (style.size ?? 52) * k * font.em
  const fontFamily = `"${font.family}", sans-serif`
  const lineStart = chunk[0].start_ms
  const lineEnd = chunk[chunk.length - 1].end_ms

  const posY = style.position_y ?? (anim === 'word' ? 0.5 : 0.84)
  let y = band ? (band.y + band.h / 2) * H : posY * H
  let alpha = 1
  if (anim === 'bounce') {
    const p = Math.min(1, Math.max(0, (tMs - lineStart) / BOUNCE_MS))
    y += (1 - p) * H * 0.02
    alpha = Math.min(1, Math.max(0, (tMs - lineStart) / 80))
  }

  // Per word: text, scale, colour, visibility, spoken
  const items = chunk.map((w, j) => {
    const text = upper ? w.word.toUpperCase() : w.word
    const on = w.start_ms, off = chunk[j + 1]?.start_ms ?? lineEnd
    const emph = !!emphasis[String(w.start_ms)]
    let scale = baseScale * (emph ? EMPHASIS_SCALE : 1)
    let visible = true
    if (anim === 'pop' || anim === 'word') {
      const dt = tMs - on
      if (dt < 0) { visible = false; scale *= 0.8 }
      else if (dt < POP_MS / 2) scale *= 0.8 + 0.3 * (dt / (POP_MS / 2))
      else if (dt < POP_MS) scale *= 1.1 - 0.1 * ((dt - POP_MS / 2) / (POP_MS / 2))
    }
    const spoken = tMs >= on && tMs < off
    if (anim === 'hormozi' && spoken) scale *= HORMOZI_SCALE
    const rest = emph ? hl : color
    const fill = anim === 'word' || anim === 'glow' ? rest : spoken ? (anim === 'highlight' ? textOn(hl) : hl) : rest
    return { text, scale, visible, spoken, fill }
  })

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const widthOf = (it: typeof items[number]) => {
    ctx.font = `700 ${fontPx * it.scale}px ${fontFamily}`
    return ctx.measureText(it.text).width
  }
  ctx.font = `700 ${fontPx}px ${fontFamily}`
  const space = ctx.measureText(' ').width
  const widths = items.map(widthOf)
  const total = widths.reduce((a, b) => a + b, 0) + space * (items.length - 1)
  let x = (W - total) / 2
  if (anim === 'box') {
    // One box round the whole line (libass BorderStyle 3: the text's full height plus the padding)
    const pad = BOX_PAD * k, hPx = fontPx / font.em
    ctx.fillStyle = LINE_BOX
    ctx.fillRect(x - pad, y - hPx / 2 - pad, total + pad * 2, hPx + pad * 2)
  }
  items.forEach((it, j) => {
    const w = widths[j]
    ctx.font = `700 ${fontPx * it.scale}px ${fontFamily}`
    if (it.visible && anim === 'glow') {
      // libass blurs the 3 px outline: a soft halo, not a solid ring
      const a = alpha * (it.spoken ? 1 : GLOW_DIM)
      ctx.globalAlpha = a * 0.45
      ctx.shadowColor = hl
      ctx.shadowBlur = GLOW_BLUR * 2 * k
      ctx.lineWidth = 3 * 2 * k
      ctx.strokeStyle = hl
      ctx.textAlign = 'left'
      ctx.strokeText(it.text, x, y)
      ctx.shadowBlur = 0
      ctx.shadowColor = 'transparent'
      ctx.globalAlpha = a
      ctx.fillStyle = it.fill
      ctx.fillText(it.text, x, y)
      ctx.globalAlpha = alpha
    } else if (it.visible) {
      if (anim === 'highlight' && it.spoken) {
        // libass boxes the font's full height (the caption size) plus the padding
        const pad = BOX_PAD * k, hPx = (fontPx / font.em) * it.scale
        ctx.fillStyle = hl
        ctx.fillRect(x - pad, y - hPx / 2 - pad, w + pad * 2, hPx + pad * 2)
      } else {
        ctx.shadowColor = 'rgba(0,0,0,0.5)'
        ctx.shadowOffsetX = ctx.shadowOffsetY = 2 * k
        ctx.lineWidth = stroke * 2
        ctx.strokeStyle = '#000000'
        if (stroke > 0) ctx.strokeText(it.text, x, y)
        ctx.shadowColor = 'transparent'
      }
      ctx.fillStyle = it.fill
      ctx.textAlign = 'left'
      ctx.fillText(it.text, x, y)
    }
    x += w + space
  })
  ctx.restore()
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
  if (isPreset(style.animation)) { drawPresetCaptions(ctx, chunk, tMs, style, band); return }

  const color     = style.color    ?? '#FFFFFF'
  const animation = style.animation ?? 'karaoke'

  // As the export draws these (render.py _write_ass, Default style): the bundled font (Roboto for
  // Roman letters or any other font), sized the way libass sizes it, regular weight, a 3 px black
  // outline and a 2 px half-black shadow (px at 1080 wide)
  const k          = W / 1080
  const font       = exportFont(style.language === 'roman' ? 'roboto' : style.font)
  const fontSize   = Math.round((style.size ?? 52) * k * font.em)
  const lineHeight = Math.round(fontSize * 1.4)
  const PAD_X      = Math.round(W * 0.05)
  const maxLineW   = W - PAD_X * 2
  const fontFamily = `"${font.family}", sans-serif`

  ctx.save()
  ctx.font         = `400 ${fontSize}px ${fontFamily}`
  ctx.textBaseline = 'middle'
  ctx.lineJoin     = 'round'
  ctx.lineWidth    = 2 * 3 * k
  ctx.strokeStyle  = '#000000'
  ctx.shadowColor  = 'rgba(0,0,0,0.5)'
  ctx.shadowOffsetX = ctx.shadowOffsetY = 2 * k

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
    // centred on position_y, as libass centres the line there (\pos with alignment 5)
    : (style.position_y ?? 0.84) * H - totalH / 2 + lineHeight / 2

  // Only do per-word karaoke when timestamps are real (not evenly distributed from a phrase split).
  // Estimated words (_est=true) have proportional-but-approximate timestamps that look wrong when highlighted.
  const hasEstimated = chunk.some(w => w._est)
  // A word stays lit until the next one starts (render.py _write_ass does the same)
  const activeWIdx = (animation === 'karaoke' && !hasEstimated)
    ? chunk.findIndex((w, j) => tMs >= w.start_ms && tMs < (chunk[j + 1]?.start_ms ?? w.end_ms + 1))
    : -1
  const live = karaokeLive(color, style.highlight_color ?? '#FFE700')

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
      ctx.strokeText(ln.join(' '), W / 2, y)
      ctx.fillText(ln.join(' '), W / 2, y)
    } else {
      const spW    = ctx.measureText(' ').width
      const widths = ln.map(w => ctx.measureText(w).width)
      const rowW   = widths.reduce((s, w) => s + w, 0) + spW * (ln.length - 1)
      let x        = (W - rowW) / 2
      ln.forEach((word, i) => {
        ctx.textAlign = 'left'
        ctx.fillStyle = lineStart + i === activeWIdx ? live : color
        ctx.strokeText(word, x, y)
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
    if (o.x == null) { drawCenteredText(ctx, o); continue }
    const x = (o.x ?? 0.1) * W
    const y = (o.y ?? 0.4) * H
    // Same size and shadow as the export's drawtext: px at 1080 wide, a 2 px black@0.7 shadow
    const fontSize = Math.max(8, Math.round(((o.size ?? 72) / 1080) * W))
    // A bundled font id (e.g. 'roboto') draws with the export's own file, as drawtext does
    const bundled = EXPORT_FONTS[o.font ?? ''] ? exportFont(o.font) : null
    const fontFamily = bundled ? `"${bundled.family}", sans-serif` : (o.font ?? 'sans-serif')
    ctx.save()
    ctx.font = `${bundled ? 400 : 700} ${fontSize}px ${fontFamily}`
    ctx.textBaseline = 'top'
    ctx.shadowColor = 'rgba(0,0,0,0.7)'
    ctx.shadowOffsetX = ctx.shadowOffsetY = 2 * W / 1080
    ctx.fillStyle = o.color ?? '#ffffff'
    ctx.fillText(o.text, x, y)
    ctx.restore()
  }
}

/**
 * A text overlay with no x (the AI hook): centred, in the export's font and size, shrunk to fit
 * 90% of the width — as render.py draws it (drawtext x=(w-text_w)/2, _fit_font_size).
 */
function drawCenteredText(ctx: CanvasRenderingContext2D, o: TextOverlayType) {
  const W = ctx.canvas.width, H = ctx.canvas.height
  const font = EXPORT_FONTS[o.font ?? ''] ? exportFont(o.font) : null
  const family = font ? `"${font.family}", sans-serif` : (o.font ?? 'sans-serif')
  const weight = font ? 400 : 700                      // drawtext uses the font file as it is
  let px = (o.size ?? 48) * W / 1080
  ctx.save()
  ctx.font = `${weight} ${px}px ${family}`
  const width = ctx.measureText(o.text).width
  if (width > W * 0.9) px = Math.max(28 * W / 1080, px * (W * 0.9) / width)
  ctx.font = `${weight} ${px}px ${family}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.shadowColor = 'rgba(0,0,0,0.7)'
  ctx.shadowOffsetX = ctx.shadowOffsetY = 2 * W / 1080
  // Black outline, as drawtext borderw=4 (px at 1080 wide)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2 * Math.max(2, 4 * W / 1080)
  ctx.strokeStyle = '#000000'
  ctx.strokeText(o.text, W / 2, (o.y ?? 0.15) * H)
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = o.color ?? '#ffffff'
  ctx.fillText(o.text, W / 2, (o.y ?? 0.15) * H)
  ctx.restore()
}

// ── 9:16 output canvas ────────────────────────────────────────────────────────

interface OutputCanvasProps {
  videoRef: RefObject<HTMLVideoElement | null>
  /** The format at a clip time, read on every frame (instead of activeSegment, which follows React renders) */
  segmentAt?: (clipMs: number) => SegmentLocal | null
  /** Cut straight to the next format, as the export does (no crossfade) */
  hardCuts?: boolean
  /** The video a format shows, when it isn't the main one (B-roll) */
  sourceFor?: (seg: SegmentLocal | null) => HTMLVideoElement | null
  /** Split/trio slots that show their own picture (borrowed reactions): see useBorrowedSlots */
  slotSourceFor?: (seg: SegmentLocal | null, box: SegmentLocal['crop_boxes'][number]) => HTMLVideoElement | null | false
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
  /** A frame text dragged or resized in the preview */
  onFrameItemChange?: (id: string, patch: Partial<Pick<FrameItem, 'x' | 'y' | 'size'>>) => void
}

export function OutputCanvas({
  videoRef, currentTimeMs, clipStartMs = 0, activeSegment, getPositionAt, segmentAt, hardCuts = false, sourceFor, slotSourceFor,
  overlays = [], activeOverlayId, onOverlayChange, onSelectOverlay, onDeleteOverlay,
  className, style, skipTransitionRef,
  words, captionStyle, captionTextCase = 'title', showCaptions = false,
  textOverlays = [], activeTextOverlayId, onTextOverlayChange, onSelectTextOverlay, onDeleteTextOverlay,
  onCaptionPositionChange, frameMedia, onFrameLaneClick, onFrameItemClick, activeFrameItemId, onFrameItemChange,
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
  const segmentAtRef = useRef(segmentAt)
  segmentAtRef.current = segmentAt
  const sourceForRef = useRef(sourceFor)
  sourceForRef.current = sourceFor
  const slotSourceForRef = useRef(slotSourceFor)
  slotSourceForRef.current = slotSourceFor
  const hardCutsRef = useRef(hardCuts)
  hardCutsRef.current = hardCuts
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
  // Presets change how many words a line holds
  const wordsPerLine = captionWordsPerLine(captionStyle ?? {})
  const prevPerLineRef    = useRef(wordsPerLine)
  if (words !== prevWordsRef.current || wordsPerLine !== prevPerLineRef.current) {
    prevWordsRef.current   = words
    prevPerLineRef.current = wordsPerLine
    captionChunksRef.current = buildCaptionChunks(words ?? [], wordsPerLine)
  }

  useEffect(() => {
    let rafId: number

    const loop = () => {
      const canvas = canvasRef.current
      const video  = videoRef.current

      if (canvas && video && video.readyState >= 2) {
        const ctx    = canvas.getContext('2d')
        const seg    = segmentAtRef.current
          ? segmentAtRef.current(Math.max(0, video.currentTime * 1000 - clipStartMsRef.current))
          : activeSegmentRef.current
        const newId  = seg?.id ?? null

        if (ctx) {
          // Detect segment boundary — snapshot MUST be captured before paintSegment
          // overwrites the canvas with new-segment content.
          if (newId !== prevSegIdRef.current && prevSegIdRef.current !== null) {
            const skip = hardCutsRef.current || (skipTransitionRef?.current ?? false)
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
          // A B-roll shot whose video is still seeking keeps the last frame (never flashes the main video)
          const other = sourceForRef.current?.(seg)
          if (seg?.hidden) {
            // The main video hidden here (shownSegment): black, as in the export; captions and text still go on top
            ctx.fillStyle = '#000'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
          } else if (!other || other.readyState >= 2) {
            paintSegment(ctx, other ?? video, seg, clipRelativeMs, getPositionAtRef.current, frameMediaRef.current,
              slotSourceForRef.current ? (sg, box) => slotSourceForRef.current!(sg, box) : null)
          }

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
            style={{ top: `${r.y * 100}%`, height: `${r.h * 100}%`, boxShadow: on && r.item.kind !== 'text' ? 'inset 0 0 0 2px #c8ff00' : undefined }} />
        )
      })}
      {itemRows.filter(r => r.item.kind === 'text' && !r.item.captions && onFrameItemChange).map(r => (
        <FrameTextBox key={`box-${r.item.id}`} row={r} item={r.item} selected={r.item.id === activeFrameItemId}
          onSelect={() => onFrameItemClick?.(r.item.id)}
          onChange={patch => onFrameItemChange?.(r.item.id, patch)} />
      ))}
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
            {r.lane === 'band' ? 'Add text' : 'Add'}
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
    // A centred overlay (no x) starts its drag from where it is drawn
    const centredX = () => {
      const el = ref.current, parent = el?.parentElement
      return el && parent ? el.getBoundingClientRect().left / 1 - parent.getBoundingClientRect().left : 0
    }
    const ox = overlay.x ?? (centredX() / cRect().w), oy = overlay.y ?? 0.4
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

  const centred = overlay.x == null
  const x = overlay.x ?? 0.5
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
        transform: centred ? 'translateX(-50%)' : undefined,
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
      <span style={{ color: 'transparent', fontSize: `${(overlay.size ?? 72) / 10.8}cqw`, fontWeight: 700, fontFamily: 'sans-serif', whiteSpace: 'nowrap', display: 'block', pointerEvents: 'none', lineHeight: 1, userSelect: 'none', margin: 0, padding: 0 }}>
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
