'use client'

import { useRef, useEffect, useCallback, useState, useMemo } from 'react'
import type { RefObject } from 'react'
import type { SegmentLocal, Overlay, TextOverlay as TextOverlayType, CaptionStyle, TranscriptWord } from '@chai-cut/shared'
import type { BoxPosition } from '@/lib/interpolation'
import type { TextCase } from './CaptionStyler'
import { applyCase } from './CaptionStyler'

const BOX_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7']

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

  return (
    <div
      className="flex-1 flex items-center justify-center overflow-hidden"
      style={{ background: '#0a0a0a' }}
    >
      {/* AR-matched wrapper — 0–1 crop coords map directly to CSS % */}
      <div
        className="relative overflow-hidden"
        style={{
          ...(videoAR ? { aspectRatio: String(videoAR) } : { width: '100%', height: '100%' }),
          maxWidth: '100%',
          maxHeight: '100%',
          background: '#000',
          flexShrink: 0,
        }}
      >
        <video
          ref={videoRef}
          src={videoUrl || undefined}
          preload="auto"
          style={{ width: '100%', height: '100%', display: 'block' }}
          onLoadedMetadata={e => {
            const v = e.currentTarget
            if (v.videoWidth && v.videoHeight) setVideoAR(v.videoWidth / v.videoHeight)
          }}
        />

        {/* Crop box overlay */}
        {activeSegment && (
          <div className="absolute inset-0" style={{ pointerEvents: 'none', zIndex: 10 }}>
            {activeSegment.crop_boxes.map((box, slotIdx) => {
              const pos = getPositionAt(box.id, currentTimeMs)
              return (
                <DraggableBox
                  key={box.id}
                  pos={pos}
                  color={BOX_COLORS[slotIdx % BOX_COLORS.length]}
                  isActive={box.id === activeBoxId}
                  layout={activeSegment.layout}
                  label={activeSegment.crop_boxes.length > 1 ? String(slotIdx + 1) : undefined}
                  onSelect={() => onSelectBox(activeSegment.id, box.id)}
                  onChange={newPos => onBoxChange(box.id, newPos)}
                />
              )
            })}
          </div>
        )}
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

function paintSegment(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  seg: SegmentLocal | null,
  tMs: number,
  getPositionAt: (id: string, t: number) => BoxPosition,
) {
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
    const topH = H * 0.55
    crop_boxes.slice(0, 3).forEach((box, i) => {
      const p = getPositionAt(box.id, tMs)
      if (i === 0) coverCrop(ctx, video, p.x * vW, p.y * vH, p.w * vW, p.h * vH, 0, 0, W, topH)
      else coverCrop(ctx, video, p.x * vW, p.y * vH, p.w * vW, p.h * vH, (i - 1) * (W / 2), topH, W / 2, H - topH)
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

    if (parts.length <= 1) {
      // Real word-level token — group up to CAPTION_MAX_WORDS together.
      const gap = wordChunk.length > 0
        ? w.start_ms - wordChunk[wordChunk.length - 1].end_ms
        : 0
      if (wordChunk.length >= CAPTION_MAX_WORDS || (wordChunk.length > 0 && gap > CAPTION_GAP_MS)) {
        flushWordChunk()
      }
      wordChunk.push(w)
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

  // Fill only tiny sub-500ms gaps (rounding artefacts). Larger gaps are intentional
  // music/silence pauses — the backend caps word hold at 4s, so the remaining gap
  // should stay empty rather than holding the previous caption stale.
  for (let i = 0; i < chunks.length - 1; i++) {
    const nextStart = chunks[i + 1][0].start_ms
    const last = chunks[i][chunks[i].length - 1]
    if (last.end_ms < nextStart && nextStart - last.end_ms < 500) {
      last.end_ms = nextStart
    }
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
  const yBase  = (style.position_y ?? 0.84) * H - totalH + lineHeight / 2

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
}

export function OutputCanvas({
  videoRef, currentTimeMs, clipStartMs = 0, activeSegment, getPositionAt,
  overlays = [], activeOverlayId, onOverlayChange, onSelectOverlay, onDeleteOverlay,
  className, style, skipTransitionRef,
  words, captionStyle, captionTextCase = 'title', showCaptions = false,
  textOverlays = [], activeTextOverlayId, onTextOverlayChange, onSelectTextOverlay, onDeleteTextOverlay,
  onCaptionPositionChange,
}: OutputCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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

          // Draw the incoming segment's live frame
          paintSegment(ctx, video, seg, clipRelativeMs, getPositionAtRef.current)

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
            drawCaptions(ctx, captionChunksRef.current, liveMs, captionStyleRef.current ?? {}, captionCaseRef.current)
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

  return (
    <div className={className} style={{ ...style, position: 'relative', containerType: 'inline-size' }} onClick={() => onSelectTextOverlay?.(null)}>
      <canvas
        ref={canvasRef}
        width={540}
        height={960}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      />
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
  const accent = '#8b5cf6'

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
        background: isActive ? 'rgba(139,92,246,0.15)' : 'transparent',
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
            <path d="M1 4h6M5 2l2 2-2 2" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      )}
    </div>
  )
}

// ── DraggableBox ─────────────────────────────────────────────────────────────

interface DraggableBoxProps {
  pos: BoxPosition
  color: string
  isActive: boolean
  layout?: string
  label?: string
  onSelect: () => void
  onChange: (newPos: BoxPosition) => void
}

function DraggableBox({ pos, color, isActive, layout, label, onSelect, onChange }: DraggableBoxProps) {
  const ref = useRef<HTMLDivElement>(null)

  function cRect() {
    const r = ref.current?.parentElement?.getBoundingClientRect()
    return r ? { w: r.width, h: r.height } : { w: 1, h: 1 }
  }

  function startDrag(e: React.MouseEvent) {
    if ((e.target as HTMLElement).dataset.handle) return
    e.stopPropagation()
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
    const sx = e.clientX, sy = e.clientY, start = { ...pos }
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
        // Dark shadow fills everything OUTSIDE the crop box — shows user exactly what will be in the 9:16 output
        boxShadow: `0 0 0 9999px rgba(0,0,0,0.52), 0 0 0 1px ${color}88`,
      }}
      onMouseDown={startDrag}
      onClick={e => { e.stopPropagation(); onSelect() }}
    >
      {/* Corner accent lines (Clipzi-style) */}
      {['tl', 'tr', 'bl', 'br'].map(c => (
        <div
          key={c}
          style={{
            position: 'absolute',
            width: 14, height: 14,
            top: c.startsWith('t') ? -1 : undefined,
            bottom: c.startsWith('b') ? -1 : undefined,
            left: c.endsWith('l') ? -1 : undefined,
            right: c.endsWith('r') ? -1 : undefined,
            borderTop: c.startsWith('t') ? `3px solid ${color}` : undefined,
            borderBottom: c.startsWith('b') ? `3px solid ${color}` : undefined,
            borderLeft: c.endsWith('l') ? `3px solid ${color}` : undefined,
            borderRight: c.endsWith('r') ? `3px solid ${color}` : undefined,
            pointerEvents: 'none',
          }}
        />
      ))}

      {/* Ratio badge — top-left */}
      <div style={{
        position: 'absolute', top: 6, left: 6,
        fontSize: 10, fontWeight: 700, color: '#fff', lineHeight: 1.4,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        padding: '2px 7px', borderRadius: 4, pointerEvents: 'none',
      }}>{layout === 'horizontal' ? '16:9' : '9:16'}</div>

      {/* Zoom badge — top-right */}
      <div style={{
        position: 'absolute', top: 6, right: 6,
        fontSize: 10, fontWeight: 700, color: '#fff', lineHeight: 1.4,
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        padding: '2px 7px', borderRadius: 4, pointerEvents: 'none',
      }}>
        {(Math.round(10 / Math.max(0.1, pos.w)) / 10).toFixed(1)}x
      </div>

      {/* Slot label (for multi-slot layouts like split/trio) */}
      {label && (
        <div style={{
          position: 'absolute', top: 6, left: '50%', transform: 'translateX(-50%)',
          fontSize: 11, fontWeight: 700,
          color: '#fff', textShadow: `0 0 8px ${color}, 0 1px 3px rgba(0,0,0,0.9)`,
          pointerEvents: 'none',
        }}>
          {label}
        </div>
      )}

      {/* ⟺ Adjust button — bottom center */}
      <div style={{
        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
        fontSize: 10, fontWeight: 600, color: '#fff',
        background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
        padding: '4px 12px', borderRadius: 6, pointerEvents: 'none', whiteSpace: 'nowrap',
      }}>⟺ Adjust</div>

      {/* Resize handles */}
      {(isActive ? HANDLES : HANDLES.filter(h => h.dir === 'se')).map(({ cursor, pos: hPos, dir }) => (
        <div
          key={dir}
          data-handle="1"
          style={{
            position: 'absolute', width: 9, height: 9,
            background: '#fff', border: `2px solid ${color}`,
            borderRadius: 2, cursor, pointerEvents: 'auto', boxSizing: 'border-box',
            ...hPos,
          }}
          onMouseDown={e => startResize(e, dir)}
        />
      ))}
    </div>
  )
}
