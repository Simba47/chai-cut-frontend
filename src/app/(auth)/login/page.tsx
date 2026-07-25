'use client'

import { useState, useEffect, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

function LoginForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const params = useSearchParams()
  const verify = params.get('verify')

  useEffect(() => { if (verify) setSent(true) }, [verify])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await signIn('resend', { email, redirect: false })
    } catch {
      // email providers throw on redirect — ignore
    }
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="w-full max-w-sm p-8 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h1 className="text-2xl font-bold mb-2 text-white">Chai Cut</h1>

      {sent ? (
        <div className="text-center py-4">
          <p className="text-white font-medium mb-2">Check your email</p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            We sent a magic link to <strong>{email || 'your email'}</strong>. Click it to sign in.
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>Enter your email — we&apos;ll send a sign-in link.</p>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-white">Email</label>
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                required placeholder="you@example.com"
                className="px-3 py-2 rounded-lg text-sm text-white outline-none"
                style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
              />
            </div>
            {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
            <button type="submit" disabled={loading}
              className="py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: 'var(--accent)' }}>
              {loading ? 'Sending…' : 'Send magic link'}
            </button>
          </form>
        </>
      )}
    </div>
  )
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <Suspense fallback={<div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
