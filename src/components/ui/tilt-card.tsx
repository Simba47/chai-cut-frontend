'use client'

import React from 'react'
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { cn } from '@/lib/utils'

type Props = {
  children: React.ReactNode
  className?: string
  /** Position in a row, used to stagger the entrance */
  index?: number
  /** Max tilt in degrees */
  tilt?: number
}

/**
 * Card that tilts in 3D toward the cursor and fades up when scrolled into view.
 * Put it inside a parent with `perspective`; wrap floating content in
 * `.tilt-card-inner` to lift it off the card surface.
 */
export function TiltCard({ children, className, index = 0, tilt = 10 }: Props) {
  const reduceMotion = useReducedMotion()
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const springX = useSpring(x, { stiffness: 150, damping: 18 })
  const springY = useSpring(y, { stiffness: 150, damping: 18 })
  const rotateX = useTransform(springY, [-0.5, 0.5], [`${tilt}deg`, `-${tilt}deg`])
  const rotateY = useTransform(springX, [-0.5, 0.5], [`-${tilt}deg`, `${tilt}deg`])

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    x.set((e.clientX - r.left) / r.width - 0.5)
    y.set((e.clientY - r.top) / r.height - 0.5)
  }
  const onMouseLeave = () => {
    x.set(0)
    y.set(0)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.3 }}
      transition={{ duration: 0.7, delay: index * 0.15, ease: [0.23, 1, 0.32, 1] }}
      onMouseMove={reduceMotion ? undefined : onMouseMove}
      onMouseLeave={reduceMotion ? undefined : onMouseLeave}
      style={reduceMotion ? undefined : { rotateX, rotateY, transformStyle: 'preserve-3d' }}
      className={cn('tilt-card group', className)}
    >
      {children}
    </motion.div>
  )
}
