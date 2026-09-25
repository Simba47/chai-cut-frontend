'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { BrandLogo } from '@/components/ui/brand-logo'
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
              <h2>Welcome back!</h2>
              <p>Already cutting reels with Shortcut? Sign in to pick up right where you left off.</p>
              <button type="button" className="auth-ghost" onClick={() => switchTo('signin')}>
                Sign in
              </button>
            </div>
            <div className="auth-panel auth-panel-right" inert={mode !== 'signin'}>
              <h2>New to Shortcut?</h2>
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
      <input
        type="password" value={password} onChange={e => setPassword(e.target.value)}
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
      <input
        type="password" value={password} onChange={e => setPassword(e.target.value)}
        required placeholder="Password (8+ chars, 1 uppercase, 1 number)" aria-label="Password" autoComplete="new-password"
      />
      <input
        type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
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
