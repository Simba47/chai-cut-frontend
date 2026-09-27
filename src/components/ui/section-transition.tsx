'use client'

import React, { useRef } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionStyle } from 'framer-motion'
import { cn } from '@/lib/utils'
import { neutralStyle, useLiteMotion } from './use-lite-motion'

export type SectionTransitionVariant = 'tilt' | 'iris' | 'zoom'

type Props = {
  id?: string
  className?: string
  /** tilt: content swings up from a 3D tilt · iris: circular reveal from the top · zoom: grows from smaller and rises into place */
  variant: SectionTransitionVariant
  children: React.ReactNode
}

/**
 * Scroll-driven section entrances. Progress runs from "section top enters the
 * bottom of the screen" to "section top reaches 25% from the top", so jumping
 * to a section via a nav link always lands on the fully-revealed state.
 */
export function SectionTransition({ id, className, variant, children }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const lite = useLiteMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'start 0.25'] })
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 26, mass: 0.35 })

  // tilt
  const tiltRotate = useTransform(p, [0, 1], [32, 0])
  const tiltY = useTransform(p, [0, 1], [160, 0])
  const tiltScale = useTransform(p, [0, 1], [0.9, 1])
  // iris
  // grows slowly while only the top of the section is on screen, then finishes wide open
  const irisClip = useTransform(p, [0, 0.85, 1], ['circle(4% at 50% 0%)', 'circle(58% at 50% 0%)', 'circle(150% at 50% 0%)'])
  const irisScale = useTransform(p, [0, 1], [1.12, 1])
  // zoom
  const zoomScale = useTransform(p, [0, 1], [0.86, 1])
  const zoomY = useTransform(p, [0, 1], [90, 0])
  // shared
  const fade = useTransform(p, [0, 0.6], [0.2, 1])

  if (reduceMotion) {
    return <div ref={ref} id={id} className={className}>{children}</div>
  }

  let outer: MotionStyle = {}
  let inner: MotionStyle = {}
  if (variant === 'tilt') {
    inner = { rotateX: tiltRotate, y: tiltY, scale: tiltScale, opacity: fade, transformOrigin: '50% 0%' }
  } else if (variant === 'iris') {
    outer = { clipPath: irisClip }
    inner = { scale: irisScale, opacity: fade }
  } else {
    inner = { scale: zoomScale, y: zoomY, opacity: fade, transformOrigin: '50% 0%' }
  }

  // Phones: no scroll-driven transforms, just the resting state (same element tree,
  // so nothing remounts when the media query flips after hydration)
  if (lite) {
    outer = neutralStyle(outer)
    inner = neutralStyle(inner)
  }

  return (
    <motion.div ref={ref} id={id} className={cn('section-transition', `st-${variant}`, className)} style={outer}>
      <motion.div style={inner}>{children}</motion.div>
    </motion.div>
  )
}
