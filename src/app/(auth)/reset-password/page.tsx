'use client'

import { useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'

function ResetPasswordForm() {
  const params = useSearchParams()
  const email = params.get('email') ?? ''
  const prefillOtp = params.get('otp') ?? ''
  const router = useRouter()

  const [otp, setOtp] = useState(prefillOtp)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    setLoading(true)
    setError(null)
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, otp, password }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error); setLoading(false); return }
    router.push('/login?reset=1')
  }

  return (
    <>
      <h1 className="text-2xl font-bold mb-1 text-white">New password</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
        Enter the code from your email and choose a new password.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        {!prefillOtp && (
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-white">Reset code</label>
            <input
              type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6}
              value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
              required placeholder="000000"
              className="px-3 py-2 rounded-lg text-sm text-white outline-none"
              style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
            />
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-white">New password</label>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            required placeholder="Min 8 chars, 1 uppercase, 1 number"
            className="px-3 py-2 rounded-lg text-sm text-white outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-white">Confirm password</label>
          <input
            type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            required placeholder="••••••••"
            className="px-3 py-2 rounded-lg text-sm text-white outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          />
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <button type="submit" disabled={loading}
          className="py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'var(--accent)' }}>
          {loading ? 'Resetting…' : 'Reset password'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        <Link href="/login" className="text-white font-medium hover:underline">Back to sign in</Link>
      </p>
    </>
  )
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm p-8 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <Suspense fallback={<div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto" />}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  )
}
