'use client'

import { useEffect, useRef } from 'react'
import type { SegmentLocal } from '@chai-cut/shared'
import type { BoxPosition } from '@/lib/interpolation'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
  segment: SegmentLocal | null
  currentTimeMs: number
  getPositionAt: (boxId: string, t_ms: number) => BoxPosition
  activeBoxId: string | null
  onSelectBox: (boxId: string) => void
  onBoxChange: (boxId: string, pos: BoxPosition) => void
}

export function CropBoxOverlay({
  videoRef,
  segment,
  currentTimeMs,
  getPositionAt,
  activeBoxId,
  onSelectBox,
  onBoxChange,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  if (!segment) return null

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 10 }}
    >
      {segment.crop_boxes.map(box => {
        const pos = getPositionAt(box.id, currentTimeMs)
        const isActive = box.id === activeBoxId

        // Convert normalized coords (0-1 over source video) to percent on the overlay container.
        // The overlay sits on top of the original video element so we map directly.
        return (
          <CropBox
            key={box.id}
            boxId={box.id}
            pos={pos}
            isActive={isActive}
            onSelect={() => onSelectBox(box.id)}
            onMove={(dx, dy, containerW, containerH) => {
              onBoxChange(box.id, {
                ...pos,
                x: Math.max(0, Math.min(1 - pos.w, pos.x + dx / containerW)),
                y: Math.max(0, Math.min(1 - pos.h, pos.y + dy / containerH)),
              })
            }}
            onResize={(dw, dh, containerW, containerH) => {
              onBoxChange(box.id, {
                ...pos,
                w: Math.max(0.05, Math.min(1 - pos.x, pos.w + dw / containerW)),
                h: Math.max(0.05, Math.min(1 - pos.y, pos.h + dh / containerH)),
              })
            }}
          />
        )
      })}
    </div>
  )
}

interface CropBoxProps {
  boxId: string
  pos: BoxPosition
  isActive: boolean
  onSelect: () => void
  onMove: (dx: number, dy: number, cW: number, cH: number) => void
  onResize: (dw: number, dh: number, cW: number, cH: number) => void
}

function CropBox({ boxId, pos, isActive, onSelect, onMove, onResize }: CropBoxProps) {
  const ref = useRef<HTMLDivElement>(null)

  function getContainer() {
    return ref.current?.parentElement as HTMLDivElement | null
  }

  function handleDragStart(e: React.MouseEvent) {
    e.stopPropagation()
    onSelect()
    const startX = e.clientX
    const startY = e.clientY

    function onMouseMove(ev: MouseEvent) {
      const container = getContainer()
      if (!container) return
      const { width, height } = container.getBoundingClientRect()
      onMove(ev.clientX - startX, ev.clientY - startY, width, height)
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  function handleResizeStart(e: React.MouseEvent) {
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY

    function onMouseMove(ev: MouseEvent) {
      const container = getContainer()
      if (!container) return
      const { width, height } = container.getBoundingClientRect()
      onResize(ev.clientX - startX, ev.clientY - startY, width, height)
    }
    function onMouseUp() {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }

  const COLORS = ['#7c3aed', '#0ea5e9', '#f59e0b', '#22c55e']
  const color = COLORS[parseInt(boxId.slice(-1), 16) % COLORS.length]

  return (
    <div
      ref={ref}
      className="absolute pointer-events-auto cursor-move select-none"
      style={{
        left: `${pos.x * 100}%`,
        top: `${pos.y * 100}%`,
        width: `${pos.w * 100}%`,
        height: `${pos.h * 100}%`,
        border: `2px solid ${isActive ? color : color + '88'}`,
        background: isActive ? `${color}18` : 'transparent',
      }}
      onMouseDown={handleDragStart}
      onClick={e => { e.stopPropagation(); onSelect() }}
    >
      {/* Resize handle */}
      <div
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{ background: color }}
        onMouseDown={e => { e.stopPropagation(); handleResizeStart(e) }}
      />
    </div>
  )
}
