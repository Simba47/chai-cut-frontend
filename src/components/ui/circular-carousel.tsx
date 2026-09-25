'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Styled with the landing page tokens (--card, --text, --muted, --accent, ...)
// so it follows the page theme.

export interface CarouselItem {
  id: string
  title: string
  description: string
  tag?: string
  icon?: React.ReactNode
}

export interface CircularCarouselProps {
  items: CarouselItem[]
  activeIndex?: number
  onActiveChange?: (index: number) => void
  autoPlay?: boolean
  autoPlayInterval?: number
  className?: string
}

const VISIBLE_COUNT = 5
const MAX_RADIUS_X = 300
const RADIUS_Y = 110

function getItemPosition(index: number, activeIndex: number, total: number, radiusX: number) {
  const offset = index - activeIndex
  const half = Math.floor(VISIBLE_COUNT / 2)
  let adjustedOffset = offset

  if (offset > half) adjustedOffset = offset - total
  if (offset < -half) adjustedOffset = offset + total

  if (Math.abs(adjustedOffset) > half * 2) return null

  const angle = (adjustedOffset / VISIBLE_COUNT) * Math.PI
  const x = Math.sin(angle) * radiusX
  const y = -Math.cos(angle) * RADIUS_Y

  const distance = Math.abs(adjustedOffset)
  const maxDistance = half + 1
  const scale = Math.max(0, 1 - (distance / maxDistance) * 0.3)
  const opacity = Math.max(0.25, 1 - (distance / maxDistance) * 0.75)
  const zIndex = VISIBLE_COUNT - distance

  return { x, y, scale, opacity, zIndex }
}

export function CircularCarousel({
  items,
  activeIndex: controlledIndex,
  onActiveChange,
  autoPlay = true,
  autoPlayInterval = 4000,
  className,
}: CircularCarouselProps) {
  const reduceMotion = useReducedMotion()
  const [internalIndex, setInternalIndex] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const [isFocused, setIsFocused] = useState(false)
  const [radiusX, setRadiusX] = useState(MAX_RADIUS_X)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const trackRef = useRef<HTMLDivElement | null>(null)

  const activeIndex = controlledIndex ?? internalIndex
  const total = items.length

  const goTo = useCallback(
    (index: number) => {
      const newIndex = ((index % total) + total) % total
      if (controlledIndex === undefined) setInternalIndex(newIndex)
      onActiveChange?.(newIndex)
    },
    [total, controlledIndex, onActiveChange],
  )

  const next = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo])
  const prev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo])

  // Shrink the arc on narrow screens so the side cards stay on-screen
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setRadiusX(Math.min(MAX_RADIUS_X, entry.contentRect.width * 0.34))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!autoPlay || reduceMotion || isHovered || isFocused) return
    const id = setInterval(next, autoPlayInterval)
    return () => clearInterval(id)
  }, [autoPlay, autoPlayInterval, reduceMotion, isHovered, isFocused, next])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'ArrowRight') next()
    }
    const el = containerRef.current
    el?.addEventListener('keydown', handler)
    return () => el?.removeEventListener('keydown', handler)
  }, [next, prev])

  const activeItem = items[activeIndex]
  const navBtn =
    'flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--hover)] text-[var(--muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]'

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      role="region"
      aria-label="Features"
      aria-roledescription="carousel"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      className={cn('relative flex flex-col items-center justify-center gap-6 outline-none', className)}
    >
      {/* Circular track */}
      <div ref={trackRef} className="relative h-[360px] w-full max-w-4xl">
        <AnimatePresence mode="popLayout">
          {items.map((item, i) => {
            const pos = getItemPosition(i, activeIndex, total, radiusX)
            if (!pos) return null
            const isActive = i === activeIndex

            return (
              <motion.button
                key={item.id}
                type="button"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ x: pos.x, y: pos.y, scale: pos.scale, opacity: pos.opacity, zIndex: pos.zIndex }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: reduceMotion ? 0 : 0.65, ease: [0.22, 1, 0.36, 1] }}
                onClick={() => goTo(i)}
                aria-label={item.title}
                aria-current={isActive}
                className={cn(
                  'absolute left-1/2 top-1/2 -ml-[132px] -mt-[88px] flex h-[176px] w-[264px] cursor-pointer flex-col items-start gap-3 rounded-2xl border p-5 text-left backdrop-blur-sm transition-[box-shadow,border-color] duration-300',
                  'bg-[linear-gradient(180deg,var(--card-hover),var(--card))]',
                  isActive
                    ? 'border-[var(--border-strong)] shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)]'
                    : 'border-[var(--border)] shadow-[0_8px_24px_-4px_rgba(0,0,0,0.35)]',
                )}
              >
                <div className="flex w-full items-center justify-between">
                  {item.tag && (
                    <span className="rounded-full bg-[var(--hover)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                      {item.tag}
                    </span>
                  )}
                  {item.icon}
                </div>
                <div className="w-full">
                  <h3
                    className={cn(
                      'font-bold leading-tight tracking-[-0.02em] transition-colors duration-300',
                      isActive ? 'text-[17px] text-[var(--text)]' : 'text-[15px] text-[var(--muted)]',
                    )}
                  >
                    {item.title}
                  </h3>
                  <p
                    className={cn(
                      'mt-1.5 line-clamp-3 text-[13px] leading-relaxed transition-colors duration-300',
                      isActive ? 'text-[var(--muted)]' : 'text-[var(--dim)]',
                    )}
                  >
                    {item.description}
                  </p>
                </div>
              </motion.button>
            )
          })}
        </AnimatePresence>

        {/* Center counter */}
        <motion.div
          key={activeItem.id}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-x-0 bottom-2 flex flex-col items-center"
          aria-live="polite"
        >
          <span className="text-5xl font-black tracking-tight text-[var(--text)] opacity-90">
            {String(activeIndex + 1).padStart(2, '0')}
          </span>
          <span className="mt-1 text-xs text-[var(--dim)]">of {String(total).padStart(2, '0')}</span>
        </motion.div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-4">
        <motion.button type="button" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }} onClick={prev} aria-label="Previous feature" className={navBtn}>
          <ChevronLeft className="size-5" />
        </motion.button>

        <div className="flex items-center gap-1.5">
          {items.map((item, i) => (
            <button
              key={item.id}
              type="button"
              aria-current={i === activeIndex}
              onClick={() => goTo(i)}
              aria-label={`Go to ${item.title}`}
              className={cn(
                'h-1.5 rounded-full transition-all duration-300',
                i === activeIndex ? 'w-6 bg-[var(--accent)]' : 'w-1.5 bg-[var(--border-strong)] hover:bg-[var(--muted)]',
              )}
            />
          ))}
        </div>

        <motion.button type="button" whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.95 }} onClick={next} aria-label="Next feature" className={navBtn}>
          <ChevronRight className="size-5" />
        </motion.button>
      </div>
    </div>
  )
}

export default CircularCarousel
