'use client'

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { filmOf, type MascotScene } from '@/components/ui/mascot'

/**
 * The Shortcut mascot as a loader: the panda (lazy, chill, smart), one rendered scene on black for
 * each loading screen (styles: .pl-* and .pw-* in app/globals.css):
 *
 *   editor — it works at its desk on the laptop and an idea lights up over its head (played
 *     forwards then back, so it loops with no jump).
 *   clipboard — it walks along, typing on its laptop (one stride, looping).
 *   dashboard — it sleeps in its chair at the desk, Zzz rising.
 *
 * Each is a short video over its first frame as a picture: the picture shows at once, the video
 * fades in over it as soon as it plays. Nothing shows until the picture has loaded: `fallback` is
 * shown meanwhile, and the scene fades in over it. A picture already downloaded (the usual case:
 * pages that lead to a loader fetch it ahead, and one loader often hands over to the next) shows
 * at once, with no fade. With motion turned down (prefers-reduced-motion) only the picture shows.
 *
 * A loader in the page as the server sends it (a refresh, a page's loading screen) switches itself
 * on: a few lines of script inside it (READY_SCRIPT) mark it ready the moment its picture arrives,
 * and show the video the moment it plays — long before the page's own code has started.
 */

/**
 * Runs where it stands, as the page arrives: marks its loader ready (and with no fade, if the
 * picture was already there) once its picture has loaded, and playing once its video plays (or
 * keeps the video still, with motion turned down). Handed over as HTML in a hidden span
 * (READY_HTML), not as a <script> element: React warns about one of those when it builds the loader
 * in the browser (moving between pages), where it would never run anyway — the component's own
 * code switches the loader on there.
 */
const READY_SCRIPT = `(function(){var s=document.currentScript,p=s&&s.closest('.pl');if(!p)return;var im=p.querySelectorAll('img'),n=im.length,c=0,now=true;function one(){if(++c>=n){if(now)p.setAttribute('data-instant','');p.setAttribute('data-ready','')}}for(var i=0;i<n;i++){if(im[i].complete&&im[i].naturalWidth)one();else im[i].addEventListener('load',one,{once:true})}now=false;var v=p.querySelector('video');if(!v)return;if(window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches){v.removeAttribute('autoplay');v.pause();return}function on(){p.setAttribute('data-playing','')}if(!v.paused&&v.currentTime>0)on();else v.addEventListener('playing',on,{once:true});v.muted=true;var r=v.play();if(r&&r.catch)r.catch(function(){})})()`
const READY_HTML = `<script>${READY_SCRIPT}</script>`

/**
 * Where each scene's video is in its loop, so a loader that hands over to another of the same scene
 * (a page's loading screen, then the page's own while it fetches; the clip board's "getting your
 * clip ready", then the editor's loading screen) carries on instead of starting over: when its loop
 * was at 0 s (performance.now()), and when it was last on screen.
 */
const loops: Partial<Record<MascotScene, { at0: number; seen: number }>> = {}
/** How soon after the last one a loader of the same scene still counts as carrying it on */
const HANDOVER_MS = 1500

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function PandaLoader({ scene = 'editor', width, fallback }: { scene?: MascotScene; width?: number; fallback?: ReactNode }) {
  const film = filmOf(scene)
  const videoRef = useRef<HTMLVideoElement>(null)
  // Its video is playing (it shows over its first frame then)
  const [playing, setPlaying] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // The picture was already there when it appeared: shown at once, no fade
  const [instant, setInstant] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  // Before the first paint: a picture already in the cache has loaded before React listens for it
  // (so the panda is there in the very first frame), and a loader carrying on from the one before
  // it is put where that one was
  useLayoutEffect(() => {
    const im = box.current?.querySelector('img')
    if (im?.complete && im.naturalWidth > 0) { setInstant(true); setLoaded(true) }
    const v = videoRef.current
    if (!v) return
    if (reducedMotion()) { v.pause(); return }
    const prev = loops[scene]
    const carryOn = !!prev && performance.now() - prev.seen < HANDOVER_MS
    const place = () => {
      if (!carryOn || !(v.duration > 0)) return
      const t = ((performance.now() - prev!.at0) / 1000) % v.duration
      if (Math.abs(v.currentTime - t) > 0.1) v.currentTime = t
    }
    if (v.readyState >= 1) place(); else v.addEventListener('loadedmetadata', place, { once: true })
    if (!v.paused && v.currentTime > 0) setPlaying(true)
    // (started by hand too: it can't always start on its own)
    v.muted = true
    v.play().catch(() => { /* (autoplay refused: its first frame stays) */ })
    // Keep where its loop is, as it plays (it wraps round: worked out again from the time each frame)
    const note = () => { if (v.duration > 0 && !v.paused) loops[scene] = { at0: performance.now() - v.currentTime * 1000, seen: performance.now() } }
    v.addEventListener('timeupdate', note)
    return () => {
      note()
      v.removeEventListener('timeupdate', note)
      v.removeEventListener('loadedmetadata', place)
    }
  }, [scene])
  return (
    // (suppressHydrationWarning: READY_SCRIPT may have marked it ready, or playing, before the page's code took over)
    <div ref={box} className="pl" data-scene={scene} data-ready={loaded || undefined} data-instant={instant || undefined} data-playing={playing || undefined} role="img" suppressHydrationWarning style={{ width: width ?? (scene === 'clipboard' ? 213 : scene === 'dashboard' ? 360 : 380) }}
      aria-label={scene === 'clipboard' ? 'The Shortcut panda walks along, working out the best moments of your video' : scene === 'dashboard' ? 'The Shortcut panda naps at its desk while your videos load' : 'The Shortcut panda works on its laptop and gets an idea while your clip gets ready'}>
      {fallback && <div className="pl-fallback" aria-hidden={loaded || undefined}>{fallback}</div>}
      <div className="pl-scene">
        {/* its first frame at once (what "ready" waits for), the video playing over it as soon as it can */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="pw-poster" src={film.poster} width={film.w} height={film.h} alt="" draggable={false} fetchPriority="high" onLoad={() => setLoaded(true)} />
        <video ref={videoRef} className="pw-video" src={film.video} width={film.w} height={film.h}
          muted loop autoPlay playsInline preload="auto" aria-hidden="true" disablePictureInPicture
          onPlaying={() => setPlaying(true)} />
      </div>
      <span hidden dangerouslySetInnerHTML={{ __html: READY_HTML }} />
    </div>
  )
}
