'use client'

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A small ⓘ that shows a description card on hover (and on keyboard focus or a tap, for touch and
 * keyboard users) instead of a paragraph of text on the page. The card is drawn in a portal so a
 * scrolling panel or a rounded card never clips it, and it flips below / shifts sideways to stay
 * on screen.
 */
export function InfoTip({ children, label = 'More info', size = 14, className = '' }: {
  /** What the card says */
  children: React.ReactNode
  /** Screen-reader name of the icon */
  label?: string
  size?: number
  className?: string
}) {
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)   // opened by a tap / click: stays until tapped away
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => { if (hideTimer.current) clearTimeout(hideTimer.current); setOpen(true) }
  const hide = () => { if (pinned) return; hideTimer.current = setTimeout(() => setOpen(false), 80) }

  // Place the card above the icon (below when there's no room), kept inside the window
  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const place = () => {
      const r = btn.current!.getBoundingClientRect()
      const w = card.current?.offsetWidth ?? 260, h = card.current?.offsetHeight ?? 80
      const below = r.top - h - 10 < 8
      const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))
      setPos({ left, top: below ? r.bottom + 8 : r.top - h - 8, below })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  // A pinned card closes on a click elsewhere or Escape
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => {
      if (btn.current?.contains(e.target as Node) || card.current?.contains(e.target as Node)) return
      setPinned(false); setOpen(false)
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPinned(false); setOpen(false) } }
    window.addEventListener('pointerdown', away, true)
    window.addEventListener('keydown', esc)
    return () => { window.removeEventListener('pointerdown', away, true); window.removeEventListener('keydown', esc) }
  }, [open])

  return (
    <>
      <button ref={btn} type="button" aria-label={label} aria-describedby={open ? id : undefined}
        onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={() => { if (!pinned) setOpen(false) }}
        onClick={e => { e.preventDefault(); e.stopPropagation(); setPinned(p => !p); setOpen(o => !(o && pinned)) }}
        className={`info-tip-btn inline-flex shrink-0 items-center justify-center rounded-full align-middle ${className}`}
        style={{ width: size + 4, height: size + 4 }}
        data-open={open || undefined}>
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9.5" /><path d="M12 11v5.5" /><circle cx="12" cy="7.6" r="0.4" fill="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={card} id={id} role="tooltip" className="info-tip-card" data-below={pos?.below || undefined}
          onMouseEnter={show} onMouseLeave={hide}
          style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, visibility: pos ? 'visible' : 'hidden' }}>
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}
