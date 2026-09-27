'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'

/**
 * Profile button (black rounded rectangle with the name; a light sweeps across the name on hover)
 * with an animated menu: email, plan and
 * usage, Plans & billing, Sign out. Used in the dashboard and clip board headers.
 * (styles: .acct-* / .dash-popover / .dash-account-menu in app/globals.css)
 *
 * Pass `planInfo` when the page already has it; otherwise it's fetched here.
 */

type PlanSummary = { planName: string; maxVideos: number; usage: { videos: number } }

export function AccountMenu({ planInfo }: { planInfo?: PlanSummary | null }) {
  const { data: session } = useSession()
  const email = session?.user?.email ?? ''
  // "narasimham.m@x.com" → "Narasimham"
  const first = email.split('@')[0].split(/[._+-]/)[0]
  const name = first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Account'

  const [fetched, setFetched] = useState<PlanSummary | null>(null)
  useEffect(() => {
    if (planInfo !== undefined) return
    fetch('/api/billing/plan').then(r => (r.ok ? r.json() : null)).then(setFetched).catch(() => {})
  }, [planInfo])
  const plan = planInfo ?? fetched

  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  // Keep the menu mounted briefly after closing so it can animate out
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (open) { setShown(true); return }
    if (!shown) return
    const t = setTimeout(() => setShown(false), 160)
    return () => clearTimeout(t)
  }, [open, shown])

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="acct-btn" aria-label="Account menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <span className="acct-name">{name}</span>
      </button>
      {shown && (
        <div className={`dash-popover dash-account-menu${open ? '' : ' is-closing'}`} role="menu" style={{ minWidth: 220 }}>
          <div className="dash-popover-head">
            <p>{email}</p>
            {plan && <p>{plan.planName} plan · {plan.usage.videos}/{plan.maxVideos} videos</p>}
          </div>
          <a href="/pricing" className="dash-menu-item" role="menuitem">Plans &amp; billing</a>
          <button className="dash-menu-item" role="menuitem" onClick={() => signOut({ callbackUrl: '/login' })}>Sign out</button>
        </div>
      )}
    </div>
  )
}
