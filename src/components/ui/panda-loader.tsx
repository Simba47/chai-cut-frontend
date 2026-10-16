'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { MASCOT, MASCOT_WALK, type MascotScene } from '@/components/ui/mascot'

/**
 * The Shortcut mascot as a loader: the panda (lazy, chill, smart). The pictures are the brand's own
 * 3D renders, cut out of their backgrounds; what moves is layered on them (styles: .pl-* and .pw-*
 * in app/globals.css), so it stays sharp at any size.
 *
 *   editor — it lounges on its bean bag while the laptop does the work: it breathes, "z z z" drift
 *     up, the laptop lid glows and a light sweeps across it, finished clips rise from behind the
 *     laptop and float away.
 *   clipboard — it walks along, typing on its laptop, puzzling something out: the picture is in
 *     three layers (the body and each leg), so the legs swing in a real walk while the body bobs;
 *     a thought scribbles itself over its head, and the ground slides by under its feet.
 *
 * Nothing shows until the pictures have loaded (the effects alone, around an empty space, look
 * broken): `fallback` is shown meanwhile, and the scene fades in over it, its animations starting
 * together. Pictures already downloaded (the usual case: pages that lead to a loader fetch them
 * ahead, and one loader often hands over to the next) show at once, with no fade.
 * Positions are % of the scene, so it scales to any width.
 *
 * A loader in the page as the server sends it (a refresh, a page's loading screen) switches itself
 * on: a few lines of script inside it (READY_SCRIPT) mark it ready the moment its pictures arrive,
 * long before the page's own code has started — otherwise the text showed alone until then.
 */

/**
 * Runs where it stands, as the page arrives: marks its loader ready (and with no fade, if the
 * pictures were already there) once every picture in it has loaded. Handed over as HTML in a hidden
 * span (READY_HTML), not as a <script> element: React warns about one of those when it builds the
 * loader in the browser (moving between pages), where it would never run anyway — the component's
 * own code switches the loader on there.
 */
const READY_SCRIPT = `(function(){var s=document.currentScript,p=s&&s.closest('.pl');if(!p)return;var im=p.querySelectorAll('img'),n=im.length,c=0,now=true;function one(){if(++c>=n){if(now)p.setAttribute('data-instant','');p.setAttribute('data-ready','')}}for(var i=0;i<n;i++){if(im[i].complete&&im[i].naturalWidth)one();else im[i].addEventListener('load',one,{once:true})}now=false})()`
const READY_HTML = `<script>${READY_SCRIPT}</script>`
export function PandaLoader({ scene = 'editor', width, fallback }: { scene?: MascotScene; width?: number; fallback?: ReactNode }) {
  const walk = scene === 'clipboard'
  const need = walk ? 3 : 1
  const [loaded, setLoaded] = useState(0)
  // The pictures were already there when it appeared: shown at once, no fade
  const [instant, setInstant] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // (pictures already in the cache have loaded before React listens for them: checked before the
  // first paint, so the panda is there in the very first frame)
  useLayoutEffect(() => {
    const done = [...(box.current?.querySelectorAll('img') ?? [])].filter(im => im.complete && im.naturalWidth > 0).length
    if (done >= need) setInstant(true)
    setLoaded(n => Math.max(n, done))
  }, [need])
  const ready = loaded >= need
  const one = () => setLoaded(n => n + 1)
  return (
    // (suppressHydrationWarning: READY_SCRIPT may have marked it ready before the page's code took over)
    <div ref={box} className="pl" data-scene={scene} data-ready={ready || undefined} data-instant={instant || undefined} role="img" suppressHydrationWarning style={{ width: width ?? (walk ? 330 : 400) }}
      aria-label={walk ? 'The Shortcut panda walks along, working out the best moments of your video' : 'The Shortcut panda relaxes while its laptop makes your clips'}>
      {fallback && <div className="pl-fallback" aria-hidden={ready || undefined}>{fallback}</div>}
      {walk ? (
        <div className="pl-scene">
          {/* the ground: only what the walk needs — a shadow under its feet, and marks sliding by */}
          <span className="pw-ground" aria-hidden="true" />
          <span className="pw-shadow" aria-hidden="true" />
          {/* dust where each foot lands */}
          <span className="pw-dust pw-dust-front" aria-hidden="true" />
          <span className="pw-dust pw-dust-back" aria-hidden="true" />
          {/* the panda, in three layers: the back leg, the body over it, the front leg over that */}
          <div className="pw-fig">
            {/* eslint-disable @next/next/no-img-element */}
            <img className="pw-leg pw-leg-back" src={MASCOT_WALK.legBack} width={MASCOT_WALK.w} height={MASCOT_WALK.h} alt="" draggable={false} onLoad={one} />
            <img className="pw-body" src={MASCOT_WALK.body} width={MASCOT_WALK.w} height={MASCOT_WALK.h} alt="" draggable={false} fetchPriority="high" onLoad={one} />
            <img className="pw-leg pw-leg-front" src={MASCOT_WALK.legFront} width={MASCOT_WALK.w} height={MASCOT_WALK.h} alt="" draggable={false} onLoad={one} />
            {/* eslint-enable @next/next/no-img-element */}
            {/* the mark on the laptop glows */}
            <span className="pw-markglow" aria-hidden="true" />
          </div>
          {/* what's on its mind: a scribble that draws itself, and two question marks */}
          <svg className="pw-think" viewBox="0 0 120 110" aria-hidden="true">
            <path className="pw-scribble" pathLength="1" d="M58 44c-16-4-26 8-17 17 11 11 38 6 38-8 0-13-27-17-36-5-8 11 9 24 27 17 15-6 12-24-5-24-15 0-25 13-14 21 10 7 27 1 25-9-2-9-17-11-23-3" />
            <path className="pw-scribble pw-tail" pathLength="1" d="M52 76c6 3-2 6 3 9 4 2-1 5 2 8" />
            <text className="pw-q" x="92" y="88">?</text>
            <text className="pw-q pw-q2" x="104" y="104">?</text>
          </svg>
        </div>
      ) : (
        <div className="pl-scene">
          <div className="pl-stage">
            <span className="pl-floor" aria-hidden="true" />
            <span className="pl-aura" aria-hidden="true" />
            {/* clips made by the laptop: behind the picture, so they come up from behind the lid */}
            {[0, 1, 2].map(i => (
              <span key={i} className="pl-clip" aria-hidden="true"
                style={{ left: `${[87, 91.5, 84][i]}%`, animationDelay: `${i * 1.25}s`, ['--dx' as string]: `${[30, 70, -40][i]}%`, ['--rot' as string]: `${[10, 18, -12][i]}deg` }}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7.5v9l7.5-4.5z" /></svg>
              </span>
            ))}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pl-art" src={MASCOT.src} width={MASCOT.w} height={MASCOT.h} alt="" draggable={false}
              fetchPriority="high" onLoad={one} />
            {/* the lid: a lime glow on the mark, and a light sweeping across */}
            <span className="pl-lid" aria-hidden="true"><i /></span>
            <span className="pl-markglow" aria-hidden="true" />
            {[0, 1, 2].map(i => (
              <span key={i} className="pl-z" aria-hidden="true" style={{ left: `${66 + i * 3.2}%`, top: `${9 - i * 6}%`, fontSize: `${0.85 + i * 0.28}em`, animationDelay: `${i * 0.85}s` }}>z</span>
            ))}
            {[[12, 78], [30, 12], [52, 4], [96, 40], [6, 40]].map(([x, y], i) => (
              <span key={i} className="pl-spark" aria-hidden="true" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${i * 0.9}s` }} />
            ))}
          </div>
        </div>
      )}
      <span hidden dangerouslySetInnerHTML={{ __html: READY_HTML }} />
    </div>
  )
}
