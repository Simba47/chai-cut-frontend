'use client'

import { useRouter } from 'next/navigation'

export default function NotFound() {
  const router = useRouter()
  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0d0d0d', padding: 24, textAlign: 'center' }}>
      <p style={{ fontSize: 64, lineHeight: 1, marginBottom: 16 }}>✂</p>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 8 }}>Page not found</h1>
      <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.4)', maxWidth: 320, marginBottom: 28 }}>
        The clip or page you're looking for doesn't exist or may have been deleted.
      </p>
      <button
        onClick={() => router.push('/dashboard')}
        style={{ padding: '10px 24px', borderRadius: 12, background: '#00b4d8', color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer', border: 'none' }}
      >
        Go to Dashboard
      </button>
    </div>
  )
}
