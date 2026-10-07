'use client'

import { COMPANY } from '@/lib/company'

const MAILTO = `mailto:${COMPANY.email}`
// Desktop: a mailto: link needs a mail app set up (otherwise it leaves a blank tab),
// so open Gmail's compose window instead. Phones keep mailto:, which opens their mail app.
export const GMAIL_COMPOSE = `https://mail.google.com/mail/?view=cm&fs=1&to=${COMPANY.email}`
export function openMailAppOnPhones(e: React.MouseEvent) {
  if (window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); window.location.href = MAILTO }
}

/** Link that writes an email to our support address; shows the address unless given children */
export function EmailLink({ className, children }: { className?: string; children?: React.ReactNode }) {
  return (
    <a className={className} href={GMAIL_COMPOSE} target="_blank" rel="noopener noreferrer" onClick={openMailAppOnPhones}>
      {children ?? COMPANY.email}
    </a>
  )
}
