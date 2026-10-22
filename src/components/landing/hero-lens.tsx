'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ZoomFit } from '@/components/ui/zoom-fit'

/**
 * Hero animation: a long video glides past a 9:16 lens (styles: .hl-* in app/landing.css).
 * Outside the lens the footage is grey; inside it plays in colour. Each beat the strip eases to a
 * stop on a speaker, the lens locks on, captions light up word by word, a shutter flash fires and
 * the finished clip lifts out of the lens into the fanned stack on the right.
 */

// Layout (px, at the 520px design width; ZoomFit scales it to the column: down on phones, up to 1.6x on wide screens)
const WIDTH = 520, HEIGHT = 228
const H = 160, W = Math.round(H * 16 / 9), GAP = 10, P = W + GAP   // 16:9 frames on the strip
const LW = Math.round(H * 9 / 16), CX = 190, TOP = (HEIGHT - H) / 2  // the 9:16 lens, centred at CX
const LENS_LEFT = CX - LW / 2

// One beat (ms): glide to the next speaker, lock on, caption, shoot, release
const MOVE = 1100, LOCK_AT = 1150, WORD_AT = [1300, 1600, 1900], SHOT_AT = 2300, UNLOCK_AT = 2700, CYCLE = 3000

export const SCENES = [
  { bg: 'linear-gradient(135deg, #2b1055 0%, #7b2f7f 55%, #d8587a 100%)', skin: '#e9a88e', caption: ['Nobody', 'talks', 'about this'], side: 0.8 },
  { bg: 'linear-gradient(135deg, #0b2a3a 0%, #155e75 55%, #3fb5c4 100%)', skin: '#c98d6c', caption: ['This', 'changed', 'everything'], side: 0.18 },
  { bg: 'linear-gradient(135deg, #3a1406 0%, #9a3c12 55%, #f0a04b 100%)', skin: '#f1b996', caption: ['Here’s', 'the', 'truth'], side: 0.82 },
  { bg: 'linear-gradient(135deg, #0c1f16 0%, #1f6b4a 55%, #7fd39b 100%)', skin: '#a8705a', caption: ['Wait', 'for', 'it…'], side: 0.2 },
  { bg: 'linear-gradient(135deg, #1a1446 0%, #3b3fa8 55%, #8f8cf2 100%)', skin: '#dba184', caption: ['Do', 'this', 'instead'], side: 0.78 },
  { bg: 'linear-gradient(135deg, #3b0d1c 0%, #8f1f3f 55%, #f06a7a 100%)', skin: '#bf8366', caption: ['My', 'biggest', 'mistake'], side: 0.22 },
]
const S = SCENES.length
// The strip holds the scenes three times over; the frame under the lens stays in [S, 2S) and
// jumps by S frames when it leaves that range, which looks identical
const FRAMES = Array.from({ length: S * 3 }, (_, j) => j)
const START = 2 * S - 1
const wrap = (c: number) => (((c - S) % S) + S) % S + S
const stripX = (c: number) => CX - (c * P + W / 2)
const sceneAt = (c: number) => ((Math.round(c) % S) + S) % S

// Where captured clips settle: newest in front, older ones fanned out behind it
const SLOTS = [
  { x: 172, y: 4, rotate: 6, rotateY: -14, scale: 0.84, opacity: 1 },
  { x: 210, y: -4, rotate: 12, rotateY: -20, scale: 0.74, opacity: 0.7 },
  { x: 242, y: -10, rotate: 18, rotateY: -24, scale: 0.64, opacity: 0.4 },
]
const GONE = { x: 268, y: -16, rotate: 22, rotateY: -28, scale: 0.56, opacity: 0 }

const ease = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2)  // quint in-out

type Card = { id: number; scene: number }

export function Scene({ i }: { i: number }) {
  const s = SCENES[i]
  return (
    <div className="hl-scene" style={{ background: s.bg }}>
      <span className="hl-bokeh" style={{ '--bx': `${18 + i * 11}%`, '--by': '24%' } as React.CSSProperties} />
      <span className="hl-bokeh hl-bokeh-2" style={{ '--bx': `${74 - i * 7}%`, '--by': '34%' } as React.CSSProperties} />
      <span className="hl-person hl-person-side" style={{ left: `${s.side * 100}%`, '--skin': s.skin } as React.CSSProperties}><i /><b /></span>
      <span className="hl-person" style={{ '--skin': s.skin } as React.CSSProperties}><i /><b /></span>
    </div>
  )
}

export function Caption({ words, lit }: { words: string[]; lit: number }) {
  return (
    <span className="hl-cap">
      {words.map((w, k) => <span key={k} className={k < lit ? (k === lit - 1 ? 'on now' : 'on') : ''}>{w}</span>).flatMap((el, k) => (k ? [' ', el] : [el]))}
    </span>
  )
}

export function HeroLens() {
  const rootRef = useRef<HTMLDivElement>(null)
  const strips = useRef<(HTMLDivElement | null)[]>([])
  const [locked, setLocked] = useState(false)
  const [scene, setScene] = useState(sceneAt(START))
  const [words, setWords] = useState(0)
  const [shot, setShot] = useState(0)
  const [cards, setCards] = useState<Card[]>([{ id: -1, scene: sceneAt(START + 1) }, { id: -2, scene: sceneAt(START + 2) }])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const place = (c: number, blur: number) => strips.current.forEach(el => {
      if (!el) return
      el.style.transform = `translate3d(${stripX(c).toFixed(2)}px,0,0)`
      el.style.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : ''
    })
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // A finished beat: locked on a speaker, caption done, clips stacked
      place(START, 0); setLocked(true); setWords(3)
      setCards(cs => [{ id: 0, scene: sceneAt(START) }, ...cs])
      return
    }

    // Time only advances while the hero is on screen, so the loop picks up where it left off
    let visible = true
    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting })
    io.observe(root)

    let raf = 0, last = performance.now(), t = 0
    let state = { beat: -1, locked: false, words: 0, shotBeat: -1 }
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      const dt = Math.min(now - last, 50)
      last = now
      if (!visible) return
      t += dt
      const beat = Math.floor(t / CYCLE), u = t - beat * CYCLE
      const p = Math.min(1, u / MOVE)
      const from = START - beat, to = from - 1
      // motion blur follows the strip's speed
      const speed = p < 1 ? (ease(Math.min(1, p + 0.02)) - ease(p)) / 0.02 : 0
      place(wrap(from - ease(p)), speed * 1.1)

      const isLocked = u >= LOCK_AT && u < UNLOCK_AT
      const lit = isLocked ? WORD_AT.filter(w => u >= w).length : 0
      if (beat !== state.beat) { state.beat = beat; setScene(sceneAt(to)) }
      if (isLocked !== state.locked) { state.locked = isLocked; setLocked(isLocked) }
      if (lit !== state.words) { state.words = lit; setWords(lit) }
      if (u >= SHOT_AT && state.shotBeat !== beat) {
        state.shotBeat = beat
        setShot(beat + 1)
        setCards(cs => [{ id: beat + 1, scene: sceneAt(to) }, ...cs].slice(0, SLOTS.length))
      }
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); io.disconnect() }
  }, [])

  const strip = (k: number) => (
    <div className="hl-strip" ref={el => { strips.current[k] = el }} style={{ transform: `translate3d(${stripX(START)}px,0,0)` }}>
      {FRAMES.map(j => <div key={j} className="hl-frame" style={{ left: j * P }}><Scene i={j % S} /></div>)}
    </div>
  )

  return (
    <ZoomFit width={WIDTH} max={1.6} className="hl-fit">
      <div
        ref={rootRef}
        className="hl"
        role="img"
        aria-label="A long video glides past a vertical frame that picks out the best moments, captions them and turns each into a short clip"
        style={{ '--hl-w': `${WIDTH}px`, '--hl-h': `${HEIGHT}px`, '--hl-fh': `${H}px`, '--hl-fw': `${W}px`, '--hl-lw': `${LW}px`, '--hl-lx': `${LENS_LEFT}px`, '--hl-top': `${TOP}px` } as React.CSSProperties}
      >
        <span key={`g${shot}`} className="hl-glow" />
        {/* the raw footage, grey */}
        <div className="hl-layer hl-base">{strip(0)}</div>
        {/* the same footage in colour, only inside the lens */}
        <div className="hl-layer hl-color">{strip(1)}</div>

        <div className="hl-lens" data-lock={locked || undefined}>
          <i /><i /><i /><i />
          <span className="hl-ratio">9:16</span>
          <span className="hl-rec" />
          <Caption words={SCENES[scene].caption} lit={words} />
          {shot > 0 && <span key={shot} className="hl-flash" />}
        </div>

        <AnimatePresence initial={false}>
          {cards.map((c, i) => (
            <motion.div
              key={c.id}
              className="hl-card"
              style={{ zIndex: 10 - i }}
              initial={{ x: 0, y: 0, rotate: 0, rotateY: 0, scale: 1, opacity: 1 }}
              animate={SLOTS[i]}
              exit={GONE}
              transition={{ type: 'spring', stiffness: 140, damping: 20, mass: 0.9 }}
            >
              <div className="hl-card-scene"><Scene i={c.scene} /></div>
              <Caption words={SCENES[c.scene].caption} lit={3} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ZoomFit>
  )
}
