'use client'

import { Sun, Moon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

/**
 * Dark / light switch for the dashboard, the clip board and the editor (only those: every other
 * page stays dark). A sculpted pill track, a round thumb that springs across with a small burst of
 * light, sun on the left and moon on the right.
 *
 * The choice is kept in this browser (localStorage `shortcut-theme`) and shown as
 * `<html data-theme="light">`, which the pages' light styles key on (globals.css). The root layout
 * sets it before the page paints, on these pages only, so a light page never flashes dark. Leaving
 * for any other page takes it off again.
 */

export const THEME_KEY = 'shortcut-theme'
/** The pages that can be light (the root layout's early script uses the same rule) */
export const THEMED_PATHS = /^\/(dashboard|videos\/|editor\/)/
const CHANGED = 'shortcut-theme-change'

type Theme = 'light' | 'dark'
function readTheme(): Theme {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark' } catch { return 'dark' }
}
function applyTheme(t: Theme) {
  const el = document.documentElement
  if (t === 'light') el.setAttribute('data-theme', 'light')
  else el.removeAttribute('data-theme')
}

/** The theme on this page, and a way to change it (kept, and told to every switch on the page) */
export function useAppTheme() {
  const [theme, setTheme] = useState<Theme>('dark')
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const sync = () => { const t = readTheme(); setTheme(t); applyTheme(t) }
    sync()
    setMounted(true)
    window.addEventListener(CHANGED, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CHANGED, sync)
      window.removeEventListener('storage', sync)
      // (off to a page that's always dark: the light look goes with this page)
      if (!THEMED_PATHS.test(window.location.pathname)) applyTheme('dark')
    }
  }, [])
  const change = (t: Theme) => {
    try { localStorage.setItem(THEME_KEY, t) } catch { /* private mode: this page only */ }
    applyTheme(t)
    setTheme(t)
    window.dispatchEvent(new Event(CHANGED))
  }
  return { theme, mounted, setTheme: change }
}

interface Particle { id: number; delay: number; duration: number }

export default function CinematicThemeSwitcher({ className = '' }: { className?: string }) {
  const { theme, mounted, setTheme } = useAppTheme()
  const [particles, setParticles] = useState<Particle[]>([])
  const isDark = !mounted || theme === 'dark'

  // A few rings of light, staggered, out from the thumb as it moves
  const burst = () => {
    setParticles([0, 1, 2].map(i => ({ id: Date.now() + i, delay: i * 0.1, duration: 0.6 + i * 0.1 })))
    setTimeout(() => setParticles([]), 1000)
  }
  const toggle = () => { burst(); setTheme(isDark ? 'light' : 'dark') }

  return (
    <motion.button type="button" onClick={toggle} disabled={!mounted}
      role="switch" aria-checked={isDark} aria-label={`Switch to ${isDark ? 'light' : 'dark'} mode`} title={isDark ? 'Light mode' : 'Dark mode'}
      whileTap={{ scale: 0.96 }}
      className={`relative shrink-0 flex h-[34px] w-[64px] items-center rounded-full p-[3px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#c8ff00]/60 ${className}`}
      style={{
        background: isDark
          ? 'radial-gradient(ellipse at top left, #1e293b 0%, #0f172a 40%, #020617 100%)'
          : 'radial-gradient(ellipse at top left, #ffffff 0%, #f1f5f9 40%, #cbd5e1 100%)',
        boxShadow: isDark
          ? 'inset 3px 3px 7px rgba(0,0,0,0.9), inset -3px -3px 7px rgba(71,85,105,0.35), inset 0 1px 2px rgba(0,0,0,1), 0 1px 1px rgba(255,255,255,0.05), 0 4px 10px rgba(0,0,0,0.4)'
          : 'inset 3px 3px 7px rgba(148,163,184,0.5), inset -3px -3px 7px rgba(255,255,255,1), inset 0 1px 2px rgba(148,163,184,0.4), 0 1px 2px rgba(255,255,255,1), 0 4px 10px rgba(0,0,0,0.08)',
        border: isDark ? '1px solid rgba(51,65,85,0.6)' : '1px solid rgba(203,213,225,0.7)',
        transition: 'background 0.4s ease, box-shadow 0.4s ease, border-color 0.4s ease',
      }}>
      {/* glossy light over the track */}
      <span aria-hidden="true" className="absolute inset-0 rounded-full pointer-events-none" style={{
        background: isDark
          ? 'linear-gradient(to bottom, rgba(71,85,105,0.2) 0%, transparent 35%, transparent 70%, rgba(0,0,0,0.3) 100%)'
          : 'linear-gradient(to bottom, rgba(255,255,255,0.7) 0%, transparent 35%, transparent 70%, rgba(148,163,184,0.15) 100%)',
        mixBlendMode: 'overlay',
      }} />
      {/* the sun and the moon in the track */}
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-between px-[9px]">
        <Sun size={13} className={isDark ? 'text-yellow-100/70' : 'text-amber-600'} />
        <Moon size={13} className={isDark ? 'text-yellow-100/70' : 'text-slate-500'} />
      </span>
      {/* the thumb: springs across, a little past and back */}
      <motion.span aria-hidden="true"
        className="relative z-10 flex h-[26px] w-[26px] items-center justify-center rounded-full overflow-hidden"
        style={{
          background: isDark
            ? 'linear-gradient(145deg, #64748b 0%, #475569 50%, #334155 100%)'
            : 'linear-gradient(145deg, #ffffff 0%, #fefefe 50%, #f8fafc 100%)',
          boxShadow: isDark
            ? 'inset 1px 1px 2px rgba(100,116,139,0.4), inset -1px -1px 2px rgba(0,0,0,0.8), 0 4px 12px rgba(0,0,0,0.6), 0 2px 4px rgba(0,0,0,0.4)'
            : 'inset 1px 1px 2px rgba(203,213,225,0.3), inset -1px -1px 2px rgba(255,255,255,1), 0 4px 12px rgba(0,0,0,0.16), 0 2px 4px rgba(0,0,0,0.08)',
          border: isDark ? '1px solid rgba(148,163,184,0.3)' : '1px solid rgba(255,255,255,0.9)',
        }}
        initial={false}
        animate={{ x: isDark ? 30 : 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
        <span className="absolute inset-0 rounded-full pointer-events-none" style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.4) 0%, transparent 40%, rgba(0,0,0,0.1) 100%)', mixBlendMode: 'overlay' }} />
        {particles.map(p => (
          <motion.span key={p.id} className="absolute rounded-full pointer-events-none" style={{
            width: 8, height: 8,
            background: isDark
              ? 'radial-gradient(circle, rgba(147,197,253,0.5) 0%, rgba(147,197,253,0) 70%)'
              : 'radial-gradient(circle, rgba(251,191,36,0.7) 0%, rgba(251,191,36,0) 70%)',
          }}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: isDark ? 5 : 6, opacity: [0, 1, 0] }}
            transition={{ duration: isDark ? 0.5 : p.duration, delay: p.delay, ease: 'easeOut' }} />
        ))}
        <span className="relative z-10">
          {isDark ? <Moon size={13} className="text-yellow-200" /> : <Sun size={13} className="text-amber-500" />}
        </span>
      </motion.span>
    </motion.button>
  )
}
