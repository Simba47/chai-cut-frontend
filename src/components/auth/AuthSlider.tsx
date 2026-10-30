'use client'

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { BRAND_BOTTOM, BRAND_TOP, BrandLogo } from '@/components/ui/brand-logo'
import { FillButtonContent } from '@/components/ui/fill-button'
import { keepNextPath, takeNextPath } from '@/lib/nextPath'

type Mode = 'signin' | 'signup'

/** Set by app/api/auth/signed-out for the sign-in form to say why */
const SIGNED_OUT_NOTE = 'signed_out'

/**
 * Double-slider sign in / sign up card (styles: app/auth.css). On desktop a lime
 * panel slides across to reveal the other form; on phones one form shows at a time.
 * /login and /signup both render this, and switching updates the URL in place so
 * the slide isn't interrupted by a page navigation.
 */
export function AuthSlider({ initialMode, google = false }: { initialMode: Mode; google?: boolean }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  // (the page that sent them here — a brand kit invite link — is where signing in or up ends)
  useEffect(() => { keepNextPath() }, [])

  const switchTo = (next: Mode) => {
    setMode(next)
    window.history.replaceState(null, '', next === 'signin' ? '/login' : '/signup')
  }

  return (
    <div className="auth-root">
      <Link href="/" aria-label="Shortcut home" className="auth-home"><BrandLogo shine /></Link>

      <div className="auth-card" data-mode={mode}>
        <div className="auth-form-wrap auth-signup" inert={mode !== 'signup'}>
          <SignUpForm onSwitch={() => switchTo('signin')} google={google} />
        </div>
        <div className="auth-form-wrap auth-signin" inert={mode !== 'signin'}>
          <SignInForm onSwitch={() => switchTo('signup')} google={google} />
        </div>

        <div className="auth-overlay-wrap">
          <div className="auth-overlay">
            <div className="auth-panel auth-panel-left" inert={mode !== 'signup'}>
              <PanelTitle active={mode === 'signup'}>Welcome back!</PanelTitle>
              <p>Already cutting reels with Shortcut? Sign in to pick up right where you left off.</p>
              <button type="button" className="auth-ghost" onClick={() => switchTo('signin')}>
                Sign in
              </button>
            </div>
            <div className="auth-panel auth-panel-right" inert={mode !== 'signin'}>
              <PanelTitle active={mode === 'signin'}>New to Shortcut?</PanelTitle>
              <p>Turn long videos into scroll-stopping shorts in minutes. Free to start, no credit card.</p>
              <button type="button" className="auth-ghost" onClick={() => switchTo('signup')}>
                Create account
              </button>
            </div>
          </div>
        </div>
      </div>
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

function SignInForm({ onSwitch, google }: { onSwitch: () => void; google: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const router = useRouter()

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
    window.history.replaceState(null, '', `/login${params.size ? `?${params}` : ''}`)
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setNotice(null)
    const res = await signIn('credentials', { email, password, redirect: false })
    if (res?.error) {
      setError(res.code === 'google_only'
        ? 'This email signs in with Google — use Continue with Google. (Or set a password with “Forgot password?”)'
        : 'Incorrect email or password')
      setLoading(false)
      return
    }
    router.push(takeNextPath())
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h1>Sign in</h1>
      <p className="auth-sub">Welcome back to Shortcut</p>
      {google && <GoogleButton />}
      <EmailField id="signin-email" value={email} onChange={setEmail} />
      <Field
        id="signin-password" label="Password"
        aside={<Link href="/forgot-password" className="auth-link">Forgot password?</Link>}
      >
        <PasswordInput
          id="signin-password" value={password} onChange={e => setPassword(e.target.value)}
          required placeholder="••••••••" autoComplete="current-password"
        />
      </Field>
      {notice && <p className="auth-sub" role="status">{notice}</p>}
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button type="submit" disabled={loading} className="fill-btn auth-submit">
        <FillButtonContent>{loading ? 'Signing in…' : 'Sign in'}</FillButtonContent>
      </button>
      <p className="auth-switch">
        No account? <button type="button" onClick={onSwitch}>Create one</button>
      </p>
    </form>
  )
}

function SignUpForm({ onSwitch, google }: { onSwitch: () => void; google: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    setError(null)
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    router.push(`/verify-otp?email=${encodeURIComponent(email)}&purpose=signup`)
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h1>Create account</h1>
      <p className="auth-sub">Start editing vertical video</p>
      {google && <GoogleButton />}
      <EmailField id="signup-email" value={email} onChange={setEmail} />
      <Field id="signup-password" label="Password">
        <PasswordInput
          id="signup-password" value={password} onChange={e => setPassword(e.target.value)}
          required placeholder="8+ chars, 1 uppercase, 1 number" autoComplete="new-password"
        />
      </Field>
      <Field id="signup-confirm" label="Confirm password">
        <PasswordInput
          id="signup-confirm" value={confirm} onChange={e => setConfirm(e.target.value)}
          required placeholder="••••••••" autoComplete="new-password"
        />
      </Field>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button type="submit" disabled={loading} className="fill-btn auth-submit">
        <FillButtonContent>{loading ? 'Creating account…' : 'Create account'}</FillButtonContent>
      </button>
      <p className="auth-switch">
        Already have an account? <button type="button" onClick={onSwitch}>Sign in</button>
      </p>
    </form>
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
function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-box auth-password">
      <Lock className="auth-box-icon" aria-hidden />
      <input {...props} type={visible ? 'text' : 'password'} />
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

/**
 * Lime panel heading with a logo intro: the Shortcut "S" pops in, then splits down
 * the middle (top slash slides left, bottom slash slides right) while the heading
 * is revealed from the centre outward. Replays each time the panel becomes active
 * (the key change remounts it, restarting the CSS animations in auth.css).
 */
function PanelTitle({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <h2 key={active ? 'on' : 'off'} className={`auth-title${active ? ' play' : ''}`}>
      <span className="auth-title-text">{children}</span>
      <span className="auth-title-half auth-title-left" aria-hidden>
        <svg viewBox="0 0 102 118"><path d={BRAND_TOP} /></svg>
      </span>
      <span className="auth-title-half auth-title-right" aria-hidden>
        <svg viewBox="0 0 102 118"><path d={BRAND_BOTTOM} /></svg>
      </span>
    </h2>
  )
}
