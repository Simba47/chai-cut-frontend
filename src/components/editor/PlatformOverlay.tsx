'use client'

// Mock of the Instagram Reels / YouTube Shorts player UI, laid over the 9:16 preview so the user
// can see which parts of the frame the app covers. Purely visual: pointer-events are off so
// captions and text overlays underneath stay draggable.
//
// Positions are measured from current Android screenshots of both apps (Sep 2026) and expressed
// as a share of the video frame — the area between the status bar and the app's bottom nav (the
// nav bar sits below the video, so it isn't drawn). Sizes use cqw = 1% of the preview width.

export type Platform = 'off' | 'instagram' | 'youtube'

export interface SafeZone {
  name: string
  /** Share of the frame covered by the top bar */
  top: number
  /** Share covered by the account / caption block at the bottom */
  bottom: number
  /** Width of the action-button column on the right… */
  right: number
  /** …which only starts this far down the frame */
  rightFrom: number
  /** Small margin on the free edges */
  edge: number
}

export const PLATFORM_SAFE: Record<Exclude<Platform, 'off'>, SafeZone> = {
  instagram: { name: 'Instagram', top: 0.08, bottom: 0.13, right: 0.13, rightFrom: 0.45, edge: 0.035 },
  youtube:   { name: 'YouTube Shorts', top: 0.07, bottom: 0.13, right: 0.14, rightFrom: 0.51, edge: 0.035 },
}

// "Keep clear" red, sampled from the platform-layout reference design (its label pills)
const KEEP_CLEAR_RED = '#F0395B'

const shadow = 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.55))'
const TEXT: React.CSSProperties = { color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.6)', lineHeight: 1.15, whiteSpace: 'nowrap' }

function Glyph({ d, size = 6.4, fill = false, sw = 1.9 }: { d: string; size?: number; fill?: boolean; sw?: number }) {
  return (
    <svg viewBox="0 0 24 24" style={{ width: `${size}cqw`, height: `${size}cqw`, display: 'block', filter: shadow }}
      fill={fill ? '#fff' : 'none'} stroke="#fff" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const D = {
  heart: 'M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z',
  igComment: 'M20.7 16.4A9 9 0 1012 21a9 9 0 004.3-1.1L21 21z',
  repost: 'M17 2l3 3-3 3M4 11V9a4 4 0 014-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 01-4 4H4',
  send: 'M22 3L9.5 13.5M22 3l-7.5 18-3.5-7.5L3 10z',
  bookmark: 'M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z',
  menu: 'M5 9h14M5 15h9',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-5-5',
  kebab: 'M12 5h.01M12 12h.01M12 19h.01',
  ytComment: 'M4 5h16v11H9l-5 4z',
  share: 'M14 5l7 6.5-7 6.5v-4c-5 0-8.5 1.5-11 5 1-5 4-9.5 11-10.5z',
  remix: 'M20 12a8 8 0 11-2.3-5.7M20 4v4h-4M12 9v6M9 12h6',
}

/** Places a child centred on (x, y), both given as a share of the frame */
function At({ x, y, children, align = 'center' }: { x: number; y: number; children: React.ReactNode; align?: 'center' | 'left' }) {
  return (
    <div className="absolute" style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: align === 'center' ? 'translate(-50%, -50%)' : 'translateY(-50%)' }}>
      {children}
    </div>
  )
}

function Action({ x, y, d, label, size }: { x: number; y: number; d: string; label?: string; size?: number }) {
  return (
    <At x={x} y={y}>
      <div className="flex flex-col items-center" style={{ gap: '1cqw' }}>
        <Glyph d={d} size={size} />
        {label && <span style={{ ...TEXT, fontSize: '2.3cqw', fontWeight: 500 }}>{label}</span>}
      </div>
    </At>
  )
}

function Avatar({ size, ring = false, grad }: { size: number; ring?: boolean; grad: string }) {
  return <span style={{ display: 'block', width: `${size}cqw`, height: `${size}cqw`, borderRadius: '50%', background: grad, border: ring ? '0.4cqw solid rgba(255,255,255,0.9)' : 'none', flexShrink: 0 }} />
}

/**
 * Red "keep clear" areas: straight bands at the top and bottom and strips down each side (the right
 * one covers the action buttons). What's left in the middle is the safe area.
 */
function SafeZoneLayer({ z }: { z: SafeZone }) {
  const H = 177.78 // 9:16 frame in a 100-wide coordinate space
  const L = z.edge * 100, R = 100 - z.right * 100
  const T = z.top * H, B = (1 - z.bottom) * H
  const safe = `M${L} ${T}H${R}V${B}H${L}Z`
  return (
    <svg className="absolute inset-0" width="100%" height="100%" viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`M0 0H100V${H}H0Z ${safe}`} fillRule="evenodd" fill={KEEP_CLEAR_RED} fillOpacity="0.25" />
    </svg>
  )
}

const PILL: React.CSSProperties = {
  position: 'absolute', fontSize: '2.4cqw', fontWeight: 700, lineHeight: 1.2, color: '#fff', whiteSpace: 'nowrap',
  background: KEEP_CLEAR_RED, padding: '0.5cqw 1.6cqw', borderRadius: '1.2cqw', boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
}

/** Red labels naming each covered area — drawn above the app's UI so they're always readable */
function ZoneLabels({ z }: { z: SafeZone }) {
  return (
    <>
      {/* Each label rides the edge of the area it names */}
      <span style={{ ...PILL, left: '50%', top: `${z.top * 100}%`, transform: 'translate(-50%, -50%)' }}>Top area</span>
      <span style={{ ...PILL, left: '50%', top: `${(1 - z.bottom) * 100}%`, transform: 'translate(-50%, -50%)' }}>Bottom area</span>
      <span style={{ ...PILL, right: `${(z.right / 2) * 100}%`, top: `${z.rightFrom * 100}%`, transform: 'translate(50%, -50%)', fontSize: '2.2cqw', padding: '0.5cqw 1.2cqw' }}>Buttons</span>
    </>
  )
}

function Instagram() {
  const x = 0.927
  return (
    <>
      {/* Top bar */}
      <At x={0.058} y={0.043}><Glyph d={D.plus} size={6} sw={2.2} /></At>
      <At x={0.29} y={0.043} align="left"><span style={{ ...TEXT, fontSize: '3.6cqw', fontWeight: 700 }}>Reels</span></At>
      <At x={0.48} y={0.043} align="left">
        <div className="flex items-center" style={{ gap: '1.6cqw' }}>
          <span style={{ ...TEXT, fontSize: '3.6cqw', fontWeight: 600, color: 'rgba(255,255,255,0.72)' }}>Friends</span>
          <div className="flex">
            {['#8ab4f8', '#f6ad55', '#9ae6b4'].map((c, i) => (
              <span key={c} style={{ width: '4.4cqw', height: '4.4cqw', borderRadius: '50%', background: c, border: '0.4cqw solid #000', marginLeft: i ? '-1.6cqw' : 0 }} />
            ))}
          </div>
        </div>
      </At>

      {/* Right-hand action column */}
      <Action x={x} y={0.49} d={D.heart} label="Likes" />
      <Action x={x} y={0.575} d={D.igComment} label="37" />
      <Action x={x} y={0.66} d={D.repost} label="152" />
      <Action x={x} y={0.745} d={D.send} />
      <Action x={x} y={0.814} d={D.bookmark} label="1,243" />
      <Action x={x} y={0.888} d={D.menu} size={5.6} />
      <At x={x} y={0.947}>
        <span style={{ display: 'block', width: '6cqw', height: '6cqw', borderRadius: '1.4cqw', border: '0.45cqw solid #fff', background: 'linear-gradient(135deg,#6b7280,#1f2937)' }} />
      </At>

      {/* Account row + caption */}
      <At x={0.04} y={0.913} align="left">
        <div className="flex items-center" style={{ gap: '2.4cqw' }}>
          <Avatar size={8.4} grad="linear-gradient(135deg,#374151,#9ca3af)" />
          <span style={{ ...TEXT, fontSize: '2.9cqw', fontWeight: 700 }}>your_username</span>
          <span style={{ ...TEXT, fontSize: '2.7cqw', fontWeight: 600, border: '0.3cqw solid #fff', borderRadius: '1.6cqw', padding: '0.9cqw 2.6cqw', marginLeft: '1cqw' }}>Follow</span>
        </div>
      </At>
      <At x={0.04} y={0.96} align="left"><span style={{ ...TEXT, fontSize: '2.8cqw' }}>Your caption goes here …</span></At>

      {/* Playback progress */}
      <div className="absolute inset-x-0 bottom-0" style={{ height: '0.5cqw', background: 'rgba(255,255,255,0.3)' }}>
        <div style={{ width: '8%', height: '100%', background: '#fff' }} />
      </div>
    </>
  )
}

function YouTube() {
  const x = 0.922
  return (
    <>
      {/* Top bar: right side only */}
      <At x={0.825} y={0.032}><Glyph d={D.search} size={6} sw={2.2} /></At>
      <At x={0.942} y={0.028}><Glyph d={D.kebab} size={6} sw={3} /></At>

      {/* Right-hand action column (like is a heart; dislike is no longer shown) */}
      <Action x={x} y={0.555} d={D.heart} label="4.5K" />
      <Action x={x} y={0.63} d={D.ytComment} label="19" />
      <Action x={x} y={0.708} d={D.bookmark} label="Save" />
      <Action x={x} y={0.787} d={D.share} label="Share" />
      <Action x={x} y={0.866} d={D.remix} label="Remix" />
      <At x={x} y={0.954}>
        <span style={{ display: 'block', width: '7.4cqw', height: '7.4cqw', borderRadius: '1.6cqw', background: 'linear-gradient(135deg,#facc15,#dc2626)', border: '0.4cqw solid #fff' }} />
      </At>

      {/* Channel row + title */}
      <At x={0.04} y={0.907} align="left">
        <div className="flex items-center" style={{ gap: '2.2cqw' }}>
          <Avatar size={7.6} grad="linear-gradient(135deg,#facc15,#dc2626)" />
          <span style={{ ...TEXT, fontSize: '2.8cqw', fontWeight: 500 }}>@yourchannel</span>
          <span style={{ fontSize: '2.7cqw', fontWeight: 600, color: '#0f0f0f', background: '#fff', borderRadius: '6cqw', padding: '1.5cqw 3.4cqw', marginLeft: '1cqw' }}>Subscribe</span>
        </div>
      </At>
      <At x={0.04} y={0.953} align="left"><span style={{ ...TEXT, fontSize: '2.8cqw', fontWeight: 500 }}>Your Short&apos;s title goes here #shorts</span></At>

      {/* Playback progress */}
      <div className="absolute inset-x-0 bottom-0" style={{ height: '0.5cqw', background: 'rgba(255,255,255,0.3)' }}>
        <div style={{ width: '11%', height: '100%', background: '#fff' }} />
      </div>
    </>
  )
}

export function PlatformOverlay({ platform }: { platform: Platform }) {
  if (platform === 'off') return null
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden"
      style={{ pointerEvents: 'none', containerType: 'inline-size', borderRadius: 10, zIndex: 20, fontFamily: 'Roboto, "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif' }}>
      <SafeZoneLayer z={PLATFORM_SAFE[platform]} />
      {platform === 'instagram' ? <Instagram /> : <YouTube />}
      <ZoneLabels z={PLATFORM_SAFE[platform]} />
    </div>
  )
}
