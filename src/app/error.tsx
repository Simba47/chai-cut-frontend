'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  const router = useRouter()
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0d0d0d', padding: 24, textAlign: 'center' }}>
      <p style={{ fontSize: 48, lineHeight: 1, marginBottom: 16 }}>⚠️</p>
      <h1 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Something went wrong</h1>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', maxWidth: 340, marginBottom: 28 }}>
        An unexpected error occurred. Your work is auto-saved — try refreshing or go back to the dashboard.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={reset}
          style={{ padding: '10px 20px', borderRadius: 12, background: 'rgba(255,255,255,0.08)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          Try again
        </button>
        <button
          onClick={() => router.push('/dashboard')}
          style={{ padding: '10px 20px', borderRadius: 12, background: '#00b4d8', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none' }}
        >
          Dashboard
        </button>
      </div>
    </div>
  )
}
