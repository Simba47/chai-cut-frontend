'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  email: string
  planName?: string | null
  /** Navigate away (the editor saves pending edits first) */
  onNavigate: (href: string) => void
  onSignOut: () => void
}

/** Profile button (first letter of the email) with plan, Plans & billing and Log out */
export function AccountMenu({ email, planName, onNavigate, onSignOut }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  const item = 'flex items-center gap-2.5 w-full px-2.5 py-2 rounded-lg text-sm text-left transition-colors hover:bg-[rgb(var(--ed-fg)/0.07)]'

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)} aria-label="Account menu" aria-haspopup="menu" aria-expanded={open}
        className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold uppercase transition-colors"
        style={{ background: 'rgb(var(--ed-fg) / 0.08)', color: 'var(--ed-text)', boxShadow: 'inset 0 0 0 1px rgb(var(--ed-fg) / 0.14)' }}>
        {email.charAt(0) || '?'}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-50 p-1.5 rounded-xl"
          style={{ top: 'calc(100% + 8px)', minWidth: 230, background: 'var(--ed-popover)', border: '1px solid rgb(var(--ed-fg) / 0.14)', boxShadow: '0 16px 40px rgba(0,0,0,0.5)' }}>
          <div className="px-2.5 pt-2 pb-2.5 mb-1" style={{ borderBottom: '1px solid rgb(var(--ed-fg) / 0.08)' }}>
            <p className="text-sm font-semibold truncate" style={{ color: 'var(--ed-text)' }}>{email}</p>
            {planName && (
              <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: 'rgb(var(--ed-fg) / 0.5)' }}>
                <span className="px-1.5 rounded-full text-[10px] font-bold" style={{ background: '#c8ff00', color: '#000' }}>{planName}</span>
                plan
              </p>
            )}
          </div>
          <button role="menuitem" className={item} style={{ color: 'var(--ed-text)' }} onClick={() => { setOpen(false); onNavigate('/pricing') }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M2.5 10h19M6.5 15h4" />
            </svg>
            Plans &amp; billing
          </button>
          <button role="menuitem" className={item} style={{ color: 'var(--ed-text)' }} onClick={() => { setOpen(false); onNavigate('/dashboard') }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" />
            </svg>
            Dashboard
          </button>
          <button role="menuitem" className={item} style={{ color: '#ef4444' }} onClick={() => { setOpen(false); onSignOut() }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            Log out
          </button>
        </div>
      )}
    </div>
  )
}
