'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  AudioLines, Captions, Clapperboard, Crop, Film, Languages, Music, Scissors, Sparkles, Type, Video, WandSparkles,
  type LucideIcon,
} from 'lucide-react'

/**
 * Animated "circuit" background for the auth card (styles: .auth-bg* in app/auth.css).
 * The card is the hub: each line leaves one of its edges, bends once or twice and
 * ends at a small tool tile. A lime pulse runs along it (randomly inward or outward)
 * a few times, then the line fades out and a new one appears somewhere else.
 */

const ICONS: LucideIcon[] = [Scissors, Captions, Clapperboard, Crop, Languages, Sparkles, Film, Type, Music, Video, WandSparkles, AudioLines]
const TILE = 44          // tile size, px
const RADIUS = 14        // corner radius where a line turns
const EDGE = 36          // keep tiles this far from the screen edge
const PASSES = 3         // pulses per line before it's replaced

type Rect = { left: number; top: number; right: number; bottom: number }
type Line = { id: number; d: string; tile: { x: number; y: number }; Icon: LucideIcon; reverse: boolean; duration: number; delay: number }

const rand = (min: number, max: number) => min + Math.random() * (max - min)
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]

// Orthogonal polyline → SVG path with rounded corners
function roundedPath(points: [number, number][]) {
  let d = `M ${points[0][0]} ${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i - 1], [x, y] = points[i], [nx, ny] = points[i + 1]
    const inLen = Math.hypot(x - px, y - py), outLen = Math.hypot(nx - x, ny - y)
    const r = Math.min(RADIUS, inLen / 2, outLen / 2)
    const ax = x - ((x - px) / inLen) * r, ay = y - ((y - py) / inLen) * r
    const bx = x + ((nx - x) / outLen) * r, by = y + ((ny - y) / outLen) * r
    d += ` L ${ax} ${ay} Q ${x} ${y} ${bx} ${by}`
  }
  const [lx, ly] = points[points.length - 1]
  return `${d} L ${lx} ${ly}`
}

let nextId = 1

// A new line from a random card edge to a free spot, or null if there's no room
function makeLine(w: number, h: number, card: Rect, taken: { x: number; y: number }[]): Line | null {
  const sides = (['left', 'right', 'top', 'bottom'] as const).filter(side =>
    side === 'left' ? card.left > 120 : side === 'right' ? w - card.right > 120 : side === 'top' ? card.top > 120 : h - card.bottom > 120,
  )
  if (!sides.length) return null

  for (let attempt = 0; attempt < 12; attempt++) {
    const side = pick(sides)
    const horizontal = side === 'left' || side === 'right'
    let pts: [number, number][]
    let tile: { x: number; y: number }

    if (horizontal) {
      const sx = side === 'right' ? card.right : card.left
      const sy = rand(card.top + 30, card.bottom - 30)
      const tx = side === 'right' ? rand(card.right + 90, w - EDGE - TILE / 2) : rand(EDGE + TILE / 2, card.left - 90)
      const ty = rand(EDGE + TILE / 2, h - EDGE - TILE / 2)
      const mx = sx + (tx - sx) * rand(0.25, 0.6)
      pts = Math.abs(ty - sy) < RADIUS * 2 ? [[sx, sy], [tx, sy]] : [[sx, sy], [mx, sy], [mx, ty], [tx, ty]]
      tile = { x: tx, y: pts[pts.length - 1][1] }
    } else {
      const sy = side === 'bottom' ? card.bottom : card.top
      const sx = rand(card.left + 30, card.right - 30)
      const ty = side === 'bottom' ? rand(card.bottom + 90, h - EDGE - TILE / 2) : rand(EDGE + TILE / 2, card.top - 90)
      const tx = rand(EDGE + TILE / 2, w - EDGE - TILE / 2)
      const my = sy + (ty - sy) * rand(0.3, 0.65)
      pts = Math.abs(tx - sx) < RADIUS * 2 ? [[sx, sy], [sx, ty]] : [[sx, sy], [sx, my], [tx, my], [tx, ty]]
      tile = { x: pts[pts.length - 1][0], y: ty }
    }

    // Keep tiles apart, and clear of the logo in the top-left corner
    const clash = taken.some(t => Math.hypot(t.x - tile.x, t.y - tile.y) < TILE * 2)
    const onLogo = tile.x < 200 && tile.y < 80
    if (clash || onLogo) continue

    return {
      id: nextId++, d: roundedPath(pts), tile, Icon: pick(ICONS),
      reverse: Math.random() < 0.5, duration: rand(2.6, 4.2), delay: rand(0, 1.2),
    }
  }
  return null
}

export function AuthBackground({ cardRef }: { cardRef: React.RefObject<HTMLDivElement | null> }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [lines, setLines] = useState<Line[]>([])
  const cardBox = useRef<Rect | null>(null)

  // Measure the screen and the card (lines are laid out in real pixels around it)
  useEffect(() => {
    const root = rootRef.current, card = cardRef.current
    if (!root || !card) return
    const measure = () => {
      const r = root.getBoundingClientRect(), c = card.getBoundingClientRect()
      cardBox.current = { left: c.left - r.left, top: c.top - r.top, right: c.right - r.left, bottom: c.bottom - r.top }
      setSize({ w: r.width, h: r.height })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(root); ro.observe(card)
    return () => ro.disconnect()
  }, [cardRef])

  // (Re)fill the lines whenever the layout changes: fewer on small screens
  useEffect(() => {
    const card = cardBox.current
    if (!size.w || !card) return
    const count = size.w < 768 ? 4 : 8
    const next: Line[] = []
    for (let i = 0; i < count; i++) {
      const line = makeLine(size.w, size.h, card, next.map(l => l.tile))
      if (line) next.push({ ...line, delay: line.delay + i * 0.5 })
    }
    setLines(next)
  }, [size])

  // A line finished its pulses: swap it for a fresh one elsewhere
  const replace = useCallback((id: number) => {
    const card = cardBox.current
    if (!card) return
    setLines(current => {
      const old = current.find(l => l.id === id)
      const others = current.filter(l => l.id !== id)
      // No free spot this time? Re-run the same line so the loop never runs dry
      const line = makeLine(size.w, size.h, card, others.map(l => l.tile))
        ?? (old && { ...old, id: nextId++, reverse: !old.reverse, delay: 0.3 })
      return line ? [...others, line] : others
    })
  }, [size])

  return (
    <div ref={rootRef} className="auth-bg" aria-hidden>
      {size.w > 0 && (
        <svg className="auth-bg-svg" width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`}>
          <AnimatePresence>
            {lines.map(line => (
              <motion.g
                key={line.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8 }}
              >
                <path d={line.d} className="auth-bg-line" />
                {!reduceMotion && (
                  <>
                    {/* soft glow + bright core, one dash that travels the whole line */}
                    {[{ cls: 'auth-bg-glow', dash: 22 }, { cls: 'auth-bg-pulse', dash: 16 }].map(({ cls, dash }) => (
                      <motion.path
                        key={cls}
                        d={line.d}
                        pathLength={100}
                        className={cls}
                        strokeDasharray={`${dash} 200`}
                        initial={{ strokeDashoffset: line.reverse ? -100 : dash }}
                        animate={{ strokeDashoffset: line.reverse ? dash : -100 }}
                        transition={{ duration: line.duration, delay: line.delay + 0.4, ease: 'easeInOut', repeat: PASSES - 1, repeatDelay: 0.6 }}
                        onAnimationComplete={cls === 'auth-bg-pulse' ? () => replace(line.id) : undefined}
                      />
                    ))}
                  </>
                )}
                <motion.g
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: line.delay, type: 'spring', stiffness: 260, damping: 20 }}
                  style={{ transformOrigin: `${line.tile.x}px ${line.tile.y}px` }}
                >
                  <rect
                    x={line.tile.x - TILE / 2} y={line.tile.y - TILE / 2} width={TILE} height={TILE} rx={12}
                    className="auth-bg-tile"
                  />
                  <line.Icon x={line.tile.x - 10} y={line.tile.y - 10} width={20} height={20} className="auth-bg-icon" />
                </motion.g>
              </motion.g>
            ))}
          </AnimatePresence>
        </svg>
      )}
    </div>
  )
}
