'use client'

import { useLiveTimeMs, LIVE_REDRAW_MS } from '@/modules/player/store'

type Part = { start_ms: number; end_ms: number; speed?: number | null; smooth?: boolean | null }

/**
 * Over the preview, while the playhead is in a part played slower or faster: its speed, in the
 * timeline's colours (slow motion blue with a turtle, faster orange with a bolt; styles .spd-tag in
 * globals.css). Nothing at normal speed.
 */
export function SpeedTag({ parts }: { parts: Part[] }) {
  const t = useLiveTimeMs(true, LIVE_REDRAW_MS * 3)
  const p = parts.find(s => t >= s.start_ms && t < s.end_ms)
  const s = p?.speed && p.speed > 0 ? p.speed : 1
  if (Math.abs(s - 1) < 0.001) return null
  const slow = s < 1
  return (
    <div className="spd-tag" data-kind={slow ? 'slow' : 'fast'} aria-live="polite">
      {slow ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M2.5 16c0-4.4 3.8-8 8.5-8s8.5 3.6 8.5 8z" /><circle cx="20.6" cy="13.4" r="2.3" />
          <path d="M5.5 16v3M15.5 16v3" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
        </svg>
      ) : (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 1 3.5 14H11l-1.5 9L20.5 10H13z" /></svg>
      )}
      {slow ? 'Slow motion' : 'Speed'} {s % 1 === 0 ? s.toFixed(0) : s}×{slow && p?.smooth ? ' · smooth' : ''}
    </div>
  )
}
