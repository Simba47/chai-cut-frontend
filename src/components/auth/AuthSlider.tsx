'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Eye, EyeOff, Lock, Mail } from 'lucide-react'
import { BRAND_BOTTOM, BRAND_TOP, BrandLogo } from '@/components/ui/brand-logo'
import { FillButtonContent } from '@/components/ui/fill-button'

type Mode = 'signin' | 'signup'

/**
 * Double-slider sign in / sign up card (styles: app/auth.css). On desktop a lime
 * panel slides across to reveal the other form; on phones one form shows at a time.
 * /login and /signup both render this, and switching updates the URL in place so
 * the slide isn't interrupted by a page navigation.
 */
export function AuthSlider({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode)

  const switchTo = (next: Mode) => {
    setMode(next)
    window.history.replaceState(null, '', next === 'signin' ? '/login' : '/signup')
  }

  return (
    <div className="auth-root">
      <Link href="/" aria-label="Shortcut home" className="auth-home"><BrandLogo shine /></Link>

      <div className="auth-card" data-mode={mode}>
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
