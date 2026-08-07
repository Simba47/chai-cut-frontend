'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function EditorError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error) }, [error])
  const router = useRouter()
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: '#0d0d0d' }}>
      {/* Minimal header so it looks like the editor */}
      <header style={{ height: 44, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10, padding: '0 16px', background: '#111', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <button onClick={() => router.push('/dashboard')} style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.7)' }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 2.5L4.5 7 9 11.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#fff' }}>✂ Chai Cut</span>
      </header>

      {/* Error body */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, fontSize: 24 }}>
          ⚡
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Editor couldn't load</h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', maxWidth: 300, lineHeight: 1.6, marginBottom: 28 }}>
          Something went wrong loading this clip. Your edits are auto-saved — try again or go back to your videos.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={reset}
            style={{ padding: '10px 20px', borderRadius: 12, background: 'rgba(255,255,255,0.07)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            Try again
          </button>
          <button
            onClick={() => router.push('/dashboard')}
            style={{ padding: '10px 20px', borderRadius: 12, background: '#00b4d8', color: '#000', fontSize: 13, fontWeight: 700, cursor: 'pointer', border: 'none' }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}
