'use client'

import { useState } from 'react'
import Link from 'next/link'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    setSent(true)
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm p-8 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        {sent ? (
          <div className="text-center">
            <p className="text-white font-semibold mb-2">Check your email</p>
            <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
              If an account exists for <strong className="text-white">{email}</strong>, we sent a reset code.
            </p>
            <Link href={`/reset-password?email=${encodeURIComponent(email)}`}
              className="py-2 px-6 rounded-lg text-sm font-semibold text-white inline-block"
              style={{ background: 'var(--accent)' }}>
              Enter reset code
            </Link>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-bold mb-1 text-white">Reset password</h1>
            <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>
              Enter your email — we&apos;ll send a code to reset your password.
            </p>
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
              <button type="submit" disabled={loading}
                className="py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: 'var(--accent)' }}>
                {loading ? 'Sending…' : 'Send reset code'}
              </button>
            </form>
            <p className="mt-5 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
              <Link href="/login" className="text-white font-medium hover:underline">Back to sign in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
