'use client'

import { useRef, useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff } from 'lucide-react'
import { BRAND_BOTTOM, BRAND_TOP, BrandLogo } from '@/components/ui/brand-logo'
import { FillButtonContent } from '@/components/ui/fill-button'
import { AuthBackground } from './AuthBackground'

type Mode = 'signin' | 'signup'

/**
 * Double-slider sign in / sign up card (styles: app/auth.css). On desktop a lime
 * panel slides across to reveal the other form; on phones one form shows at a time.
 * /login and /signup both render this, and switching updates the URL in place so
 * the slide isn't interrupted by a page navigation.
 */
export function AuthSlider({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const cardRef = useRef<HTMLDivElement>(null)

  const switchTo = (next: Mode) => {
    setMode(next)
    window.history.replaceState(null, '', next === 'signin' ? '/login' : '/signup')
  }

  return (
    <div className="auth-root">
      <AuthBackground cardRef={cardRef} />
      <Link href="/" aria-label="Shortcut home" className="auth-home"><BrandLogo shine /></Link>

      <div ref={cardRef} className="auth-card" data-mode={mode}>
        <div className="auth-form-wrap auth-signup" inert={mode !== 'signup'}>
          <SignUpForm onSwitch={() => switchTo('signin')} />
        </div>
        <div className="auth-form-wrap auth-signin" inert={mode !== 'signin'}>
          <SignInForm onSwitch={() => switchTo('signup')} />
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

function SignInForm({ onSwitch }: { onSwitch: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const res = await signIn('credentials', { email, password, redirect: false })
    if (res?.error) {
      setError('Incorrect email or password')
      setLoading(false)
      return
    }
    router.push('/dashboard')
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <h1>Sign in</h1>
      <p className="auth-sub">Welcome back to Shortcut</p>
      <input
        type="email" value={email} onChange={e => setEmail(e.target.value)}
        required placeholder="Email" aria-label="Email" autoComplete="email"
      />
      <PasswordInput
        value={password} onChange={e => setPassword(e.target.value)}
        required placeholder="Password" aria-label="Password" autoComplete="current-password"
      />
      <Link href="/forgot-password" className="auth-link">Forgot your password?</Link>
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

function SignUpForm({ onSwitch }: { onSwitch: () => void }) {
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
      <input
        type="email" value={email} onChange={e => setEmail(e.target.value)}
        required placeholder="Email" aria-label="Email" autoComplete="email"
      />
      <PasswordInput
        value={password} onChange={e => setPassword(e.target.value)}
        required placeholder="Password (8+ chars, 1 uppercase, 1 number)" aria-label="Password" autoComplete="new-password"
      />
      <PasswordInput
        value={confirm} onChange={e => setConfirm(e.target.value)}
        required placeholder="Confirm password" aria-label="Confirm password" autoComplete="new-password"
      />
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

// Password box with an eye button that toggles the characters visible/hidden
function PasswordInput(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="auth-password">
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
