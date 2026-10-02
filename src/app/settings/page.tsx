'use client'

import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { Breadcrumbs } from '@/components/ui/breadcrumbs'
import { AccountMenu } from '@/components/ui/account-menu'
import { BrandLoaderScreen } from '@/components/ui/brand-loader'

type Account = { email: string; name: string | null; emailVerified: string | null; planName: string; hasPassword: boolean }

/**
 * Account settings: your name, email and plan; change your password; delete your account.
 * Talks to /api/account (GET, PATCH, DELETE) and /api/account/password. (styles: .st-* in globals.css)
 */
export default function SettingsPage() {
  const { update } = useSession()
  const [account, setAccount] = useState<Account | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/account')
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? 'Could not load your account'); return d })
      .then(setAccount)
      .catch(e => setLoadError(e instanceof Error ? e.message : 'Could not load your account'))
  }, [])

  if (!account && !loadError) return <BrandLoaderScreen label="Opening your account…" />

  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#0b0b0c' }}>
      <nav className="flex items-center gap-3 px-4 shrink-0 sticky top-0 z-10"
        style={{ height: 56, background: 'rgba(14,14,15,0.85)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <Breadcrumbs shine items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Account settings' }]} />
        <div className="flex-1" />
        <AccountMenu />
      </nav>

      <main className="flex-1 w-full max-w-2xl mx-auto px-4 sm:px-6 py-10 flex flex-col gap-6">
        <header>
          <h1 className="st-title">Account settings</h1>
          <p className="st-sub">Your name, password and account. Changes save straight away.</p>
        </header>

        {loadError && <div className="st-alert st-alert-red" role="alert">{loadError}</div>}

        {account && (
          <>
            <ProfileCard account={account} onSaved={async name => { setAccount(a => a && { ...a, name }); await update({ name }) }} />
            {account.hasPassword && <PasswordCard />}
            <DangerCard hasPassword={account.hasPassword} />
          </>
        )}
      </main>
    </div>
  )
}

/** Name (editable), email and plan */
function ProfileCard({ account, onSaved }: { account: Account; onSaved: (name: string | null) => Promise<void> }) {
  const [name, setName] = useState(account.name ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const changed = name.trim() !== (account.name ?? '')

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!changed || state === 'saving') return
    setState('saving'); setError(null)
    try {
      const r = await fetch('/api/account', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Could not save your name')
      await onSaved(d.name)
      setName(d.name ?? '')
      setState('saved')
      setTimeout(() => setState(s => (s === 'saved' ? 'idle' : s)), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your name'); setState('error')
    }
  }

  return (
    <section className="st-card">
      <h2 className="st-card-title">Profile</h2>
      <form onSubmit={save} className="flex flex-col gap-4">
        <label className="st-field">
          <span className="st-label">Name</span>
          <div className="flex gap-2">
            <input className="st-input flex-1" value={name} maxLength={60} placeholder="Your name"
              onChange={e => { setName(e.target.value); if (state !== 'saving') setState('idle') }} autoComplete="name" />
            <button type="submit" className="st-btn st-btn-lime" disabled={!changed || state === 'saving'}>
              {state === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
          <span className="st-hint">Shown on your profile button.</span>
        </label>
        {state === 'saved' && <p className="st-ok">✓ Name saved</p>}
        {error && <p className="st-err" role="alert">{error}</p>}

        <div className="st-field">
          <span className="st-label">Email</span>
          <div className="st-readonly">
            <span className="truncate">{account.email}</span>
            {account.emailVerified && <span className="st-badge st-badge-green">Verified</span>}
          </div>
        </div>

        <div className="st-field">
          <span className="st-label">Plan</span>
          <div className="st-readonly">
            <span>{account.planName}</span>
            <a href="/pricing" className="st-link">Plans &amp; billing →</a>
          </div>
        </div>
      </form>
    </section>
  )
}

/** Change password: current, new, confirm */
function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const rules = [
    { ok: next.length >= 8, text: '8 or more characters' },
    { ok: /[A-Z]/.test(next), text: 'An uppercase letter' },
    { ok: /[0-9]/.test(next), text: 'A number' },
  ]
  const matches = !!next && next === confirm
  const ready = !!current && rules.every(r => r.ok) && matches

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true); setError(null); setDone(false)
    try {
      const r = await fetch('/api/account/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current, next }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Could not change your password')
      setCurrent(''); setNext(''); setConfirm(''); setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change your password')
    } finally { setBusy(false) }
  }

  const type = show ? 'text' : 'password'
  return (
    <section className="st-card">
      <div className="flex items-center justify-between">
        <h2 className="st-card-title">Password</h2>
        <button type="button" onClick={() => setShow(s => !s)} className="st-link">{show ? 'Hide' : 'Show'} passwords</button>
      </div>
      <form onSubmit={save} className="flex flex-col gap-4">
        <label className="st-field">
          <span className="st-label">Current password</span>
          <input className="st-input" type={type} value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="st-field">
          <span className="st-label">New password</span>
          <input className="st-input" type={type} value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" />
          <ul className="st-rules">
            {rules.map(r => <li key={r.text} data-ok={r.ok || undefined}>{r.ok ? '✓' : '•'} {r.text}</li>)}
          </ul>
        </label>
        <label className="st-field">
          <span className="st-label">Confirm new password</span>
          <input className="st-input" type={type} value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" />
          {confirm && !matches && <span className="st-err">The passwords don’t match</span>}
        </label>
        {done && <p className="st-ok">✓ Password changed</p>}
        {error && <p className="st-err" role="alert">{error}</p>}
        <div>
          <button type="submit" className="st-btn st-btn-lime" disabled={!ready || busy}>{busy ? 'Changing…' : 'Change password'}</button>
        </div>
      </form>
    </section>
  )
}

/** Delete the account: password + typing DELETE */
function DangerCard({ hasPassword }: { hasPassword: boolean }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = typed.trim().toUpperCase() === 'DELETE' && (!hasPassword || !!password)

  async function remove() {
    if (!ready || busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/account', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Could not delete your account')
      await signOut({ callbackUrl: '/' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete your account'); setBusy(false)
    }
  }

  return (
    <section className="st-card st-card-danger">
      <h2 className="st-card-title">Delete account</h2>
      <p className="st-sub" style={{ marginTop: 0 }}>
        This deletes your account, all your videos and clips, and your exports — for good. It can’t be undone.
      </p>
      {!open ? (
        <div><button type="button" className="st-btn st-btn-danger" onClick={() => setOpen(true)}>Delete my account…</button></div>
      ) : (
        <div className="flex flex-col gap-4">
          {hasPassword && (
            <label className="st-field">
              <span className="st-label">Your password</span>
              <input className="st-input" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" />
            </label>
          )}
          <label className="st-field">
            <span className="st-label">Type <b style={{ color: '#fff' }}>DELETE</b> to confirm</span>
            <input className="st-input" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          {error && <p className="st-err" role="alert">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="st-btn st-btn-ghost" onClick={() => { setOpen(false); setPassword(''); setTyped(''); setError(null) }} disabled={busy}>Cancel</button>
            <button type="button" className="st-btn st-btn-danger-solid" onClick={remove} disabled={!ready || busy}>
              {busy ? 'Deleting…' : 'Delete my account for good'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
