'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { PLANS } from '@/lib/plans'

const PLAN_ORDER = ['free', 'starter', 'creator', 'agency'] as const

export default function PricingPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubscribe(planKey: string) {
    if (!session) { router.push('/login'); return }
    if (planKey === 'free') return
    setLoading(planKey)
    setError(null)
    try {
      const res = await fetch('/api/billing/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: planKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      router.push('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="min-h-screen" style={{ background: '#0d0d0d' }}>
      <nav className="flex items-center justify-between px-6 py-3 border-b" style={{ background: '#111', borderColor: 'rgba(255,255,255,0.07)' }}>
        <a href="/dashboard" className="text-base font-bold text-white tracking-tight">✂ Chai Cut</a>
        {session && (
          <a href="/dashboard" className="text-xs px-3 py-1.5 rounded-lg" style={{ color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}>
            Dashboard
          </a>
        )}
      </nav>

      <main className="max-w-5xl mx-auto px-6 pt-14 pb-20">
        <h1 className="text-3xl font-bold text-white text-center mb-2">Simple, transparent pricing</h1>
        <p className="text-center mb-3" style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.9rem' }}>
          All plans include unlimited exports · Cancel anytime
        </p>

        <div className="mx-auto max-w-sm mb-10 rounded-xl px-4 py-2.5 text-center text-xs" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>
          Test mode — clicking Subscribe activates the plan instantly with no payment
        </div>

        {error && (
          <p className="text-center text-sm mb-6" style={{ color: '#f87171' }}>{error}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {PLAN_ORDER.map(key => {
            const plan = PLANS[key]
            const isPaid = plan.price > 0
            const isPopular = key === 'creator'
            const busy = loading === key
            return (
              <div
                key={key}
                className="rounded-2xl flex flex-col"
                style={{
                  background: isPopular ? 'rgba(0,180,216,0.08)' : '#161616',
                  border: `1px solid ${isPopular ? 'rgba(0,180,216,0.4)' : 'rgba(255,255,255,0.08)'}`,
                  padding: '24px 20px',
                }}
              >
                {isPopular && (
                  <div className="text-xs font-semibold mb-3 px-2 py-0.5 rounded self-start" style={{ background: '#00b4d8', color: '#000' }}>
                    Most Popular
                  </div>
                )}
                <div className="text-sm font-semibold mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>{plan.name}</div>
                <div className="flex items-end gap-1 mb-5">
                  {isPaid ? (
                    <>
                      <span className="text-3xl font-bold text-white">₹{plan.price}</span>
                      <span className="text-sm pb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>/month</span>
                    </>
                  ) : (
                    <span className="text-3xl font-bold text-white">Free</span>
                  )}
                </div>

                <ul className="flex-1 space-y-2.5 mb-6">
                  {([
                    [`${plan.maxVideos} video${plan.maxVideos === 1 ? '' : 's'}`, true],
                    [`Up to ${plan.maxFileSizeGb} GB per video`, true],
                    [plan.maxClips ? `${plan.maxClips} clips` : 'Unlimited clips', true],
                    [`${plan.retentionDays} days history`, true],
                    ['Auto captions', plan.autoCaption],
                    ['No watermark', !plan.watermark],
                  ] as [string, boolean][]).map(([label, included]) => (
                    <li key={label} className="flex items-center gap-2 text-sm" style={{ color: included ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.2)' }}>
                      <span style={{ color: included ? '#00b4d8' : 'rgba(255,255,255,0.15)', fontSize: '1rem', lineHeight: '1' }}>
                        {included ? '✓' : '×'}
                      </span>
                      {label}
                    </li>
                  ))}
                </ul>

                {isPaid ? (
                  <button
                    onClick={() => handleSubscribe(key)}
                    disabled={!!loading}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity"
                    style={{
                      background: isPopular ? '#00b4d8' : 'rgba(255,255,255,0.1)',
                      color: isPopular ? '#000' : '#fff',
                      opacity: loading && !busy ? 0.4 : 1,
                      cursor: loading ? 'wait' : 'pointer',
                    }}
                  >
                    {busy ? 'Activating…' : `Subscribe — ₹${plan.price}/mo`}
                  </button>
                ) : (
                  <div className="w-full py-2.5 rounded-xl text-sm font-semibold text-center" style={{ background: 'rgba(255,255,255,0.04)', color: 'rgba(255,255,255,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    Default plan
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </main>
    </div>
  )
}
