import { preload } from 'react-dom'

/**
 * The mascot's loading scenes: the brand's own 3D panda, rendered, cut out of its background and
 * laid on black (public/mascot) — each a short looping video, and its first frame as a picture
 * (shown at once, until the video plays):
 *   editor     at its desk on the laptop, headphones on, an idea lighting up over its head
 *              (played forwards then back, so it loops with no jump)
 *   clipboard  walking along, typing on its laptop (one stride, looping)
 *   dashboard  asleep in its chair at the desk, headphones on, Zzz rising
 */
export const MASCOT = {
  video: '/mascot/panda-edit.mp4',
  poster: '/mascot/panda-edit-poster.webp',
  w: 760, h: 586,
} as const
export const MASCOT_WALK = {
  video: '/mascot/panda-walk.mp4',
  poster: '/mascot/panda-walk-poster.webp',
  w: 552, h: 708,
} as const
export const MASCOT_SLEEP = {
  video: '/mascot/panda-sleep.mp4',
  poster: '/mascot/panda-sleep-poster.webp',
  w: 760, h: 564,
} as const

/** What the panda is doing in the loader: 'editor' (opening the editing board), 'clipboard' (opening the clip board) or 'dashboard' (loading the videos) */
export type MascotScene = 'editor' | 'clipboard' | 'dashboard'

/** A scene's video and picture */
export const filmOf = (scene: MascotScene) => (scene === 'clipboard' ? MASCOT_WALK : scene === 'dashboard' ? MASCOT_SLEEP : MASCOT)

const warmed = new Set<string>()
/**
 * Download a video into the browser's cache while nothing else is going on, once a page: the
 * loader then plays it at once instead of downloading it while it shows (a short load was often
 * over before its video arrived, and showed only the still picture). Not with motion turned down
 * (the loader shows the picture only), nor on a connection that asks to save data.
 */
function warmVideo(src: string) {
  if (typeof window === 'undefined' || warmed.has(src)) return
  warmed.add(src)
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
  const go = () => {
    fetch(src, { priority: 'low' } as RequestInit).then(r => r.blob()).catch(() => { warmed.delete(src) })
  }
  if ('requestIdleCallback' in window) window.requestIdleCallback(go, { timeout: 4000 })
  else setTimeout(go, 1500)
}

/**
 * Ask the browser for a loader's mascot now (call while rendering a page that leads to it, on the
 * server or in the browser), so it is already there when the loader appears: its picture at once,
 * its video (in the browser) when the page is idle.
 */
export function preloadMascot(scene: MascotScene = 'editor') {
  const film = filmOf(scene)
  preload(film.poster, { as: 'image', fetchPriority: 'high' })
  warmVideo(film.video)
}
