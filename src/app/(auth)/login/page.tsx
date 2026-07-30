'use client'

import { useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

function LoginForm() {
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
    <div className="w-full max-w-sm p-8 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h1 className="text-2xl font-bold mb-1 text-white">Chai Cut</h1>
      <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>Sign in to your account</p>

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
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-white">Password</label>
          <input
            type="password" value={password} onChange={e => setPassword(e.target.value)}
            required placeholder="••••••••"
            className="px-3 py-2 rounded-lg text-sm text-white outline-none"
            style={{ background: 'var(--surface-2)', border: '1px solid var(--border)' }}
          />
        </div>
        {error && <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
        <button type="submit" disabled={loading}
          className="py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: 'var(--accent)' }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <div className="mt-5 flex flex-col gap-2 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
        <Link href="/forgot-password" className="hover:text-white transition-colors">
          Forgot your password?
        </Link>
        <span>
          No account?{' '}
          <Link href="/signup" className="text-white font-medium hover:underline">Sign up</Link>
        </span>
      </div>
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
