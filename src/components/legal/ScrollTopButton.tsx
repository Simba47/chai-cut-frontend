'use client'

import { ArrowUp } from 'lucide-react'

export function ScrollTopButton() {
  return (
    <button type="button" className="legal-card-top" aria-label="Scroll to top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
      <ArrowUp aria-hidden />
    </button>
  )
}
