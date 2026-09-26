'use client'

import { useEffect, useRef } from 'react'
import type { FrameLane } from '@chai-cut/shared'
import { FRAME_ITEM_COLORS } from './SegmentTimeline'

export type AddChoice = 'main' | 'video' | 'photo' | 'bandtext'

interface Props {
  lane: FrameLane
  laneLabel: string
  anchor: DOMRect
  /** What the template puts in this slot: a video slot offers videos, a photo slot photos */
  slotKind: 'video' | 'photo'
  /** The slot doesn't show the main video yet ("Same video") */
  canAddMain: boolean
  /** The frame has a text band: offer text for it (the band appears with its first text) */
  bandText: boolean
  onChoose: (choice: AddChoice) => void
  onClose: () => void
}

const W = 220

const ICONS: Record<AddChoice, React.ReactNode> = {
  main: <><rect x="6" y="2" width="12" height="20" rx="2" /><path d="M10 9l5 3-5 3V9z" /></>,
  video: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" /></>,
  photo: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></>,
  bandtext: <path d="M4 7V4h16v3M9 20h6M12 4v16" />,
}

/** What "+" on a frame slot offers: the same (main) video or an uploaded video — or a photo in a photo slot — plus text for the band */
export function FrameAddMenu({ laneLabel, anchor, slotKind, canAddMain, bandText, onChoose, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  const choices: { id: AddChoice; label: string; color: string }[] = [
    ...(slotKind === 'video'
      ? [
          ...(canAddMain ? [{ id: 'main' as const, label: 'Same video', color: FRAME_ITEM_COLORS.main }] : []),
          { id: 'video' as const, label: 'Upload video', color: FRAME_ITEM_COLORS.video },
        ]
      : [{ id: 'photo' as const, label: 'Upload photo', color: FRAME_ITEM_COLORS.photo }]),
    ...(bandText ? [{ id: 'bandtext' as const, label: 'Text', color: FRAME_ITEM_COLORS.text }] : []),
  ]

  // Opens above the "+" (the timeline sits at the bottom of the screen), kept on screen
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1280
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800
  const left = Math.max(8, Math.min(vw - W - 8, anchor.left + anchor.width / 2 - W / 2))
  const bottom = Math.max(8, vh - anchor.top + 8)

  return (
    <div ref={ref} role="menu" aria-label={`Add to the ${laneLabel.toLowerCase()} slot`}
      className="fixed flex flex-col gap-1 p-1.5 rounded-xl"
      style={{ left, bottom, width: W, zIndex: 80, background: 'var(--ed-panel)', border: '1px solid rgb(var(--ed-fg) / 0.1)', boxShadow: '0 12px 32px rgba(0,0,0,0.55)' }}>
      <p className="px-2 pt-1 pb-0.5 text-[11px] font-semibold" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>{laneLabel} slot</p>
      {choices.map(c => (
        <button key={c.id} role="menuitem" onClick={() => onChoose(c.id)}
          className="flex items-center gap-2.5 h-9 px-2.5 rounded-lg text-xs font-medium text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.08)] focus-visible:bg-[rgb(var(--ed-fg)/0.08)] focus-visible:outline-none"
          style={{ color: 'var(--ed-text)' }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={c.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICONS[c.id]}</svg>
          {c.label}
        </button>
      ))}
    </div>
  )
}
