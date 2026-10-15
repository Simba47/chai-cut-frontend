import { preload } from 'react-dom'

/**
 * The mascot pictures: the brand's own 3D renders of the panda, cut out of their backgrounds
 * (public/mascot), at twice the size they are shown (sharp on any screen, light to download).
 *   editor     lounging on its bean bag with its laptop: one picture
 *   clipboard  walking along, typing on its laptop: three layers of one picture (the body and each
 *              leg), all the same size, so the legs can swing — a walk
 */
export const MASCOT = { src: '/mascot/panda-lounge.webp', w: 800, h: 382 } as const
export const MASCOT_WALK = {
  body: '/mascot/panda-walk-body.webp',
  legFront: '/mascot/panda-walk-leg-front.webp',
  legBack: '/mascot/panda-walk-leg-back.webp',
  w: 400, h: 512,
} as const

/** What the panda is doing in the loader: 'editor' (opening the editing board) or 'clipboard' (opening the clip board) */
export type MascotScene = 'editor' | 'clipboard'

/**
 * Ask the browser for a loader's mascot pictures now (call while rendering a page that leads to
 * it, on the server or in the browser), so they are already there when the loader appears.
 */
export function preloadMascot(scene: MascotScene = 'editor') {
  const srcs = scene === 'editor' ? [MASCOT.src] : [MASCOT_WALK.body, MASCOT_WALK.legFront, MASCOT_WALK.legBack]
  for (const src of srcs) preload(src, { as: 'image', fetchPriority: 'high' })
}
