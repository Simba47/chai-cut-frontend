import Link from 'next/link'
import { ArrowLeft, type LucideIcon } from 'lucide-react'
import { COMPANY } from '@/lib/company'
import { ScrollTopButton } from './ScrollTopButton'

export interface LegalCard {
  icon: LucideIcon
  title: string
  body: React.ReactNode
}

/** Legal page as one card of numbered rows: back link, badge, title, date, rows, copyright */
export function LegalCardPage({ badge, badgeIcon: BadgeIcon, title, updated, cards, numbered = true, danger = false }: {
  badge: string
  badgeIcon: LucideIcon
  title: string
  updated: string
  cards: LegalCard[]
  numbered?: boolean
  /** Red accents, for pages about deleting things */
  danger?: boolean
}) {
  return (
    <div className={`lp-root legal-card-root${danger ? ' legal-card-danger' : ''}`}>
      <div className="legal-card-wrap">
        <Link href="/" className="legal-card-back"><ArrowLeft aria-hidden /> Back to Home</Link>

        <header className="legal-card-head">
          <span className="legal-card-badge"><BadgeIcon aria-hidden /> {badge}</span>
          <h1>{title}</h1>
          <p>Last updated: <strong>{updated}</strong></p>
        </header>

        <main className="legal-card">
          {cards.map(({ icon: Icon, title, body }, i) => (
            <section key={title} className="legal-card-row">
              <span className="legal-card-icon"><Icon aria-hidden /></span>
              <div>
                <h2>{numbered && `${i + 1}. `}{title}</h2>
                <p>{body}</p>
              </div>
            </section>
          ))}
        </main>

        <p className="legal-card-copy">© {new Date().getFullYear()} {COMPANY.legalName} · All rights reserved</p>
      </div>
      <ScrollTopButton />
    </div>
  )
}
