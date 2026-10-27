'use client'

import { create } from 'zustand'

// ── A clip's brand kit, on or off (user, 2026-10-19) ───────────────────────────
// On: the kit is on the clip (logo, captions, text and frame colours, corners, Branded cards) and on
// every frame or format picked while it's on. Off: all of that comes
// off again. `before` keeps what the brand changed, so turning it off puts it back (where the user
// hasn't changed it since). Saved with the clip (clips.brand); Undo covers it (history.ts).

export type { FrameBefore, BrandBefore, BrandOn } from '@/lib/shared/brandOn'
export { cleanBrandOn } from '@/lib/shared/brandOn'
import type { BrandOn } from '@/lib/shared/brandOn'

export const useBrandStore = create<{ on: BrandOn | null }>(() => ({ on: null }))
export const setBrandOn = (on: BrandOn | null) => useBrandStore.setState({ on })
