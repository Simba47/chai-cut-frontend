'use client'

import { useId, useRef, useState } from 'react'
import { motion, useReducedMotion, useScroll, useSpring, useTransform, type MotionStyle } from 'framer-motion'
import { ChevronDown, CircleHelp } from 'lucide-react'
import { neutralStyle, useLiteMotion } from './use-lite-motion'

export type FaqItem = { question: string; answer: string }

/**
 * Landing-page FAQ (styles: app/landing.css, "FAQ"): pill eyebrow, heading, and an accordion
 * with one row open at a time. Each row starts small and grows to full size as it scrolls up
 * into view (and shrinks again when scrolled back down).
 */
export function FaqSection({ eyebrow, title, description, items }: {
  eyebrow: string
  title: string
  description: string
  items: FaqItem[]
}) {
  const [open, setOpen] = useState<string | null>(null)
  const baseId = useId()

  return (
    <section className="section-inner faq">
      <div className="section-head reveal">
        <p className="faq-eyebrow"><CircleHelp aria-hidden /> {eyebrow}</p>
        <h2 className="section-title">{title}</h2>
        <p className="section-sub">{description}</p>
      </div>

      <div className="faq-body reveal">
        <ul className="faq-list">
          {items.map((it, i) => {
            const isOpen = open === it.question
            const panelId = `${baseId}-${i}`
            return (
              <FaqRow key={it.question} isOpen={isOpen}>
                <button
                  type="button"
                  className="faq-q"
                  aria-expanded={isOpen}
                  aria-controls={panelId}
                  onClick={() => setOpen(isOpen ? null : it.question)}
                >
                  <span>{it.question}</span>
                  <ChevronDown aria-hidden />
                </button>
                <div id={panelId} className="faq-a" role="region" aria-hidden={!isOpen}>
                  <div><p>{it.answer}</p></div>
                </div>
              </FaqRow>
            )
          })}
        </ul>
      </div>
    </section>
  )
}

// Scroll-linked grow: small while the row sits near the bottom of the screen, full size by
// the time it reaches the middle. Off on phones/touch and with reduced motion.
function FaqRow({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLLIElement>(null)
  const reduceMotion = useReducedMotion()
  const lite = useLiteMotion()
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center 0.55'] })
  const p = useSpring(scrollYProgress, { stiffness: 160, damping: 26, mass: 0.3 })
  const scale = useTransform(p, [0, 1], [0.82, 1])
  const opacity = useTransform(p, [0, 1], [0.35, 1])

  let style: MotionStyle = { scale, opacity }
  if (reduceMotion || lite) style = neutralStyle(style)

  return (
    <motion.li ref={ref} className={`faq-item${isOpen ? ' is-open' : ''}`} style={style}>
      {children}
    </motion.li>
  )
}
