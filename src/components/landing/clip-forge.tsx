import type { CSSProperties } from 'react'

/**
 * "Clip forge": the product as one choreographed shot (styles: .cf-* in app/landing.css).
 * One 9 s loop, every element on the same clock:
 *   1. scan    a light sweeps the long video's filmstrip; three moments light up as it passes
 *   2. lift    the three moments arc out of the strip into the Shortcut core
 *   3. snap    the S splits and snaps back together with a flash; the wordmark shines
 *   4. deal    finished 9:16 clips are dealt into a fan, captions write on, the count runs to 10
 * Pure CSS; it waits until it scrolls into view and holds a still frame for reduced motion.
 */

const FRAMES = ['#1b2328', '#272019', '#1c2620', '#231d27', '#1a2229', '#26211a']
// The pictures: panda frames (public/landing/studio-N.webp) and where the panda sits across each (%),
// for the filmstrip's frames and for the finished clips
const shot = (n: number, x: number) => ({ '--img': `url(/landing/studio-${n}.webp)`, '--pos': `${x}% 45%` })
const FRAME_SHOTS = [shot(1, 40), shot(4, 50), shot(2, 46), shot(3, 40), shot(1, 62), shot(4, 36)]
const CLIP_SHOTS = [shot(3, 42), shot(1, 42), shot(4, 51), shot(2, 47), shot(1, 44)]
// which frames hold a best moment (index), and where each one lands in the fan
const MOMENTS = [1, 3, 5]
const FAN = [
  { x: -2.2, y: 0.07, r: -14 },
  { x: -1.1, y: 0.02, r: -7 },
  { x: 0, y: 0, r: 0 },
  { x: 1.1, y: 0.02, r: 7 },
  { x: 2.2, y: 0.07, r: 14 },
]
const CAPS = ['this changes everything', 'wait for it', 'nobody talks about this', 'the real secret', 'here’s the truth']
const STEPS = ['Scanning the full video', '3 best moments found', 'Cutting, captioning, branding', 'Ready to post']

const Mark = () => (
  <svg className="cf-mark" viewBox="0 0 102 118" aria-hidden="true">
    <path className="cf-mark-top" d="M36 2H92Q98 2 94 6L34 66A32 32 0 0 1 36 2Z" />
    <path className="cf-mark-bot" d="M66 116H10Q4 116 8 112L68 52A32 32 0 0 1 66 116Z" />
  </svg>
)

export function ClipForge({ clips = 10 }: { clips?: number }) {
  return (
    <div className="cf reveal" role="img" aria-label={`Shortcut scans a long podcast video, finds the best moments and turns them into ${clips} vertical clips, captioned and branded, ready to post`}>
      {/* the beam that ties the three stages together */}
      <span className="cf-beam" aria-hidden="true" />

      {/* 1 · the long video */}
      <div className="cf-film" aria-hidden="true">
        <div className="cf-file"><b>podcast-episode-42.mp4</b><span>1:12:08</span></div>
        <div className="cf-strip">
          {FRAMES.map((tone, i) => (
            <span key={i} className="cf-frame" data-hit={MOMENTS.indexOf(i) >= 0 ? MOMENTS.indexOf(i) + 1 : undefined} style={{ '--tone': tone, ...FRAME_SHOTS[i] } as CSSProperties} />
          ))}
          <span className="cf-scan" />
        </div>
        {/* the moments, lifting out toward the core */}
        {MOMENTS.map((f, k) => (
          <span key={f} className="cf-lift" style={{ '--f': f, '--k': k, '--tone': FRAMES[f], ...FRAME_SHOTS[f] } as CSSProperties} />
        ))}
      </div>

      {/* 2 · the Shortcut core */}
      <div className="cf-core" aria-hidden="true">
        <span className="cf-ring" />
        <span className="cf-flash" />
        <span className="cf-orb"><Mark /></span>
        <span className="cf-word">Shortcut</span>
      </div>

      {/* 3 · the clips */}
      <div className="cf-hand" aria-hidden="true">
        {FAN.map((p, i) => (
          <span key={i} className="cf-clip" style={{ '--i': i, '--fx': p.x, '--fy': p.y, '--fr': `${p.r}deg`, '--tone': FRAMES[i], ...CLIP_SHOTS[i] } as CSSProperties}>
            <span className="cf-cap"><em>{CAPS[i]}</em></span>
            <span className="cf-prog" />
          </span>
        ))}
      </div>

      {/* the story, told underneath */}
      <div className="cf-steps" aria-hidden="true">
        {STEPS.map((s, i) => <span key={s} style={{ '--s': i } as CSSProperties}><i />{s}</span>)}
      </div>
      <div className="cf-count" aria-hidden="true"><b /><span>/ {clips} clips</span></div>
    </div>
  )
}
