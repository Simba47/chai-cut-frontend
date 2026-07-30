'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'

const RESEND_COOLDOWN = 60

function VerifyOtpForm() {
  const params = useSearchParams()
  const email = params.get('email') ?? ''
  const purpose = (params.get('purpose') ?? 'signup') as 'signup' | 'password_reset'
  const router = useRouter()

  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const res = await fetch('/api/auth/verify-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, purpose }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }

    if (purpose === 'signup') {
      const signInRes = await signIn('credentials', {
        email,
        password: params.get('__p') ?? '',
        redirect: false,
      })
      if (signInRes?.ok) { router.push('/dashboard'); return }
      // Password not in URL (security) — ask user to login
      setSuccess(true)
      setLoading(false)
    } else {
      router.push(`/reset-password?email=${encodeURIComponent(email)}&otp=${encodeURIComponent(otp)}`)
    }
  }

  async function handleResend() {
    setCooldown(RESEND_COOLDOWN)
    await fetch('/api/auth/verify-otp', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, purpose }),
    })
  }

  if (success) {
    return (
      <div className="text-center">
        <p className="text-white font-semibold mb-2">Email verified!</p>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          Your account is ready. Sign in to get started.
        </p>
        <a href="/login" className="text-sm font-semibold text-white underline">Go to sign in</a>
      </div>
    )
  }

  return (
    <>
      <h1 className="text-2xl font-bold mb-1 text-white">Check your email</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        We sent a 6-digit code to <strong className="text-white">{email}</strong>
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-white">Verification code</label>
          <input
            type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
            value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
            required placeholder="000000"
            className="px-3 py-3 rounded-lg text-center text-2xl font-bold tracking-[0.5em] text-white outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)', letterSpacing: '0.5em' }}
          />
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <button type="submit" disabled={loading || otp.length < 6}
          className="py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'var(--accent)' }}>
          {loading ? 'Verifying…' : 'Verify'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        Didn&apos;t receive it?{' '}
        {cooldown > 0 ? (
          <span>Resend in {cooldown}s</span>
        ) : (
          <button onClick={handleResend} className="text-white font-medium hover:underline">
            Resend code
          </button>
        )}
      </p>
    </>
  )
}

export default function VerifyOtpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm p-8 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <Suspense fallback={<div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />}>
          <VerifyOtpForm />
        </Suspense>
      </div>
    </div>
  )
}
