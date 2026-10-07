import Link from 'next/link'
import { BrandLogo } from '@/components/ui/brand-logo'
import { COMPANY } from '@/lib/company'
import { EmailLink } from '@/components/ui/email-link'

export interface LegalSection {
  id: string
  title: string
  body: React.ReactNode
}

/** Shared layout for Privacy, Terms and the other legal pages: header, contents list, numbered sections */
export function LegalPage({ eyebrow, title, updated, intro, sections }: {
  eyebrow: string
  title: string
  updated: string
  intro: React.ReactNode
  sections: LegalSection[]
}) {
  return (
    <div className="lp-root legal-root">
      <header className="legal-nav">
        <Link href="/" aria-label="Shortcut home"><BrandLogo size="sm" /></Link>
        <Link href="/" className="legal-back">← Back to home</Link>
      </header>

      <main className="legal-main">
        <p className="legal-eyebrow">{eyebrow}</p>
        <h1 className="legal-title">{title}</h1>
        <p className="legal-updated">Last updated: {updated}</p>
        <div className="legal-intro">{intro}</div>

        <nav className="legal-toc" aria-label="On this page">
          <p className="legal-toc-title">On this page</p>
          <ol>
            {sections.map(s => <li key={s.id}><a href={`#${s.id}`}>{s.title}</a></li>)}
          </ol>
        </nav>

        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="legal-section">
            <h2>{i + 1}. {s.title}</h2>
            {s.body}
          </section>
        ))}
      </main>

      <footer className="legal-footer">
        <span>© 2026 {COMPANY.legalName}. All rights reserved.</span>
        <span className="legal-footer-links">
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
          <Link href="/support">Support</Link>
          <Link href="/delete-account">Delete account</Link>
          <EmailLink />
        </span>
      </footer>
    </div>
  )
}
