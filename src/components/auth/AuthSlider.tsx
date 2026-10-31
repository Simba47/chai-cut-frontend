'use client'

import { useEffect, useRef, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Check, Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { BrandLogo } from '@/components/ui/brand-logo'
import { FillButtonContent } from '@/components/ui/fill-button'
import { keepNextPath, takeNextPath } from '@/lib/nextPath'

type Mode = 'signin' | 'signup'

/** Set by app/api/auth/signed-out for the sign-in form to say why */
const SIGNED_OUT_NOTE = 'signed_out'
/** Seconds before another code can be sent */
const RESEND_COOLDOWN = 60

/** What the brand side says Shortcut does */
const POINTS = [
  'AI finds the moments worth posting',
  'Captions, frames and B-roll in one editor',
  'Vertical exports in minutes',
]

/**
 * Sign in / sign up (styles: app/auth.css): one card that always fits the window (user,
 * 2026-10-31) — the lime brand side on its left, the form on its right. On phones the brand side
 * is a short header above the form. /login and /signup both render this (their tab picked).
 */
export function AuthSlider({ initialMode, google = false }: { initialMode: Mode; google?: boolean }) {
  // (the page that sent them here — a brand kit invite link — is where signing in or up ends)
  useEffect(() => { keepNextPath() }, [])

  return (
    <div className="auth-root">
      <div className="auth-card">
        <aside className="auth-brand">
          {/* (no shine: its white band is made for a dark page, not the lime) */}
          <Link href="/" aria-label="Shortcut home" className="auth-home"><BrandLogo /></Link>
          <div className="auth-stage">
            <div className="auth-pitch">
              <h2>Long videos in.<br />Scroll-stopping shorts out.</h2>
              <p>Turn any talk, podcast or stream into clips ready for Reels, Shorts and TikTok.</p>
              <ul>
                {POINTS.map(p => <li key={p}><span aria-hidden><Check /></span>{p}</li>)}
              </ul>
            </div>
            <ReelPreview />
          </div>
          <p className="auth-fine">Free to start · No credit card</p>
        </aside>

        <main className="auth-side">
          <div className="auth-panel">
            <AuthFlow initialMode={initialMode} google={google} />
          </div>
        </main>
      </div>
    </div>
  )
}

/** A small vertical clip on the brand side: a talking head, its caption, a progress bar (decoration only) */
function ReelPreview() {
  return (
    <div className="auth-reel" aria-hidden>
      <div className="auth-reel-phone">
        <div className="auth-reel-head" />
        <div className="auth-reel-body" />
        <p className="auth-reel-cap"><span>THIS</span> CHANGED EVERYTHING</p>
        <div className="auth-reel-bar"><i /></div>
      </div>
      <div className="auth-reel-tag">0:42 · 9:16</div>
    </div>
  )
}

/** Why a Google sign-in came back without signing in (NextAuth's ?error= on /login) */
function googleError(code: string | null): string | null {
  if (!code) return null
  if (code === 'AccessDenied') return 'Google didn’t share a confirmed email for that account. Try another Google account, or use your email.'
  if (code === 'Configuration') return 'Google sign-in isn’t available right now. Use your email and password, or try again later.'
  return 'Google sign-in didn’t finish. Try again.'
}

const GOOGLE_ONLY = 'This email signs in with Google — use Continue with Google. (Or set a password with “Forgot password?”)'

/**
 * Sign in · Create account tabs, and one way through either (user, 2026-10-31: "far better
 * understanding but maintain uni directional flow"). Sign in with an email that has no account
 * slides to Create account with what was typed kept — only the confirmation is asked. Create
 * account with an email that already has one signs straight in when the password is right, else
 * slides to Sign in and says so. A new account's emailed code, once right, signs them straight in
 * with the password they typed (kept only in this page's memory) — never back to a sign-in form.
 */
function AuthFlow({ initialMode, google }: { initialMode: Mode; google: boolean }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [step, setStep] = useState<'form' | 'code'>('form')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const router = useRouter()
  const confirmRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)

  // Signed out here because the account signed in on another device (app/api/auth/signed-out)
  useEffect(() => {
    if (!document.cookie.split('; ').includes(`${SIGNED_OUT_NOTE}=elsewhere`)) return
    setNotice('You were signed out because your account signed in on another device. One device can be signed in at a time.')
    document.cookie = `${SIGNED_OUT_NOTE}=; Max-Age=0; path=/`
  }, [])
  // Back from Google without signing in: say why (once — the address loses the ?error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const msg = googleError(params.get('error'))
    if (!msg) return
    setError(msg)
    params.delete('error')
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`)
  }, [])
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])
  useEffect(() => { if (step === 'code') codeRef.current?.focus() }, [step])

  const norm = () => email.toLowerCase().trim()
  /** A tab picked (by the person, or by the flow): the address follows; what was typed stays */
  function switchTo(next: Mode, msg: { error?: string; notice?: string } = {}) {
    setMode(next)
    setError(msg.error ?? null)
    setNotice(msg.notice ?? null)
    window.history.replaceState(null, '', next === 'signin' ? '/login' : '/signup')
  }
  async function signInNow(): Promise<boolean> {
    const res = await signIn('credentials', { email: norm(), password, redirect: false })
    if (res?.error) return false
    router.push(takeNextPath())
    return true
  }
  async function status(): Promise<'password' | 'google' | 'none' | null> {
    const r = await fetch('/api/auth/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: norm() }) })
    const d = await r.json()
    if (!r.ok) { setError(d.error ?? 'Something went wrong. Try again.'); return null }
    return d.status
  }
  /** Run a step: loading on, messages cleared, a network failure said plainly */
  async function run(e: React.FormEvent, fn: () => Promise<void>) {
    e.preventDefault()
    setLoading(true); setError(null); setNotice(null)
    try { await fn() } catch { setError('Something went wrong. Check your connection and try again.') } finally { setLoading(false) }
  }

  // Sign in: an account signs in; no account → Create account, the confirmation is all that's left
  const onSignIn = (e: React.FormEvent) => run(e, async () => {
    const s = await status()
    if (!s) return
    if (s === 'none') {
      setConfirm('')
      switchTo('signup', { notice: `There’s no account for ${norm()} yet — confirm your password and we’ll create it.` })
      setTimeout(() => confirmRef.current?.focus(), 50)
      return
    }
    if (s === 'google') { setError(GOOGLE_ONLY); return }
    if (await signInNow()) return
    setError('Wrong password. Try again, or reset it with “Forgot password?”')
  })

  // Create account: already one → signed in with the right password, else Sign in says so; new → the code
  const onCreate = (e: React.FormEvent) => run(e, async () => {
    if (password !== confirm) { setError('The passwords don’t match'); return }
    const s = await status()
    if (!s) return
    if (s === 'google') { setError(GOOGLE_ONLY); return }
    if (s === 'password') {
      if (await signInNow()) return
      switchTo('signin', { error: `You already have an account with ${norm()}. Enter its password to sign in, or reset it with “Forgot password?”` })
      setPassword('')
      setTimeout(() => passwordRef.current?.focus(), 50)
      return
    }
    const r = await fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: norm(), password }) })
    const d = await r.json()
    if (!r.ok) { setError(d.error ?? 'Could not create your account. Try again.'); return }
    setCode(''); setCooldown(RESEND_COOLDOWN); setStep('code')
  })

  // The emailed code: right, and they're in
  const onVerify = (e: React.FormEvent) => run(e, async () => {
    const r = await fetch('/api/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: norm(), otp: code, purpose: 'signup' }) })
    const d = await r.json()
    if (!r.ok) { setError(d.error ?? 'That code didn’t work. Try again.'); return }
    if (await signInNow()) return
    // (verified, but signing in failed — rare: say so, the account is ready)
    setStep('form')
    switchTo('signin', { notice: 'Your email is confirmed and your account is ready. Sign in to continue.' })
  })

  async function resend() {
    setCooldown(RESEND_COOLDOWN); setError(null)
    const r = await fetch('/api/auth/verify-otp', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: norm(), purpose: 'signup' }) }).catch(() => null)
    setNotice(r?.ok ? `A new code is on its way to ${norm()}.` : null)
    if (!r?.ok) setError('Could not send a new code. Try again in a moment.')
  }

  const signup = mode === 'signup'
  const messages = (
    <>
      {notice && <p className="auth-note" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
    </>
  )

  if (step === 'code') {
    return (
      <form key="code" className="auth-form" onSubmit={onVerify}>
        <button type="button" className="auth-back" onClick={() => { setStep('form'); setError(null); setNotice(null) }}><ArrowLeft aria-hidden /> Back</button>
        <h1>Check your email</h1>
        <p className="auth-sub">We sent a 6-digit code to <strong>{norm()}</strong>. Enter it to finish — you’ll go straight in.</p>
        <Field id="auth-code" label="Code">
          <input
            ref={codeRef} id="auth-code" className="auth-code" type="text" inputMode="numeric" autoComplete="one-time-code"
            pattern="[0-9]{6}" maxLength={6} required placeholder="000000"
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        {messages}
        <button type="submit" disabled={loading || code.length < 6} className="fill-btn auth-submit">
          <FillButtonContent>{loading ? 'Checking…' : 'Verify and continue'}</FillButtonContent>
        </button>
        <p className="auth-switch">
          Didn’t get it?{' '}
          {cooldown > 0 ? <span>Send again in {cooldown}s</span> : <button type="button" onClick={resend}>Send a new code</button>}
          {' · '}<button type="button" onClick={() => { setStep('form'); switchTo('signup') }}>Use another email</button>
        </p>
      </form>
    )
  }

  return (
    <>
      <div className="auth-tabs" role="tablist" aria-label="Sign in or create an account">
        <button type="button" role="tab" aria-selected={mode === 'signin'} onClick={() => switchTo('signin')}>Sign in</button>
        <button type="button" role="tab" aria-selected={mode === 'signup'} onClick={() => switchTo('signup')}>Create account</button>
        <span className="auth-tab-pill" data-at={mode} aria-hidden />
      </div>
      {/* One form for both tabs (user, 2026-10-31): switching to Create account, Confirm password
          comes up from under the password; back to Sign in, it goes back under. The words change
          with a short fade; what was typed stays. */}
      <form className="auth-form" onSubmit={signup ? onCreate : onSignIn}>
        <div key={mode} className="auth-heading">
          <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="auth-sub">{signup ? 'Turn your first long video into shorts in minutes.' : 'Your clips and edits are right where you left them.'}</p>
        </div>
        {google && <GoogleButton />}
        <EmailField id="auth-email" value={email} onChange={setEmail} />
        <Field
          id="auth-password" label="Password"
          aside={<Link href="/forgot-password" className="auth-link auth-forgot" data-off={signup || undefined} tabIndex={signup ? -1 : undefined}>Forgot password?</Link>}
        >
          <PasswordInput
            ref={passwordRef} id="auth-password" value={password} onChange={e => setPassword(e.target.value)}
            required placeholder={signup ? '8+ chars, 1 uppercase, 1 number' : '••••••••'} autoComplete={signup ? 'new-password' : 'current-password'}
          />
        </Field>
        <div className="auth-reveal" data-open={signup || undefined} inert={!signup}>
          <div>
            <Field id="create-confirm" label="Confirm password">
              <PasswordInput
                ref={confirmRef} id="create-confirm" value={confirm} onChange={e => setConfirm(e.target.value)}
                required={signup} placeholder="Type it again" autoComplete="new-password"
              />
            </Field>
          </div>
        </div>
        {messages}
        <button type="submit" disabled={loading} className="fill-btn auth-submit">
          <FillButtonContent>{loading ? (signup ? 'Creating your account…' : 'Signing in…') : (signup ? 'Create account' : 'Sign in')}</FillButtonContent>
        </button>
      </form>
    </>
  )
}

/**
 * "Continue with Google" (Google's own button style: its G, dark theme), then "or" above the email
 * form. Signs in or up — a new Google account gets a Shortcut account straight away, no code (Google
 * confirmed the email); one with the same email as an existing account signs into that one (auth.ts).
 */
function GoogleButton() {
  const [going, setGoing] = useState(false)
  return (
    <>
      <button type="button" className="auth-google" disabled={going}
        onClick={() => { setGoing(true); void signIn('google', { redirectTo: takeNextPath() }) }}>
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        <span>{going ? 'Opening Google…' : 'Continue with Google'}</span>
      </button>
      <div className="auth-or" role="separator"><span>or use your email</span></div>
    </>
  )
}

// Label row (with an optional link on the right, e.g. "Forgot password?") above an input box
function Field({ id, label, aside, children }: { id: string; label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="auth-field">
      <div className="auth-field-head">
        <label htmlFor={id}>{label}</label>
        {aside}
      </div>
      {children}
    </div>
  )
}

function EmailField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field id={id} label="Email">
      <div className="auth-box">
        <Mail className="auth-box-icon" aria-hidden />
        <input
          id={id} type="email" value={value} onChange={e => onChange(e.target.value)}
          required placeholder="name@company.com" autoComplete="email"
        />
      </div>
    </Field>
  )
}

// Password box with a lock icon and an eye button that toggles the characters visible/hidden
function PasswordInput({ ref, ...props }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & { ref?: React.Ref<HTMLInputElement> }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-box auth-password">
      <Lock className="auth-box-icon" aria-hidden />
      <input ref={ref} {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className="auth-eye"
        onClick={() => setVisible(v => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
      >
        {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
      </button>
    </div>
  )
}
